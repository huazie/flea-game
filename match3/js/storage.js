/**
 * GameStorage类 - 负责消消乐游戏的本地存储管理
 */
class GameStorage {
    static STORAGE_KEY = 'match3_game';
    static BEST_SCORE_KEY = 'match3_best_score';
    static LEVEL_KEY = 'match3_level';

    /**
     * 保存当前游戏状态
     * @param {Object} gameState - 包含游戏状态的对象
     * @returns {Boolean} - 保存是否成功
     */
    static saveGame(gameState) {
        try {
            // 验证数据格式
            if (!Array.isArray(gameState.board) || typeof gameState.score !== 'number') {
                throw new Error('无效的游戏状态格式');
            }

            const saveData = {
                board: gameState.board,
                score: gameState.score,
                level: gameState.level,
                movesLeft: gameState.movesLeft
            };
            
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(saveData));
            return true;
        } catch (error) {
            console.error('保存游戏失败:', error);
            return false;
        }
    }

    /**
     * 加载保存的游戏状态
     * @returns {Object|null} - 游戏状态对象或null（如果没有保存的游戏）
     */
    static loadGame() {
        try {
            const saveData = localStorage.getItem(this.STORAGE_KEY);
            if (!saveData) return null;
            
            const parsedData = JSON.parse(saveData);
            
            // 验证加载的数据格式
            if (!Array.isArray(parsedData.board) || typeof parsedData.score !== 'number') {
                throw new Error('无效的保存游戏格式');
            }

            return parsedData;
        } catch (error) {
            console.error('加载游戏失败:', error);
            return null;
        }
    }

    /**
     * 清除保存的游戏
     * @returns {Boolean} - 清除是否成功
     */
    static clearSavedGame() {
        try {
            localStorage.removeItem(this.STORAGE_KEY);
            return true;
        } catch (error) {
            console.error('清除保存的游戏失败:', error);
            return false;
        }
    }

    /**
     * 保存最高分
     * @param {Number} score - 分数
     * @returns {Boolean} - 保存是否成功
     */
    static saveBestScore(score) {
        try {
            const currentBest = this.getBestScore();
            if (score > currentBest) {
                localStorage.setItem(this.BEST_SCORE_KEY, score.toString());
            }
            return true;
        } catch (error) {
            console.error('保存最高分失败:', error);
            return false;
        }
    }

    /**
     * 获取最高分
     * @returns {Number} - 最高分
     */
    static getBestScore() {
        try {
            const bestScore = localStorage.getItem(this.BEST_SCORE_KEY);
            return bestScore ? parseInt(bestScore, 10) : 0;
        } catch (error) {
            console.error('获取最高分失败:', error);
            return 0;
        }
    }

    /**
     * 保存当前关卡
     * @param {Number} level - 关卡
     * @returns {Boolean} - 保存是否成功
     */
    static saveLevel(level) {
        try {
            localStorage.setItem(this.LEVEL_KEY, level.toString());
            return true;
        } catch (error) {
            console.error('保存关卡失败:', error);
            return false;
        }
    }

    /**
     * 获取当前关卡
     * @returns {Number} - 当前关卡
     */
    static getLevel() {
        try {
            const level = localStorage.getItem(this.LEVEL_KEY);
            return level ? parseInt(level, 10) : 1;
        } catch (error) {
            console.error('获取关卡失败:', error);
            return 1;
        }
    }
}