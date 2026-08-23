/**
 * 查看关卡页逻辑。
 * - 网格展示「默认关卡」与「我的关卡」两类简图卡片（用 map.js 渲染缩小俯视图）。
 * - 每卡片：试玩（官方关卡直接跳转 game.html?level=N，自制关卡写入 sokoban_play_target 跳转 game.html）/ 分享（生成 editor.html?import= 链接）/ [我的] 删除。
 * - 支持上传文件（JSON / 字符画）与导入分享码，保存进用户关卡（localStorage）。
 * - 默认关卡与用户关卡通过徽章 + 区段明确区分；不可解关卡打「无解」警告徽标。
 * - 兼容 URL ?import= 直接打开即导入（分享链接）。
 */
(function () {
    'use strict';

    // 返回按钮：查看关卡页由入口页进入，common.js 默认 goBack 会跳回门户首页（../），
    // 拦截后统一跳回推箱子入口页 index.html（参考五子棋 beforeBack 机制）。
    window.addEventListener('beforeBack', function (e) {
        e.detail.defaultPrevented = true;
        window.location.href = 'index.html';
    });

    var defaultWrap = document.getElementById('default-levels');
    var userWrap = document.getElementById('user-levels');
    var userSection = document.getElementById('user-section');
    var userEmpty = document.getElementById('user-empty');
    var loadingEl = document.getElementById('page-loading');
    var searchInput = document.getElementById('level-search');
    var searchEmpty = document.getElementById('search-empty');

    // ── 搜索过滤：按关卡名称实时过滤两个区段 ──
    function applySearch() {
        var q = (searchInput ? searchInput.value : '').trim().toLowerCase();
        var total = 0;
        var grids = [defaultWrap, userWrap];
        for (var g = 0; g < grids.length; g++) {
            var grid = grids[g];
            if (!grid) continue;
            var visible = 0;
            for (var i = 0; i < grid.children.length; i++) {
                var card = grid.children[i];
                var hit = !q || (card.dataset.search && card.dataset.search.indexOf(q) !== -1);
                card.style.display = hit ? '' : 'none';
                if (hit) visible++;
            }
            total += visible;
            // 搜索中：该区段无匹配则整体隐藏
            var section = grid.closest ? grid.closest('.level-section') : null;
            if (section && q) section.style.display = visible ? '' : 'none';
        }
        if (searchEmpty) searchEmpty.style.display = (q && total === 0) ? '' : 'none';
        // 清空搜索：恢复区段默认显隐（默认区段恒显；我的关卡区段恒显，空状态由提示引导）
        if (!q) {
            var dSec = (defaultWrap && defaultWrap.closest) ? defaultWrap.closest('.level-section') : null;
            if (dSec) dSec.style.display = '';
            if (userSection) userSection.style.display = '';
        }
        // 搜索态下，「导出全部」语义切换为「导出搜索结果」
        var expBtn = document.getElementById('export-all-btn');
        if (expBtn) {
            expBtn.innerHTML = q
                ? '<i class="fas fa-download"></i> 导出搜索结果'
                : '<i class="fas fa-download"></i> 导出全部';
        }
    }
    if (searchInput) {
        searchInput.addEventListener('input', applySearch);
        searchInput.addEventListener('search', applySearch);
    }

    // ── 全页加载遮罩 ──
    function showLoading() {
        if (!loadingEl) return;
        loadingEl.style.display = 'flex';
        void loadingEl.offsetWidth; // 强制回流，重启淡入
        loadingEl.classList.remove('hide');
    }
    function hideLoading() {
        if (!loadingEl) return;
        loadingEl.classList.add('hide');
        setTimeout(function () { loadingEl.style.display = 'none'; }, 320);
    }

    // 可解性标记：首屏不阻塞，等主线程空闲再补校验（默认关卡跳过，仅用户关卡）。
    // 关键：每次 BFS 给 ~80ms 时间预算，超时即放弃（不误贴「无解」标），
    // 保证主线程不被长任务冻结、返回按钮始终立即响应；深局关卡大概率本就可解，缺失徽标无碍。
    function scheduleSolvableCheck(card, level) {
        var run = function () {
            try {
                var res = SokobanSolver.isSolvable(level.map, { deadline: Date.now() + 80 });
                if (res.uncertain) return; // 超时未穷举：不误判，直接跳过
                if (!res.solvable) {
                    card.classList.add('unsolvable');
                    var warn = document.createElement('div');
                    warn.className = 'level-warn';
                    warn.textContent = '⚠ ' + (res.reason || '无解');
                    card.appendChild(warn);
                }
            } catch (e) { /* 校验异常不阻断展示 */ }
        };
        if (window.requestIdleCallback) window.requestIdleCallback(run);
        else setTimeout(run, 0);
    }

    function toast(msg) {
        var el = document.getElementById('level-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.classList.remove('show'); }, 2800);
    }

    function playLevel(level, kind, index) {
        // 官方关卡直接带 ?level=N 进入默认模式，避免被标成「自定义」；
        if (kind === 'default' && typeof index === 'number' && index >= 0) {
            window.location.href = 'game.html?from=levels&level=' + index;
            return;
        }
        // 自制关卡：把整个「我的关卡」列表连同当前关卡索引一并传入，
        // 游戏页据此加载整组自定义关卡，支持上一关/下一关连续闯关。
        try {
            var all = SokobanUserLevels.getUserLevels();
            var idx = -1;
            for (var i = 0; i < all.length; i++) {
                if (all[i].id === level.id) { idx = i; break; }
            }
            var payload;
            if (idx === -1) {
                // 列表里找不到（理论不会）：退回单关试玩，保持兼容
                payload = { name: level.name, map: level.map };
            } else {
                payload = { list: all, index: idx };
            }
            localStorage.setItem('sokoban_play_target', JSON.stringify(payload));
        } catch (e) { /* ignore */ }
        window.location.href = 'game.html?from=levels';
    }

    function copyText(text, okMsg) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { toast(okMsg); })
                .catch(function () { fallbackCopy(text, okMsg); });
        } else {
            fallbackCopy(text, okMsg);
        }
    }
    function fallbackCopy(text, okMsg) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); toast(okMsg); }
        catch (e) { toast('复制失败，链接：' + text); }
        document.body.removeChild(ta);
    }

    // ── 分享弹层：提供两种链接 ──
    // 1) 直接试玩：game.html?play=<code> —— 对方打开即开玩，不写入本地关卡
    // 2) 导入编辑：editor.html?import=<code> —— 对方打开即载入编辑器，可保存 / 试玩
    var sharePop = null;
    var sharePopInit = false;
    function ensureSharePop() {
        if (sharePop) return sharePop;
        var pop = document.createElement('div');
        pop.className = 'share-pop';
        pop.innerHTML =
            '<div class="share-card">' +
                '<div class="share-head"><span>分享关卡</span>' +
                    '<button class="share-close" aria-label="关闭">&times;</button></div>' +
                '<p class="share-tip">两种分享链接任选：对方打开即可直接试玩，或导入到他自己的关卡库。</p>' +
                '<div class="share-row">' +
                    '<span class="share-label"><i class="fas fa-play"></i>直接试玩</span>' +
                    '<input class="share-input" type="text" readonly>' +
                    '<button class="button small share-copy" data-kind="play">复制</button>' +
                '</div>' +
                '<div class="share-row">' +
                    '<span class="share-label"><i class="fas fa-file-import"></i>导入编辑</span>' +
                    '<input class="share-input" type="text" readonly>' +
                    '<button class="button small share-copy" data-kind="import">复制</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(pop);
        pop.addEventListener('click', function (e) {
            if (e.target === pop || (e.target.closest && e.target.closest('.share-close'))) closeSharePop();
        });
        sharePop = pop;
        return pop;
    }
    function closeSharePop() { if (sharePop) sharePop.classList.remove('open'); }

    function shareLevel(level) {
        var code = SokobanUserLevels.encodeLevel(level);
        var base = location.origin + location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
        var playUrl = base + 'game.html?play=' + encodeURIComponent(code);
        var importUrl = base + 'editor.html?import=' + encodeURIComponent(code);

        var pop = ensureSharePop();
        var inputs = pop.querySelectorAll('.share-input');
        inputs[0].value = playUrl;     // 直接试玩
        inputs[1].value = importUrl;   // 导入编辑

        // 复制按钮：每次分享重新绑定（onclick 覆盖，避免重复监听）
        pop.querySelectorAll('.share-copy').forEach(function (btn) {
            btn.onclick = function () {
                var url = btn.previousElementSibling.value;
                var kind = btn.getAttribute('data-kind');
                copyText(url, '已复制「' + (kind === 'play' ? '直接试玩' : '导入编辑') + '」链接');
            };
        });

        pop.classList.add('open');
        // 自动选中首行链接，方便手动复制
        if (inputs[0]) { inputs[0].focus(); inputs[0].select(); }
    }

    // 全局 Esc 关闭分享弹层（仅注册一次）
    if (!sharePopInit) {
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && sharePop && sharePop.classList.contains('open')) closeSharePop();
        });
        sharePopInit = true;
    }

    // 编辑：携带关卡编码与 id 跳转制作页，编辑后保存即覆盖原关卡
    function editLevel(level) {
        var code = SokobanUserLevels.encodeLevel(level);
        window.location.href = 'editor.html?import=' + encodeURIComponent(code) + '&edit=' + encodeURIComponent(level.id || '');
    }

    function exportLevel(level, format) {
        try {
            var r = SokobanUserLevels.downloadLevel(level, format);
            if (r && r.filename) toast('已导出「' + (level.name || '关卡') + '」为 ' + format.toUpperCase() + ' 文件');
        } catch (e) {
            toast('导出失败：' + (e && e.message ? e.message : e));
        }
    }

    // 导出菜单：记录当前打开的菜单，点击外部 / Esc 关闭
    var openExportMenus = [];
    function closeExportMenus() {
        openExportMenus.forEach(function (m) { m.classList.remove('open'); });
        openExportMenus = [];
    }
    document.addEventListener('click', function (e) {
        if (e.target && e.target.closest && !e.target.closest('.export-wrap')) closeExportMenus();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeExportMenus();
    });

    function makeCard(level, opts) {
        opts = opts || {};
        var card = document.createElement('div');
        card.className = 'level-card';
        card.dataset.search = String(level.name || '').toLowerCase();

        var map = document.createElement('div');
        map.className = 'mini-map';
        SokobanMap.renderMiniMap(map, level);

        var name = document.createElement('div');
        name.className = 'level-name';
        name.textContent = level.name || '未命名关卡';

        // 卡片级来源徽章：窄屏卡片纵向排列、区段标题滚出视野时仍能区分官方/自定义
        var isUser = opts.kind === 'user';
        var badge = document.createElement('span');
        badge.className = 'badge badge-card ' + (isUser ? 'badge-user' : 'badge-default');
        badge.textContent = isUser ? '自定义' : '官方';

        var nameRow = document.createElement('div');
        nameRow.className = 'level-name-row';
        nameRow.appendChild(name);
        nameRow.appendChild(badge);

        var actions = document.createElement('div');
        actions.className = 'level-actions';
        var secondaryActions = document.createElement('div');
        secondaryActions.className = 'secondary-actions';

        var playBtn = document.createElement('button');
        playBtn.className = 'button small btn-play';
        playBtn.innerHTML = '<i class="fas fa-play"></i>试玩';
        playBtn.addEventListener('click', function () { playLevel(level, opts.kind, opts.index); });

        var shareBtn = document.createElement('button');
        shareBtn.className = 'button small';
        shareBtn.innerHTML = '<i class="fas fa-share-alt"></i>分享';
        shareBtn.addEventListener('click', function () { shareLevel(level); });

        // 导出：单卡一个「导出」按钮 + 下拉（JSON / TXT）
        var exportWrap = document.createElement('div');
        exportWrap.className = 'export-wrap';
        var exportBtn = document.createElement('button');
        exportBtn.className = 'button small';
        exportBtn.innerHTML = '<i class="fas fa-download"></i>导出';
        var exportMenu = document.createElement('div');
        exportMenu.className = 'export-menu';
        var exportJson = document.createElement('button');
        exportJson.className = 'export-menu-item';
        exportJson.innerHTML = '<i class="fas fa-file-code"></i> JSON';
        exportJson.addEventListener('click', function (e) {
            e.stopPropagation();
            closeExportMenus();
            exportLevel(level, 'json');
        });
        var exportTxt = document.createElement('button');
        exportTxt.className = 'export-menu-item';
        exportTxt.innerHTML = '<i class="fas fa-file-alt"></i> TXT';
        exportTxt.addEventListener('click', function (e) {
            e.stopPropagation();
            closeExportMenus();
            exportLevel(level, 'txt');
        });
        exportMenu.appendChild(exportJson);
        exportMenu.appendChild(exportTxt);
        exportWrap.appendChild(exportBtn);
        exportWrap.appendChild(exportMenu);
        exportBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = exportMenu.classList.contains('open');
            closeExportMenus();
            if (!isOpen) {
                exportMenu.classList.add('open');
                openExportMenus.push(exportMenu);
            }
        });

        secondaryActions.appendChild(shareBtn);
        // 自制关卡支持「编辑」：跳转制作页重新编辑，保存后覆盖原关卡
        if (opts.kind === 'user') {
            var editBtn = document.createElement('button');
            editBtn.className = 'button small';
            editBtn.innerHTML = '<i class="fas fa-pen"></i>编辑';
            editBtn.addEventListener('click', function () { editLevel(level); });
            secondaryActions.appendChild(editBtn);
        }
        secondaryActions.appendChild(exportWrap);
        if (opts.onDelete) {
            var delBtn = document.createElement('button');
            delBtn.className = 'button small danger';
            delBtn.innerHTML = '<i class="fas fa-trash"></i>删除';
            delBtn.addEventListener('click', function () { opts.onDelete(level); });
            secondaryActions.appendChild(delBtn);
        }
        actions.appendChild(playBtn);
        actions.appendChild(secondaryActions);

        card.appendChild(map);
        card.appendChild(nameRow);
        card.appendChild(actions);
        return card;
    }

    function renderUserLevels() {
        var userLevels = SokobanUserLevels.getUserLevels();
        userWrap.innerHTML = '';
        var userActions = document.getElementById('user-actions');
        if (userActions) userActions.style.display = userLevels.length ? '' : 'none';
        if (!userLevels.length) {
            userSection.style.display = '';
            if (userEmpty) userEmpty.style.display = '';
        } else {
            userSection.style.display = '';
            if (userEmpty) userEmpty.style.display = 'none';
            userLevels.forEach(function (lv) {
                var card = makeCard(lv, {
                    kind: 'user',
                    onDelete: function () {
                        SokobanUserLevels.deleteUserLevel(lv.id);
                        toast('已删除「' + (lv.name || '未命名') + '」');
                        renderUserLevels();
                    }
                });
                userWrap.appendChild(card);
                scheduleSolvableCheck(card, lv); // 空闲补校验，不阻塞
            });
        }
        applySearch();
    }

    // 默认关卡缓存（sessionStorage）：同标签页内从游戏页返回查看关卡页时命中缓存，
    // 同步秒渲染、不再走网络 fetch + loading 等待，消除「返回卡顿」体感。
    var DEFAULT_CACHE_KEY = 'sokoban_default_levels_cache';
    function readCachedDefaults() {
        try {
            var raw = sessionStorage.getItem(DEFAULT_CACHE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    function writeCachedDefaults(levels) {
        try { sessionStorage.setItem(DEFAULT_CACHE_KEY, JSON.stringify(levels)); } catch (e) { /* 忽略 */ }
    }
    // 关卡列表签名：name + map 拼接，用于后台刷新时判断清单/配置是否变化（变化则重渲）
    function levelsSig(levels) {
        return (levels || []).map(function (lv) {
            return (lv.name || '') + '|' + (Array.isArray(lv.map) ? lv.map.join('') : '');
        }).join(';');
    }

    function paintDefaultLevels(levels) {
        // 默认关卡为官方精选、发布即保证可解，无需在查看页重复跑 BFS。
        // 实测 8 关合计约 10s，requestIdleCallback 也只能在空闲时同步执行，
        // 仍会持续占用主线程导致页面卡顿、返回按钮响应迟滞。仅用户关卡需可解性标记。
        defaultWrap.innerHTML = '';
        levels.forEach(function (lv, i) {
            defaultWrap.appendChild(makeCard(lv, { kind: 'default', index: i }));
        });
        applySearch();
    }

    function render() {
        var cached = readCachedDefaults();
        if (cached && cached.length) {
            // 命中缓存：同步秒渲染，不显示 loading（返回场景走此分支）
            paintDefaultLevels(cached);
            renderUserLevels();
            if (loadingEl) { loadingEl.classList.add('hide'); loadingEl.style.display = 'none'; }
            // 后台静默刷新缓存（config / 清单可能更新）：签名变化时重渲，
            // 保证新增/调整关卡包（如 levels-manifest.json 增删）立即可见
            SokobanLevels.load().then(function (fresh) {
                writeCachedDefaults(fresh);
                if (levelsSig(fresh) !== levelsSig(cached)) paintDefaultLevels(fresh);
            }).catch(function () { /* 忽略 */ });
            return;
        }

        // 未命中（首次 / 缓存失效）：显示 loading 并加载
        showLoading();
        SokobanLevels.load().then(function (levels) {
            writeCachedDefaults(levels);
            paintDefaultLevels(levels);
            renderUserLevels();
            hideLoading();
        }).catch(function () {
            // loadConfig 已保证不 reject，此处仅作兜底
            defaultWrap.innerHTML = '';
            hideLoading();
        });
    }

    function addUserLevelsByText(text, fallbackName) {
        var levels;
        try {
            levels = SokobanLevels.parse(text, fallbackName || '导入关卡');
        } catch (err) {
            toast('解析失败：' + (err && err.message ? err.message : err));
            return;
        }
        levels.forEach(function (lv) {
            try { SokobanUserLevels.saveUserLevel(lv); }
            catch (e) { toast('保存失败：' + (e && e.message ? e.message : e)); }
        });
        toast('已添加 ' + levels.length + ' 关到「我的关卡」');
        renderUserLevels();
    }

    // ── 上传文件 ──
    var fileInput = document.getElementById('level-file');
    document.getElementById('upload-btn').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            addUserLevelsByText(String(reader.result), file.name);
            fileInput.value = '';
        };
        reader.onerror = function () { toast('文件读取失败'); };
        reader.readAsText(file);
    });

    // ── 导入分享码 ──
    document.getElementById('import-btn').addEventListener('click', function () {
        var input = document.getElementById('import-input');
        var val = (input.value || '').trim();
        if (!val) { toast('请先粘贴分享码或链接'); return; }
        var m = val.match(/import=([^&]+)/);
        var code = m ? decodeURIComponent(m[1]) : val;
        var level = SokobanUserLevels.decodeLevel(code);
        if (!level) { toast('分享码无效'); return; }
        try {
            SokobanUserLevels.saveUserLevel(level);
            toast('已导入「' + (level.name || '分享关卡') + '」');
            renderUserLevels();
        } catch (e) { toast('导入失败：' + (e && e.message ? e.message : e)); }
        input.value = '';
    });

    // ── 启动：URL ?import= 自动导入并清理地址 ──
    var imported = SokobanUserLevels.parseImportFromUrl();
    if (imported) {
        try {
            SokobanUserLevels.saveUserLevel(imported);
            toast('已从分享链接导入「' + (imported.name || '分享关卡') + '」');
            if (history.replaceState) history.replaceState(null, '', location.pathname);
        } catch (e) { toast('导入失败：' + (e && e.message ? e.message : e)); }
    }

    // ── 批量导出：按搜索结果导出「我的关卡」中的命中关（无搜索则导出全部）──
    // 搜索态下只导出名称匹配搜索词的自定义关卡；空搜索导出全部。
    function getExportLevels() {
        var all = SokobanUserLevels.getUserLevels();
        var q = (searchInput ? searchInput.value : '').trim().toLowerCase();
        if (!q) return all;
        return all.filter(function (lv) {
            return String(lv.name || '').toLowerCase().indexOf(q) !== -1;
        });
    }

    var exportAllBtn = document.getElementById('export-all-btn');
    if (exportAllBtn) {
        exportAllBtn.addEventListener('click', function () {
            var list = getExportLevels();
            if (!list.length) { toast('没有可导出的关卡'); return; }
            var q = (searchInput ? searchInput.value : '').trim();
            try {
                var r = SokobanUserLevels.downloadAllLevels(list, 'json');
                if (r && r.filename) {
                    toast(q ? ('已导出搜索结果 ' + list.length + ' 关') : ('已导出全部 ' + list.length + ' 关为 ' + r.filename));
                }
            } catch (e) { toast('导出失败：' + (e && e.message ? e.message : e)); }
        });
    }

    render();
})();
