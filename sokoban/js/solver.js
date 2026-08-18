/**
 * 推箱子可解性求解器。
 * - 采用「按推动（push-based）」的 BFS：每个状态只记录「箱子位置集合 + 玩家位置」，
 *   玩家在可推箱前的纯移动用 flood-fill 一次性吸收（不再为每一步移动生成中间状态），
 *   仅当玩家能走到某箱子相邻格时可产生「推动」后继。状态数较朴素 BFS 大幅缩减。
 * - 带角落死局剪枝（完全卡死的箱子直接丢弃该状态）与状态上限兜底，防开放大关卡爆炸。
 * - 纯算法模块，不依赖 DOM，浏览器挂 window.SokobanSolver，Node 下可 require 单测。
 *
 * 关卡地图字符约定（与 levels.js 一致）：
 *   #  墙   (空格) 地板   . 目标点   $ 箱子   * 箱子在目标上   @ 玩家   + 玩家在目标上
 */
(function (global) {
    'use strict';

    /** 解析地图字符为内部网格与关键坐标 */
    function parseMap(map) {
        const rows = map.length;
        const cols = map[0].length;
        const grid = [];        // 'wall' | 'floor'
        const targets = [];
        const boxes = [];
        let player = null;
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) {
                const ch = map[r][c];
                row.push(ch === '#' ? 'wall' : 'floor');
                if (ch === '.' || ch === '*' || ch === '+') targets.push(r + ',' + c);
                if (ch === '$' || ch === '*') boxes.push(r + ',' + c);
                if (ch === '@' || ch === '+') player = { r, c };
            }
            grid.push(row);
        }
        return { rows, cols, grid, targets, boxes, player };
    }

    function isWall(grid, r, c) {
        return r < 0 || c < 0 || r >= grid.length || c >= grid[0].length || grid[r][c] === 'wall';
    }

    /** 状态键：玩家坐标 + 排序后的箱子坐标集合 */
    function stateKey(player, boxes) {
        return player.r + ',' + player.c + '|' + boxes.slice().sort().join(';');
    }

    /**
     * 角落死局检测（保守，绝不误杀可解状态）：
     * 某箱子不在目标点，且「上下都是墙/边界」且「左右都是墙/边界」→ 完全无法推动 → 死局。
     */
    function hasHardDeadlock(grid, boxes, targetSet) {
        for (let i = 0; i < boxes.length; i++) {
            if (targetSet.has(boxes[i])) continue;
            const parts = boxes[i].split(',');
            const r = +parts[0], c = +parts[1];
            const vert = isWall(grid, r - 1, c) && isWall(grid, r + 1, c);
            const horiz = isWall(grid, r, c - 1) && isWall(grid, r, c + 1);
            if (vert && horiz) return true;
        }
        return false;
    }

    /** 从玩家位置 flood-fill 所有可达地板（不含墙、不含箱子占据的格子） */
    function reachable(grid, player, boxSet) {
        const reach = new Set();
        const stack = [player.r + ',' + player.c];
        reach.add(player.r + ',' + player.c);
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        while (stack.length) {
            const k = stack.pop();
            const idx = k.indexOf(',');
            const r = +k.slice(0, idx), c = +k.slice(idx + 1);
            for (let d = 0; d < dirs.length; d++) {
                const nr = r + dirs[d][0], nc = c + dirs[d][1];
                if (isWall(grid, nr, nc)) continue;
                if (boxSet.has(nr + ',' + nc)) continue; // 不能穿过箱子
                const nk = nr + ',' + nc;
                if (reach.has(nk)) continue;
                reach.add(nk);
                stack.push(nk);
            }
        }
        return reach;
    }

    /**
     * 判断关卡是否可解。
     * @param {string[]} map 字符串数组（每行等长的字符画）
     * @param {Object} [options]
     * @param {number} [options.deadline] 时间预算（Date.now() 毫秒值）。超过即中断并返回
     *   {solvable:true, uncertain:true}，避免在页面主线程上长时间阻塞（如查看关卡页的
     *   可解性标记，超时宁可不贴标也不能冻结界面）。不传则完整穷举（如制作关卡页的「验证可解」）。
     * @returns {{solvable:boolean, reason:string, uncertain?:boolean}}
     */
    function isSolvable(map, options) {
        if (!Array.isArray(map) || map.length === 0) {
            return { solvable: false, reason: '关卡地图为空' };
        }
        const cols = map[0].length;
        for (let r = 0; r < map.length; r++) {
            if (typeof map[r] !== 'string' || map[r].length !== cols) {
                return { solvable: false, reason: '关卡地图各行长度不一致' };
            }
        }

        const p = parseMap(map);
        if (!p.player) return { solvable: false, reason: '缺少玩家（@）' };
        if (p.boxes.length === 0) return { solvable: false, reason: '没有箱子（$ 或 *）' };
        if (p.boxes.length !== p.targets.length) {
            return { solvable: false, reason: '箱子数（' + p.boxes.length + '）与目标点数（' + p.targets.length + '）不一致' };
        }

        const targetSet = new Set(p.targets);
        if (p.boxes.every(b => targetSet.has(b))) {
            return { solvable: true, reason: '初始已完成' };
        }

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const visited = new Set([stateKey(p.player, p.boxes)]);
        const queue = [{ player: p.player, boxes: p.boxes }];
        let head = 0;
        const STATE_CAP = 600000;
        const deadline = (options && options.deadline) ? options.deadline : 0;
        let iter = 0;

        while (head < queue.length) {
            if (deadline) {
                iter++;
                // 每 128 次迭代查一次时间预算（Date.now 有成本，不宜逐次调用）
                if ((iter & 127) === 0 && Date.now() > deadline) {
                    return { solvable: true, reason: '校验超时，未完全穷举（已中断）', uncertain: true };
                }
            }
            if (queue.length > STATE_CAP) {
                return { solvable: true, reason: '状态空间过大，未能完全穷举（建议缩小关卡规模）', uncertain: true };
            }
            const cur = queue[head++];
            const boxSet = new Set(cur.boxes);
            const reach = reachable(p.grid, cur.player, boxSet);

            for (let i = 0; i < cur.boxes.length; i++) {
                const bp = cur.boxes[i].split(',');
                const br = +bp[0], bc = +bp[1];
                // 玩家可站到箱子的哪个相邻格去推它
                for (let d = 0; d < dirs.length; d++) {
                    const nr = br + dirs[d][0], nc = bc + dirs[d][1]; // 玩家站位（箱子相邻）
                    if (!reach.has(nr + ',' + nc)) continue;
                    const tr = br - dirs[d][0], tc = bc - dirs[d][1]; // 箱子被推到的目标格
                    if (isWall(p.grid, tr, tc)) continue;
                    if (boxSet.has(tr + ',' + tc)) continue;

                    const nboxes = cur.boxes.slice();
                    nboxes[i] = tr + ',' + tc;
                    if (hasHardDeadlock(p.grid, nboxes, targetSet)) continue;
                    if (nboxes.every(b => targetSet.has(b))) {
                        return { solvable: true, reason: '可解' };
                    }
                    const nkey = stateKey({ r: br, c: bc }, nboxes); // 推完后玩家站到箱子原位置
                    if (visited.has(nkey)) continue;
                    visited.add(nkey);
                    queue.push({ player: { r: br, c: bc }, boxes: nboxes });
                }
            }
        }
        return { solvable: false, reason: '无解（箱子无法全部归位，存在死局）' };
    }

    const api = { isSolvable: isSolvable, parseMap: parseMap };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.SokobanSolver = api;
    }
})(typeof window !== 'undefined' ? window : this);
