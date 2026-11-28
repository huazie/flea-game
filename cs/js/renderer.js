/* 反恐突袭 - 渲染器：Renderer{beginFrame, submitFace, drawBillboard, drawViewmodel, endFrame} 接口
 * Renderer2D：4 种程序化纹理（64×64 离屏 ×2 主题=8 张缓存）+ 伪光照（6 档朝向预计算）
 *             + 天空渐变（init 缓存）+ 距离雾 + 屏幕空间特效（弹孔/粒子/弹壳/火光/视图模型）
 * Renderer2DFlat：同接口纯色块降级，实测 <45fps 自动切换（CS.useRenderer）。
 * 画家算法 + 0.1m 近裁剪；面池 80 / 粒子 64 / 弹壳 8 / 弹孔 32 全预分配，逐帧零分配。
 * 面数据平铺 Float64Array 按引用传（submitFace 零拷贝），供下轮 RendererGL 同接口替换。 */
(function (global) {
    'use strict';
    var CS = global.CS || (global.CS = {});
    var C = CS.CFG, U = CS.Util, W = CS.World;

    /* ── 面池与排序索引（模块加载时预分配）── */
    var MAX_FACES = 96, MAX_VERTS = 8;   /* 96：围墙长面分割后峰值 ~78（3-5 bot + 全墙可见），见 ADR-40 */
    var faces = [], order = [], floats = [], i;
    for (i = 0; i < MAX_FACES; i++) {
        faces.push({ n: 0, sx: new Float64Array(MAX_VERTS), sy: new Float64Array(MAX_VERTS),
            dist: 0, color: '', alpha: 1, stroke: false, tex: -1, shade: 1, fog: 0, mark: 0 });
        order.push(0);
    }
    for (i = 0; i < 4; i++) floats.push({ x: 0, y: 0, z: 0, life: 0 });
    /* #9 击杀倒地消散池：预分配 MAX_BOTS(5) 槽，走 ctx 绘制不占面池。
     * 每槽记录击杀点 x/z 与剩余 life；life 从 DEATH_FX_TIME 递减，画一个下沉+淡出的方块。 */
    var deaths = [], deathIdx = 0;
    for (i = 0; i < 5; i++) deaths.push({ x: 0, z: 0, life: 0, max: C.DEATH_FX_TIME || 0.2 });
    var floatIdx = 0, faceCount = 0;

    /* 复用的相机/裁剪/投影缓冲 */
    var q = new Float64Array(12);          // 4 顶点世界坐标（submitFace 按引用传入）
    var camIn = new Float64Array(12);      // 4 顶点相机坐标
    var camOut = new Float64Array(24);     // 裁剪后最多 8 顶点
    var lineIn = new Float64Array(6), lineOut = new Float64Array(9);
    var holeQx = new Float64Array(4), holeQy = new Float64Array(4);
    var proj = { sx: 0, sy: 0, ok: false };
    var BLACK = '#000';

    var palette = {
        sky: '', floor: '', grid: '', wallEdge: '', wallTop: '',
        bot: '', botHead: '', botHit: '', muzzle: '',
        player: '', playerHead: '', accent: '',
        playerTop: '', playerSide: '', headTop: '', headSide: '',   /* ADR-59：盒体三档明暗，主题刷新时派生 */
        wallA: '', wallB: '', hole: '', shell: '',
        gunBody: '', gunDark: '', gunSight: '',
        gunHi: 'rgba(255,255,255,0.15)', gunLo: 'rgba(0,0,0,0.22)',
        wallX: new Array(3), wallZ: new Array(3)
    };

    var canvas, ctx, stage, cssW = 1, cssH = 1, focal = 1, renderScale = 1;
    var scaleOverride = 0;   /* 自适应降档：0.65（慢帧时先降内部分辨率，恢复不了再降 flat） */
    var camX = 0, camY = 0, camZ = 0;
    var fX = 0, fY = 0, fZ = 1, rX = 1, rY = 0, rZ = 0, uX = 0, uY = 1, uZ = 0;
    var px = 0, py = C.EYE_Y, pz = 0;
    var lastPitch = 0, lastView = 'fps';
    var playerAlpha = 1, camDist = 0;
    var gaitPhase = 0;   /* TPS 步态相位（ADR-58）：按移动距离推进，纯视觉，静止/暂停冻结 */
    var axX = 1, axZ = 0;   // 公告板水平轴（由相机方向算出）
    var bodyFx = 0, bodyFz = 1;   /* ADR-59：玩家盒体深度方向（本体前向），setCamera 时算一次 */
    var lastMark = { mark: 0, top: 0, bottom: 0, y: 0, y2: 0, y3: 0 };   // QA：最近一次脸部标记的屏幕几何（y=眼/盔带，y2=鼻/后脑带，y3=嘴）

    /* ── 伪光照：L = normalize(0.4, 0.7, 0.6)，6 个面朝向档位预计算 ── */
    var LN = Math.sqrt(0.4 * 0.4 + 0.7 * 0.7 + 0.6 * 0.6);
    var LX = 0.4 / LN, LY = 0.7 / LN, LZ = 0.6 / LN;
    var shadeO = new Array(6);
    for (i = 0; i < 6; i++) {
        var nx0 = i === 0 ? 1 : (i === 1 ? -1 : 0);
        var ny0 = i === 2 ? 1 : (i === 3 ? -1 : 0);
        var nz0 = i === 4 ? 1 : (i === 5 ? -1 : 0);
        var dd = nx0 * LX + ny0 * LY + nz0 * LZ;
        if (dd < 0) dd = 0;
        shadeO[i] = 0.55 + 0.45 * dd;
    }
    /* 每盒纹理：0 砖墙 / 1 混凝土 / 2 木箱 / 3 地面；外围墙砖、掩体交替混凝土/木箱 */
    var boxTex = [], boxCount = 0;

    /* ── 程序化纹理缓存（×2 主题）与图案 ── */
    var texCache = { light: null, dark: null };
    var texPal = { light: null, dark: null };
    var activePats = [null, null, null, null];
    var skyGrad = null, mode = 0;   // mode 0=Renderer2D 纹理, 1=Renderer2DFlat

    function readTexPal() {
        var s = global.getComputedStyle(document.documentElement);
        function v(n, fb) { var r = s.getPropertyValue(n).trim(); return r || fb; }
        var base = v('--bg-color', '#888');
        return {
            wallA: v('--cs-wall-a', base), wallB: v('--cs-wall-b', v('--cs-wall-a', base)),
            floor: v('--cs-floor', base), edge: v('--cs-wall-edge', v('--text-color', base))
        };
    }

    /* 确定性伪随机（同一主题每次生成纹理一致） */
    function lcg(seed) {
        var s = seed | 0;
        return function () {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            return s / 0x7fffffff;
        };
    }

    function buildTex(kind, pal) {
        var cv = document.createElement('canvas');
        cv.width = 64; cv.height = 64;
        var g = cv.getContext('2d');
        var base, dark, lite, rnd, k, x2, y2;
        if (kind === 0) {            // 砖墙：4 行错缝砖 + 高光碎点
            base = U.shade(pal.wallA, 0.92); dark = U.shade(pal.wallA, 0.60); lite = U.shade(pal.wallA, 1.10);
            g.fillStyle = base; g.fillRect(0, 0, 64, 64);
            g.fillStyle = dark;
            for (k = 0; k < 4; k++) {
                y2 = k * 16;
                g.fillRect(0, y2, 64, 2);
                for (x2 = (k % 2) * 16; x2 < 64; x2 += 32) g.fillRect(x2, y2, 2, 16);
            }
            g.fillStyle = lite; rnd = lcg(7);
            for (k = 0; k < 40; k++) g.fillRect((rnd() * 62) | 0, (rnd() * 62) | 0, 2, 1);
        } else if (kind === 1) {     // 混凝土：基色 + 斑点 + 细裂缝
            base = pal.wallB; dark = U.shade(pal.wallB, 0.72); lite = U.shade(pal.wallB, 1.14);
            g.fillStyle = base; g.fillRect(0, 0, 64, 64);
            g.fillStyle = dark; rnd = lcg(23);
            for (k = 0; k < 90; k++) g.fillRect((rnd() * 63) | 0, (rnd() * 63) | 0, 1 + (rnd() * 2 | 0), 1);
            g.fillStyle = lite; rnd = lcg(41);
            for (k = 0; k < 50; k++) g.fillRect((rnd() * 63) | 0, (rnd() * 63) | 0, 1, 1);
            g.fillStyle = dark;
            g.fillRect(10, 4, 1, 18); g.fillRect(11, 22, 1, 14); g.fillRect(44, 30, 1, 24);
        } else if (kind === 2) {     // 木箱：木纹板 + 深色边框 + X 交叉撑
            base = U.shade(pal.wallA, 1.02); dark = U.shade(pal.edge, 0.9); lite = U.shade(pal.wallA, 1.16);
            g.fillStyle = base; g.fillRect(0, 0, 64, 64);
            g.fillStyle = dark;
            for (k = 0; k < 5; k++) g.fillRect(0, k * 13 + 12, 64, 1);
            g.fillStyle = lite; rnd = lcg(59);
            for (k = 0; k < 30; k++) g.fillRect((rnd() * 62) | 0, (rnd() * 62) | 0, 3, 1);
            g.strokeStyle = dark; g.lineWidth = 4;
            g.strokeRect(3, 3, 58, 58);
            g.beginPath(); g.moveTo(5, 5); g.lineTo(59, 59); g.moveTo(59, 5); g.lineTo(5, 59); g.stroke();
        } else {                     // 地面：碎石点 + 浅网格
            base = pal.floor; dark = U.shade(pal.floor, 0.85); lite = U.shade(pal.floor, 0.95);
            g.fillStyle = base; g.fillRect(0, 0, 64, 64);
            g.fillStyle = dark; rnd = lcg(97);
            for (k = 0; k < 60; k++) g.fillRect((rnd() * 62) | 0, (rnd() * 62) | 0, 2, 2);
            g.fillStyle = lite;
            for (k = 0; k < 64; k += 16) { g.fillRect(0, k, 64, 1); g.fillRect(k, 0, 1, 64); }
        }
        return cv;
    }

    function buildPatterns(theme) {
        var t = texCache[theme];
        if (!t || !ctx.createPattern) return;
        for (i = 0; i < 4; i++) activePats[i] = ctx.createPattern(t[i], 'repeat');
    }

    function buildAllThemes() {
        var doc = document.documentElement;
        var cur = doc.dataset.theme || 'light';
        var names = ['light', 'dark'];
        for (i = 0; i < names.length; i++) {
            doc.dataset.theme = names[i];
            texPal[names[i]] = readTexPal();
            texCache[names[i]] = [
                buildTex(0, texPal[names[i]]), buildTex(1, texPal[names[i]]),
                buildTex(2, texPal[names[i]]), buildTex(3, texPal[names[i]])
            ];
        }
        doc.dataset.theme = cur;
        buildPatterns(cur);
    }

    function buildSky() {
        if (!ctx.createLinearGradient) { skyGrad = null; return; }
        skyGrad = ctx.createLinearGradient(0, 0, 0, cssH * 0.55);
        skyGrad.addColorStop(0, U.shade(palette.sky, 0.62));
        skyGrad.addColorStop(0.75, palette.sky);
        skyGrad.addColorStop(1, U.shade(palette.sky, 1.08));
    }

    function refreshPalette() {
        var s = global.getComputedStyle(document.documentElement);
        function v(n) { return s.getPropertyValue(n).trim(); }
        var base = v('--bg-color'), wa = v('--cs-wall-a'), wb = v('--cs-wall-b');
        palette.sky = v('--cs-sky') || base;
        palette.floor = v('--cs-floor') || base;
        palette.grid = v('--cs-grid') || v('--text-color');
        palette.wallEdge = v('--cs-wall-edge') || v('--text-color');
        palette.wallTop = v('--cs-wall-top') || wa || base;
        palette.bot = v('--cs-bot') || v('--primary-color');
        palette.botHead = v('--cs-bot-head') || palette.bot;
        palette.botHit = v('--cs-bot-hit') || v('--danger');
        palette.muzzle = v('--cs-muzzle') || palette.botHead;
        palette.player = v('--cs-player') || v('--primary-color');
        palette.playerHead = v('--cs-player-head') || palette.player;
        /* ADR-59：盒体三档明暗（顶亮/正面原色/侧暗），主题刷新时派生一次，flat 模式同样可见 */
        palette.playerTop = U.shade(palette.player, 1.22);
        palette.playerSide = U.shade(palette.player, 0.70);
        palette.headTop = U.shade(palette.playerHead, 1.18);
        palette.headSide = U.shade(palette.playerHead, 0.72);
        palette.accent = v('--accent') || v('--text-color');
        palette.wallA = U.shade(wa || base, 1);
        palette.wallB = U.shade(wb || wa || base, 1);
        palette.hole = U.shade(palette.wallEdge, 0.5);
        palette.shell = U.shade(palette.accent, 1.25);
        palette.gunBody = v('--cs-gun-body') || palette.player;
        palette.gunDark = v('--cs-gun-dark') || palette.wallEdge;
        /* 中层蓝灰（cs.svg 装备 #3a4654）：介于 gunDark(近黑) 与 gunBody(亮灰蓝) 之间，
         * 供战术装备做三档明暗层次，避免整块压成单一深色。 */
        palette.gunMid = U.shade(palette.gunBody, 0.78);
        palette.gunHi = v('--cs-gun-hi') || 'rgba(255,255,255,0.15)';
        palette.gunLo = v('--cs-gun-lo') || 'rgba(0,0,0,0.22)';
        palette.gunSight = palette.accent;
        for (i = 0; i < 3; i++) {
            palette.wallX[i] = U.shade(wa || base, 0.84 + i * 0.13);
            palette.wallZ[i] = U.shade(wb || wa || base, 0.84 + i * 0.13);
        }
    }

    function resize() {
        if (!stage) return;
        var rect = stage.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;   // 布局未就绪：留待 start/resume/resize 再测
        cssW = Math.max(1, Math.round(rect.width));
        cssH = Math.max(1, Math.round(rect.height));
        var coarse = global.matchMedia && global.matchMedia('(pointer: coarse)').matches;
        renderScale = scaleOverride || ((coarse || cssW < 700) ? 0.8 : 1);
        var ratio = renderScale < 1 ? renderScale : Math.min(global.devicePixelRatio || 1, 2);
        var bw = Math.max(1, Math.round(cssW * ratio));
        var bh = Math.max(1, Math.round(cssH * ratio));
        if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
        ctx.setTransform(bw / cssW, 0, 0, bh / cssH, 0, 0);
        focal = (cssW * 0.5) / Math.tan(C.FOV_DEG * Math.PI / 360);  // 水平 FOV 固定 75°
        buildSky();
    }

    function init(canvasEl, stageEl) {
        canvas = canvasEl; stage = stageEl;
        ctx = canvas.getContext('2d');
        refreshPalette();
        buildAllThemes();
        resize();
        document.addEventListener('themeChanged', function () {
            refreshPalette();
            buildPatterns(document.documentElement.dataset.theme || 'light');
            buildSky();
        });
    }

    /* 切镜只改相机位置与模型显隐：纯 yaw/pitch、射线、FOV 全部共用。
     * kick（后坐上踢）不进相机/射线：所见即所得——每发命中扣扳机瞬间准星所指，
     * 远距离不再上飘、打墙弹孔不再偏高。后坐视觉由 viewmodel 的 vm.recoil 独立承担。 */
    function setCamera(player, viewMode) {
        var pitch = player.pitch;   // 后坐力不进射线：准星所指即弹道所中（ADR-45）
        var yaw = player.yaw;
        var cp = Math.cos(pitch), sp = Math.sin(pitch);
        fX = Math.sin(yaw) * cp; fY = sp; fZ = Math.cos(yaw) * cp;
        rX = Math.cos(yaw); rY = 0; rZ = -Math.sin(yaw);
        uX = -sp * Math.sin(yaw); uY = cp; uZ = -sp * Math.cos(yaw);
        px = player.x; py = player.y + player.eyeCur; pz = player.z;
        lastPitch = pitch; lastView = viewMode;
        playerAlpha = 1; camDist = 0;
        if (viewMode !== 'tps') { camX = px; camY = py; camZ = pz; return; }

        /* 越肩第三人称（v3.18）：相机移到玩家右后上方，角色沉到画面左下，让出中央准星。
         * 关键：hitscan 固定从眼位沿 yaw/pitch 发出（game.js），与本相机完全解耦——
         * 相机朝向只用于投影，故准星在 FOCUS 距离处与真实射线重合，零数值收益改变(ADR-2)。 */
        var sy = Math.sin(yaw), cy = Math.cos(yaw);
        /* ADR-59：盒体深度方向取玩家本体前向（非被聚焦向量覆盖的相机前向） */
        bodyFx = sy; bodyFz = cy;
        var SHOULDER = C.TPS_SHOULDER, BACK = C.TPS_BACK, UP = C.TPS_UP, FOCUS = C.TPS_FOCUS;
        /* 目标相机位 = 眼位 - 前向水平*BACK + 右向*SHOULDER + 上抬*UP */
        var ox = px - sy * BACK + cy * SHOULDER;
        var oz = pz - cy * BACK - sy * SHOULDER;
        var oy = py + UP;
        /* 墙碰撞：从眼位朝目标相机方向投射，防穿墙 */
        var vx = ox - px, vy = oy - py, vz = oz - pz;
        var len = Math.sqrt(vx * vx + vy * vy + vz * vz);
        var dx = vx / len, dy = vy / len, dz = vz / len;
        var hit = W.rayWalls(px, py, pz, dx, dy, dz, len);
        camDist = hit < len ? Math.max(C.TPS_MIN, hit - 0.15) : len;
        camX = px + dx * camDist;
        camY = py + dy * camDist;
        camZ = pz + dz * camDist;
        /* 聚焦点 = 眼位 + 玩家前向(含 pitch)*FOCUS；相机看向它，使屏幕中心准星对准弹道 */
        var gx = px + fX * FOCUS, gy = py + fY * FOCUS, gz = pz + fZ * FOCUS;
        var ax = gx - camX, ay = gy - camY, az = gz - camZ;
        var al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
        fX = ax / al; fY = ay / al; fZ = az / al;
        /* 以新前向重建正交基：right = cross(worldUp, fwd), up = cross(fwd, right) */
        rX = fZ; rY = 0; rZ = -fX;
        var rl = Math.sqrt(rX * rX + rZ * rZ);
        if (rl < 1e-4) { rX = 1; rY = 0; rZ = 0; }
        else { rX /= rl; rZ /= rl; }
        uX = fY * rZ - fZ * rY;
        uY = fZ * rX - fX * rZ;
        uZ = fX * rY - fY * rX;
        playerAlpha = camDist < 1.1 ? 0.38 : 1;
    }

    /* ── Renderer 接口：beginFrame(cam) ── */
    function beginFrame(player, viewMode) {
        setCamera(player, viewMode);
        faceCount = 0;
    }

    /* 准星射线：供 hitscan 复用，保证「屏幕中心所见 = 弹道所中」。
     * TPS 相机位于玩家右后上方并看向 FOCUS 聚焦点，若弹道仍从眼位沿 yaw/pitch 发出，
     * 近距离会有 0.16~0.25m 垂直视差：准星压在头上、弹道却落到脖子甚至打空。
     * 改用相机位 + 相机前向（含当前 pitch，不含后坐 kick）消除视差并做到所见即所得；
     * FPS 下相机=眼位、前向=玩家前向。调用会重算相机（幂等，紧随的 beginFrame 同参复算无副作用）。 */
    function aimRay(player, viewMode) {
        setCamera(player, viewMode);
        return {
            ox: camX, oy: camY, oz: camZ,
            dx: fX, dy: fY, dz: fZ,
            rx: rX, ry: rY, rz: rZ,
            ux: uX, uy: uY, uz: uZ
        };
    }

    function setQ(k, x, y, z) {
        var o = k * 3; q[o] = x; q[o + 1] = y; q[o + 2] = z;
    }

    /* 单平面近裁剪：保留 cz >= NEAR 的半空间，返回输出顶点数 */
    function clipNear(src, n, dst) {
        var m = 0, k, j, o1, o2, ax, ay, az, bx, by, bz, inA, inB, t;
        for (k = 0; k < n; k++) {
            j = (k + 1) % n; o1 = k * 3; o2 = j * 3;
            ax = src[o1]; ay = src[o1 + 1]; az = src[o1 + 2];
            bx = src[o2]; by = src[o2 + 1]; bz = src[o2 + 2];
            inA = az >= C.NEAR; inB = bz >= C.NEAR;
            if (inA) { dst[m * 3] = ax; dst[m * 3 + 1] = ay; dst[m * 3 + 2] = az; m++; }
            if (inA !== inB) {
                t = (C.NEAR - az) / (bz - az);
                dst[m * 3] = ax + (bx - ax) * t;
                dst[m * 3 + 1] = ay + (by - ay) * t;
                dst[m * 3 + 2] = C.NEAR;
                m++;
            }
        }
        return m;
    }

    /* billboard 深度排序的统一参考高度（ADR-55）：与墙中心 WALL_H/2 同高。
     * 竖直 billboard（bot/player 各部件）若各用自身面中心 y 算 depth，低头时 dy·fY
     * 会把头/腿 depth 拉开 0.5m+，墙面 depth 乘隙插入 → 角色被"切碎"（头浮墙前、身埋墙后）。
     * 统一到同一 y 基准后，角色作为整体排序，墙只能整挡或整不挡。 */
    var BILLBOARD_SORT_Y = C.WALL_H * 0.5;

    /* q 中 4 个世界顶点 → 相机空间 → 裁剪 → 投影，写入一个复用的 face */
    function addFace(color, alpha, stroke, tex, shade, cx, cy, cz, sortX, sortY, sortZ) {
        if (faceCount >= MAX_FACES) return;
        var k, o, dx, dy, dz, z, maxZ = -Infinity, minZ = Infinity;
        for (k = 0; k < 4; k++) {
            o = k * 3;
            dx = q[o] - camX; dy = q[o + 1] - camY; dz = q[o + 2] - camZ;
            camIn[o] = dx * rX + dy * rY + dz * rZ;
            camIn[o + 1] = dx * uX + dy * uY + dz * uZ;
            camIn[o + 2] = dx * fX + dy * fY + dz * fZ;
            z = camIn[o + 2];
            if (z > maxZ) maxZ = z;
            if (z < minZ) minZ = z;
        }
        if (maxZ < C.NEAR || minZ > C.FAR) return;
        var n = clipNear(camIn, 4, camOut);
        if (n < 3 || n > MAX_VERTS) return;
        var f = faces[faceCount];
        for (k = 0; k < n; k++) {
            o = k * 3; z = camOut[o + 2];
            f.sx[k] = cssW * 0.5 + focal * camOut[o] / z;
            f.sy[k] = cssH * 0.5 - focal * camOut[o + 1] / z;
        }
        f.n = n; f.color = color; f.alpha = alpha; f.stroke = stroke;
        f.tex = tex; f.shade = shade; f.mark = 0;
        dx = cx - camX; dy = cy - camY; dz = cz - camZ;
        f.dist = dx * dx + dy * dy + dz * dz;
        /* 排序键用相机空间投影深度（沿视线），而非欧氏距离（ADR-40）：
         * 欧氏距离对大面（32m 围墙）失真——斜视时面中心远、边缘近，
         * 面级排序会整面错序，表现为「外墙错误遮挡/被内部墙穿透」。
         * ADR-55：billboard 传入统一 sortY（默认真实 cy），使同一角色各部件 depth 一致，
         * 不被墙从中间切开；sortY 只作用于 depth，dist/fog 仍用真实几何中心。 */
        /* ADR-55：billboard 可用统一代表点(sortX,sortY,sortZ)算 depth——同一角色所有部件
         * 传同一个角色中心，depth 完全相同，墙无法从身体中间插入；dist/fog 仍用真实几何中心。 */
        var sx = (sortX === undefined) ? cx : sortX;
        var sy = (sortY === undefined) ? cy : sortY;
        var sz = (sortZ === undefined) ? cz : sortZ;
        f.depth = (sx - camX) * fX + (sy - camY) * fY + (sz - camZ) * fZ;
        if (mode === 0) {
            var d = Math.sqrt(f.dist);
            var fog = (d - C.FOG_START) / C.FOG_RANGE;
            if (fog < 0) fog = 0; else if (fog > 1) fog = 1;
            f.fog = fog * fog;
        } else f.fog = 0;
        faceCount++;
    }

    /* ── Renderer 接口：submitFace(顶点Float64Array, texId, shade) 零拷贝 ── */
    function submitFace(verts, texId, shade) {
        for (var k = 0; k < 12; k++) q[k] = verts[k];
        var col = texId >= 0 ? palette.wallA : palette.wallEdge;
        addFace(col, 1, true, texId, shade,
            (q[0] + q[3] + q[6] + q[9]) * 0.25,
            (q[1] + q[4] + q[7] + q[10]) * 0.25,
            (q[2] + q[5] + q[8] + q[11]) * 0.25);
    }

    function setAxes(vx, vz, ox, oz) {
        var dx = vx - ox, dz = vz - oz;
        var l = Math.sqrt(dx * dx + dz * dz);
        if (l < 1e-4) { axX = 1; axZ = 0; return; }
        dx /= l; dz /= l;
        axX = -dz; axZ = dx;
    }

    /* ── Renderer 接口：drawBillboard ── */
    function drawBillboard(ox, oz, y0, y1, halfW, color, alpha, stroke, sortX, sortZ) {
        setQ(0, ox - axX * halfW, y0, oz - axZ * halfW);
        setQ(1, ox + axX * halfW, y0, oz + axZ * halfW);
        setQ(2, ox + axX * halfW, y1, oz + axZ * halfW);
        setQ(3, ox - axX * halfW, y1, oz - axZ * halfW);
        /* ADR-55：排序代表点默认 (ox,统一高度,oz)，可传入角色中心覆盖使全身共 depth。 */
        addFace(color, alpha, stroke, -1, 1, ox, (y0 + y1) * 0.5, oz,
            sortX, BILLBOARD_SORT_Y, sortZ);
    }

    /* ADR-59：立体盒体 = 正对相机的主面（几何与 drawBillboard 完全一致，细节贴片零错位）
     * + 顶面 + 右侧面。深度沿玩家本体前向 bodyF 延伸——TPS 相机恒在玩家后右上方，
     * 所以顶/右侧面恒可见、无需逐帧背面剔除（相机跟随 yaw，相对方位不变）。
     * 三面用派生明暗色（顶亮/主原色/侧暗），shade 恒 1，故 flat 降级模式同样有立体感。
     * 三面共用同一 sort 点（角色中心），depth 相同 → 墙不会从身体中间插入（ADR-55）。 */
    function drawBox(ox, oz, y0, y1, halfW, depth, colMain, colTop, colSide,
                     alpha, stroke, sortX, sortZ, mark, shift) {
        var xl = ox - axX * halfW, zl = oz - axZ * halfW;
        var xr = ox + axX * halfW, zr = oz + axZ * halfW;
        var dx = bodyFx * depth, dz = bodyFz * depth;
        /* ADR-60 屈膝：顶边沿玩家前向偏移 shift（底边不动），主面成倾斜平行四边形，
         * 蹲姿下膝盖前顶的意象；shift=0 时与旧实现逐位一致。sort 点仍取角色中心(ADR-55)。 */
        var sx = shift ? bodyFx * shift : 0, sz = shift ? bodyFz * shift : 0;
        /* 顶面：主面顶边(含 shift)向玩家前向延伸 depth（相机在上方，可见） */
        setQ(0, xl + sx, y1, zl + sz); setQ(1, xr + sx, y1, zr + sz);
        setQ(2, xr + dx + sx, y1, zr + dz + sz); setQ(3, xl + dx + sx, y1, zl + dz + sz);
        addFace(colTop, alpha, false, -1, 1, ox, y1, oz, sortX, BILLBOARD_SORT_Y, sortZ);
        /* 右侧面：底边不动，顶边含 shift */
        setQ(0, xr, y0, zr); setQ(1, xr + dx, y0, zr + dz);
        setQ(2, xr + dx + sx, y1, zr + dz + sz); setQ(3, xr + sx, y1, zr + sz);
        addFace(colSide, alpha, false, -1, 1, ox, (y0 + y1) * 0.5, oz, sortX, BILLBOARD_SORT_Y, sortZ);
        /* 主面：底边不动，顶边含 shift，最后提交（画家算法后画覆盖） */
        setQ(0, xl, y0, zl); setQ(1, xr, y0, zr);
        setQ(2, xr + sx, y1, zr + sz); setQ(3, xl + sx, y1, zl + sz);
        var f0 = faceCount;
        addFace(colMain, alpha, stroke, -1, 1, ox, (y0 + y1) * 0.5, oz, sortX, BILLBOARD_SORT_Y, sortZ);
        if (mark && faceCount > f0) faces[faceCount - 1].mark = mark;
    }

    /* ADR-60 蹲姿几何映射（v2 返工：修正"整体压扁"观感）：把站立坐标 y 按 ct∈[0,1] 分段映射。
     * 关键：真人蹲下是「重心降低 + 腿折叠」，头/躯干本身不该被等比例压扁。
     * 锚点（站立→蹲下）：脚底 0.10→0.10（踩地不动）、髋 0.70→0.35（重心大降、腿折叠到 42%）、
     * 肩 1.50→0.95（躯干保留 0.60，仅压缩 25% 而非旧版 59%）、头顶 1.65→1.10。
     * 头部高度恒 0.15 不变（drawFaceMark 零变形）；ct=0 原样返回（站立逐位兼容 #11）。
     * ct 取自插值中的 eyeCur，与相机 py 同源，腿与视角同步平滑过渡，零新增状态/面。 */
    function bodyY(y, ct) {
        if (ct <= 0) return y;
        var hy = 0.70 - 0.35 * ct, sy = 1.50 - 0.55 * ct, ty = 1.65 - 0.55 * ct;
        if (y <= 0.70) return 0.10 + (y - 0.10) / 0.60 * (hy - 0.10);
        if (y <= 1.50) return hy + (y - 0.70) / 0.80 * (sy - hy);
        return sy + (y - 1.50) / 0.15 * (ty - sy);
    }

    /* 东西向墙面（固定 x，长轴 z）：长面沿 z 分段，每段独立参与深度排序（ADR-40）。
     * a0→a1 保持与旧单面版相同的绕序（Q0 底-a / Q1 顶-a / Q2 顶-b / Q3 底-b），纹理插值方向不变。 */
    /* #12：h 为该盒高度（外围墙 WALL_H / 内部矮掩体 COVER_H）；默认 WALL_H 兼容其它调用。 */
    function addXFace(x, a0, a1, col, alpha, tex, shade, h) {
        h = h || C.WALL_H;
        var segs = Math.ceil(Math.abs(a1 - a0) / 6) || 1, j, u0, u1, mid;
        for (j = 0; j < segs; j++) {
            u0 = a0 + (a1 - a0) * j / segs; u1 = a0 + (a1 - a0) * (j + 1) / segs;
            setQ(0, x, 0, u0); setQ(1, x, h, u0);
            setQ(2, x, h, u1); setQ(3, x, 0, u1);
            mid = (u0 + u1) * 0.5;
            addFace(col, alpha, true, tex, shade, x, h * 0.5, mid);
        }
    }

    /* 南北向墙面（固定 z，长轴 x） */
    function addZFace(z, a0, a1, col, alpha, tex, shade, h) {
        h = h || C.WALL_H;
        var segs = Math.ceil(Math.abs(a1 - a0) / 6) || 1, j, u0, u1, mid;
        for (j = 0; j < segs; j++) {
            u0 = a0 + (a1 - a0) * j / segs; u1 = a0 + (a1 - a0) * (j + 1) / segs;
            setQ(0, u0, 0, z); setQ(1, u0, h, z);
            setQ(2, u1, h, z); setQ(3, u1, 0, z);
            mid = (u0 + u1) * 0.5;
            addFace(col, alpha, true, tex, shade, mid, h * 0.5, z);
        }
    }

    function genWalls() {
        var boxes = W.boxes, k, b, t, colX, colZ;
        while (boxCount < boxes.length) { boxTex[boxCount] = boxCount < 4 ? 0 : (boxCount % 2 ? 2 : 1); boxCount++; }
        for (k = 0; k < boxes.length; k++) {
            b = boxes[k];
            t = mode === 0 ? boxTex[k] : -1;
            colX = mode === 0 ? palette.wallA : palette.wallX[k % 3];
            colZ = mode === 0 ? palette.wallB : palette.wallZ[k % 3];
            /* 内部墙最长边 4m（segs=1 与旧单面版逐位一致）；围墙 30-32m 分 6 段修正深度跨序。
             * #12：每盒用自身高度 b.h——矮掩体(1.30)画矮，顶面在其高度可见。 */
            if (camX > b.maxX) addXFace(b.maxX, b.minZ, b.maxZ, colX, 1, t, mode === 0 ? shadeO[0] : 1, b.h);
            if (camX < b.minX) addXFace(b.minX, b.maxZ, b.minZ, colX, 1, t, mode === 0 ? shadeO[1] : 1, b.h);
            if (camZ > b.maxZ) addZFace(b.maxZ, b.minX, b.maxX, colZ, 1, t, mode === 0 ? shadeO[4] : 1, b.h);
            if (camZ < b.minZ) addZFace(b.minZ, b.maxX, b.minX, colZ, 1, t, mode === 0 ? shadeO[5] : 1, b.h);
            if (camY > b.h) {
                setQ(0, b.minX, b.h, b.minZ); setQ(1, b.minX, b.h, b.maxZ);
                setQ(2, b.maxX, b.h, b.maxZ); setQ(3, b.maxX, b.h, b.minZ);
                addFace(palette.wallTop, 1, true, t, mode === 0 ? shadeO[2] : 1,
                    (b.minX + b.maxX) * 0.5, b.h, (b.minZ + b.maxZ) * 0.5);
            }
        }
    }

    /* 头部细节：纯 ctx 绘制、不占面池，由 drawFaces* 在画完该面后立刻调用（近处物体自然遮挡）。
     * 屏幕坐标 y 向下；billboard 角点 Q0/Q1=世界 y0（底）、Q2/Q3=y1（顶），
     * 投影后 sy[0]/sy[1] 是面的屏幕底（值大）、sy[2]/sy[3] 是面的屏幕顶（值小）。
     * 因此一切"自顶向下 x%"的定位必须从 sy[3] 起、向 y 增大方向加。
     * mark=1 敌人：正脸眼+鼻+嘴（敌人始终面向玩家，看到的是脸）——头面中下部。
     * mark=2 玩家 TPS：越肩从背后跟随，看不到脸——头顶盔带 + 后脑勺横带，强化"背影"读感。 */
    /* 像素风圆角矩形：用 arcTo 画小半径圆角（cs.svg 镜片 rx=2 / 呼吸器 rx=2）。
     * 2D 上下文通用，半径超过半宽/半高时自动收敛，保证小尺寸下仍是矩形不塌。 */
    function fillRoundRect(x, y, w, h, r) {
        if (w <= 0 || h <= 0) return;
        r = Math.min(r, w * 0.5, h * 0.5);
        if (r < 0.5) { ctx.fillRect(x, y, w, h); return; }
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.fill();
    }

    function drawFaceMark(f) {
        if (f.n !== 4) return;                       // 被近裁剪切过的面不做插值
        var lx = f.sx[0] + (f.sx[3] - f.sx[0]) * 0.58;
        var rx = f.sx[1] + (f.sx[2] - f.sx[1]) * 0.58;
        var span = rx - lx;
        var hh = f.sy[3] - f.sy[0];                  // 面高（负值：sy3 顶、sy0 底）
        var top = f.sy[3];
        var ah = Math.abs(hh);
        if (f.mark === 2) {
            /* 后脑勺（ADR-48）：从面顶向下用深色覆盖上半作为短发/头盔，浅色只在下半露出
             * （像后颈/耳上皮肤）；再用一条顶部头盔沿强调"这是后脑不是脸"。lastMark 几何不变供 QA。 */
            ctx.fillStyle = palette.gunDark;
            var bandY = top + Math.abs(hh) * 0.22;
            /* 头发/头盔：覆盖面顶到 0.55 高，两侧和顶部包住，下方留浅色后颈 */
            ctx.fillRect(lx, top, span, Math.abs(hh) * 0.55);
            var napeY = top + Math.abs(hh) * 0.62;
            ctx.fillRect(lx + span * 0.10, napeY, span * 0.80, Math.max(1, Math.abs(hh) * 0.08));
            lastMark.mark = 2; lastMark.top = top; lastMark.bottom = f.sy[0]; lastMark.y = bandY; lastMark.y2 = napeY; lastMark.y3 = napeY;
        } else if (f.mark === 3) {
            /* 敌人战术背心（改造清单 #1 返工，对照 cs.svg 躯干）：橙色主体上收窄背心，
             * 两侧留橙边；顶部亮条 + 右侧暗条还原立方体明暗；中缝亮条 + 双弹匣袋。
             * 纯 ctx 不占面池，不写 lastMark（爆头锚点只由头面 mark=1 维护）。 */
            var vestTop = top + ah * 0.10, vestH = ah * 0.84;
            /* 躯干顶面亮条（cs.svg #c2620c）与右侧暗条（#8a3f08）——仍是橙色系 */
            ctx.fillStyle = U.shade(palette.bot, 1.18);
            ctx.fillRect(lx, top, span, Math.max(2, ah * 0.10));
            ctx.fillStyle = U.shade(palette.bot, 0.82);
            ctx.fillRect(rx - span * 0.12, top + ah * 0.10, span * 0.12, vestH);
            /* 背心主体居中（cs.svg #3a4654 中层），两侧各留 14% 橙边（36/52 宽） */
            var vx = lx + span * 0.14, vw = span * 0.72;
            ctx.fillStyle = palette.gunMid;
            ctx.fillRect(vx, vestTop, vw, vestH);
            /* 中缝亮竖条（cs.svg #55677a），纵贯背心 */
            ctx.fillStyle = palette.gunBody;
            ctx.fillRect(vx + vw * 0.46, vestTop + vestH * 0.06, Math.max(2, vw * 0.08), vestH * 0.82);
            /* 双弹匣袋（cs.svg #2a3545 近黑底 + #55677a 袋盖） */
            var pw = vw * 0.28, ph = vestH * 0.24, py = vestTop + vestH * 0.34;
            ctx.fillStyle = palette.gunDark;
            ctx.fillRect(vx + vw * 0.08, py, pw, ph);
            ctx.fillRect(vx + vw * 0.64, py, pw, ph);
            ctx.fillStyle = palette.gunBody;
            var capH = Math.max(1, ph * 0.16);
            ctx.fillRect(vx + vw * 0.08, py, pw, capH);
            ctx.fillRect(vx + vw * 0.64, py, pw, capH);
        } else if (f.mark === 4 || f.mark === 5) {
            /* 作战靴（mark=4，腿）/ 战术手套（mark=5，臂）：对照 cs.svg 深色末端。
             * 只覆盖 billboard 底部一段，纯 ctx 不占面池，不写 lastMark。 */
            ctx.fillStyle = palette.gunDark;
            var endH = f.mark === 4 ? 0.20 : 0.18;
            ctx.fillRect(lx, top + ah * (1 - endH), span, ah * endH + 1);
        } else if (f.mark === 6) {
            /* 横向步枪（改造清单 #1 返工，对照 cs.svg 双手横持、枪口朝左）：
             * 枪身本体由宽而扁的 billboard 填 gunDark；此处用其屏幕外接框补
             * 上沿高光、左端枪口、中部握把/弹匣、瞄具、双手战术手套。
             * 纯 ctx 不占面池，不写 lastMark。 */
            var gx0 = Math.min(f.sx[0], f.sx[3]), gx1 = Math.max(f.sx[1], f.sx[2]);
            var gyT = Math.min(f.sy[2], f.sy[3]), gyB = Math.max(f.sy[0], f.sy[1]);
            var gw = gx1 - gx0, gh = gyB - gyT;
            if (gw < 3 || gh < 1) return;
            /* 上沿高光条（cs.svg #3a4654 描边）+ 下沿暗边，给扁平枪身一点体积 */
            ctx.fillStyle = palette.gunMid;
            ctx.fillRect(gx0, gyT, gw, Math.max(1, gh * 0.22));
            /* 左端枪口消焰器：枪口朝左，突出一小段（比枪身亮一档） */
            ctx.fillStyle = palette.gunBody;
            ctx.fillRect(gx0 - gw * 0.05, gyT + gh * 0.18, gw * 0.09, gh * 0.50);
            /* 中部握把 + 弹匣，向下伸出（cs.svg #121a26，用半透明黑压深） */
            ctx.fillStyle = palette.gunLo;
            ctx.fillRect(gx0 + gw * 0.40, gyB - gh * 0.1, gw * 0.11, gh * 1.15);
            ctx.fillRect(gx0 + gw * 0.60, gyB - gh * 0.1, gw * 0.08, gh * 0.95);
            /* 瞄具：枪身上方中间小突起 */
            ctx.fillStyle = palette.gunMid;
            ctx.fillRect(gx0 + gw * 0.45, gyT - gh * 0.30, gw * 0.11, gh * 0.32);
            /* 双手战术手套：握在握把处（近黑），盖住握把上端形成握持感 */
            ctx.fillStyle = palette.gunDark;
            ctx.fillRect(gx0 + gw * 0.37, gyT + gh * 0.30, gw * 0.13, gh * 0.62);
            ctx.fillRect(gx0 + gw * 0.57, gyT + gh * 0.32, gw * 0.12, gh * 0.58);
        } else {
            /* 敌人正脸：严格按 cs.svg 头部比例重画（改造清单 #1 三次返工）。
             * 基准：头盔顶 y116 → 头底 y178 = 62px（记 ah）；头面 x139~181 = 42px（记 span）。
             * 各层位置全部来自图标坐标换算，不再凭感觉估；lastMark 三锚点仍需落在 [top,bottom] 内。 */
            var nx = lx + span * 0.5;

            /* ① 战术头盔：盔体占 0~0.484（y116~146），顶亮沿仅 0~0.081（y116~121），
             * 外突帽檐 0.387~0.5（y140~147，左右各外扩 7/42=0.167span）。以前顶沿过厚、盔体偏矮。 */
            ctx.fillStyle = palette.gunMid;
            ctx.fillRect(lx, top, span, ah * 0.484);
            ctx.fillStyle = palette.gunBody;
            ctx.fillRect(lx, top, span, Math.max(1, ah * 0.081));
            var brimOver = span * 0.167;
            ctx.fillStyle = palette.gunDark;
            ctx.fillRect(lx - brimOver, top + ah * 0.387, span + brimOver * 2, Math.max(2, ah * 0.113));

            /* ② 护目镜：深色镜带 0.468~0.71（y145~160，左右各外扩 2/42=0.048span），
             * 两片圆角青蓝镜片 0.5~0.677（y147~158，宽 15/42=0.357span）——图标是 rx=2 圆角，
             * 以前画成直角小方块；高光沿镜片左上（y148~151）。 */
            var bandOver = span * 0.048;
            ctx.fillStyle = palette.gunDark;
            ctx.fillRect(lx - bandOver, top + ah * 0.468, span + bandOver * 2, ah * 0.242);
            var ew = span * 0.357, eh = ah * 0.177;
            if (ew < 1) ew = 1;
            if (eh < 1) eh = 1;
            var er = Math.min(ew, eh) * 0.16;
            var eyeY = top + ah * 0.5;
            var eyeL = lx + span * 0.071, eyeR = lx + span * 0.571;
            ctx.fillStyle = palette.playerHead;
            fillRoundRect(eyeL, eyeY, ew, eh, er);
            fillRoundRect(eyeR, eyeY, ew, eh, er);
            ctx.fillStyle = palette.gunHi;
            ctx.fillRect(eyeL + ew * 0.05, eyeY + eh * 0.09, ew * 0.40, Math.max(1, eh * 0.27));
            ctx.fillRect(eyeR + ew * 0.05, eyeY + eh * 0.09, ew * 0.40, Math.max(1, eh * 0.27));

            /* ③ 战术面罩：中层底 0.71~1.0（y160~178）占满头面宽（图标 x139~181 齐宽，
             * 以前只占 0.72 留空导致脸不对）；近黑呼吸器 0.79~0.952（y165~175，宽 22/42=0.524span，rx=2）；
             * 3 道亮灰蓝格栅 0.823~0.919（y167~173，间距 6/42=0.143span，stroke 1.5/42=0.036span）。 */
            ctx.fillStyle = palette.gunMid;
            ctx.fillRect(lx, top + ah * 0.71, span, ah * 0.29);
            var bw = span * 0.524, bh = ah * 0.162;
            ctx.fillStyle = palette.gunDark;
            fillRoundRect(nx - bw * 0.5, top + ah * 0.79, bw, bh, Math.min(bw, bh) * 0.18);
            ctx.fillStyle = palette.gunBody;
            var gw = Math.max(1, span * 0.036), gy = top + ah * 0.823, gh = ah * 0.096;
            for (var gi = -1; gi <= 1; gi++) {
                ctx.fillRect(nx + gi * span * 0.143 - gw * 0.5, gy, gw, gh);
            }

            /* lastMark：眼/鼻/嘴锚点（落在头面内即可，爆头所见即所得不变） */
            var ey = top + ah * 0.588;   // 眼（镜片中心）
            var ny = top + ah * 0.75;    // 鼻（面罩上部）
            var my = top + ah * 0.87;    // 嘴（呼吸器区）
            lastMark.mark = 1; lastMark.top = top; lastMark.bottom = f.sy[0]; lastMark.y = ey; lastMark.y2 = ny; lastMark.y3 = my;
        }
    }

    /* MC 分块敌人：6 面（双腿+躯干+双臂+头）+ 1 面横向步枪 + 开火时 1 面枪口火光。
     * 所有部件落在 hitscan 公告板盒内（|u|≤0.32, y∈[0.10,1.85]）；视觉与判定彻底解耦。 */
    function genBots(bots) {
        var k, b, f0, torsoDist;
        for (k = 0; k < bots.length; k++) {
            b = bots[k];
            if (!b.alive) continue;
            setAxes(camX, camZ, b.x, b.z);
            var col = b.hitFlash > 0 ? palette.botHit : palette.bot;
            /* 躯干半宽 0.24（小于判定 0.32）让双臂露出轮廓；腿/臂全部仍在判定盒内 */
            f0 = faceCount;
            drawBillboard(b.x - axX * 0.12, b.z - axZ * 0.12, C.BOT_Y0, 0.70, 0.11, col, 1, true, b.x, b.z);
            if (faceCount > f0) faces[faceCount - 1].mark = 4;   /* 作战靴（mark=4，腿部末端） */
            f0 = faceCount;
            drawBillboard(b.x + axX * 0.12, b.z + axZ * 0.12, C.BOT_Y0, 0.70, 0.11, col, 1, true, b.x, b.z);
            if (faceCount > f0) faces[faceCount - 1].mark = 4;
            f0 = faceCount;
            drawBillboard(b.x, b.z, 0.70, C.BOT_SPLIT, 0.24, col, 1, true, b.x, b.z);
            torsoDist = faceCount > f0 ? faces[faceCount - 1].depth : 0;
            if (faceCount > f0) faces[faceCount - 1].mark = 3;   /* 战术背心（mark=3 纯 ctx 绘制，不占面池） */
            f0 = faceCount;
            drawBillboard(b.x - axX * 0.25, b.z - axZ * 0.25, 0.78, 1.42, 0.07, col, 1, true, b.x, b.z);
            if (faceCount > f0) faces[faceCount - 1].mark = 5;   /* 战术手套（mark=5，手臂末端） */
            f0 = faceCount;
            drawBillboard(b.x + axX * 0.25, b.z + axZ * 0.25, 0.78, 1.42, 0.07, col, 1, true, b.x, b.z);
            if (faceCount > f0) faces[faceCount - 1].mark = 5;
            f0 = faceCount;
            drawBillboard(b.x, b.z, C.BOT_SPLIT, C.BOT_Y1, C.BOT_HEAD_HALF_W, palette.botHead, 1, true, b.x, b.z);
            if (faceCount > f0) faces[faceCount - 1].mark = 1;
            /* 横向步枪（改造清单 #1 返工，对照 cs.svg 双手横持、枪口朝左）：
             * 宽而扁的 billboard 横贯胸前（宽约躯干 1.4 倍），本体填近黑枪身，
             * mark=6 补枪口/握把/瞄具/双手。depth 压在躯干/背心之前（仅画家算法顺序）。 */
            f0 = faceCount;
            drawBillboard(b.x, b.z, 1.06, 1.15, 0.32, palette.gunDark, 1, false, b.x, b.z);
            if (faceCount > f0) {
                faces[faceCount - 1].mark = 6;
                if (torsoDist > 0) faces[faceCount - 1].depth = torsoDist - 0.02;
            }
            if (b.flash > 0) {
                /* 火光在左端枪口（-axX 为屏幕左），与枪身齐高 */
                f0 = faceCount;
                drawBillboard(b.x - axX * 0.37, b.z - axZ * 0.37,
                    1.03, 1.16, 0.08, palette.muzzle, 1, false, b.x, b.z);
                if (faceCount > f0 && torsoDist > 0) faces[faceCount - 1].depth = torsoDist - 0.04;
            }
        }
    }

    /* TPS 玩家背影模型（ADR-48）：MC 分块 + 战术背心/背包 + 肩带 + 竖条枪。
     * 相机在右肩后上方，看到的是背影：深色背心压在躯干正面之下(y 段略窄)，
     * 背包外凸于躯干右后，两条肩带纵贯背部——让"从身后看"一眼可辨，而非纯色贴片靶子。
     * 全部 billboard 贴世界坐标参与深度排序；面池 +11（旧 +7）。y 跟随跳跃。
     * 腿部步态（ADR-58）：相位由 endFrame 按移动距离推进，两腿沿玩家前向反相摆动、
     * 前摆腿抬脚，髋部不动；空中收腿。纯 billboard 位移，零新增面、不改任何判定。 */
    function genPlayer(game) {
        var player = game.player;
        setAxes(camX, camZ, player.x, player.z);
        var yb = player.y, f0;
        /* ADR-60 蹲伏系数：直接取插值中的 eyeCur（1.60↔1.05），与相机 py 同源，
         * 故腿与视角同步平滑过渡、过渡期反向输入排队的既有逻辑完全不动。 */
        var ct = (C.EYE_STAND - player.eyeCur) / (C.EYE_STAND - C.EYE_CROUCH);
        if (ct < 0) ct = 0; else if (ct > 1) ct = 1;
        /* 步态：摆幅随速度（走=满档、蹲/瞄=小档、疾跑稍大），与脚步声节奏同源 */
        var fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);   // 玩家真实前向（与 applyMove 一致）
        var amp = Math.min(game.moveSpeed / C.WALK, 1.15), legL = 0, legR = 0, liftL = 0, liftR = 0, tuck = 0, hip = 0.70;
        if (!player.onGround) {
            tuck = 0.22; hip = 0.62;                       // 空中收腿：脚底抬起、膝部略收
        } else if (amp > 0.03) {
            var s = Math.sin(gaitPhase);
            legL = 0.24 * amp * s; legR = -legL;            // 前后反相摆动（世界前向偏移）
            liftL = Math.max(0, s) * 0.14 * amp;            // 前摆腿抬脚，髋部 y1 保持
            liftR = Math.max(0, -s) * 0.14 * amp;
        }
        /* ADR-60 v2 蹲姿：站距加宽（±0.12→±0.16）+ 膝盖前顶加大（0.16→0.24），
         * 配合更低的髋（0.35）形成"重心下沉、双腿撑开"的蹲姿，而非整体压扁。
         * 顶边沿前向偏移使主面成斜平行四边形（屈膝意象）；仅腿用 shift，躯干不弯。 */
        var kneeShift = ct * 0.24, spread = 0.12 + ct * 0.04;
        /* 腿（ADR-59 盒体 + ADR-60 蹲姿：y 经 bodyY 折叠映射，顶边前移模拟屈膝） */
        drawBox(player.x - axX * spread + fx * legL, player.z - axZ * spread + fz * legL,
            yb + bodyY(0.10 + liftL + tuck, ct), yb + bodyY(hip, ct), 0.10, 0.11,
            palette.player, palette.playerTop, palette.playerSide, playerAlpha, true, player.x, player.z, 0, kneeShift);
        drawBox(player.x + axX * spread + fx * legR, player.z + axZ * spread + fz * legR,
            yb + bodyY(0.10 + liftR + tuck, ct), yb + bodyY(hip, ct), 0.10, 0.11,
            palette.player, palette.playerTop, palette.playerSide, playerAlpha, true, player.x, player.z, 0, kneeShift);
        /* 躯干（盒体，着 player 主色） */
        drawBox(player.x, player.z, yb + bodyY(0.70, ct), yb + bodyY(1.50, ct), 0.20, 0.15,
            palette.player, palette.playerTop, palette.playerSide, playerAlpha, true, player.x, player.z, 0);
        /* 战术背心：深一档，覆盖躯干中上段；背包：外凸右后、再深一档 */
        drawBillboard(player.x, player.z, yb + bodyY(0.92, ct), yb + bodyY(1.44, ct), 0.21, palette.gunDark, playerAlpha, true, player.x, player.z);
        drawBillboard(player.x + axX * 0.13, player.z + axZ * 0.13, yb + bodyY(1.02, ct), yb + bodyY(1.40, ct), 0.12, palette.gunBody, playerAlpha, true, player.x, player.z);
        /* 两条肩带（浅色纵条）：从肩到腰，强化"背对"读感 */
        drawBillboard(player.x - axX * 0.11, player.z - axZ * 0.11, yb + bodyY(0.96, ct), yb + bodyY(1.40, ct), 0.028, palette.playerHead, playerAlpha, false, player.x, player.z);
        drawBillboard(player.x + axX * 0.11, player.z + axZ * 0.11, yb + bodyY(0.96, ct), yb + bodyY(1.40, ct), 0.028, palette.playerHead, playerAlpha, false, player.x, player.z);
        /* 手臂 */
        drawBillboard(player.x - axX * 0.22, player.z - axZ * 0.22, yb + bodyY(0.78, ct), yb + bodyY(1.42, ct), 0.07, palette.player, playerAlpha, true, player.x, player.z);
        drawBillboard(player.x + axX * 0.22, player.z + axZ * 0.22, yb + bodyY(0.78, ct), yb + bodyY(1.42, ct), 0.07, palette.player, playerAlpha, true, player.x, player.z);
        /* 头（盒体；后脑勺 mark=2 由 drawBox 挂在主面上，头盔带 + 发带暗示后方视角） */
        drawBox(player.x, player.z, yb + bodyY(1.50, ct), yb + bodyY(1.65, ct), 0.16, 0.14,
            palette.playerHead, palette.headTop, palette.headSide, playerAlpha, true, player.x, player.z, 2);
        /* 竖条枪：右手持，斜前指 */
        drawBillboard(player.x + axX * 0.34, player.z + axZ * 0.34,
            yb + bodyY(0.55, ct), yb + bodyY(1.30, ct), 0.05, palette.gunBody, playerAlpha, false, player.x, player.z);
    }

    function addLine(x0, z0, x1, z1) {
        var dx0 = x0 - camX, dy0 = 0 - camY, dz0 = z0 - camZ;
        var dx1 = x1 - camX, dy1 = 0 - camY, dz1 = z1 - camZ;
        lineIn[0] = dx0 * rX + dy0 * rY + dz0 * rZ;
        lineIn[1] = dx0 * uX + dy0 * uY + dz0 * uZ;
        lineIn[2] = dx0 * fX + dy0 * fY + dz0 * fZ;
        lineIn[3] = dx1 * rX + dy1 * rY + dz1 * rZ;
        lineIn[4] = dx1 * uX + dy1 * uY + dz1 * uZ;
        lineIn[5] = dx1 * fX + dy1 * fY + dz1 * fZ;
        if (lineIn[2] < C.NEAR && lineIn[5] < C.NEAR) return;
        var n = clipNear(lineIn, 2, lineOut);
        if (n < 2) return;
        var z0 = lineOut[2], z1 = lineOut[5];
        ctx.moveTo(cssW * 0.5 + focal * lineOut[0] / z0, cssH * 0.5 - focal * lineOut[1] / z0);
        ctx.lineTo(cssW * 0.5 + focal * lineOut[3] / z1, cssH * 0.5 - focal * lineOut[4] / z1);
    }

    function drawGrid(alpha) {
        ctx.strokeStyle = palette.grid;
        ctx.lineWidth = 1;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (i = -12; i <= 12; i += 4) {
            addLine(i, 0, -14, i, 0, 14);
            addLine(-14, 0, i, 14, 0, i);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    function drawSkyFloor() {
        var hy = cssH * 0.5 + focal * Math.tan(lastPitch);
        if (hy < 0) hy = 0;
        if (hy > cssH) hy = cssH;
        if (mode === 0 && skyGrad) {
            ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, cssW, hy);
            if (activePats[3]) { ctx.fillStyle = activePats[3]; ctx.fillRect(0, hy, cssW, cssH - hy); }
            else { ctx.fillStyle = palette.floor; ctx.fillRect(0, hy, cssW, cssH - hy); }
            drawGrid(0.18);
        } else {
            ctx.fillStyle = palette.sky; ctx.fillRect(0, 0, cssW, hy);
            ctx.fillStyle = palette.floor; ctx.fillRect(0, hy, cssW, cssH - hy);
            drawGrid(0.35);
        }
        return hy;
    }

    function projectPoint(x, y, z, out) {
        var dx = x - camX, dy = y - camY, dz = z - camZ;
        var cz = dx * fX + dy * fY + dz * fZ;
        if (cz < C.NEAR) { out.ok = false; return out; }
        out.sx = cssW * 0.5 + focal * (dx * rX + dy * rY + dz * rZ) / cz;
        out.sy = cssH * 0.5 - focal * (dx * uX + dy * uY + dz * uZ) / cz;
        out.ok = true;
        return out;
    }

    function drawFloats(dt) {
        ctx.font = 'bold 18px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = palette.accent;
        for (i = 0; i < floats.length; i++) {
            var fl = floats[i];
            if (fl.life <= 0) continue;
            fl.life -= dt;
            if (fl.life <= 0) continue;
            projectPoint(fl.x, fl.y + (C.FLOAT_LIFE - fl.life) * 1.1, fl.z, proj);
            if (!proj.ok) continue;
            ctx.globalAlpha = fl.life / C.FLOAT_LIFE;
            ctx.fillText('+100', proj.sx, proj.sy);
        }
        ctx.globalAlpha = 1;
    }

    /* #9 击杀倒地消散：纯 ctx 绘制（不进面池、不改命中）。方块从站立中段高度向地面倒下，
     * 同时横向压扁+淡出，形成「倒地消散」意象；life 走完即回收。零对象分配（槽位预分配）。 */
    function drawDeaths(dt) {
        for (i = 0; i < deaths.length; i++) {
            var d = deaths[i];
            if (d.life <= 0) continue;
            d.life -= dt;
            if (d.life <= 0) continue;
            var t = 1 - d.life / d.max;             // 0 刚死 → 1 消散完
            var bodyY = C.BOT_Y1 * (1 - t) * 0.55 + 0.10;   // 中心高度：约 1.02→0.10（倒地）
            projectPoint(d.x, bodyY, d.z, proj);
            if (!proj.ok) continue;
            var halfW = C.BOT_HALF_W * (1 - t * 0.5);        // 横向压扁
            ctx.globalAlpha = (1 - t) * 0.75;
            ctx.fillStyle = palette.botHit;
            /* 存中心，再用同一高度 x±halfW 两点投影求屏幕宽（随距离/相机正确缩放） */
            var ccx = proj.sx, ccy = proj.sy;
            projectPoint(d.x - halfW, bodyY, d.z, proj);
            var lx = proj.ok ? proj.sx : ccx - 8;
            projectPoint(d.x + halfW, bodyY, d.z, proj);
            var rx = proj.ok ? proj.sx : ccx + 8;
            var w = Math.max(2, rx - lx);
            var h = Math.max(2, w * 0.45 * (1 - t * 0.6));  // 倒下后变扁
            ctx.fillRect(ccx - w * 0.5, ccy - h * 0.5, w, h);
        }
        ctx.globalAlpha = 1;
    }

    /* ── 特效池：弹孔 32 FIFO / 粒子 64 / 弹壳 8 / 火光 1（全预分配，逐帧零分配）── */
    var holes = [], parts = [], shells = [], hi;
    for (i = 0; i < C.HOLE_MAX; i++) holes.push({ on: false, x: 0, y: 0, z: 0, ax: 0, sg: 1 });
    for (i = 0; i < C.PARTICLE_MAX; i++) parts.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, lifeMax: 1, kind: 0 });
    for (i = 0; i < C.SHELL_MAX; i++) shells.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0 });
    var holeIdx = 0, partIdx = 0, shellIdx = 0;
    var vm = { phase: 0, lagX: 0, lagY: 0, recoil: 0, muzzleT: 0, aim: 0, aimGeom: 0 };
    var lagT = new Float64Array(4), lagDX = new Float64Array(4), lagDY = new Float64Array(4), lagI = 0;

    function addBulletHole(x, y, z, axis, sign) {
        var h = holes[holeIdx];
        h.on = true; h.x = x; h.y = y; h.z = z;
        h.ax = axis === 1 ? 2 : axis; h.sg = sign || 1;
        holeIdx = (holeIdx + 1) % C.HOLE_MAX;
    }

    function spawnParticles(x, y, z, nx, ny, nz, n, kind) {
        for (var j = 0; j < n; j++) {
            var p = parts[partIdx];
            partIdx = (partIdx + 1) % C.PARTICLE_MAX;
            p.x = x; p.y = y; p.z = z;
            var r1 = Math.random() * 2 - 1, r2 = Math.random() * 2 - 1, r3 = Math.random() * 2 - 1;
            var sp = 1.2 + Math.random() * 1.8;
            p.vx = nx * sp + r1 * 1.6; p.vy = ny * sp + r2 * 1.6 + 0.8; p.vz = nz * sp + r3 * 1.6;
            p.life = 0.3 + Math.random() * 0.2; p.lifeMax = p.life; p.kind = kind;
        }
    }

    function spawnShell() {
        var s = shells[shellIdx];
        shellIdx = (shellIdx + 1) % C.SHELL_MAX;
        s.x = cssW * C.VM_ANCHOR_X - 30; s.y = cssH * C.VM_ANCHOR_Y - 60;
        s.vx = 80 + Math.random() * 90; s.vy = -180 - Math.random() * 80;
        s.life = C.SHELL_LIFE;
    }

    function drawHoles() {
        var s = C.HOLE_SIZE * 0.5, off = C.HOLE_OFF, j, h, k, okAll;
        ctx.fillStyle = palette.hole;
        for (j = 0; j < C.HOLE_MAX; j++) {
            h = holes[j];
            if (!h.on) continue;
            okAll = true;
            for (k = 0; k < 4; k++) {
                var sa = (k === 0 || k === 3) ? s : -s;
                var sb = (k === 0 || k === 1) ? s : -s;
                if (h.ax === 0) projectPoint(h.x + h.sg * off, h.y + sa, h.z + sb, proj);
                else if (h.ax === 2) projectPoint(h.x + sa, h.y + sb, h.z + h.sg * off, proj);
                else projectPoint(h.x + sa, h.y + h.sg * off, h.z + sb, proj);
                if (!proj.ok) { okAll = false; break; }
                holeQx[k] = proj.sx; holeQy[k] = proj.sy;
            }
            if (!okAll) continue;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.moveTo(holeQx[0], holeQy[0]);
            ctx.lineTo(holeQx[1], holeQy[1]);
            ctx.lineTo(holeQx[2], holeQy[2]);
            ctx.lineTo(holeQx[3], holeQy[3]);
            ctx.closePath();
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function drawParticles(dt) {
        var j, p;
        for (j = 0; j < C.PARTICLE_MAX; j++) {
            p = parts[j];
            if (p.life <= 0) continue;
            p.life -= dt;
            if (p.life <= 0) continue;
            p.vy -= 6 * dt;
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            projectPoint(p.x, p.y, p.z, proj);
            if (!proj.ok) continue;
            ctx.globalAlpha = p.life / p.lifeMax;
            ctx.fillStyle = p.kind ? palette.botHit : palette.muzzle;
            ctx.fillRect(proj.sx - 1.5, proj.sy - 1.5, 3, 3);
        }
        ctx.globalAlpha = 1;
    }

    function drawShells(dt) {
        var j, s;
        ctx.fillStyle = palette.shell;
        for (j = 0; j < C.SHELL_MAX; j++) {
            s = shells[j];
            if (s.life <= 0) continue;
            s.life -= dt;
            if (s.life <= 0) continue;
            s.vy += 750 * dt;
            s.x += s.vx * dt; s.y += s.vy * dt;
            ctx.globalAlpha = s.life / C.SHELL_LIFE;
            ctx.fillRect(s.x, s.y, 4, 7);
        }
        ctx.globalAlpha = 1;
    }

    /* ── 枪械视图模型：屏幕空间多边形（M4 卡宾枪分层轮廓），不占 3D 面池 ──
     * 坐标系：枪口朝 -x，y 负为上；全部预分配，逐帧仅 fill/stroke。 */
    var GUN_BARREL = [-158, -62, -98, -62, -98, -53, -158, -53];
    var GUN_BRAKE = [-178, -64, -166, -67, -156, -67, -156, -47, -166, -47, -178, -50];
    var GUN_FRONT_SIGHT = [-124, -53, -121, -82, -115, -82, -112, -53];
    var GUN_HANDGUARD = [-98, -70, -94, -74, -44, -74, -40, -70, -40, -44, -44, -40, -94, -40, -98, -44];
    var GUN_HAND_RAIL = [-96, -80, -42, -80, -42, -74, -96, -74];
    var GUN_BODY = [-44, -82, 22, -82, 30, -18, 16, 6, -30, 6, -44, -38];
    var GUN_RECV_RAIL = [-42, -88, 26, -88, 26, -82, -42, -82];
    var GUN_SIGHT = [-16, -103, 8, -103, 8, -88, -16, -88];
    var GUN_LENS = [-12, -100, 4, -100, 4, -91, -12, -91];
    var GUN_EJECT = [-4, -68, 16, -68, 16, -57, -4, -57];
    var GUN_MAG = [-36, 4, -10, 4, -16, 26, -27, 52, -49, 47, -41, 24];
    var GUN_GRIP = [18, 4, 38, 4, 44, 40, 52, 56, 36, 60, 30, 40];
    var GUN_TRIGGER = [3, 8, 9, 7, 7, 20, 2, 17];
    /* 受光/背光条带与细节，随主题配色变量走（ADR-4） */
    var GUN_BODY_HI = [-44, -82, 22, -82, 26, -74, -42, -74];
    var GUN_BODY_LO = [-30, 6, 16, 6, 26, -6, -38, -6];
    var GUN_GUARD_HI = [-94, -74, -44, -74, -40, -70, -96, -70];
    var GUN_GUARD_LO = [-94, -40, -44, -40, -40, -44, -96, -44];
    var GUN_MAG_LO = [-14, 4, -10, 4, -22, 50, -27, 52];
    var GUN_GRIP_LO = [38, 4, 44, 40, 52, 56, 46, 54, 38, 40, 33, 4];
    /* 枪托：枪口朝 -x，枪尾 +x；x 最大 108，窄屏按 vs 缩放后不越界（预分配，零分配） */
    /* 枪尾段（ADR-41/47）：托与机匣等高衔接（上缘从机匣上部斜向后），标准肩托轮廓——
     * 旧版托根部只有机匣一半高且从中下部斜插，观感是「圆棍勺柄」不像枪托。
     * ADR-47：托根部上缘原为 y=-50，比机匣顶(y=-82)/导轨(y=-88)低 32~38px，机匣右缘又
     * 从 (22,-82) 陡降到 (30,-18)，二者之间留下楔形空洞 → 观感「中间缺一块、枪尾上方缺角」。
     * 现将托根上缘抬到 y=-88 与导轨齐平；托先画、机匣后画盖住根部，露出的托顶从 x≈26
     * 平滑斜向后接肩垫，枪械中段轮廓连贯。托腮同步抬高保持贴在托顶下方。 */
    var GUN_STOCK = [16, -88, 62, -56, 100, -48, 108, -42, 108, 10, 72, 10, 40, 4, 16, 6];
    var GUN_STOCK_HI = [16, -88, 62, -56, 100, -48, 96, -44, 58, -51, 20, -78];
    var GUN_STOCK_LO = [40, 4, 72, 10, 108, 10, 108, 4, 74, 4];
    var GUN_CHEEK = [40, -58, 78, -48, 84, -34, 44, -44];
    var GUN_BUTT = [108, -42, 114, -38, 114, 8, 108, 10];
    var GUN_STOCK_HOLE = [64, -24, 84, -22, 86, -6, 66, -8];
    /* 准星座：衔接护木前端（x=-94）与枪管（x=-158 起段），消除管-匣过渡突兀 */
    var GUN_FRONT_BLOCK = [-106, -72, -94, -72, -94, -46, -106, -46];
    var GUARD_VENTS = [
        [-90, -56, -80, -59, -80, -50, -90, -53],
        [-76, -56, -66, -59, -66, -50, -76, -53],
        [-62, -56, -52, -59, -52, -50, -62, -53]
    ];
    /* 导轨齿：护木 5 齿 + 机匣 5 齿 + 弹匣托弹纹/握把指槽，绘制时内联 fillRect/stroke */
    var RIBS = [[-39, 20, -15, 20], [-42, 36, -21, 36]];      /* 弹匣托弹纹 */
    var GROOVES = [[26, 20, 38, 20], [29, 30, 40, 30]];       /* 握把指槽 */
    var MUZ_X = -180, MUZ_Y = -57;

    function fillPoly(pts, col) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (var k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
        ctx.closePath();
        ctx.fill();
    }

    function strokePoly(pts, col, w) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (var k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
        ctx.closePath();
        ctx.stroke();
    }

    function drawViewmodel(dt, game) {
        if (!game || game.viewMode !== 'fps') return;
        if (game.state !== 'playing' && game.state !== 'paused') return;
        var p = game.player, k;
        /* 转视角 lag：60ms 窗口累计反向偏移，上限 10px，τ=0.15s 指数回弹 */
        var now = global.performance.now() / 1000;
        lagT[lagI] = now; lagDX[lagI] = game.lastLookDX || 0; lagDY[lagI] = game.lastLookDY || 0;
        lagI = (lagI + 1) % 4;
        var sumX = 0, sumY = 0;
        for (k = 0; k < 4; k++) {
            if (now - lagT[k] <= C.LAG_DELAY && lagT[k] > 0) { sumX += lagDX[k]; sumY += lagDY[k]; }
        }
        var tg = sumX * -600; if (tg > C.LAG_MAX) tg = C.LAG_MAX; else if (tg < -C.LAG_MAX) tg = -C.LAG_MAX;
        vm.lagX += (tg - vm.lagX) * (1 - Math.exp(-dt / C.LAG_TAU));
        tg = sumY * 600; if (tg > C.LAG_MAX) tg = C.LAG_MAX; else if (tg < -C.LAG_MAX) tg = -C.LAG_MAX;
        vm.lagY += (tg - vm.lagY) * (1 - Math.exp(-dt / C.LAG_TAU));
        /* 移动 sway：±6px ×(速度/4)，1.6Hz */
        vm.phase += dt * Math.PI * 2 * C.SWAY_HZ;
        var ampK = game.moveSpeed / 4; if (ampK > 1) ampK = 1;
        var swayX = Math.sin(vm.phase) * C.SWAY_AMP * ampK;
        /* 开火后坐：上移 12px + 后缩 4px，τ=0.10s */
        vm.recoil *= Math.exp(-dt / C.RECOIL_TAU);
        if (vm.recoil < 0.01) vm.recoil = 0;
        if (vm.muzzleT > 0) vm.muzzleT -= dt;
        /* 换弹动画：下移 40px + 下旋 25°，0.25/0.90/0.25 与计时锁定 */
        var rf = 0;
        if (p.reloading) {
            var el = C.RELOAD_TIME - p.reloadT;
            if (el < 0) el = 0;
            if (el < C.RELOAD_DOWN) rf = el / C.RELOAD_DOWN;
            else if (el < C.RELOAD_DOWN + C.RELOAD_HOLD) rf = 1;
            else rf = (C.RELOAD_TIME - el) / C.RELOAD_UP;
            if (rf < 0) rf = 0; else if (rf > 1) rf = 1;
        }
        var ax = cssW * C.VM_ANCHOR_X, ay = cssH * C.VM_ANCHOR_Y;
        var vs = cssW / 1100; if (vs > 1) vs = 1; if (vs < 0.5) vs = 0.5;
        var back = C.RECOIL_BACK * vm.recoil;
        /* 枪口朝向射击方向：FPS 射击方向在屏幕空间恒为视图中心（准星）。
         * 枪口局部位于 (MUZ_X, MUZ_Y)，绕锚点 (ax,ay) 随枪身旋转 α；求 α 使枪口射线穿过
         * 中心：bx·sinα − by·cosα = −MUZ_Y·vs（枪管局部 -x），解析得 α=π−asin(k/R)−atan2(−by,bx)。
         * aimGeom = α − VM_TILT 即相对基准姿态的附加角；开火 AIM_TAU 快抬、停火 REST_TAU 慢落。
         * 仅改视图模型屏幕旋转，不碰 hitscan/散布/kick 任何数值。 */
        var bx = cssW * 0.5 - ax, by = cssH * 0.5 - ay;
        var rad = Math.sqrt(bx * bx + by * by) || 1;
        var k = -MUZ_Y * vs / rad; if (k > 1) k = 1; else if (k < -1) k = -1;
        var alpha = Math.PI - Math.asin(k) - Math.atan2(-by, bx);
        while (alpha > Math.PI) alpha -= Math.PI * 2;
        while (alpha < -Math.PI) alpha += Math.PI * 2;
        var aimGeom = alpha - C.VM_TILT;
        vm.aimGeom = aimGeom;
        var firingNow = game.state === 'playing' && CS.Input && CS.Input.firing;
        var aimTarget = firingNow ? aimGeom * C.VM_AIM_GAIN : 0;
        var aimTau = firingNow ? C.VM_AIM_TAU : C.VM_REST_TAU;
        vm.aim += (aimTarget - vm.aim) * (1 - Math.exp(-dt / aimTau));
        if (Math.abs(vm.aim) < 0.0002) vm.aim = 0;
        ctx.save();
        ctx.translate(ax + swayX + vm.lagX + back * 0.5, ay - C.RECOIL_UP * vm.recoil + vm.lagY + back * 0.5 + C.VM_DROP * rf);
        ctx.rotate((C.VM_TILT + C.VM_ROT * rf * Math.PI / 180 + vm.aim));
        ctx.scale(vs * (1 - 0.05 * vm.recoil), vs * (1 - 0.05 * vm.recoil));
        /* 枪管组：枪管 → 消焰器 → 准星 */
        fillPoly(GUN_BARREL, palette.gunDark);
        fillPoly(GUN_BRAKE, palette.gunDark);
        fillPoly(GUN_FRONT_SIGHT, palette.gunDark);
        /* 护木：本体 → 明暗 → 顶部导轨+齿 → 散热槽 */
        fillPoly(GUN_HANDGUARD, palette.gunBody);
        fillPoly(GUN_GUARD_HI, palette.gunHi);
        fillPoly(GUN_GUARD_LO, palette.gunLo);
        fillPoly(GUN_HAND_RAIL, palette.gunDark);
        var n;
        for (n = 0; n < 5; n++) ctx.fillRect(-92 + n * 10, -80, 4, 6);
        for (n = 0; n < GUARD_VENTS.length; n++) fillPoly(GUARD_VENTS[n], palette.gunLo);
        fillPoly(GUN_FRONT_BLOCK, palette.gunDark);
        /* 枪托：主体 → 受光 → 背光 → 托腮 → 底板 → 镂空；随后画握把/机匣压住前缘 */
        fillPoly(GUN_STOCK, palette.gunBody);
        fillPoly(GUN_STOCK_HI, palette.gunHi);
        fillPoly(GUN_STOCK_LO, palette.gunLo);
        fillPoly(GUN_CHEEK, palette.gunBody);
        fillPoly(GUN_BUTT, palette.gunDark);
        fillPoly(GUN_STOCK_HOLE, palette.gunLo);
        /* 握把（右侧件先画，被机匣压住上沿） */
        fillPoly(GUN_GRIP, palette.gunDark);
        for (n = 0; n < GROOVES.length; n++) {
            ctx.strokeStyle = palette.gunLo; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(GROOVES[n][0], GROOVES[n][1]); ctx.lineTo(GROOVES[n][2], GROOVES[n][3]);
            ctx.stroke();
        }
        /* 机匣：本体 → 明暗 → 顶部导轨+齿 → 抛壳窗 */
        fillPoly(GUN_BODY, palette.gunBody);
        fillPoly(GUN_BODY_HI, palette.gunHi);
        fillPoly(GUN_BODY_LO, palette.gunLo);
        fillPoly(GUN_RECV_RAIL, palette.gunDark);
        for (n = 0; n < 5; n++) ctx.fillRect(-38 + n * 12, -88, 4, 6);
        fillPoly(GUN_EJECT, palette.gunLo);
        /* red-dot 瞄具：镜体 → 镜片(accent) → 高光点 */
        fillPoly(GUN_SIGHT, palette.gunDark);
        fillPoly(GUN_LENS, palette.gunSight);
        ctx.fillRect(-7, -97, 2, 2);
        /* 扳机护圈（镂空描边）+ 扳机 */
        strokePoly([-6, 7, -6, 29, 14, 29, 16, 7], palette.gunDark, 3.5);
        fillPoly(GUN_TRIGGER, palette.gunDark);
        /* 弹匣（左侧件最后画，盖住护圈左端）→ 托弹纹 → 背光 */
        fillPoly(GUN_MAG, palette.gunDark);
        for (n = 0; n < RIBS.length; n++) {
            ctx.strokeStyle = palette.gunLo; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(RIBS[n][0], RIBS[n][1]); ctx.lineTo(RIBS[n][2], RIBS[n][3]);
            ctx.stroke();
        }
        fillPoly(GUN_MAG_LO, palette.gunLo);
        if (vm.muzzleT > 0) {       // 枪口火光：0.04s 星形面片
            ctx.globalAlpha = vm.muzzleT / C.MUZZLE_TIME;
            ctx.fillStyle = palette.muzzle;
            ctx.translate(MUZ_X, MUZ_Y);
            ctx.beginPath();
            ctx.moveTo(2, -3); ctx.lineTo(-26, 0); ctx.lineTo(2, 3);
            ctx.moveTo(2, -3); ctx.lineTo(-14, -12); ctx.lineTo(4, 3);
            ctx.moveTo(2, 3); ctx.lineTo(-14, 11); ctx.lineTo(4, -3);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    }

    /* 开火表现入口：后坐 + 火光 + 弹壳（仅 FPS） */
    function vmFire(game) {
        if (!game || game.viewMode !== 'fps') return;
        vm.recoil = 1;
        vm.muzzleT = C.MUZZLE_TIME;
        spawnShell();
    }

    function clearFx() {
        var j;
        for (j = 0; j < C.HOLE_MAX; j++) holes[j].on = false;
        for (j = 0; j < C.PARTICLE_MAX; j++) parts[j].life = 0;
        for (j = 0; j < C.SHELL_MAX; j++) shells[j].life = 0;
        holeIdx = partIdx = shellIdx = deathIdx = 0;
        for (j = 0; j < deaths.length; j++) deaths[j].life = 0;   /* #9 重开清死亡特效 */
        vm.recoil = 0; vm.muzzleT = 0; vm.phase = 0; vm.lagX = 0; vm.lagY = 0; vm.aim = 0;
        gaitPhase = 0;   /* ADR-58：重开时步态归位，避免腿停在中途摆姿 */
        clearFloats();
    }

    /* ── 面排序与绘制 ── */
    function sortFaces() {
        var j, key, d;
        for (i = 0; i < faceCount; i++) order[i] = i;
        for (i = 1; i < faceCount; i++) {
            key = order[i]; d = faces[key].depth; j = i - 1;
            while (j >= 0 && faces[order[j]].depth < d) { order[j + 1] = order[j]; j--; }
            order[j + 1] = key;
        }
    }

    function gatherScene(game) {
        drawSkyFloor();
        genWalls();
        genBots(game.bots);
        if (lastView === 'tps') genPlayer(game);
    }

    function drawFacesTex() {
        var pat;
        for (i = 0; i < faceCount; i++) {
            var f = faces[order[i]], k;
            ctx.globalAlpha = f.alpha;
            pat = f.tex >= 0 ? activePats[f.tex] : null;
            ctx.fillStyle = pat || f.color;
            ctx.beginPath();
            ctx.moveTo(f.sx[0], f.sy[0]);
            for (k = 1; k < f.n; k++) ctx.lineTo(f.sx[k], f.sy[k]);
            ctx.closePath();
            ctx.fill();
            if (f.shade < 1) {           // 伪光照：同路径叠黑 alpha=1−shade
                ctx.globalAlpha = f.alpha * (1 - f.shade);
                ctx.fillStyle = BLACK;
                ctx.fill();
            }
            if (f.fog > 0) {             // 距离雾：同路径填雾色 alpha=f
                ctx.globalAlpha = f.alpha * f.fog;
                ctx.fillStyle = palette.sky;
                ctx.fill();
            }
            if (f.stroke) {
                ctx.globalAlpha = f.alpha;
                ctx.strokeStyle = palette.wallEdge;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            if (f.mark) {                    // MC 脸部：紧跟所属面绘制，天然被更近的面遮挡
                ctx.globalAlpha = f.alpha;
                drawFaceMark(f);
            }
        }
        ctx.globalAlpha = 1;
    }

    function drawFacesFlat() {
        for (i = 0; i < faceCount; i++) {
            var f = faces[order[i]], k;
            ctx.globalAlpha = f.alpha;
            ctx.fillStyle = f.color;
            ctx.beginPath();
            ctx.moveTo(f.sx[0], f.sy[0]);
            for (k = 1; k < f.n; k++) ctx.lineTo(f.sx[k], f.sy[k]);
            ctx.closePath();
            ctx.fill();
            if (f.stroke) {
                ctx.strokeStyle = palette.wallEdge;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            if (f.mark) {
                ctx.globalAlpha = f.alpha;
                drawFaceMark(f);
            }
        }
        ctx.globalAlpha = 1;
    }

    /* ── Renderer 接口：endFrame ── */
    function endFrame(dt, game) {
        /* 步态相位（ADR-58）：按本帧实际移动距离推进。一个完整周期=左右腿各摆一次=2 步，
         * 每步 FOOTSTRIDE(1.8m) 与 Sfx.footstep 同源，故周期距离 2·FOOTSTRIDE；
         * dt=0（暂停/菜单）自动冻结，静止或空中时 moveSpeed 不推进相位。 */
        if (game && game.player.onGround && game.moveSpeed > 0.1) {
            gaitPhase += dt * game.moveSpeed / (2 * C.FOOTSTRIDE) * (Math.PI * 2);
            if (gaitPhase > Math.PI * 2) gaitPhase -= Math.PI * 2;
        }
        gatherScene(game);
        sortFaces();
        if (mode === 0) drawFacesTex(); else drawFacesFlat();
        drawHoles();
        drawParticles(dt);
        drawShells(dt);
        drawDeaths(dt);
        drawFloats(dt);
        drawViewmodel(dt, game);
    }

    function addFloat(x, y, z) {
        var fl = floats[floatIdx];
        fl.x = x; fl.y = y; fl.z = z; fl.life = C.FLOAT_LIFE;
        floatIdx = (floatIdx + 1) % floats.length;
    }

    /* #9 登记一次击杀倒地：复用预分配槽（同帧多杀循环覆盖），走 ctx 不占面池 */
    function addDeath(x, z) {
        var d = deaths[deathIdx];
        d.x = x; d.z = z; d.life = C.DEATH_FX_TIME; d.max = C.DEATH_FX_TIME;
        deathIdx = (deathIdx + 1) % deaths.length;
    }

    function clearFloats() {
        for (i = 0; i < floats.length; i++) floats[i].life = 0;
    }

    /* ── 慢帧自适应（可逆三级档，ADR-61 修正 ADR-50 的单向降级；ADR-64 加抖动迟滞+升档冷却）──
     * 档位从实际渲染状态推导（不引入独立变量，避免与外部 useRenderer 漂移）：
     *   level 0 = tex 设备默认分辨率（scaleOverride=0, mode=0）
     *   level 1 = tex 内部降分辨率 0.65（scaleOverride=0.65, mode=0）
     *   level 2 = Flat 轻量渲染（mode=1）
     * 降级沿用 ADR-50 判据（<FPS_MIN 或呈现抖动），慢窗口立即降一级（快）；
     * 回升需连续 PERF_RECOVER_SEC 秒 fps>=FPS_RECOVER（高 FPS_MIN 10 的迟滞带）且无抖动，
     * 才升一级（慢）。任何 slow 或中间态清零回升计时——阈值附近不会抖动式来回跳档。
     * #14：抖动判据从单布尔改双阈值状态机——ratio=p90/(1000/hz) 越过 DROP 才进入抖动态，
     * 回落到 HOLD 以下才解除，中间带保持原状态；升档后设 upCoolT 冷却，期间只观察不动作，
     * 避免升档 resize 制造慢帧 → 下一窗口又判抖 → 再降级的自激横跳。
     * #16：升档看目标档位而非当前档位——升档时记 probeLevel，冷却期内该档仍抖/慢即判失败，
     * 冷却结束时锁定该档（lockedLevel），本局不再升回；避免「降级档很健康就升回失败档」死循环。
     * 注意 perfT/perfN 用 dt（playing 才调 checkPerf，暂停冻结），恢复分辨率走 resize 重算。 */
    var perfT = 0, perfN = 0, healthyT = 0, jitterHot = false, upCoolT = 0;
    /* #16 升档试探：probeLevel=正在试探的目标档位(-1 无)；probeFailed=冷却期内该档是否失败；
     * lockedLevel=本机已证明扛不住、本局不再升回的档位(-1 无)。resetPerf() 重开时全清。 */
    var probeLevel = -1, probeFailed = false, lockedLevel = -1;
    /* #15 只读探针快照：复用 checkPerf 已取的诊断量，不额外调 diagCost、不参与判定。 */
    var probeSnap = { hz: 0, p90: 0, ratio: 0, hot: false, lv: 0, cool: 0, lock: -1 };
    function perfLevel() {
        if (mode !== 0) return 2;
        return scaleOverride ? 1 : 0;
    }
    function checkPerf(dt, game) {
        perfT += dt; perfN++;
        if (perfT < 1.0) return;
        var fps = perfN / perfT;
        var slow = fps < C.FPS_MIN;

        /* #14 抖动迟滞：ratio = deltaP90 / 帧预算。用双阈值状态机替代原单布尔判据——
         * 未抖时越过 DROP(1.8) 才进入抖动态，已抖时回落 HOLD(1.3) 以下才解除，
         * 中间 1.3~1.8 保持原状态，避免同一 ratio 在降级/升档两向反复越线。 */
        var ratio = 0, dg = null;
        if (game && game.diagCost) {
            dg = game.diagCost();
            if (dg.hz > 0) ratio = dg.deltaP90 / (1000 / dg.hz);
        }
        if (!jitterHot && ratio > (C.PERF_JITTER_DROP || 1.8)) jitterHot = true;
        else if (jitterHot && ratio < (C.PERF_JITTER_HOLD || 1.3)) jitterHot = false;

        var lv = perfLevel();
        var wasCooling = upCoolT > 0;
        if (upCoolT > 0) upCoolT -= perfT;         // 升档冷却倒计时
        var cooling = upCoolT > 0;

        /* #16 试探收口必须早于下面的降级分支：冷却结束那一帧若正在抖，降级分支会先清掉
         * 试探状态。故在动作前先结算——试行期抖过就锁定目标档，之后降级也不影响锁定。 */
        if (wasCooling && !cooling && probeLevel >= 0) {
            if (probeFailed && C.PERF_PROMO_LOCK !== 0) lockedLevel = probeLevel;
            probeLevel = -1; probeFailed = false;
        }

        if (cooling) {
            healthyT = 0;                          // 冷却期：不做档位动作（吸收 resize 慢帧）
            /* #16 试探判定：升档后这段冷却期就是「目标档位试用窗」。若该档仍慢或抖，
             * 记失败——它在这台设备上真扛不住，不是 resize 的瞬时副作用。 */
            if (probeLevel >= 0 && (slow || jitterHot)) probeFailed = true;
        } else if (slow || jitterHot) {
            healthyT = 0;                          // 慢窗口/抖动：清回升计时 + 立即降一级
            if (lv < 2) setPerfLevel(lv + 1);
            probeLevel = -1; probeFailed = false;  // 降级即放弃本次试探（目标档已证伪）
        } else if (fps >= C.FPS_RECOVER) {
            /* #16 升档看目标档位：只有「目标档未被锁定」才允许试探升回。
             * 曾在本机抖到降级的档位被 lockedLevel 记住，本局不再重试——
             * 这断开了「降级档很健康 → 升回失败档 → 又降级」的死循环。 */
            if (lv > 0 && !(C.PERF_PROMO_LOCK !== 0 && lv - 1 === lockedLevel)) {
                healthyT += perfT;                 // 健康窗口累计（用真实窗口时长，非固定 1s）
                if (healthyT >= C.PERF_RECOVER_SEC) {
                    setPerfLevel(lv - 1);
                    healthyT = 0;                  // 升一级后重新累计，防连续跳级
                    upCoolT = C.PERF_UP_COOL || 12;// #14 冷却 = #16 试行窗口
                    probeLevel = lv - 1;           // 记住试探的是哪个目标档
                    probeFailed = false;           // 本轮试行先假设成功
                }
            } else {
                healthyT = 0;                      // 目标档被锁定：不再累计回升
            }
        } else {
            healthyT = 0;                          // 中间态（45~55fps）：不降也不计回升
        }

        /* #15 只读探针：写入本窗口已有的诊断量，供 HUD 按需显示。纯观测，不反馈进任何分支。 */
        probeSnap.hz = dg && dg.hz > 0 ? dg.hz : 0;
        probeSnap.p90 = dg ? dg.deltaP90 : 0;
        probeSnap.ratio = ratio;
        probeSnap.hot = jitterHot;
        probeSnap.lv = lv;
        probeSnap.cool = upCoolT > 0 ? upCoolT : 0;
        probeSnap.lock = lockedLevel;
        perfT = 0; perfN = 0;
    }

    /* #16 重开一局时重置性能自适应状态：清锁定/试探，让新局重新试探可用档位。
     * 只动自适应状态，不动当前档位——重开沿用上局已稳定档位，避免开局瞬间抖动。 */
    function resetPerf() {
        perfT = 0; perfN = 0; healthyT = 0; jitterHot = false; upCoolT = 0;
        probeLevel = -1; probeFailed = false; lockedLevel = -1;
    }

    /* 统一档位切换：mode / scaleOverride 是档位的唯一真实来源，这里手动同步二者。
     * 降级到 flat 时保留 scaleOverride=0.65（内部仍省分辨率），回升到 tex 时恢复设备默认。 */
    function setPerfLevel(level) {
        var from = perfLevel();
        if (level === 2) {
            scaleOverride = 0.65;
            if (mode !== 1) useRenderer('flat');
        } else {
            scaleOverride = level === 0 ? 0 : 0.65;
            resize();                              // scaleOverride 变化后重算内部分辨率
            if (mode !== 0) useRenderer('tex');
        }
        if (level !== from && CS.HUD && CS.HUD.toast) {
            CS.HUD.toast(level > from
                ? (level === 1 ? '已降低渲染分辨率以提升流畅度' : '已切换轻量渲染以提升流畅度')
                : (level === 1 ? '已恢复渲染分辨率' : '已恢复完整画质'));
        }
    }

    function useRenderer(name) {
        var prev = mode;
        mode = name === 'flat' ? 1 : 0;
        CS.Renderer = mode ? RFlat : R2D;
        // 外部手动切换（QA/调试）后同步 perfT/N 与回升计时，避免把外部指令误判为抖动窗口
        if (prev !== mode) {
            perfT = 0; perfN = 0; healthyT = 0; jitterHot = false; upCoolT = 0;
            probeLevel = -1; probeFailed = false;  // #16：手动切档作废在途试探，但保留本局锁定记忆
        }
    }

    function makeApi(id) {
        return {
            id: id,
            init: init, resize: resize,
            beginFrame: beginFrame, aimRay: aimRay, submitFace: submitFace,
            drawBillboard: drawBillboard, drawViewmodel: drawViewmodel,
            endFrame: endFrame,
            addFloat: addFloat, clearFloats: clearFloats,
            addDeath: addDeath,   /* #9：击杀倒地消散（纯 ctx，不占面池） */
            get deathFx() {       /* QA：活跃死亡特效数 */
                var n = 0; for (var k = 0; k < deaths.length; k++) if (deaths[k].life > 0) n++;
                return n;
            },
            addBulletHole: addBulletHole, spawnParticles: spawnParticles,
            vmFire: vmFire, clearFx: clearFx, checkPerf: checkPerf, resetPerf: resetPerf,
            get playerAlpha() { return playerAlpha; },
            get camDist() { return camDist; },
            get lastMark() { return lastMark; },   /* QA：脸部标记屏幕几何（top≤y≤bottom 应恒成立） */
            get faceCount() { return faceCount; },
            get renderScale() { return renderScale; },
            get perfLevel() { return perfLevel(); },   /* ADR-61：0 满 / 1 降分辨率 / 2 flat，QA 可读 */
            /* #15 只读探针：返回快照副本（外部改不到内部状态），真机 ?perf=1 时 HUD 显示 */
            get perfProbe() {
                return { hz: probeSnap.hz, p90: probeSnap.p90, ratio: probeSnap.ratio,
                    hot: probeSnap.hot, lv: probeSnap.lv, cool: probeSnap.cool,
                    lock: probeSnap.lock };
            },
            get vmAim() { return { cur: vm.aim, geom: vm.aimGeom, target: vm.aimGeom * C.VM_AIM_GAIN }; },  /* QA：枪口朝向射击方向的抬枪角 */
            get debugPatterns() { return [!!activePats[0], !!activePats[1], !!activePats[2], !!activePats[3]]; },
            get debugPatternTest() {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.fillStyle = activePats[3];
                ctx.fillRect(0, 0, 128, 64);
                ctx.fillStyle = palette.floor;
                ctx.fillRect(128, 0, 64, 64);
                var d = ctx.getImageData(0, 0, 192, 64).data;
                var set = {}, k;
                for (k = 0; k < d.length; k += 4) set[d[k] + ',' + d[k + 1] + ',' + d[k + 2]] = 1;
                ctx.restore();
                return Object.keys(set).length;
            },
            get debugTex() {
                var t = texCache[document.documentElement.dataset.theme || 'light'], out = [], j, k, set;
                if (!t) return null;
                for (j = 0; j < 4; j++) {
                    var g2 = t[j].getContext('2d');
                    var d = g2.getImageData(0, 0, 64, 64).data;
                    set = {};
                    var n = 0;
                    for (k = 0; k < d.length; k += 16) { set[d[k] + ',' + d[k + 1] + ',' + d[k + 2]] = 1; n++; if (d[k + 3] === 0) n += 1000; }
                    out.push({ distinct: Object.keys(set).length, transparent: n > 500 });
                }
                return out;
            },
            get mode() { return mode; },
            get faceCount() { return faceCount; },   // ADR-50 诊断读数：当帧提交面数
            get poolStats() {
                var np = 0, ns = 0, nh = 0, j;
                for (j = 0; j < C.PARTICLE_MAX; j++) if (parts[j].life > 0) np++;
                for (j = 0; j < C.SHELL_MAX; j++) if (shells[j].life > 0) ns++;
                for (j = 0; j < C.HOLE_MAX; j++) if (holes[j].on) nh++;
                return { particles: np, shells: ns, holes: nh };
            }
        };
    }

    var R2D = makeApi('tex');
    var RFlat = makeApi('flat');
    CS.Renderer2D = R2D;
    CS.Renderer2DFlat = RFlat;
    CS.useRenderer = useRenderer;
    CS.Renderer = R2D;
})(window);
