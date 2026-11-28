/* 反恐突袭 - 场景几何：12 个互不相交、轴对齐的 AABB（4 围墙固定 + 8 内部盒每局随机）
 * 提供：墙射线(slab)、视线判定、圆 vs AABB 轴分离滑动碰撞、巡逻/出生点池。
 * #12 矮掩体蹲挡站反击（蹲眼 1.05 / 站眼 1.60 之间取 COVER_H=1.30）。
 * #13 随机布局：内部 8 盒每局拒绝采样撒点，4 矮掩体 + 4 全高墙，随机分配位置与高度。 */
(function (global) {
    'use strict';
    var CS = global.CS || (global.CS = {});
    var C = CS.CFG;

    /* [minX, maxX, minZ, maxZ]；4 面围墙固定。内部 8 盒由 randomize() 每局生成（见下）。 */
    var WALLS = [
        [-16, -15, -16, 16], [15, 16, -16, 16],
        [-15, 15, 15, 16], [-15, 15, -16, -15]
    ];
    /* 兜底静态布局：随机采样失败（极端约束冲突）时用，保证任何设备都能开局。
     * 4 矮(COVER_H) + 4 全高(WALL_H)，两两不相交，已验证出生/巡逻点不落盒内。 */
    var FALLBACK = [
        [-12, -8, -11, -9, C.COVER_H], [4.5, 7.5, -12.5, -9.5, C.WALL_H],
        [-6, -4, -7, -1, C.COVER_H], [0.5, 5.5, -4, -2, C.WALL_H],
        [-10, -8, -0.5, 4.5, C.COVER_H], [6.5, 9.5, 1, 5, C.WALL_H],
        [-4.5, 0.5, 7, 9, C.COVER_H], [6, 10, 9, 11, C.WALL_H]
    ];

    /* 12 个 box 对象一次性分配、就地复用：渲染器持有 boxes 引用且按索引分纹理，
     * 每局只改坐标/h，绝不重建数组或替换对象，零分配、面数恒定。 */
    var boxes = [], i;
    for (i = 0; i < WALLS.length; i++) {
        boxes.push({ minX: WALLS[i][0], maxX: WALLS[i][1], minZ: WALLS[i][2], maxZ: WALLS[i][3], h: C.WALL_H });
    }
    for (i = 0; i < C.LAYOUT_INNER; i++) {
        boxes.push({ minX: 0, maxX: 0, minZ: 0, maxZ: 0, h: C.COVER_H });
    }

    var SPAWN_RAW = [
        [-12, 3], [12, -6], [-1, -12], [11, 12], [-12, -2],
        [5, 12], [12, 7], [-7, 12], [2, -12]
    ];
    var spawns = [], waypoints = [];
    for (i = 0; i < SPAWN_RAW.length; i++) {
        spawns.push({ x: SPAWN_RAW[i][0], z: SPAWN_RAW[i][1] });
        waypoints.push({ x: SPAWN_RAW[i][0], z: SPAWN_RAW[i][1] });
    }
    /* 追加若干开阔走廊点，保证每个巡逻点可单次绕行可达 */
    var EXTRA = [[0, 5], [-14, 8], [13, 0], [0, -8], [-3, 13], [9, -6]];
    for (i = 0; i < EXTRA.length; i++) {
        waypoints.push({ x: EXTRA[i][0], z: EXTRA[i][1] });
    }

    var shuffle = new Int32Array(spawns.length);
    for (i = 0; i < shuffle.length; i++) shuffle[i] = i;

    function pickSpawns(n, out) {
        var j, tmp;
        for (i = shuffle.length - 1; i > 0; i--) {
            j = Math.floor(Math.random() * (i + 1));
            tmp = shuffle[i]; shuffle[i] = shuffle[j]; shuffle[j] = tmp;
        }
        for (i = 0; i < n && i < shuffle.length; i++) out[i] = shuffle[i];
    }

    function randomWaypoint() { return Math.floor(Math.random() * waypoints.length); }

    /* ── #13 随机布局生成 ──
     * 内部 8 盒：拒绝采样撒点，两两留 GAP、避开出生/巡逻点、玩家出生点周围留空，
     * 再做 BFS 栅格连通校验（所有 waypoint 与玩家出生点连通）；随机挑 4 块为矮掩体。
     * seed 可传（QA 复现），不传用时间种子。最多 N 轮采样，失败回退 FALLBACK 静态布局。 */
    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    var ARENA = 15 - C.LAYOUT_MARGIN;      /* 内部盒中心可用范围 ±(15-margin)，盒半宽再内缩 */

    function pointClear(x, z, rnd) {
        /* 玩家出生点(0,0) + 所有出生/巡逻点：盒(含 rnd 外扩)不得覆盖这些点 */
        var pts = waypoints, k, p, dx, dz;
        if (Math.abs(x) < C.LAYOUT_SPAWN_CLEAR && Math.abs(z) < C.LAYOUT_SPAWN_CLEAR) {
            if (Math.abs(x) - rnd < C.LAYOUT_SPAWN_CLEAR && Math.abs(z) - rnd < C.LAYOUT_SPAWN_CLEAR) return false;
        }
        for (k = 0; k < pts.length; k++) {
            p = pts[k];
            dx = Math.abs(x - p.x) - rnd; dz = Math.abs(z - p.z) - rnd;
            if (dx < C.LAYOUT_POINT_CLEAR && dz < C.LAYOUT_POINT_CLEAR) return false;
        }
        return true;
    }

    /* 栅格 BFS：0.5m 网格，盒体(含 RADIUS)视为障碍；检查玩家出生点与所有巡逻点同一连通块。 */
    function connected(cands) {
        var cell = 0.5, n = 62, half = 15.5;   /* 坐标 [-15.5,15.5) → 62 格 */
        var blocked = new Uint8Array(n * n), k, c, gx, gz;
        for (k = 0; k < cands.length; k++) {
            c = cands[k];
            var x0 = Math.max(0, Math.floor((c.minX - C.RADIUS + half) / cell));
            var x1 = Math.min(n - 1, Math.floor((c.maxX + C.RADIUS + half) / cell));
            var z0 = Math.max(0, Math.floor((c.minZ - C.RADIUS + half) / cell));
            var z1 = Math.min(n - 1, Math.floor((c.maxZ + C.RADIUS + half) / cell));
            for (gz = z0; gz <= z1; gz++) for (gx = x0; gx <= x1; gx++) blocked[gz * n + gx] = 1;
        }
        var start = Math.floor(half / cell) * n + Math.floor(half / cell);
        if (blocked[start]) return false;
        var seen = new Uint8Array(n * n), queue = new Int32Array(n * n), head = 0, tail = 0;
        queue[tail++] = start; seen[start] = 1;
        while (head < tail) {
            var cur = queue[head++], cx = cur % n, cz = (cur - cx) / n;
            var nb = [cx > 0 ? cur - 1 : -1, cx < n - 1 ? cur + 1 : -1,
                      cz > 0 ? cur - n : -1, cz < n - 1 ? cur + n : -1];
            for (k = 0; k < 4; k++) {
                var q = nb[k];
                if (q >= 0 && !seen[q] && !blocked[q]) { seen[q] = 1; queue[tail++] = q; }
            }
        }
        for (k = 0; k < waypoints.length; k++) {
            var p = waypoints[k];
            gx = Math.floor((p.x + half) / cell); gz = Math.floor((p.z + half) / cell);
            if (gx < 0 || gz < 0 || gx >= n || gz >= n) continue;
            if (!seen[gz * n + gx]) return false;
        }
        return true;
    }

    var layoutSeed = 0;        /* 本次实际使用的种子，QA 可读取复现 */
    var layoutFallback = false; /* 本次是否走了兜底布局 */
    function randomize(seed) {
        layoutSeed = seed == null ? ((Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0) : (seed >>> 0);
        var rnd = mulberry32(layoutSeed), cands = [], ok = false, round, attempt, w, d, x, z, c, k, clash;
        /* 多轮尝试：每轮独立撒 8 盒，任一满足约束 + 连通即采用 */
        for (round = 0; round < 60 && !ok; round++) {
            cands.length = 0;
            attempt = 0;
            while (cands.length < C.LAYOUT_INNER && attempt < 400) {
                attempt++;
                w = C.LAYOUT_W_MIN + rnd() * (C.LAYOUT_W_MAX - C.LAYOUT_W_MIN);
                d = C.LAYOUT_D_MIN + rnd() * (C.LAYOUT_D_MAX - C.LAYOUT_D_MIN);
                x = -ARENA + rnd() * (2 * (ARENA - w));
                z = -ARENA + rnd() * (2 * (ARENA - d));
                if (!pointClear(x, z, Math.max(w, d) * 0.5)) continue;
                c = { minX: x, maxX: x + w, minZ: z, maxZ: z + d, h: C.WALL_H };
                clash = false;
                for (k = 0; k < cands.length; k++) {
                    var o = cands[k];
                    if (c.minX < o.maxX + C.LAYOUT_GAP && c.maxX > o.minX - C.LAYOUT_GAP &&
                        c.minZ < o.maxZ + C.LAYOUT_GAP && c.maxZ > o.minZ - C.LAYOUT_GAP) { clash = true; break; }
                }
                if (!clash) cands.push(c);
            }
            if (cands.length === C.LAYOUT_INNER && connected(cands)) ok = true;
        }
        layoutFallback = !ok;
        var src = ok ? cands : FALLBACK;
        for (k = 0; k < C.LAYOUT_INNER; k++) {
            var b = boxes[WALLS.length + k], s = src[k];
            b.minX = s[0] != null ? s[0] : s.minX; b.maxX = s[1] != null ? s[1] : s.maxX;
            b.minZ = s[2] != null ? s[2] : s.minZ; b.maxZ = s[3] != null ? s[3] : s.maxZ;
            b.h = s[4] != null ? s[4] : s.h;
        }
        /* 随机挑 LAYOUT_COVERS 块为矮掩体：Fisher-Yates 洗牌索引后取前 N */
        var idx = [], tmp;
        for (k = 0; k < C.LAYOUT_INNER; k++) idx[k] = k;
        for (k = idx.length - 1; k > 0; k--) {
            var j = Math.floor(rnd() * (k + 1)); tmp = idx[k]; idx[k] = idx[j]; idx[j] = tmp;
        }
        for (k = 0; k < C.LAYOUT_COVERS; k++) boxes[WALLS.length + idx[k]].h = C.COVER_H;
        return { seed: layoutSeed, fallback: layoutFallback };
    }
    randomize();   /* 首屏静态画面也需要有效布局 */

    /* 射线 vs 所有墙，返回最近正 t（无命中返回 maxT）。
     * #12 y 板按每盒 b.h：外围墙 WALL_H(3.0)，内部掩体 COVER_H(1.30)。
     * 于是蹲眼 1.05 的射线过不了矮掩体、站眼 1.60 可越顶——LOS 与弹道同时生效。
     * 附带记录最近命中面的轴向(0=x,1=y,2=z)与法线符号，供弹孔贴花定向。 */
    var EPS = 1e-8;
    var hitAxis = -1, hitSign = 0;
    function rayWalls(ox, oy, oz, dx, dy, dz, maxT) {
        var best = maxT, k, b, tmax, t1, t2, tmp, miss;
        var ex, ey, ez, bAxis = -1, bSign = 0;
        for (k = 0; k < boxes.length; k++) {
            b = boxes[k]; tmax = best; miss = false;
            ex = 0; ey = 0; ez = 0;
            if (Math.abs(dx) < EPS) { if (ox < b.minX || ox > b.maxX) miss = true; }
            else {
                t1 = (b.minX - ox) / dx; t2 = (b.maxX - ox) / dx;
                if (t1 > t2) { tmp = t1; t1 = t2; t2 = tmp; }
                if (t1 > ex) ex = t1;
                if (t2 < tmax) tmax = t2;
            }
            if (!miss && Math.abs(dy) < EPS) { if (oy < 0 || oy > b.h) miss = true; }
            else if (!miss) {
                t1 = (0 - oy) / dy; t2 = (b.h - oy) / dy;
                if (t1 > t2) { tmp = t1; t1 = t2; t2 = tmp; }
                if (t1 > ey) ey = t1;
                if (t2 < tmax) tmax = t2;
            }
            if (!miss && Math.abs(dz) < EPS) { if (oz < b.minZ || oz > b.maxZ) miss = true; }
            else if (!miss) {
                t1 = (b.minZ - oz) / dz; t2 = (b.maxZ - oz) / dz;
                if (t1 > t2) { tmp = t1; t1 = t2; t2 = tmp; }
                if (t1 > ez) ez = t1;
                if (t2 < tmax) tmax = t2;
            }
            if (!miss) {
                var tminEff = ex;
                if (ey > tminEff) tminEff = ey;
                if (ez > tminEff) tminEff = ez;
                if (tminEff >= 0 && tminEff <= tmax && tminEff < best) {
                    best = tminEff;
                    if (ex >= ey && ex >= ez) { bAxis = 0; bSign = dx > 0 ? -1 : 1; }
                    else if (ey >= ez) { bAxis = 1; bSign = dy > 0 ? -1 : 1; }
                    else { bAxis = 2; bSign = dz > 0 ? -1 : 1; }
                }
            }
        }
        hitAxis = bAxis; hitSign = bSign;
        return best;
    }

    /* 两点之间无墙遮挡（用于 Bot 视线） */
    function lineOfSight(ax, ay, az, bx, by, bz) {
        var dx = bx - ax, dy = by - ay, dz = bz - az;
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-4) return true;
        return rayWalls(ax, ay, az, dx / d, dy / d, dz / d, d) >= d - 0.02;
    }

    /* 圆(r=RADIUS) vs AABB：按 x / z 轴分离推出，形成贴墙滑动。直接改写 ent.x / ent.z。 */
    function move(ent, dx, dz) {
        var r = C.RADIUS, k, b, nx = ent.x + dx, nz = ent.z + dz;
        if (dx !== 0) {
            for (k = 0; k < boxes.length; k++) {
                b = boxes[k];
                if (nx + r > b.minX && nx - r < b.maxX &&
                    ent.z + r > b.minZ && ent.z - r < b.maxZ) {
                    nx = dx > 0 ? b.minX - r : b.maxX + r;
                }
            }
        }
        ent.x = nx;
        if (dz !== 0) {
            for (k = 0; k < boxes.length; k++) {
                b = boxes[k];
                if (ent.x + r > b.minX && ent.x - r < b.maxX &&
                    nz + r > b.minZ && nz - r < b.maxZ) {
                    nz = dz > 0 ? b.minZ - r : b.maxZ + r;
                }
            }
        }
        ent.z = nz;
    }

    CS.World = {
        boxes: boxes, spawns: spawns, waypoints: waypoints,
        pickSpawns: pickSpawns, randomWaypoint: randomWaypoint,
        rayWalls: rayWalls, lineOfSight: lineOfSight, move: move,
        randomize: randomize,
        get layoutSeed() { return layoutSeed; },
        get layoutFallback() { return layoutFallback; },
        get hitAxis() { return hitAxis; },
        get hitSign() { return hitSign; }
    };
})(window);
