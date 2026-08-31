/**
 * Flea Game 公共分享接入模块（右下角悬浮按钮 + 半圆扇形展开）
 * =========================================================================
 * 零侵入、可独立接入（镜像评论模块 comments.js 的形态）：
 *   - 右下角悬浮分享按钮（FAB），点击后沿“半圆/扇形”弧线展开各分享平台子按钮
 *   - 再次点击主按钮 / 点遮罩 / 按 Esc 收起
 *   - 子按钮点击后跳转到对应平台的分享地址（复制链接走剪贴板 + 轻提示）
 *   - 跟随站点明暗主题（组件自带配色变量，不依赖页面 CSS）
 *   - 图标用内联 SVG，不依赖 Font Awesome，CDN 挂起时图标依然可见
 *   - 平台列表与分享文案可经 config/share.json 深合并覆盖内置默认
 *   - 内置 14 个平台（微信/小红书/微博/QQ空间/QQ/抖音/知乎/豆瓣/贴吧/X/FB/Telegram/邮件/复制），
 *     无公开 Web 分享接口的国内平台自动走「复制定制文案 + 定制 toast 提示」：
 *     复制内容为「标题 + 链接（+ 附加文案）」，与「复制链接」平台只复制 URL 区分，
 *     粘贴到不同 App 时不再是千篇一律的裸链接。
 *   - 微信额外支持「扫码直达」：桌面端点击弹二维码（PC 无法直接唤起微信分享，
 *     扫码后即可转发）；移动端自动回退为复制链接。二维码库本地懒加载，缺失时兜底复制。
 *
 * 自动避让：若页面已存在其它右下角 FAB（评论 / 选择关卡），
 * 本按钮会自动向上堆叠，避免重叠。
 *
 * 页面只需两行（顺序在评论脚本之后）：
 *   <script src="assets/js/share.js"></script>
 *   <script>FleaShare.init();</script>
 * 需要覆盖默认文案/平台：FleaShare.init({ share:{title:'...'}, platforms:[...] })
 * =========================================================================
 */
(function (global) {
    'use strict';

    /* ============================================================
     * 1. 常量与资源
     * ============================================================ */
    var STYLE_ID = 'flea-share-style';

    /** 解析 share.css 路径：页面均为同步引入，取当前脚本 src 即可 */
    function resolveStyleHref() {
        var src = '';
        try {
            src = (document.currentScript && document.currentScript.src) || '';
        } catch (e) { /* ignore */ }
        if (!src) return '../assets/css/share.css';
        return src.replace(/\/js\/share\.js(\?.*)?$/, '/css/share.css');
    }
    var STYLE_HREF = resolveStyleHref();

    /**
     * 缓存本模块脚本 src：IIFE 顶层取一次，init() 后续被 inline script 调用时
     * document.currentScript 已不是 share.js 自身，必须用此缓存值推断 fab-stack.js 路径。
     */
    var SCRIPT_SRC = (function () {
        try {
            return (document.currentScript && document.currentScript.src) || '';
        } catch (e) { return ''; }
    })();

    var FAB_ID = 'flea-share-fab';
    var BACKDROP_ID = 'flea-share-backdrop';
    var MENU_ID = 'flea-share-menu';

    // config 目录下的分享配置文件（优先于内置默认）。地址推算交给公共模块 FleaCommon。
    var SHARE_CONFIG_URL = (global.FleaCommon && typeof global.FleaCommon.resolveConfigUrl === 'function')
        ? global.FleaCommon.resolveConfigUrl('share.json')
        : 'config/share.json';

    /* 内联 SVG 图标（不依赖 Font Awesome；fill 继承按钮 color）
       分享图标采用 Material 标准的"三节点连线"造型（share-nodes）：
       三个实心圆点 + 两条连线构成"分享/网络"语义，
       单条 fill 闭合 path 渲染，视觉饱满、与"四格"关卡和"气泡"评论同级别。 */
    var ICON_SHARE =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>' +
        '</svg>';
    var ICON_CLOSE =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 ' +
        '17.59 19 19 17.59 13.41 12z"/></svg>';

    /**
     * 各平台的内联 SVG 图标（24x24，fill=currentColor，由按钮 color 着色）。
     * 采用简洁可辨识的图形，不依赖品牌官方 logo 的精确路径。
     */
    var PLATFORM_ICONS = {
        /* 微博：圆脸 + 双眼 + 嘴 */
        weibo:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 3.4a5.6 5.6 0 0 1 5.5 4.6 2.7 2.7 0 0 1-5.4.2 2.7 2.7 0 0 1-5.4-.2A5.6 5.6 0 0 1 12 6.4zM8.6 12.3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6.8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>',
        /* QQ空间：五角星 */
        qzone:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.8 5.9 20.4l1.3-6.7-5-4.7 6.8-.8z"/></svg>',
        /* QQ：企鹅剪影 */
        qq:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c-3.3 0-5.5 2.6-5.5 6.2 0 1.4-.9 2.3-1.6 3.4-.6.9-.9 1.7-.9 2.8 0 1.7 1.3 3 3 3 .3 1.6 1.6 2.6 3 2.6h4.9c1.4 0 2.7-1 3-2.6 1.7 0 3-1.3 3-3 0-1.1-.3-1.9-.9-2.8-.7-1.1-1.6-2-1.6-3.4C17.5 4.6 15.3 2 12 2zm-2.4 9.9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm4.8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>',
        /* X（推特）：两笔交叉 */
        twitter:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
        /* Facebook：f */
        facebook:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.78-3.9 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.91h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94z"/></svg>',
        /* Telegram：纸飞机 */
        telegram:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.94 4.6 18.9 19.04c-.23 1.01-.83 1.26-1.69.78l-4.66-3.43-2.25 2.17c-.25.25-.46.46-.94.46l.33-4.72L18.4 6.1c.37-.33-.08-.51-.58-.18L7.68 12.9.96 10.66c-.99-.31-1.01-.99.2-1.47L20.7 2.4c.87-.32 1.63.2 1.24 2.2z"/></svg>',
        /* 邮件：信封 */
        email:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.5 4h17A1.5 1.5 0 0 1 22 5.5v13A1.5 1.5 0 0 1 20.5 20h-17A1.5 1.5 0 0 1 2 18.5v-13A1.5 1.5 0 0 1 3.5 4zm.5 1.7 8 5 8-5v.1l-8 5-8-5z"/></svg>',
        /* 复制链接：Material 标准链环（实心 fill，修复旧 stroke-only 路径在 fill 模式下渲染错误） */
        copy:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>',
        /* 微信：双聊天气泡（一主一从，右侧带小尾巴），内部两点 */
        wechat:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.3 4.6C5.4 4.6 2.2 7.3 2.2 10.7c0 2 1.1 3.8 2.8 5l-.4 3.3 3.6-1.8c.35.1.7.16 1.1.16h.6c-.6-1-.9-2.2-.9-3.4 0-3.5 3.4-6.4 7.5-6.4h.6C16.5 6.3 13.2 4.6 9.3 4.6z"/><path fill="currentColor" d="M21.5 13.6c0-2.9-2.9-5.3-6.4-5.3s-6.4 2.4-6.4 5.3 2.9 5.3 6.4 5.3c.6 0 1.2-.1 1.7-.2l2.9 1.5-.4-2.7c1.5-1 2.2-2.3 2.2-3.9zm-8.5-.6a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zm4.2 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z"/></svg>',
        /* 小红书：图文笔记（文档 + 三条横线） */
        xiaohongshu:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM8 17.5c-.55 0-1-.45-1-1s.45-1 1-1h8c.55 0 1 .45 1 1s-.45 1-1 1H8zm0-4c-.55 0-1-.45-1-1s.45-1 1-1h8c.55 0 1 .45 1 1s-.45 1-1 1H8zm6-5V3.6L18.4 8.5H15c-.55 0-1-.45-1-1z"/></svg>',
        /* 抖音：音符（Music Note，Material） */
        douyin:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>',
        /* 知乎：问答（圆形问号，Material Help） */
        zhihu:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>',
        /* 豆瓣：打开的书 + 书签（书影音评分） */
        douban:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>',
        /* 百度贴吧：发帖对话框（双气泡，Material Forum） */
        tieba:
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4-3H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1z"/></svg>'
    };

    /* ============================================================
     * 2. 默认分享配置（内置默认；实际平台 / 文案由 config/share.json 覆盖）
     * ============================================================ */
    /**
     * 分享模块统一配置（公共接入的唯一默认来源）。
     * - platforms：默认开启的分享平台列表（顺序即展开顺序）。
     * - share：默认分享文案（url/title/text/image），缺省时自动取当前页面信息。
     * - arc：扇形展开几何（角度为数学坐标：0=右,90=上,180=左,270=下）。
     *   默认 start=90、spread=90 即在右下角向上-向左展开 90° 扇形；
     *   若把 FAB 置于底边中央，可设 spread=180 得到真正半圆形。
     */
    var SHARE_CONFIG = {
        platforms: [
            /* 国内常用（无公开 Web 分享接口的平台走「复制定制文案 + 定制提示」：
               copy 返回「标题 + 链接（+ 附加文案）」，copyTip 指引去对应 App 粘贴；
               与「复制链接」平台只复制 URL 区分开。
               微信额外支持 qr：桌面端点击弹「微信扫一扫」二维码直达（PC 无法直接唤起
               微信分享，扫码是标准做法）；移动端自动回退为复制链接。 */
            { id: 'wechat',   label: '微信',   bg: '#07c160', iconColor: '#fff', icon: PLATFORM_ICONS.wechat,
              qr: true,
              copy: function (c) { return shareText(c); },
              copyTip: '已复制，去微信粘贴给好友' },
            { id: 'xiaohongshu', label: '小红书', bg: '#ff2442', iconColor: '#fff', icon: PLATFORM_ICONS.xiaohongshu,
              copy: function (c) { return shareText(c); },
              copyTip: '已复制，去小红书粘贴发布' },
            { id: 'weibo',   label: '微博',   bg: '#e6162d', iconColor: '#fff', icon: PLATFORM_ICONS.weibo,
              url: function (c) { return 'https://service.weibo.com/share/share.php?url=' + enc(c.url) + '&title=' + enc(c.title); } },
            { id: 'qzone',   label: 'QQ空间', bg: '#ffce00', iconColor: '#3a2e00', icon: PLATFORM_ICONS.qzone,
              url: function (c) { return 'https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url=' + enc(c.url) + '&title=' + enc(c.title) + '&summary=' + enc(c.text) + '&pics=' + enc(c.image); } },
            { id: 'qq',      label: 'QQ',     bg: '#12b7f5', iconColor: '#fff', icon: PLATFORM_ICONS.qq,
              url: function (c) { return 'https://connect.qq.com/widget/shareqq/index.html?url=' + enc(c.url) + '&title=' + enc(c.title) + '&summary=' + enc(c.text) + '&pics=' + enc(c.image); } },
            { id: 'douyin',  label: '抖音',   bg: '#fe2c55', iconColor: '#fff', icon: PLATFORM_ICONS.douyin,
              copy: function (c) { return shareText(c); },
              copyTip: '已复制，去抖音粘贴分享' },
            { id: 'zhihu',   label: '知乎',   bg: '#0084ff', iconColor: '#fff', icon: PLATFORM_ICONS.zhihu,
              copy: function (c) { return shareText(c); },
              copyTip: '已复制，去知乎粘贴分享' },
            { id: 'douban',  label: '豆瓣',   bg: '#00b51d', iconColor: '#fff', icon: PLATFORM_ICONS.douban,
              url: function (c) { return 'https://www.douban.com/share/service?href=' + enc(c.url) + '&name=' + enc(c.title); } },
            { id: 'tieba',   label: '百度贴吧', bg: '#3385ff', iconColor: '#fff', icon: PLATFORM_ICONS.tieba,
              url: function (c) { return 'https://tieba.baidu.com/f/commit/share/openShareApi?url=' + enc(c.url) + '&title=' + enc(c.title); } },
            /* 海外与工具类 */
            { id: 'twitter', label: 'X',      bg: '#1d9bf0', iconColor: '#fff', icon: PLATFORM_ICONS.twitter,
              url: function (c) { return 'https://twitter.com/intent/tweet?url=' + enc(c.url) + '&text=' + enc(c.title + (c.text ? ' ' + c.text : '')); } },
            { id: 'facebook',label: 'Facebook',bg: '#1877f2', iconColor: '#fff', icon: PLATFORM_ICONS.facebook,
              url: function (c) { return 'https://www.facebook.com/sharer/sharer.php?u=' + enc(c.url); } },
            { id: 'telegram',label: 'Telegram',bg: '#229ed9', iconColor: '#fff', icon: PLATFORM_ICONS.telegram,
              url: function (c) { return 'https://t.me/share/url?url=' + enc(c.url) + '&text=' + enc(c.title); } },
            { id: 'email',   label: '邮件',   bg: '#6c757d', iconColor: '#fff', icon: PLATFORM_ICONS.email,
              url: function (c) { return 'mailto:?subject=' + enc(c.title) + '&body=' + enc((c.text ? c.text + '\n' : '') + c.url); } },
            { id: 'copy',    label: '复制链接', bg: '#555b66', iconColor: '#fff', icon: PLATFORM_ICONS.copy,
              /* 只复制纯 URL，与复制类平台的「标题+链接」区分 */
              copy: function (c) { return c.url; } }
        ],
        share: {
            url: '',      // 空 → 自动取 location.href
            title: '',    // 空 → 自动取 document.title
            text: '',     // 附加文案（可选）
            image: ''     // 分享配图（可选）
        },
        arc: {
            start: 90,    // 起始角（度）：90=正上方（FAB 在右下时向上的方向）
            spread: 120,  // 展开总角度（度）：正上(90°)→正左(180°)再略过一点
            radius: 190   // 子按钮距主按钮半径（px）：见 layoutItems() 的反推说明
        }
    };

    function enc(s) { return encodeURIComponent(s == null ? '' : String(s)); }

    /**
     * 复制类平台统一文本：标题 + 链接（+ 附加文案）。
     * 与「复制链接」平台只复制 URL 区分开——粘贴到对应 App 时内容更完整，
     * 不会让各平台复制结果千篇一律。
     */
    function shareText(c) {
        var s = (c.title || '') + '\n' + (c.url || '');
        if (c.text) s += '\n' + c.text;
        return s;
    }

    /* ============================================================
     * 2.5 明暗配色派生（子按钮专用）
     * ============================================================
     * 亮色下子按钮直接用各平台品牌色，辨识度最高；
     * 暗色下高饱和的亮色圆点在深底上过于跳眼，故由品牌色自动派生两套色：
     *   - 背景（bg）：品牌色压暗，L→32%、饱和度略降 → 融入暗底
     *   - 图标（fg）：品牌色提亮，L→62%、饱和度略升 → 在压暗的底上依然清晰
     * 色相 H 恒定不变，所以微博仍"红"、QQ 仍"蓝"、QQ空间仍"金"，
     * 平台辨识度不丢。平台也可用 bgDark / iconColorDark 显式覆盖派生结果。
     *
     * 注意：两套色必须写成 CSS 变量由 share.css 按主题取用，不能直接写
     * style.background / style.color —— 内联样式优先级最高，暗色规则压不过，
     * 这正是此前「暗色下子按钮背景和图标纹丝不动」的根因。
     * ============================================================ */

    /** #rgb / #rrggbb → [r,g,b]，非法输入返回 null */
    function parseHex(hex) {
        var s = String(hex || '').trim().replace('#', '');
        if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
        if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
        return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
    }

    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

    /** RGB(0-255) → HSL（h: 0-360，s/l: 0-1） */
    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var d = max - min;
        var h = 0, s = 0, l = (max + min) / 2;
        if (d > 0) {
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
        }
        return [h, s, l];
    }

    function hue2rgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    }

    /** HSL → #rrggbb */
    function hslToHex(h, s, l) {
        h = (((h % 360) + 360) % 360) / 360;
        s = clamp01(s); l = clamp01(l);
        var r, g, b;
        if (s === 0) { r = g = b = l; }
        else {
            var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            var p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        function to2(v) {
            var n = Math.round(clamp01(v) * 255).toString(16);
            return n.length === 1 ? '0' + n : n;
        }
        return '#' + to2(r) + to2(g) + to2(b);
    }

    /**
     * 由品牌色派生暗色主题下的子按钮配色。
     * @param {string} hex  品牌色（亮色底）
     * @param {string} role 'bg' 派生压暗底 / 'fg' 派生提亮图标
     */
    function deriveDark(hex, role) {
        var rgb = parseHex(hex);
        if (!rgb) return role === 'bg' ? '#333' : '#e8e8e8';
        var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
        if (role === 'bg') {
            /* 邮箱(#6c757d)/复制链接(#555b66) 这类低饱和灰压暗后会变成死灰，
               给饱和度兜一个下限，压暗后仍带一点冷色，不至于和阴影糊在一起 */
            return hslToHex(hsl[0], Math.min(0.75, Math.max(0.2, hsl[1] * 0.85)), Math.min(hsl[2], 0.32));
        }
        /* 图标只在偏暗时提亮，已够亮的（如 QQ空间金黄）保持原亮度，避免洗白 */
        return hslToHex(hsl[0], Math.min(0.95, hsl[1] * 1.15), Math.max(hsl[2], 0.62));
    }

    /* ============================================================
     * 3. 模块状态
     * ============================================================ */
    var initialized = false;
    var menuOpen = false;
    var dom = {};
    var mergedConfig = null;       // config/share.json 深合并后的生效配置
    var configLoaded = false;
    var activePlatforms = [];
    var shareData = null;
    /* 堆叠位置由 assets/js/fab-stack.js 统一管理（通过 data-fab-stack 属性）；
       此处保留 stackGap 仅用于分享菜单展开后子按钮的偏移计算（已废弃但兼容旧调用）。 */
    var stackGap = 0;

    /* ============================================================
     * 4. 工具函数
     * ============================================================ */

    /** 取得当前生效配置：合并后的远程配置优先，否则用内置默认 */
    function getConfig() {
        return mergedConfig != null ? mergedConfig : SHARE_CONFIG;
    }

    /** 计算分享文案：先用选项/远程覆盖，再回退到页面自动信息 */
    function getShareData() {
        var cfg = getConfig().share || {};
        return {
            url: cfg.url || global.location.href,
            title: cfg.title || document.title || '趣味AI合成小游戏',
            text: cfg.text || '',
            image: cfg.image || ''
        };
    }

    /* ============================================================
     * 5. 远程配置加载（config/share.json 深合并覆盖默认）
     * ============================================================ */
    function loadRemoteConfig(done) {
        if (configLoaded) { done(); return; }
        configLoaded = true;
        var Common = global.FleaCommon;
        if (!Common || typeof Common.loadConfig !== 'function') { done(); return; }
        var sep = SHARE_CONFIG_URL.indexOf('?') === -1 ? '?' : '&';
        var url = SHARE_CONFIG_URL + sep + 't=' + Date.now();
        Common.loadConfig(url, SHARE_CONFIG, { timeout: 5000 })
            .then(function (merged) { mergedConfig = merged; })
            .then(done, done);
    }

    /* ============================================================
     * 6. 样式注入 + 懒加载 fab-stack.js（右下角 FAB 栈管理器）
     * ============================================================ */
    function ensureStyleInjected() {
        if (document.getElementById(STYLE_ID)) return;
        var link = document.createElement('link');
        link.id = STYLE_ID;
        link.rel = 'stylesheet';
        link.href = STYLE_HREF;
        document.head.appendChild(link);
    }

    /** 懒加载 fab-stack.js（如页面未显式引入），失败兜底使用本模块自带堆叠逻辑
     *  注意：路径来源用 IIFE 顶层缓存的 SCRIPT_SRC（见顶部），不再二次取 currentScript */
    function ensureFabStack() {
        if (global.FleaFabStack) return;
        try {
            var s = document.createElement('script');
            s.src = SCRIPT_SRC.replace(/\/js\/share\.js(\?.*)?$/, '/js/fab-stack.js');
            s.async = false;
            s.onerror = function () { /* 加载失败也继续，本模块自带兜底 */ };
            document.head.appendChild(s);
        } catch (e) { /* ignore */ }
    }

    /* ============================================================
     * 7. 与其它右下角 FAB 自动堆叠避让
     * ============================================================
     * 堆叠位置已交由 assets/js/fab-stack.js 统一管理（通过 data-fab-stack 属性）。
     * 本节保留为兼容层：若 fab-stack.js 未加载（理论上不会），仍由本模块兜底扫描 [class*="fab"]。
     * ============================================================ */
    function computeStackBottom() {
        if (global.FleaFabStack && typeof global.FleaFabStack.refresh === 'function') {
            /* 让 fab-stack.js 接管，无需重复计算 */
            return 0;
        }
        var best = 0; // 已有 FAB 顶部距视口底部的距离
        var fabs = document.querySelectorAll('[class*="fab"]');
        Array.prototype.forEach.call(fabs, function (el) {
            if (el.id === FAB_ID) return;
            var cs = null;
            try { cs = global.getComputedStyle(el); } catch (e) { cs = null; }
            if (!cs || cs.position !== 'fixed') return;
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            // 仅考虑靠近右下角的 FAB（right 较小、bottom 较小）
            var distRight = global.innerWidth - rect.right;
            if (distRight > 120) return; // 不在右侧区域
            var aboveBottom = global.innerHeight - rect.top; // FAB 顶部到视口底
            if (aboveBottom > best) best = aboveBottom;
        });
        return best + stackGap;
    }

    function applyStackPosition() {
        if (!dom.menu) return;
        /* 优先委托给 fab-stack.js；未加载时本模块内部兜底 */
        if (global.FleaFabStack && typeof global.FleaFabStack.refresh === 'function') {
            global.FleaFabStack.refresh();
            return;
        }
        var bottom = computeStackBottom();
        dom.menu.style.bottom = (bottom > 0 ? bottom : stackGap) + 'px';
    }

    /* ============================================================
     * 8. 扇形几何：计算每个子按钮的偏移量
     * ============================================================ */
    /**
     * 子按钮直径：读实际 DOM 尺寸，自动跟随 CSS 的 --flea-share-item-size
     * 响应式取值（手机 42 / 桌面 44 / 横屏小屏 38）。
     * 读到异常值（CSS 尚未加载时 SVG 会撑出默认尺寸）则回退到按视口估算。
     */
    function getItemSize() {
        var raw = (dom.items && dom.items[0]) ? dom.items[0].offsetWidth : 0;
        if (raw >= 24 && raw <= 64) return raw;
        return (global.innerWidth && global.innerWidth < 600) ? 42 : 44;
    }

    /** 主按钮中心到视口各边的可用距离（px），用于约束展开半径不出血 */
    function viewportRoom() {
        var vw = global.innerWidth || 1024;
        var vh = global.innerHeight || 800;
        var fab = dom.menu;
        /* 用 getBoundingClientRect 读真实位置，而不是 el.style.bottom：
           fab-stack.js 是懒加载的，本模块首次布局时它往往还没把 bottom 从
           CSS 兜底值(24px)改写到真实堆叠值(如 152px)，读 inline style 会
           把"到视口顶的剩余空间"算大，进而放行过大的半径导致顶部出血。 */
        if (fab && fab.getBoundingClientRect) {
            var r = fab.getBoundingClientRect();
            if (r.height > 0) {
                var cy = r.top + r.height / 2;
                return { up: cy, down: vh - cy, left: r.left + r.height / 2 };
            }
        }
        var half = getItemSize() / 2;
        return { up: vh / 2, down: vh / 2, left: vw - half - 20 };
    }

    /**
     * 解算扇形：返回 { r 半径, shift 整体上移量 }
     *
     * 半径不是拍脑袋定的，而是由「相邻两子按钮的弦长 ≥ 直径 + 间隙」反推：
     *     弦长 = 2 · r · sin(Δ/2)，Δ = spread / (n - 1)
     * 8 个平台 + spread=120° → Δ=17.14°，要求弦长 ≥ 44 + 12 = 56px
     *     → r ≥ 56 / (2 · sin 8.57°) ≈ 188，故基准取 190。
     * 旧值 radius=132 时弦长仅 45.8px，44px 的按钮几乎贴脸；手机上再被
     * 收窄到 96~110，弦长只剩 30px 出头，8 个按钮直接叠成一团。
     *
     * 关键：视口不够时**不缩半径**，而是把整条弧平移。
     * 缩半径会把按钮挤回重叠状态（旧代码的毛病），而弧的末端（210°）只是
     * 稍微探到主按钮下方，整体上移十几像素即可让出底部空间，间距不受影响。
     */
    function resolveArc(start, spread, n) {
        var base = (getConfig().arc || SHARE_CONFIG.arc).radius || 190;
        var r = base;
        if (n > 1) {
            var step = spread / (n - 1);                   // 相邻夹角（度）
            var need = (getItemSize() + 12) / (2 * Math.sin(step * Math.PI / 360));
            if (need > r) r = need;
        }

        /* 弧在「单位半径」下的包络：minTy 最靠上(负)、maxTy 最靠下(正)、minTx 最靠左(负) */
        var top = 0, bottom = 0, leftMost = 0;
        for (var i = 0; i < n; i++) {
            var a = ((n === 1) ? start : start + (spread * i) / (n - 1)) * Math.PI / 180;
            var ty = -Math.sin(a), tx = Math.cos(a);
            if (i === 0 || ty < top) top = ty;
            if (i === 0 || ty > bottom) bottom = ty;
            if (i === 0 || tx < leftMost) leftMost = tx;
        }

        var room = viewportRoom();
        var pad = getItemSize() / 2 + 12;   // 子按钮半径 + 与视口边缘的余量

        // 只有在「整条弧的跨度」塞不下时才等比缩半径（此时确实无解，只能变小）
        var vSpan = (bottom - top) * r;
        var vAvail = room.up + room.down - 2 * pad;
        if (vSpan > 0 && vSpan > vAvail) r = vAvail / (bottom - top);
        var hNeed = -leftMost * r;
        var hAvail = room.left - pad;
        if (hNeed > 0 && hNeed > hAvail) r = hAvail / -leftMost;
        r = Math.max(70, Math.min(r, 240));

        /* 平移：先保证底部不出界；若因此顶到视口上边，再反向让出顶部 */
        var shift = 0;
        if (bottom * r + pad > room.down) shift = bottom * r + pad - room.down;
        if (room.up + (top * r - shift) - pad < 0) shift = room.up + top * r - pad;
        return { r: r, shift: shift };
    }

    /**
     * 补算扇形：半径同时依赖「share.css 生效后的子按钮尺寸」和「fab-stack.js
     * 落位后的主按钮坐标」，两者都是异步就绪的，首帧算出来的值可能偏大。
     * 在几个时机各重算一次即可收敛（菜单未展开时不可见，无感）。
     */
    function scheduleRelayout() {
        [0, 60, 250, 600].forEach(function (ms) {
            setTimeout(function () { layoutItems(); }, ms);
        });
    }

    function layoutItems() {
        var arc = getConfig().arc || SHARE_CONFIG.arc;
        var n = activePlatforms.length;
        var start = (typeof arc.start === 'number') ? arc.start : 90;
        var spread = (typeof arc.spread === 'number') ? arc.spread : 120;
        /* 平台数多时自动扩张扇形总角度：保证相邻夹角 ≥ 14°。
           14° 在半径上限 240 时弦长 ≈58px，恰容纳 44px 子按钮 + 14px 间隙；
           默认 8 平台 120°（夹角 17.1°）不变，14 平台自动扩到 182° 仍不重叠。
           配置里显式写更大的 spread 时尊重配置。 */
        var minSpread = (n - 1) * 14;
        if (spread < minSpread) spread = minSpread;
        var geo = resolveArc(start, spread, n);
        for (var i = 0; i < n; i++) {
            var angle;
            if (n === 1) angle = start;
            else angle = start + (spread * i) / (n - 1);
            var rad = angle * Math.PI / 180;
            // 屏幕坐标 y 向下，故向上为负；shift 为整条弧避让视口边缘的平移量
            var tx = geo.r * Math.cos(rad);
            var ty = -geo.r * Math.sin(rad) - geo.shift;
            var btn = dom.items[i];
            if (!btn) continue;
            btn.style.setProperty('--tx', tx.toFixed(1) + 'px');
            btn.style.setProperty('--ty', ty.toFixed(1) + 'px');
            btn.style.setProperty('--delay', (i * 0.028).toFixed(3) + 's');
        }
    }

    /**
     * 平台列表解析：远程/页面配置的 platforms 项若带 id 且命中内置模板，
     * 以「内置模板为底 + 配置项覆盖外观」合并 —— JSON 无法携带 url/copy/icon
     * 等函数字段，若不补齐，配置里写 platform 会导致点击无反应。
     * 未命中模板的项（自定义平台）原样返回，其函数字段只能由页面级 options 提供。
     */
    function resolvePlatforms(list) {
        var builtin = SHARE_CONFIG.platforms || [];
        var byId = {};
        for (var i = 0; i < builtin.length; i++) byId[builtin[i].id] = builtin[i];
        return (list || []).map(function (p) {
            if (p && p.id && byId[p.id]) return Object.assign({}, byId[p.id], p);
            return p;
        });
    }

    /* ============================================================
     * 9. 悬浮 UI 构建（FAB / 遮罩 / 扇形菜单）
     * ============================================================ */
    function buildUi() {
        if (document.getElementById(FAB_ID)) return; // 已构建则跳过
        activePlatforms = resolvePlatforms(getConfig().platforms || []);
        shareData = getShareData();

        // 遮罩
        var backdrop = document.createElement('div');
        backdrop.id = BACKDROP_ID;
        backdrop.className = 'flea-share-backdrop';
        backdrop.addEventListener('click', closeMenu);
        document.body.appendChild(backdrop);

        // 容器（含主按钮 + 子按钮）
        var menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.className = 'flea-share';
        // 注册到 fab-stack 栈管理器：N=3 表示分享位于栈顶
        menu.setAttribute('data-fab-stack', '3');

        // 主按钮（FAB）
        var fab = document.createElement('button');
        fab.id = FAB_ID;
        fab.type = 'button';
        fab.className = 'flea-share-fab';
        fab.setAttribute('aria-label', '分享');
        fab.title = '分享'; // 原生 hover 提示
        fab.setAttribute('aria-expanded', 'false');
        fab.innerHTML =
            '<span class="fab-icon-open" aria-hidden="true">' + ICON_SHARE + '</span>' +
            '<span class="fab-icon-close" aria-hidden="true">' + ICON_CLOSE + '</span>';
        fab.addEventListener('click', toggleMenu);
        menu.appendChild(fab);

        // 子按钮（扇形）
        dom.items = [];
        activePlatforms.forEach(function (p) {
            var item = document.createElement('button');
            item.type = 'button';
            item.className = 'flea-share-item';
            item.setAttribute('aria-label', '分享到' + p.label);
            /* 明暗两套配色都写入 CSS 变量，交由 share.css 按主题取用。
               直接写 style.background / style.color 属于内联样式、优先级最高，
               暗色规则压不过 → 背景与图标在任何主题下都保持亮色，正是本次要修的问题。 */
            var bgLight = p.bg || '#555';
            item.style.setProperty('--flea-share-item-bg', bgLight);
            item.style.setProperty('--flea-share-item-fg', p.iconColor || '#fff');
            item.style.setProperty('--flea-share-item-bg-dark', p.bgDark || deriveDark(bgLight, 'bg'));
            /* 暗色图标由「品牌色」而非 iconColor 派生：iconColor 在亮色下多半是纯白，
               拿白色去提亮得到的还是白色，无法体现平台色彩。 */
            item.style.setProperty('--flea-share-item-fg-dark', p.iconColorDark || deriveDark(bgLight, 'fg'));
            item.innerHTML =
                '<span class="flea-share-item-icon" aria-hidden="true">' + (p.icon || '') + '</span>';
            // 平台名不再以 DOM 标签渲染，改用原生 title 悬浮提示，节省空间
            item.title = p.label;
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                triggerPlatform(p);
            });
            menu.appendChild(item);
            dom.items.push(item);
        });

        document.body.appendChild(menu);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && menuOpen) closeMenu();
        });

        dom.fab = fab;
        dom.backdrop = backdrop;
        dom.menu = menu;

        /* 顺序有讲究：先定位再算扇形——半径的视口上限依赖主按钮最终的 bottom，
           若按 CSS 兜底值(24)计算，会被误判成"离视口底太近"而把半径压到最小。 */
        applyStackPosition();
        layoutItems();
        /* 让 fab-stack.js 立即感知新加入的 menu，重算栈顺序 */
        if (global.FleaFabStack && typeof global.FleaFabStack.refresh === 'function') {
            global.FleaFabStack.refresh();
        }
        scheduleRelayout();
        global.addEventListener('resize', function () { applyStackPosition(); layoutItems(); });
    }

    /* ============================================================
     * 10. 菜单开合
     * ============================================================ */
    function openMenu() {
        if (!dom.menu || menuOpen) return;
        menuOpen = true;
        dom.menu.classList.add('is-open');
        dom.backdrop.classList.add('is-open');
        dom.fab.classList.add('is-active');
        dom.fab.setAttribute('aria-expanded', 'true');
        dom.fab.setAttribute('aria-label', '收起分享');
    }

    function closeMenu() {
        if (!dom.menu || !menuOpen) return;
        menuOpen = false;
        dom.menu.classList.remove('is-open');
        dom.backdrop.classList.remove('is-open');
        dom.fab.classList.remove('is-active');
        dom.fab.setAttribute('aria-expanded', 'false');
        dom.fab.setAttribute('aria-label', '分享');
    }

    function toggleMenu() {
        if (menuOpen) closeMenu(); else openMenu();
    }

    /* ============================================================
     * 11. 触发分享
     * ============================================================ */
    function triggerPlatform(p) {
        var ctx = shareData || getShareData();
        // 二维码类（微信等无公开 Web 接口、但可扫码直达的平台）
        if (p.qr) {
            triggerQr(p, ctx);
            closeMenu();
            return;
        }
        // 复制类
        if (typeof p.copy === 'function' || typeof p.copy === 'string') {
            var text = (typeof p.copy === 'function') ? p.copy(ctx) : p.copy;
            copyText(text, p.copyTip);
            closeMenu();
            return;
        }
        // URL 类
        if (typeof p.url === 'function' || typeof p.url === 'string') {
            var u = (typeof p.url === 'function') ? p.url(ctx) : p.url;
            if (u) global.open(u, '_blank', 'noopener,noreferrer');
            closeMenu();
            return;
        }
        // 自定义 run
        if (typeof p.run === 'function') {
            try { p.run(ctx, { copy: copyText, open: function (x) { global.open(x, '_blank', 'noopener,noreferrer'); }, toast: showToast }); }
            catch (e) { /* ignore */ }
            closeMenu();
        }
    }

    /* ============================================================
     * 11.5 二维码分享（微信等平台的「扫码直达」）
     * ============================================================
     * PC 浏览器无法直接唤起微信分享（JS-SDK 需公众号 + 后端签名、且仅限微信内），
     * 桌面端标准做法是弹二维码让用户扫码后转发。移动端扫码不便，自动回退复制链接。
     * 二维码库 assets/js/vendor/qrcode.min.js（qrcode-generator，MIT）按需懒加载，
     * 加载失败（本地文件缺失）兜底为复制链接，功能不中断。
     * ============================================================ */

    /** 移动端 UA 判断（扫码在桌面端才有意义） */
    function isMobileUA() {
        return /Android|iPhone|iPad|iPod|Mobile/i.test(global.navigator.userAgent || '');
    }

    var qrLibState = 0; // 0 未加载 / 1 加载中 / 2 已就绪 / -1 加载失败
    function ensureQrLib(done) {
        if (qrLibState === 2) { done(true); return; }
        if (qrLibState === -1) { done(false); return; }
        if (qrLibState === 1) return; // 加载中：首个加载者的回调负责收尾
        qrLibState = 1;
        var s = document.createElement('script');
        /* 路径同样用 IIFE 顶层缓存的 SCRIPT_SRC 推断（见顶部注释） */
        s.src = SCRIPT_SRC.replace(/\/js\/share\.js(\?.*)?$/, '/js/vendor/qrcode.min.js');
        s.async = true;
        s.onload = function () {
            qrLibState = global.qrcode ? 2 : -1;
            done(qrLibState === 2);
        };
        s.onerror = function () { qrLibState = -1; done(false); };
        document.head.appendChild(s);
    }

    /** 触发二维码分享：移动端直接复制；桌面端弹二维码弹窗 */
    function triggerQr(p, ctx) {
        var fallback = function () {
            var text = (typeof p.copy === 'function') ? p.copy(ctx) : ctx.url;
            copyText(text, p.copyTip);
        };
        if (isMobileUA()) { fallback(); return; }
        ensureQrLib(function (ok) {
            if (ok) showQrDialog(p, ctx);
            else fallback();
        });
    }

    var qrDialog = null;
    /** 二维码弹窗：遮罩 + 卡片（标题 / 二维码 / 提示 / 复制链接）。
     *  点遮罩、点 ×、按 Esc 均可关闭。 */
    function showQrDialog(p, ctx) {
        if (qrDialog) return;
        var url = (typeof p.copy === 'function') ? p.copy(ctx) : ctx.url;
        var qrUrl = ctx.url || url; // 二维码内容固定为分享链接，便于扫码直达

        var backdrop = document.createElement('div');
        backdrop.className = 'flea-share-qr-backdrop';
        var dialog = document.createElement('div');
        dialog.className = 'flea-share-qr-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-label', p.label + '扫码分享');
        dialog.innerHTML =
            '<button type="button" class="flea-share-qr-close" aria-label="关闭">' + ICON_CLOSE + '</button>' +
            '<div class="flea-share-qr-title">' + p.label + '扫一扫</div>' +
            '<div class="flea-share-qr-box"><img alt="' + p.label + '二维码" /></div>' +
            '<div class="flea-share-qr-tip">扫码打开页面后，即可转发给好友或群聊</div>' +
            '<button type="button" class="flea-share-qr-copy">复制链接</button>';
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        // 渲染二维码（库加载成功才能走到这里，但仍 try 兜底）
        try {
            var qr = global.qrcode(0, 'M');
            qr.addData(qrUrl);
            qr.make();
            dialog.querySelector('.flea-share-qr-box img').src = qr.createDataURL(6, 8);
        } catch (e) {
            dialog.querySelector('.flea-share-qr-box').textContent = qrUrl;
        }

        var close = function () {
            if (!qrDialog) return;
            qrDialog = null;
            document.removeEventListener('keydown', onEsc);
            backdrop.classList.remove('is-open');
            setTimeout(function () { backdrop.remove(); }, 240);
        };
        var onEsc = function (e) {
            if (e.key === 'Escape') close();
        };
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) close();
        });
        dialog.querySelector('.flea-share-qr-close').addEventListener('click', close);
        dialog.querySelector('.flea-share-qr-copy').addEventListener('click', function () {
            copyText(url, p.copyTip || '链接已复制');
        });
        document.addEventListener('keydown', onEsc);

        qrDialog = backdrop;
        var raf = global.requestAnimationFrame || function (f) { setTimeout(f, 16); };
        raf(function () { backdrop.classList.add('is-open'); });
    }

    /** 复制到剪贴板（优先 navigator.clipboard，回退 execCommand）。
     *  @param {string} text  要复制的文本
     *  @param {string} tip   成功提示文案（平台可传 copyTip 定制，如"去微信粘贴"） */
    function copyText(text, tip) {
        text = String(text == null ? '' : text);
        tip = tip || '链接已复制';
        function fallback() {
            try {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus(); ta.select();
                var ok = document.execCommand('copy');
                document.body.removeChild(ta);
                showToast(ok ? tip : '复制失败，请手动复制', ok ? 'success' : 'error');
            } catch (e) {
                showToast('复制失败，请手动复制', 'error');
            }
        }
        if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                showToast(tip, 'success');
            }, function () { fallback(); });
        } else {
            fallback();
        }
    }

    /* ============================================================
     * 12. 轻提示（组件自带的极简 toast，不依赖 notification.js）
     * ============================================================ */
    var toastTimer = null;
    function showToast(msg, type) {
        type = type || 'info';
        var el = document.getElementById('flea-share-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'flea-share-toast';
            el.className = 'flea-share-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.className = 'flea-share-toast is-show flea-share-toast-' + type;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            el.className = 'flea-share-toast flea-share-toast-' + type;
        }, 2400);
    }

    /* ============================================================
     * 13. 公共接口 + 导出
     * ============================================================ */

    /**
     * 初始化分享（右下角悬浮按钮 + 扇形展开菜单）。
     * @param {object} [options] 覆盖 SHARE_CONFIG 中的字段：
     *   { platforms: [...], share: {url,title,text,image}, arc: {start,spread,radius} }
     */
    function init(options) {
        if (initialized) {
            console.warn('[FleaShare] 已初始化，忽略重复调用');
            return;
        }
        initialized = true;
        ensureStyleInjected();
        ensureFabStack();
        // 远程配置（config/share.json）与内置默认深合并后，再叠加页面级 options
        loadRemoteConfig(function () {
            if (options && typeof options === 'object') {
                var base = getConfig();
                var merged = global.FleaCommon && global.FleaCommon.deepMerge
                    ? global.FleaCommon.deepMerge(base, options)
                    : Object.assign({}, base, options);
                mergedConfig = merged;
            }
            buildUi();
        });
    }

    global.FleaShare = {
        init: init,
        config: SHARE_CONFIG,
        open: openMenu,
        close: closeMenu
    };
})(window);
