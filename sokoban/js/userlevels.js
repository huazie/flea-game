/**
 * 用户自定义关卡：本地存储（增删查）+ 分享编解码。
 * - localStorage 持久化（key 'sokoban_userlevels'，数组 {id,name,map,createdAt}）。
 * - 分享：把关卡编码为 base64 短串，配合 editor.html?import=<code> 链接传播；
 *   接收方打开链接即自动导入编辑器，可试玩 / 保存。
 * - 浏览器挂 window.SokobanUserLevels，Node 下可 require 单测（localStorage 缺失时内存兜底）。
 */
(function (global) {
    'use strict';

    var STORE_KEY = 'sokoban_userlevels';

    // ── 存储兜底（Node 单测 / 隐私模式无 localStorage 时）──
    var _mem = null;
    function memStore() {
        if (_mem) return _mem;
        var map = {};
        _mem = {
            getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
            setItem: function (k, v) { map[k] = String(v); },
            removeItem: function (k) { delete map[k]; }
        };
        return _mem;
    }
    function store() {
        try {
            if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
        } catch (e) { /* ignore */ }
        return memStore();
    }

    // ── base64（兼容 Unicode 名称）──
    function b64encode(str) {
        if (typeof btoa !== 'undefined') return btoa(unescape(encodeURIComponent(str)));
        return Buffer.from(str, 'utf-8').toString('base64'); // Node
    }
    function b64decode(b64) {
        if (typeof atob !== 'undefined') return decodeURIComponent(escape(atob(b64)));
        return Buffer.from(b64, 'base64').toString('utf-8'); // Node
    }

    // ── 关卡基础校验 ──
    /** 校验关卡结构是否起码合法（含玩家/箱子/目标） */
    function validateLevel(level) {
        if (!level || !Array.isArray(level.map) || level.map.length === 0) {
            return { ok: false, reason: '关卡地图为空' };
        }
        var cols = level.map[0].length;
        for (var r = 0; r < level.map.length; r++) {
            if (typeof level.map[r] !== 'string' || level.map[r].length !== cols) {
                return { ok: false, reason: '关卡地图各行长度不一致' };
            }
        }
        var s = level.map.join('');
        // 玩家必须存在且全局唯一（求解器只识别最后一个玩家，多玩家会导致校验与实际不符）
        var players = s.match(/[@+]/g);
        if (!players) return { ok: false, reason: '缺少玩家（@）' };
        if (players.length > 1) return { ok: false, reason: '玩家只能有一个（当前 ' + players.length + ' 个）' };
        if (s.indexOf('$') === -1 && s.indexOf('*') === -1) return { ok: false, reason: '没有箱子' };
        if (s.indexOf('.') === -1 && s.indexOf('*') === -1 && s.indexOf('+') === -1) {
            return { ok: false, reason: '没有目标点（.）' };
        }
        return { ok: true };
    }

    // ── 用户关卡 CRUD ──
    function getUserLevels() {
        try {
            var raw = store().getItem(STORE_KEY);
            if (!raw) return [];
            var arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }

    function _persist(list) {
        store().setItem(STORE_KEY, JSON.stringify(list));
    }

    /** 保存一个用户关卡（自动补充 id / createdAt），返回保存后的对象 */
    function saveUserLevel(level) {
        var v = validateLevel(level);
        if (!v.ok) throw new Error('关卡无效：' + v.reason);
        var list = getUserLevels();
        var item = {
            id: 'ul_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name: (level.name || '自定义关卡').toString(),
            map: level.map.slice(),
            createdAt: Date.now()
        };
        list.push(item);
        _persist(list);
        return item;
    }

    function deleteUserLevel(id) {
        var list = getUserLevels().filter(function (it) { return it.id !== id; });
        _persist(list);
        return list;
    }

    /** 按 id 更新关卡名称与地图；id 不存在时按新增处理。返回更新后的对象 */
    function updateUserLevel(id, level) {
        var v = validateLevel(level);
        if (!v.ok) throw new Error('关卡无效：' + v.reason);
        var list = getUserLevels();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) {
                list[i].name = (level.name || '自定义关卡').toString();
                list[i].map = level.map.slice();
                _persist(list);
                return list[i];
            }
        }
        return saveUserLevel(level);
    }

    // ── 分享编解码 ──
    /** 把关卡编码为可分享短串 */
    function encodeLevel(level) {
        var payload = JSON.stringify({ n: level.name || '自定义关卡', m: level.map });
        return b64encode(payload);
    }

    /** 解码分享串为关卡对象 {name, map}，失败返回 null */
    function decodeLevel(code) {
        try {
            var json = b64decode(String(code).trim());
            var obj = JSON.parse(json);
            if (!obj || !Array.isArray(obj.m)) return null;
            return { name: obj.n || '分享关卡', map: obj.m };
        } catch (e) { return null; }
    }

    /** 构建分享链接（指向制作页导入），可由调用方拼 base */
    function buildShareUrl(level, base) {
        return (base || 'editor.html') + '?import=' + encodeURIComponent(encodeLevel(level));
    }

    /** 从 location.search 解析 import 参数（需浏览器），无则返回 null */
    function parseImportFromUrl(search) {
        if (typeof search !== 'string') {
            try { search = (typeof location !== 'undefined' && location.search) || ''; } catch (e) { search = ''; }
        }
        // location.search 以 '?' 开头，故前缀需兼容 '?' / '&' / 串首（直接传裸参数时）
        var m = search && search.match(/(?:^|[?&])import=([^&]+)/);
        if (!m) return null;
        try { return decodeLevel(decodeURIComponent(m[1])); } catch (e) { return null; }
    }

    // ── 导出（JSON / TXT）──
    /**
     * 构建关卡导出文本内容。
     * @param {object} level {name, map}
     * @param {string} format 'json' | 'txt'
     * @returns {string} JSON 为美化后的 {name,map}；TXT 为纯字符画（通用推箱子文本格式，可被上传/导入直接复用）
     */
    function buildExportContent(level, format) {
        var name = level && level.name ? level.name : 'sokoban-level';
        if (format === 'json') {
            return JSON.stringify({ name: name, map: level.map }, null, 2);
        }
        // txt：纯字符画（#@$.*+ 与空格，按行），可直接被 SokobanLevels.parse 解析复用
        return (level.map || []).join('\n');
    }

    /**
     * 导出关卡为文件并触发浏览器下载（Blob + URL.createObjectURL + <a download>）。
     * 浏览器环境可用；非浏览器（如 Node 单测）需先桩 Blob/URL/document。
     * @returns {object|null} { filename, content }，失败返回 null
     */
    function downloadLevel(level, format) {
        if (!level || !Array.isArray(level.map)) return null;
        var content = buildExportContent(level, format);
        var safeName = (level.name || 'sokoban-level').toString()
            .replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'sokoban-level';
        var ext = format === 'json' ? 'json' : 'txt';
        var mime = format === 'json' ? 'application/json' : 'text/plain';
        var blob = new Blob([content], { type: mime + ';charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = safeName + '.' + ext;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        return { filename: safeName + '.' + ext, content: content };
    }

    var api = {
        validateLevel: validateLevel,
        getUserLevels: getUserLevels,
        saveUserLevel: saveUserLevel,
        updateUserLevel: updateUserLevel,
        deleteUserLevel: deleteUserLevel,
        encodeLevel: encodeLevel,
        decodeLevel: decodeLevel,
        buildShareUrl: buildShareUrl,
        parseImportFromUrl: parseImportFromUrl,
        buildExportContent: buildExportContent,
        downloadLevel: downloadLevel
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.SokobanUserLevels = api;
    }
})(typeof window !== 'undefined' ? window : this);
