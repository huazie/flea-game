/**
 * FleaSound - WebAudio 合成音效公共模块（零文件依赖）
 *
 * 从恐龙快跑的 SoundFx 抽取：AudioContext 懒初始化（suspended 时自动 resume），
 * tone() 波形合成。各游戏引入本文件后直接调用预设音效即可。
 *
 * 用法：
 *   FleaSound.init('match3_sound');  // 可选：传入 localStorage key 持久化开关状态
 *   FleaSound.pop(5);                // 播放预设音效
 *   FleaSound.toggle();              // 切换开关（有 storageKey 时自动持久化），返回新状态
 */
window.FleaSound = (function () {
    'use strict';

    var ctx = null;
    var enabled = true;         // 音效（SFX）开关
    var bgmEnabled = true;      // 背景音乐开关（与音效相互独立）
    var storageKey = null;
    var bgmStorageKey = null;

    /** 创建/恢复 AudioContext（不检查开关，由调用方按各自开关决定是否发声） */
    function ensureCtx() {
        if (!ctx) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            try { ctx = new AC(); } catch (e) { return false; }
        }
        if (ctx.state === 'suspended') {
            ctx.resume().catch(function () { /* 用户手势前可能失败 */ });
        }
        return true;
    }

    /** 合成一个音调：freq 起始频率(Hz)，dur 时长(s)，type 波形，delay 相对延迟(s)，
     *  vol 音量(0~1)，endFreq 结束频率（滑音，可选） */
    function tone(freq, dur, type, delay, vol, endFreq) {
        if (!enabled || !ensureCtx()) return;
        var t = ctx.currentTime + (delay || 0);
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = type || 'square';
        osc.frequency.setValueAtTime(freq, t);
        if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, t + dur);
        gain.gain.setValueAtTime(vol || 0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
    }

    function persist(on) {
        if (!storageKey) return;
        try { localStorage.setItem(storageKey, on ? '1' : '0'); } catch (e) { /* 忽略 */ }
    }

    function persistBgm(on) {
        if (!bgmStorageKey) return;
        try { localStorage.setItem(bgmStorageKey, on ? '1' : '0'); } catch (e) { /* 忽略 */ }
    }

    // ── 消消乐预设 ──────────────────────────────────────────────

    /** 消除气泡音：短促上滑正弦，count 越大音高越高（一次消除越多越"爽"） */
    function pop(count) {
        var base = 380 + Math.max(0, Math.min((count || 3) - 3, 8)) * 30;
        tone(base, 0.09, 'sine', 0, 0.14, base * 2.2);
    }

    /** 连锁上行音：第 n 级连锁沿五声音阶上行（主流三消的连锁听感） */
    var COMBO_SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51]; // C5→E6
    function combo(n) {
        var i = Math.min(Math.max(n, 1), COMBO_SCALE.length) - 1;
        var f = COMBO_SCALE[i];
        tone(f, 0.14, 'triangle', 0, 0.13);
        tone(f * 1.5, 0.16, 'triangle', 0.05, 0.07);  // 纯五度泛音提亮
    }

    /** 特殊宝石生成/触发：闪亮上滑音 */
    function special() {
        tone(660, 0.16, 'triangle', 0, 0.10, 1560);
    }

    /** 交换：轻微短促"啵" */
    function swap() {
        tone(300, 0.05, 'sine', 0, 0.07, 420);
    }

    /** 无效操作：低频短促错误音 */
    function invalid() {
        tone(170, 0.12, 'square', 0, 0.09, 110);
    }

    /** 过关：上行琶音 */
    function win() {
        tone(523.25, 0.12, 'triangle', 0,    0.12);
        tone(659.25, 0.12, 'triangle', 0.12, 0.12);
        tone(783.99, 0.12, 'triangle', 0.24, 0.12);
        tone(1046.5, 0.24, 'triangle', 0.36, 0.14);
    }

    /** 失败：下行音 */
    function lose() {
        tone(392, 0.20, 'sawtooth', 0,    0.10, 300);
        tone(300, 0.30, 'sawtooth', 0.18, 0.10, 150);
    }

    // ── 恐龙快跑预设（音色参数与原 SoundFx 完全一致）──────────

    function jump()  { tone(560, 0.09, 'square', 0, 0.10); }
    function point() {
        tone(880, 0.06, 'square', 0,    0.09);
        tone(880, 0.06, 'square', 0.09, 0.09);
    }
    function die()   { tone(320, 0.3, 'sawtooth', 0, 0.12, 70); }

    // ── 俄罗斯方块预设 ──────────────────────────────────────────

    /** 移动：轻微短促"嗒"（长按连发时可接受的高频重复音） */
    function move()   { tone(200, 0.04, 'square', 0, 0.05); }

    /** 旋转：短促上滑"啾" */
    function rotate() { tone(320, 0.06, 'square', 0, 0.07, 480); }

    /** 方块锁定：低频闷响"咚" */
    function lock()   { tone(150, 0.08, 'square', 0, 0.12, 90); }

    /** 硬降：快速下滑音 */
    function drop()   { tone(600, 0.10, 'square', 0, 0.10, 120); }

    /** 消行：1~3 行上行双音，4 行（Tetris!）播放辉煌琶音 */
    function clear(n) {
        if ((n || 1) >= 4) {
            tone(523.25, 0.10, 'square', 0,    0.10);
            tone(659.25, 0.10, 'square', 0.08, 0.10);
            tone(783.99, 0.10, 'square', 0.16, 0.10);
            tone(1046.5, 0.22, 'square', 0.24, 0.12);
        } else {
            var base = 420 + (n - 1) * 120;
            tone(base, 0.08, 'square', 0,    0.10);
            tone(base * 1.5, 0.12, 'square', 0.06, 0.09);
        }
    }

    /** 升级：四音上行号角 */
    function levelUp() {
        tone(440,    0.10, 'triangle', 0,    0.11);
        tone(554.37, 0.10, 'triangle', 0.09, 0.11);
        tone(659.25, 0.10, 'triangle', 0.18, 0.11);
        tone(880,    0.20, 'triangle', 0.27, 0.12);
    }

    // ── 2048 预设 ──────────────────────────────────────────────

    /** 滑动：轻柔"唰"声下滑音（方块整体平移的听感） */
    function slide() { tone(240, 0.07, 'sine', 0, 0.06, 160); }

    /** 合并：value 越大音高越高（4→2048 每级升一个全音），主音+纯五度泛音清脆"叮" */
    function merge(value) {
        var step = Math.max(1, Math.min(Math.log2(value || 4) - 1, 10));
        var f = 392 * Math.pow(1.122462, step);
        tone(f, 0.10, 'triangle', 0, 0.12);
        tone(f * 1.5, 0.12, 'triangle', 0.05, 0.07);
    }

    // ── 背景音乐序列器：按 [频率Hz|null(休止), 拍数] 序列循环播放 ──

    var bgm = {
        _timer: null,
        _gen: 0,        // 代际号：stop 后旧调度链失效
        _playing: false,
        _nodes: []      // 已排程音符 {osc, gain, end}：stop 时立即静音截断
    };

    function bgmStop() {
        bgm._gen++;
        bgm._playing = false;
        if (bgm._timer) { clearTimeout(bgm._timer); bgm._timer = null; }
        var nodes = bgm._nodes;
        bgm._nodes = [];
        if (!ctx || !nodes.length) return;
        var now = ctx.currentTime;
        nodes.forEach(function (nd) {
            try {
                /* 30ms 快速淡出截断（整轮旋律已提前排进 AudioContext，
                 * 不截断会播完当前整段才停），淡出避免硬切产生咔哒声 */
                nd.gain.gain.cancelScheduledValues(now);
                nd.gain.gain.setValueAtTime(Math.max(nd.gain.gain.value, 0.0001), now);
                nd.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
                nd.osc.stop(now + 0.05);
            } catch (e) { /* 节点已自然结束 */ }
        });
    }

    function bgmStart(notes, opts) {
        if (!bgmEnabled || !notes || !notes.length || !ensureCtx()) return;
        bgmStop();
        var o = opts || {};
        var beat = o.beat || 0.3;       // 一拍时长(s)
        var vol = o.vol || 0.05;        // BGM 音量远低于音效
        var type = o.type || 'triangle';
        var gen = ++bgm._gen;
        bgm._playing = true;

        var nextT = ctx.currentTime + 0.05;   // 绝对时间调度，循环无漂移

        function schedulePass() {
            if (gen !== bgm._gen) return;     // 已被 stop() 取消
            if (!ensureCtx()) { bgm._playing = false; return; }
            // 清理已播完的节点，防止长时间循环播放累积
            bgm._nodes = bgm._nodes.filter(function (nd) { return nd.end > ctx.currentTime; });
            var t = nextT;
            notes.forEach(function (n) {
                var dur = n[1] * beat;
                if (n[0]) {
                    var osc = ctx.createOscillator();
                    var gain = ctx.createGain();
                    osc.type = type;
                    osc.frequency.setValueAtTime(n[0], t);
                    gain.gain.setValueAtTime(0.0001, t);
                    gain.gain.linearRampToValueAtTime(vol, t + 0.02);
                    gain.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.92);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(t);
                    osc.stop(t + dur + 0.02);
                    bgm._nodes.push({ osc: osc, gain: gain, end: t + dur + 0.02 });
                }
                t += dur;
            });
            nextT = t;
            // 提前 150ms 排下一轮，保证衔接无缝
            bgm._timer = setTimeout(schedulePass,
                Math.max(100, (nextT - ctx.currentTime - 0.15) * 1000));
        }
        schedulePass();
    }

    return {
        /** 初始化：传入 localStorage key 则读取并持久化开关状态；
         *  第二个参数为背景音乐独立的 storage key（可选，不传则 BGM 状态不持久化） */
        init: function (key, musicKey) {
            storageKey = key || null;
            bgmStorageKey = musicKey || null;
            try {
                if (storageKey) {
                    var v = localStorage.getItem(storageKey);
                    enabled = v === null ? true : v === '1';
                }
                if (bgmStorageKey) {
                    var m = localStorage.getItem(bgmStorageKey);
                    bgmEnabled = m === null ? true : m === '1';
                }
            } catch (e) { /* 忽略 */ }
        },
        setEnabled: function (on) {
            enabled = !!on; persist(enabled);
        },
        toggle: function () {
            enabled = !enabled; persist(enabled);
            return enabled;
        },
        isEnabled: function () { return enabled; },

        /** 背景音乐开关（独立于音效） */
        setBgmEnabled: function (on) {
            bgmEnabled = !!on; persistBgm(bgmEnabled);
            if (!bgmEnabled) bgmStop();
        },
        toggleBgm: function () {
            bgmEnabled = !bgmEnabled; persistBgm(bgmEnabled);
            if (!bgmEnabled) bgmStop();
            return bgmEnabled;
        },
        isBgmEnabled: function () { return bgmEnabled; },

        /** 背景音乐：start(音符序列, 选项) 循环播放；stop() 停止；isPlaying() 查询 */
        bgm: {
            start: bgmStart,
            stop: bgmStop,
            isPlaying: function () { return bgm._playing; }
        },

        tone: tone,
        pop: pop, combo: combo, special: special,
        swap: swap, invalid: invalid, win: win, lose: lose,
        jump: jump, point: point, die: die,
        move: move, rotate: rotate, lock: lock, drop: drop,
        clear: clear, levelUp: levelUp,
        slide: slide, merge: merge
    };
})();
