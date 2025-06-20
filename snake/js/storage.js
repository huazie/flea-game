// 处理游戏数据的本地存储
class GameStorage {
    static BEST_SCORE_PREFIX = 'snake_best_score_';
    static DIFFICULTY_KEY = 'snake_difficulty';

    static getBestScoreKey(difficulty) {
        return this.BEST_SCORE_PREFIX + difficulty;
    }

    static getBestScore(difficulty) {
        const key = this.getBestScoreKey(difficulty);
        return parseInt(localStorage.getItem(key)) || 0;
    }

    static saveBestScore(score, difficulty) {
        const key = this.getBestScoreKey(difficulty);
        localStorage.setItem(key, score.toString());
    }

    static clearBestScore(difficulty) {
        if (difficulty) {
            // 清除指定难度的最高分
            const key = this.getBestScoreKey(difficulty);
            localStorage.removeItem(key);
        } else {
            // 清除所有难度的最高分
            ['easy', 'normal', 'hard', 'expert'].forEach(diff => {
                const key = this.getBestScoreKey(diff);
                localStorage.removeItem(key);
            });
        }
    }

    static getAllBestScores() {
        const scores = {};
        ['easy', 'normal', 'hard', 'expert'].forEach(difficulty => {
            scores[difficulty] = this.getBestScore(difficulty);
        });
        return scores;
    }

    static getDifficulty() {
        return localStorage.getItem(this.DIFFICULTY_KEY) || 'easy';
    }

    static saveDifficulty(difficulty) {
        localStorage.setItem(this.DIFFICULTY_KEY, difficulty);
    }
}

export default GameStorage;