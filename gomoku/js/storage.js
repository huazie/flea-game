class GameStorage {
    constructor() {
        this.localStorageSupported = this.localStorageSupported();
    }

    // 检查浏览器是否支持localStorage
    localStorageSupported() {
        const testKey = "test";
        const storage = window.localStorage;

        try {
            storage.setItem(testKey, "1");
            storage.removeItem(testKey);
            return true;
        } catch (error) {
            return false;
        }
    }

    // 保存游戏状态
    saveGameState(gameState) {
        if (this.localStorageSupported) {
            window.localStorage.setItem("gomokuGameState", JSON.stringify(gameState));
        }
    }

    // 加载游戏状态
    loadGameState() {
        if (this.localStorageSupported) {
            const stateJSON = window.localStorage.getItem("gomokuGameState");
            return stateJSON ? JSON.parse(stateJSON) : null;
        }
        return null;
    }

    // 清除保存的游戏状态
    clearGameState() {
        if (this.localStorageSupported) {
            window.localStorage.removeItem("gomokuGameState");
        }
    }

    // 保存游戏分数
    saveGameScores(mode, blackScore, whiteScore) {
        if (this.localStorageSupported) {
            // 加载现有分数
            let allScores = this.loadAllGameScores();
            
            // 更新指定模式的分数
            allScores[mode] = {
                black: blackScore,
                white: whiteScore
            };
            
            window.localStorage.setItem("gomokuScores", JSON.stringify(allScores));
        }
    }

    // 加载指定模式的游戏分数
    loadGameScores(mode) {
        const allScores = this.loadAllGameScores();
        return allScores[mode] || { black: 0, white: 0 };
    }
    
    // 加载所有模式的游戏分数
    loadAllGameScores() {
        if (this.localStorageSupported) {
            const scoresJSON = window.localStorage.getItem("gomokuScores");
            if (scoresJSON) {
                // 处理旧数据结构迁移
                const parsed = JSON.parse(scoresJSON);
                if (parsed.black !== undefined) { // 旧格式
                    return {
                        free: { black: parsed.black, white: parsed.white },
                        ai: { black: 0, white: 0 }
                    };
                }
                return parsed;
            }
        }
        return {
            free: { black: 0, white: 0 },
            ai: { black: 0, white: 0 }
        };
    }
}