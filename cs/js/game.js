/* 反恐突袭 - 主循环与状态机：menu / playing / paused / over
 * 全部射速、换弹、Bot 开火、波间整备按累计 dt 计时（dt 上限 0.05s），不按帧计数。
 * v2：玩家引入 y 轴（跳/蹲），射线固定从实际眼位 (x, y+eyeCur, z) 发出，与相机位完全解耦。 */
(function (global) {
    'use strict';
    var CS = global.CS || (global.CS = {});
    var C = CS.CFG, U = CS.Util, W = CS.World, E = CS.Entities;
    var Sfx = CS.Sfx;

    var BEST_KEY = 'cs_best';
    function getBest() { try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; } }
    function setBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* 忽略 */ } }

    function Game() {
        var self = this;
        this.canvas = document.getElementById('cs-canvas');
        this.stage = document.getElementById('cs-stage');
        this.player = { x: 0, z: 0, y: 0, vy: 0, vx: 0, vz: 0, yaw: 0, pitch: 0,
            kick: 0, kickT: 0, onGround: true, crouch: false,
            eyeCur: C.EYE_STAND, eyeFrom: C.EYE_STAND, eyeTarget: C.EYE_STAND,
            eyeT: 0, eyePend: -1,
            hp: C.PLAYER_HP, ammo: C.MAG, reloading: false, reloadT: 0, fireT: 0 };
        this.bots = E.createBots();
        this.state = 'menu';
        this.viewMode = 'fps';
        this.last = 0;
        this.lastPaint = 0; this.fpsT = 0; this.fpsN = 0;
        /* ADR-50 帧诊断：处理帧间隔 ring（呈现抖动证据）+ 帧执行耗时 ring（JS 侧开销），
         * 供 checkPerf 高刷降档判定与 FPS 块长按诊断读数 */
        this.deltaRing = new Float32Array(90); this.deltaIdx = 0; this.deltaFill = 0;
        this.costRing = new Float32Array(90); this.costIdx = 0; this.costFill = 0;
        this.lastLookDX = 0; this.lastLookDY = 0;
        this.boundFrame = this.frame.bind(this);
        this.boundAction = this.onAction.bind(this);
        CS.game = this;   // 供 QA/自动化驱动（不持有渲染状态，仅暴露编排实例）

        CS.Renderer.init(this.canvas, this.stage);
        CS.HUD.init({
            start: function () { self.start(); },
            resume: function () { self.resume(); },
            restart: function () { self.start(); },
            menu: function () { self.toMenu(); },
            view: function () { self.toggleView(); },
            touch: function () {
                /* 仍在同一点击手势链路内：先请求全屏+锁横屏，再进编辑态，
                 * 保证布局编辑器按横屏视口呈现（游戏实际游玩朝向） */
                if (global.CS.Orientation) global.CS.Orientation.onConfig();
                if (global.CS.TouchCfg) global.CS.TouchCfg.enter();
            }
        });
        CS.Input.init(this.canvas, this.stage, this.boundAction);
        if (global.CS.TouchCfg) global.CS.TouchCfg.init();   /* 触屏：加载并应用已保存的按钮布局 */

        this.resetRun();
        CS.HUD.showMenu(this.best, this.viewMode);
        this.bindGlobal();
        /* 评论懒加载兜底：主菜单停留 5s 未开局也加载（浏览评论区）；已开局则跳过，留给结算触发 */
        global.setTimeout(function () {
            if (self.state === 'menu' && global.__csCommentsLazy) global.__csCommentsLazy();
        }, 5000);
        CS.Orientation.init(this);
        this.renderStatic();
        global.requestAnimationFrame(this.boundFrame);
    }

    Game.prototype.resetRun = function () {
        var p = this.player;
        p.x = 0; p.z = 0; p.y = 0; p.vy = 0; p.vx = 0; p.vz = 0;
        p.yaw = 0; p.pitch = 0; p.kick = 0; p.kickT = 0;
        p.onGround = true; p.crouch = false;
        p.eyeCur = p.eyeFrom = p.eyeTarget = C.EYE_STAND;
        p.eyeT = 0; p.eyePend = -1;
        p.hp = C.PLAYER_HP; p.ammo = C.MAG;
        p.reloading = false; p.reloadT = 0; p.fireT = 0;
        this.waveIdx = 0; this.intermission = 0;
        this.score = 0; this.kills = 0; this.shotsFired = 0; this.shotsHit = 0;
        this.elapsed = 0; this.moveSpeed = 0; this.spreadDeg = 0;
        this.landT = 0; this.stepAccum = 0;
        this.pendingDamage = 0; this.shooterSlots = 0; this.botFired = false; this.botFirePan = 0;
        this.best = getBest();
        W.randomize();                     // #13：每局重新随机布局（位置 + 4 矮 4 高），原地复用 box 对象
        E.spawnWave(this.bots, 0);
        CS.Renderer.clearFx();             // 清掉上一局布局的弹孔/弹壳/特效，避免贴花悬浮在新墙上
        CS.Renderer.resetPerf();           // #16：新局重置档位试探/锁定，重新试探当前设备可用档位
        CS.HUD.reset();
    };

    Game.prototype.renderStatic = function () {
        CS.Renderer.beginFrame(this.player, this.viewMode);
        CS.Renderer.endFrame(0, this);
    };

    /* ── 状态切换 ── */
    Game.prototype.start = function () {
        this.resetRun();
        this.state = 'playing';
        document.body.classList.add('cs-in-game');   /* 游戏中：隐藏站点分享/评论 FAB */
        CS.Renderer.resize();                  // 布局此刻必已就绪，修正 init 期的瞬态尺寸
        CS.HUD.setScreen('hud');
        CS.Input.setEnabled(true);
        CS.Input.reset();
        Sfx.resume();                          // 首次手势链路里 resume AudioContext
        this.last = global.performance.now();
        if (!CS.Input.isTouch) CS.Input.requestLock();
        Sfx.wave();
        CS.Orientation.onStart();              // 仍在同一手势链路内：请求全屏 + 锁横屏 + 竖屏引导
    };

    Game.prototype.pause = function () {
        if (this.state !== 'playing') return;
        this.state = 'paused';
        CS.Input.setEnabled(false);          // 顺带清空输入，冻结 dt 不补算
        CS.HUD.setScreen('pause');
        this.last = global.performance.now();
        if (document.pointerLockElement) {
            try { document.exitPointerLock(); } catch (e) { /* 忽略 */ }
        }
    };

    Game.prototype.resume = function () {
        if (this.state !== 'paused') return;
        if (CS.Orientation.isBlocking()) return;   // 竖屏引导期间不允许绕过遮罩恢复
        this.state = 'playing';
        CS.Renderer.resize();
        CS.HUD.setScreen('hud');
        CS.Input.setEnabled(true);
        CS.Input.reset();
        Sfx.resume();                           // 切后台会让 AudioContext suspended，恢复须重新 resume，否则音符堆积卡音频线程
        this.last = global.performance.now();   // 恢复须主动点「继续」，禁止累计大 dt 补算
        if (!CS.Input.isTouch) CS.Input.requestLock();
    };

    Game.prototype.toMenu = function () {
        this.state = 'menu';
        document.body.classList.remove('cs-in-game');
        CS.Orientation.stop();
        CS.Input.setEnabled(false);
        if (document.pointerLockElement) {
            try { document.exitPointerLock(); } catch (e) { /* 忽略 */ }
        }
        this.resetRun();
        CS.HUD.showMenu(this.best, this.viewMode);
        if (global.__csCommentsLazy) global.__csCommentsLazy();   // 回主菜单同样触发评论懒加载
        this.renderStatic();
    };

    Game.prototype.toggleView = function () {
        this.viewMode = this.viewMode === 'fps' ? 'tps' : 'fps';
        CS.HUD.setView(this.viewMode, true);
        Sfx.view();
        if (this.state !== 'playing') this.renderStatic();
        /* 仅相机位与模型显隐变化：射击/换弹/受击/计时/射线/数值一律不中断，无无敌帧 */
    };

    Game.prototype.finish = function (win) {
        this.state = 'over';
        document.body.classList.remove('cs-in-game');   /* 结算页恢复分享/评论 FAB */
        CS.Orientation.stop();
        CS.Input.setEnabled(false);           // 死亡/通关立即冻结输入与波次生成
        if (document.pointerLockElement) {
            try { document.exitPointerLock(); } catch (e) { /* 忽略 */ }
        }
        var best = getBest(), isNew = this.score > best;
        if (isNew) { setBest(this.score); best = this.score; }
        this.best = best;
        CS.HUD.showResult(this, win, isNew);
        if (win) Sfx.win(); else Sfx.lose();
        if (global.__csCommentsLazy) global.__csCommentsLazy();   // 结算时才加载评论（弱机游玩期间不抢主线程）
    };

    Game.prototype.onAction = function (code) {
        switch (code) {
            case 'jump': if (this.state === 'playing') this.tryJump(); break;
            case 'reload': if (this.state === 'playing') this.startReload(false); break;
            case 'view': this.toggleView(); break;
            case 'pauseToggle':
                if (this.state === 'playing') this.pause();
                else if (this.state === 'paused') this.resume();
                break;
            case 'locklost': if (this.state === 'playing') this.pause(); break;
            case 'confirm':
                if (this.state === 'menu' || this.state === 'over') this.start();
                else if (this.state === 'paused') this.resume();
                break;
        }
    };

    /* ── 跳跃：落地即可再跳；蹲跳 ×0.85；不翻越掩体（x/z 碰撞不变）── */
    Game.prototype.tryJump = function () {
        var p = this.player;
        if (!p.onGround) return;
        p.vy = p.crouch ? C.JUMP_V * C.CROUCH_JUMP_MUL : C.JUMP_V;
        p.onGround = false;
        this.stepAccum = 0;
        Sfx.jump();
    };

    /* ── 逐帧逻辑 ── */
    Game.prototype.applyLook = function () {
        var dx = CS.Input.lookDX, dy = CS.Input.lookDY;
        this.lastLookDX = dx; this.lastLookDY = dy;   // 供视图模型 lag 采样
        CS.Input.lookDX = 0; CS.Input.lookDY = 0;
        if (dx || dy) {
            this.player.yaw += dx;
            this.player.pitch = U.clamp(this.player.pitch - dy, -C.PITCH_LIMIT, C.PITCH_LIMIT);
        }
    };

    /* 地面维持 v1 直接置速；空中按 3.6 m/s² 向期望速度加速；重力 12 m/s² */
    Game.prototype.applyMove = function (dt) {
        var p = this.player;
        p.crouch = CS.Input.crouch;
        var ix = CS.Input.moveX, iz = CS.Input.moveZ;
        var mag = Math.sqrt(ix * ix + iz * iz);
        if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }
        var yaw = p.yaw, sy = Math.sin(yaw), cy = Math.cos(yaw);
        var spd = CS.Input.aim ? C.AIM_WALK : (p.crouch ? C.CROUCH_SPEED : (CS.Input.sprint ? C.SPRINT : C.WALK));
        if (p.onGround) {
            var vx = (sy * iz + cy * ix) * spd * mag;
            var vz = (cy * iz - sy * ix) * spd * mag;
            if (mag > 0) W.move(p, vx * dt, vz * dt);
            p.vx = vx; p.vz = vz;
            this.moveSpeed = spd * mag;
            /* 脚步声：步频 = 速度/步幅（4.0 m/s ÷ 1.8 m ≈ 2.2 Hz），仅地面 */
            if (this.moveSpeed > 0.5) {
                this.stepAccum += this.moveSpeed * dt;
                if (this.stepAccum >= C.FOOTSTRIDE) { this.stepAccum -= C.FOOTSTRIDE; Sfx.footstep(); }
            } else this.stepAccum = 0;
        } else {
            var dvx = (sy * iz + cy * ix) * spd * mag;
            var dvz = (cy * iz - sy * ix) * spd * mag;
            var axd = dvx - p.vx, azd = dvz - p.vz;
            var al = Math.sqrt(axd * axd + azd * azd);
            var amax = C.AIR_ACCEL * dt;
            if (al > amax && al > 0) { axd = axd / al * amax; azd = azd / al * amax; }
            p.vx += axd; p.vz += azd;
            W.move(p, p.vx * dt, p.vz * dt);
            this.moveSpeed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
        }
        /* 垂直：跳跃不改 x/z 碰撞、不支持站上 AABB 顶面（y>=0 即落地） */
        if (!p.onGround) {
            p.vy -= C.GRAVITY * dt;
            p.y += p.vy * dt;
            if (p.y <= 0) {
                this.landV = -p.vy;
                p.y = 0; p.vy = 0; p.onGround = true;
                this.landT = C.LAND_DECAY;          // 落地散布窗口
                Sfx.land(this.landV);
            }
        }
        this.updateEye(dt);
        this.updateSpread(dt);
    };

    /* 蹲眼位 1.60↔1.05 平滑 0.15s；过渡期反向输入排队，过渡结束才执行 */
    Game.prototype.updateEye = function (dt) {
        var p = this.player;
        var target = p.crouch ? C.EYE_CROUCH : C.EYE_STAND;
        if (p.eyeT > 0) {
            p.eyeT -= dt;
            if (target !== p.eyeTarget && target !== p.eyePend) p.eyePend = target;
            if (p.eyeT <= 0) {
                p.eyeCur = p.eyeTarget; p.eyeT = 0;
                if (p.eyePend >= 0 && p.eyePend !== p.eyeTarget) {
                    p.eyeFrom = p.eyeCur; p.eyeTarget = p.eyePend; p.eyeT = C.EYE_TRANS;
                }
                p.eyePend = -1;
            } else {
                var f = 1 - p.eyeT / C.EYE_TRANS;
                p.eyeCur = p.eyeFrom + (p.eyeTarget - p.eyeFrom) * f;
            }
        } else if (p.eyeCur !== target) {
            p.eyeFrom = p.eyeCur; p.eyeTarget = target; p.eyeT = C.EYE_TRANS;
        }
    };

    /* 散布模型：空中 ±12（Shift 无效）＞落地 ±10→0（0.30s 线性）＞蹲/步行/Shift 档位 */
    Game.prototype.updateSpread = function (dt) {
        var p = this.player;
        if (!p.onGround) { this.spreadDeg = C.AIR_SPREAD; return; }
        if (this.landT > 0) {
            this.landT -= dt;
            if (this.landT < 0) this.landT = 0;
        }
        var base;
        if (CS.Input.aim) base = 0;
        else if (p.crouch) base = this.moveSpeed > C.MOVE_EPS ? C.CROUCH_SPREAD : 0;
        else base = this.moveSpeed > C.MOVE_EPS ? C.SPREAD_DEG : 0;
        if (p.eyeT > 0) base += C.CROUCH_SPREAD;    // 蹲起过渡 +1.0
        var landS = this.landT > 0 ? C.LAND_SPREAD * (this.landT / C.LAND_DECAY) : 0;
        this.spreadDeg = base > landS ? base : landS;
    };

    Game.prototype.tickTimers = function (dt) {
        var p = this.player;
        if (p.fireT > 0) p.fireT -= dt;
        if (!CS.Input.firing && p.fireT < 0) p.fireT = 0;
        if (p.fireT < -C.FIRE_INTERVAL) p.fireT = -C.FIRE_INTERVAL;
        if (p.kickT > 0) {                          // 后坐视觉状态 0.15s 线性回落（不进命中射线）
            p.kickT -= dt;
            if (p.kickT <= 0) { p.kickT = 0; p.kick = 0; }
            else p.kick = C.KICK_RAD * (p.kickT / C.KICK_TIME);
        }
        if (p.reloading) {                          // 跳中换弹允许，计时继续
            p.reloadT -= dt;
            if (p.reloadT <= 0) {
                p.reloading = false; p.reloadT = 0; p.ammo = C.MAG;
                Sfx.reloadDone();
            }
        }
    };

    Game.prototype.startReload = function (auto) {
        var p = this.player;
        if (p.reloading) return;              // 换弹期间重复输入不排队第二次计时
        if (p.ammo >= C.MAG) return;          // 弹匣已满忽略
        p.reloading = true; p.reloadT = C.RELOAD_TIME;
        if (auto) { CS.HUD.flashAmmo(); Sfx.empty(); }
        else Sfx.reload();
    };

    Game.prototype.tryShoot = function () {
        var p = this.player;
        if (!CS.Input.firing || p.reloading) return;
        if (p.ammo <= 0) { this.startReload(true); return; }   // 空仓：不发射/不消耗/不计空枪分
        if (p.fireT > 0) return;
        p.fireT += C.FIRE_INTERVAL;
        p.ammo--;
        this.shotsFired++;
        p.kickT = C.KICK_TIME; p.kick = C.KICK_RAD;   // 后坐状态保留（仅视图模型视觉，不进命中射线）
        this.doHitscan();
        Sfx.shoot();
        CS.HUD.flashMuzzle();
        CS.Renderer.vmFire(this);
    };

    /* hitscan：沿屏幕中心准星射线发出（相机位 + 相机前向，含 pitch + 散布，不含后坐 kick）。
     * 此前从「眼位 + yaw/pitch」发出与相机解耦，但 TPS 相机在右后上方看向 FOCUS 聚焦点，
     * 近距离准星与弹道有 0.16~0.25m 垂直视差——准星瞄头、弹道落脖子甚至打空。
     * 改用 Renderer.aimRay 使所见即所得：后坐 kick 不进射线，远距离不再上飘打飞头、
     * 打墙弹孔不再偏高；后坐视觉由 viewmodel 独立承担（ADR-45）。 */
    Game.prototype.doHitscan = function () {
        var ray = CS.Renderer.aimRay(this.player, this.viewMode);
        var fx = ray.dx, fy = ray.dy, fz = ray.dz;
        var rx = ray.rx, ry = ray.ry, rz = ray.rz;
        var ux = ray.ux, uy = ray.uy, uz = ray.uz;
        var dx = fx, dy = fy, dz = fz;
        if (this.spreadDeg > 0) {
            var a = (Math.random() * 2 - 1) * this.spreadDeg * Math.PI / 180;
            var b = (Math.random() * 2 - 1) * this.spreadDeg * Math.PI / 180;
            var ta = Math.tan(a), tb = Math.tan(b);
            dx = fx + rx * ta + ux * tb;
            dy = fy + ry * ta + uy * tb;
            dz = fz + rz * ta + uz * tb;
        }
        var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        dx /= len; dy /= len; dz /= len;
        var ox = ray.ox, oy = ray.oy, oz = ray.oz;
        var wallT = W.rayWalls(ox, oy, oz, dx, dy, dz, C.FAR);   // 先判墙
        var idx = E.hitScan(this.bots, ox, oy, oz, dx, dy, dz, wallT); // 再判 Bot 公告板，取最近
        if (idx < 0) {
            if (wallT < C.FAR) {
                var hx = ox + dx * wallT, hy = oy + dy * wallT, hz = oz + dz * wallT;
                var hnx = W.hitAxis === 0 ? W.hitSign : 0;
                var hny = W.hitAxis === 1 ? W.hitSign : 0;
                var hnz = W.hitAxis === 2 ? W.hitSign : 0;
                CS.Renderer.addBulletHole(hx, hy, hz, W.hitAxis, W.hitSign);
                CS.Renderer.spawnParticles(hx, hy, hz, hnx, hny, hnz, 8, 0);
                Sfx.hitWall();
            }
            return;
        }
        this.shotsHit++;
        this.score += C.SCORE_HIT;
        var b = this.bots[idx];
        /* 部位伤害：头部（py ≥ BOT_SPLIT）走 DMG_HEAD，≥ BOT_HP 一枪击杀 */
        b.hp -= E.hitHead ? C.DMG_HEAD : C.DMG;
        b.hitFlash = 0.12;
        if (b.hp > 0) E.notifyHit(b, this.player);   /* #8 未击杀才侧移，避免静止靶；击杀后 bot 直接消失 */
        CS.Renderer.spawnParticles(ox + dx * E.hitT, oy + dy * E.hitT, oz + dz * E.hitT,
            -dx, 0.2, -dz, 10, 1);
        Sfx.hitBot();
        if (b.hp <= 0) {
            b.hp = 0; b.alive = false;
            this.kills++; this.score += C.SCORE_KILL;
            CS.Renderer.addFloat(b.x, C.BOT_SPLIT, b.z);
            CS.Renderer.addDeath(b.x, b.z);   /* #9 倒地消散，纯 ctx 不占面池 */
            Sfx.kill();
            if (E.hitHead) CS.HUD.toast('爆头击杀');
        }
    };

    Game.prototype.applyDamage = function (dmg) {
        var p = this.player;
        p.hp -= dmg;
        if (p.hp < 0) p.hp = 0;               // HP 下限 0
        CS.HUD.flashHurt();
        Sfx.hurt();
        if (p.hp <= 0) this.finish(false);
    };

    Game.prototype.checkWave = function (dt) {
        if (this.intermission > 0) {
            this.intermission -= dt;
            if (this.intermission <= 0) {
                this.intermission = 0;
                this.waveIdx++;
                E.spawnWave(this.bots, this.waveIdx);
                Sfx.wave();
            }
            return;
        }
        if (E.aliveCount(this.bots) > 0) return;
        if (this.waveIdx >= 2) { this.finish(true); return; }   // 3 波清场 = 通关
        this.intermission = C.WAVE_GAP;
        var p = this.player;
        p.ammo = C.MAG;                       // 整备：补满弹匣
        p.reloading = false; p.reloadT = 0;
        p.hp = Math.min(C.PLAYER_HP, p.hp + C.WAVE_HEAL);  // +20 上限 100，不重置位置
        Sfx.wave();
    };

    Game.prototype.update = function (dt) {
        this.elapsed += dt;
        this.applyLook();
        this.applyMove(dt);
        this.tickTimers(dt);
        this.shooterSlots = 0; this.pendingDamage = 0; this.botFired = false; this.botFirePan = 0;
        E.updateBots(this.bots, this.player, this, dt);
        if (this.botFired) Sfx.botFire(this.botFirePan);
        if (this.pendingDamage > 0) this.applyDamage(this.pendingDamage); // 同帧伤害统一判定
        if (this.state !== 'playing') return;   // 死亡立即冻结输入与波次生成
        this.tryShoot();
        this.checkWave(dt);
    };

    Game.prototype.frame = function (now) {
        global.requestAnimationFrame(this.boundFrame);
        if (this.state !== 'playing') { this.last = now; this.lastPaint = 0; return; }  // 暂停/失焦停帧，冻结 dt
        /* 跳帧去抖：间隔 <8ms 的 rAF 帧跳过（dt 自然累计、DT_MAX 钳制）。
         * 阈值必须远小于最矮目标帧间隔——此前用 15ms 会把 90Hz(11.1ms)/75Hz(13.3ms) 的
         * 每一帧都误判为「过快」而跳过，导致 90Hz→45fps、75Hz→38fps（用户真机卡的根因）。
         * 8ms 让 60/75/90/120Hz 各跑满原生刷新率；极端 144Hz(6.9ms) 跳成 72fps 仍流畅。
         * 负载兜底交 checkPerf：<45fps 自动降分辨率→Flat，无需靠限帧牺牲高刷体验。 */
        if (this.lastPaint && now - this.lastPaint < 8) return;
        if (this.lastPaint) {
            this.deltaRing[this.deltaIdx] = now - this.lastPaint;
            this.deltaIdx = (this.deltaIdx + 1) % this.deltaRing.length;
            if (this.deltaFill < this.deltaRing.length) this.deltaFill++;
        }
        this.lastPaint = now;
        var rawDt = (now - this.last) / 1000;
        var dt = rawDt;
        this.last = now;
        if (dt > C.DT_MAX) dt = C.DT_MAX;      // 极端 dt 钳制，高刷设备一致
        if (dt <= 0) return;
        /* ADR-53：FPS 统计必须用未钳制的真实间隔——dt 被 DT_MAX(0.05s) 钳制会让 >50ms 的
         * 卡顿帧只记 50ms，报告 FPS 存在 20fps 硬地板且恒≥真实值，误导「FPS 90=渲染健康」。
         * rawDt 已自然包含 8ms 跳帧门累积的时间（该门在 this.last 更新前 return）。 */
        this.fpsT += rawDt; this.fpsN++;       /* 实测帧率：0.5s 窗口汇报 HUD，供真机诊断 */
        if (this.fpsT >= 0.5) {
            CS.HUD.setFps(Math.round(this.fpsN / this.fpsT)); this.fpsT = 0; this.fpsN = 0;
            /* #15 只读探针：复用 0.5s 汇报节奏读渲染快照，不改任何游戏状态 */
            if (CS.Renderer.perfProbe) CS.HUD.setPerfProbe(CS.Renderer.perfProbe);
        }
        var t0 = performance.now();
        this.update(dt);
        CS.Renderer.checkPerf(dt, this);       // <45fps 或呈现间隔 p90 超刷新预算 1.5× 自动降档（ADR-50）
        CS.Renderer.beginFrame(this.player, this.viewMode);
        CS.Renderer.endFrame(dt, this);
        CS.HUD.update(dt, this);
        this.costRing[this.costIdx] = performance.now() - t0;
        this.costIdx = (this.costIdx + 1) % this.costRing.length;
        if (this.costFill < this.costRing.length) this.costFill++;
    };

    /* 帧诊断统计：处理帧间隔中位数（≈屏幕刷新率）与 p90（呈现抖动）、帧执行耗时 p90（JS 侧）。
     * 真机呈现层开销（Canvas 光栅化/合成）不在 JS 耗时里，只能由 rAF 间隔抖动反映——这正是
     * 桌面探针测不到、真机「FPS 显示 60~80 但体感卡」的关键证据位。 */
    Game.prototype.diagCost = function () {
        var i, a = [], b = [];
        for (i = 0; i < this.deltaFill; i++) a.push(this.deltaRing[i]);
        for (i = 0; i < this.costFill; i++) b.push(this.costRing[i]);
        a.sort(function (x, y) { return x - y; });
        b.sort(function (x, y) { return x - y; });
        var q = function (arr, p) { return arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0; };
        var med = q(a, 0.5);
        return { hz: med > 0 ? Math.round(1000 / med) : 60, deltaP90: q(a, 0.9), costP90: q(b, 0.9) };
    };

    Game.prototype.bindGlobal = function () {
        var self = this;
        global.addEventListener('blur', function () { if (self.state === 'playing') self.pause(); });
        document.addEventListener('visibilitychange', function () {
            if (document.hidden && self.state === 'playing') self.pause();
        });
        document.addEventListener('themeChanged', function () {
            if (self.state !== 'playing') self.renderStatic();
        });
        global.addEventListener('resize', function () {
            CS.Renderer.resize();
            if (self.state !== 'playing') self.renderStatic();
        });

        var sb = document.getElementById('sound-button');
        var icon = sb.querySelector('i');
        function paint(on) {
            icon.classList.toggle('fa-volume-high', on);
            icon.classList.toggle('fa-volume-xmark', !on);
            sb.title = on ? '关闭音效' : '开启音效';
        }
        paint(Sfx.isEnabled());
        sb.addEventListener('click', function () {
            var on = Sfx.toggle();
            paint(on);
            if (on) Sfx.view();
        });
    };

    new Game();
})(window);
