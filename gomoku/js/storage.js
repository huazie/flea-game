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
    saveGameScores(blackScore, whiteScore) {
        if (this.localStorageSupported) {
            const scores = {
                black: blackScore,
                white: whiteScore
            };
            window.localStorage.setItem("gomokuScores", JSON.stringify(scores));
        }
    }

    // 加载游戏分数
    loadGameScores() {
        if (this.localStorageSupported) {
            const scoresJSON = window.localStorage.getItem("gomokuScores");
            return scoresJSON ? JSON.parse(scoresJSON) : { black: 0, white: 0 };
        }
        return { black: 0, white: 0 };
    }
}