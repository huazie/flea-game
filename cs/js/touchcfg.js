/* =====================================================================
 * touchcfg.js — 触控按钮布局设置（仅触屏；PC 不绑定不显示）
 *
 * 职责：主菜单「按钮布局 · 设置」进入编辑态 →
 *   ① 拖动控件调整位置（存控件中心点 = 视口百分比，旋转/换机安全）
 *   ② 点选控件后用 −/＋ 步进调整大小（CSS 变量 --ts 缩放，0.7~1.6）
 *   ③ 保存 → localStorage.cs_touch 持久化，下次加载自动应用
 *
 * 可调控件：摇杆 / 开火 / 左开火 / 跳 / 蹲 / 换弹 / 瞄准镜头；「暂停」固定不调，
 * 防止玩家把它拖进死角后无法退出对局。
 * 仅改「布局」，不碰任何游戏判定与 CFG 数值（ADR-4 配色 var() 体系不变）。
 * ==================================================================== */
(function (global) {
    'use strict';

    var LS_KEY = 'cs_touch';
    var S_MIN = 0.7, S_MAX = 1.6, S_STEP = 0.1;
    var X_MIN = 5, X_MAX = 95, Y_MIN = 6, Y_MAX = 94;

    /* 可调控件清单与显示名 */
    var IDS = ['joystick', 'btn-fire', 'btn-fire-left', 'btn-jump', 'btn-crouch', 'btn-reload', 'btn-aim'];
    var NAME = {
        'joystick': '摇杆', 'btn-fire': '开火', 'btn-fire-left': '左开火', 'btn-jump': '跳',
        'btn-crouch': '蹲', 'btn-reload': '换弹', 'btn-aim': '瞄准镜头'
    };

    var editing = false, selId = '', dragId = '';
    var cfg = {};          /* 当前生效 { id: {x,y,s} }，x/y = 中心点视口百分比 */
    var snapshot = null;   /* 进入编辑时的快照（取消时还原） */

    function $(id) { return document.getElementById(id); }
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function isTouch() { return !!(global.CS && global.CS.Input && global.CS.Input.isTouch); }

    /* ── 存取 ── */
    function load() {
        var out = {};
        try {
            var raw = global.localStorage.getItem(LS_KEY);
            if (raw) {
                var items = (JSON.parse(raw) || {}).items;
                IDS.forEach(function (id) {
                    var it = items && items[id];
                    if (it && isFinite(it.x) && isFinite(it.y) && isFinite(it.s)) {
                        out[id] = {
                            x: clamp(+it.x, X_MIN, X_MAX),
                            y: clamp(+it.y, Y_MIN, Y_MAX),
                            s: clamp(+it.s, S_MIN, S_MAX)
                        };
                    }
                });
            }
        } catch (e) { /* 隐私模式 / 数据损坏：按无配置处理 */ }
        return out;
    }

    function persist() {
        try {
            var items = {}, has = false;
            IDS.forEach(function (id) { if (cfg[id]) { items[id] = cfg[id]; has = true; } });
            if (has) global.localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, items: items }));
            else global.localStorage.removeItem(LS_KEY);
        } catch (e) { /* 忽略 */ }
    }

    /* ── 应用到 DOM：is-cfg 类切换「中心点定位 + 缩放」模式 ── */
    function applyOne(id, c) {
        var el = $(id);
        if (!el) return;
        if (c) {
            el.classList.add('is-cfg');
            el.style.left = c.x + '%';
            el.style.top = c.y + '%';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
            el.style.setProperty('--ts', c.s);
        } else {
            el.classList.remove('is-cfg');
            el.style.left = el.style.top = el.style.right = el.style.bottom = '';
            el.style.removeProperty('--ts');
        }
    }

    function applyAll() { IDS.forEach(function (id) { applyOne(id, cfg[id]); }); }

    /* 未移动过的控件首次调整时，以当前视觉中心为基准建档 */
    function ensureEntry(id) {
        if (cfg[id]) return cfg[id];
        var r = $(id).getBoundingClientRect();
        var c = {
            x: clamp((r.left + r.width / 2) / global.innerWidth * 100, X_MIN, X_MAX),
            y: clamp((r.top + r.height / 2) / global.innerHeight * 100, Y_MIN, Y_MAX),
            s: 1
        };
        cfg[id] = c;
        return c;
    }

    /* ── 编辑态 ── */
    function enter() {
        if (editing || !isTouch()) return;
        editing = true;
        snapshot = JSON.parse(JSON.stringify(cfg));
        selId = dragId = '';
        document.body.classList.add('is-tcfg-edit');
        var menu = $('screen-menu');
        if (menu) menu.classList.add('is-cfg-edit');   /* 隐藏菜单面板，控件浮到 overlay 之上 */
        var bar = $('touch-cfg-bar');
        if (bar) bar.classList.add('is-on');
        updateBar();
        if (global.CS && global.CS.HUD) global.CS.HUD.syncFab();   /* 编辑态隐藏站点 FAB */
    }

    function exit() {
        editing = false;
        selId = dragId = '';
        document.body.classList.remove('is-tcfg-edit');
        var menu = $('screen-menu');
        if (menu) menu.classList.remove('is-cfg-edit');
        var bar = $('touch-cfg-bar');
        if (bar) bar.classList.remove('is-on');
        if (global.CS && global.CS.HUD) global.CS.HUD.syncFab();   /* 离开编辑态：主菜单恢复 FAB */
    }

    function select(id) {
        var next = (selId === id) ? '' : id;           /* 再点一次取消选中 */
        if (selId) { var prev = $(selId); if (prev) prev.classList.remove('is-sel'); }
        selId = next;
        if (selId) { var el = $(selId); if (el) el.classList.add('is-sel'); }
        updateBar();
    }

    function stepSize(d) {
        if (!editing || !selId) return;
        var c = ensureEntry(selId);
        c.s = clamp(Math.round((c.s + d) * 100) / 100, S_MIN, S_MAX);
        applyOne(selId, c);
        updateBar();
    }

    function updateBar() {
        var nameEl = $('tcfg-sel-name'), sizeEl = $('tcfg-size-val');
        if (!nameEl || !sizeEl) return;
        nameEl.textContent = selId ? NAME[selId] : '未选中';
        sizeEl.textContent = cfg[selId] ? Math.round(cfg[selId].s * 100) + '%' : '--';
    }

    /* ── 指针事件：控件上按下即选中并起拖；窗口级 move/up 完成拖动 ── */
    function onCtlDown(e) {
        if (!editing) return;
        e.preventDefault();
        e.stopPropagation();
        dragId = e.currentTarget.__tcfgId;
        select(dragId);
    }

    function onMove(e) {
        if (!editing || !dragId) return;
        e.preventDefault();
        e.stopPropagation();
        var c = ensureEntry(dragId);
        c.x = clamp(e.clientX / global.innerWidth * 100, X_MIN, X_MAX);
        c.y = clamp(e.clientY / global.innerHeight * 100, Y_MIN, Y_MAX);
        applyOne(dragId, c);
    }

    function onUp() { dragId = ''; }

    /* 编辑态吞掉一切点击（工具条除外），防止误触游戏按钮 */
    function onClickBlock(e) {
        if (!editing) return;
        var bar = $('touch-cfg-bar');
        if (bar && bar.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
    }

    /* ── 工具条按钮 ── */
    function bindBar() {
        var on = function (id, fn) { var el = $(id); if (el) el.addEventListener('click', fn); };
        on('tcfg-smaller', function () { stepSize(-S_STEP); });
        on('tcfg-bigger', function () { stepSize(S_STEP); });
        on('tcfg-reset', function () {   /* 清空当前布局并立即生效；取消仍可还原快照 */
            cfg = {};
            applyAll();
            select('');
            updateBar();
        });
        on('tcfg-cancel', function () {
            cfg = snapshot || {};
            applyAll();
            exit();
        });
        on('tcfg-save', function () {
            persist();
            applyAll();
            exit();
            if (global.CS && global.CS.Sfx) global.CS.Sfx.view();
            if (global.CS && global.CS.HUD) global.CS.HUD.toast('按钮布局已保存');
        });
    }

    function init() {
        if (!isTouch()) return;        /* PC：不应用、不绑定，菜单入口由 CSS 分流隐藏 */
        cfg = load();
        applyAll();
        IDS.forEach(function (id) {
            var el = $(id);
            if (!el) return;
            el.__tcfgId = id;
            el.addEventListener('pointerdown', onCtlDown);
        });
        global.addEventListener('pointermove', onMove, true);
        global.addEventListener('pointerup', onUp, true);
        global.addEventListener('pointercancel', onUp, true);
        global.addEventListener('click', onClickBlock, true);
        bindBar();
    }

    global.CS = global.CS || {};
    global.CS.TouchCfg = {
        init: init,
        enter: enter,
        apply: applyAll,
        get editing() { return editing; }
    };
})(window);
