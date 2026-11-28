/* 反恐突袭 - 场景几何：12 个互不相交、轴对齐的 AABB（围墙 y∈[0,WALL_H]，内部掩体 y∈[0,COVER_H]）
 * 提供：墙射线(slab)、视线判定、圆 vs AABB 轴分离滑动碰撞、巡逻/出生点池。
 * #12：内部掩体用 COVER_H(1.30) 矮墙，蹲眼 1.05 被挡、站眼 1.60 越顶——蹲下掩护/站起反击。 */
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
        /* #12：前 4 块是外围墙（全高 WALL_H），其余内部掩体为矮墙 COVER_H。
         * 高度进 box.h，rayWalls/绘制按各自高度取 y 板，碰撞(move)仍与 y 无关。 */
        boxes.push({ minX: RAW[i][0], maxX: RAW[i][1], minZ: RAW[i][2], maxZ: RAW[i][3],
            h: i < 4 ? C.WALL_H : C.COVER_H });
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
        get hitAxis() { return hitAxis; },
        get hitSign() { return hitSign; }
    };
})(window);
