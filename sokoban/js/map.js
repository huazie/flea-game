/**
 * 推箱子共享简图（缩小俯视图）渲染。
 * - renderMiniMap(container, level)：把关卡 map 渲染为缩小网格，
 *   复用与游戏页一致的 CSS 类（cell/floor/wall/target/entity/box/player/target-mark），
 *   故明暗主题自动适配（无需 JS 处理重绘）。
 * - 被「查看关卡页」「制作关卡页实时预览」复用，替代原 game.js 内的 _showMap。
 * - 浏览器挂 window.SokobanMap，Node 下可 require（parseForRender 可用于单测）。
 */
(function (global) {
    'use strict';

    /** 解析地图为渲染数据：grid(每格类型) / boxes / player */
    function parseForRender(map) {
        const rows = map.length;
        const cols = map[0].length;
        const grid = [];      // 'wall' | 'floor' | 'target'
        const boxes = [];
        let player = null;
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) {
                const ch = map[r][c];
                let type = 'floor';
                if (ch === '#') type = 'wall';
                else if (ch === '.' || ch === '*' || ch === '+') type = 'target';
                row.push(type);
                if (ch === '$' || ch === '*') boxes.push(r + ',' + c);
                if (ch === '@' || ch === '+') player = { r, c };
            }
            grid.push(row);
        }
        return { rows, cols, grid, boxes, player };
    }

    /**
     * 把关卡 map 渲染为缩小俯视图（DOM 网格），写入 container。
     * @param {HTMLElement} container 目标容器（会清空并写入网格，需由 CSS 提供 display:grid 等外观）
     * @param {Object} level { name, map: string[] }
     */
    function renderMiniMap(container, level) {
        if (!container || !level || !Array.isArray(level.map) || !level.map.length) return;
        const data = parseForRender(level.map);
        const frag = document.createDocumentFragment();
        const boxSet = new Set(data.boxes);
        const playerKey = data.player ? (data.player.r + ',' + data.player.c) : null;

        for (let r = 0; r < data.rows; r++) {
            for (let c = 0; c < data.cols; c++) {
                const cell = document.createElement('div');
                const type = data.grid[r][c];
                cell.className = 'cell ' + (type === 'wall' ? 'wall' : (type === 'target' ? 'target' : 'floor'));
                const key = r + ',' + c;
                const isTarget = type === 'target';
                if (key === playerKey) {
                    const p = document.createElement('div');
                    p.className = 'entity player';
                    cell.appendChild(p);
                } else if (boxSet.has(key)) {
                    const b = document.createElement('div');
                    b.className = 'entity box' + (isTarget ? ' on-target' : '');
                    cell.appendChild(b);
                } else if (isTarget) {
                    const t = document.createElement('div');
                    t.className = 'entity target-mark';
                    cell.appendChild(t);
                }
                frag.appendChild(cell);
            }
        }
        // 列宽用 minmax(12px, 1fr)：小关卡 1fr 撑满卡片；大关卡（列多）被 12px 下限兜住，
        // 不再等比缩到几像素看不清，多余部分由 .mini-map 的 overflow 滚动查看。
        container.style.gridTemplateColumns = 'repeat(' + data.cols + ', minmax(12px, 1fr))';
        container.innerHTML = '';
        container.appendChild(frag);
        container.dataset.rows = data.rows;
        container.dataset.cols = data.cols;
    }

    const api = { renderMiniMap: renderMiniMap, parseForRender: parseForRender };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.SokobanMap = api;
    }
})(typeof window !== 'undefined' ? window : this);
