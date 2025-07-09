// 游戏存储管理类
class GameStorage {
    // 保存最高分
    static saveHighScore(score) {
        localStorage.setItem('tetrisHighScore', score.toString());
    }
    
    // 加载最高分
    static loadHighScore() {
        const savedHighScore = localStorage.getItem('tetrisHighScore');
        return savedHighScore ? parseInt(savedHighScore) : 0;
    }
    
    // 保存游戏进度
    static saveGameProgress(gameState) {
        try {
            // 将游戏状态转换为JSON字符串并保存
            const gameStateJson = JSON.stringify(gameState);
            localStorage.setItem('tetrisGameProgress', gameStateJson);
            return true;
        } catch (error) {
            console.error('保存游戏进度失败:', error);
            return false;
        }
    }
    
    // 加载游戏进度
    static loadGameProgress() {
        try {
            const savedProgress = localStorage.getItem('tetrisGameProgress');
            if (!savedProgress) {
                return null;
            }
            
            // 将JSON字符串转换回对象
            return JSON.parse(savedProgress);
        } catch (error) {
            console.error('加载游戏进度失败:', error);
            return null;
        }
    }
    
    // 清除保存的游戏进度
    static clearGameProgress() {
        localStorage.removeItem('tetrisGameProgress');
    }
    
    // 检查是否有保存的游戏进度
    static hasGameProgress() {
        return localStorage.getItem('tetrisGameProgress') !== null;
    }
}