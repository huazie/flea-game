/**
 * ================================================
 * 消消乐 - Modern Match-3 Game Engine
 * ================================================
 */

// 宝石类型配置（emoji 图标 + CSS 类名）
const GEM_TYPES = [
    { id: 'red',    emoji: '🔴', label: '红宝石'   },
    { id: 'blue',   emoji: '🔵', label: '蓝宝石'   },
    { id: 'green',  emoji: '🟢', label: '绿宝石'   },
    { id: 'yellow', emoji: '🟡', label: '黄宝石'   },
    { id: 'purple', emoji: '🟣', label: '紫宝石'   },
    { id: 'orange', emoji: '🟠', label: '橙宝石'   },
];

// 特殊宝石类型常量
const SPECIAL = {
    NONE:      0,
    STRIPED_H: 1,   // 横条纹 — 消除整行
    STRIPED_V: 2,   // 竖条纹 — 消除整列
    BOMB:      3,   // 炸弹   — 消除3×3区域
    RAINBOW:   4,   // 彩虹   — 消除所有同色
};

// 星级阈值（相对于目标分数的百分比）
// 关卡配置
const LEVEL_CONFIGS = [
    null, // 索引0不用
    { target: 500,  moves: 30, desc: '🌟 初次挑战' },
    { target: 1500, moves: 28, desc: '🌟🌟 稳步前进' },
    { target: 2500, moves: 26, desc: '🌟🌟🌟 挑战极限' },
    { target: 3500, moves: 24, desc: '🌟🌟🌟🌟 大师之路' },
    { target: 5000, moves: 22, desc: '🌟🌟🌟🌟🌟 传奇巅峰' },
];

/**
 * Match3Game - 现代化消消乐游戏核心类
 */
class Match3Game {
    constructor() {
        this.size = 8;           // 棋盘大小 8×8
        this.board = [];         // 棋盘数据
        this.specialBoard = [];  // 特殊宝石标记
        this.score = 0;
        this.level = this._loadLevel();
        this.movesLeft = 0;
        this.isAnimating = false;
        this.selectedCell = null;
        this.comboCount = 0;
        this.gameEnded = false;
        this.hintCount = 3;
        this.shuffleCount = 1;
        this._gameId = 0;  // 用于检测游戏是否已重置（防止 setTimeout 竞态）

        // DOM 引用
        this.$board   = document.querySelector('.game-board');
        this.$score   = document.getElementById('score');
        this.$best    = document.getElementById('best-score');
        this.$moves   = document.getElementById('moves-count');
        this.$level   = document.getElementById('level-num');
        this.$target  = document.getElementById('target-score');
        this.$hintBtn = document.getElementById('hint-btn');
        this.$shuffleBtn = document.getElementById('shuffle-btn');

        this._init();
    }

    // ─── 初始化 ───────────────────────────────────────────────

    _init() {
        this._bindEvents();
        this._applyTheme();
        this._syncUI();
        this._newGame();
    }

    _bindEvents() {
        // 棋盘点击
        this.$board.addEventListener('click', e => {
            const cell = e.target.closest('.grid-cell');
            if (!cell || this.isAnimating || this.gameEnded) return;
            const r = +cell.dataset.row;
            const c = +cell.dataset.col;
            this._handleClick(r, c);
        });

        this._bindSwipeEvents();

        // 返回
        document.getElementById('back-button')?.addEventListener('click', () => {
            window.location.href = '../index.html';
        });

        // 提示
        this.$hintBtn?.addEventListener('click', () => this._showHint());

        // 重新洗牌
        this.$shuffleBtn?.addEventListener('click', () => this._shuffleBoard());

        // 遮罩按钮
        document.getElementById('retry-btn')?.addEventListener('click', () => this._retry());
        document.getElementById('next-btn')?.addEventListener('click', () => this._nextLevel());
        document.getElementById('new-game-btn')?.addEventListener('click', () => this._restart());
        document.getElementById('restart-btn')?.addEventListener('click', () => this._restart());
    }

    _applyTheme() {
        const saved = localStorage.getItem('color_scheme') || 'light';
        document.documentElement.setAttribute('data-theme', saved);
        this._updateThemeIcon(saved === 'dark');
    }

    _updateThemeIcon(isDark) {
        const icon = document.querySelector('#theme-button i');
        if (icon) icon.className = isDark ? 'fas fa-moon' : 'fas fa-sun';
    }

    _syncUI() {
        this.$best.textContent = this._loadBestScore();
        const cfg = this._levelConfig();
        this.$level.textContent = this.level;
        this.$target.textContent = cfg.target.toLocaleString();
        this._updateHintBtn();
    }

    // ─── 游戏流程 ───────────────────────────────────────────────

    _newGame() {
        this._gameId++;
        this.score = 0;
        this.comboCount = 0;
        this.gameEnded = false;
        this.isAnimating = false;
        this.selectedCell = null;
        this.hintCount = 3;
        this.shuffleCount = 1;
        const cfg = this._levelConfig();
        this.movesLeft = cfg.moves;
        this._genBoard();
        this._render();
        this._updateHUD();
        this._hideOverlay();
        this._updateHintBtn();
        this._saveLevel();
    }

    _retry() {
        this._newGame();
    }

    _nextLevel() {
        if (this.level >= LEVEL_CONFIGS.length - 1) {
            // 已通关，显示庆祝页面
            this._showVictory();
            return;
        }
        this.level = this.level + 1;
        this._saveLevel();
        this._newGame();
    }

    _showVictory() {
        const victoryEl = document.getElementById('victory-overlay');
        const scoreEl  = document.getElementById('victory-score');
        if (victoryEl) victoryEl.classList.add('visible');
        if (scoreEl)   scoreEl.textContent = `最终得分: ${this.score.toLocaleString()}`;
    }

    _hideVictory() {
        document.getElementById('victory-overlay')?.classList.remove('visible');
    }

    _restart() {
        this._hideVictory();
        this.level = 1;
        this._saveLevel();
        this._newGame();
    }

    // ─── 棋盘生成 ───────────────────────────────────────────────

    _genBoard() {
        this.board       = [];
        this.specialBoard = [];
        for (let r = 0; r < this.size; r++) {
            this.board[r]        = [];
            this.specialBoard[r] = [];
            for (let c = 0; c < this.size; c++) {
                this.board[r][c]        = this._randomGem(r, c);
                this.specialBoard[r][c] = SPECIAL.NONE;
            }
        }
        // 确保初始棋盘无可消除的匹配
        while (this._findMatches().length > 0) {
            for (let r = 0; r < this.size; r++)
                for (let c = 0; c < this.size; c++)
                    this.board[r][c] = this._randomGem(r, c);
        }
        // 确保至少有一个可用交换
        if (!this._hasPossibleMove()) {
            this._genBoard();
        }
    }

    /** 生成随机宝石类型，确保不产生初始匹配 */
    _randomGem(row, col) {
        let type;
        let attempts = 0;
        do {
            type = Math.floor(Math.random() * GEM_TYPES.length);
            attempts++;
        } while (attempts < 50 && this._wouldMatch(row, col, type));
        return type;
    }

    /** 检查放置某类型宝石是否会产生匹配 */
    _wouldMatch(row, col, type) {
        // 水平检查（向左2个）
        if (col >= 2 &&
            this.board[row][col-1] === type &&
            this.board[row][col-2] === type) return true;
        // 垂直检查（向上2个）
        if (row >= 2 &&
            this.board[row-1][col] === type &&
            this.board[row-2][col] === type) return true;
        return false;
    }

    // ─── 点击处理 ───────────────────────────────────────────────

    /** 滑动交换（触屏）：宝石跟随手指拖动，越过阈值即时提交交换（不等松手），
     *  未达阈值松手则弹回。用 Pointer Events 实现：touch 事件流目标锁定在起始
     *  元素上，动画重建宝石后该元素游离会导致触摸事件不再冒泡到棋盘（拖动失效）；
     *  pointer 事件按命中重定目标 + setPointerCapture，元素重建无影响。 */
    _bindSwipeEvents() {
        const COMMIT_RATIO = 0.25;  // 位移超过格宽 25% 提交交换（越低越跟手）
        const TAP_SLOP = 8;         // 位移小于 8px 视为点击
        let drag = null;            // { id, row, col, gem, startX, startY, size, committed }
        let suppressClick = false;  // 拖动后抑制合成 click，避免误触发点选

        this.$board.addEventListener('pointerdown', e => {
            if (e.pointerType === 'mouse') return;  // 鼠标仍走点选
            if (drag) return;                       // 已有手势进行中
            suppressClick = false;                  // 新手势复位，防止残留吞掉合法 click
            const cellEl = e.target.closest('.grid-cell');
            if (!cellEl) return;
            drag = {
                id: e.pointerId,
                row: +cellEl.dataset.row,
                col: +cellEl.dataset.col,
                gem: null,  // 惰性获取：起始宝石可能被动画重建
                startX: e.clientX,
                startY: e.clientY,
                size: cellEl.getBoundingClientRect().width,
                committed: false,
                axis: null,  // 方向锁定：'x' | 'y'
                dx: 0, dy: 0,
                raf: 0,
            };
            try { this.$board.setPointerCapture(e.pointerId); } catch (_) { /* 忽略 */ }
        });

        // 拖动跟随 + 越过阈值即时提交（不等松手，消除松手延迟）
        // 丝滑三要素：① rAF 合帧渲染（事件频率 > 刷新率时避免掉帧）
        //            ② will-change + translate3d 提升合成层（宝石有多重阴影，避免每帧重绘）
        //            ③ 方向锁定（避免对角拖动时主导轴来回跳变）
        this.$board.addEventListener('pointermove', e => {
            if (!drag || drag.committed || e.pointerId !== drag.id) return;
            if (this.isAnimating || this.gameEnded) return;  // 动画中不跟随，手势保留
            const rawDx = e.clientX - drag.startX;
            const rawDy = e.clientY - drag.startY;

            // 主导轴位移越过阈值 → 立即提交交换
            if (Math.max(Math.abs(rawDx), Math.abs(rawDy)) >= drag.size * COMMIT_RATIO) {
                const d = drag;
                drag = null;
                this._commitSwipe(d, rawDx, rawDy);
                return;
            }

            // 方向锁定：一旦主导轴确定就不再切换
            if (!drag.axis && (Math.abs(rawDx) > 3 || Math.abs(rawDy) > 3))
                drag.axis = Math.abs(rawDx) >= Math.abs(rawDy) ? 'x' : 'y';

            // 只保留锁定轴，并钳制在一格内
            let dx = drag.axis === 'y' ? 0 : rawDx;
            let dy = drag.axis === 'x' ? 0 : rawDy;
            dx = Math.max(-drag.size, Math.min(drag.size, dx));
            dy = Math.max(-drag.size, Math.min(drag.size, dy));
            drag.dx = dx;
            drag.dy = dy;

            // rAF 合帧：一帧最多写一次样式
            if (!drag.raf) {
                const d = drag;
                d.raf = requestAnimationFrame(() => {
                    d.raf = 0;
                    if (drag !== d || d.committed) return;
                    if (!d.gem) {
                        const cellEl = this._getCell(d.row, d.col);
                        d.gem = cellEl ? cellEl.querySelector('.gem') : null;
                    }
                    if (d.gem) {
                        d.gem.style.transition = 'none';
                        d.gem.style.zIndex = 2;
                        d.gem.style.willChange = 'transform';
                        d.gem.style.transform =
                            `translate3d(${d.dx || 0}px, ${d.dy || 0}px, 0)`;
                    }
                });
            }
        });

        // 弹回原位
        const resetGem = (gem, instant = false) => {
            if (!gem) return;
            gem.style.willChange = '';
            if (instant) {
                gem.style.transition = '';
                gem.style.transform = '';
                gem.style.zIndex = '';
                return;
            }
            gem.style.transition = 'transform 0.15s ease-out';
            gem.style.transform = 'translate(0, 0)';
            setTimeout(() => {
                if (drag && drag.gem === gem) return;  // 已开始新的拖动，勿清理
                gem.style.transition = '';
                gem.style.transform = '';
                gem.style.zIndex = '';
            }, 160);
        };

        // 取消挂起的跟随渲染帧
        const cancelFollowRaf = d => {
            if (d && d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
        };

        // 提交换：主导轴定方向，fast 节奏吸附（拖动中已见位移，无需慢过渡）
        this._commitSwipe = (d, rawDx, rawDy) => {
            d.committed = true;
            cancelFollowRaf(d);
            suppressClick = true;

            const absX = Math.abs(rawDx), absY = Math.abs(rawDy);
            let tr = d.row, tc = d.col;
            if (absX >= absY) tc += rawDx > 0 ? 1 : -1;
            else              tr += rawDy > 0 ? 1 : -1;

            // 目标格越界（边框向外滑）：不交换，宝石弹回原位
            if (tr < 0 || tr >= this.size || tc < 0 || tc >= this.size) {
                resetGem(d.gem);
                return;
            }

            // 清除已有点选状态
            if (this.selectedCell) {
                this._highlightCell(this.selectedCell.row, this.selectedCell.col, false);
                this.selectedCell = null;
            }

            // 宝石从当前位置吸附到目标格（与 _animateSwap 同参数，无缝衔接）
            if (d.gem) {
                d.gem.style.transition = 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)';
                d.gem.style.transform =
                    `translate(${(tc - d.col) * 100}%, ${(tr - d.row) * 100}%)`;
            }
            this._doSwap(d.row, d.col, tr, tc, true);
        };

        const finish = (e, cancelled) => {
            if (!drag || drag.committed || e.pointerId !== drag.id) return;
            const d = drag;
            drag = null;
            cancelFollowRaf(d);
            const rawDx = e.clientX - d.startX;
            const rawDy = e.clientY - d.startY;
            const moved = Math.max(Math.abs(rawDx), Math.abs(rawDy));

            // 取消或动画中松手：还原
            if (cancelled || this.isAnimating || this.gameEnded) {
                resetGem(d.gem, true);
                return;
            }

            // 点击（位移很小）：直接走点选逻辑。
            // pointerdown 时 setPointerCapture 会把合成 click 重定向到棋盘，
            // 导致 click 点选失效，故此处自行调用并抑制合成 click。
            if (moved < TAP_SLOP) {
                resetGem(d.gem, true);
                suppressClick = true;
                this._handleClick(d.row, d.col);
                return;
            }

            // 释放时达到阈值（快速轻扫可能跳过 pointermove）：提交
            if (moved >= d.size * COMMIT_RATIO) {
                this._commitSwipe(d, rawDx, rawDy);
                return;
            }

            resetGem(d.gem);  // 未达阈值：弹回
        };

        this.$board.addEventListener('pointerup', e => finish(e, false));
        this.$board.addEventListener('pointercancel', e => finish(e, true));

        // touch 流仅用于抑制浏览器默认行为（拖动时防滚动；pointerup 先于 touchend，
        // 拖动/弹回后 preventDefault 掉合成 click；接近原点的触摸保留 click 供点选）
        this.$board.addEventListener('touchmove', e => {
            const t = e.touches[0];
            if (t && Math.hypot(t.clientX - (drag ? drag.startX : t.clientX),
                                t.clientY - (drag ? drag.startY : t.clientY)) >= TAP_SLOP)
                e.preventDefault();
        }, { passive: false });
        this.$board.addEventListener('touchend', e => {
            if (suppressClick) { suppressClick = false; e.preventDefault(); }
        });
        // 长按会触发上下文菜单并取消触摸流，导致拖动失效（慢启动拖动尤甚）
        this.$board.addEventListener('contextmenu', e => e.preventDefault());
    }

    _handleClick(row, col) {
        if (!this.selectedCell) {
            this.selectedCell = { row, col };
            this._highlightCell(row, col, true);
            return;
        }

        const { row: r1, col: c1 } = this.selectedCell;

        // 点到同一格：取消选中
        if (r1 === row && c1 === col) {
            this._highlightCell(row, col, false);
            this.selectedCell = null;
            return;
        }

        // 检查是否相邻
        const adjacent = (Math.abs(r1 - row) === 1 && c1 === col) ||
                        (Math.abs(c1 - col) === 1 && r1 === row);

        if (!adjacent) {
            // 不相邻：切换选中
            this._highlightCell(r1, c1, false);
            this.selectedCell = { row, col };
            this._highlightCell(row, col, true);
            return;
        }

        // 交换
        this._highlightCell(r1, c1, false);
        this.selectedCell = null;
        this._doSwap(r1, c1, row, col);
    }

    // ─── 交换逻辑 ───────────────────────────────────────────────

    async _doSwap(r1, c1, r2, c2, fast = false) {
        this.isAnimating = true;
        this._clearHint();

        const spec1 = this.specialBoard[r1][c1];
        const spec2 = this.specialBoard[r2][c2];

        // ★ 两个特殊宝石交换 → 直接触发双方效果
        if (spec1 !== SPECIAL.NONE && spec2 !== SPECIAL.NONE) {
            await this._animateSwap(r1, c1, r2, c2, false, fast);
            this._swapData(r1, c1, r2, c2);
            this._swapDomGems(r1, c1, r2, c2);

            const toRemove = new Set();
            // 触发 gem1 的特殊效果（使用交换后的位置）
            const area1 = this._getSpecialArea(r2, c2, spec1, this.board[r2][c2]);
            area1.forEach(([ar, ac]) => toRemove.add(`${ar},${ac}`));
            toRemove.add(`${r2},${c2}`);
            // 触发 gem2 的特殊效果（使用交换后的位置）
            const area2 = this._getSpecialArea(r1, c1, spec2, this.board[r1][c1]);
            area2.forEach(([ar, ac]) => toRemove.add(`${ar},${ac}`));
            toRemove.add(`${r1},${c1}`);

            const arr = [...toRemove].map(k => {
                const [r, c] = k.split(',').map(Number);
                return { row: r, col: c };
            });
            this._removeAndScore(arr);
            await this._delay(150);
            await this._dropAndFill();

            // 连锁
            let nextMatches = this._findMatches();
            if (nextMatches.length > 0) {
                await this._processCascade(nextMatches);
            }

            this.movesLeft--;
            this._updateMoves();
            this._checkEnd();
            this.isAnimating = false;
            return;
        }

        // ★ 彩虹宝石 + 普通宝石交换 → 消除所有同色
        if (spec1 === SPECIAL.RAINBOW || spec2 === SPECIAL.RAINBOW) {
            const isRainbowFirst = spec1 === SPECIAL.RAINBOW;
            // 对方宝石类型（交换前读取）
            const targetType = isRainbowFirst ? this.board[r2][c2] : this.board[r1][c1];

            await this._animateSwap(r1, c1, r2, c2, false, fast);
            this._swapData(r1, c1, r2, c2);
            this._swapDomGems(r1, c1, r2, c2);

            // 交换后彩虹宝石的新位置
            const rainbowR = isRainbowFirst ? r2 : r1;
            const rainbowC = isRainbowFirst ? c2 : c1;

            const toRemove = new Set();
            // 消除所有与目标同色的宝石
            for (let r = 0; r < this.size; r++)
                for (let c = 0; c < this.size; c++)
                    if (this.board[r][c] === targetType)
                        toRemove.add(`${r},${c}`);
            // 彩虹宝石本身也消除
            toRemove.add(`${rainbowR},${rainbowC}`);

            const arr = [...toRemove].map(k => {
                const [r, c] = k.split(',').map(Number);
                return { row: r, col: c };
            });
            this._removeAndScore(arr);
            await this._delay(150);
            await this._dropAndFill();

            let nextMatches = this._findMatches();
            if (nextMatches.length > 0) {
                await this._processCascade(nextMatches);
            }

            this.movesLeft--;
            this._updateMoves();
            this._checkEnd();
            this.isAnimating = false;
            return;
        }

        // 普通交换逻辑
        this._swapData(r1, c1, r2, c2);
        await this._animateSwap(r1, c1, r2, c2, false, fast);

        const matches = this._findMatches();

        if (matches.length === 0) {
            // 无匹配，撤销（元素未换位，抖动结束由 _animateSwap 清样式）
            this._swapData(r1, c1, r2, c2);
            await this._animateSwap(r1, c1, r2, c2, true, fast);
            this.isAnimating = false;
            return;
        }

        this._swapDomGems(r1, c1, r2, c2);  // 移动 DOM 节点落位（不再全量重建）

        // 消耗步数
        this.movesLeft--;
        this._updateMoves();

        // 处理连锁消除
        this.comboCount = 0;
        await this._processCascade(matches);

        // 结束判定
        this._checkEnd();
        this.isAnimating = false;
    }

    _swapData(r1, c1, r2, c2) {
        const tmp        = this.board[r1][c1];
        const tmpSpec    = this.specialBoard[r1][c1];
        this.board[r1][c1]        = this.board[r2][c2];
        this.specialBoard[r1][c1] = this.specialBoard[r2][c2];
        this.board[r2][c2]        = tmp;
        this.specialBoard[r2][c2] = tmpSpec;
    }

    // ─── 连锁消除 ───────────────────────────────────────────────

    async _processCascade(matches) {
        while (matches.length > 0) {
            this.comboCount++;

            // 播放匹配动画
            await this._animateMatches(matches);

            // 收集待消除的格子
            const toRemove = new Set();
            const specialsTriggered = [];

            for (const match of matches) {
                const len = match.length;
                const { row, col } = match[0];
                const type  = this.board[row][col];
                const spec  = this.specialBoard[row][col];

                // 收集宝石
                for (const { row: r, col: c } of match) {
                    toRemove.add(`${r},${c}`);
                    const s = this.specialBoard[r][c];
                    if (s !== SPECIAL.NONE) specialsTriggered.push({ r, c, s, type });
                }

                // 产生特殊宝石
                const last  = match[len - 1];
                const first = match[0];
                let newSpec = SPECIAL.NONE;
                let newR = -1, newC = -1;

                if (len === 4) {
                    // 根据匹配方向决定条纹类型
                    const allSameRow = match.every(m => m.row === match[0].row);
                    const allSameCol = match.every(m => m.col === match[0].col);
                    if (allSameRow) {
                        newSpec = SPECIAL.STRIPED_H;  // 横向匹配 → 消除整行
                    } else if (allSameCol) {
                        newSpec = SPECIAL.STRIPED_V;  // 纵向匹配 → 消除整列
                    } else {
                        // T/L 形 → 随机
                        newSpec = Math.random() < 0.5 ? SPECIAL.STRIPED_H : SPECIAL.STRIPED_V;
                    }
                    newR = row; newC = col;
                } else if (len >= 5) {
                    // T/L 形 → 炸弹；直线 → 彩虹
                    if (this._isLineMatch(match)) {
                        newSpec = SPECIAL.RAINBOW;
                    } else {
                        newSpec = SPECIAL.BOMB;
                    }
                    newR = row; newC = col;
                }

                if (newSpec !== SPECIAL.NONE) {
                    toRemove.add(`${newR},${newC}`);
                    // 延迟到下一帧生成
                    const gameId = this._gameId;
                    setTimeout(() => {
                        if (this._gameId !== gameId) return;  // 游戏已重置，忽略
                        this.board[newR][newC]        = type;
                        this.specialBoard[newR][newC] = newSpec;
                        this._setGemCell(newR, newC, true);
                    }, 400);
                }
            }

            // 触发特殊宝石效果
            for (const { r, c, s, type } of specialsTriggered) {
                const affected = this._getSpecialArea(r, c, s, type);
                affected.forEach(([ar, ac]) => toRemove.add(`${ar},${ac}`));
            }

            // 清除并计分
            const arr = [...toRemove].map(k => {
                const [r, c] = k.split(',').map(Number);
                return { row: r, col: c };
            });
            this._removeAndScore(arr);

            await this._delay(150);

            // 下落填充
            await this._dropAndFill();

            // 检查新匹配（连锁）
            matches = this._findMatches();
        }
    }

    _isLineMatch(match) {
        if (match.length < 3) return false;
        const r0 = match[0].row, c0 = match[0].col;
        const r1 = match[1].row, c1 = match[1].col;
        if (r0 === r1) return match.every(m => m.row === r0);
        if (c0 === c1) return match.every(m => m.col === c0);
        return false;
    }

    _getSpecialArea(r, c, s, type) {
        const area = [];
        switch (s) {
            case SPECIAL.STRIPED_H:
                for (let col = 0; col < this.size; col++)
                    if (!(col === c)) area.push([r, col]);
                break;
            case SPECIAL.STRIPED_V:
                for (let row = 0; row < this.size; row++)
                    if (!(row === r)) area.push([row, c]);
                break;
            case SPECIAL.BOMB:
                for (let dr = -1; dr <= 1; dr++)
                    for (let dc = -1; dc <= 1; dc++) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size)
                            area.push([nr, nc]);
                    }
                break;
            case SPECIAL.RAINBOW:
                for (let row = 0; row < this.size; row++)
                    for (let col = 0; col < this.size; col++)
                        if (this.board[row][col] === type)
                            area.push([row, col]);
                break;
        }
        return area;
    }

    // ─── 匹配查找 ───────────────────────────────────────────────

    _findMatches() {
        const visited = Array.from({ length: this.size }, () => Array(this.size).fill(false));
        const matches = [];

        // 水平匹配
        for (let r = 0; r < this.size; r++) {
            let c = 0;
            while (c < this.size) {
                const type = this.board[r][c];
                if (type === -1) { c++; continue; }
                let len = 1;
                while (c + len < this.size && this.board[r][c + len] === type) len++;
                if (len >= 3) {
                    const match = [];
                    for (let i = 0; i < len; i++) match.push({ row: r, col: c + i });
                    matches.push(match);
                }
                c += len;
            }
        }

        // 垂直匹配
        for (let c = 0; c < this.size; c++) {
            let r = 0;
            while (r < this.size) {
                const type = this.board[r][c];
                if (type === -1) { r++; continue; }
                let len = 1;
                while (r + len < this.size && this.board[r + len][c] === type) len++;
                if (len >= 3) {
                    const match = [];
                    for (let i = 0; i < len; i++) match.push({ row: r + i, col: c });
                    matches.push(match);
                }
                r += len;
            }
        }

        // 合并重叠匹配（L形、T形）
        return this._mergeMatches(matches);
    }

    /** 合并重叠的匹配（防止同一宝石被重复收集） */
    _mergeMatches(matches) {
        const cells = new Map();
        for (const match of matches) {
            for (const { row, col } of match) {
                const key = `${row},${col}`;
                if (!cells.has(key)) cells.set(key, { row, col, count: 1 });
                else cells.get(key).count++;
            }
        }
        // 按连通区域分组
        const groups = [];
        const used   = new Set();

        for (const [key, cell] of cells) {
            if (used.has(key)) continue;
            const group = [];
            const queue  = [cell];
            while (queue.length > 0) {
                const cur = queue.shift();
                const k   = `${cur.row},${cur.col}`;
                if (used.has(k)) continue;
                used.add(k);
                group.push({ row: cur.row, col: cur.col });
                // 找邻居
                for (const other of cells.values()) {
                    if (used.has(`${other.row},${other.col}`)) continue;
                    if (Math.abs(other.row - cur.row) + Math.abs(other.col - cur.col) === 1)
                        queue.push(other);
                }
            }
            if (group.length >= 3) groups.push(group);
        }
        return groups;
    }

    // ─── 计分 ───────────────────────────────────────────────

    _removeAndScore(cells) {
        // 计算分数
        const baseScore = cells.length * 20;
        const comboBonus = Math.max(0, this.comboCount - 1) * 50;
        const gained     = baseScore + comboBonus;
        this.score += gained;

        // 显示分数气泡（取中间格子）
        const mid = cells[Math.floor(cells.length / 2)];
        if (mid) this._showScoreBubble(mid.row, mid.col, gained);

        // 连击提示
        if (this.comboCount >= 2) {
            this._showCombo(this.comboCount);
        }

        // 消除动画
        for (const { row, col } of cells) {
            this.board[row][col]        = -1;
            this.specialBoard[row][col] = SPECIAL.NONE;
            const cell = this._getCell(row, col);
            if (cell) {
                const gem = cell.querySelector('.gem');
                if (gem) gem.classList.add('gem-removing');
            }
        }

        this._updateHUD();
    }

    // ─── 下落与填充 ───────────────────────────────────────────────

    async _dropAndFill() {
        // 逐列下落（数据层），同时记录 DOM 移动计划
        const moves = [];  // { c, fromR, toR }  fromR === -1 表示新宝石
        for (let c = 0; c < this.size; c++) {
            let writeRow = this.size - 1;
            for (let r = this.size - 1; r >= 0; r--) {
                if (this.board[r][c] !== -1) {
                    if (writeRow !== r) {
                        this.board[writeRow][c]        = this.board[r][c];
                        this.specialBoard[writeRow][c] = this.specialBoard[r][c];
                        this.board[r][c]        = -1;
                        this.specialBoard[r][c] = SPECIAL.NONE;
                        moves.push({ c, fromR: r, toR: writeRow });
                    }
                    writeRow--;
                }
            }
            // 顶部填充新宝石
            for (let r = writeRow; r >= 0; r--) {
                this.board[r][c]        = Math.floor(Math.random() * GEM_TYPES.length);
                this.specialBoard[r][c] = SPECIAL.NONE;
                moves.push({ c, fromR: -1, toR: r });
            }
        }

        if (moves.length === 0) return;

        // DOM 层：增量更新（只动受影响的宝石，不重建整个棋盘）
        this.$board.querySelectorAll('.gem-removing').forEach(g => g.remove());

        const animated = [];
        for (const m of moves) {
            const targetCell = this._getCell(m.toR, m.c);
            if (!targetCell) continue;
            let gem;
            if (m.fromR === -1) {
                // 新宝石：创建后从棋盘上方落入
                gem = this._buildGem(m.toR, m.c);
                targetCell.appendChild(gem);
                gem.style.transition = 'none';
                gem.style.transform  = `translateY(${-(m.toR + 1) * 110}%)`;
            } else {
                // 已有宝石：移动节点到目标格，从原位落下
                const srcCell = this._getCell(m.fromR, m.c);
                gem = srcCell?.querySelector('.gem');
                if (!gem) continue;
                targetCell.appendChild(gem);
                gem.style.transition = 'none';
                gem.style.transform  = `translateY(${(m.fromR - m.toR) * 100}%)`;
            }
            animated.push(gem);
        }

        // 强制回流后统一开 transition，一波落体动画
        void this.$board.offsetHeight;
        for (const gem of animated) {
            gem.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            gem.style.transform  = 'translateY(0)';
        }

        await this._delay(380);

        for (const gem of animated) this._syncGemStyles(gem);
    }

    /** 按棋盘数据构造宝石元素（不含定位动画） */
    _buildGem(row, col) {
        const type = this.board[row][col];
        const spec = this.specialBoard[row][col] ?? SPECIAL.NONE;
        const gem = document.createElement('div');
        gem.className = `gem gem-${GEM_TYPES[type].id}`;
        if (spec === SPECIAL.STRIPED_H) gem.classList.add('striped-h');
        else if (spec === SPECIAL.STRIPED_V) gem.classList.add('striped-v');
        else if (spec === SPECIAL.BOMB) gem.classList.add('bomb');
        else if (spec === SPECIAL.RAINBOW) gem.classList.add('rainbow');
        gem.textContent = (spec === SPECIAL.BOMB) ? '💥' : GEM_TYPES[type].emoji;
        return gem;
    }

    // ─── 动画 ───────────────────────────────────────────────

    async _animateSwap(r1, c1, r2, c2, invalid = false, fast = false) {
        const cell1 = this._getCell(r1, c1);
        const cell2 = this._getCell(r2, c2);
        const gem1  = cell1?.querySelector('.gem');
        const gem2  = cell2?.querySelector('.gem');

        if (!gem1 || !gem2) { this._render(); return; }

        const dr = r2 - r1;
        const dc = c2 - c1;

        if (invalid) {
            gem1.classList.add('gem-invalid');
            gem2.classList.add('gem-invalid');
            await this._delay(400);
            gem1.classList.remove('gem-invalid');
            gem2.classList.remove('gem-invalid');
            // 清掉滑动残留的吸附 transform（抖动结束后宝石回原位）
            this._syncGemStyles(gem1);
            this._syncGemStyles(gem2);
        } else {
            // 交换过渡：回弹曲线（与 .gem 基础 transition 同款）+ 缩放脉冲，保证位移可感知
            // fast：滑动拖拽提交（触发即时性靠阈值提交保证，交换过程必须清晰可见）
            gem1.style.transition = 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)';
            gem2.style.transition = 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)';
            gem1.style.transform  = `translate(${dc * 100}%, ${dr * 100}%) scale(1.12)`;
            gem2.style.transform  = `translate(${-dc * 100}%, ${-dr * 100}%) scale(1.12)`;
            await this._delay(fast ? 185 : 190);
        }
        // 不再全量 _render：调用方用 _swapDomGems 移动节点落位
    }

    /** 清除宝石上的拖拽/吸附行内样式 */
    _syncGemStyles(gem) {
        if (!gem) return;
        gem.style.transition = '';
        gem.style.transform  = '';
        gem.style.zIndex     = '';
        gem.style.willChange = '';
    }

    /** 交换完成后移动 DOM 节点到各自新格（零重建，替代全量 _render） */
    _swapDomGems(r1, c1, r2, c2) {
        const cell1 = this._getCell(r1, c1);
        const cell2 = this._getCell(r2, c2);
        const gem1  = cell1?.querySelector('.gem');
        const gem2  = cell2?.querySelector('.gem');
        if (!gem1 || !gem2) return;

        cell2.appendChild(gem1);  // 移动节点（不重建）
        cell1.appendChild(gem2);
        this._syncGemStyles(gem1);
        this._syncGemStyles(gem2);
    }

    async _animateMatches(matches) {
        // 高亮匹配的宝石
        for (const match of matches) {
            for (const { row, col } of match) {
                const cell = this._getCell(row, col);
                const gem  = cell?.querySelector('.gem');
                if (gem) gem.classList.add('gem-matched');
            }
        }
        await this._delay(320);
    }

    _showScoreBubble(row, col, score) {
        const cell = this._getCell(row, col);
        if (!cell) return;
        const rect = cell.getBoundingClientRect();
        const boardRect = this.$board.getBoundingClientRect();
        const bubble = document.createElement('div');
        bubble.className = 'score-bubble';
        bubble.textContent = `+${score}`;
        bubble.style.left = (rect.left - boardRect.left + rect.width / 2 - 20) + 'px';
        bubble.style.top  = (rect.top  - boardRect.top  + rect.height / 2 - 12) + 'px';
        this.$board.appendChild(bubble);
        setTimeout(() => bubble.remove(), 950);
    }

    _showCombo(count) {
        const existing = this.$board.querySelector('.combo-banner');
        if (existing) existing.remove();
        const banner = document.createElement('div');
        banner.className = 'combo-banner';
        const msgs = ['', '🔥 连击!', '⚡⚡ 双重!', '💥💥💥 狂热!', '🌟🌟🌟🌟 毁灭!'];
        banner.textContent = msgs[Math.min(count, msgs.length - 1)] || `🔥×${count}`;
        this.$board.appendChild(banner);
        setTimeout(() => banner.remove(), 850);
    }

    _clearHint() {
        this.$board?.querySelectorAll('.gem-hint').forEach(el => el.classList.remove('gem-hint'));
    }

    // ─── 提示系统 ───────────────────────────────────────────────

    _showHint() {
        if (this.hintCount <= 0 || this.isAnimating) return;
        this._clearHint();
        const move = this._findHintMove();
        if (!move) return;
        this.hintCount--;
        this._updateHintBtn();
        const cell1 = this._getCell(move.r1, move.c1);
        const cell2 = this._getCell(move.r2, move.c2);
        cell1?.querySelector('.gem')?.classList.add('gem-hint');
        cell2?.querySelector('.gem')?.classList.add('gem-hint');
        setTimeout(() => this._clearHint(), 2000);
    }

    _findHintMove() {
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                // 尝试向右交换
                if (c < this.size - 1) {
                    this._swapData(r, c, r, c + 1);
                    const ok = this._findMatches().length > 0;
                    this._swapData(r, c, r, c + 1);
                    if (ok) return { r1: r, c1: c, r2: r, c2: c + 1 };
                }
                // 尝试向下交换
                if (r < this.size - 1) {
                    this._swapData(r, c, r + 1, c);
                    const ok = this._findMatches().length > 0;
                    this._swapData(r, c, r + 1, c);
                    if (ok) return { r1: r, c1: c, r2: r + 1, c2: c };
                }
            }
        }
        return null;
    }

    _hasPossibleMove() {
        return this._findHintMove() !== null;
    }

    // ─── 洗牌 ───────────────────────────────────────────────

    _shuffleBoard() {
        if (this.shuffleCount <= 0 || this.isAnimating) return;
        this.shuffleCount--;
        this._updateHintBtn();

        // 打乱所有非特殊宝石
        const gems = [];
        for (let r = 0; r < this.size; r++)
            for (let c = 0; c < this.size; c++)
                if (this.specialBoard[r][c] === SPECIAL.NONE)
                    gems.push(this.board[r][c]);

        for (let i = gems.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [gems[i], gems[j]] = [gems[j], gems[i]];
        }

        let idx = 0;
        for (let r = 0; r < this.size; r++)
            for (let c = 0; c < this.size; c++)
                if (this.specialBoard[r][c] === SPECIAL.NONE)
                    this.board[r][c] = gems[idx++];

        // 消除初始匹配
        let retry = 5;
        while (this._findMatches().length > 0 && retry-- > 0) {
            for (let r = 0; r < this.size; r++)
                for (let c = 0; c < this.size; c++)
                    this.board[r][c] = Math.floor(Math.random() * GEM_TYPES.length);
        }

        if (!this._hasPossibleMove()) this._genBoard();

        this._render(true);
    }

    _updateHintBtn() {
        if (this.$hintBtn) {
            this.$hintBtn.querySelector('.count').textContent = this.hintCount;
            this.$hintBtn.disabled = this.hintCount <= 0;
        }
        if (this.$shuffleBtn) {
            this.$shuffleBtn.querySelector('.count').textContent = this.shuffleCount;
            this.$shuffleBtn.disabled = this.shuffleCount <= 0;
        }
    }

    // ─── 渲染 ───────────────────────────────────────────────

    _render(newOnly = false) {
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                this._setGemCell(r, c, newOnly);
            }
        }
    }

    _setGemCell(row, col, animate = false) {
        const cell = this._getCell(row, col);
        if (!cell) return;

        // 清除旧宝石
        const oldGem = cell.querySelector('.gem');
        if (oldGem) cell.removeChild(oldGem);

        if (this.board[row][col] === -1) return; // 空位

        const gem = this._buildGem(row, col);
        if (animate) gem.classList.add('gem-new');
        cell.appendChild(gem);
    }

    _highlightCell(row, col, on) {
        const cell = this._getCell(row, col);
        const gem  = cell?.querySelector('.gem');
        if (gem) gem.classList.toggle('selected', on);
    }

    // ─── UI 更新 ───────────────────────────────────────────────

    _updateHUD() {
        this.$level.textContent = this.level;
        this.$target.textContent = this._levelConfig().target.toLocaleString();
        this.$score.textContent = this.score.toLocaleString();
        if (this.score > this._loadBestScore()) {
            this._saveBestScore(this.score);
            this.$best.textContent = this.score.toLocaleString();
        }
        this._updateMoves();
    }

    _updateMoves() {
        this.$moves.textContent = this.movesLeft;
        this.$moves.classList.toggle('warning', this.movesLeft <= 5);
    }

    // ─── 游戏结束判定 ───────────────────────────────────────────────

    _checkEnd() {
        if (this.gameEnded) return;

        const cfg = this._levelConfig();
        const won  = this.score >= cfg.target;

        if (won || this.movesLeft <= 0) {
            this.gameEnded = true;
            const gameId = this._gameId;
            setTimeout(() => {
                if (this._gameId !== gameId) return;  // 游戏已重置，忽略
                this._showOverlay(won);
            }, 400);
        } else if (!this._hasPossibleMove()) {
            // 无可用移动，自动洗牌
            this._shuffleBoard();
        }
    }

    _showOverlay(won) {
        const overlay = document.querySelector('.overlay');
        const title   = overlay?.querySelector('.overlay-title');
        const scoreEl = overlay?.querySelector('.overlay-score');
        const nextBtn = document.getElementById('next-btn');

        if (!overlay) return;

        if (title) {
            title.textContent = won ? '🎉 恭喜过关！' : '😢 步数用完';
            title.className = `overlay-title ${won ? 'win' : 'lose'}`;
        }
        if (scoreEl) {
            const cfg = this._levelConfig();
            scoreEl.textContent = `本局得分: ${this.score.toLocaleString()}  /  目标: ${cfg.target.toLocaleString()}`;
        }
        if (nextBtn) nextBtn.style.display = won ? 'flex' : 'none';

        overlay.classList.add('visible');
    }

    _hideOverlay() {
        document.querySelector('.overlay')?.classList.remove('visible');
    }

    // ─── 辅助 ───────────────────────────────────────────────

    _getCell(row, col) {
        return this.$board.querySelector(`.grid-cell[data-row="${row}"][data-col="${col}"]`);
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _levelConfig() {
        const idx = Math.min(this.level, LEVEL_CONFIGS.length - 1);
        return LEVEL_CONFIGS[idx] || LEVEL_CONFIGS[1];
    }

    _loadLevel() {
        return parseInt(localStorage.getItem('match3_level') || '1', 10);
    }
    _saveLevel() {
        localStorage.setItem('match3_level', this.level);
    }
    _loadBestScore() {
        return parseInt(localStorage.getItem('match3_best') || '0', 10);
    }
    _saveBestScore(s) {
        const cur = this._loadBestScore();
        if (s > cur) localStorage.setItem('match3_best', s);
    }
}

// ─── 页面加载完成后初始化 ───────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // 确保棋盘 DOM 存在
    const board = document.querySelector('.game-board');
    if (!board) return;

    // 动态生成 8×8 格子
    board.innerHTML = '';
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.dataset.row = r;
            cell.dataset.col = c;
            board.appendChild(cell);
        }

    window.game = new Match3Game();
    console.log('[Debug] Game instance exposed as window.game');
});
