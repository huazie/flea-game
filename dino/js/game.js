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

    // 触屏设备检测：CSS media query 在部分手机内核不可靠，改用 JS 判定并统一驱动
    // （画布提示文案、页面操作说明、触屏按钮显隐）。
    // 多信号合成：具备触摸能力（ontouchstart/maxTouchPoints）且非「悬停 + 精细指针」
    // 设备——桌面 Chrome 的 ontouchstart 恒存在，须排除，否则 PC 会误判为触屏
    var IS_TOUCH = ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0)
        && !(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

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
        WIDE_CLUSTER_SPEED: 6.5,     // 三连簇速度门槛：低于此速度簇限两株
                                     // （滞空帧数固定，速度越低跳跃水平覆盖越短，
                                     //   低速下三连簇起跳窗口不足，稍跳早即落回簇尾）
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

    // 站立腿（双脚着地，死亡帧沿用）——逐格复刻原版 WAITING/JUMPING/CRASHED 帧
    // 腿部（三帧提取值完全相同）：腹底横条 + 后腿锥形（col6-8→col6-7→col6→脚掌）
    // + 前腿锥形（col10-11→col11→col11→脚掌）
    var DINO_LEGS_IDLE = [
        '.....#######..........',
        '......###.##..........',
        '......##...#..........',
        '......#....#..........',
        '......##...##.........'
    ];
    // 跑步腿 A/B（5×22，逐格复刻原版 RUNNING 两帧 2x 精灵提取数据，1 格 = 4@2x px）：
    // row18 为腹底横条（与身体 row17 同宽衔接）；踩地腿呈「宽根→收细→展脚掌」锥形，
    // 另一条腿仅剩贴身残段（原版抬起腿即被腹底遮挡，只露 1-2 格）；
    // 帧A 后腿踩地（col6-8→col6-7→col6→col6-7）、前腿迈出残段（col11-13）；
    // 帧B 前腿踩地（col10-11→col11→col11→col11-12）、后腿后收残段（col7-8）——
    // 两帧快速交替即原版小碎步跑感；帧A 兼作步频基准帧
    var DINO_LEGS_RUN_A = [
        '.....#######..........',
        '......###..###........',
        '......##..............',
        '......#...............',
        '......##..............'
    ];
    var DINO_LEGS_RUN_B = [
        '.....#######..........',
        '......##..##..........',
        '.......##..#..........',
        '...........#..........',
        '...........##.........'
    ];
    // 跳跃腿（与原版 JUMPING 帧一致：即静态双腿，空中不摆动）
    var DINO_LEGS_JUMP = [
        '.....#######..........',
        '......###.##..........',
        '......##...#..........',
        '......#....#..........',
        '......##...##.........'
    ];

    // 蹲伏恐龙身体（28×13，84×39）：从 chrome://dino 原版精灵图（2x 精灵表帧1）
    // 按游戏统一网格提取——站立恐龙 44×47@1x → 22×23 格（1 格 = 2 原版 px），
    // 本矩阵同规则：核心 55×26@1x → 28×13 格，渲染 1.5 倍原版尺寸。
    // 造型：左端斜尖尾探出头顶、尾背间一道凹槽、高背平直、右上大头
    // （颈下眼孔 1 格镂空）、腹末左收；底部两腿（后腿 x9-11、前腿 x14-17）
    // 拆至 DINO_DUCK_LEGS_A/B 独立绘制，两腿全程可见、交替屈伸蹬地。
    // 旧版 35×12 系参考截图按 3px/格误提（且在地面线处截断丢了脚），
    // 横向拉宽 27%、纵向压扁 12%，故观感失衡；本版还原原版比例（宽高比 2.12）
    var DINO_DUCK = [
        '#..................#######..',
        '###....#########..##########',
        '####################o#######',
        '.###########################',
        '..##########################',
        '...#########################',
        '....###################.....',
        '.....############..#######..',
        '......##########............',
        '............................',
        '............................',
        '............................',
        '............................'
    ];

    // 蹲伏双腿两帧（4×28，绘制偏移 9 格，与站立跑腿同 90ms 节奏）：
    // 忠实还原原版 DUCKING 两帧的腿部形态——结构为「后小脚(col6-7) + 主腿(col9-12)
    // + 前小手(col15)」，腿短小贴身（仅占下缘 2-3 格）：
    // 帧A 主腿长伸踩地（col9-11 直下到 row12）、后小脚短；
    // 帧B 主腿蹬地后收（缩短 1 行且右移 1 格悬空）、后小脚拖长——
    // 原版奔跑感即来自主腿的收放与后脚的拖曳；前小手两帧纹丝不动（纯固定前肢）；
    // 帧A 兼作死亡/待机定格帧
    var DINO_DUCK_LEGS_A = [
        '......#..###...#............',
        '......##.##....#............',
        '.........#..................',
        '.........##.................'
    ];
    var DINO_DUCK_LEGS_B = [
        '......#...###..#............',
        '......##..###..#............',
        '......##....................',
        '............................'
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

    // 翼龙两帧（23×20 格 = 69×60px，1 格 = 2 原版 px，渲染 1.5 倍原版尺寸）：
    // 从原版 2x 精灵表 PTERODACTYL 块（hdpi x260/y2，帧宽 92@2x）逐格提取，
    // 形态：水平身体 + 右侧张嘴双颚（row10 上颚长、row12 下颚短）+ 左上小冠；
    // 帧差异在翅膀——帧1 翼朝下（身下三角渐收 rows12-18），帧2 翼朝上
    // （身上竖立大翼 rows1-7），167ms 交替即原版扇翅节奏
    var BIRD_WING_DOWN = [
        '.......................',
        '.......................',
        '.......................',
        '.......................',
        '.....##................',
        '....###................',
        '...#####...............',
        '..######...............',
        '.##############........',
        '.......#########.......',
        '........##############.',
        '.........##########....',
        '.........############..',
        '.........#########.....',
        '.........####..........',
        '.........###...........',
        '.........##............',
        '.........##............',
        '.........#.............',
        '.......................'
    ];
    var BIRD_WING_UP = [
        '.......................',
        '........#..............',
        '........##.............',
        '........###............',
        '.....##..###...........',
        '....###..####..........',
        '...#####.#####.........',
        '..######.######........',
        '.##############........',
        '.......#########.......',
        '........##############.',
        '.........##########....',
        '..........###########..',
        '...........#######.....',
        '.......................',
        '.......................',
        '.......................',
        '.......................',
        '.......................',
        '.......................'
    ];

    // 翼龙碰撞盒（原版 5 盒按 1.5 倍缩放，1x 原值 [{15,15,16,5},{18,21,24,6},
    // {2,14,4,3},{6,10,4,7},{10,8,6,9}]）：覆盖喙/身/翼根，两帧共用；
    // 翼尖与身体下方镂空区不入盒（原版即如此），跨翼龙判定不过严
    var BIRD_BOXES = [
        { x: 22, y: 22, w: 24, h: 8 },
        { x: 27, y: 32, w: 36, h: 9 },
        { x: 3, y: 21, w: 6, h: 5 },
        { x: 9, y: 15, w: 6, h: 10 },
        { x: 15, y: 12, w: 9, h: 14 }
    ];

    var DINO_W = 22 * CONFIG.PIX;  // 66
    var DINO_H = 23 * CONFIG.PIX;  // 69（身体 18 行 + 腿 5 行，脚底精确着地）
    var DINO_DUCK_W = 28 * CONFIG.PIX; // 84
    var DINO_DUCK_H = 13 * CONFIG.PIX; // 39

    /* ==================== 音效（公共 WebAudio 模块） ==================== */

    var SoundFx = {
        jump:  function () { FleaSound.jump(); },
        point: function () { FleaSound.point(); },
        die:   function () { FleaSound.die(); }
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
        this.soundBtn = document.getElementById('sound-button');
        this.difficultySelect = document.getElementById('difficulty-select');
        this.boardContainer = document.querySelector('.game-board-container');

        this.difficulty = DinoStorage.getDifficulty();
        this.speedCfg = CONFIG.DIFFICULTY[this.difficulty];

        this.state = 'ready'; // ready | running | paused | over
        this.soundOn = DinoStorage.isSoundOn();
        FleaSound.setEnabled(this.soundOn);

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
        // 逻辑高度固定 220，按容器高度缩放——内容撑满画面（手机端恐龙/障碍更大）；
        // 代价是视野（可见逻辑宽）变窄：viewW = 容器宽 ÷ 缩放比，手机约 493（PC 760）
        var scale = (rect.height / CONFIG.HEIGHT) * dpr;
        this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
        this.viewW = rect.width / (rect.height / CONFIG.HEIGHT);
    };

    DinoGame.prototype.reset = function () {
        this.speed = this.speedCfg.start;
        this.distance = 0;
        this.score = 0;
        this.lastScoreMilestone = 0;

        this.dino = {
            // 贴左站位：PC 宽视口（76:22，viewW≈760）保持 60 与原版一致；
            // 手机窄视口（76:34，viewW≈492）内容放大后同比例显远，收紧到 3%（约 15）
            x: this.viewW >= 700 ? 60 : Math.round(this.viewW * 0.03),
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

        // 触屏适配：body 打标记（按钮显隐由 CSS .is-touch 驱动），
        // 操作说明按输入能力切换（JS 判定，替代兼容性不稳的 CSS media query）
        if (IS_TOUCH) {
            document.body.classList.add('is-touch');
            var kb = document.querySelector('.help-keyboard');
            var tc = document.querySelector('.help-touch');
            if (kb) kb.style.display = 'none';
            if (tc) tc.style.display = 'block';
            // 触控区（fixed 覆盖层）top = 控制行底部：上方主体保持垂直居中，
            // 条通栏盖住控制行以下全部空白；视口/布局变化时重测
            self.syncTouchZoneTop();
            window.addEventListener('resize', function () { self.syncTouchZoneTop(); });
            window.addEventListener('orientationchange', function () {
                setTimeout(function () { self.syncTouchZoneTop(); }, 300);
            });
            if (typeof ResizeObserver !== 'undefined') {
                var ro2 = new ResizeObserver(function () { self.syncTouchZoneTop(); });
                var controlsEl = document.querySelector('.game-controls');
                if (controlsEl) ro2.observe(controlsEl);
            }
        }

        document.addEventListener('keydown', function (e) { self.onKeyDown(e); });
        document.addEventListener('keyup', function (e) { self.onKeyUp(e); });

        this.startBtn.addEventListener('click', function () { self.onStartButton(); });
        this.restartBtn.addEventListener('click', function () { self.restart(); });

        this.difficultySelect.addEventListener('change', function (e) {
            self.setDifficulty(e.target.value);
        });

        this.soundBtn.addEventListener('click', function () { self.toggleSound(); });
        this.updateSoundIcon();

        // 画布触摸：点击 = 开始 / 跳跃 / 重来（触屏蹲伏走下方左右分区触控条）
        this.canvas.addEventListener('touchstart', function (e) {
            e.preventDefault();
            self.onJumpInput();
        }, { passive: false });

        // 触控分区条（移动端主控，原按钮位置）：左「跳」= 开始/跳跃/重来，右「蹲」= 按住蹲伏
        this.touchJump = document.getElementById('touch-jump');
        this.touchDuck = document.getElementById('touch-duck');
        if (this.touchJump && this.touchDuck) {
            this.touchJump.addEventListener('touchstart', function (e) {
                e.preventDefault();
                self.onJumpInput();
                self.setZonePressed(self.touchJump, true);
            }, { passive: false });
            this.touchJump.addEventListener('touchend', function () {
                self.setZonePressed(self.touchJump, false);
            });
            this.touchJump.addEventListener('touchcancel', function () {
                self.setZonePressed(self.touchJump, false);
            });
            this.touchDuck.addEventListener('touchstart', function (e) {
                e.preventDefault();
                self.duckHeld = true;
                self.setDucking(true);
                self.setZonePressed(self.touchDuck, true);
            }, { passive: false });
            this.touchDuck.addEventListener('touchend', function (e) {
                e.preventDefault();
                self.duckHeld = false;
                self.setDucking(false);
                self.setZonePressed(self.touchDuck, false);
            }, { passive: false });
            this.touchDuck.addEventListener('touchcancel', function () {
                self.duckHeld = false;
                self.setDucking(false);
                self.setZonePressed(self.touchDuck, false);
            });
        }

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

    // 触控区覆盖层定位：top = 控制行底部 + 10px 间距（主体垂直居中不受影响，
    // 条盖住下方空白，与上方控制行拉开距离更协调）
    // 触控区按压视觉态：移动端 :active 被 touchstart 的 preventDefault 抑制，改 JS 加类驱动
    DinoGame.prototype.setZonePressed = function (el, on) {
        if (el) el.classList.toggle('is-pressed', on);
    };

    DinoGame.prototype.syncTouchZoneTop = function () {
        var controls = document.querySelector('.game-controls');
        if (!controls) return;
        var bottom = controls.getBoundingClientRect().bottom;
        document.body.style.setProperty('--touch-zone-top', Math.round(bottom + 10) + 'px');
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
        FleaSound.setEnabled(this.soundOn);
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
        if (this.birdFrameTime >= 167) { this.birdFrameTime = 0; this.birdFrame = this.birdFrame ? 0 : 1; }

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
            // 翼龙：低（跳）/ 中（蹲或跳）/ 高（站立可无视）。
            // 三档高度按原版 yPos [100,75,50] 相对地面线的偏移（-31.3/-56.3/-81.3 @1x）
            // 1.5 倍映射 → -47/-85/-122；低档翼身嵌入地面线下 13px（原版即如此）
            var heights = [GROUND_Y - 47, GROUND_Y - 85, GROUND_Y - 122];
            ob = {
                type: 'bird',
                x: this.viewW + 10,
                y: heights[Math.random() * 3 | 0],
                w: 69,
                h: 60
            };
        }
        this.obstacles.push(ob);

        // 间距：随速度与障碍实际宽度线性放大（原版 GAP_COEFFICIENT 规则）
        var gap = (ob.w * this.speed + CONFIG.BASE_GAP * CONFIG.GAP_COEFFICIENT) * rand(1, 1.5);
        this.spawnTimer = gap / this.speed * 16.667;
    };

    // 生成仙人掌簇：1~3 株大小随机混合（对标原版高矮错落，如一大两小），
    // 逐株底部对齐着地、紧贴无隙；低速时全小株，速度超门槛后大株按概率入簇；
    // 三株簇限一大（三株全大株时墙体过宽，起跳窗口不足，形同必死）；
    // 低速（< WIDE_CLUSTER_SPEED）簇限两株：滞空帧数固定，跳跃水平覆盖随速度缩短，
    // 低速下三连簇起跳窗口过窄，稍跳早即落回簇尾
    DinoGame.prototype.spawnCactus = function () {
        var maxLen = this.speed < CONFIG.WIDE_CLUSTER_SPEED
            ? CONFIG.MAX_OBSTACLE_LENGTH - 1 : CONFIG.MAX_OBSTACLE_LENGTH;
        var count = 1 + (Math.random() * maxLen | 0);
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
        return { type: 'cactus', parts: parts, x: this.viewW + 10, y: GROUND_Y - maxH, w: totalW, h: maxH };
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
            // 右缘 d.x+90 = 身体视觉轮廓右缘 84（28 列矩阵最右 col27）+ 6
            // （障碍盒内缩 3 + 半帧位移 3），判死帧视觉 ±3px 对齐，与站立盒同约定
            boxes = [{ x: d.x + 6, y: this.duckTop() + 3, w: DINO_DUCK_W, h: DINO_DUCK_H - 6 }];
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
                // 翼龙：原版 5 盒按 1.5 倍缩放（见 BIRD_BOXES 定义处），帧内相对坐标
                obBoxes = BIRD_BOXES.map(function (b) {
                    return { x: ob.x + b.x, y: ob.y + b.y, w: b.w, h: b.h };
                });
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
            this.clouds.push({ x: this.viewW + rand(0, 200), y: rand(24, 90) });
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

        // 背景（铺满可见视野）
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, this.viewW, CONFIG.HEIGHT);

        // 月亮与星星（夜晚）
        if (this.isNight) {
            ctx.fillStyle = fg;
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            ctx.arc(this.viewW - 100, 48, 16, 0, Math.PI * 2);
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
        ctx.fillRect(0, GROUND_Y, this.viewW, 2);
        // 地面滚动石子
        for (var g = -this.groundOffset; g < this.viewW; g += 24) {
            ctx.globalAlpha = 0.5;
            ctx.fillRect(g, GROUND_Y + 8, 6, 2);
            ctx.fillRect(g + 12, GROUND_Y + 14, 4, 2);
            ctx.globalAlpha = 1;
        }

        // 障碍
        for (var o = 0; o < this.obstacles.length; o++) {
            var ob = this.obstacles[o];
            if (ob.type === 'bird') {
                drawMatrix(ctx, this.birdFrame ? BIRD_WING_UP : BIRD_WING_DOWN, ob.x, ob.y, CONFIG.PIX, fg);
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
            this.drawOverlay(ctx, '已暂停', IS_TOUCH ? '点击画面或跳继续' : '按 P 或点击开始继续', fg);
        }
        // 结束遮罩
        if (this.state === 'over') {
            this.drawOverlay(ctx, '游戏结束', '得分 ' + pad5(this.score) + (IS_TOUCH ? ' · 点击画面或跳重来' : ' · 按空格重来'), fg);
        }
        // 待开始提示
        if (this.state === 'ready') {
            ctx.fillStyle = fg;
            ctx.globalAlpha = 0.65;
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(IS_TOUCH ? '点击「跳」或画面开始' : '按 空格 / 点击画面 开始', this.viewW / 2, 64);
            ctx.globalAlpha = 1;
        }
    };

    DinoGame.prototype.drawDino = function (ctx, fg, bg) {
        var d = this.dino;
        // 蹲伏造型（仅着地状态）：身体 + 腿部两帧交替（一上一下）
        if (d.ducking) {
            drawMatrix(ctx, DINO_DUCK, d.x, this.duckTop(), CONFIG.PIX, fg, bg);
            var duckLegs = (d.dead || this.state === 'ready') ? DINO_DUCK_LEGS_A
                : (this.runFrame ? DINO_DUCK_LEGS_B : DINO_DUCK_LEGS_A);
            drawMatrix(ctx, duckLegs, d.x, this.duckTop() + 9 * CONFIG.PIX, CONFIG.PIX, fg, bg);
            return;
        }
        var top = d.jumping ? d.y : GROUND_Y - DINO_H;
        var body = DINO_BODY.slice();
        // 眨眼：闭眼——仅把眼孔（col13）填成实心，头轮廓（col14-20）保持不变；
        // 旧写法把整行截到 col17，眨眼瞬间吻部右缘缺 3 格，观感像轮廓弹出一条线
        if (this.isBlinking && !d.dead) {
            body[2] = '...........##########.';
        }
        // 死亡脸（逐格复刻原版 CRASHED 帧，无自创元素）：
        // 活体单格眼睁大为 2×2 方孔（rows2-3 × cols13-14），下颚前伸满宽（row6，
        // 原版开口是下颚向右补满，不是嘴缝）
        if (d.dead) {
            body[2] = '...........##..######.';
            body[3] = '...........##..######.';
            body[6] = '...........##########.';
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
        ctx.fillRect(0, 0, this.viewW, CONFIG.HEIGHT);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 26px Arial';
        ctx.fillText(title, this.viewW / 2, CONFIG.HEIGHT / 2 - 14);
        ctx.font = '16px Arial';
        ctx.fillText(subtitle, this.viewW / 2, CONFIG.HEIGHT / 2 + 20);
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

    /* ==================== 手机端标题联动与画布精确居中 ==================== */
    /* max-width:600px 断点下标题为 fixed 定位（脱流），无法随分数卡自动移动：
       这里实测分数卡 top，把标题垂直居中于「浮动按钮行底沿 ～ 分数卡顶沿」的
       顶部空间内，任何屏高、字号断点下都刚性跟随；空间不足时贴分数卡（保底间距）。
       同时修正画布垂直居中偏差：header（分数卡）与控制行高度不等，容器弹性空间
       均分时画布中心偏离屏幕中心 (headerH - controlsH) / 2，实测后把偏差从
       上侧 margin 挪到下侧（元素位置关系与原布局完全一致，仅画布回正）。
       注意：画布偏置会移动分数卡，标题定位必须在其之后测量。
       PC 与横屏矮屏（标题为 static）清除偏置后跳过，走 CSS 均分 */

    var TITLE_MIN_GAP = 8;

    function syncTitleToScores() {
        var h1 = document.querySelector('.game-header h1');
        var scores = document.querySelector('.scores-container');
        var header = document.querySelector('.game-header');
        var controls = document.querySelector('.game-controls');
        if (!h1 || !scores || !header || !controls) return;
        if (window.getComputedStyle(h1).position !== 'fixed') {
            // 非 fixed 断点（PC/横屏矮屏）：清除手机端写入的 margin 偏置，回归 CSS 均分
            header.style.marginTop = '';
            controls.style.marginBottom = '';
            return;
        }

        // 画布居中偏置：按实测高度重分上下弹性空间（偏置 = (headerH - controlsH) / 2）
        var board = document.querySelector('.game-board-container');
        var container = document.querySelector('.game-container');
        if (board && container) {
            var cs = getComputedStyle(container);
            var pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
            var gap = parseFloat(cs.rowGap) || 0;
            var free = container.clientHeight - pad - header.offsetHeight -
                       board.offsetHeight - controls.offsetHeight - gap * 2;
            if (free > 0) { // 内容超高（极端矮屏）时交还 CSS 均分，允许滚动
                var bias = (header.offsetHeight - controls.offsetHeight) / 2;
                var mt = Math.max(0, free / 2 - bias);
                header.style.marginTop = mt + 'px';
                controls.style.marginBottom = (free - mt) + 'px'; // 差值全给下侧，总和恰为 free
            } else {
                header.style.marginTop = '';
                controls.style.marginBottom = '';
            }
        }

        // 标题居中：顶部空间 = 浮动按钮行底沿（实测各控制按钮最大 bottom，兜底 54）
        // ～ 分数卡顶沿；标题在该空间内垂直居中，空间不足时贴分数卡（保底间距 8px）
        var st = scores.getBoundingClientRect().top;
        var h = h1.offsetHeight;
        var btnBottom = 54;
        var btns = document.querySelectorAll('.control-button');
        for (var i = 0; i < btns.length; i++) {
            var b = btns[i].getBoundingClientRect().bottom;
            if (b > btnBottom) btnBottom = b;
        }
        var top = btnBottom + Math.max(0, (st - btnBottom - h) / 2);
        if (top + h > st - TITLE_MIN_GAP) top = st - h - TITLE_MIN_GAP;
        h1.style.top = top + 'px';
    }

    /* ==================== 启动 ==================== */
    /* 调试/测试句柄：便于自动化脚本精确断言内部状态（夜晚、碰撞、分数等） */

    function boot() {
        window.__dinoGame = new DinoGame();
        syncTitleToScores();
        requestAnimationFrame(syncTitleToScores); // 布局稳定后再校准一次
        window.addEventListener('resize', syncTitleToScores);
        window.addEventListener('orientationchange', syncTitleToScores);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
