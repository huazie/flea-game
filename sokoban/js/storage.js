/**
 * GameStorage 类 - 负责推箱子游戏的本地存储管理。
 * - 按关卡记录最佳步数（越少越好）
 * - 记录已解锁（到达）的最高关卡，便于“下一关”衔接
 */
class GameStorage {
    static PREFIX = 'sokoban';
    static BEST_KEY = 'sokoban_best';        // { "<index>": 最少步数 }
    static PROGRESS_KEY = 'sokoban_progress'; // 已解锁的最高关卡索引

    /**
     * 读取某关最佳步数
     * @param {number} levelIndex
     * @returns {number} 最佳步数（0 表示暂无记录）
     */
    static getBestMoves(levelIndex, namespace) {
        try {
            const raw = localStorage.getItem(this._bestKey(namespace));
            if (!raw) return 0;
            const all = JSON.parse(raw);
            return all[levelIndex] || 0;
        } catch (e) {
            return 0;
        }
    }

    /**
     * 若本次步数更优则保存
     * @param {number} levelIndex
     * @param {number} moves
     * @param {string} [namespace] 关卡来源命名空间，默认 default（内置）；自定义上传试玩用 'custom'
     * @returns {boolean} 是否刷新了纪录
     */
    static saveBestMoves(levelIndex, moves, namespace) {
        try {
            const raw = localStorage.getItem(this._bestKey(namespace));
            const all = raw ? JSON.parse(raw) : {};
            const prev = all[levelIndex] || 0;
            if (prev === 0 || moves < prev) {
                all[levelIndex] = moves;
                localStorage.setItem(this._bestKey(namespace), JSON.stringify(all));
                return prev !== 0; // prev===0 表示首次通关，不算“打破纪录”
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    /** 最佳步数存储键：default 沿用原键以兼容旧记录，其余加命名空间后缀 */
    static _bestKey(namespace) {
        return (namespace && namespace !== 'default') ? 'sokoban_best_' + namespace : 'sokoban_best';
    }

    /**
     * 读取已解锁的最高关卡索引
     * @returns {number}
     */
    static getUnlockedLevel() {
        try {
            const v = parseInt(localStorage.getItem(this.PROGRESS_KEY), 10);
            return isNaN(v) ? 0 : v;
        } catch (e) {
            return 0;
        }
    }

    /**
     * 解锁到指定关卡（仅能向上推进）
     * @param {number} levelIndex
     */
    static unlockLevel(levelIndex) {
        try {
            const cur = this.getUnlockedLevel();
            if (levelIndex > cur) {
                localStorage.setItem(this.PROGRESS_KEY, String(levelIndex));
            }
        } catch (e) { /* ignore */ }
    }
}
