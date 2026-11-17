/* 反恐突袭 - 输入层：键鼠 / Pointer Lock / 移动端虚拟摇杆与触控
 * 只产出「意图」(moveX/moveZ/lookDX/lookDY/firing/aim/sprint/crouch) 与离散动作码，不持有游戏状态。 */
(function (global) {
    'use strict';
    var CS = global.CS || (global.CS = {});
    var C = CS.CFG;

    var canvas, stage, onAction, enabled = false;
    var keys = { w: false, a: false, s: false, d: false };
    var keyX = 0, keyZ = 0, joyX = 0, joyZ = 0;
    var lookDX = 0, lookDY = 0, firing = false, aim = false, sprint = false;
    /* 开火三槽：鼠标左键 / 右下主开火 / 左下副开火。各自记 pointerId，
     * 任一下按即 firing，抬指只清自身——三指操作时左右开火互不误停。 */
    var mouseFiring = false;
    var fireSlot = { id: -1 }, fireLeftSlot = { id: -1 };
    /* 瞄准两来源：触控「瞄准镜头」点击切换锁存(aimToggle) + PC 右键按住(aimHold)。
     * 触控点击后一直保持，再点取消；右键抬起只清自身，不误清触控锁存。 */
    var aimToggle = false, aimHold = false;
    var crouchKey = false, crouchTouch = false, crouchBtn;
    var dragging = false, lastCX = 0, lastCY = 0, wasLocked = false;
    var lookId = -1, lookLX = 0, lookLY = 0;
    var joyId = -1, joyCX = 0, joyCY = 0;
    var lookBeat = 0, joyBeat = 0;   /* 心跳：最后一次 down/move 时刻，用于 stale 检测 */
    var lookZone, joystick, knob, fireBtn, fireLeftBtn, aimBtn;

    function syncFire() { firing = mouseFiring || fireSlot.id !== -1 || fireLeftSlot.id !== -1; }
    function syncAim() { aim = aimToggle || aimHold; }
    /* 与 CSS 的 (pointer: coarse) 保持一致：触屏笔记本主指针仍是鼠标，应走 Pointer Lock */
    var mq = global.matchMedia && global.matchMedia('(pointer: coarse)');
    var isTouch = mq ? mq.matches : ((navigator.maxTouchPoints > 0) || ('ontouchstart' in global));

    function syncMove() {
        moveX = keyX + joyX; moveZ = keyZ + joyZ;
        if (moveX < -1) moveX = -1; else if (moveX > 1) moveX = 1;
        if (moveZ < -1) moveZ = -1; else if (moveZ > 1) moveZ = 1;
    }
    var moveX = 0, moveZ = 0;

    function syncKeys() {
        keyX = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
        keyZ = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
        syncMove();
    }

    function hasLock() { return document.pointerLockElement === canvas; }

    function requestLock() {
        if (isTouch || !canvas || !canvas.requestPointerLock) return;
        try {
            var p = canvas.requestPointerLock();
            if (p && p.catch) p.catch(function () { /* 拒绝时退化为拖拽转视角 */ });
        } catch (e) { /* 忽略 */ }
    }

    function isUI(target) {
        if (!target || !target.closest) return false;
        return !!target.closest('button, .overlay, .tbtn, .floating-buttons, .hud-view');
    }

    function onKeyDown(e) {
        var c = e.code || e.key || '';
        switch (c) {
            case 'KeyW': case 'ArrowUp': case 'w': case 'W': keys.w = true; break;
            case 'KeyS': case 'ArrowDown': case 's': case 'S': keys.s = true; break;
            case 'KeyA': case 'ArrowLeft': case 'a': case 'A': keys.a = true; break;
            case 'KeyD': case 'ArrowRight': case 'd': case 'D': keys.d = true; break;
            case 'ShiftLeft': case 'ShiftRight': case 'Shift': sprint = true; break;
            case 'ControlLeft': case 'ControlRight': case 'KeyC': case 'c': case 'C':
                crouchKey = true; break;
            case 'KeyR': case 'r': case 'R': if (!e.repeat) onAction('reload'); break;
            case 'KeyV': case 'v': case 'V': if (!e.repeat) onAction('view'); break;
            case 'KeyP': case 'p': case 'P': case 'Escape': if (!e.repeat) onAction('pauseToggle'); break;
            case 'Enter': if (!e.repeat) onAction('confirm'); break;
            case ' ': case 'Space':
                if (!e.repeat) { onAction('jump'); onAction('confirm'); }
                break;
            default: return;
        }
        syncKeys();
        /* 可拦截键一律 preventDefault（Ctrl+S/D/F 等冲突键）；Ctrl+W 关标签无法拦截为已知限制 */
        if (c.indexOf && c.indexOf('Escape') !== 0 && c !== 'Enter' && c !== ' ' && c !== 'Space') {
            e.preventDefault();
        }
        if (e.ctrlKey && c !== 'Escape') e.preventDefault();
    }

    function onKeyUp(e) {
        var c = e.code || e.key || '';
        switch (c) {
            case 'KeyW': case 'ArrowUp': case 'w': case 'W': keys.w = false; break;
            case 'KeyS': case 'ArrowDown': case 's': case 'S': keys.s = false; break;
            case 'KeyA': case 'ArrowLeft': case 'a': case 'A': keys.a = false; break;
            case 'KeyD': case 'ArrowRight': case 'd': case 'D': keys.d = false; break;
            case 'ShiftLeft': case 'ShiftRight': case 'Shift': sprint = false; break;
            case 'ControlLeft': case 'ControlRight': case 'KeyC': case 'c': case 'C':
                crouchKey = false; break;
            default: return;
        }
        syncKeys();
    }

    function onMouseDown(e) {
        if (!enabled || isUI(e.target)) return;
        if (e.button === 2) {               // 右键按住瞄准（contextmenu 已全局禁用）
            aimHold = true; syncAim(); e.preventDefault(); return;
        }
        if (e.button !== 0) return;
        mouseFiring = true; syncFire(); dragging = true;
        lastCX = e.clientX; lastCY = e.clientY;
        if (!hasLock()) requestLock();
        e.preventDefault();
    }

    function onMouseMove(e) {
        lastCX = e.clientX; lastCY = e.clientY;
        if (!enabled) return;
        if (hasLock()) {
            lookDX += (e.movementX || 0) * C.LOOK_SENS;
            lookDY += (e.movementY || 0) * C.LOOK_SENS;
        } else if (dragging) {
            lookDX += (e.movementX || 0) * C.LOOK_SENS;
            lookDY += (e.movementY || 0) * C.LOOK_SENS;
        }
    }

    function onMouseUp(e) {
        if (e && e.button === 2) { aimHold = false; syncAim(); return; }
        mouseFiring = false; syncFire(); dragging = false;
    }

    function onLockChange() {
        if (hasLock()) { wasLocked = true; return; }
        if (wasLocked) {
            wasLocked = false; mouseFiring = false; syncFire();
            dragging = false; aimHold = false; syncAim(); onAction('locklost');
        }
    }

    /* ── 触控 ── */
    function onLookDown(e) {
        if (e.pointerType === 'mouse' || !enabled || lookId !== -1) return;
        lookId = e.pointerId; lookLX = e.clientX; lookLY = e.clientY; lookBeat = nowMs();
        try { lookZone.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        e.preventDefault();
    }
    function onLookMove(e) {
        if (e.pointerId !== lookId) return;
        lookBeat = nowMs();
        lookDX += (e.clientX - lookLX) * C.TOUCH_SENS;
        lookDY += (e.clientY - lookLY) * C.TOUCH_SENS;
        lookLX = e.clientX; lookLY = e.clientY;
        e.preventDefault();
    }
    function onLookUp(e) { if (e.pointerId === lookId) lookId = -1; }

    /* ── 全局 pointer 抬指兜底：真机上元素级 pointerup/cancel 偶发丢失（系统手势抢捕获、
     * 指针捕获被转移、多指同时抬起事件合并），会让 lookId/joyId/开火槽永久停在旧 ID，
     * 后续所有手指被 onLookDown/onJoyDown 的 `id !== -1` 判定挡掉 → 摇杆/转向卡死。
     * 在 document 上按 pointerId 无条件清理（冒泡必经），元素级监听保留做即时响应。
     * 注意：瞄准镜头是点击切换锁存，抬指不清除（刻意保持），故不在此处理。 ── */
    function onGlobalPointerEnd(e) {
        if (e.pointerId === lookId) lookId = -1;
        if (e.pointerId === joyId) {
            joyId = -1; joyX = 0; joyZ = 0;
            setKnob(0, 0); syncMove();
        }
        if (e.pointerId === fireSlot.id) { fireSlot.id = -1; syncFire(); }
        if (e.pointerId === fireLeftSlot.id) { fireLeftSlot.id = -1; syncFire(); }
    }
    function onLostCapture(e) {
        if (e.target === lookZone && e.pointerId === lookId) lookId = -1;
        if (e.target === joystick && e.pointerId === joyId) {
            joyId = -1; joyX = 0; joyZ = 0;
            setKnob(0, 0); syncMove();
        }
        if (e.target === fireBtn && e.pointerId === fireSlot.id) { fireSlot.id = -1; syncFire(); }
        if (e.target === fireLeftBtn && e.pointerId === fireLeftSlot.id) { fireLeftSlot.id = -1; syncFire(); }
    }

    function setKnob(dx, dy) {
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    function nowMs() { return global.performance && performance.now ? performance.now() : Date.now(); }

    function onJoyDown(e) {
        if (e.pointerType === 'mouse' || !enabled || joyId !== -1) return;
        var r = joystick.getBoundingClientRect();
        joyCX = r.left + r.width * 0.5; joyCY = r.top + r.height * 0.5;
        joyId = e.pointerId; joyBeat = nowMs();
        try { joystick.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        updateJoy(e.clientX, e.clientY);
        e.preventDefault();
    }
    function updateJoy(cx, cy) {
        var dx = cx - joyCX, dy = cy - joyCY;
        var l = Math.sqrt(dx * dx + dy * dy);
        if (l < 5) {                       // 归中即静止，散布强制 0°
            joyX = 0; joyZ = 0; dx = 0; dy = 0;
        } else {
            if (l > C.JOY_RADIUS) { dx *= C.JOY_RADIUS / l; dy *= C.JOY_RADIUS / l; }
            joyX = dx / C.JOY_RADIUS; joyZ = -dy / C.JOY_RADIUS;
        }
        setKnob(dx, dy);
        syncMove();
    }
    function onJoyMove(e) {
        if (e.pointerId !== joyId) return;
        joyBeat = nowMs();
        updateJoy(e.clientX, e.clientY);
        e.preventDefault();
    }
    function onJoyUp(e) {
        if (e.pointerId !== joyId) return;
        joyId = -1; joyX = 0; joyZ = 0;
        setKnob(0, 0); syncMove();
    }

    /* 开火键通用绑定：左右两个按钮各持独立槽位与 pointerId。
     * 同键第二指不覆盖首指；另一键抬指也不影响本槽——三指连按时互不误停火。
     * 与开镜一致不走 stale：长按连发 >2s 且手指不动不应被误清。 */
    function bindFire(btn, slot) {
        if (!btn) return;
        btn.addEventListener('pointerdown', function (e) {
            if (!enabled || slot.id !== -1) return;
            slot.id = e.pointerId;
            syncFire();
            e.preventDefault();
        });
        function release(e) {
            if (e && slot.id !== -1 && e.pointerId !== slot.id) return;
            if (slot.id === -1) return;
            slot.id = -1;
            syncFire();
        }
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
        btn.addEventListener('pointerleave', release);
    }

    function init(canvasEl, stageEl, actionCb) {
        canvas = canvasEl; stage = stageEl; onAction = actionCb;
        lookZone = document.getElementById('look-zone');
        joystick = document.getElementById('joystick');
        knob = document.getElementById('joy-knob');
        fireBtn = document.getElementById('btn-fire');
        fireLeftBtn = document.getElementById('btn-fire-left');

        global.addEventListener('keydown', onKeyDown);
        global.addEventListener('keyup', onKeyUp);
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        document.addEventListener('pointerlockchange', onLockChange);

        lookZone.addEventListener('pointerdown', onLookDown);
        lookZone.addEventListener('pointermove', onLookMove);
        lookZone.addEventListener('pointerup', onLookUp);
        lookZone.addEventListener('pointercancel', onLookUp);
        joystick.addEventListener('pointerdown', onJoyDown);
        joystick.addEventListener('pointermove', onJoyMove);
        joystick.addEventListener('pointerup', onJoyUp);
        joystick.addEventListener('pointercancel', onJoyUp);
        /* 兜底：document 级清理 + 捕获丢失清理，防 pointerId 泄漏卡死 */
        document.addEventListener('pointerup', onGlobalPointerEnd);
        document.addEventListener('pointercancel', onGlobalPointerEnd);
        document.addEventListener('lostpointercapture', onLostCapture);

        bindFire(fireBtn, fireSlot);
        bindFire(fireLeftBtn, fireLeftSlot);

        function act(code) { return function (e) { e.preventDefault(); onAction(code); }; }
        document.getElementById('btn-reload').addEventListener('click', act('reload'));
        document.getElementById('btn-pause').addEventListener('click', act('pauseToggle'));

        /* 瞄准镜头钮：点击切换、锁存保持（再点取消）——与「蹲」同模式。
         * 与 PC 右键(按住)用两个独立来源合成 aim，右键抬起不误清触控锁存。 */
        aimBtn = document.getElementById('btn-aim');
        aimBtn.addEventListener('pointerdown', function (e) {
            if (!enabled) return;
            aimToggle = !aimToggle; syncAim();
            aimBtn.classList.toggle('is-on', aimToggle);
            e.preventDefault();
        });

        /* v2：移动端跳钮（开火钮左上）与切换式蹲钮（跳钮左侧） */
        var jumpBtn = document.getElementById('btn-jump');
        crouchBtn = document.getElementById('btn-crouch');
        jumpBtn.addEventListener('pointerdown', function (e) {
            if (enabled) { onAction('jump'); e.preventDefault(); }
        });
        crouchBtn.addEventListener('pointerdown', function (e) {
            if (!enabled) return;
            crouchTouch = !crouchTouch;
            crouchBtn.classList.toggle('is-on', crouchTouch);
            e.preventDefault();
        });
    }

    function reset() {
        keys.w = keys.a = keys.s = keys.d = false;
        keyX = keyZ = joyX = joyZ = 0;
        lookDX = lookDY = 0;
        mouseFiring = false; fireSlot.id = -1; fireLeftSlot.id = -1;
        firing = false; sprint = false; dragging = false;
        aimToggle = false; aimHold = false; syncAim();
        if (aimBtn) aimBtn.classList.remove('is-on');
        crouchKey = false; crouchTouch = false;
        if (crouchBtn) crouchBtn.classList.remove('is-on');
        lookId = -1; joyId = -1; lookBeat = 0; joyBeat = 0;
        syncMove();
        if (knob) setKnob(0, 0);
    }

    /* stale 检测：真机上若 pointerup/cancel 全部丢失（含冒泡被系统吞），心跳停更。
     * 超过阈值视为该指已离屏，强制释放 ID 与速度，避免永久锁死卡住摇杆/转向。
     * 阈值取 2s：正常按住不动时浏览器仍会发 pointermove(coalesced) 刷新心跳；
     * 极端静止超过 2s 被误释放也只损失一次重新按下的代价，远好于卡死。 */
    var STALE_MS = 2000;
    function sanitize() {
        if (!enabled) return;
        var t = nowMs();
        if (joyId !== -1 && joyBeat && t - joyBeat > STALE_MS) {
            joyId = -1; joyX = 0; joyZ = 0; setKnob(0, 0); syncMove();
        }
        if (lookId !== -1 && lookBeat && t - lookBeat > STALE_MS) lookId = -1;
        /* 开镜/开火不走 stale：精瞄或长按连发 >2s 且不发 pointermove 会被误清。
         * 抬指兜底由 document 级 pointerup/cancel + lostpointercapture 覆盖即可。 */
    }

    function setEnabled(on) { enabled = !!on; if (!enabled) reset(); }

    CS.Input = {
        init: init, reset: reset, setEnabled: setEnabled, requestLock: requestLock,
        sanitize: sanitize,
        hasLock: hasLock, isTouch: isTouch,
        get moveX() { return moveX; }, get moveZ() { return moveZ; },
        get lookDX() { return lookDX; }, get lookDY() { return lookDY; },
        set lookDX(v) { lookDX = v; }, set lookDY(v) { lookDY = v; },
        get firing() { return firing; }, get aim() { return aim; },
        get sprint() { return sprint; },
        get crouch() { return crouchKey || crouchTouch; },
        get enabled() { return enabled; }
    };
})(window);
