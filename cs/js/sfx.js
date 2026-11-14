/* 反恐突袭 - 独立 WebAudio 小合成器（design-brief 11.5）
 * 本文件不依赖、不修改 assets/js/sound.js 等公共模块；无 AudioContext 时全部静默降级。
 * 映射：射击=噪声脉冲+低频冲击｜空仓=短方波 click｜换弹=两段咔哒｜脚步=低通噪声 2.2Hz｜
 * 跳=短上滑音｜落地=低频砰（音量按落速）｜命中墙=高频短噪声｜命中 Bot=中频闷响｜受击=低鸣。
 * AudioContext 首次手势后 resume；音色参数只在调用时分配（事件驱动，非逐帧热路径）。 */
(function (global) {
    'use strict';
    var CS = global.CS || (global.CS = {});

    var ac = null, master = null, noiseBuf = null;
    var muted = false, VOL = 0.5;

    function init() {
        if (ac || muted === null) return;
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;
        try { ac = new AC(); } catch (e) { return; }
        master = ac.createGain();
        master.gain.value = muted ? 0 : VOL;
        master.connect(ac.destination);
        var len = ac.sampleRate | 0;                 // 1s 白噪声缓冲，init 生成一次
        noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }

    function resume() {
        init();
        if (ac && ac.state === 'suspended' && ac.resume) ac.resume();
    }

    function tone(freq, dur, type, vol, slideTo, delay) {
        if (!ac || muted) return;
        var t = ac.currentTime + (delay || 0);
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + dur + 0.02);
    }

    function noise(dur, vol, freq, type, delay) {
        if (!ac || muted) return;
        var t = ac.currentTime + (delay || 0);
        var src = ac.createBufferSource();
        src.buffer = noiseBuf;
        var f = ac.createBiquadFilter();
        f.type = type || 'lowpass';
        f.frequency.value = freq;
        var g = ac.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(f); f.connect(g); g.connect(master);
        src.start(t); src.stop(t + dur + 0.02);
    }

    CS.Sfx = {
        /* 兼容 v1 惯例：init 在模块加载后由游戏显式调用一次（首次手势链路里 resume） */
        init: function () { resume(); },
        resume: resume,
        shoot: function () { noise(0.09, 0.5, 900, 'lowpass'); tone(150, 0.12, 'triangle', 0.4, 55); },
        empty: function () { tone(1300, 0.03, 'square', 0.14); },
        reload: function () { tone(520, 0.03, 'square', 0.18); tone(760, 0.03, 'square', 0.18, 0, 0.12); },
        reloadDone: function () { tone(880, 0.05, 'square', 0.2); tone(1320, 0.06, 'square', 0.16, 0, 0.07); },
        footstep: function () { noise(0.08, 0.12, 420, 'lowpass'); },
        jump: function () { tone(300, 0.12, 'sine', 0.2, 520); },
        land: function (v) {
            var s = typeof v === 'number' ? v : 4;
            var vol = 0.1 + Math.min(0.4, s / 12);      // 音量按落速
            tone(85, 0.12, 'sine', vol, 50); noise(0.06, vol * 0.6, 300, 'lowpass');
        },
        hitWall: function () { noise(0.05, 0.3, 3200, 'highpass'); },
        hitBot: function () { tone(230, 0.09, 'triangle', 0.35, 110); },
        kill: function () { tone(660, 0.08, 'square', 0.2); tone(990, 0.12, 'square', 0.2, 0, 0.08); },
        hurt: function () { tone(110, 0.26, 'sawtooth', 0.24, 70); },
        botFire: function () { noise(0.06, 0.24, 700, 'lowpass'); },
        view: function () { tone(660, 0.05, 'sine', 0.16, 880); },
        wave: function () { tone(520, 0.09, 'sine', 0.2); tone(780, 0.12, 'sine', 0.2, 0, 0.1); },
        win: function () { tone(523, 0.14, 'sine', 0.24); tone(659, 0.14, 'sine', 0.24, 0, 0.14); tone(784, 0.22, 'sine', 0.24, 0, 0.28); },
        lose: function () { tone(330, 0.2, 'sine', 0.24, 220); tone(196, 0.3, 'sine', 0.24, 120, 0.2); },
        toggle: function () {
            muted = !muted;
            if (master) master.gain.value = muted ? 0 : VOL;
            return !muted;
        },
        isEnabled: function () { return !muted; }
    };
})(window);
