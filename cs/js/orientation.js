/* 反恐突袭 - 手机横屏
 * 进入任务时（用户手势内）请求全屏并锁定横屏；浏览器不支持或设备仍为竖屏时，
 * 显示旋转引导并自动暂停，转为横屏后自动恢复，也可点「跳过」以竖屏继续。
 * 仅触屏小屏（phone）介入；PC / 触屏笔记本 / 平板保持原有 Pointer Lock 与布局。
 * 已知限制：网页无法真正旋转设备，Android Chrome 全屏下可用 screen.orientation.lock，
 * iOS Safari 等只提供旋转引导，因此竖屏时必须留逃生口。 */
(function (global) {
    'use strict';
    var CS = global.CS || (global.CS = {});
    var doc = document;

    var game = null, gate = null;
    var active = false, skipped = false, held = false, blocking = false;

    /* 短边 ≤480 排除平板与触屏笔记本；isTouch 沿用 input.js 的 (pointer: coarse) 口径 */
    function isPhone() {
        return !!CS.Input.isTouch && Math.min(global.innerWidth, global.innerHeight) <= 480;
    }

    function isPortrait() { return global.innerWidth < global.innerHeight; }

    function hideGate(allowResume) {
        if (!blocking) return;
        blocking = false;                       // 先解锁，避免 game.resume 的守卫拦住自动恢复
        gate.classList.remove('is-active');
        gate.setAttribute('aria-hidden', 'true');
        if (held && allowResume && game && game.state === 'paused') game.resume();
        held = false;
    }

    function showGate() {
        if (blocking) return;
        blocking = true;
        gate.classList.add('is-active');
        gate.setAttribute('aria-hidden', 'false');
        /* 遮罩期间冻结 dt，避免竖屏无法操作时被 Bot 击杀 */
        if (game && game.state === 'playing') { held = true; game.pause(); }
    }

    function sync() {
        if (!active || skipped || !gate) return;
        if (isPortrait()) showGate(); else hideGate(true);
    }

    function tryLock() {
        var scr = global.screen;
        if (!scr) return;
        var so = scr.orientation || scr.msOrientation;
        try {
            if (so && so.lock) {
                var p = so.lock('landscape');
                if (p && p.catch) p.catch(function () { /* 不支持则交给旋转引导 */ });
            } else if (scr.lockOrientation) {
                scr.lockOrientation('landscape');
            }
        } catch (e) { /* 忽略：仍以旋转引导兜底 */ }
    }

    function requestLandscape() {
        var de = doc.documentElement;
        var fn = de.requestFullscreen || de.webkitRequestFullscreen || de.msRequestFullscreen;
        if (!fn) { tryLock(); return; }
        var p;
        try { p = fn.call(de); } catch (e) { tryLock(); return; }
        if (p && p.then) p.then(tryLock, function () { /* 全屏被拒：仍显示引导 */ });
        else tryLock();
    }

    /* 必须位于点击「开始任务」的同步手势链路内 */
    function onStart() {
        if (skipped || !isPhone()) return;
        active = true;
        requestLandscape();
        sync();
    }

    /* 回主菜单 / 结算：不留置遮罩，也不再响应方向变化 */
    function stop() {
        active = false;
        hideGate(false);
    }

    function init(g) {
        game = g;
        gate = doc.getElementById('screen-rotate');
        var btn = doc.getElementById('btn-rotate-skip');
        if (btn) btn.addEventListener('click', function (e) {
            e.preventDefault();
            skipped = true;
            active = false;
            hideGate(true);                     // 竖屏也能继续，不再强制
        });
        global.addEventListener('orientationchange', sync);
        global.addEventListener('resize', sync);
        doc.addEventListener('fullscreenchange', function () {
            if (doc.fullscreenElement || doc.webkitFullscreenElement) tryLock();
            sync();
        });
        doc.addEventListener('visibilitychange', function () { if (!doc.hidden) sync(); });
        var so = global.screen && global.screen.orientation;
        if (so && so.addEventListener) so.addEventListener('change', sync);
    }

    CS.Orientation = {
        init: init, onStart: onStart, stop: stop,
        /* 布局设置入口：与主菜单「开始任务」同样处于用户点击手势内，
         * 此处仅请求全屏+锁横屏，不设 active（不触发旋转引导/自动暂停），
         * 让按钮布局编辑器在真正的横屏视口下呈现，所见即游戏中所用布局 */
        onConfig: function () { if (isPhone()) requestLandscape(); },
        isBlocking: function () { return blocking; },
        isPhone: isPhone,
        isActive: function () { return active; },
        isSkipped: function () { return skipped; }
    };
})(window);
