/* 反恐突袭 - 输入层：键鼠 / Pointer Lock / 移动端虚拟摇杆与触控
 * 只产出「意图」(moveX/moveZ/lookDX/lookDY/firing/aim/crouch) 与离散动作码，不持有游戏状态。 */
(function (global) {
    'use strict';
    var CS = global.CS || (global.CS = {});
    var C = CS.CFG;

    var canvas, stage, onAction, enabled = false;
    var keys = { w: false, a: false, s: false, d: false };
    var keyX = 0, keyZ = 0, joyX = 0, joyZ = 0;
    var lookDX = 0, lookDY = 0, firing = false, aim = false;
    var crouchKey = false, crouchTouch = false, crouchBtn;
    var dragging = false, lastCX = 0, lastCY = 0, wasLocked = false;
    var lookId = -1, lookLX = 0, lookLY = 0;
    var joyId = -1, joyCX = 0, joyCY = 0;
    var lookZone, joystick, knob, fireBtn;
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
        return !!target.closest('button, .overlay, .tbtn, .floating-buttons');
    }

    function onKeyDown(e) {
        var c = e.code || e.key || '';
        switch (c) {
            case 'KeyW': case 'ArrowUp': case 'w': case 'W': keys.w = true; break;
            case 'KeyS': case 'ArrowDown': case 's': case 'S': keys.s = true; break;
            case 'KeyA': case 'ArrowLeft': case 'a': case 'A': keys.a = true; break;
            case 'KeyD': case 'ArrowRight': case 'd': case 'D': keys.d = true; break;
            case 'ShiftLeft': case 'ShiftRight': case 'Shift': aim = true; break;
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
            case 'ShiftLeft': case 'ShiftRight': case 'Shift': aim = false; break;
            case 'ControlLeft': case 'ControlRight': case 'KeyC': case 'c': case 'C':
                crouchKey = false; break;
            default: return;
        }
        syncKeys();
    }

    function onMouseDown(e) {
        if (e.button !== 0 || !enabled || isUI(e.target)) return;
        firing = true; dragging = true;
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

    function onMouseUp() { firing = false; dragging = false; }

    function onLockChange() {
        if (hasLock()) { wasLocked = true; return; }
        if (wasLocked) { wasLocked = false; firing = false; dragging = false; onAction('locklost'); }
    }

    /* ── 触控 ── */
    function onLookDown(e) {
        if (e.pointerType === 'mouse' || !enabled || lookId !== -1) return;
        lookId = e.pointerId; lookLX = e.clientX; lookLY = e.clientY;
        try { lookZone.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        e.preventDefault();
    }
    function onLookMove(e) {
        if (e.pointerId !== lookId) return;
        lookDX += (e.clientX - lookLX) * C.TOUCH_SENS;
        lookDY += (e.clientY - lookLY) * C.TOUCH_SENS;
        lookLX = e.clientX; lookLY = e.clientY;
        e.preventDefault();
    }
    function onLookUp(e) { if (e.pointerId === lookId) lookId = -1; }

    function setKnob(dx, dy) {
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    function onJoyDown(e) {
        if (e.pointerType === 'mouse' || !enabled || joyId !== -1) return;
        var r = joystick.getBoundingClientRect();
        joyCX = r.left + r.width * 0.5; joyCY = r.top + r.height * 0.5;
        joyId = e.pointerId;
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
        updateJoy(e.clientX, e.clientY);
        e.preventDefault();
    }
    function onJoyUp(e) {
        if (e.pointerId !== joyId) return;
        joyId = -1; joyX = 0; joyZ = 0;
        setKnob(0, 0); syncMove();
    }

    function init(canvasEl, stageEl, actionCb) {
        canvas = canvasEl; stage = stageEl; onAction = actionCb;
        lookZone = document.getElementById('look-zone');
        joystick = document.getElementById('joystick');
        knob = document.getElementById('joy-knob');
        fireBtn = document.getElementById('btn-fire');

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

        fireBtn.addEventListener('pointerdown', function (e) {
            if (enabled) { firing = true; e.preventDefault(); }
        });
        function releaseFire() { firing = false; }
        fireBtn.addEventListener('pointerup', releaseFire);
        fireBtn.addEventListener('pointercancel', releaseFire);
        fireBtn.addEventListener('pointerleave', releaseFire);

        function act(code) { return function (e) { e.preventDefault(); onAction(code); }; }
        document.getElementById('btn-reload').addEventListener('click', act('reload'));
        document.getElementById('btn-view').addEventListener('click', act('view'));
        document.getElementById('btn-pause').addEventListener('click', act('pauseToggle'));

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
        firing = false; aim = false; dragging = false;
        crouchKey = false; crouchTouch = false;
        if (crouchBtn) crouchBtn.classList.remove('is-on');
        lookId = -1; joyId = -1;
        syncMove();
        if (knob) setKnob(0, 0);
    }

    function setEnabled(on) { enabled = !!on; if (!enabled) reset(); }

    CS.Input = {
        init: init, reset: reset, setEnabled: setEnabled, requestLock: requestLock,
        hasLock: hasLock, isTouch: isTouch,
        get moveX() { return moveX; }, get moveZ() { return moveZ; },
        get lookDX() { return lookDX; }, get lookDY() { return lookDY; },
        set lookDX(v) { lookDX = v; }, set lookDY(v) { lookDY = v; },
        get firing() { return firing; }, get aim() { return aim; },
        get crouch() { return crouchKey || crouchTouch; },
        get enabled() { return enabled; }
    };
})(window);
