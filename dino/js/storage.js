/**
 * 恐龙快跑 - 本地存储模块
 * 最高分按难度分 key 记录；难度、音效开关持久化。
 */
window.DinoStorage = (function () {
    'use strict';

    var PREFIX = 'dino_';

    function get(key) {
        try { return localStorage.getItem(PREFIX + key); } catch (e) { return null; }
    }

    function set(key, value) {
        try { localStorage.setItem(PREFIX + key, String(value)); } catch (e) { /* 忽略存储失败 */ }
    }

    return {
        BEST_PREFIX: PREFIX + 'best_',

        getBestScore: function (difficulty) {
            return parseInt(get('best_' + difficulty), 10) || 0;
        },

        saveBestScore: function (score, difficulty) {
            set('best_' + difficulty, score);
        },

        getDifficulty: function () {
            var d = get('difficulty');
            return (d === 'easy' || d === 'normal' || d === 'hard') ? d : 'normal';
        },

        saveDifficulty: function (difficulty) {
            set('difficulty', difficulty);
        },

        isSoundOn: function () {
            var v = get('sound');
            return v === null ? true : v === '1';
        },

        saveSound: function (on) {
            set('sound', on ? '1' : '0');
        }
    };
})();
