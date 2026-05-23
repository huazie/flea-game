/**
 * GameStorage - 消消乐游戏存档管理
 * 与 game.js 中的 key 名称保持一致
 */
class GameStorage {
    static KEY_GAME   = 'match3_game';
    static KEY_BEST   = 'match3_best';
    static KEY_LEVEL  = 'match3_level';
    static KEY_THEME  = 'match3_theme';

    static saveGame(state) {
        try {
            localStorage.setItem(this.KEY_GAME, JSON.stringify(state));
        } catch (e) {
            console.warn('存档失败', e);
        }
    }

    static loadGame() {
        try {
            const d = localStorage.getItem(this.KEY_GAME);
            return d ? JSON.parse(d) : null;
        } catch (e) {
            return null;
        }
    }

    static clearGame() {
        localStorage.removeItem(this.KEY_GAME);
    }

    static saveBest(score) {
        const cur = this.getBest();
        if (score > cur) localStorage.setItem(this.KEY_BEST, score);
    }

    static getBest() {
        return parseInt(localStorage.getItem(this.KEY_BEST) || '0', 10);
    }

    static saveLevel(n) {
        localStorage.setItem(this.KEY_LEVEL, n);
    }

    static getLevel() {
        return parseInt(localStorage.getItem(this.KEY_LEVEL) || '1', 10);
    }
}
