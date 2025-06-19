// 处理游戏数据的本地存储
class GameStorage {
    static BEST_SCORE_KEY = 'max_score';
    static DIFFICULTY_KEY = 'snake_difficulty';

    static getBestScore() {
        return parseInt(localStorage.getItem(this.BEST_SCORE_KEY)) || 0;
    }

    static saveBestScore(score) {
        localStorage.setItem(this.BEST_SCORE_KEY, score.toString());
    }

    static clearBestScore() {
        localStorage.removeItem(this.BEST_SCORE_KEY);
    }

    static getDifficulty() {
        return localStorage.getItem(this.DIFFICULTY_KEY) || 'normal';
    }

    static saveDifficulty(difficulty) {
        localStorage.setItem(this.DIFFICULTY_KEY, difficulty);
    }
}

export default GameStorage;