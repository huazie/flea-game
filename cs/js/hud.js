/* 反恐突袭 - HUD 与覆盖层：6 个信息块 + 受击红闪 + 空仓闪红 + FPS/TPS 指示
 * DOM 只在数值变化时写入；计时器由主循环 dt 驱动，不用 setTimeout。 */
(function (global) {
    'use strict';
    var CS = global.CS || (global.CS = {});
    var C = CS.CFG;

    var el = {}, stage, cb;
    var last = {
        hp: -1, ammo: -1, wave: -1, left: -1, score: -1,
        gap: -1, prog: -1, gapText: '', reloading: false
    };
    var hurtTimer = 0, viewHiTimer = 0, muzzleTimer = 0;

    /* #15 只读性能探针：仅 URL 带 ?perf=1（或 &perf=1）时开启，默认零开销。
     * 数据来自 Renderer 快照，HUD 只做格式化显示，绝不回写任何判定状态。 */
    var perfProbeOn = /[?&]perf=1(?:&|$)/.test(global.location ? global.location.search : '');
    var lastProbe = '';

    function $(id) { return document.getElementById(id); }
    function text(node, v) { if (node && node.textContent !== v) node.textContent = v; }

    /* 站点分享/评论 FAB 只在「纯主菜单」显示：任何子页面（游戏/暂停/结算/
     * 操作说明/布局编辑/旋转引导）都不展示，避免挡触控与抢视觉。
     * 白名单式：非纯主菜单即加 cs-fab-off（CSS display:none!important）。 */
    function syncFab() {
        var menu = el.menu && el.menu.classList.contains('is-active');
        var help = el.help && el.help.classList.contains('is-active');
        var edit = document.body.classList.contains('is-tcfg-edit');
        var gate = $('screen-rotate');
        var rotating = gate && gate.classList.contains('is-active');
        document.body.classList.toggle('cs-fab-off', !(menu && !help && !edit && !rotating));
    }

    function setScreen(name) {
        el.help.classList.remove('is-active');   // 任何状态切换都收起操作说明，避免遮挡
        el.menu.classList.toggle('is-active', name === 'menu');
        el.pause.classList.toggle('is-active', name === 'pause');
        el.result.classList.toggle('is-active', name === 'result');
        stage.classList.toggle('is-playing', name === 'hud');
        syncFab();
    }

    function showHelp() { el.help.classList.add('is-active'); syncFab(); }
    function hideHelp() { el.help.classList.remove('is-active'); syncFab(); }

    function setView(mode, highlight) {
        text(el.viewMode, mode === 'tps' ? 'TPS' : 'FPS');
        text(el.menuViewBtn, mode === 'tps' ? 'TPS' : 'FPS');
        if (highlight) { el.view.classList.add('is-hi'); viewHiTimer = C.VIEW_HI_TIME; }
    }

    function showMenu(best, viewMode) {
        text(el.menuBest, String(best));
        setView(viewMode, false);
        setScreen('menu');
    }

    /* 实测帧率读数：0.5s 窗口汇报，change-guard 防逐帧 DOM 写。 */
    var lastFps = '';
    function setFps(v) {
        var s = String(v);
        if (s === lastFps) return;
        lastFps = s;
        text(el.fpsValue, s);
    }

    /* 只读快照 → 单行文本：hz / p90ms / 抖动比 / 抖动态 / 档位 / 冷却剩余 / 锁定档位。
     * lock >=0 表示该档位在本机抖到降级、本局不再升回（#16 试探锁定生效的直接证据）。
     * change-guard 沿用 text()：数值不变不碰 DOM；未开启时直接返回，零开销。 */
    function setPerfProbe(snap) {
        if (!perfProbeOn || !el.probe) return;
        var s = 'hz ' + snap.hz + '  p90 ' + snap.p90.toFixed(1)
            + '  ratio ' + snap.ratio.toFixed(2)
            + '  hot ' + (snap.hot ? 1 : 0)
            + '  lv ' + snap.lv + '  cool ' + snap.cool.toFixed(1) + 's'
            + '  lock ' + (snap.lock >= 0 ? snap.lock : '-');
        if (s === lastProbe) return;
        lastProbe = s;
        text(el.probe, s);
    }

    function showResult(game, win, isNew) {
        text(el.rTitle, win ? '任务完成' : '任务失败');
        text(el.rWave, (game.waveIdx + 1) + '/3');
        text(el.rKills, String(game.kills));
        text(el.rAcc, (game.shotsFired ? Math.round(game.shotsHit / game.shotsFired * 100) : 0) + '%');
        text(el.rHp, String(game.player.hp));
        text(el.rTime, game.elapsed.toFixed(1) + 's');
        text(el.rScore, String(game.score));
        text(el.rBest, String(game.best));
        el.rNew.classList.toggle('is-on', !!isNew);
        setScreen('result');
    }

    function flashHurt() {
        hurtTimer = C.HURT_TIME;
        el.flash.classList.add('is-on');
    }
    function flashAmmo() {
        el.ammo.classList.remove('is-empty');
        void el.ammo.offsetWidth;              // 强制重排以重放闪烁动画
        el.ammo.classList.add('is-empty');
    }
    function flashMuzzle() {
        muzzleTimer = 0.06;
        el.cross.classList.add('is-fire');
    }

    function reset() {
        hurtTimer = 0; viewHiTimer = 0; muzzleTimer = 0;
        el.flash.classList.remove('is-on');
        el.ammo.classList.remove('is-empty');
        el.cross.classList.remove('is-fire');
        el.view.classList.remove('is-hi');
        el.gap.classList.remove('is-on');
        el.reloadWrap.classList.remove('is-on');
        last.hp = last.ammo = last.wave = last.left = last.score = -1;
        last.gap = last.prog = -1; last.gapText = ''; last.reloading = false;
        lastFps = ''; lastProbe = '';
    }

    function update(dt, game) {
        var p = game.player;
        if (last.hp !== p.hp) {
            last.hp = p.hp;
            text(el.hp, String(p.hp));
            el.hpFill.style.width = (p.hp / C.PLAYER_HP * 100) + '%';
        }
        if (last.ammo !== p.ammo) {
            last.ammo = p.ammo;
            text(el.ammo, p.ammo + ' / ∞');
        }
        if (last.wave !== game.waveIdx) {
            last.wave = game.waveIdx;
            text(el.waveLabel, 'WAVE ' + (game.waveIdx + 1) + '/3');
        }
        var left = CS.Entities.aliveCount(game.bots);
        if (last.left !== left) { last.left = left; text(el.waveLeft, '剩余 ' + left); }
        if (last.score !== game.score) { last.score = game.score; text(el.score, String(game.score)); }

        var reloading = p.reloading;
        if (last.reloading !== reloading) {
            last.reloading = reloading;
            el.reloadWrap.classList.toggle('is-on', reloading);
        }
        if (reloading) {
            var prog = 1 - p.reloadT / C.RELOAD_TIME;
            if (prog < 0) prog = 0; else if (prog > 1) prog = 1;
            if (Math.abs(prog - last.prog) > 0.01) {
                last.prog = prog;
                el.reloadFill.style.width = (prog * 100) + '%';
            }
        }

        var gapOn = game.intermission > 0;
        var gt = gapOn ? '整备 ' + game.intermission.toFixed(1) + 's' : '';
        if (last.gapText !== gt) {
            last.gapText = gt;
            el.gap.classList.toggle('is-on', gapOn);
            if (gapOn) text(el.gap, gt);
        }

        /* 准星间隙实时可视化散布：静止/Shift 收紧，移动放宽 */
        var gap = 4 + game.spreadDeg * 4;
        if (last.gap !== gap) {
            last.gap = gap;
            el.cross.style.setProperty('--ch-gap', gap + 'px');
        }

        if (hurtTimer > 0) {
            hurtTimer -= dt;
            if (hurtTimer <= 0) el.flash.classList.remove('is-on');
        }
        if (viewHiTimer > 0) {
            viewHiTimer -= dt;
            if (viewHiTimer <= 0) el.view.classList.remove('is-hi');
        }
        if (muzzleTimer > 0) {
            muzzleTimer -= dt;
            if (muzzleTimer <= 0) el.cross.classList.remove('is-fire');
        }
    }

    function init(callbacks) {
        cb = callbacks;
        stage = $('cs-stage');
        el.menu = $('screen-menu'); el.pause = $('screen-pause');
        el.result = $('screen-result'); el.help = $('screen-help');
        el.flash = $('damage-flash'); el.cross = $('cs-crosshair');
        el.hp = $('hp-value'); el.hpFill = $('hp-fill');
        el.ammo = $('ammo-value'); el.reloadWrap = $('reload-progress');
        el.reloadFill = $('reload-fill');
        el.waveLabel = $('wave-label'); el.waveLeft = $('wave-left'); el.gap = $('wave-gap');
        el.score = $('score-value'); el.view = $('hud-view'); el.viewMode = $('view-mode'); el.fpsValue = $('fps-value');
        el.probe = $('perf-probe');
        if (perfProbeOn && el.probe) el.probe.classList.add('is-on');
        el.menuBest = $('menu-best'); el.menuViewBtn = $('menu-view-btn');
        el.menuTouchLine = $('menu-touch-line'); el.menuTouchBtn = $('menu-touch-btn');
        el.rTitle = $('result-title'); el.rNew = $('result-new');
        el.rWave = $('r-wave'); el.rKills = $('r-kills'); el.rAcc = $('r-acc');
        el.rHp = $('r-hp'); el.rTime = $('r-time'); el.rScore = $('r-score'); el.rBest = $('r-best');

        $('btn-start').addEventListener('click', function () { cb.start(); });
        $('btn-help').addEventListener('click', showHelp);
        $('btn-help-close').addEventListener('click', hideHelp);
        $('btn-resume').addEventListener('click', function () { cb.resume(); });
        $('btn-restart').addEventListener('click', function () { cb.restart(); });
        $('btn-tomenu').addEventListener('click', function () { cb.menu(); });
        $('btn-again').addEventListener('click', function () { cb.restart(); });
        $('btn-result-menu').addEventListener('click', function () { cb.menu(); });
        el.menuViewBtn.addEventListener('click', function () { cb.view(); });
        /* 左上角视角·帧率块：点击切 FPS/TPS（playing 态直接点击，菜单态另有起始视角钮） */
        if (el.view) el.view.addEventListener('click', function () { cb.view(); });
        /* 按钮布局入口：仅触屏绑定（入口行本身已由 CSS (pointer: coarse) 分流，双保险） */
        if (el.menuTouchBtn) {
            if (CS.Input && CS.Input.isTouch) el.menuTouchBtn.addEventListener('click', function () { cb.touch(); });
            else if (el.menuTouchLine) el.menuTouchLine.style.display = 'none';
        }
        syncFab();   /* 初始态：主菜单激活，FAB 可见；其余子页面由状态切换维护 */
    }

    /* 降级等系统级提示条：is-show 类由 CSS 过渡显隐，2.6s 自动消失 */
    var toastTimer = 0;
    function toast(msg) {
        var t = document.getElementById('perf-toast');
        if (!t) return;
        t.textContent = msg;
        t.classList.add('is-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('is-show'); }, 2600);
    }

    CS.HUD = {
        init: init, reset: reset, update: update,
        setScreen: setScreen, setView: setView, setFps: setFps, setPerfProbe: setPerfProbe,
        syncFab: syncFab,
        showMenu: showMenu, showResult: showResult,
        flashHurt: flashHurt, flashAmmo: flashAmmo, flashMuzzle: flashMuzzle,
        toast: toast
    };
})(window);
