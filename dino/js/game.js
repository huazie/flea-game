/**
 * 恐龙快跑 - 游戏主逻辑
 *
 * 对标 Chromium T-Rex Runner 的核心手感（参数经多源核实，见需求分析）：
 * - delta-time 驱动（60FPS 基准），高刷新率设备速度一致
 * - 跳跃满高：按键/点击即满跳（不做松键截断）
 * - 速度曲线：起步 6 → 每帧 +0.001 → 上限 13
 * - 公平生成：开局 3 秒空跑道；间距随速度放大；同类型障碍最多连续 2 次；
 *   翼龙仅速度 > 8.5 后出现；计分 = 距离 × 0.025
 * - 夜晚模式：每 700 分反色 12 秒
 * - 多碰撞盒（贴合轮廓的"原谅式"判定）
 */
(function () {
    'use strict';

    /* ==================== 配置 ==================== */

    // 触屏设备检测：canvas 内提示文案按输入能力区分（键盘键位 vs 触摸操作）
    var IS_TOUCH = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

    var CONFIG = {
        WIDTH: 760,            // 逻辑画布宽
        HEIGHT: 220,           // 逻辑画布高
        BOTTOM_PAD: 12,        // 地面线距画布底部
        PIX: 3,                // 精灵像素单元（逻辑 px）
        GRAVITY: 0.6,
        INITIAL_JUMP_VELOCITY: -10.8,
        CLEAR_TIME: 3000,      // 开局空跑道时长（ms）
        GAP_COEFFICIENT: 0.6,
        BASE_GAP: 120,         // 基础间距
        MAX_OBSTACLE_LENGTH: 3,      // 仙人掌簇最大数量
        MAX_OBSTACLE_DUPLICATION: 2, // 同类型障碍最大连续次数
        BIRD_SPEED_THRESHOLD: 8.5,   // 翼龙出现速度门槛
        LARGE_CACTUS_SPEED: 5.5,     // 大仙人掌出现速度门槛（低于起步速度，开局即可大小混合）
        INVERT_DISTANCE: 700,        // 夜晚触发分数间隔
        INVERT_DURATION: 12000,      // 夜晚时长（ms）
        SCORE_FACTOR: 0.025,
        CLOUD_FREQUENCY: 0.002,      // 每帧云生成概率
        MAX_CLOUDS: 6,
        DIFFICULTY: {
            easy:   { start: 5.0, max: 11.0, accel: 0.0008 },
            normal: { start: 6.0, max: 13.0, accel: 0.001  },
            hard:   { start: 6.5, max: 14.5, accel: 0.0013 }
        }
    };

    var GROUND_Y = CONFIG.HEIGHT - CONFIG.BOTTOM_PAD; // 208

    /* ==================== 精灵矩阵（#=实心 o=眼白 x=死亡叉眼 .=空） ==================== */

    /* 恐龙站立/通用身体（22×18，含头/身/尾/小手）。
       轮廓与单格眼位由 chrome://dino 原版截图逐像素提取（#535353 实体）：
       头顶圆角、右下收窄成脖子、左端短尾、身体右缘一只小手。 */
    var DINO_BODY = [
        '............########..',
        '...........##########.',
        '...........##o#######.',
        '...........##########.',
        '...........##########.',
        '...........##########.',
        '...........#####......',
        '...........########...',
        '.#........#####.......',
        '.#......#######.......',
        '.##....##########.....',
        '.###..#########.#.....',
        '.##############.......',
        '.##############.......',
        '..#############.......',
        '...###########........',
        '....#########.........',
        '.....#######..........'
    ];

    // 站立腿（双脚着地，死亡帧沿用）
    var DINO_LEGS_IDLE = [
        '......##...##.........',
        '......##...##.........',
        '......##...##.........',
        '......##...##.........',
        '.....###...###........'
    ];
    // 跑步腿 A（双腿蹬地、脚掌外撇）
    var DINO_LEGS_RUN_A = [
        '......##...##.........',
        '......##...##.........',
        '......##...##.........',
        '.....###...###........',
        '....####...####.......'
    ];
    // 跑步腿 B（右腿后撤、左脚掌前错，与 A 交替出奔跑节奏）
    var DINO_LEGS_RUN_B = [
        '......##...##.........',
        '......##...##.........',
        '.....###...###........',
        '....####...####.......',
        '.....###...####.......'
    ];
    // 跳跃腿（双腿并拢前伸）
    var DINO_LEGS_JUMP = [
        '......##...##.........',
        '......###.###.........',
        '.......#####..........',
        '.......######.........',
        '........####..........'
    ];

    // 蹲伏恐龙（30×14，压扁前伸，低位可躲中位翼龙）
    var DINO_DUCK = [
        '..............####............',
        '............######............',
        '............##o###............',
        '............#######...........',
        '....######################....',
        '...#########################..',
        '..###########################.',
        '.############################.',
        '.#####...###################..',
        '#####.....##################..',
        '#####......#################..',
        '.####......#################..',
        '..###.....#################...',
        '..........###...###...........'
    ];

    // 小仙人掌（9×12，27×36）：细主干 + 双臂上弯带肘（左臂 Γ、右臂 」），
    // 造型对标 chrome://dino 原版——主干 3 格、臂 2 格、肘部位于 50% 株高处
    var CACTUS_SMALL = [
        '...###...',
        '...###...',
        '##.###.##',
        '##.###.##',
        '##.###.##',
        '##.###.##',
        '######.##',
        '...######',
        '...###...',
        '...###...',
        '...###...',
        '...###...'
    ];

    // 大仙人掌（9×18，27×54 ≈ 小株 1.5 倍，株高约为恐龙 0.77，对标原版比例）；
    // 臂更长（左 7 行 / 右 8 行），肘部下移至 50%~56% 株高处；
    // 臂起点在 row 3（17% 株高，与小株一致）：若在 row 2，臂顶角正对恐龙
    // 身部最宽行（y160~162 右缘 116），撞毁帧会嵌进身侧 5px
    var CACTUS_LARGE = [
        '...###...',
        '...###...',
        '...###...',
        '##.###.##',
        '##.###.##',
        '##.###.##',
        '##.###.##',
        '##.###.##',
        '##.###.##',
        '######.##',
        '...######',
        '...###...',
        '...###...',
        '...###...',
        '...###...',
        '...###...',
        '...###...',
        '...###...'
    ];

    // 翼龙（18×14，翅膀上/下两帧）
    var BIRD_UP = [
        '.......#####........',
        '.....#########......',
        '...#############....',
        '.###############....',
        '.###############....',
        '#######.....######..',
        '...#####...#####....',
        '....####.####.......',
        '......#####.........',
        '.......###..........',
        '........###.........',
        '........###.........',
        '........###.........',
        '........####........'
    ];
    var BIRD_DOWN = [
        '.......#####........',
        '......#######.......',
        '......#######.......',
        '#######.....######..',
        '.###############....',
        '.###############....',
        '...#####...#####....',
        '....####.####.......',
        '......#####.........',
        '.......###..........',
        '........###.........',
        '........###.........',
        '........###.........',
        '........####........'
    ];

    var DINO_W = 22 * CONFIG.PIX;  // 66
    var DINO_H = 23 * CONFIG.PIX;  // 69（身体 18 行 + 腿 5 行，脚底精确着地）
    var DINO_DUCK_W = 30 * CONFIG.PIX; // 90
    var DINO_DUCK_H = 14 * CONFIG.PIX; // 42

    /* ==================== 音效（WebAudio 合成，零文件依赖） ==================== */

    var SoundFx = {
        ctx: null,
        enabled: true,

        ensureCtx: function () {
            if (!this.enabled) return false;
            if (!this.ctx) {
                var AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) { this.enabled = false; return false; }
                try { this.ctx = new AC(); } catch (e) { this.enabled = false; return false; }
            }
            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(function () { /* 用户手势前可能失败 */ });
            }
            return true;
        },

        tone: function (freq, dur, type, delay, vol, endFreq) {
            if (!this.ensureCtx()) return;
            var t = this.ctx.currentTime + (delay || 0);
            var osc = this.ctx.createOscillator();
            var gain = this.ctx.createGain();
            osc.type = type || 'square';
            osc.frequency.setValueAtTime(freq, t);
            if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, t + dur);
            gain.gain.setValueAtTime(vol || 0.1, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(t);
            osc.stop(t + dur + 0.02);
        },

        jump: function () { this.tone(560, 0.09, 'square', 0, 0.10); },
        point: function () {
            this.tone(880, 0.06, 'square', 0, 0.09);
            this.tone(880, 0.06, 'square', 0.09, 0.09);
        },
        die: function () { this.tone(320, 0.3, 'sawtooth', 0, 0.12, 70); }
    };

    /* ==================== 工具 ==================== */

    function rand(min, max) { return min + Math.random() * (max - min); }

    function pad5(n) {
        var s = String(Math.min(n, 99999));
        while (s.length < 5) s = '0' + s;
        return s;
    }

    function drawMatrix(ctx, matrix, x, y, pix, color, bgColor) {
        ctx.fillStyle = color;
        for (var r = 0; r < matrix.length; r++) {
            var row = matrix[r];
            for (var c = 0; c < row.length; c++) {
                var ch = row[c];
                if (ch === '#') {
                    ctx.fillRect(x + c * pix, y + r * pix, pix, pix);
                } else if (ch === 'o' || ch === 'x') {
                    // 眼白/死亡叉眼：用背景色填充形成镂空（任何主题/夜晚下都可见）
                    if (bgColor) {
                        ctx.fillStyle = bgColor;
                        ctx.fillRect(x + c * pix, y + r * pix, pix, pix);
                        ctx.fillStyle = color;
                    }
                }
            }
        }
    }

    /* ==================== 主类 ==================== */

    function DinoGame() {
        this.canvas = document.getElementById('game-board');
        this.ctx = this.canvas.getContext('2d');
        this.scoreEl = document.getElementById('score');
        this.bestScoreEl = document.getElementById('best-score');
        this.startBtn = document.getElementById('start-btn');
        this.restartBtn = document.getElementById('restart-btn');
        this.duckBtn = document.getElementById('duck-btn');
        this.soundBtn = document.getElementById('sound-button');
        this.difficultySelect = document.getElementById('difficulty-select');
        this.boardContainer = document.querySelector('.game-board-container');

        this.difficulty = DinoStorage.getDifficulty();
        this.speedCfg = CONFIG.DIFFICULTY[this.difficulty];

        this.state = 'ready'; // ready | running | paused | over
        this.soundOn = DinoStorage.isSoundOn();
        SoundFx.enabled = this.soundOn;

        this.palette = {};
        this.readPalette();

        this.initCanvas();
        this.reset();
        this.bindEvents();

        this.draw();
    }

    DinoGame.prototype.readPalette = function () {
        var style = getComputedStyle(document.body);
        this.palette = {
            bg: style.getPropertyValue('--canvas-bg').trim() || '#fff',
            fg: style.getPropertyValue('--canvas-fg').trim() || '#535353',
            nightBg: style.getPropertyValue('--canvas-night-bg').trim() || '#2b2b2b',
            nightFg: style.getPropertyValue('--canvas-night-fg').trim() || '#f5f5f5'
        };
    };

    DinoGame.prototype.initCanvas = function () {
        var rect = this.boardContainer.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var dpr = window.devicePixelRatio || 1;
        // 位图尺寸跟随容器 CSS 尺寸（×dpr 保证高清屏清晰）
        this.canvas.width = Math.round(rect.width * dpr);
        this.canvas.height = Math.round(rect.height * dpr);
        // 逻辑坐标固定 760×220，整体缩放到实际宽度——任何屏幕都完整显示同一画面
        var scale = (rect.width / CONFIG.WIDTH) * dpr;
        this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };

    DinoGame.prototype.reset = function () {
        this.speed = this.speedCfg.start;
        this.distance = 0;
        this.score = 0;
        this.lastScoreMilestone = 0;

        this.dino = {
            x: 60,
            y: GROUND_Y - DINO_H,
            vy: 0,
            jumping: false,
            ducking: false
        };
        this.duckHeld = false;        // 蹲伏键按住状态（着地瞬间续蹲判定用）
        this.obstacles = [];
        this.clouds = [];
        this.groundOffset = 0;
        this.spawnTimer = CONFIG.CLEAR_TIME; // 开局空跑道
        this.lastType = null;
        this.typeRepeat = 0;

        this.isNight = false;
        this.lastInvertScore = 0;

        this.blinkTimer = rand(2000, 5000);
        this.blinkUntil = 0;

        this.runFrame = 0;
        this.runFrameTime = 0;
        this.birdFrame = 0;
        this.birdFrameTime = 0;

        this.state = 'ready';
        this.bestScore = DinoStorage.getBestScore(this.difficulty);

        this.updateScoreUI();
        this.updateButtons();
    };

    /* ---------- 事件 ---------- */

    DinoGame.prototype.bindEvents = function () {
        var self = this;

        document.addEventListener('keydown', function (e) { self.onKeyDown(e); });
        document.addEventListener('keyup', function (e) { self.onKeyUp(e); });

        this.startBtn.addEventListener('click', function () { self.onStartButton(); });
        this.restartBtn.addEventListener('click', function () { self.restart(); });

        this.difficultySelect.addEventListener('change', function (e) {
            self.setDifficulty(e.target.value);
        });

        this.soundBtn.addEventListener('click', function () { self.toggleSound(); });
        this.updateSoundIcon();

        // 画布触摸：点击/上滑跳跃，下滑蹲伏（绑画布作用域，不拦页面滚动）
        var touchStartY = null;
        var touchDucking = false;
        this.canvas.addEventListener('touchstart', function (e) {
            e.preventDefault();
            touchStartY = e.touches[0].clientY;
            self.onJumpInput();
        }, { passive: false });
        this.canvas.addEventListener('touchmove', function (e) {
            e.preventDefault();
            if (touchStartY === null) return;
            var dy = e.touches[0].clientY - touchStartY;
            if (dy > 36 && !touchDucking) {
                touchDucking = true;
                self.duckHeld = true;
                self.setDucking(true);
            }
        }, { passive: false });
        this.canvas.addEventListener('touchend', function (e) {
            e.preventDefault();
            if (touchDucking) { touchDucking = false; self.duckHeld = false; self.setDucking(false); }
            touchStartY = null;
        }, { passive: false });

        // 蹲伏按钮（移动端主控）
        this.duckBtn.addEventListener('touchstart', function (e) {
            e.preventDefault();
            self.duckHeld = true;
            self.setDucking(true);
        }, { passive: false });
        this.duckBtn.addEventListener('touchend', function (e) {
            e.preventDefault();
            self.duckHeld = false;
            self.setDucking(false);
        }, { passive: false });
        this.duckBtn.addEventListener('touchcancel', function () { self.duckHeld = false; self.setDucking(false); });

        // 失焦自动暂停
        window.addEventListener('blur', function () {
            if (self.state === 'running') self.pause();
        });

        // 尺寸/主题变化
        window.addEventListener('resize', function () {
            self.initCanvas();
            self.draw();
        });
        // 容器尺寸变化（布局抖动、CDN 字体加载完成等不触发 window resize）时重算位图
        if (typeof ResizeObserver !== 'undefined') {
            var ro = new ResizeObserver(function () {
                self.initCanvas();
                self.draw();
            });
            ro.observe(this.boardContainer);
        }
        document.addEventListener('themeChanged', function () {
            self.readPalette();
            self.draw();
        });
    };

    DinoGame.prototype.onKeyDown = function (e) {
        var key = e.key;
        if (key === ' ' || key === 'Spacebar' || key === 'ArrowUp' || key === 'w' || key === 'W') {
            if (e.repeat) return;
            e.preventDefault();
            this.onJumpInput();
        } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
            if (e.repeat) return;
            e.preventDefault();
            this.duckHeld = true;
            this.setDucking(true);
        } else if (key === 'p' || key === 'P') {
            this.togglePause();
        }
    };

    DinoGame.prototype.onKeyUp = function (e) {
        var key = e.key;
        if (key === 'ArrowDown' || key === 's' || key === 'S') {
            this.duckHeld = false;
            this.setDucking(false);
        }
    };

    DinoGame.prototype.onJumpInput = function () {
        if (this.state === 'over') { this.restart(); return; }
        if (this.state === 'ready' || this.state === 'paused') { this.start(); return; }
        if (this.state === 'running') this.jump();
    };

    DinoGame.prototype.jump = function () {
        if (this.dino.jumping || this.dino.ducking) return;
        this.dino.jumping = true;
        this.dino.vy = CONFIG.INITIAL_JUMP_VELOCITY - this.speed / 10;
        SoundFx.jump();
    };

    DinoGame.prototype.setDucking = function (on) {
        if (this.state !== 'running') { this.dino.ducking = false; return; }
        this.dino.ducking = on && !this.dino.jumping;
    };

    DinoGame.prototype.onStartButton = function () {
        if (this.state === 'over') { this.restart(); return; }
        this.togglePause();
    };

    DinoGame.prototype.togglePause = function () {
        if (this.state === 'over') return;
        if (this.state === 'running') this.pause();
        else this.start();
    };

    DinoGame.prototype.start = function () {
        if (this.state === 'over') return;
        this.state = 'running';
        this.lastTime = performance.now();
        this.updateButtons();
        this.loop();
    };

    DinoGame.prototype.pause = function () {
        this.state = 'paused';
        this.updateButtons();
        this.draw();
    };

    DinoGame.prototype.restart = function () {
        this.reset();
        this.state = 'running';
        this.lastTime = performance.now();
        this.updateButtons();
        this.loop();
    };

    DinoGame.prototype.setDifficulty = function (difficulty) {
        this.difficulty = difficulty;
        this.speedCfg = CONFIG.DIFFICULTY[difficulty];
        DinoStorage.saveDifficulty(difficulty);
        this.bestScore = DinoStorage.getBestScore(difficulty);
        this.updateScoreUI();
        this.updateButtons();
        if (this.state === 'running' || this.state === 'paused') {
            this.restart();
        } else {
            this.draw();
        }
    };

    DinoGame.prototype.toggleSound = function () {
        this.soundOn = !this.soundOn;
        SoundFx.enabled = this.soundOn;
        DinoStorage.saveSound(this.soundOn);
        this.updateSoundIcon();
        if (this.soundOn) SoundFx.jump();
    };

    DinoGame.prototype.updateSoundIcon = function () {
        var icon = this.soundBtn.querySelector('i');
        icon.classList.toggle('fa-volume-high', this.soundOn);
        icon.classList.toggle('fa-volume-xmark', !this.soundOn);
        this.soundBtn.title = this.soundOn ? '关闭音效' : '开启音效';
    };

    /* ---------- 游戏循环 ---------- */

    DinoGame.prototype.loop = function () {
        var self = this;
        if (this._raf) cancelAnimationFrame(this._raf);
        var frame = function (now) {
            if (self.state !== 'running') return;
            // 帧因子（60FPS 基准）：下限钳 0——rAF timestamp 与 performance.now()
            // 可能因时钟回退/休眠恢复出现负偏差，负 dt 会让物理倒退并误触发落地
            var dt = Math.max(0, Math.min((now - self.lastTime) / 16.667, 3));
            self.lastTime = now;
            self.update(dt);
            self.draw();
            if (self.state === 'running') {
                self._raf = requestAnimationFrame(frame);
            }
        };
        this._raf = requestAnimationFrame(frame);
    };

    DinoGame.prototype.update = function (dt) {
        var dino = this.dino;

        // 速度与距离
        if (this.speed < this.speedCfg.max) {
            this.speed = Math.min(this.speed + this.speedCfg.accel * dt, this.speedCfg.max);
        }
        this.distance += this.speed * dt;
        var newScore = Math.floor(this.distance * CONFIG.SCORE_FACTOR);
        if (newScore !== this.score) {
            this.score = newScore;
            this.updateScoreUI();
            if (this.score > this.bestScore) {
                this.bestScore = this.score;
                DinoStorage.saveBestScore(this.bestScore, this.difficulty);
            }
            if (Math.floor(this.score / 100) > this.lastScoreMilestone) {
                this.lastScoreMilestone = Math.floor(this.score / 100);
                this.flashScore();
                SoundFx.point();
            }
        }

        // 夜晚模式
        if (!this.isNight && this.score - this.lastInvertScore >= CONFIG.INVERT_DISTANCE) {
            this.isNight = true;
            this.nightEnd = performance.now() + CONFIG.INVERT_DURATION;
        } else if (this.isNight && performance.now() >= this.nightEnd) {
            this.isNight = false;
            this.lastInvertScore = this.score;
        }

        // 恐龙物理
        if (dino.jumping) {
            dino.y += dino.vy * dt;
            dino.vy += CONFIG.GRAVITY * dt;
            // 仅下落中（vy >= 0）才判定落地：dt=0（时钟回退钳位）时 y 恰好等于地面，
            // 若不加条件会把上升中的恐龙误判落地并清空跳跃状态
            if (dino.y >= GROUND_Y - DINO_H && dino.vy >= 0) {
                dino.y = GROUND_Y - DINO_H;
                dino.jumping = false;
                dino.vy = 0;
                // 着地瞬间蹲伏键仍按住则直接续蹲
                if (this.duckHeld) dino.ducking = true;
            }
        }

        // 跑步/翅膀动画帧
        this.runFrameTime += dt * 16.667;
        if (this.runFrameTime >= 90) { this.runFrameTime = 0; this.runFrame = this.runFrame ? 0 : 1; }
        this.birdFrameTime += dt * 16.667;
        if (this.birdFrameTime >= 200) { this.birdFrameTime = 0; this.birdFrame = this.birdFrame ? 0 : 1; }

        // 眨眼
        this.blinkTimer -= dt * 16.667;
        if (this.blinkTimer <= 0 && !this.isBlinking) {
            this.isBlinking = true;
            this.blinkUntil = performance.now() + 120;
        }
        if (this.isBlinking && performance.now() >= this.blinkUntil) {
            this.isBlinking = false;
            this.blinkTimer = rand(2000, 5000);
        }

        // 障碍生成与移动
        this.updateObstacles(dt);
        if (this.checkCollision()) {
            this.gameOver();
            return;
        }

        // 云与地面纹理
        this.updateClouds(dt);
        this.groundOffset = (this.groundOffset + this.speed * dt) % 24;
    };

    DinoGame.prototype.updateObstacles = function (dt) {
        var i;
        // 移动与出界清理
        for (i = this.obstacles.length - 1; i >= 0; i--) {
            var ob = this.obstacles[i];
            ob.x -= this.speed * dt;
            if (ob.x + ob.w < -30) this.obstacles.splice(i, 1);
        }

        this.spawnTimer -= dt * 16.667;
        if (this.spawnTimer > 0) return;

        var type = this.pickObstacleType();
        if (!type) { this.spawnTimer = 400; return; }

        var ob;
        if (type === 'cactus') {
            ob = this.spawnCactus();
        } else {
            // 翼龙：低（跳）/ 中（蹲或跳）/ 高（站立可无视）
            var heights = [GROUND_Y - 42, GROUND_Y - 87, GROUND_Y - 120];
            ob = {
                type: 'bird',
                x: CONFIG.WIDTH + 10,
                y: heights[Math.random() * 3 | 0],
                w: 54,
                h: 42
            };
        }
        this.obstacles.push(ob);

        // 间距：随速度与障碍实际宽度线性放大（原版 GAP_COEFFICIENT 规则）
        var gap = (ob.w * this.speed + CONFIG.BASE_GAP * CONFIG.GAP_COEFFICIENT) * rand(1, 1.5);
        this.spawnTimer = gap / this.speed * 16.667;
    };

    // 生成仙人掌簇：1~3 株大小随机混合（对标原版高矮错落，如一大两小），
    // 逐株底部对齐着地、紧贴无隙；低速时全小株，速度超门槛后大株按概率入簇；
    // 三株簇限一大（三株全大株时墙体过宽，起跳窗口不足，形同必死）
    DinoGame.prototype.spawnCactus = function () {
        var count = 1 + (Math.random() * CONFIG.MAX_OBSTACLE_LENGTH | 0);
        var parts = [];
        var totalW = 0, maxH = 0, bigCount = 0;
        for (var k = 0; k < count; k++) {
            var big = this.speed > CONFIG.LARGE_CACTUS_SPEED && Math.random() < 0.5;
            if (big && count === 3 && bigCount >= 1) big = false;
            if (big) bigCount++;
            var matrix = big ? CACTUS_LARGE : CACTUS_SMALL;
            var pw = matrix[0].length * CONFIG.PIX;
            var ph = matrix.length * CONFIG.PIX;
            parts.push({ matrix: matrix, w: pw, h: ph });
            totalW += pw;
            if (ph > maxH) maxH = ph;
        }
        return { type: 'cactus', parts: parts, x: CONFIG.WIDTH + 10, y: GROUND_Y - maxH, w: totalW, h: maxH };
    };

    DinoGame.prototype.pickObstacleType = function () {
        var pool = ['cactus'];
        if (this.speed > CONFIG.BIRD_SPEED_THRESHOLD) pool.push('bird');

        // 同类型最多连续 MAX_OBSTACLE_DUPLICATION 次
        var candidates = pool.filter(function (t) {
            return !(t === this.lastType && this.typeRepeat >= CONFIG.MAX_OBSTACLE_DUPLICATION);
        }, this);
        if (!candidates.length) candidates = ['cactus'];

        var type = candidates[Math.random() * candidates.length | 0];
        if (type === this.lastType) this.typeRepeat++;
        else { this.lastType = type; this.typeRepeat = 1; }
        return type;
    };

    // 蹲伏造型顶缘：贴地面（蹲伏仅在着地状态）
    DinoGame.prototype.duckTop = function () {
        return GROUND_Y - DINO_DUCK_H;
    };

    DinoGame.prototype.checkCollision = function () {
        var d = this.dino;
        var boxes;
        if (d.ducking) {
            // 单个宽扁盒（高度远低于站立，可躲中位翼龙）；
            // 右缘 93 = 头部视觉轮廓右缘 87 + 6（障碍盒内缩 3 + 半帧位移 3），判死与视觉对齐
            boxes = [{ x: d.x + 6, y: this.duckTop() + 3, w: DINO_DUCK_W - 3, h: DINO_DUCK_H - 6 }];
        } else {
            // 站立：头 / 身 / 腿 三盒；各盒右缘 = 对应轮廓视觉右缘 + 6
            // （障碍盒内缩 3 + 半帧位移 3），使判死时刻与视觉相接对齐
            var top = GROUND_Y - DINO_H;
            boxes = [
                { x: d.x + 24, y: d.jumping ? d.y : top, w: 33, h: 20 },
                // 身盒右缘 51 = 背部轮廓视觉右缘（第 10~11 行）45 + 6，对齐小仙人掌判死时刻
                { x: d.x + 6, y: d.jumping ? d.y + 20 : top + 20, w: 45, h: 24 },
                { x: d.x + 6, y: d.jumping ? d.y + 44 : top + 44, w: 38, h: 28 }
            ];
        }
        function hit(a, b) {
            return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        }
        for (var i = 0; i < this.obstacles.length; i++) {
            var ob = this.obstacles[i];
            var obBoxes;
            if (ob.type === 'bird') {
                // 翼龙：左缘贴左翅尖（BIRD_UP 第 5 行 col 0），顶/底/右各内缩 3~6 避让镂空
                obBoxes = [{ x: ob.x, y: ob.y + 6, w: ob.w - 6, h: ob.h - 15 }];
            } else {
                // 仙人掌簇逐株判定：混合大小下，小株旁的空间不误判，大株正常判
                obBoxes = [];
                var off = 0;
                for (var k = 0; k < ob.parts.length; k++) {
                    var pt = ob.parts[k];
                    // 逐株判定盒：左右各内缩 3，贴视觉实心缘；顶部缺口自然多让 3~6px
                    obBoxes.push({ x: ob.x + off + 3, y: GROUND_Y - pt.h, w: pt.w - 6, h: pt.h });
                    off += pt.w;
                }
            }
            for (var m = 0; m < obBoxes.length; m++) {
                for (var j = 0; j < boxes.length; j++) {
                    if (hit(boxes[j], obBoxes[m])) return true;
                }
            }
        }
        return false;
    };

    DinoGame.prototype.updateClouds = function (dt) {
        var i;
        for (i = this.clouds.length - 1; i >= 0; i--) {
            this.clouds[i].x -= this.speed * 0.2 * dt;
            if (this.clouds[i].x < -80) this.clouds.splice(i, 1);
        }
        if (this.clouds.length < CONFIG.MAX_CLOUDS && Math.random() < CONFIG.CLOUD_FREQUENCY * dt * 6) {
            this.clouds.push({ x: CONFIG.WIDTH + rand(0, 200), y: rand(24, 90) });
        }
    };

    DinoGame.prototype.gameOver = function () {
        this.state = 'over';
        this.dino.dead = true;
        SoundFx.die();
        this.updateButtons();
        this.draw();
    };

    /* ---------- 渲染 ---------- */

    DinoGame.prototype.draw = function () {
        var ctx = this.ctx;
        var p = this.palette;
        var fg = this.isNight ? p.nightFg : p.fg;
        var bg = this.isNight ? p.nightBg : p.bg;

        // 背景
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);

        // 月亮与星星（夜晚）
        if (this.isNight) {
            ctx.fillStyle = fg;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.arc(660, 48, 16, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 0.4;
            var stars = [[120, 40], [200, 70], [320, 36], [420, 60], [520, 44], [600, 74], [710, 60], [80, 84]];
            for (var s = 0; s < stars.length; s++) {
                ctx.fillRect(stars[s][0], stars[s][1], 3, 3);
            }
            ctx.globalAlpha = 1;
        }

        // 云
        ctx.fillStyle = fg;
        ctx.globalAlpha = 0.28;
        for (var c = 0; c < this.clouds.length; c++) {
            var cl = this.clouds[c];
            ctx.beginPath();
            ctx.ellipse(cl.x, cl.y, 18, 8, 0, 0, Math.PI * 2);
            ctx.ellipse(cl.x + 16, cl.y - 5, 14, 8, 0, 0, Math.PI * 2);
            ctx.ellipse(cl.x + 32, cl.y, 16, 7, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // 地面
        ctx.fillStyle = fg;
        ctx.fillRect(0, GROUND_Y, CONFIG.WIDTH, 2);
        // 地面滚动石子
        for (var g = -this.groundOffset; g < CONFIG.WIDTH; g += 24) {
            ctx.globalAlpha = 0.5;
            ctx.fillRect(g, GROUND_Y + 8, 6, 2);
            ctx.fillRect(g + 12, GROUND_Y + 14, 4, 2);
            ctx.globalAlpha = 1;
        }

        // 障碍
        for (var o = 0; o < this.obstacles.length; o++) {
            var ob = this.obstacles[o];
            if (ob.type === 'bird') {
                drawMatrix(ctx, this.birdFrame ? BIRD_DOWN : BIRD_UP, ob.x, ob.y, CONFIG.PIX, fg);
            } else {
                // 仙人掌簇：逐株紧贴绘制，每株底部对齐着地（大株高、小株矮，错落有致）
                var off = 0;
                for (var k = 0; k < ob.parts.length; k++) {
                    var pt = ob.parts[k];
                    drawMatrix(ctx, pt.matrix, ob.x + off, GROUND_Y - pt.h, CONFIG.PIX, fg);
                    off += pt.w;
                }
            }
        }

        // 恐龙
        this.drawDino(ctx, fg, bg);

        // 暂停提示
        if (this.state === 'paused') {
            this.drawOverlay(ctx, '已暂停', IS_TOUCH ? '点击画面继续' : '按 P 或点击开始继续', fg);
        }
        // 结束遮罩
        if (this.state === 'over') {
            this.drawOverlay(ctx, '游戏结束', '得分 ' + pad5(this.score) + (IS_TOUCH ? ' · 点击画面重来' : ' · 按空格重来'), fg);
        }
        // 待开始提示
        if (this.state === 'ready') {
            ctx.fillStyle = fg;
            ctx.globalAlpha = 0.65;
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(IS_TOUCH ? '点击画面开始' : '按 空格 / 点击画面 开始', CONFIG.WIDTH / 2, 64);
            ctx.globalAlpha = 1;
        }
    };

    DinoGame.prototype.drawDino = function (ctx, fg, bg) {
        var d = this.dino;
        // 蹲伏造型（仅着地状态）
        if (d.ducking) {
            drawMatrix(ctx, DINO_DUCK, d.x, this.duckTop(), CONFIG.PIX, fg, bg);
            return;
        }
        var top = d.jumping ? d.y : GROUND_Y - DINO_H;
        var body = DINO_BODY.slice();
        // 眨眼：闭眼（眼睛行变实线）
        if (this.isBlinking && !d.dead) {
            body[2] = '...........#######....';
        }
        // 死亡：眼变叉（x 镂空）+ 张嘴（脖子行中缝）
        if (d.dead) {
            body[2] = '...........#x#x####...';
            body[6] = '...........###.##......';
        }
        drawMatrix(ctx, body, d.x, top, CONFIG.PIX, fg, bg);
        var legs;
        if (d.jumping) legs = DINO_LEGS_JUMP;
        // 待机/死亡：静止站立（原版待机画面恐龙不动，按空格才开跑）
        else if (d.dead || this.state === 'ready') legs = DINO_LEGS_IDLE;
        else legs = this.runFrame ? DINO_LEGS_RUN_B : DINO_LEGS_RUN_A;
        drawMatrix(ctx, legs, d.x, top + 18 * CONFIG.PIX, CONFIG.PIX, fg, bg);
    };

    DinoGame.prototype.drawOverlay = function (ctx, title, subtitle, fg) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 26px Arial';
        ctx.fillText(title, CONFIG.WIDTH / 2, CONFIG.HEIGHT / 2 - 14);
        ctx.font = '16px Arial';
        ctx.fillText(subtitle, CONFIG.WIDTH / 2, CONFIG.HEIGHT / 2 + 20);
    };

    /* ---------- UI ---------- */

    DinoGame.prototype.updateScoreUI = function () {
        this.scoreEl.textContent = pad5(this.score);
        this.bestScoreEl.textContent = pad5(this.bestScore);
    };

    DinoGame.prototype.flashScore = function () {
        var el = this.scoreEl;
        el.classList.remove('flash');
        void el.offsetWidth; // 重启动画
        el.classList.add('flash');
    };

    DinoGame.prototype.updateButtons = function () {
        var label = '开始';
        if (this.state === 'running') label = '暂停';
        else if (this.state === 'paused') label = '继续';
        this.startBtn.textContent = label;
        this.startBtn.disabled = this.state === 'over';
        this.difficultySelect.disabled = this.state === 'running' || this.state === 'paused';
        this.difficultySelect.value = this.difficulty;
    };

    /* ==================== 启动 ==================== */
    /* 调试/测试句柄：便于自动化脚本精确断言内部状态（夜晚、碰撞、分数等） */

    function boot() {
        window.__dinoGame = new DinoGame();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
