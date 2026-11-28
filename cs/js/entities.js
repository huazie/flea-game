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
                engaged: false, los: false, flash: 0, hitFlash: 0,
                evadeT: 0, evadeX: 0, evadeZ: 0   /* #8 受击侧移：剩余时长 + 单位方向 */
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
            b.evadeT = 0; b.evadeX = 0; b.evadeZ = 0;
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

    /* #8 受击侧移：按玩家→Bot 连线的垂直方向设躲避单位向量，随机选左/右。
     * 只置状态不移动（移动统一在 updateBots 做，便于复用 W.move 防穿墙与 dt 钳制）。 */
    function notifyHit(b, player) {
        if (!b.alive || C.BOT_EVADE_T <= 0) return;
        var dx = b.x - player.x, dz = b.z - player.z;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d < 1e-4) { dx = Math.cos(b.facing); dz = Math.sin(b.facing); d = 1; }
        var side = Math.random() < 0.5 ? 1 : -1;
        b.evadeX = -dz / d * side;   // 垂直向量 (−dz, dx)/d
        b.evadeZ = dx / d * side;
        b.evadeT = C.BOT_EVADE_T;
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

            /* #8 受击侧移优先于巡逻：沿 notifyHit 设的垂直方向移动，用 W.move 防穿墙；
             * 时长到点自动停。LOS/开火逻辑照走，侧移不改变朝向与命中判定。 */
            var evading = b.evadeT > 0;
            if (evading) {
                var evStep = C.BOT_EVADE_SPEED * dt;
                if (evStep > b.evadeT * C.BOT_EVADE_SPEED) evStep = b.evadeT * C.BOT_EVADE_SPEED;
                W.move(b, b.evadeX * evStep, b.evadeZ * evStep);
                b.evadeT -= dt;
                if (b.evadeT < 0) b.evadeT = 0;
            }

            var ddx = player.x - b.x, ddz = player.z - b.z;
            var dist = Math.sqrt(ddx * ddx + ddz * ddz);
            var los = false;
            if (dist > 0.001 && dist <= C.BOT_RANGE) {
                var fdot = (Math.sin(b.facing) * ddx + Math.cos(b.facing) * ddz) / dist;
                if (fdot >= cosFov) {
                    /* #12：玩家端用真实插值眼位 eyeCur——蹲下(1.05)低于矮掩体顶(1.30)时
                     * LOS 被挡，Bot 失去视线；站起(1.60)越顶重新取得视线。Bot 端仍固定 1.5。 */
                    los = W.lineOfSight(b.x, C.EYE_Y - 0.1, b.z, player.x, player.eyeCur, player.z);
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
                    /* #7 声像：把开火者相对玩家的方位投影到玩家右向（cos yaw, -sin yaw），
                     * 右为正、左为负；同帧多 Bot 开火取最后发声者（距离已在上面按 dist 算好）。
                     * 只写数值到 game，不直接调 Sfx，保持实体层不依赖音频层。 */
                    game.botFirePan = ((b.x - player.x) * Math.cos(player.yaw)
                        - (b.z - player.z) * Math.sin(player.yaw)) / dist;
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
                if (!b.engaged && !evading) {
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
    var hitT = 0, hitHead = false;
    function hitScan(bots, ox, oy, oz, dx, dy, dz, wallT) {
        var best = wallT, idx = -1, i, b;
        hitHead = false;
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
            /* 部位判定：命中高度 ≥ BOT_SPLIT（1.50，MC 头块底缘）即爆头 */
            hitHead = py >= C.BOT_SPLIT;
        }
        hitT = best;
        return idx;
    }

    CS.Entities = {
        createBots: createBots, spawnWave: spawnWave, aliveCount: aliveCount,
        updateBots: updateBots, hitScan: hitScan, notifyHit: notifyHit,
        get hitT() { return hitT; },
        get hitHead() { return hitHead; }
    };
})(window);
