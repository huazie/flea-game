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

    /** 棋谱存储键（按「实际棋谱」记录最佳，与关卡索引/来源无关） */
    static BEST_MAP_KEY = 'sokoban_best_map';

    /**
     * 棋谱指纹：基于关卡实际 map 内容（行两端归一化后拼接），
     * 与关卡在池中的索引、是官方还是自定义均无关。
     * 同一棋谱（即便下标/来源不同）指纹相同 → 最佳步数共享、稳定。
     * @param {string[]} map
     * @returns {string} 8 位十六进制指纹
     */
    static fingerprint(map) {
        try {
            const norm = (Array.isArray(map) ? map : [])
                .map(r => String(r).trim())
                .join('\n');
            // FNV-1a 32-bit
            let h = 0x811c9dc5;
            for (let i = 0; i < norm.length; i++) {
                h ^= norm.charCodeAt(i);
                h = Math.imul(h, 0x01000193);
            }
            return ('0000000' + (h >>> 0).toString(16)).slice(-8);
        } catch (e) {
            return '00000000';
        }
    }

    /**
     * 按棋谱读取某关最佳步数。
     * 优先读棋谱维度记录；若无，则回退旧「索引+命名空间」记录（兼容历史数据）。
     * @param {string[]} map
     * @param {number} [fallbackIndex]
     * @param {string} [fallbackNamespace]
     * @returns {number}
     */
    static getBestMovesByMap(map, fallbackIndex, fallbackNamespace) {
        try {
            // 1) 棋谱维度（新）
            const rawNew = localStorage.getItem(this.BEST_MAP_KEY);
            if (rawNew) {
                const all = JSON.parse(rawNew);
                const v = all[this.fingerprint(map)];
                if (v) return v;
            }
            // 2) 索引维度（旧，兼容历史记录）
            if (fallbackIndex != null) {
                const rawOld = localStorage.getItem(this._bestKey(fallbackNamespace));
                if (rawOld) {
                    const all = JSON.parse(rawOld);
                    const v = all[fallbackIndex];
                    if (v) return v;
                }
            }
            return 0;
        } catch (e) {
            return 0;
        }
    }

    /**
     * 按棋谱保存最佳步数（若更优）。索引维度旧记录不再写入，逐步收敛到棋谱维度。
     * @param {string[]} map
     * @param {number} moves
     * @returns {boolean} 是否刷新了纪录
     */
    static saveBestMovesByMap(map, moves) {
        try {
            const fp = this.fingerprint(map);
            const key = this.BEST_MAP_KEY;
            const raw = localStorage.getItem(key);
            const all = raw ? JSON.parse(raw) : {};
            const prev = all[fp] || 0;
            if (prev === 0 || moves < prev) {
                all[fp] = moves;
                localStorage.setItem(key, JSON.stringify(all));
                return prev !== 0; // prev===0 表示首次通关，不算“打破纪录”
            }
            return false;
        } catch (e) {
            return false;
        }
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
