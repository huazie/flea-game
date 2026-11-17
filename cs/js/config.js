/* 反恐突袭 - 全局常量与纯函数工具（零依赖，须最先加载）
 * 数值基线全部来自 docs/design-brief.md 第 6 节，禁止在其它文件散落魔法数字。 */
(function (global) {
    'use strict';
    var CS = global.CS || (global.CS = {});

    CS.CFG = {
        PLAYER_HP: 100, DMG: 40, MAG: 8,
        FIRE_INTERVAL: 0.20, RELOAD_TIME: 1.4,
        WALK: 4.0, SPRINT: 6.0, AIM_WALK: 1.8,
        SPREAD_DEG: 3.0, MOVE_EPS: 0.2,
        FOV_DEG: 75, PITCH_LIMIT: 60 * Math.PI / 180,
        NEAR: 0.1, FAR: 60, DT_MAX: 0.05,
        EYE_Y: 1.6, WALL_H: 3.0, RADIUS: 0.4,
        BOT_HP: 80, BOT_DMG: 8, BOT_FIRE_INTERVAL: 1.2,
        BOT_MAX_SHOOTERS: 2, BOT_RANGE: 18,
        BOT_HALF_FOV: 60 * Math.PI / 180, BOT_SPEED: 1.6,
        LOSE_SIGHT: 2.0,
        WAVE_COUNTS: [3, 4, 5], WAVE_ACC: [0.35, 0.45, 0.55],
        WAVE_GAP: 2.0, WAVE_HEAL: 20,
        SCORE_KILL: 100, SCORE_HIT: 10,
        /* 越肩第三人称：BACK 拉远让角色变小、SHOULDER 右移让出准星、UP 抬高俯视、FOCUS 准星与弹道重合距离 */
        TPS_BACK: 3.2, TPS_UP: 0.50, TPS_MIN: 0.3, TPS_SHOULDER: 0.38, TPS_FOCUS: 7,
        /* 相机遮挡淡出（X-ray，仅 TPS）：挡在相机→玩家线段上、或距相机 < PROX 的墙
         * 平滑淡到 MIN，其余遮挡保持真实近挡远；FPS 不淡出（防透视看墙后作弊）。
         * TAU 快速淡出 / REST_TAU 缓慢恢复。纯视图层，不改 hitscan/LOS 数值。 */
        XRAY_MIN: 0.16, XRAY_TAU: 0.07, XRAY_REST_TAU: 0.22, XRAY_PROX: 1.0,
        LOOK_SENS: 0.0022, TOUCH_SENS: 0.005, JOY_RADIUS: 48,
        BOT_Y0: 0.10, BOT_Y1: 1.85, BOT_SPLIT: 1.50,
        BOT_HALF_W: 0.32, BOT_HEAD_HALF_W: 0.20,
        FLOAT_LIFE: 0.85, HURT_TIME: 0.20, VIEW_HI_TIME: 0.60,
        /* ── v2（design-brief 第 11 节，数值不得擅改）── */
        JUMP_V: 4.5, CROUCH_JUMP_MUL: 0.85, GRAVITY: 12, AIR_ACCEL: 3.6,
        AIR_SPREAD: 12, LAND_SPREAD: 10, LAND_DECAY: 0.30,
        EYE_STAND: 1.60, EYE_CROUCH: 1.05, EYE_TRANS: 0.15,
        CROUCH_SPEED: 2.0, CROUCH_SPREAD: 1.0, FOOTSTRIDE: 1.8,
        KICK_RAD: 1.2 * Math.PI / 180, KICK_TIME: 0.15,
        SWAY_AMP: 6, SWAY_HZ: 1.6, LAG_DELAY: 0.06, LAG_MAX: 10, LAG_TAU: 0.15,
        RECOIL_UP: 12, RECOIL_BACK: 4, RECOIL_TAU: 0.10,
        VM_ANCHOR_X: 0.72, VM_ANCHOR_Y: 0.85,
        VM_DROP: 40, VM_ROT: 25, VM_TILT: -0.12,
        /* 开火时枪口朝向射击方向（屏幕准星）：几何角自适应横竖屏，GAIN 控制抬起幅度；
         * TAU 快速抬起 / REST_TAU 缓慢落回。 */
        VM_AIM_GAIN: 0.58, VM_AIM_TAU: 0.06, VM_REST_TAU: 0.16,
        RELOAD_DOWN: 0.25, RELOAD_HOLD: 0.90, RELOAD_UP: 0.25,
        MUZZLE_TIME: 0.04, SHELL_LIFE: 0.5,
        PARTICLE_MAX: 64, SHELL_MAX: 8, HOLE_MAX: 32,
        HOLE_SIZE: 0.06, HOLE_OFF: 0.01,
        FOG_START: 10, FOG_RANGE: 40, FPS_MIN: 45
    };

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    /* 仅接受 #rgb / #rrggbb；按 f 缩放通道。解析失败原样返回。
     * 只在主题刷新时调用，绝不在逐帧热路径里执行。 */
    function shade(c, f) {
        c = (c || '').trim();
        var r, g, b;
        if (c.charAt(0) !== '#') return c;
        if (c.length === 4) {
            r = parseInt(c.charAt(1) + c.charAt(1), 16);
            g = parseInt(c.charAt(2) + c.charAt(2), 16);
            b = parseInt(c.charAt(3) + c.charAt(3), 16);
        } else if (c.length >= 7) {
            r = parseInt(c.substr(1, 2), 16);
            g = parseInt(c.substr(3, 2), 16);
            b = parseInt(c.substr(5, 2), 16);
        } else { return c; }
        if (isNaN(r) || isNaN(g) || isNaN(b)) return c;
        r = Math.round(clamp(r * f, 0, 255));
        g = Math.round(clamp(g * f, 0, 255));
        b = Math.round(clamp(b * f, 0, 255));
        return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    }

    CS.Util = { clamp: clamp, shade: shade };
})(window);
