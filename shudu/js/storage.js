class GameStorage {
    static STORAGE_KEY = 'shudu_game';
    static BEST_TIMES_KEY = 'shudu_best_times';

    // 保存当前游戏状态
    static saveGame(gameState) {
        try {
            // 验证数据格式
            if (!Array.isArray(gameState.board) || !Array.isArray(gameState.board[0]) ||
                !Array.isArray(gameState.solution) || !Array.isArray(gameState.solution[0]) ||
                !Array.isArray(gameState.initialBoard) || !Array.isArray(gameState.initialBoard[0])) {
                throw new Error('Invalid game state format');
            }

            const saveData = {
                board: gameState.board,
                solution: gameState.solution,
                initialBoard: gameState.initialBoard,
                difficulty: gameState.difficulty,
                elapsedTime: gameState.elapsedTime
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(saveData));
            return true;
        } catch (error) {
            console.error('保存游戏失败:', error);
            return false;
        }
    }

    // 加载保存的游戏状态
    static loadGame() {
        try {
            const saveData = localStorage.getItem(this.STORAGE_KEY);
            if (!saveData) return null;
            
            const parsedData = JSON.parse(saveData);
            
            // 验证加载的数据格式
            if (!Array.isArray(parsedData.board) || !Array.isArray(parsedData.board[0]) ||
                !Array.isArray(parsedData.solution) || !Array.isArray(parsedData.solution[0])) {
                throw new Error('Invalid saved game format');
            }

            // 确保initialBoard存在且格式正确
            if (!parsedData.initialBoard || !Array.isArray(parsedData.initialBoard) || !Array.isArray(parsedData.initialBoard[0])) {
                console.warn('Missing or invalid initialBoard in saved game');
                return null;
            }

            return parsedData;
        } catch (error) {
            console.error('加载游戏失败:', error);
            return null;
        }
    }

    // 清除保存的游戏
    static clearSavedGame() {
        try {
            localStorage.removeItem(this.STORAGE_KEY);
            return true;
        } catch (error) {
            console.error('清除保存的游戏失败:', error);
            return false;
        }
    }

    // 保存指定难度下的最少用时
    static saveBestTime(difficulty, time) {
        try {
            const bestTimes = this.loadBestTimes();
            if (!bestTimes[difficulty] || time < bestTimes[difficulty]) {
                bestTimes[difficulty] = time;
                localStorage.setItem(this.BEST_TIMES_KEY, JSON.stringify(bestTimes));
                return true;
            }
            return false;
        } catch (error) {
            console.error('保存最少用时失败:', error);
            return false;
        }
    }

    // 加载所有难度下的最少用时
    static loadBestTimes() {
        try {
            const bestTimesData = localStorage.getItem(this.BEST_TIMES_KEY);
            if (!bestTimesData) {
                return { easy: 0, medium: 0, hard: 0 };
            }
            return JSON.parse(bestTimesData);
        } catch (error) {
            console.error('加载最少用时失败:', error);
            return { easy: 0, medium: 0, hard: 0 };
        }
    }

    // 获取指定难度下的最少用时
    static getBestTime(difficulty) {
        const bestTimes = this.loadBestTimes();
        return bestTimes[difficulty] || 0;
    }
}