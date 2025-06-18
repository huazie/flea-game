// 处理游戏数据的本地存储
class GameStorage {
    static BEST_SCORE_KEY = 'max_score';

    static getBestScore() {
        return parseInt(localStorage.getItem(this.BEST_SCORE_KEY)) || 0;
    }

    static saveBestScore(score) {
        localStorage.setItem(this.BEST_SCORE_KEY, score.toString());
    }

    static clearBestScore() {
        localStorage.removeItem(this.BEST_SCORE_KEY);
    }
}

export default GameStorage;