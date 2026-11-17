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
    var MAX_FACES = 80, MAX_VERTS = 8;
    var faces = [], order = [], floats = [], i;
    for (i = 0; i < MAX_FACES; i++) {
        faces.push({ n: 0, sx: new Float64Array(MAX_VERTS), sy: new Float64Array(MAX_VERTS),
            dist: 0, color: '', alpha: 1, stroke: false, tex: -1, shade: 1, fog: 0, mark: 0 });
        order.push(0);
    }
    for (i = 0; i < 4; i++) floats.push({ x: 0, y: 0, z: 0, life: 0 });
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
    /* 相机遮挡淡出（X-ray）：每墙盒的当前透明度，1=不透明（见 updateWallFade） */
    var wallFade = new Float64Array(32).fill(1);
    var axX = 1, axZ = 0;   // 公告板水平轴（由相机方向算出）
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
        palette.accent = v('--accent') || v('--text-color');
        palette.wallA = U.shade(wa || base, 1);
        palette.wallB = U.shade(wb || wa || base, 1);
        palette.hole = U.shade(palette.wallEdge, 0.5);
        palette.shell = U.shade(palette.accent, 1.25);
        palette.gunBody = v('--cs-gun-body') || palette.player;
        palette.gunDark = v('--cs-gun-dark') || palette.wallEdge;
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

    /* 切镜只改相机位置与模型显隐：yaw/pitch(+kick)、射线、FOV 全部共用 */
    function setCamera(player, viewMode) {
        var pitch = player.pitch + (player.kick || 0);   // 视角上踢真实进射线
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

    /* q 中 4 个世界顶点 → 相机空间 → 裁剪 → 投影，写入一个复用的 face */
    function addFace(color, alpha, stroke, tex, shade, cx, cy, cz) {
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
    function drawBillboard(ox, oz, y0, y1, halfW, color, alpha, stroke) {
        setQ(0, ox - axX * halfW, y0, oz - axZ * halfW);
        setQ(1, ox + axX * halfW, y0, oz + axZ * halfW);
        setQ(2, ox + axX * halfW, y1, oz + axZ * halfW);
        setQ(3, ox - axX * halfW, y1, oz - axZ * halfW);
        addFace(color, alpha, stroke, -1, 1, ox, (y0 + y1) * 0.5, oz);
    }

    function genWalls() {
        var boxes = W.boxes, k, b, cx, cz, t, colX, colZ, fa;
        while (boxCount < boxes.length) { boxTex[boxCount] = boxCount < 4 ? 0 : (boxCount % 2 ? 2 : 1); boxCount++; }
        for (k = 0; k < boxes.length; k++) {
            b = boxes[k];
            fa = wallFade[k];               /* 相机遮挡淡出：该盒被淡出时整盒半透明 */
            cx = (b.minX + b.maxX) * 0.5; cz = (b.minZ + b.maxZ) * 0.5;
            t = mode === 0 ? boxTex[k] : -1;
            colX = mode === 0 ? palette.wallA : palette.wallX[k % 3];
            colZ = mode === 0 ? palette.wallB : palette.wallZ[k % 3];
            if (camX > b.maxX) {
                setQ(0, b.maxX, 0, b.minZ); setQ(1, b.maxX, C.WALL_H, b.minZ);
                setQ(2, b.maxX, C.WALL_H, b.maxZ); setQ(3, b.maxX, 0, b.maxZ);
                addFace(colX, fa, true, t, mode === 0 ? shadeO[0] : 1, b.maxX, C.WALL_H * 0.5, cz);
            }
            if (camX < b.minX) {
                setQ(0, b.minX, 0, b.maxZ); setQ(1, b.minX, C.WALL_H, b.maxZ);
                setQ(2, b.minX, C.WALL_H, b.minZ); setQ(3, b.minX, 0, b.minZ);
                addFace(colX, fa, true, t, mode === 0 ? shadeO[1] : 1, b.minX, C.WALL_H * 0.5, cz);
            }
            if (camZ > b.maxZ) {
                setQ(0, b.minX, 0, b.maxZ); setQ(1, b.minX, C.WALL_H, b.maxZ);
                setQ(2, b.maxX, C.WALL_H, b.maxZ); setQ(3, b.maxX, 0, b.maxZ);
                addFace(colZ, fa, true, t, mode === 0 ? shadeO[4] : 1, cx, C.WALL_H * 0.5, b.maxZ);
            }
            if (camZ < b.minZ) {
                setQ(0, b.maxX, 0, b.minZ); setQ(1, b.maxX, C.WALL_H, b.minZ);
                setQ(2, b.minX, C.WALL_H, b.minZ); setQ(3, b.minX, 0, b.minZ);
                addFace(colZ, fa, true, t, mode === 0 ? shadeO[5] : 1, cx, C.WALL_H * 0.5, b.minZ);
            }
            if (camY > C.WALL_H) {
                setQ(0, b.minX, C.WALL_H, b.minZ); setQ(1, b.minX, C.WALL_H, b.maxZ);
                setQ(2, b.maxX, C.WALL_H, b.maxZ); setQ(3, b.maxX, C.WALL_H, b.minZ);
                addFace(palette.wallTop, fa, true, t, mode === 0 ? shadeO[2] : 1, cx, C.WALL_H, cz);
            }
        }
    }

    /* 头部细节：纯 ctx 绘制、不占面池，由 drawFaces* 在画完该面后立刻调用（近处物体自然遮挡）。
     * 屏幕坐标 y 向下；billboard 角点 Q0/Q1=世界 y0（底）、Q2/Q3=y1（顶），
     * 投影后 sy[0]/sy[1] 是面的屏幕底（值大）、sy[2]/sy[3] 是面的屏幕顶（值小）。
     * 因此一切"自顶向下 x%"的定位必须从 sy[3] 起、向 y 增大方向加。
     * mark=1 敌人：正脸眼+鼻+嘴（敌人始终面向玩家，看到的是脸）——头面中下部。
     * mark=2 玩家 TPS：越肩从背后跟随，看不到脸——头顶盔带 + 后脑勺横带，强化"背影"读感。 */
    function drawFaceMark(f) {
        if (f.n !== 4) return;                       // 被近裁剪切过的面不做插值
        var lx = f.sx[0] + (f.sx[3] - f.sx[0]) * 0.58;
        var rx = f.sx[1] + (f.sx[2] - f.sx[1]) * 0.58;
        var span = rx - lx;
        var hh = f.sy[3] - f.sy[0];                  // 面高（负值：sy3 顶、sy0 底）
        var top = f.sy[3];
        ctx.fillStyle = palette.gunDark;
        if (f.mark === 2) {
            /* 后脑勺：头顶一条头盔带 + 中部一条横向发型/护目带（不是眼睛），均自面顶向下 */
            var bandY = top + Math.abs(hh) * 0.22;
            var bandH = Math.max(2, Math.abs(hh) * 0.13);
            ctx.fillRect(lx, bandY - bandH * 0.5, span, bandH);
            var napeY = top + Math.abs(hh) * 0.62;
            ctx.fillRect(lx + span * 0.16, napeY, span * 0.68, Math.max(1, Math.abs(hh) * 0.06));
            lastMark.mark = 2; lastMark.top = top; lastMark.bottom = f.sy[0]; lastMark.y = bandY; lastMark.y2 = napeY; lastMark.y3 = napeY;
        } else {
            /* 敌人正脸（MC 风格三件套，均自面顶向下）：眼 48% 两只小方眼、
             * 鼻 60% 居中窄方、嘴 78% 居中横条。远距离以 ≥1px 兜底可见。 */
            var aw = Math.abs(span), ah = Math.abs(hh);
            var ew = aw * 0.14, eh = ah * 0.10;
            if (ew < 1) ew = 1;
            if (eh < 1) eh = 1;
            var ey = top + ah * 0.48;
            ctx.fillRect(lx + span * 0.28 - ew * 0.5, ey - eh * 0.5, ew, eh);
            ctx.fillRect(lx + span * 0.72 - ew * 0.5, ey - eh * 0.5, ew, eh);
            var nw = Math.max(1, aw * 0.10), nh = Math.max(1, ah * 0.10);
            var ny = top + ah * 0.60, nx = lx + span * 0.5;
            ctx.fillRect(nx - nw * 0.5, ny - nh * 0.5, nw, nh);
            var mw = Math.max(1, aw * 0.34), mh = Math.max(1, ah * 0.06);
            var my = top + ah * 0.78;
            ctx.fillRect(nx - mw * 0.5, my - mh * 0.5, mw, mh);
            lastMark.mark = 1; lastMark.top = top; lastMark.bottom = f.sy[0]; lastMark.y = ey; lastMark.y2 = ny; lastMark.y3 = my;
        }
    }

    /* MC 分块敌人：6 面（双腿+躯干+双臂+头）+ 1 面枪 stub + 开火时 1 面枪口火光。
     * 所有部件落在 hitscan 公告板盒内（|u|≤0.32, y∈[0.10,1.85]）；视觉与判定彻底解耦。 */
    function genBots(bots) {
        var k, b, f0, torsoDist;
        for (k = 0; k < bots.length; k++) {
            b = bots[k];
            if (!b.alive) continue;
            setAxes(camX, camZ, b.x, b.z);
            var col = b.hitFlash > 0 ? palette.botHit : palette.bot;
            /* 躯干半宽 0.24（小于判定 0.32）让双臂露出轮廓；腿/臂全部仍在判定盒内 */
            drawBillboard(b.x - axX * 0.12, b.z - axZ * 0.12, C.BOT_Y0, 0.70, 0.11, col, 1, true);
            drawBillboard(b.x + axX * 0.12, b.z + axZ * 0.12, C.BOT_Y0, 0.70, 0.11, col, 1, true);
            f0 = faceCount;
            drawBillboard(b.x, b.z, 0.70, C.BOT_SPLIT, 0.24, col, 1, true);
            torsoDist = faceCount > f0 ? faces[faceCount - 1].dist : 0;
            drawBillboard(b.x - axX * 0.25, b.z - axZ * 0.25, 0.78, 1.42, 0.07, col, 1, true);
            drawBillboard(b.x + axX * 0.25, b.z + axZ * 0.25, 0.78, 1.42, 0.07, col, 1, true);
            f0 = faceCount;
            drawBillboard(b.x, b.z, C.BOT_SPLIT, C.BOT_Y1, C.BOT_HEAD_HALF_W, palette.botHead, 1, true);
            if (faceCount > f0) faces[faceCount - 1].mark = 1;
            /* 枪 stub：与躯干共面时会被躯干（更靠近相机眼高）盖住，仅微调排序距离，
             * 使它压在躯干/手臂之前；这不是游戏数值，只影响画家算法顺序。 */
            f0 = faceCount;
            drawBillboard(b.x + axX * 0.28, b.z + axZ * 0.28, 0.98, 1.18, 0.04, palette.gunBody, 1, false);
            if (faceCount > f0 && torsoDist > 0) faces[faceCount - 1].dist = torsoDist - 0.02;
            if (b.flash > 0) {
                f0 = faceCount;
                drawBillboard(b.x + axX * 0.30, b.z + axZ * 0.30,
                    1.05, 1.25, 0.10, palette.muzzle, 1, false);
                if (faceCount > f0 && torsoDist > 0) faces[faceCount - 1].dist = torsoDist - 0.04;
            }
        }
    }

    /* TPS 玩家模型：6 面 MC 分块 + 1 面竖条枪（面池 +7）；y 跟随跳跃（11.8.3） */
    function genPlayer(player) {
        setAxes(camX, camZ, player.x, player.z);
        var yb = player.y, f0;
        drawBillboard(player.x - axX * 0.12, player.z - axZ * 0.12, yb + 0.10, yb + 0.70, 0.10, palette.player, playerAlpha, true);
        drawBillboard(player.x + axX * 0.12, player.z + axZ * 0.12, yb + 0.10, yb + 0.70, 0.10, palette.player, playerAlpha, true);
        drawBillboard(player.x, player.z, yb + 0.70, yb + 1.50, 0.20, palette.player, playerAlpha, true);
        drawBillboard(player.x - axX * 0.22, player.z - axZ * 0.22, yb + 0.78, yb + 1.42, 0.07, palette.player, playerAlpha, true);
        drawBillboard(player.x + axX * 0.22, player.z + axZ * 0.22, yb + 0.78, yb + 1.42, 0.07, palette.player, playerAlpha, true);
        f0 = faceCount;
        drawBillboard(player.x, player.z, yb + 1.50, yb + 1.65, 0.16, palette.playerHead, playerAlpha, true);
        if (faceCount > f0) faces[faceCount - 1].mark = 2;
        drawBillboard(player.x + axX * 0.34, player.z + axZ * 0.34,
            yb + 0.55, yb + 1.30, 0.05, palette.gunBody, playerAlpha, false);
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
        var s = C.HOLE_SIZE * 0.5, off = C.HOLE_OFF, j, h, k, okAll, hb, b2;
        ctx.fillStyle = palette.hole;
        for (j = 0; j < C.HOLE_MAX; j++) {
            h = holes[j];
            if (!h.on) continue;
            /* 弹孔属于哪面墙：该墙被相机遮挡淡出时弹孔同步淡出，避免悬浮空中 */
            hb = 1;
            for (k = 0; k < W.boxes.length; k++) {
                b2 = W.boxes[k];
                if (h.x >= b2.minX && h.x <= b2.maxX && h.z >= b2.minZ && h.z <= b2.maxZ) { hb = wallFade[k]; break; }
            }
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
            ctx.globalAlpha = 0.85 * hb;
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
    var GUN_STOCK = [28, -22, 54, -40, 88, -34, 102, -10, 100, 12, 70, 14, 40, 4, 22, -12];
    var GUN_STOCK_HI = [28, -22, 54, -40, 88, -34, 84, -28, 52, -32, 26, -16];
    var GUN_STOCK_LO = [40, 4, 70, 14, 100, 12, 102, -10, 78, -4, 48, -10];
    var GUN_CHEEK = [48, -38, 78, -32, 84, -22, 54, -26];
    var GUN_BUTT = [100, -12, 106, -10, 108, 10, 100, 12];
    var GUN_STOCK_HOLE = [58, -20, 70, -22, 76, -10, 64, -8];
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
        holeIdx = partIdx = shellIdx = 0;
        vm.recoil = 0; vm.muzzleT = 0; vm.phase = 0; vm.lagX = 0; vm.lagY = 0; vm.aim = 0;
        for (j = 0; j < W.boxes.length; j++) wallFade[j] = 1;   /* 相机遮挡淡出复位 */
        clearFloats();
    }

    /* ── 面排序与绘制 ── */
    function sortFaces() {
        var j, key, d;
        for (i = 0; i < faceCount; i++) order[i] = i;
        for (i = 1; i < faceCount; i++) {
            key = order[i]; d = faces[key].dist; j = i - 1;
            while (j >= 0 && faces[order[j]].dist < d) { order[j + 1] = order[j]; j--; }
            order[j + 1] = key;
        }
    }

    function gatherScene(game) {
        drawSkyFloor();
        genWalls();
        genBots(game.bots);
        if (lastView === 'tps') genPlayer(game.player);
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

    /* ── 相机遮挡淡出（X-ray）：仅 TPS。挡在「相机→玩家」线段上的墙、或距相机
     * < XRAY_PROX 的墙（贴围墙时相机被钳到墙前、墙面糊满视野的场景）平滑淡到
     * XRAY_MIN；FPS 不淡出（防透视看墙后作弊）。其余遮挡保持真实近挡远。
     * 纯视图层：不改 hitscan / LOS / 相机位任何数值。 */
    function updateWallFade(dt, game) {
        var mask = 0, k, tgt, tau;
        if (lastView === 'tps') {
            mask = W.occluderMask(camX, camZ, game.player.x, game.player.z) |
                   W.nearBoxes(camX, camZ, C.XRAY_PROX);
        }
        for (k = 0; k < W.boxes.length; k++) {
            tgt = (mask & (1 << k)) ? C.XRAY_MIN : 1;
            tau = tgt < wallFade[k] ? C.XRAY_TAU : C.XRAY_REST_TAU;
            wallFade[k] += (tgt - wallFade[k]) * (1 - Math.exp(-dt / tau));
            if (wallFade[k] > 0.998) wallFade[k] = 1;
        }
    }

    /* ── Renderer 接口：endFrame ── */
    function endFrame(dt, game) {
        updateWallFade(dt, game);
        gatherScene(game);
        sortFaces();
        if (mode === 0) drawFacesTex(); else drawFacesFlat();
        drawHoles();
        drawParticles(dt);
        drawShells(dt);
        drawFloats(dt);
        drawViewmodel(dt, game);
    }

    function addFloat(x, y, z) {
        var fl = floats[floatIdx];
        fl.x = x; fl.y = y; fl.z = z; fl.life = C.FLOAT_LIFE;
        floatIdx = (floatIdx + 1) % floats.length;
    }

    function clearFloats() {
        for (i = 0; i < floats.length; i++) floats[i].life = 0;
    }

    /* ── 慢帧自适应：<45fps 先降内部分辨率一档（0.8→0.65），仍不达标再降 Renderer2DFlat ── */
    var perfT = 0, perfN = 0;
    function checkPerf(dt) {
        perfT += dt; perfN++;
        if (perfT >= 1.0) {
            if (perfN / perfT < C.FPS_MIN && mode === 0) {
                if (!scaleOverride) {
                    scaleOverride = 0.65;
                    resize();              // 内部分辨率 300×534 → 244×433（375×667 手机）
                    if (CS.HUD && CS.HUD.toast) CS.HUD.toast('已降低渲染分辨率以提升流畅度');
                } else {
                    useRenderer('flat');
                }
            }
            perfT = 0; perfN = 0;
        }
    }

    function useRenderer(name) {
        mode = name === 'flat' ? 1 : 0;
        CS.Renderer = mode ? RFlat : R2D;
    }

    function makeApi(id) {
        return {
            id: id,
            init: init, resize: resize,
            beginFrame: beginFrame, submitFace: submitFace,
            drawBillboard: drawBillboard, drawViewmodel: drawViewmodel,
            endFrame: endFrame,
            addFloat: addFloat, clearFloats: clearFloats,
            addBulletHole: addBulletHole, spawnParticles: spawnParticles,
            vmFire: vmFire, clearFx: clearFx, checkPerf: checkPerf,
            get playerAlpha() { return playerAlpha; },
            get camDist() { return camDist; },
            get wallFade() { return wallFade; },   /* QA：相机遮挡淡出状态 */
            get lastMark() { return lastMark; },   /* QA：脸部标记屏幕几何（top≤y≤bottom 应恒成立） */
            get faceCount() { return faceCount; },
            get renderScale() { return renderScale; },
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
