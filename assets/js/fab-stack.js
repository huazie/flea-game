/**
 * Flea Game 右下角 FAB 栈管理器
 * =========================================================================
 * 统一管理右下角悬浮按钮（FAB）的位置和外观基线。
 *
 * 用法：任意元素加 data-fab-stack="N"，N 越小越靠下（1=最底），由本模块按 N
 * 自动设置元素的 bottom，无需每个 FAB 自己计算堆叠位置。
 *
 * 示例：
 *   <button data-fab-stack="1" class="flea-fab">评论</button>   <!-- 最底 -->
 *   <button data-fab-stack="2" class="flea-fab">关卡</button>   <!-- 中间 -->
 *   <button data-fab-stack="3" class="flea-fab">分享</button>   <!-- 最顶 -->
 *
 * 特性：
 *   - 自动检测所有 [data-fab-stack] 元素（包括后来 DOM 注入的）
 *   - 按 N 升序排列，逐个设置 bottom = base + (idx * (SIZE + GAP))
 *   - 监听 resize / DOM 变化自动重新计算
 *   - 提供 FleaFabStack.refresh() API，供外部手动触发（如异步加载的 FAB）
 *   - 触屏整栈收起：水平向右拖动 FAB → 收到屏幕右缘只留 PEEK 宽边条，
 *     点击边条展开；状态持久化（localStorage），默认收起（有过展开记录
 *     则恢复展开态）
 *
 * 样式由各 FAB 自身 CSS 控制，本模块仅统一布局（bottom / 与视口右的间距）。
 * =========================================================================
 */
(function (global) {
    'use strict';

    /* 默认基线参数 */
    var SIZE = 50;        // FAB 直径（px），与各 FAB 自身 CSS 一致
    var GAP = 12;         // FAB 之间垂直间距（px），8 偏紧，12 更易点
    var BASE_BOTTOM = 28; // 最底 FAB 距离视口底（px），24 略贴边
    var RIGHT_GAP = 20;   // 距离视口右（px），16 偏贴边，20 留点呼吸
    var PEEK = 18;        // 收起态露出的边条宽度（px）
    var LS_KEY = 'flea_fab_collapsed';  // 收起状态持久化 key（全局）

    var STACK_ATTR = 'data-fab-stack';
    var STYLE_ID = 'flea-fab-stack-style';

    /* ============================================================
     * 1. 样式注入：仅注入必要的最小基线样式
     * ============================================================
     * 本模块只管**位置**（bottom / 与视口右的间距）。
     * 不强制 width / height / box-shadow / border-radius / background——
     * 这些视觉属性由各 FAB 自身 CSS 控制。
     * 原因：手机端三个 FAB 一致对齐的关键是三个 CSS 文件采用同一份
     * size 公式（clamp(44px, 12vw, 50px)），由 fab-stack 强制 50 反而
     * 会让某些走自身 clamp 的 FAB（如 .flea-share）出现 5px 差异。 */
    function ensureBaseStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var css =
            /* 选择器带 body 前缀以提高特异性 (0,0,1,1)，稳定压过
             * comments.css / share.css 中相同特异度的 .flea-comments-fab / .flea-share
             * 等规则（后者可能晚于本模块加载）。 */
            'body [data-fab-stack] {' +
            '  position: fixed;' +
            /* max 形式兼顾视口右安全区（iPhone 刘海/灵动岛等） */
            '  right: max(' + RIGHT_GAP + 'px, env(safe-area-inset-right, 0px));' +
            /* pan-y：垂直滚动交给浏览器，水平拖动派发给收起手势 */
            '  touch-action: pan-y;' +
            '  z-index: 2100;' +
            '}' +
            'body [data-fab-stack][data-fab-bottom] {' +
            '  bottom: attr(data-fab-bottom px, 0);' +
            '}' +
            /* 全栈隐藏：模态层（评论抽屉 / 分享菜单）打开时，右下角 FAB 不该继续
             * 浮在遮罩之上（FAB 基线 z-index 2100、分享容器 3100，均高于遮罩），
             * 否则抽屉开着时右下角还杵着几个按钮，既挡视线又容易误触。
             * 隐藏开关做在 <body> 上，新注入的 FAB 也能自动遵循。
             *
             * 两个关键点：
             * ① opacity/transform 必须 !important —— 评论 FAB 带
             *    `animation: flea-fab-in ... both`，animation 的 fill 状态属于
             *    animation origin，优先级高于普通声明，只有 !important 才压得住，
             *    否则「加了隐藏类却依然可见」。
             * ② visibility 用 0s + 0.22s 延迟：先让淡出动画播完再真正隐藏；
             *    移除类时 transition 一并失效，visibility 立即恢复 visible。 */
            'body.flea-fabs-hidden [data-fab-stack] {' +
            '  opacity: 0 !important;' +
            '  visibility: hidden;' +
            '  pointer-events: none;' +
            '  transform: scale(0.8) translateY(8px) !important;' +
            '  transition: opacity 0.22s ease, transform 0.22s ease, visibility 0s linear 0.22s;' +
            '}' +
            /* 分享子按钮自带 pointer-events: auto，会重新开启命中，需一并压掉 */
            'body.flea-fabs-hidden [data-fab-stack] * { pointer-events: none !important; }' +
            '@media (max-width: 768px) {' +
            '  body [data-fab-stack] { right: max(14px, env(safe-area-inset-right, 0px)); }' +
            '}';
        var el = document.createElement('style');
        el.id = STYLE_ID;
        el.textContent = css;
        document.head.appendChild(el);
    }

    /* ============================================================
     * 2. 核心：扫描并按 data-fab-stack 排序设置 bottom
     * ============================================================ */
    /** 扫描栈内元素：已挂载 + position:fixed，按 N 升序（1=最底） */
    function stackNodes() {
        var nodes = Array.prototype.slice.call(
            document.querySelectorAll('[' + STACK_ATTR + ']')
        );
        return nodes.filter(function (el) {
            if (!el.isConnected) return false;
            try {
                var pos = global.getComputedStyle(el).position;
                return pos === 'fixed';
            } catch (e) { return false; }
        }).sort(function (a, b) {
            return (parseInt(a.getAttribute(STACK_ATTR), 10) || 0) -
                   (parseInt(b.getAttribute(STACK_ATTR), 10) || 0);
        });
    }

    function apply() {
        var nodes = stackNodes();

        nodes.forEach(function (el, idx) {
            var bottom = BASE_BOTTOM + idx * (SIZE + GAP);
            el.style.bottom = bottom + 'px';
            el.setAttribute('data-fab-bottom', String(bottom));
            /* 收起态：inline right 覆盖 CSS 基线（展开态清 inline 交还 CSS） */
            el.style.right = state.collapsed ? collapsedRight(el) + 'px' : '';
        });
    }

    function collapsedRight(el) {
        /* offsetWidth：布局宽度，不受入场动画 scale 等 transform 影响 */
        var w = el.offsetWidth || SIZE;
        return PEEK - w;
    }

    function refresh() { apply(); }

    /* ============================================================
     * 2.5 全栈显隐开关
     * ============================================================
     * 供模态层（评论抽屉 / 分享菜单）调用：打开时整栈淡出，关闭时恢复。
     * 状态记在 <body> 的 flea-fabs-hidden 类上，因此后加入栈的 FAB 也自动遵循。
     */
    function setHidden(hidden) {
        document.body.classList.toggle('flea-fabs-hidden', !!hidden);
    }
    function isHidden() {
        return document.body.classList.contains('flea-fabs-hidden');
    }

    /* ============================================================
     * 2.8 整栈收起 / 展开（触屏水平拖动 + 边条点击）
     * ============================================================
     * 收起 = 整栈右移至只露 PEEK 宽边条，遮挡内容时用户可主动收起；
     * 状态持久化，跨页面恢复。空间位移走 inline `right`（FAB 自身的
     * hover / 入场动画都占用 transform，不可复用）。
     */
    var state = { collapsed: false };
    var drag = null;        // { id, x, y, width, startRight, moved }
    var suppressClick = false;

    function readPersisted() {
        /* 默认收起：无任何记录时按收起态初始化（窄屏优先保证不遮挡内容） */
        try {
            var v = global.localStorage.getItem(LS_KEY);
            return v === null ? true : v === '1';
        } catch (e) { return true; }
    }
    function persist() {
        try { global.localStorage.setItem(LS_KEY, state.collapsed ? '1' : '0'); } catch (e) { /* 忽略 */ }
    }
    function currentRightPx(el) {
        return parseFloat(global.getComputedStyle(el).right) || 0;
    }
    /** 按目标状态落位；animate=true 时临时注入过渡（播完清除，不覆盖 FAB 自身 transition） */
    function setStackCollapsed(collapsed, animate) {
        state.collapsed = !!collapsed;
        persist();
        var nodes = stackNodes();
        nodes.forEach(function (el) {
            if (animate) el.style.transition = 'right 0.25s ease';
            el.style.right = state.collapsed ? collapsedRight(el) + 'px' : '';
        });
        if (animate) {
            setTimeout(function () {
                nodes.forEach(function (el) { el.style.transition = ''; });
            }, 270);
        }
    }

    function bindCollapseGestures() {
        /* 手势起点：仅触屏；锁定命中的 FAB 元素（capture/判定统一用它，
         * 拖出 FAB 后 e.target 会变成别的元素） */
        document.addEventListener('pointerdown', function (e) {
            if (e.pointerType !== 'touch') return;
            var fab = e.target.closest && e.target.closest('[' + STACK_ATTR + ']');
            if (!fab) return;
            drag = {
                id: e.pointerId,
                el: fab,
                x: e.clientX,
                y: e.clientY,
                width: fab.offsetWidth || SIZE,
                startRight: 0,
                moved: false,
            };
        }, true);

        document.addEventListener('pointermove', function (e) {
            if (!drag || e.pointerId !== drag.id) return;
            var dx = e.clientX - drag.x;
            var dy = e.clientY - drag.y;
            if (!drag.moved) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
                if (Math.abs(dx) <= Math.abs(dy)) { drag = null; return; }  // 垂直主导 → 放弃，交还点击
                drag.moved = true;
                drag.startRight = currentRightPx(drag.el);
                try { drag.el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
            }
            e.preventDefault();
            /* 实时跟手：整栈所有 FAB 一起平移。
             * 向右拖（dx>0）→ right 减小 → 靠近视口右缘收起；钳制在 [收起位, 展开位] */
            var right = Math.max(PEEK - drag.width,
                                 Math.min(RIGHT_GAP, drag.startRight - dx));
            stackNodes().forEach(function (el) {
                el.style.transition = 'none';
                el.style.right = right + 'px';
            });
        }, true);

        var finish = function (e) {
            if (!drag || e.pointerId !== drag.id) return;
            var d = drag;
            drag = null;
            if (!d.moved) return;
            suppressClick = true;  // 拖动后的合成 click 不触发 FAB 功能
            /* 拖动手势通常不产生合成 click，超时自复位防止吞掉下一次合法点击 */
            setTimeout(function () { suppressClick = false; }, 350);
            /* 按当前位置过中点判定收起/展开 */
            var collapsedTarget =
                currentRightPx(d.el) < (RIGHT_GAP + (PEEK - d.width)) / 2;
            setStackCollapsed(collapsedTarget, true);
        };
        document.addEventListener('pointerup', finish, true);
        document.addEventListener('pointercancel', finish, true);

        /* click 捕获（先于 FAB 自身监听）：
         * ① 拖动后的合成 click → 吞掉；
         * ② 收起态点击边条 → 展开整栈 */
        document.addEventListener('click', function (e) {
            var fab = e.target.closest && e.target.closest('[' + STACK_ATTR + ']');
            if (!fab) return;
            if (suppressClick) {
                suppressClick = false;
                e.stopPropagation();
                e.preventDefault();
                return;
            }
            if (state.collapsed) {
                e.stopPropagation();
                e.preventDefault();
                setStackCollapsed(false, true);
            }
        }, true);
    }

    /* ============================================================
     * 3. 监听 DOM 变化：新注入的 FAB 自动加入栈
     * ============================================================ */
    function observeDom() {
        if (!global.MutationObserver) return;
        var scheduled = false;
        var mo = new MutationObserver(function () {
            if (scheduled) return;
            scheduled = true;
            /* 批量触发：合并同一帧内的多次 DOM 变化 */
            (global.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); })(function () {
                scheduled = false;
                apply();
            });
        });
        mo.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [STACK_ATTR]
        });
    }

    /* ============================================================
     * 4. 初始化
     * ============================================================ */
    function init() {
        ensureBaseStyle();
        state.collapsed = readPersisted();
        var run = function () { apply(); };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }
        global.addEventListener('resize', run);
        observeDom();
        bindCollapseGestures();
    }

    init();

    /* ============================================================
     * 5. 导出
     * ============================================================ */
    global.FleaFabStack = {
        refresh: refresh,
        apply: apply,
        /** 隐藏/恢复整栈 FAB（模态层打开时调用） */
        setHidden: setHidden,
        isHidden: isHidden,
        /** 整栈收起/展开（触屏拖动收起的编程入口） */
        setCollapsed: function (collapsed) { setStackCollapsed(!!collapsed, true); },
        isCollapsed: function () { return state.collapsed; },
        SIZE: SIZE,
        GAP: GAP,
        BASE_BOTTOM: BASE_BOTTOM,
        RIGHT_GAP: RIGHT_GAP,
        PEEK: PEEK
    };
})(window);
