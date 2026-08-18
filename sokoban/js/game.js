/**
 * 推箱子（Sokoban）核心逻辑。
 * 约定：关卡数据来自 SOKOBAN_LEVELS（levels.js），主题由公共 CSS 变量驱动，
 * 故无需在 JS 中处理明暗重绘；主题切换由 common.js 的 CommonManager 统一接管。
 * 简图（缩小俯视图）功能已迁移至「查看关卡页」，本页仅负责游戏玩法。
 */
class SokobanGame {
    constructor(levels, startIndex = 0) {
        this.$levelNum  = document.getElementById('level-num');
        this.$levelName = document.getElementById('level-name');
        this.$moves     = document.getElementById('moves-count');
        this.$best      = document.getElementById('best-moves');
        this.$board     = document.getElementById('board');
        this.$message   = document.getElementById('game-message');
        this.$msgText   = this.$message ? this.$message.querySelector('p') : null;

        this.levels = (Array.isArray(levels) && levels.length) ? levels
            : (typeof SOKOBAN_LEVELS !== 'undefined' ? SOKOBAN_LEVELS : []);
        this.source = 'default';   // 'default'（内置）| 'custom'（上传试玩）
        this.levelIndex = 0;
        this.grid = [];      // 静态层：'wall' | 'floor' | 'target'
        this.rows = 0;
        this.cols = 0;
        this.player = { r: 0, c: 0 };
        this.boxes = [];     // [{r,c}, ...]
        this.moves = 0;
        this.history = [];   // 撤销栈：{player, boxes, moves}
        this.solved = false;

        this._bindEvents();
        this._loadLevel(startIndex);
    }

    // ─── 关卡加载 ───────────────────────────────────────────────
    _loadLevel(index) {
        if (index < 0 || index >= this.levels.length) return;
        this.levelIndex = index;
        const map = this.levels[index].map;
        this.rows = map.length;
        this.cols = map[0].length;
        this.grid = [];
        this.boxes = [];
        this.player = { r: 0, c: 0 };

        for (let r = 0; r < this.rows; r++) {
            const row = [];
            for (let c = 0; c < this.cols; c++) {
                const ch = map[r][c];
                if (ch === '#') {
                    row.push('wall');
                } else if (ch === '.' || ch === '*' || ch === '+') {
                    row.push('target');
                } else {
                    row.push('floor');
                }
                if (ch === '@' || ch === '+') this.player = { r, c };
                if (ch === '$' || ch === '*') this.boxes.push({ r, c });
            }
            this.grid.push(row);
        }

        this.moves = 0;
        this.history = [];
        this.solved = false;
        this._hideMessage();
        this.$board.style.gridTemplateColumns = `repeat(${this.cols}, 1fr)`;
        this._render();
        this._updateStats();
        this._updateControls();
    }

    // ─── 渲染 ───────────────────────────────────────────────────
    _render() {
        const frag = document.createDocumentFragment();
        const boxSet = new Set(this.boxes.map(b => b.r + ',' + b.c));
        const playerKey = this.player.r + ',' + this.player.c;

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const cell = document.createElement('div');
                const type = this.grid[r][c];
                cell.className = 'cell ' + (type === 'wall' ? 'wall' : (type === 'target' ? 'target' : 'floor'));
                cell.dataset.row = r;
                cell.dataset.col = c;

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
        this.$board.innerHTML = '';
        this.$board.appendChild(frag);
    }

    _updateStats() {
        if (this.$levelNum) this.$levelNum.textContent = String(this.levelIndex + 1);
        const baseName = this.levels[this.levelIndex].name;
        if (this.$levelName) this.$levelName.textContent = (this.source === 'custom' ? '自定义 · ' : '') + baseName;
        if (this.$moves) this.$moves.textContent = String(this.moves);
        const best = GameStorage.getBestMoves(this.levelIndex, this.source);
        if (this.$best) this.$best.textContent = best ? String(best) : '-';
    }

    // 按当前状态控制控制栏按钮显隐：
    // - 单关（levels.length<=1）时上一关/下一关无意义，隐藏
    // - 自定义试玩（source==='custom'）时上传关卡无意义，隐藏
    _updateControls() {
        const multi = this.levels.length > 1;
        const prevBtn = document.getElementById('prev-level-btn');
        const nextBtn = document.getElementById('next-level-btn');
        const uploadBtn = document.getElementById('upload-btn');
        if (prevBtn) prevBtn.style.display = multi ? '' : 'none';
        if (nextBtn) nextBtn.style.display = multi ? '' : 'none';
        if (uploadBtn) uploadBtn.style.display = (this.source === 'custom') ? 'none' : '';
    }

    // ─── 移动与推箱 ─────────────────────────────────────────────
    _move(dr, dc) {
        if (this.solved) return;
        const nr = this.player.r + dr;
        const nc = this.player.c + dc;
        if (!this._inBounds(nr, nc) || this.grid[nr][nc] === 'wall') return;

        const boxIdx = this.boxes.findIndex(b => b.r === nr && b.c === nc);
        if (boxIdx !== -1) {
            const bnr = nr + dr;
            const bnc = nc + dc;
            if (!this._inBounds(bnr, bnc) || this.grid[bnr][bnc] === 'wall') return;
            if (this.boxes.some(b => b.r === bnr && b.c === bnc)) return;
            // 推箱
            this._pushHistory();
            this.boxes[boxIdx] = { r: bnr, c: bnc };
            this.player = { r: nr, c: nc };
        } else {
            this._pushHistory();
            this.player = { r: nr, c: nc };
        }

        this.moves++;
        this._render();
        this._updateStats();
        if (this._checkWin()) this._onWin();
    }

    _inBounds(r, c) {
        return r >= 0 && c >= 0 && r < this.rows && c < this.cols;
    }

    _pushHistory() {
        this.history.push({
            player: { ...this.player },
            boxes: this.boxes.map(b => ({ ...b })),
            moves: this.moves
        });
        if (this.history.length > 300) this.history.shift();
    }

    _undo() {
        if (this.solved || this.history.length === 0) return;
        const prev = this.history.pop();
        this.player = prev.player;
        this.boxes = prev.boxes;
        this.moves = prev.moves;
        this._render();
        this._updateStats();
    }

    _reset() {
        this._loadLevel(this.levelIndex);
    }

    _checkWin() {
        return this.boxes.every(b => this.grid[b.r][b.c] === 'target');
    }

    _onWin() {
        this.solved = true;
        const isRecord = GameStorage.saveBestMoves(this.levelIndex, this.moves, this.source);
        if (this.source === 'default') GameStorage.unlockLevel(this.levelIndex + 1);
        this._updateStats();

        const isLast = this.levelIndex >= this.levels.length - 1;
        if (this.$msgText) {
            this.$msgText.innerHTML = isLast
                ? `🎉 全部通关！本关用了 <strong>${this.moves}</strong> 步${isRecord ? '（新纪录）' : ''}`
                : `🎉 过关！用了 <strong>${this.moves}</strong> 步${isRecord ? '（新纪录）' : ''}`;
        }
        const nextBtn = document.getElementById('next-btn');
        if (nextBtn) {
            nextBtn.style.display = isLast ? 'none' : '';
        }
        this._showMessage();
    }

    // ─── 消息遮罩 ───────────────────────────────────────────────
    _showMessage() {
        if (this.$message) this.$message.classList.add('show');
    }

    _hideMessage() {
        if (this.$message) this.$message.classList.remove('show');
    }

    // ─── 事件绑定 ───────────────────────────────────────────────
    _bindEvents() {
        // 键盘
        document.addEventListener('keydown', (e) => {
            let handled = true;
            switch (e.key) {
                case 'ArrowUp': case 'w': case 'W': this._move(-1, 0); break;
                case 'ArrowDown': case 's': case 'S': this._move(1, 0); break;
                case 'ArrowLeft': case 'a': case 'A': this._move(0, -1); break;
                case 'ArrowRight': case 'd': case 'D': this._move(0, 1); break;
                case 'z': case 'Z': this._undo(); break;
                default: handled = false;
            }
            if (handled) e.preventDefault();
        });

        // 触摸滑动（全页面）：在页面任意位置滑动即可控制方向；
        // 起点在按钮 / 输入框 / 评论抽屉等交互元素上时不启用，避免误触。
        let sx = 0, sy = 0, tracking = false;
        const TH = 24;
        document.addEventListener('touchstart', (e) => {
            const target = e.target;
            if (target && target.closest && target.closest('button, input, select, textarea, a, .flea-comments-drawer, .flea-comments-backdrop')) {
                tracking = false;
                return;
            }
            const t = e.changedTouches[0];
            sx = t.clientX; sy = t.clientY;
            tracking = true;
        }, { passive: true });
        document.addEventListener('touchmove', (e) => {
            // 阻止页面滚动：让整个页面成为游戏操作面（棋盘按宽度缩放，页面基本无需纵向滚动）
            if (tracking) e.preventDefault();
        }, { passive: false });
        document.addEventListener('touchend', (e) => {
            if (!tracking) return;
            tracking = false;
            const t = e.changedTouches[0];
            const dx = t.clientX - sx;
            const dy = t.clientY - sy;
            if (Math.abs(dx) < TH && Math.abs(dy) < TH) return;
            if (Math.abs(dx) > Math.abs(dy)) {
                this._move(0, dx > 0 ? 1 : -1);
            } else {
                this._move(dy > 0 ? 1 : -1, 0);
            }
        }, { passive: true });

        // 控制按钮
        document.getElementById('undo-btn')?.addEventListener('click', () => this._undo());
        document.getElementById('reset-btn')?.addEventListener('click', () => this._reset());
        document.getElementById('prev-level-btn')?.addEventListener('click', () => this._loadLevel(this.levelIndex - 1));
        document.getElementById('next-level-btn')?.addEventListener('click', () => this._loadLevel(this.levelIndex + 1));

        // 遮罩按钮
        document.getElementById('next-btn')?.addEventListener('click', () => {
            if (this.levelIndex < this.levels.length - 1) this._loadLevel(this.levelIndex + 1);
        });
        document.getElementById('retry-btn')?.addEventListener('click', () => this._reset());

        // 上传自定义关卡
        this._bindUpload();
    }

    // ─── 自定义关卡（上传试玩）─────────────────────────────
    /**
     * 加载一组自定义关卡进行本地试玩（不污染内置关卡进度/最佳记录）。
     * @param {Array} levels 已解析的关卡数组
     * @param {string} [label] 来源标签（如文件名）
     */
    loadCustomLevels(levels, label) {
        if (!Array.isArray(levels) || levels.length === 0) {
            this._toast('没有可试玩的关卡');
            return;
        }
        this.levels = levels;
        this.source = 'custom';
        this.levelIndex = 0;
        this._hideMessage();
        this._loadLevel(0);
        if (label) this._toast('已加载《' + label + '》共 ' + levels.length + ' 关，开始试玩');
    }

    /** 绑定“上传关卡”按钮与隐藏文件输入 */
    _bindUpload() {
        const self = this;
        const fileInput = document.getElementById('level-file');
        const uploadBtn = document.getElementById('upload-btn');
        if (uploadBtn && fileInput) {
            uploadBtn.addEventListener('click', function () { fileInput.click(); });
        }
        if (!fileInput) return;
        fileInput.addEventListener('change', function (e) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function () {
                try {
                    const levels = SokobanLevels.parse(String(reader.result), file.name.replace(/\.[^.]+$/, ''));
                    self.loadCustomLevels(levels, file.name);
                } catch (err) {
                    self._toast('解析失败：' + (err && err.message ? err.message : err));
                }
                fileInput.value = '';
            };
            reader.onerror = function () { self._toast('文件读取失败'); };
            reader.readAsText(file);
        });
    }

    /** 轻量提示（解析/加载结果） */
    _toast(msg) {
        const el = document.getElementById('level-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
    }
}

// 关卡（棋谱）配置化：优先用 sokoban/config/sokoban-levels.json 覆盖内置默认，
// 加载失败/未配置时回退内置。加载是异步的，拿到关卡后再启动游戏。
// 试玩目标：查看/制作页通过 localStorage 'sokoban_play_target' 传入待试玩关卡
//（{name, map}），读取后立即以自定义关卡试玩，并清除该标记。
window.addEventListener('DOMContentLoaded', function () {
    // 返回按钮：推箱子为“入口页 → 游戏页”多页结构，common.js 默认的 goBack 会
    // 跳回门户首页（../），需按来源拦截跳回对应页面（参考五子棋的 beforeBack 机制）。
    // from=levels 来自查看关卡页试玩；from=editor 来自制作关卡页试玩；
    // 无 from（入口页“开始游戏”/直接打开）则回入口页 index.html。
    window.addEventListener('beforeBack', function (e) {
        var from = new URLSearchParams(window.location.search).get('from');
        var target = 'index.html';
        if (from === 'levels') target = 'levels.html';
        else if (from === 'editor') target = 'editor.html';
        e.detail.defaultPrevented = true;
        window.location.href = target;
    });

    var params = new URLSearchParams(window.location.search);

    // 查看关卡页试玩官方关卡：带 ?level=N 进入，按默认关卡源加载，保留上下关、最佳记录、解锁进度。
    var startIndex = parseInt(params.get('level'), 10);
    if (!isNaN(startIndex) && startIndex >= 0) {
        // 清空可能存在的旧试玩标记，避免官方关卡试玩被误判为自定义。
        try { localStorage.removeItem('sokoban_play_target'); } catch (e) { /* ignore */ }
        var loader = (typeof SokobanLevels !== 'undefined' && SokobanLevels.load)
            ? SokobanLevels.load()
            : Promise.resolve((typeof SOKOBAN_LEVELS !== 'undefined') ? SOKOBAN_LEVELS : []);
        loader.then(function (levels) {
            new SokobanGame(levels, startIndex < levels.length ? startIndex : 0);
        });
        return;
    }

    var playTarget = null;
    try {
        var raw = localStorage.getItem('sokoban_play_target');
        if (raw) {
            playTarget = JSON.parse(raw);
            localStorage.removeItem('sokoban_play_target');
        }
    } catch (e) { /* ignore */ }

    if (playTarget && Array.isArray(playTarget.map) && playTarget.map.length) {
        var custom = { name: playTarget.name || '试玩关卡', map: playTarget.map };
        var game = new SokobanGame([]);
        game.loadCustomLevels([custom], custom.name);
        return;
    }

    var loader = (typeof SokobanLevels !== 'undefined' && SokobanLevels.load)
        ? SokobanLevels.load()
        : Promise.resolve((typeof SOKOBAN_LEVELS !== 'undefined') ? SOKOBAN_LEVELS : []);
    loader.then(function (levels) {
        new SokobanGame(levels);
    });
});
