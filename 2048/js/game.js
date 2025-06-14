/**
 * Game2048类 - 2048游戏的核心逻辑实现
 */
class Game2048 {
    constructor() {
        this.size = 4; // 游戏板大小
        this.grid = [];
        this.score = 0;
        this.moveHistory = []; // 用于撤销功能
        this.gameOver = false;
        this.won = false;
        this.continueAfterWin = false;
        this.hasMovedSinceLastAdd = true; // 初始化移动标志

        // DOM元素
        this.gameBoard = document.querySelector('.game-board');
        this.scoreDisplay = document.getElementById('score');
        this.bestScoreDisplay = document.getElementById('best-score');
        this.messageContainer = document.querySelector('.game-message');

        this.themeToggle = document.getElementById('themeToggle');
        this.themeIcon = themeToggle.querySelector('i');
        
        // 初始化
        this.initialize();
        this.setupEventListeners();
        
        // 初始化主题和按钮
        this.initTheme();
        
        // 检测设备类型并显示相应指南
        this.detectDevice();
        
        // 加载保存的游戏或开始新游戏
        const savedGame = GameStorage.loadGame();
        if (savedGame) {
            this.loadGameState(savedGame);
        } else {
            this.newGame();
        }
    }

    /**
     * 初始化游戏
     */
    initialize() {
        // 创建空的游戏网格
        this.grid = Array(this.size).fill().map(() => Array(this.size).fill(0));
        
        // 创建网格单元格
        this.gameBoard.innerHTML = '';
        for (let i = 0; i < this.size * this.size; i++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            this.gameBoard.appendChild(cell);
        }

        // 显示最高分
        this.bestScoreDisplay.textContent = GameStorage.getBestScore();
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        const backButton = document.getElementById('backButton');
        // 返回按钮事件
        backButton.addEventListener('click', () => {
            window.location.href = '../';
        });

        // 主题切换事件
        this.themeToggle.addEventListener('click', () => {
            this.toggleTheme();
        });

        // 键盘事件
        document.addEventListener('keydown', (e) => {
            if (!this.gameOver) {
                let moved = false;
                switch(e.key) {
                    case 'ArrowUp':
                        moved = this.move('up');
                        break;
                    case 'ArrowDown':
                        moved = this.move('down');
                        break;
                    case 'ArrowLeft':
                        moved = this.move('left');
                        break;
                    case 'ArrowRight':
                        moved = this.move('right');
                        break;
                }
                if (moved) {
                    this.afterMove();
                }
            }
        });

        // 窗口大小改变时重新检测设备类型
        window.addEventListener('resize', () => {
            this.detectDevice();
        });

        // 触摸事件
        let touchStartX, touchStartY;
        this.gameBoard.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            e.preventDefault();
        }, { passive: false });

        this.gameBoard.addEventListener('touchmove', (e) => {
            e.preventDefault();
        }, { passive: false });

        this.gameBoard.addEventListener('touchend', (e) => {
            if (this.gameOver) return;

            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            
            const dx = touchEndX - touchStartX;
            const dy = touchEndY - touchStartY;
            
            if (Math.abs(dx) > 20 || Math.abs(dy) > 20) {
                let moved = false;
                if (Math.abs(dx) > Math.abs(dy)) {
                    moved = this.move(dx > 0 ? 'right' : 'left');
                } else {
                    moved = this.move(dy > 0 ? 'down' : 'up');
                }
                if (moved) {
                    this.afterMove();
                }
            }
        });

        // 按钮事件
        document.getElementById('new-game-button').addEventListener('click', () => {
            this.newGame();
        });

        document.getElementById('undo-button').addEventListener('click', () => {
            this.undo();
        });

        document.getElementById('retry-button').addEventListener('click', () => {
            this.newGame();
        });

        document.getElementById('continue-button').addEventListener('click', () => {
            this.continueGame();
        });
    }

    /**
     * 开始新游戏
     */
    newGame() {
        this.grid = Array(this.size).fill().map(() => Array(this.size).fill(0));
        this.score = 0;
        this.moveHistory = [];
        this.gameOver = false;
        this.won = false;
        this.continueAfterWin = false;
        
        // 新游戏开始时添加两个初始数字
        this.addNewTile(true); // 强制添加第一个数字
        this.addNewTile(true); // 强制添加第二个数字
        
        this.updateDisplay();
        this.hideMessage();
        GameStorage.clearSavedGame();
    }

    /**
     * 在随机空位置添加新方块
     * @param {boolean} force - 是否强制添加（用于游戏初始化）
     */
    addNewTile(force = false) {
        // 如果不是强制添加，且没有空格，则不添加新数字
        const emptyCells = [];
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                if (this.grid[i][j] === 0) {
                    emptyCells.push({x: i, y: j});
                }
            }
        }
        
        if (emptyCells.length && (force || this.hasMovedSinceLastAdd)) {
            const {x, y} = emptyCells[Math.floor(Math.random() * emptyCells.length)];
            this.grid[x][y] = Math.random() < 0.9 ? 2 : 4;
            this.hasMovedSinceLastAdd = false; // 重置移动标志
        }
    }

    /**
     * 移动方块
     * @param {string} direction - 移动方向
     * @returns {boolean} - 是否发生了移动
     */
    move(direction) {
        // 保存移动前的状态
        const previousState = {
            grid: this.grid.map(row => [...row]),
            score: this.score
        };

        let moved = false;
        const rotated = this.rotateGrid(direction);
        
        for (let i = 0; i < this.size; i++) {
            const line = rotated[i];
            const merged = this.mergeLine(line);
            rotated[i] = merged.line;
            if (merged.moved) moved = true;
            this.score += merged.score;
        }
        
        // 获取移动后的网格
        const newGrid = this.rotateGridBack(rotated, direction);
        
        // 检查网格是否真的发生了变化
        let hasChanged = false;
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                if (newGrid[i][j] !== this.grid[i][j]) {
                    hasChanged = true;
                    break;
                }
            }
            if (hasChanged) break;
        }
        
        if (moved && hasChanged) {
            this.grid = newGrid;
            this.moveHistory.push(previousState);
            this.hasMovedSinceLastAdd = true; // 标记发生了有效移动
            return true;
        }
        return false;
    }

    /**
     * 合并一行方块
     * @param {Array} line - 要合并的行
     * @returns {Object} - 合并结果
     */
    mergeLine(line) {
        const newLine = line.filter(cell => cell !== 0);
        let score = 0;
        let moved = newLine.length !== line.length;

        for (let i = 0; i < newLine.length - 1; i++) {
            if (newLine[i] === newLine[i + 1]) {
                newLine[i] *= 2;
                score += newLine[i];
                newLine.splice(i + 1, 1);
                moved = true;
                if (newLine[i] === 2048 && !this.won && !this.continueAfterWin) {
                    this.won = true;
                }
            }
        }

        while (newLine.length < line.length) {
            newLine.push(0);
        }

        return {
            line: newLine,
            score: score,
            moved: moved
        };
    }

    /**
     * 根据方向旋转网格
     * @param {string} direction - 移动方向
     * @returns {Array} - 旋转后的网格
     */
    rotateGrid(direction) {
        const rotated = Array(this.size).fill().map(() => Array(this.size).fill(0));
        
        switch(direction) {
            case 'left':
                return this.grid.map(row => [...row]);
            case 'right':
                for (let i = 0; i < this.size; i++) {
                    for (let j = 0; j < this.size; j++) {
                        rotated[i][j] = this.grid[i][this.size - 1 - j];
                    }
                }
                break;
            case 'up':
                for (let i = 0; i < this.size; i++) {
                    for (let j = 0; j < this.size; j++) {
                        rotated[i][j] = this.grid[j][i];
                    }
                }
                break;
            case 'down':
                // 先转置矩阵
                for (let i = 0; i < this.size; i++) {
                    for (let j = 0; j < this.size; j++) {
                        rotated[i][j] = this.grid[j][i];
                    }
                }
                // 然后水平翻转
                for (let i = 0; i < this.size; i++) {
                    rotated[i].reverse();
                }
                break;
        }
        return rotated;
    }

    /**
     * 将旋转的网格转回原方向
     * @param {Array} rotated - 旋转的网格
     * @param {string} direction - 移动方向
     * @returns {Array} - 转回后的网格
     */
    rotateGridBack(rotated, direction) {
        const grid = Array(this.size).fill().map(() => Array(this.size).fill(0));
        
        switch(direction) {
            case 'left':
                return rotated.map(row => [...row]);
            case 'right':
                for (let i = 0; i < this.size; i++) {
                    for (let j = 0; j < this.size; j++) {
                        grid[i][j] = rotated[i][this.size - 1 - j];
                    }
                }
                break;
            case 'up':
                for (let i = 0; i < this.size; i++) {
                    for (let j = 0; j < this.size; j++) {
                        grid[i][j] = rotated[j][i];
                    }
                }
                break;
            case 'down':
                // 先水平翻转
                const flipped = rotated.map(row => [...row].reverse());
                // 然后转置矩阵
                for (let i = 0; i < this.size; i++) {
                    for (let j = 0; j < this.size; j++) {
                        grid[i][j] = flipped[j][i];
                    }
                }
                break;
        }
        return grid;
    }

    /**
     * 移动后的处理
     */
    afterMove() {
        // 添加新的数字（只有在hasMovedSinceLastAdd为true时才会添加）
        this.addNewTile();
        this.updateDisplay();
        
        // 检查游戏状态
        if (this.won && !this.continueAfterWin) {
            this.showMessage('游戏胜利！', true);
        } else if (!this.canMove()) {
            this.gameOver = true;
            this.showMessage('游戏结束！');
        }
        
        // 保存游戏状态
        GameStorage.saveGame({
            grid: this.grid,
            score: this.score,
            moveHistory: this.moveHistory
        });
        
        // 更新最高分
        if (this.score > GameStorage.getBestScore()) {
            GameStorage.saveBestScore(this.score);
            this.bestScoreDisplay.textContent = this.score;
        }
    }

    /**
     * 检查是否还能移动
     * @returns {boolean} - 是否可以移动
     */
    canMove() {
        // 检查是否有空格
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                if (this.grid[i][j] === 0) return true;
            }
        }
        
        // 检查是否有相邻的相同数字
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                const current = this.grid[i][j];
                if ((j < this.size - 1 && this.grid[i][j + 1] === current) ||
                    (i < this.size - 1 && this.grid[i + 1][j] === current)) {
                    return true;
                }
            }
        }
        
        return false;
    }

    /**
     * 更新显示
     */
    updateDisplay() {
        // 更新分数
        this.scoreDisplay.textContent = this.score;
        
        // 更新网格
        const cells = this.gameBoard.children;
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                const value = this.grid[i][j];
                const cell = cells[i * this.size + j];
                
                // 移除旧的数字tile
                const oldTile = cell.querySelector('.tile');
                if (oldTile) {
                    cell.removeChild(oldTile);
                }
                
                // 如果格子有数字，创建新的tile
                if (value !== 0) {
                    const tile = document.createElement('div');
                    tile.className = `tile tile-${value}${value > 2048 ? ' tile-super' : ''}`;
                    tile.textContent = value;
                    cell.appendChild(tile);
                }
            }
        }
    }

    /**
     * 显示游戏消息
     * @param {string} message - 消息内容
     * @param {boolean} won - 是否是胜利消息
     */
    showMessage(message, won = false) {
        this.messageContainer.querySelector('p').textContent = message;
        this.messageContainer.className = `game-message ${won ? 'game-won' : 'game-over'}`;
        this.messageContainer.style.display = 'flex';
        document.getElementById('continue-button').style.display = won ? 'block' : 'none';
    }

    /**
     * 隐藏游戏消息
     */
    hideMessage() {
        this.messageContainer.style.display = 'none';
    }

    /**
     * 继续游戏
     */
    continueGame() {
        this.continueAfterWin = true;
        this.hideMessage();
    }

    /**
     * 撤销上一步移动
     */
    undo() {
        if (this.moveHistory.length > 0) {
            const previousState = this.moveHistory.pop();
            this.grid = previousState.grid.map(row => [...row]);
            this.score = previousState.score;
            this.updateDisplay();
            this.hideMessage();
            this.gameOver = false;
            
            // 保存当前状态
            GameStorage.saveGame({
                grid: this.grid,
                score: this.score,
                moveHistory: this.moveHistory
            });
        }
    }

    /**
     * 加载游戏状态
     * @param {Object} savedState - 保存的游戏状态
     */
    loadGameState(savedState) {
        this.grid = savedState.grid.map(row => [...row]);
        this.score = savedState.score;
        this.moveHistory = savedState.moveHistory || [];
        this.gameOver = false;
        this.won = false;
        this.continueAfterWin = false;
        
        // 检查是否已经赢了
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                if (this.grid[i][j] === 2048) {
                    this.won = true;
                    break;
                }
            }
        }
        
        this.updateDisplay();
    }

    /**
     * 检测设备类型并显示相应指南
     */
    detectDevice() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                        (window.matchMedia && window.matchMedia('(max-width: 520px)').matches);
        
        const mobileInstruction = document.querySelector('.mobile-instruction');
        const pcInstruction = document.querySelector('.pc-instruction');
        
        if (isMobile) {
            if (mobileInstruction) mobileInstruction.style.display = 'block';
            if (pcInstruction) pcInstruction.style.display = 'none';
        } else {
            if (mobileInstruction) mobileInstruction.style.display = 'none';
            if (pcInstruction) pcInstruction.style.display = 'block';
        }
    }

    // 初始化主题
    initTheme() {
        // 从本地存储中获取主题设置，如果没有则默认为浅色主题
        const savedTheme = localStorage.getItem('color_scheme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        
        // 更新主题切换按钮图标
        this.updateThemeIcon(savedTheme);
    }

    // 切换主题
    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        // 设置新主题
        document.documentElement.setAttribute('data-theme', newTheme);
        
        // 保存主题设置到本地存储
        localStorage.setItem('color_scheme', newTheme);
        
        // 更新主题切换按钮图标
        this.updateThemeIcon(newTheme);
    }

    // 更新主题切换按钮图标
    updateThemeIcon(theme) {
        // 移除所有图标类
        this.themeIcon.className = '';
        
        // 根据当前主题设置图标
        if (theme === 'dark') {
            this.themeIcon.classList.add('fas', 'fa-moon');
        } else {
            this.themeIcon.classList.add('fas', 'fa-sun');
        }
    }
}

// 当页面加载完成时初始化游戏
document.addEventListener('DOMContentLoaded', () => {
    new Game2048();
});