/* 反恐突袭 - 实体：Bot 对象池 + 低开销状态机 + hitscan 公告板判定
 * 状态机：巡逻 → 取得视线(停步/每 1.2s 尝试开火) → 失视线 2.0s 重选巡逻点。 */
(function (global) {
    'use strict';
    var CS = global.CS || (global.CS = {});
    var C = CS.CFG, W = CS.World;

    var MAX_BOTS = 5;
    var spawnIdx = new Int32Array(MAX_BOTS);

    function createBots() {
        var a = [], i;
        for (i = 0; i < MAX_BOTS; i++) {
            a.push({
                x: 0, z: 0, hp: 0, alive: false,
                facing: 0, patrol: 0, fireT: 0, noSightT: 0,
                engaged: false, los: false, flash: 0, hitFlash: 0
            });
        }
        return a;
    }

    function spawnWave(bots, waveIdx) {
        var n = C.WAVE_COUNTS[waveIdx], i, b, s, wp;
        W.pickSpawns(n, spawnIdx);
        for (i = 0; i < bots.length; i++) {
            b = bots[i];
            b.alive = i < n;
            b.hp = C.BOT_HP;
            b.flash = 0; b.hitFlash = 0;
            b.engaged = false; b.los = false;
            b.fireT = Math.random() * C.BOT_FIRE_INTERVAL; // 错峰，避免首轮齐射
            b.noSightT = 0;
            b.patrol = W.randomWaypoint();
            if (!b.alive) continue;
            s = W.spawns[spawnIdx[i]];
            b.x = s.x; b.z = s.z;
            wp = W.waypoints[b.patrol];
            b.facing = Math.atan2(wp.x - b.x, wp.z - b.z);
        }
    }

    function aliveCount(bots) {
        var n = 0, i;
        for (i = 0; i < bots.length; i++) if (bots[i].alive) n++;
        return n;
    }

    /* 逐帧 Bot 更新。伤害只累加到 game.pendingDamage，由主循环统一结算（同帧多次命中规则）。 */
    function updateBots(bots, player, game, dt) {
        var acc = C.WAVE_ACC[game.waveIdx], i, b;
        var cosFov = Math.cos(C.BOT_HALF_FOV);
        for (i = 0; i < bots.length; i++) {
            b = bots[i];
            if (!b.alive) continue;
            if (b.flash > 0) { b.flash -= dt; if (b.flash < 0) b.flash = 0; }
            if (b.hitFlash > 0) { b.hitFlash -= dt; if (b.hitFlash < 0) b.hitFlash = 0; }

            var ddx = player.x - b.x, ddz = player.z - b.z;
            var dist = Math.sqrt(ddx * ddx + ddz * ddz);
            var los = false;
            if (dist > 0.001 && dist <= C.BOT_RANGE) {
                var fdot = (Math.sin(b.facing) * ddx + Math.cos(b.facing) * ddz) / dist;
                if (fdot >= cosFov) {
                    los = W.lineOfSight(b.x, C.EYE_Y - 0.1, b.z, player.x, C.EYE_Y, player.z);
                }
            }

            if (los) {
                b.engaged = true; b.los = true; b.noSightT = 0;
                b.facing = Math.atan2(ddx, ddz);
                b.fireT += dt;
                if (b.fireT >= C.BOT_FIRE_INTERVAL && game.shooterSlots < C.BOT_MAX_SHOOTERS) {
                    b.fireT -= C.BOT_FIRE_INTERVAL;
                    game.shooterSlots++;
                    b.flash = 0.09;
                    game.botFired = true;
                    if (Math.random() < acc) game.pendingDamage += C.BOT_DMG;
                } else if (b.fireT > C.BOT_FIRE_INTERVAL * 2) {
                    b.fireT = C.BOT_FIRE_INTERVAL * 2;
                }
            } else {
                b.los = false;
                b.noSightT += dt;
                /* 连续 2.0s 无玩家视线就重选巡逻点：既覆盖「取得视线后丢失」，
                 * 也覆盖「从未取得视线且卡在墙角」的情况，杜绝波次无法结束。 */
                if (b.noSightT >= C.LOSE_SIGHT) {
                    b.noSightT = 0; b.engaged = false;
                    b.patrol = W.randomWaypoint();
                }
                if (!b.engaged) {
                    var wp = W.waypoints[b.patrol];
                    var wx = wp.x - b.x, wz = wp.z - b.z;
                    var wl = Math.sqrt(wx * wx + wz * wz);
                    if (wl < 0.6) {
                        b.patrol = W.randomWaypoint();
                        wp = W.waypoints[b.patrol];
                        wx = wp.x - b.x; wz = wp.z - b.z;
                        wl = Math.sqrt(wx * wx + wz * wz);
                    }
                    if (wl > 0.001) {
                        b.facing = Math.atan2(wx, wz);
                        var step = C.BOT_SPEED * dt;
                        if (step > wl) step = wl;
                        W.move(b, wx / wl * step, wz / wl * step);
                    }
                }
            }
        }
    }

    /* hitscan 第二段：先取墙距 wallT，再逐 Bot 求「公告板矩形」交点，取最近者。
     * 公告板为面向射手的竖直矩形（法线 n = 射手 - Bot 的水平单位向量）。 */
    var hitT = 0;
    function hitScan(bots, ox, oy, oz, dx, dy, dz, wallT) {
        var best = wallT, idx = -1, i, b;
        for (i = 0; i < bots.length; i++) {
            b = bots[i];
            if (!b.alive) continue;
            var nx = ox - b.x, nz = oz - b.z;
            var nl = Math.sqrt(nx * nx + nz * nz);
            if (nl < 1e-4) continue;
            nx /= nl; nz /= nl;
            var ux = -nz, uz = nx;
            var denom = dx * nx + dz * nz;
            if (Math.abs(denom) < 1e-6) continue;
            var t = ((b.x - ox) * nx + (b.z - oz) * nz) / denom;
            if (t < C.NEAR || t >= best) continue;
            var px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
            if (py < C.BOT_Y0 || py > C.BOT_Y1) continue;
            var u = (px - b.x) * ux + (pz - b.z) * uz;
            if (u < -C.BOT_HALF_W || u > C.BOT_HALF_W) continue;
            best = t; idx = i;
        }
        hitT = best;
        return idx;
    }

    CS.Entities = {
        createBots: createBots, spawnWave: spawnWave, aliveCount: aliveCount,
        updateBots: updateBots, hitScan: hitScan,
        get hitT() { return hitT; }
    };
})(window);
