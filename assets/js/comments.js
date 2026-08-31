/**
 * Flea Game 公共评论接入模块（悬浮抽屉版）
 * =========================================================================
 * 基于 Diversity Comments SDK（聚合六大评论系统，iframe 沙箱隔离）。
 * 参考：https://blog.huazie.com/demo/#card-quickstart
 *
 * 交互形态：
 *   - 右下角悬浮评论按钮（FAB），点击滑出右侧抽屉，再次点击收起
 *   - 点遮罩 / 关闭按钮 / Esc 也可收起（PC 约 440px 宽，手机全宽）
 *   - 跟随站点明暗主题（由 common.js 统一把 data-theme 标在 <html>，SDK 只读 <html>）
 *   - 图标用内联 SVG，不依赖 Font Awesome
 *
 * 零侵入：模块自动创建 FAB / 遮罩 / 抽屉，自动加载 SDK 与样式。
 * 页面只需一行：<script>FleaComments.init('shudu');</script>
 * =========================================================================
 */
(function (global) {
    'use strict';

    /* ============================================================
     * 1. 常量与资源
     * ============================================================ */
    var SDK_URL = 'https://huazie.github.io/js/diversity-comments.1.0.0.min.js';
    var SDK_LOAD_TIMEOUT = 8000; // 外部 CDN 挂起兜底：超时即放弃，不影响页面
    var CONTAINER_ID = 'diversity-comments';
    var STYLE_ID = 'flea-comments-style';

    /** 解析 comments.css 路径：页面均为同步引入，取当前脚本 src 即可 */
    function resolveStyleHref() {
        var src = '';
        try {
            src = (document.currentScript && document.currentScript.src) || '';
        } catch (e) { /* ignore */ }
        if (!src) return '../assets/css/comments.css';
        return src.replace(/\/js\/comments\.js(\?.*)?$/, '/css/comments.css');
    }
    var STYLE_HREF = resolveStyleHref();

    /**
     * 缓存本模块的脚本 src：必须在 IIFE 顶层取，init() 后续被 inline `<script>FleaComments.init()</script>`
     * 调用时 document.currentScript 已变成 inline script（src 为空），无法再用其推断同目录的 fab-stack.js 路径。
     * 一旦缺失，fab-stack.js 永远加载失败 → 3 个 FAB 的 right/bottom 各自为政，level 凸出 8px。
     */
    var SCRIPT_SRC = (function () {
        try {
            return (document.currentScript && document.currentScript.src) || '';
        } catch (e) { return ''; }
    })();

    var FAB_ID = 'flea-comments-fab';
    var BACKDROP_ID = 'flea-comments-backdrop';
    var DRAWER_ID = 'flea-comments-drawer';

    // config 目录下的评论配置文件（优先于内置默认）。地址推算交给公共模块 FleaCommon。
    var COMMENT_CONFIG_URL = (global.FleaCommon && typeof global.FleaCommon.resolveConfigUrl === 'function')
        ? global.FleaCommon.resolveConfigUrl('comments.json')
        : 'config/comments.json';

    /* 内联 SVG 图标：不依赖 Font Awesome，CDN 挂起时图标依然可见 */
    /* 注意：path 必须 fill="currentColor"，否则 SVG 默认黑色填充，不继承按钮颜色 */
    var ICON_CHAT =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    var ICON_CLOSE =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 ' +
        '17.59 19 19 17.59 13.41 12z"/></svg>';

    /* ============================================================
     * 2. 默认评论配置（占位值；实际仓库 / 凭据由 config/comments.json 覆盖）
     * ============================================================ */
    /**
     * 评论系统统一配置（公共接入的唯一默认来源）。
     * - 默认启用 Utterances：只需 `repo`（GitHub 仓库名），无需任何密钥，开箱即用。
     * - 其它系统默认关闭。如需启用，请在对应处填入你的凭据，并把 `enable` 改为 true。
     * - 真实仓库 / 凭据统一放在 config/comments.json，经深合并覆盖此处的占位值。
     */
    var COMMENT_CONFIG = {
        /* 评论区通用配置 */
        style: 'tabs',        // 显示模式：tabs（选项卡） / dropdown（下拉）
        active: 'utterances', // 默认激活的评论系统
        lazyload: false,      // 抽屉初始在屏外，关闭懒加载以保打开即见
        storage: true,        // 记住用户选择的评论系统
        lang: 'zh-CN',

        /* —— Utterances（默认启用，仅需仓库名） —— */
        utterances: {
            enable: false,
            repo: 'YOUR_GITHUB_OWNER/YOUR_GITHUB_REPO',   // 默认占位（owner/repo 格式），实际仓库由 config/comments.json 提供
            issue_term: 'pathname',
            theme: 'github-light',
            dark: 'github-dark'
        },

        /* —— Giscus（启用前需填写 repo_id / category_id） —— */
        giscus: {
            enable: false,
            repo: 'YOUR_GITHUB_OWNER/YOUR_GITHUB_REPO',
            repo_id: 'YOUR_GISCUS_REPO_ID',
            category: 'Announcements',
            category_id: 'YOUR_GISCUS_CATEGORY_ID',
            mapping: 'pathname',
            reactions_enabled: 1,
            lang: 'zh-CN',
            input_position: 'bottom'
        },

        /* —— Gitalk（需 GitHub OAuth App 的 client_id / client_secret） —— */
        gitalk: {
            enable: false,
            github_id: 'YOUR_GITHUB_OWNER',
            repo: 'YOUR_GITHUB_REPO',
            client_id: 'YOUR_GITHUB_OAUTH_CLIENT_ID',
            client_secret: 'YOUR_GITHUB_OAUTH_CLIENT_SECRET',
            admin_user: 'YOUR_GITHUB_OWNER',
            distraction_free_mode: true,
            issue_term: 'pathname',
            language: 'zh-CN'
        },

        /* —— Twikoo（需云函数地址 env_id） —— */
        twikoo: {
            enable: false,
            env_id: 'YOUR_TWIKOO_ENV_ID',
            lang: 'zh-CN'
        },

        /* —— Gitment（需 GitHub OAuth App 的 client_id / client_secret） —— */
        gitment: {
            enable: false,
            owner: 'YOUR_GITHUB_OWNER',
            repo: 'YOUR_GITHUB_REPO',
            client_id: 'YOUR_GITHUB_OAUTH_CLIENT_ID',
            client_secret: 'YOUR_GITHUB_OAUTH_CLIENT_SECRET',
            issue_term: 'pathname',
            gitmint: true,
            lang: 'zh-CN'
        },

        /* —— Waline（需服务端地址 server_url） —— */
        waline: {
            enable: false,
            server_url: 'YOUR_WALINE_SERVER_URL',
            lang: 'zh-CN',
            dark: '.dark-theme',
            reaction: true,
            page_size: 10
        }
    };

    /* ============================================================
     * 3. 模块状态
     * ============================================================ */
    var instance = null;
    var initialized = false;
    var drawerOpen = false;
    var dom = {};
    var prevBodyOverflow = '';
    var themeObserver = null;
    var lastScheme = null; // 上次已下发的主题，避免重复调用 setColorScheme / 重建
    var sdkReady = false;  // SDK 是否已完成初始化（iframe 就绪）
    var mergedConfig = null; // 从 config/comments.json 加载并与默认深合并后的生效配置（优先于内置默认）
    var configLoaded = false; // config/comments.json 是否已发起过加载（保证只加载一次）
    var state = { pageId: null, options: null, initTheme: null }; // 用于主题变化后重建 widget

    /* ============================================================
     * 4. 工具函数
     * ============================================================ */

    /** 取得当前生效配置：合并后的远程配置优先，否则用内置默认 */
    function getConfig() {
        return mergedConfig != null ? mergedConfig : COMMENT_CONFIG;
    }

    /** 读取站点当前主题（统一标在 <html data-theme>），缺省视为 light */
    function currentTheme() {
        var t = document.documentElement.dataset.theme;
        return t === 'dark' ? 'dark' : 'light';
    }

    /* ============================================================
     * 5. 远程配置加载（config/comments.json 深合并覆盖默认）
     * ============================================================ */

    /**
     * 优先从 config/comments.json 加载评论配置，深合并覆盖内置默认配置。
     * 加载 + 合并 + 缓存 + 失败兜底统一交给公共模块 window.FleaCommon.loadConfig
     * （见 assets/js/common.js）：
     * - 加载成功：远程配置与默认配置深合并后作为生效配置。
     * - 加载失败 / 超时 / 无公共模块：回退内置默认，不阻塞评论初始化。
     */
    function loadRemoteConfig(done) {
        if (configLoaded) { done(); return; }
        configLoaded = true;
        var Common = global.FleaCommon;
        if (!Common || typeof Common.loadConfig !== 'function') {
            done(); // 兜底：公共模块缺失时直接退回默认配置
            return;
        }
        var sep = COMMENT_CONFIG_URL.indexOf('?') === -1 ? '?' : '&';
        var url = COMMENT_CONFIG_URL + sep + 't=' + Date.now(); // 绕过缓存

        Common.loadConfig(url, COMMENT_CONFIG, { timeout: 5000 })
            .then(function (merged) {
                mergedConfig = merged;
                if (global.FleaComments) global.FleaComments.config = merged;
            })
            .then(done, done); // 无论成功失败都继续初始化
    }

    /* ============================================================
     * 6. 主题处理
     * ============================================================ */

    /**
     * 应用站点主题到评论模块。
     * 主题的 DOM 标记（<html data-theme>）由 common.js 统一负责，此处只负责通知 SDK：
     * 1. 调用 DiversityComments.setColorScheme(scheme) 尝试轻量换肤（主要影响 SDK 外壳）。
     * 2. 对 Utterances 等 iframe 子系统，setColorScheme 无法驱动其内部内容换肤
     *    （截图证实：外壳已亮，Utterances 内容仍暗）。因此 SDK ready 后若主题真的变了，
     *    必须销毁旧 widget 并用新主题重新 init，让 iframe src 拿到正确 theme 参数。
     * 仅在主题真正变化时才重建，避免 openDrawer / kickThemeSync 反复调用导致多次加载。
     */
    function applyColorScheme(scheme) {
        var target = (scheme === 'dark') ? 'dark' : 'light';
        if (lastScheme === target) return; // 主题未变，跳过
        lastScheme = target;
        // 轻量尝试：通知 SDK 更新外壳主题
        try {
            if (global.DiversityComments &&
                typeof global.DiversityComments.setColorScheme === 'function') {
                global.DiversityComments.setColorScheme(scheme);
            }
        } catch (e) { /* ignore */ }
        // 可靠兜底：销毁并重建 widget，确保 iframe 内部主题正确
        if (sdkReady && state.pageId) {
            rebuildComments(state.pageId, state.options);
        }
    }

    /**
     * SDK 的 setColorScheme 在评论 iframe 尚未就绪（聚合页握手完成）时会直接忽略，
     * 因此用多次延迟重试覆盖 iframe 慢就绪的场景，确保主题最终落地。
     */
    function kickThemeSync() {
        [0, 500, 1500, 3000, 5000, 8000].forEach(function (delay) {
            setTimeout(function () { applyColorScheme(currentTheme()); }, delay);
        });
    }

    /**
     * 监听站点明暗变化：所有页面统一把 data-theme 标在 <html>，
     * 故只需监听 <html>；不支持 MutationObserver 时回退到 themeChanged 事件。
     */
    function observeThemeChange() {
        if (themeObserver) return; // 只注册一次
        if (typeof MutationObserver === 'undefined') {
            document.addEventListener('themeChanged', function () {
                applyColorScheme(currentTheme());
            });
            return;
        }
        themeObserver = new MutationObserver(function () {
            applyColorScheme(currentTheme());
        });
        themeObserver.observe(document.documentElement,
            { attributes: true, attributeFilter: ['data-theme'] });
    }

    /* ============================================================
     * 7. 样式注入
     * ============================================================ */

    /**
     * 注入 comments.css（只注入一次：靠 STYLE_ID 检测是否已存在，避免重复加载）。
     */
    function ensureStyleInjected() {
        if (document.getElementById(STYLE_ID)) return;
        var link = document.createElement('link');
        link.id = STYLE_ID;
        link.rel = 'stylesheet';
        link.href = STYLE_HREF;
        document.head.appendChild(link);
    }

    /**
     * 懒加载 fab-stack.js（右小角 FAB 栈管理器）；未加载时本模块不感知栈，
     * 但各 FAB 自身的 fixed bottom 仍能正常显示，仅失去自动堆叠避让。
     * 注意：路径来源用 IIFE 顶层缓存的 SCRIPT_SRC（见顶部），不再二次取 currentScript，
     * 否则 init() 被 inline script 触发时 currentScript 已不是 comments.js 自身。
     */
    function ensureFabStack() {
        if (global.FleaFabStack) return;
        try {
            var s = document.createElement('script');
            s.src = SCRIPT_SRC.replace(/\/js\/comments\.js(\?.*)?$/, '/js/fab-stack.js');
            s.async = false;
            s.onerror = function () { /* ignore */ };
            document.head.appendChild(s);
        } catch (e) { /* ignore */ }
    }

    /* ============================================================
     * 8. 悬浮 UI（FAB / 遮罩 / 抽屉的构建与开合）
     * ============================================================ */

    function buildUi() {
        if (document.getElementById(FAB_ID)) return; // 已构建则跳过

        // 悬浮按钮（FAB）
        var fab = document.createElement('button');
        fab.id = FAB_ID;
        fab.type = 'button';
        fab.className = 'flea-comments-fab';
        fab.setAttribute('aria-label', '打开评论');
        fab.title = '评论'; // 原生 hover 提示（节简不堆叠）
        // 注册到 fab-stack 栈管理器：N=1 表示评论位于栈底（最靠近屏幕底）
        fab.setAttribute('data-fab-stack', '1');
        fab.innerHTML =
            '<span class="fab-icon-open" aria-hidden="true">' + ICON_CHAT + '</span>' +
            '<span class="fab-icon-close" aria-hidden="true">' + ICON_CLOSE + '</span>';
        fab.addEventListener('click', toggleDrawer);
        document.body.appendChild(fab);

        // 遮罩
        var backdrop = document.createElement('div');
        backdrop.id = BACKDROP_ID;
        backdrop.className = 'flea-comments-backdrop';
        backdrop.addEventListener('click', closeDrawer);
        document.body.appendChild(backdrop);

        // 抽屉
        var drawer = document.createElement('aside');
        drawer.id = DRAWER_ID;
        drawer.className = 'flea-comments-drawer';
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
        drawer.setAttribute('aria-label', '评论');
        drawer.innerHTML =
            '<div class="flea-comments-drawer-header">' +
                '<span class="flea-comments-drawer-title">' +
                    '<span class="drawer-title-icon" aria-hidden="true">' +
                        ICON_CHAT + '</span> 游戏评论' +
                '</span>' +
                '<button type="button" class="flea-comments-drawer-close" ' +
                    'aria-label="关闭评论">' + ICON_CLOSE + '</button>' +
            '</div>' +
            '<div class="flea-comments-drawer-body">' +
                '<div id="' + CONTAINER_ID + '"></div>' +
            '</div>';
        document.body.appendChild(drawer);

        drawer.querySelector('.flea-comments-drawer-close')
            .addEventListener('click', closeDrawer);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && drawerOpen) closeDrawer();
        });

        dom.fab = fab;
        dom.backdrop = backdrop;
        dom.drawer = drawer;
        dom.container = drawer.querySelector('#' + CONTAINER_ID);
    }

    /**
     * 抽屉打开时隐藏整栈 FAB（评论 / 关卡 / 分享）。
     * 不隐藏的话，FAB 的 z-index（评论 2100、分享容器 3100）都高于遮罩(2000)与
     * 抽屉(2050)，抽屉打开后右下角仍杵着几个按钮挡视线、易误触。
     * 隐藏后关闭方式只剩：抽屉右上角 × / 点遮罩 / Esc —— 正是期望的交互。
     */
    function setFabsHidden(hidden) {
        if (global.FleaFabStack && typeof global.FleaFabStack.setHidden === 'function') {
            global.FleaFabStack.setHidden(hidden);
            return;
        }
        // 兜底：fab-stack.js 缺失时，直接给 body 加同名类（样式也随模块注入，
        // 此分支基本不会走到，仅防单例异常导致抽屉打开后按钮还在）。
        document.body.classList.toggle('flea-fabs-hidden', !!hidden);
    }

    function openDrawer() {
        if (!dom.drawer) return;
        drawerOpen = true;
        /* 分享菜单若正展开，先收起：它的遮罩 z-index 3050 会盖住抽屉(2050)，
           且子按钮展开状态在抽屉打开后是无效交互。 */
        if (global.FleaShare && typeof global.FleaShare.close === 'function') {
            try { global.FleaShare.close(); } catch (e) { /* ignore */ }
        }
        setFabsHidden(true);
        dom.drawer.classList.add('is-open');
        dom.backdrop.classList.add('is-open');
        dom.fab.classList.add('is-active');
        dom.fab.setAttribute('aria-label', '关闭评论');
        // 锁定背景滚动
        prevBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        // 同步主题（若 SDK 已就绪）。注意：不要在此调用 refresh()，否则每次打开抽屉
        // 都会让评论 iframe 重新渲染、重复加载评论内容。
        applyColorScheme(currentTheme());
    }

    function closeDrawer() {
        if (!dom.drawer || !drawerOpen) return;
        drawerOpen = false;
        setFabsHidden(false);
        dom.drawer.classList.remove('is-open');
        dom.backdrop.classList.remove('is-open');
        dom.fab.classList.remove('is-active');
        dom.fab.setAttribute('aria-label', '打开评论');
        document.body.style.overflow = prevBodyOverflow || '';
    }

    /** 切换抽屉：打开则收起，收起则打开 */
    function toggleDrawer() {
        if (drawerOpen) closeDrawer();
        else openDrawer();
    }

    /* ============================================================
     * 9. 评论 widget（配置构建 / 挂载 / 重建 / 初始化 / SDK 加载）
     * ============================================================ */

    function buildConfig(pageId, options) {
        // 优先使用远程配置（config/comments.json 深合并后的结果），否则回退内置默认
        var cfg = Object.assign({}, getConfig(), options || {});
        return {
            container: '#' + CONTAINER_ID,
            comments: {
                pageId: pageId,
                style: cfg.style,
                active: cfg.active,
                lazyload: cfg.lazyload,
                storage: cfg.storage,
                lang: cfg.lang
            },
            utterances: cfg.utterances,
            giscus: cfg.giscus,
            gitalk: cfg.gitalk,
            twikoo: cfg.twikoo,
            gitment: cfg.gitment,
            waline: cfg.waline,
            onReady: function (iframe, active) {
                sdkReady = true;
                lastScheme = currentTheme(); // 此时已是最新主题，避免 kickThemeSync 重复动作
                // 轻量同步一次 SDK 外壳主题
                try {
                    if (global.DiversityComments &&
                        typeof global.DiversityComments.setColorScheme === 'function') {
                        global.DiversityComments.setColorScheme(currentTheme());
                    }
                } catch (e) { /* ignore */ }
                // 如果 init 期间用户切了主题，widget 是按旧主题创建的，需要重建
                if (currentTheme() !== state.initTheme) {
                    rebuildComments(state.pageId, state.options);
                }
                kickThemeSync();
                if (typeof cfg.onReady === 'function') cfg.onReady(iframe, active);
            },
            onError: function (msg) {
                console.error('[FleaComments] 评论加载失败: ' + msg);
                if (typeof cfg.onError === 'function') cfg.onError(msg);
            },
            onActiveChange: function (active) {
                if (typeof cfg.onActiveChange === 'function') cfg.onActiveChange(active);
            }
        };
    }

    /**
     * 挂载评论 widget。
     * 在 init 配置里把主题定死（darkMode + utterances.theme），让 iframe 从一开始就
     * 按正确主题创建；运行时的主题切换由 applyColorScheme 处理（setColorScheme 轻量
     * 更新外壳 + 必要时 rebuild 确保 iframe 内部主题正确）。
     */
    function mountComments(pageId, options) {
        if (typeof global.DiversityComments === 'undefined') return;
        var isDark = (currentTheme() === 'dark');
        var config = buildConfig(pageId, options);
        // 关键：直接在 init 配置里把主题定死
        // ① darkMode 直接按站点主题定死（不依赖 SDK 的 auto / 系统 prefers-color-scheme）；
        // ② Utterances 主题设为站点主题对应的 github-dark/github-light，
        //    让 iframe 从一开始就按正确主题创建。
        config.comments.darkMode = isDark ? 'dark' : 'light';
        config.utterances = Object.assign({}, config.utterances, {
            theme: isDark
                ? (config.utterances.dark || 'github-dark')
                : (config.utterances.theme || 'github-light')
        });
        try {
            instance = global.DiversityComments.init(config);
        } catch (e) {
            console.error('[FleaComments] 初始化异常: ' + e.message);
            return;
        }
        observeThemeChange();
        kickThemeSync(); // 多次延迟重试，确保主题在 iframe 就绪后落地
    }

    /**
     * 用当前站点主题重建评论 widget（销毁旧实例 + 清空容器 + 重新 init）。
     * 用于主题真正变化后，确保 Utterances 等 iframe 子系统内部按新主题重新加载。
     */
    function rebuildComments(pageId, options) {
        if (typeof global.DiversityComments === 'undefined') return;
        // 销毁旧实例，避免 iframe 叠加
        if (global.DiversityComments &&
            typeof global.DiversityComments.destroy === 'function') {
            try { global.DiversityComments.destroy(); } catch (e) { /* ignore */ }
        }
        if (dom.container) dom.container.innerHTML = '';
        state.initTheme = currentTheme();
        mountComments(pageId, options);
    }

    function doInit(pageId, options) {
        if (typeof global.DiversityComments === 'undefined') {
            console.error('[FleaComments] DiversityComments SDK 未加载');
            return;
        }
        sdkReady = false;
        state.pageId = pageId;
        state.options = options || null;
        state.initTheme = currentTheme();
        lastScheme = currentTheme(); // 避免 init 阶段触发不必要的重建
        mountComments(pageId, options);
    }

    /**
     * 加载 SDK。async + 8s 超时兜底：外部 CDN 挂起时不阻塞页面，
     * 超时即移除挂起的脚本并放弃（评论暂不可用，页面不受影响）。
     */
    function ensureSdkLoaded(callback) {
        if (typeof global.DiversityComments !== 'undefined') {
            callback();
            return;
        }
        var settled = false;
        var sdk = document.createElement('script');
        sdk.src = SDK_URL;
        sdk.async = true;
        function settle() {
            if (settled) return;
            settled = true;
            sdk.onload = sdk.onerror = null;
            if (typeof global.DiversityComments !== 'undefined') callback();
            else console.error('[FleaComments] 无法加载 DiversityComments SDK: ' + SDK_URL);
        }
        sdk.onload = settle;
        sdk.onerror = settle;
        document.head.appendChild(sdk);
        setTimeout(function () {
            if (!settled && sdk.parentNode) sdk.parentNode.removeChild(sdk); // 超时移除挂起的脚本
            settle();
        }, SDK_LOAD_TIMEOUT);
    }

    /* ============================================================
     * 10. 公共接口 + 导出
     * ============================================================ */

    /**
     * 初始化评论（悬浮按钮 + 右侧抽屉）。
     * @param {string} pageId  页面唯一标识（如 'shudu'、'2048'、'home'）
     * @param {object} [options] 覆盖 COMMENT_CONFIG 中的字段
     */
    function init(pageId, options) {
        if (!pageId) {
            console.error('[FleaComments] 缺少 pageId 参数');
            return;
        }
        if (initialized) {
            console.warn('[FleaComments] 已初始化，忽略重复调用（pageId=' + pageId + '）');
            return;
        }
        ensureStyleInjected();
        ensureFabStack();
        buildUi();
        initialized = true;
        // 关键：SDK 只在页面 load 之后加载。
        // 原因：浏览器 window.load 会等待所有 async 脚本加载完成；若在页面解析期间就
        // 创建指向外部 CDN 的脚本，而该 CDN 挂起/不可达，load 将永不触发，标签页
        // 一直转圈（“无响应”）。推迟到 load 之后：load 只等本地资源 → 立即触发
        // → 页面正常；SDK 随后后台加载（async + 8s 超时兜底），挂起也不影响页面。
        var start = function () {
            // 优先加载 config/comments.json 并深合并覆盖内置默认；
            // 加载成功/失败/超时（5s 兜底）后，再继续 SDK 加载与 widget 构建，
            // 确保 buildConfig 拿到的是合并后的生效配置。
            loadRemoteConfig(function () {
                ensureSdkLoaded(function () { doInit(pageId, options); });
            });
        };
        if (document.readyState === 'complete') start();
        else window.addEventListener('load', start);
    }

    global.FleaComments = {
        init: init,
        config: COMMENT_CONFIG,
        /** 打开评论抽屉 */
        open: openDrawer,
        /** 关闭评论抽屉 */
        close: closeDrawer
    };
})(window);
