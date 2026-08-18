/**
 * 制作关卡页逻辑。
 * - 工具盘选择元素（墙/地板/目标/箱子/玩家/橡皮），在画布上「按住拖动」连续绘制
 *   （Pointer Events 统一鼠标与触摸，手机端手指拖动同样支持）。
 * - 玩家全局唯一：放置新玩家会自动清除旧玩家（只能有一个）。
 * - 右侧实时简图预览（map.js）。
 * - 「验证可解」用 SokobanSolver.isSolvable 做 BFS 校验；保存 / 试玩均要求关卡可解，避免死局。
 * - 支持从分享链接 ?import= 直接载入编辑；保存进用户关卡（localStorage）。
 */
(function () {
    'use strict';

    // 返回按钮：制作关卡页由入口页进入（或分享链接直接打开），common.js 默认 goBack
    // 会跳回门户首页（../），拦截后统一跳回推箱子入口页 index.html（参考五子棋 beforeBack 机制）。
    window.addEventListener('beforeBack', function (e) {
        e.detail.defaultPrevented = true;
        window.location.href = 'index.html';
    });

    var rows = 10, cols = 10;
    var grid = [];            // 二维字符数组
    var currentTool = 'wall';
    var isDrawing = false;
    var playerPos = null;     // {r,c} 当前玩家位置（保证唯一）

    var boardEl = document.getElementById('board');
    var previewEl = document.getElementById('preview');
    var nameInput = document.getElementById('level-name-input');
    var resultEl = document.getElementById('validate-result');
    var rowsInput = document.getElementById('rows-input');
    var colsInput = document.getElementById('cols-input');

    function toast(msg) {
        var el = document.getElementById('level-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.classList.remove('show'); }, 2800);
    }

    function isTargetChar(ch) {
        return ch === '.' || ch === '*' || ch === '+';
    }

    function isPlayerChar(ch) {
        return ch === '@' || ch === '+';
    }

    function charToCellClass(ch) {
        if (ch === '#') return 'wall';
        if (isTargetChar(ch)) return 'target';
        return 'floor';
    }

    /**
     * 按当前工具计算落笔后的字符。
     * 支持目标点叠加：目标格上放箱子得 '*'、放玩家得 '+'；在箱子/玩家上点目标同样叠加，
     * 避免用户拖拽时把已画好的目标点覆盖丢失。
     */
    function charForTool(tool, prev) {
        switch (tool) {
            case 'wall': return '#';
            case 'floor':
            case 'erase': return ' ';   // 清为地板（该格目标点一并清除）
            case 'target':
                if (prev === '$' || prev === '*') return '*';
                if (isPlayerChar(prev)) return '+';
                return '.';
            case 'box': return isTargetChar(prev) ? '*' : '$';
            case 'player': return isTargetChar(prev) ? '+' : '@';
            default: return ' ';
        }
    }

    function emptyRoom(R, C) {
        var g = [];
        for (var r = 0; r < R; r++) {
            var row = [];
            for (var c = 0; c < C; c++) {
                row.push((r === 0 || c === 0 || r === R - 1 || c === C - 1) ? '#' : ' ');
            }
            g.push(row);
        }
        return g;
    }

    function setSize(R, C) {
        rows = R; cols = C;
        grid = emptyRoom(R, C);
        grid[1][1] = '@';
        playerPos = { r: 1, c: 1 };
        renderBoard();
        updatePreview();
    }

    function renderBoard() {
        boardEl.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
        boardEl.innerHTML = '';
        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
                var cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.r = r;
                cell.dataset.c = c;
                boardEl.appendChild(cell);
                updateCellEl(r, c, cell);
            }
        }
    }

    function updateCellEl(r, c, cell) {
        cell = cell || boardEl.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
        if (!cell) return;
        var ch = grid[r][c];
        cell.className = 'cell ' + charToCellClass(ch);
        cell.innerHTML = '';
        var isTarget = isTargetChar(ch);
        if (isPlayerChar(ch)) {
            var p = document.createElement('div'); p.className = 'entity player'; cell.appendChild(p);
        } else if (ch === '$' || ch === '*') {
            var b = document.createElement('div'); b.className = 'entity box' + (isTarget ? ' on-target' : ''); cell.appendChild(b);
        } else if (isTarget) {
            var t = document.createElement('div'); t.className = 'entity target-mark'; cell.appendChild(t);
        }
    }

    function updatePreview() {
        var map = [];
        for (var r = 0; r < rows; r++) map.push(grid[r].join(''));
        SokobanMap.renderMiniMap(previewEl, { name: nameInput.value || '预览', map: map });
    }

    /** 用指定工具在 (r,c) 落笔 */
    function setCell(r, c, tool) {
        if (r < 0 || c < 0 || r >= rows || c >= cols) return;
        var prev = grid[r][c];
        var ch = charForTool(tool, prev);
        if (ch === prev) return;

        // 本格原是玩家、落笔后不再是玩家 → 玩家位置失效
        if (isPlayerChar(prev) && !isPlayerChar(ch)) playerPos = null;

        // 玩家全局唯一：放置新玩家时清掉旧玩家（旧玩家若站在目标点上则退回目标点）
        if (isPlayerChar(ch)) {
            if (playerPos && (playerPos.r !== r || playerPos.c !== c)) {
                var old = grid[playerPos.r][playerPos.c];
                grid[playerPos.r][playerPos.c] = (old === '+') ? '.' : ' ';
                updateCellEl(playerPos.r, playerPos.c);
            }
            playerPos = { r: r, c: c };
        }
        grid[r][c] = ch;
        updateCellEl(r, c);
    }

    /** 从当前 grid 重新定位玩家（兼容 '@' 与 '+'） */
    function syncPlayerPos() {
        playerPos = null;
        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
                if (isPlayerChar(grid[r][c])) playerPos = { r: r, c: c };
            }
        }
    }

    /** 载入一张地图到画布（示例 / 分享导入共用） */
    function loadGrid(mapArr, name) {
        rows = mapArr.length;
        cols = mapArr[0].length;
        rowsInput.value = rows;
        colsInput.value = cols;
        grid = mapArr.map(function (row) { return row.split(''); });
        syncPlayerPos();
        if (typeof name === 'string') nameInput.value = name;
        renderBoard();
        updatePreview();
    }

    function getCellFromPoint(x, y) {
        var el = document.elementFromPoint(x, y);
        return el ? el.closest('.cell') : null;
    }

    function drawAt(x, y) {
        var cell = getCellFromPoint(x, y);
        if (!cell) return;
        var r = +cell.dataset.r, c = +cell.dataset.c;
        setCell(r, c, currentTool);
        updatePreview();
    }

    // ── 绘制交互（Pointer Events 覆盖鼠标 + 触摸）──
    boardEl.addEventListener('pointerdown', function (e) {
        isDrawing = true;
        drawAt(e.clientX, e.clientY);
        e.preventDefault();
    });
    document.addEventListener('pointermove', function (e) {
        if (isDrawing) drawAt(e.clientX, e.clientY);
    });
    document.addEventListener('pointerup', function () { isDrawing = false; });
    document.addEventListener('pointercancel', function () { isDrawing = false; });

    // ── 工具选择 ──
    var tools = document.querySelectorAll('.tool');
    tools.forEach(function (btn) {
        btn.addEventListener('click', function () {
            currentTool = btn.dataset.tool;
            tools.forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
        });
    });

    // ── 尺寸 / 辅助 ──
    document.getElementById('apply-size').addEventListener('click', function () {
        var R = Math.max(3, Math.min(20, parseInt(rowsInput.value, 10) || 10));
        var C = Math.max(3, Math.min(20, parseInt(colsInput.value, 10) || 10));
        rowsInput.value = R; colsInput.value = C;
        setSize(R, C);
    });
    document.getElementById('clear-btn').addEventListener('click', function () { setSize(rows, cols); });
    document.getElementById('sample-btn').addEventListener('click', function () { loadSample(); });

    // 示例关卡：2 箱 2 目标，已 BFS 验证可解，供用户参照上手
    var SAMPLE_MAP = [
        '########',
        '#      #',
        '#  $.  #',
        '#  @   #',
        '#  $.  #',
        '#      #',
        '########'
    ];

    function loadSample() {
        loadGrid(SAMPLE_MAP);
    }

    function currentMap() {
        var map = [];
        for (var r = 0; r < rows; r++) map.push(grid[r].join(''));
        return map;
    }

    // ── 校验 / 保存 / 试玩 ──
    function validate() {
        var map = currentMap();
        var v = SokobanUserLevels.validateLevel({ name: nameInput.value || '关卡', map: map });
        if (!v.ok) {
            resultEl.className = 'validate-result fail';
            resultEl.textContent = '✗ ' + v.reason;
            return null;
        }
        var res = SokobanSolver.isSolvable(map);
        if (res.solvable) {
            resultEl.className = 'validate-result ok';
            resultEl.textContent = '✓ 可解' + (res.uncertain ? '（规模过大，未完全穷举）' : '');
            return { name: nameInput.value || '我的关卡', map: map };
        }
        resultEl.className = 'validate-result fail';
        resultEl.textContent = '✗ 不可解：' + res.reason;
        return null;
    }

    document.getElementById('validate-btn').addEventListener('click', function () { validate(); });

    document.getElementById('save-btn').addEventListener('click', function () {
        var lvl = validate();
        if (!lvl) return;
        try {
            SokobanUserLevels.saveUserLevel(lvl);
            toast('已保存到「我的关卡」');
        } catch (e) {
            toast('保存失败：' + (e && e.message ? e.message : e));
        }
    });

    document.getElementById('play-btn').addEventListener('click', function () {
        var lvl = validate();
        if (!lvl) return;
        try { localStorage.setItem('sokoban_play_target', JSON.stringify(lvl)); } catch (e) { /* ignore */ }
        window.location.href = 'game.html?from=editor';
    });

    // ── 启动：分享链接 ?import= 直接载入编辑 ──
    var imported = SokobanUserLevels.parseImportFromUrl();
    if (imported && Array.isArray(imported.map) && imported.map.length) {
        loadGrid(imported.map, imported.name || '导入关卡');
        toast('已导入分享关卡，可编辑后保存');
        if (history.replaceState) history.replaceState(null, '', location.pathname);
    } else {
        setSize(10, 10);
    }
})();
