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
            dist: 0, color: '', alpha: 1, stroke: false, tex: -1, shade: 1, fog: 0 });
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
        wallX: new Array(3), wallZ: new Array(3)
    };

    var canvas, ctx, stage, cssW = 1, cssH = 1, focal = 1, renderScale = 1;
    var camX = 0, camY = 0, camZ = 0;
    var fX = 0, fY = 0, fZ = 1, rX = 1, rY = 0, rZ = 0, uX = 0, uY = 1, uZ = 0;
    var px = 0, py = C.EYE_Y, pz = 0;
    var lastPitch = 0, lastView = 'fps';
    var playerAlpha = 1, camDist = 0;
    var axX = 1, axZ = 0;   // 公告板水平轴（由相机方向算出）

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
        renderScale = (coarse || cssW < 700) ? 0.8 : 1;
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

        var bx = -Math.sin(yaw) * C.TPS_BACK;
        var by = C.TPS_UP;
        var bz = -Math.cos(yaw) * C.TPS_BACK;
        var len = Math.sqrt(bx * bx + by * by + bz * bz);
        var dx = bx / len, dy = by / len, dz = bz / len;
        var hit = W.rayWalls(px, py, pz, dx, dy, dz, len);
        camDist = hit < len ? Math.max(C.TPS_MIN, hit - 0.15) : len;
        camX = px + dx * camDist;
        camY = py + dy * camDist;
        camZ = pz + dz * camDist;
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
        f.tex = tex; f.shade = shade;
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
        var boxes = W.boxes, k, b, cx, cz, t, colX, colZ;
        while (boxCount < boxes.length) { boxTex[boxCount] = boxCount < 4 ? 0 : (boxCount % 2 ? 2 : 1); boxCount++; }
        for (k = 0; k < boxes.length; k++) {
            b = boxes[k];
            cx = (b.minX + b.maxX) * 0.5; cz = (b.minZ + b.maxZ) * 0.5;
            t = mode === 0 ? boxTex[k] : -1;
            colX = mode === 0 ? palette.wallA : palette.wallX[k % 3];
            colZ = mode === 0 ? palette.wallB : palette.wallZ[k % 3];
            if (camX > b.maxX) {
                setQ(0, b.maxX, 0, b.minZ); setQ(1, b.maxX, C.WALL_H, b.minZ);
                setQ(2, b.maxX, C.WALL_H, b.maxZ); setQ(3, b.maxX, 0, b.maxZ);
                addFace(colX, 1, true, t, mode === 0 ? shadeO[0] : 1, b.maxX, C.WALL_H * 0.5, cz);
            }
            if (camX < b.minX) {
                setQ(0, b.minX, 0, b.maxZ); setQ(1, b.minX, C.WALL_H, b.maxZ);
                setQ(2, b.minX, C.WALL_H, b.minZ); setQ(3, b.minX, 0, b.minZ);
                addFace(colX, 1, true, t, mode === 0 ? shadeO[1] : 1, b.minX, C.WALL_H * 0.5, cz);
            }
            if (camZ > b.maxZ) {
                setQ(0, b.minX, 0, b.maxZ); setQ(1, b.minX, C.WALL_H, b.maxZ);
                setQ(2, b.maxX, C.WALL_H, b.maxZ); setQ(3, b.maxX, 0, b.maxZ);
                addFace(colZ, 1, true, t, mode === 0 ? shadeO[4] : 1, cx, C.WALL_H * 0.5, b.maxZ);
            }
            if (camZ < b.minZ) {
                setQ(0, b.maxX, 0, b.minZ); setQ(1, b.maxX, C.WALL_H, b.minZ);
                setQ(2, b.minX, C.WALL_H, b.minZ); setQ(3, b.minX, 0, b.minZ);
                addFace(colZ, 1, true, t, mode === 0 ? shadeO[5] : 1, cx, C.WALL_H * 0.5, b.minZ);
            }
            if (camY > C.WALL_H) {
                setQ(0, b.minX, C.WALL_H, b.minZ); setQ(1, b.minX, C.WALL_H, b.maxZ);
                setQ(2, b.maxX, C.WALL_H, b.maxZ); setQ(3, b.maxX, C.WALL_H, b.minZ);
                addFace(palette.wallTop, 1, true, t, mode === 0 ? shadeO[2] : 1, cx, C.WALL_H, cz);
            }
        }
    }

    function genBots(bots) {
        var k, b;
        for (k = 0; k < bots.length; k++) {
            b = bots[k];
            if (!b.alive) continue;
            setAxes(camX, camZ, b.x, b.z);
            var col = b.hitFlash > 0 ? palette.botHit : palette.bot;
            drawBillboard(b.x, b.z, C.BOT_Y0, C.BOT_SPLIT, C.BOT_HALF_W, col, 1, true);
            drawBillboard(b.x, b.z, C.BOT_SPLIT, C.BOT_Y1, C.BOT_HEAD_HALF_W, palette.botHead, 1, true);
            if (b.flash > 0) {
                drawBillboard(b.x + axX * 0.30, b.z + axZ * 0.30,
                    1.05, 1.25, 0.10, palette.muzzle, 1, false);
            }
        }
    }

    /* TPS 玩家模型：2 面公告板 + 1 面竖条枪（3D 面池 +1）；y 跟随跳跃（11.8.3） */
    function genPlayer(player) {
        setAxes(camX, camZ, player.x, player.z);
        var yb = player.y;
        drawBillboard(player.x, player.z, yb + 0.10, yb + 1.35, 0.28, palette.player, playerAlpha, true);
        drawBillboard(player.x, player.z, yb + 1.35, yb + 1.65, 0.16, palette.playerHead, playerAlpha, true);
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
    var vm = { phase: 0, lagX: 0, lagY: 0, recoil: 0, muzzleT: 0 };
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

    /* ── 枪械视图模型：屏幕空间 5 多边形，不占 3D 面池 ── */
    var GUN_BARREL = [-150, -66, -40, -78, -40, -56, -150, -48];
    var GUN_BODY = [-44, -82, 20, -82, 30, -18, 16, 6, -30, 6, -44, -38];
    var GUN_SIGHT = [-104, -88, -78, -88, -78, -76, -104, -76];
    var GUN_GRIP = [-4, 4, 18, 4, 28, 46, 6, 54];
    var GUN_MAG = [-34, 4, -8, 6, -14, 56, -38, 48];
    var MUZ_X = -150, MUZ_Y = -57;

    function fillPoly(pts, col) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (var k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
        ctx.closePath();
        ctx.fill();
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
        ctx.save();
        ctx.translate(ax + swayX + vm.lagX + back * 0.5, ay - C.RECOIL_UP * vm.recoil + vm.lagY + back * 0.5 + C.VM_DROP * rf);
        ctx.rotate((C.VM_TILT + C.VM_ROT * rf * Math.PI / 180));
        ctx.scale(vs * (1 - 0.05 * vm.recoil), vs * (1 - 0.05 * vm.recoil));
        fillPoly(GUN_BARREL, palette.gunDark);
        fillPoly(GUN_BODY, palette.gunBody);
        fillPoly(GUN_MAG, palette.gunDark);
        fillPoly(GUN_GRIP, palette.gunDark);
        fillPoly(GUN_SIGHT, palette.gunSight);
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
        vm.recoil = 0; vm.muzzleT = 0; vm.phase = 0; vm.lagX = 0; vm.lagY = 0;
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
        }
        ctx.globalAlpha = 1;
    }

    /* ── Renderer 接口：endFrame ── */
    function endFrame(dt, game) {
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

    /* ── <45fps 自动切换 Renderer2DFlat ── */
    var perfT = 0, perfN = 0;
    function checkPerf(dt) {
        perfT += dt; perfN++;
        if (perfT >= 1.0) {
            if (perfN / perfT < C.FPS_MIN && mode === 0) useRenderer('flat');
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
            get faceCount() { return faceCount; },
            get renderScale() { return renderScale; },
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
