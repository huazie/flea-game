/**
 * 推箱子关卡数据（UMD：浏览器挂 window.SOKOBAN_LEVELS / window.SokobanLevels，Node 下可 require）。
 *
 * 关卡地图字符约定：
 *   #  墙
 *   (空格) 地板
 *   .  目标点
 *   $  箱子
 *   *  箱子已在目标点上
 *   @  玩家
 *   +  玩家站在目标点上
 *
 * 配置化：
 * - 内置 DEFAULT_LEVELS 为默认棋谱（fallback）。
 * - 浏览器环境下优先用 sokoban/config/sokoban-levels.json 的 levels「逐关覆盖」内置：
 *   config 的第 i 关替换内置第 i 关，config 多出的关卡作为追加关卡；未列出的保留内置。
 * - 加载逻辑复用公共 FleaCommon.loadConfig（带缓存 + 超时兜底，绝不 reject）。
 * - 同步期预解析配置地址（此时 document.currentScript 指向本脚本），避免时序问题。
 *
 * 上传试玩：
 * - SokobanLevels.parse(text, fallbackName) 自动识别：
 *   · JSON 单关 {name,map} / 多关 [..] / {levels:[..]}
 *   · 纯文本字符画（#@$.*+ 与空格，按行解析）
 *   输出经校验、行对齐的标准关卡数组，供游戏本地试玩。
 */
(function (global) {
    'use strict';

    // 内置默认棋谱（fallback）
    var DEFAULT_LEVELS = [
        {
            name: '热身转弯',
            map: [
                '#######',
                '#     #',
                '#  .  #',
                '# $@  #',
                '#     #',
                '#######'
            ]
        },
        {
            name: '双拐',
            map: [
                '#######',
                '#@    #',
                '# $   #',
                '#     #',
                '#   . #',
                '#######'
            ]
        },
        {
            name: '双子归位',
            map: [
                '#######',
                '#.   .#',
                '# $ $ #',
                '#  @  #',
                '#######'
            ]
        },
        {
            name: '三连推',
            map: [
                '#########',
                '#       #',
                '# $ $ $ #',
                '#   @   #',
                '#. . .  #',
                '#       #',
                '#########'
            ]
        },
        {
            name: '回形走廊',
            map: [
                '###########',
                '#@ $ . $ .#',
                '#         #',
                '###########'
            ]
        },
        {
            name: '四角归仓',
            map: [
                '########',
                '#.    .#',
                '#      #',
                '# $  $ #',
                '#  @   #',
                '# $  $ #',
                '#.    .#',
                '########'
            ]
        },
        {
            name: '隔墙三推',
            map: [
                '#########',
                '#@      #',
                '# $#$#$ #',
                '#       #',
                '# . . . #',
                '#       #',
                '#########'
            ]
        },
        {
            name: '四子错位',
            map: [
                '#########',
                '#. . . .#',
                '#       #',
                '# $$$$  #',
                '#   @   #',
                '#       #',
                '#########'
            ]
        },
        {
            name: '五连推',
            map: [
                '#######################',
                '#@ $ . $ . $ . $ . $ .#',
                '#                     #',
                '#######################'
            ]
        },
        {
            name: '六子连珠',
            map: [
                '#####################',
                '#@ $.$ .$ .$ .$ .$ .#',
                '#                     #',
                '#####################'
            ]
        }
    ];

    // 合法地图字符（用于上传解析时的容错过滤）
    var VALID_CHARS = { '#': 1, '.': 1, '$': 1, '*': 1, '@': 1, '+': 1, ' ': 1 };

    /**
     * 逐关合并：override 的第 i 关覆盖 base（内置）的第 i 关；
     * 仅当 i 在内置范围内且 override 项含合法 map 时覆盖，超出内置范围的项忽略
     * （新增关卡请走“上传试玩”，不依赖 config 追加）。
     */
    function mergeLevels(base, override) {
        var out = base.slice();
        if (Array.isArray(override)) {
            override.forEach(function (lv, i) {
                if (i < out.length && lv && Array.isArray(lv.map) && lv.map.length) out[i] = lv;
            });
        }
        return out;
    }

    /**
     * 规范化单个关卡：校验并过滤非法字符，所有行补齐到等长（右侧补空格）。
     * @throws {Error} 缺少有效 map 时抛错
     */
    function normalizeLevel(raw, fallbackName) {
        if (!raw || !Array.isArray(raw.map) || !raw.map.length) {
            throw new Error('关卡缺少有效的 map（字符串数组）');
        }
        var rows = raw.map.map(function (r) { return String(r); });
        var maxLen = 0;
        rows.forEach(function (r) { if (r.length > maxLen) maxLen = r.length; });
        var cleaned = rows.map(function (r) {
            var s = '';
            for (var i = 0; i < maxLen; i++) {
                var ch = r[i] || ' ';
                s += VALID_CHARS[ch] ? ch : ' '; // 非法字符当空格（地板）容错
            }
            return s;
        });
        return {
            name: (raw.name || fallbackName || '未命名关卡').toString(),
            map: cleaned
        };
    }

    /**
     * 解析用户输入（自动识别 JSON / 纯文本字符画）。
     * @param {string} text 文件全文
     * @param {string} [fallbackName] 缺省关卡名（如文件名）
     * @returns {Array} 标准关卡数组
     * @throws {Error} 解析失败时抛错
     */
    function parseLevelInput(text, fallbackName) {
        if (typeof text !== 'string') throw new Error('输入为空');
        var trimmed = text.trim();
        if (!trimmed) throw new Error('输入为空');

        var first = trimmed.charAt(0);
        if (first === '{' || first === '[') {
            var json;
            try { json = JSON.parse(trimmed); } catch (e) { throw new Error('JSON 解析失败：' + e.message); }
            var arr;
            if (Array.isArray(json)) arr = json;
            else if (Array.isArray(json.levels)) arr = json.levels;
            else if (json.map) arr = [json];
            else throw new Error('JSON 需为关卡数组、含 levels 数组、或含 map 的单关对象');
            if (!arr.length) throw new Error('未解析到任何关卡');
            return arr.map(function (lv, i) {
                return normalizeLevel(lv, (fallbackName || '关卡') + ' ' + (i + 1));
            });
        }

        // 纯文本字符画：按行解析（制表符归一为空格）
        var lines = trimmed.split(/\r?\n/).map(function (l) { return l.replace(/\t/g, ' '); });
        if (!lines.length) throw new Error('未解析到任何关卡');
        return [normalizeLevel({ map: lines }, fallbackName || '自定义关卡')];
    }

    // 同步期预解析配置地址（currentScript 指向本脚本自身）。
    // levels.js 位于 sokoban/js/，其同级 config 在 sokoban/config/，故用 ../config/ 推算，
    // 得到绝对地址（如 http://host/sokoban/config/...），不受页面路径影响。
    var CONFIG_DIR;
    if (typeof window !== 'undefined' && window.document && window.document.currentScript && window.document.currentScript.src) {
        try {
            CONFIG_DIR = new URL('../config/', window.document.currentScript.src).href;
        } catch (e) {
            CONFIG_DIR = 'config/';
        }
    } else {
        CONFIG_DIR = 'config/';
    }
    var CONFIG_URL = CONFIG_DIR + 'sokoban-levels.json';

    /**
     * 从远程地址拉取文本（带超时与 404 容错）。
     * - file:// 或老旧环境无 fetch 时 reject，由调用方回退。
     * - 非 2xx 视为失败（reject），便于上层跳过该包。
     * @returns {Promise<string>}
     */
    function fetchText(url, timeout) {
        timeout = timeout || 5000;
        if (typeof window === 'undefined' || !window.fetch) {
            return Promise.reject(new Error('no fetch'));
        }
        var doFetch = function () { return window.fetch(url); };
        if (typeof AbortController === 'undefined') {
            return doFetch().then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            });
        }
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, timeout);
        return doFetch().then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.text();
        }).finally(function () { clearTimeout(timer); });
    }

    /**
     * 加载单个关卡包（json / txt 均可），解析失败返回空数组（不阻断整体）。
     * @returns {Promise<Array>}
     */
    function loadPack(url, fallbackName) {
        return fetchText(url, 5000)
            .then(function (text) {
                try { return parseLevelInput(text, fallbackName); }
                catch (e) { return []; }
            })
            .catch(function () { return []; });
    }

    /** 无清单时的回退：沿用旧 mergeLevels 语义加载单个 sokoban-levels.json，失败回退内置 */
    function fallbackToSingleOrBuiltin() {
        return fetchText(CONFIG_URL, 5000)
            .then(function (text) {
                var cfg = JSON.parse(text);
                return mergeLevels(DEFAULT_LEVELS, (cfg && cfg.levels) || []);
            })
            .catch(function () { return DEFAULT_LEVELS; });
    }

    /**
     * 加载棋谱：以 sokoban/config/levels-manifest.json 的 packs 列表为准，
     * 逐个 fetch + 解析（json / txt 均可）后按序拼接；清单缺失 / 全失败则回退内置默认。
     * 内置 DEFAULT_LEVELS 仅作为离线 / 配置全失效的兜底，有包时不前置，避免与 sokoban-levels.json 重复。
     * 始终 resolve(数组)，绝不 reject，保证游戏一定能拿到关卡数据。
     * @returns {Promise<Array>}
     */
    function loadLevels() {
        return fetchText(CONFIG_DIR + 'levels-manifest.json', 5000)
            .then(function (text) {
                try { return JSON.parse(text); } catch (e) { return null; }
            })
            .catch(function () { return null; })
            .then(function (manifest) {
                var packs = (manifest && Array.isArray(manifest.packs)) ? manifest.packs : null;
                if (!packs) return fallbackToSingleOrBuiltin();
                return Promise.all(packs.map(function (p) {
                    var name = String(p).replace(/\.[^.]+$/, '');
                    return loadPack(CONFIG_DIR + p, name);
                })).then(function (groups) {
                    var all = [];
                    groups.forEach(function (g) { if (Array.isArray(g)) all = all.concat(g); });
                    return all.length ? all : fallbackToSingleOrBuiltin();
                });
            });
    }

    if (typeof module !== 'undefined' && module.exports) {
        // Node：主导出为数组（兼容既有 require('./levels.js') 的 BFS 校验脚本）
        module.exports = DEFAULT_LEVELS;
        module.exports.DEFAULT_LEVELS = DEFAULT_LEVELS;
        module.exports.loadLevels = loadLevels;
        module.exports.parseLevelInput = parseLevelInput;
        module.exports.mergeLevels = mergeLevels;
    } else {
        global.SOKOBAN_LEVELS = DEFAULT_LEVELS;            // 向后兼容（同步快照）
        global.SokobanLevels = {
            default: DEFAULT_LEVELS,
            load: loadLevels,
            parse: parseLevelInput
        };
    }
})(typeof window !== 'undefined' ? window : this);
