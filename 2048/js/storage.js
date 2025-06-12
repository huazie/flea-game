/**
 * GameStorage类 - 负责2048游戏的本地存储管理
 */
class GameStorage {
    static STORAGE_KEY = '2048_game';
    static BEST_SCORE_KEY = '2048_best_score';

    /**
     * 保存当前游戏状态
     * @param {Object} gameState - 包含游戏状态的对象
     * @returns {Boolean} - 保存是否成功
     */
    static saveGame(gameState) {
        try {
            // 验证数据格式
            if (!Array.isArray(gameState.grid) || !gameState.score) {
                throw new Error('无效的游戏状态格式');
            }

            const saveData = {
                grid: gameState.grid,
                score: gameState.score,
                moveHistory: gameState.moveHistory || []
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
            if (!Array.isArray(parsedData.grid) || typeof parsedData.score !== 'number') {
                throw new Error('无效的保存游戏格式');
            }

            // 确保moveHistory存在
            if (!Array.isArray(parsedData.moveHistory)) {
                parsedData.moveHistory = [];
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
}