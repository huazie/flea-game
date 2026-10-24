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
    var enabled = true;
    var storageKey = null;

    function ensureCtx() {
        if (!enabled) return false;
        if (!ctx) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) { enabled = false; return false; }
            try { ctx = new AC(); } catch (e) { enabled = false; return false; }
        }
        if (ctx.state === 'suspended') {
            ctx.resume().catch(function () { /* 用户手势前可能失败 */ });
        }
        return true;
    }

    /** 合成一个音调：freq 起始频率(Hz)，dur 时长(s)，type 波形，delay 相对延迟(s)，
     *  vol 音量(0~1)，endFreq 结束频率（滑音，可选） */
    function tone(freq, dur, type, delay, vol, endFreq) {
        if (!ensureCtx()) return;
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

    return {
        /** 初始化：传入 localStorage key 则读取并持久化开关状态 */
        init: function (key) {
            storageKey = key || null;
            if (storageKey) {
                try {
                    var v = localStorage.getItem(storageKey);
                    enabled = v === null ? true : v === '1';
                } catch (e) { /* 忽略 */ }
            }
        },
        setEnabled: function (on) { enabled = !!on; persist(enabled); },
        toggle: function () { enabled = !enabled; persist(enabled); return enabled; },
        isEnabled: function () { return enabled; },

        tone: tone,
        pop: pop, combo: combo, special: special,
        swap: swap, invalid: invalid, win: win, lose: lose,
        jump: jump, point: point, die: die
    };
})();
