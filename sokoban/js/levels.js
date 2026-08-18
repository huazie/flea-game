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
            name: '初识推箱',
            map: [
                '#######',
                '#     #',
                '# @$. #',
                '#     #',
                '#######'
            ]
        },
        {
            name: '转角',
            map: [
                '#######',
                '#.    #',
                '#     #',
                '#  $  #',
                '#  @  #',
                '#######'
            ]
        },
        {
            name: '双子',
            map: [
                '########',
                '#      #',
                '#.$  $.#',
                '#      #',
                '#  @   #',
                '#      #',
                '########'
            ]
        },
        {
            name: '一字排开',
            map: [
                '###########',
                '#         #',
                '#@$ $ $ $ #',
                '#. . . .  #',
                '#         #',
                '###########'
            ]
        },
        {
            name: '回廊',
            map: [
                '########',
                '#      #',
                '# .$ $ #',
                '#      #',
                '#  @.  #',
                '#      #',
                '########'
            ]
        },
        {
            name: '四角',
            map: [
                '#######',
                '#.   .#',
                '# $ $ #',
                '#  @  #',
                '# $ $ #',
                '#.   .#',
                '#######'
            ]
        },
        {
            name: '交错',
            map: [
                '########',
                '#.    .#',
                '# $  $ #',
                '#   @  #',
                '# $  $ #',
                '#.    .#',
                '########'
            ]
        },
        {
            name: '收纳',
            map: [
                '#########',
                '#@      #',
                '# $$$$  #',
                '#       #',
                '# ....  #',
                '#########'
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
    // 得到绝对地址（如 http://host/sokoban/config/sokoban-levels.json），不受页面路径影响。
    var CONFIG_URL;
    if (typeof window !== 'undefined' && window.document && window.document.currentScript && window.document.currentScript.src) {
        try {
            CONFIG_URL = new URL('../config/sokoban-levels.json', window.document.currentScript.src).href;
        } catch (e) {
            CONFIG_URL = 'config/sokoban-levels.json';
        }
    } else {
        CONFIG_URL = 'config/sokoban-levels.json';
    }

    /**
     * 加载棋谱：合并内置默认与 sokoban/config/sokoban-levels.json（逐关覆盖 + 追加）。
     * 始终 resolve(数组)，绝不 reject，保证游戏一定能拿到关卡数据。
     * @returns {Promise<Array>}
     */
    function loadLevels() {
        if (typeof window !== 'undefined' && window.FleaCommon && window.FleaCommon.loadConfig) {
            // base 传空 levels，使 loadConfig 的数组覆盖语义只取出远端 levels
            return window.FleaCommon.loadConfig(CONFIG_URL, { levels: [] }, { timeout: 5000 })
                .then(function (cfg) {
                    return mergeLevels(DEFAULT_LEVELS, (cfg && cfg.levels) || []);
                });
        }
        return Promise.resolve(DEFAULT_LEVELS);
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
