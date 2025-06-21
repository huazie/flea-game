// 本地存储键名
const STORAGE_KEYS = {
    BEST_MOVES: 'memoryGameBestMoves',
    THEME: 'memoryGameTheme',
    GRID_SIZE: 'memoryGameGridSize'
};

// 存储管理类
class StorageManager {
    constructor() {
        this.storage = window.localStorage;
    }

    // 保存最佳步数
    setBestMoves(moves) {
        try {
            this.storage.setItem(STORAGE_KEYS.BEST_MOVES, moves.toString());
            return true;
        } catch (e) {
            console.error('保存最佳步数失败:', e);
            return false;
        }
    }

    // 获取最佳步数
    getBestMoves() {
        const bestMoves = this.storage.getItem(STORAGE_KEYS.BEST_MOVES);
        return bestMoves ? parseInt(bestMoves) : Infinity;
    }

    // 保存网格大小设置
    setGridSize(size) {
        try {
            this.storage.setItem(STORAGE_KEYS.GRID_SIZE, size.toString());
            return true;
        } catch (e) {
            console.error('保存网格大小设置失败:', e);
            return false;
        }
    }

    // 获取网格大小设置
    getGridSize() {
        const size = this.storage.getItem(STORAGE_KEYS.GRID_SIZE);
        return size ? parseInt(size) : 4; // 默认4x4网格
    }

    // 清除所有游戏数据
    clearGameData() {
        try {
            Object.values(STORAGE_KEYS).forEach(key => {
                this.storage.removeItem(key);
            });
            return true;
        } catch (e) {
            console.error('清除游戏数据失败:', e);
            return false;
        }
    }

    // 检查是否支持本地存储
    isStorageAvailable() {
        try {
            const test = '__storage_test__';
            this.storage.setItem(test, test);
            this.storage.removeItem(test);
            return true;
        } catch (e) {
            return false;
        }
    }
}

// 导出存储管理器实例
export const storageManager = new StorageManager();