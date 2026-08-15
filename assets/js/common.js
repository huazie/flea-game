/**
 * 处理各种公共逻辑：
 * - 1. 主题切换点击事件
 * - 2. 返回按钮点击事件
 */
class CommonManager {
    constructor() {
        this.themeButton = document.getElementById('theme-button');
        this.backButton = document.getElementById('back-button');
        this.themeKey = 'color_scheme';
        
        this.initTheme();
        this.bindEvents();
    }
    
    /**
     * 统一写入主题：所有页面都把 data-theme 标在 <html>(documentElement)。
     * 门户 main.js 与游戏页 common.js 一致，SDK（评论）、canvas 取色等
     * 从 document.documentElement 读主题的代码都能正确拿到。
     */
    applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
    }

    initTheme() {
        // 从本地存储加载主题设置
        const savedTheme = localStorage.getItem(this.themeKey);
        const theme = (savedTheme === 'dark') ? 'dark' : 'light';
        this.applyTheme(theme);
        this.updateThemeIcon(theme === 'dark');
    }
    
    bindEvents() {
        // 主题切换按钮点击事件
        this.themeButton && this.themeButton.addEventListener('click', () => this.toggleTheme());
        
        // 返回按钮点击事件
        this.backButton && this.backButton.addEventListener('click', () => this.goBack());
    }
    
    toggleTheme() {
        // 检查当前主题是否为深色（主题统一标在 <html>）
        const currentIsDark = document.documentElement.dataset.theme === 'dark';
        // 切换到相反的主题
        const newTheme = currentIsDark ? 'light' : 'dark';
        this.applyTheme(newTheme);

        // 保存主题设置到本地存储
        localStorage.setItem(this.themeKey, newTheme);

        // 更新图标 - 传入新主题是否为深色
        this.updateThemeIcon(!currentIsDark);

        // 触发自定义事件，通知游戏画布重绘
        document.dispatchEvent(new CustomEvent('themeChanged'));
    }
    
    updateThemeIcon(isDarkTheme) {
        if (!this.themeButton) return; // 首页等无主题按钮时安全跳过
        const themeIcon = this.themeButton.querySelector('i');
        
        if (isDarkTheme) {
            themeIcon.classList.remove('fa-sun');
            themeIcon.classList.add('fa-moon');
        } else {
            themeIcon.classList.remove('fa-moon');
            themeIcon.classList.add('fa-sun');
        }
    }
    
    /**
     * 返回操作处理 - 基于事件机制
     */
    goBack() {
        // 创建并派发beforeBack事件
        const beforeEvent = new CustomEvent('beforeBack', {
            cancelable: true,
            detail: { defaultPrevented: false }
        });
        window.dispatchEvent(beforeEvent);

        // 检查是否阻止默认行为
        if (!beforeEvent.detail.defaultPrevented) {
            window.location.href = '../';
            
            // 创建并派发afterBack事件
            const afterEvent = new CustomEvent('afterBack');
            window.dispatchEvent(afterEvent);
        }
    }
}

new CommonManager();

/* =========================================================================
 * 公共工具命名空间 FleaCommon：可被任意页面/模块复用的纯函数。
 * - deepMerge(base, override)：深合并，override 逐层覆盖 base，嵌套对象递归合并。
 * - loadJson(url, opts)：带超时兜底的 JSON 拉取（Promise）。
 *   评论模块等“从 config 目录读取 JSON 覆盖默认配置”的诉求统一走这里。
 * ========================================================================= */
window.FleaCommon = (function () {
    'use strict';

    // 远程配置按 url 缓存，保证每个配置文件只拉取一次（即使多模块共用）
    var configCache = {};

    function isPlainObject(v) {
        return v && typeof v === 'object' && !Array.isArray(v);
    }

    /** 深合并：override 中的字段逐层覆盖 base，嵌套对象递归合并（不替换整块） */
    function deepMerge(base, override) {
        var out = Object.assign({}, base);
        if (!override || !isPlainObject(override)) return out;
        Object.keys(override).forEach(function (k) {
            var ov = override[k];
            if (isPlainObject(ov) && isPlainObject(out[k])) {
                out[k] = deepMerge(out[k], ov);
            } else if (ov !== undefined) {
                out[k] = ov;
            }
        });
        return out;
    }

    /**
     * 加载 JSON 配置（带超时兜底）。
     * @param {string} url 目标地址（调用方自行加时间戳防缓存）
     * @param {object} [opts] { timeout: 毫秒, cache: 'no-cache'|'default' }
     * @returns {Promise} resolve(解析后的对象 | null) / reject(Error)
     */
    function loadJson(url, opts) {
        opts = opts || {};
        var timeout = opts.timeout || 5000;
        if (typeof fetch !== 'function' || typeof Promise === 'undefined') {
            return Promise.reject(new Error('当前环境不支持 fetch'));
        }
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                reject(new Error('加载超时（' + timeout + 'ms）'));
            }, timeout);

            fetch(url, { cache: opts.cache || 'no-cache' })
                .then(function (res) {
                    if (settled) return null;
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.json();
                })
                .then(function (data) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(data);
                })
                .catch(function (e) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    reject(e);
                });
        });
    }

    /**
     * 解析“位于仓库根 config/ 目录”的配置文件绝对地址。
     * 需在同脚本同步执行期内调用（此时 document.currentScript 指向该脚本自身地址）。
     * @param {string} filename config 目录下文件名，如 'comments.json'
     * @returns {string} 绝对地址；推算失败回退 'config/<filename>'
     */
    function resolveConfigUrl(filename) {
        var src = '';
        try { src = (document.currentScript && document.currentScript.src) || ''; } catch (e) { /* ignore */ }
        if (!src) {
            // 兜底：遍历脚本列表，找 comments.js（调用方）的 src 推算
            var scripts = document.scripts || [];
            for (var i = 0; i < scripts.length; i++) {
                if (scripts[i].src && scripts[i].src.indexOf('comments.js') !== -1) {
                    src = scripts[i].src;
                    break;
                }
            }
        }
        if (src) {
            try { return new URL('../../config/' + filename, src).href; } catch (e) { /* ignore */ }
        }
        return 'config/' + filename;
    }

    /**
     * 加载远程 JSON 配置并与内置默认配置深合并（自动缓存，每个 url 仅拉取一次）。
     * @param {string} url        配置地址（建议调用方加时间戳防缓存）
     * @param {object} baseConfig 内置默认配置（合并基底，未被远程覆盖的字段保留）
     * @param {object} [opts]     { timeout: 毫秒 }
     * @returns {Promise} 始终 resolve(mergedConfig)；失败/超时也 resolve(baseConfig)，绝不 reject（保证不阻塞）
     */
    function loadConfig(url, baseConfig, opts) {
        opts = opts || {};
        if (Object.prototype.hasOwnProperty.call(configCache, url)) return configCache[url];
        var promise = loadJson(url, { timeout: opts.timeout || 5000 })
            .then(function (remote) {
                return (remote && typeof remote === 'object') ? deepMerge(baseConfig, remote) : baseConfig;
            })
            .catch(function () {
                return baseConfig; // 失败/超时：回退默认，绝不 reject
            });
        configCache[url] = promise;
        return promise;
    }

    return {
        isPlainObject: isPlainObject,
        deepMerge: deepMerge,
        loadJson: loadJson,
        resolveConfigUrl: resolveConfigUrl,
        loadConfig: loadConfig
    };
})();