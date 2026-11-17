/* 反恐突袭 - 场景几何：12 个互不相交、轴对齐、y 恒定(0~WALL_H)的 AABB
 * 提供：墙射线(slab)、视线判定、圆 vs AABB 轴分离滑动碰撞、巡逻/出生点池。 */
(function (global) {
    'use strict';
    var CS = global.CS || (global.CS = {});
    var C = CS.CFG;

    /* [minX, maxX, minZ, maxZ]；4 面围墙 + 8 块掩体，两两不相交（共边贴合不算相交） */
    var RAW = [
        [-16, -15, -16, 16], [15, 16, -16, 16],
        [-15, 15, 15, 16], [-15, 15, -16, -15],
        [-12, -8, -11, -9], [4.5, 7.5, -12.5, -9.5],
        [-6, -4, -7, -1], [0.5, 5.5, -4, -2],
        [-10, -8, -0.5, 4.5], [6.5, 9.5, 1, 5],
        [-4.5, 0.5, 7, 9], [6, 10, 9, 11]
    ];

    var boxes = [], i;
    for (i = 0; i < RAW.length; i++) {
        boxes.push({ minX: RAW[i][0], maxX: RAW[i][1], minZ: RAW[i][2], maxZ: RAW[i][3] });
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

    /* 射线 vs 所有墙，返回最近正 t（无命中返回 maxT）。
     * y 板对所有盒恒为 [0, WALL_H]，与「y 恒定」约定一致。
     * v2：附带记录最近命中面的轴向(0=x,1=y,2=z)与法线分量符号，供弹孔贴花定向。 */
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
            if (!miss && Math.abs(dy) < EPS) { if (oy < 0 || oy > C.WALL_H) miss = true; }
            else if (!miss) {
                t1 = (0 - oy) / dy; t2 = (C.WALL_H - oy) / dy;
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

    /* ── 相机遮挡淡出（X-ray）几何辅助：纯查询，不改任何游戏判定 ──
     * occluderMask：线段(ax,az)→(bx,bz) 穿过的墙盒位掩码（bit k = boxes[k]）。
     * nearBoxes：点(px,pz) 到盒 2D 距离 < r 的墙盒位掩码（墙 y 全高，恒覆盖相机高度）。 */
    function occluderMask(ax, az, bx, bz) {
        var mask = 0, k, b, dx, dz, t0, t1, u0, u1, tmp;
        dx = bx - ax; dz = bz - az;
        for (k = 0; k < boxes.length; k++) {
            b = boxes[k]; t0 = 0; t1 = 1;
            if (Math.abs(dx) < EPS) { if (ax < b.minX || ax > b.maxX) continue; }
            else {
                u0 = (b.minX - ax) / dx; u1 = (b.maxX - ax) / dx;
                if (u0 > u1) { tmp = u0; u0 = u1; u1 = tmp; }
                if (u0 > t0) t0 = u0;
                if (u1 < t1) t1 = u1;
            }
            if (Math.abs(dz) < EPS) { if (az < b.minZ || az > b.maxZ) continue; }
            else {
                u0 = (b.minZ - az) / dz; u1 = (b.maxZ - az) / dz;
                if (u0 > u1) { tmp = u0; u0 = u1; u1 = tmp; }
                if (u0 > t0) t0 = u0;
                if (u1 < t1) t1 = u1;
            }
            if (t1 > t0 && t1 > 0 && t0 < 1) mask |= (1 << k);
        }
        return mask;
    }
    function boxDist2D(px, pz, b) {
        var dx = px < b.minX ? b.minX - px : (px > b.maxX ? px - b.maxX : 0);
        var dz = pz < b.minZ ? b.minZ - pz : (pz > b.maxZ ? pz - b.maxZ : 0);
        return Math.sqrt(dx * dx + dz * dz);
    }
    function nearBoxes(px, pz, r) {
        var mask = 0, k;
        for (k = 0; k < boxes.length; k++) if (boxDist2D(px, pz, boxes[k]) < r) mask |= (1 << k);
        return mask;
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
        occluderMask: occluderMask, nearBoxes: nearBoxes,
        get hitAxis() { return hitAxis; },
        get hitSign() { return hitSign; }
    };
})(window);
