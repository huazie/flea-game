/**
 * Match3Game类 - 消消乐游戏的核心逻辑实现
 */
class Match3Game {
    constructor() {
        this.size = 8; // 游戏板大小
        this.minMatchLength = 3; // 最小匹配长度
        // 游戏配置
        this.gemTypes = ['red', 'blue', 'green', 'yellow', 'purple', 'orange']; // 宝石类型
        this.baseScore = 10; // 基础分数
        this.comboMultiplier = 1.5; // 连击倍数
        this.board = [];
        this.score = 0;
        this.movesLeft = 30;
        this.level = GameStorage.getLevel();
        this.selectedCell = null;
        this.isProcessing = false; // 是否正在处理消除/填充等操作
        this.gameOver = false;
        this.won = false;
        
        // DOM元素
        this.gameBoard = document.querySelector('.game-board');
        this.scoreDisplay = document.getElementById('score');
        this.bestScoreDisplay = document.getElementById('best-score');
        this.movesDisplay = document.getElementById('moves-left');
        this.levelDisplay = document.getElementById('current-level');
        this.messageContainer = document.querySelector('.game-message');
        
        // 初始化游戏
        this.initialize();
        this.setupEventListeners();
        
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
        this.board = Array(this.size).fill().map(() => Array(this.size).fill(null));
        
        this.gameBoard.innerHTML = '';
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                cell.dataset.row = i;
                cell.dataset.col = j;
                this.gameBoard.appendChild(cell);
            }
        }
        
        // 显示最高分
        this.bestScoreDisplay.textContent = GameStorage.getBestScore();
        // 显示当前关卡
        this.levelDisplay.textContent = this.level;
    }
    
    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        this.gameBoard.addEventListener('click', (e) => {
            const cell = e.target.closest('.grid-cell');
            if (!cell || this.isProcessing || this.gameOver) return;
            
            const row = parseInt(cell.dataset.row);
            const col = parseInt(cell.dataset.col);
            this.handleCellClick(row, col);
        });
        
        // 按钮事件
        document.getElementById('new-game-button').addEventListener('click', () => {
            this.newGame();
        });
        
        document.getElementById('retry-button').addEventListener('click', () => {
            this.retryLevel();
        });
        
        document.getElementById('next-level-button').addEventListener('click', () => {
            this.nextLevel();
        });
        
        // 主题切换
        document.getElementById('theme-button').addEventListener('click', () => {
            const html = document.documentElement;
            const currentTheme = html.getAttribute('data-theme') || 'light';
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            
            html.setAttribute('data-theme', newTheme);
            const themeIcon = document.querySelector('#theme-button i');
            if (themeIcon) {
                themeIcon.className = newTheme === 'light' ? 'fas fa-sun' : 'fas fa-moon';
            }
        });
        
        // 返回按钮
        document.getElementById('back-button').addEventListener('click', () => {
            window.location.href = '../index.html';
        });
    }
    
    /**
     * 处理单元格点击
     * @param {Number} row - 行索引
     * @param {Number} col - 列索引
     */
    handleCellClick(row, col) {
        if (!this.selectedCell) {
            // 如果没有选中的单元格，选中当前单元格
            this.selectedCell = { row, col };
            this.highlightCell(row, col, true);
            return;
        }
        
        if (this.selectedCell.row === row && this.selectedCell.col === col) {
            // 如果点击的是已选中的单元格，取消选中
            this.highlightCell(row, col, false);
            this.selectedCell = null;
            return;
        }
        
        // 检查是否是相邻的单元格
        const isAdjacent = (
            (Math.abs(this.selectedCell.row - row) === 1 && this.selectedCell.col === col) ||
            (Math.abs(this.selectedCell.col - col) === 1 && this.selectedCell.row === row)
        );
        
        if (isAdjacent) {
            this.swapGems(this.selectedCell.row, this.selectedCell.col, row, col);
        } else {
            // 如果不相邻，取消之前的选中并选中新的单元格
            this.highlightCell(this.selectedCell.row, this.selectedCell.col, false);
            this.selectedCell = { row, col };
            this.highlightCell(row, col, true);
        }
    }
    
    /**
     * 高亮显示单元格
     * @param {Number} row - 行索引
     * @param {Number} col - 列索引
     * @param {Boolean} highlight - 是否高亮
     */
    highlightCell(row, col, highlight) {
        const cell = this.getCellElement(row, col);
        if (!cell) return;
        
        const gem = cell.querySelector('.gem');
        if (gem) {
            if (highlight) {
                gem.classList.add('gem-selected');
            } else {
                gem.classList.remove('gem-selected');
            }
        }
    }
    
    /**
     * 交换宝石
     * @param {Number} row1 - 第一个宝石的行索引
     * @param {Number} col1 - 第一个宝石的列索引
     * @param {Number} row2 - 第二个宝石的行索引
     * @param {Number} col2 - 第二个宝石的列索引
     */
    async swapGems(row1, col1, row2, col2) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        
        // 取消选中状态
        this.highlightCell(row1, col1, false);
        this.selectedCell = null;
        
        // 交换宝石
        const temp = this.board[row1][col1];
        this.board[row1][col1] = this.board[row2][col2];
        this.board[row2][col2] = temp;
        
        this.updateCell(row1, col1);
        this.updateCell(row2, col2);
        
        // 检查是否有匹配
        const matches = this.findMatches();
        if (matches.length > 0) {
            this.movesLeft--;
            this.movesDisplay.textContent = this.movesLeft;
            
            await this.processMatches(matches);
            // 保存游戏状态
            this.saveGameState();
            // 检查游戏是否结束
            this.checkGameStatus();
        } else {
            // 如果没有匹配，交换回来
            const cell1 = this.getCellElement(row1, col1);
            const cell2 = this.getCellElement(row2, col2);
            
            cell1.classList.add('invalid-move');
            cell2.classList.add('invalid-move');
            
            setTimeout(() => {
                // 交换回来
                this.board[row1][col1] = temp;
                this.board[row2][col2] = this.board[row1][col1];
                
                this.updateCell(row1, col1);
                this.updateCell(row2, col2);
                
                cell1.classList.remove('invalid-move');
                cell2.classList.remove('invalid-move');
                
                this.isProcessing = false;
            }, 500);
        }
    }
    
    /**
     * 处理匹配的宝石
     * @param {Array} matches - 匹配的宝石数组
     */
    async processMatches(matches) {
        let totalScore = 0;
        
        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            // 每个匹配的分数 = 基础分数 * 匹配长度 * (连击倍数 ^ 连击次数)
            const matchScore = this.baseScore * match.length * Math.pow(this.comboMultiplier, i);
            totalScore += matchScore;
            
            // 标记匹配的宝石
            for (const { row, col } of match) {
                const cell = this.getCellElement(row, col);
                if (cell) {
                    const gem = cell.querySelector('.gem');
                    if (gem) {
                        gem.classList.add('gem-matched');
                    }
                }
            }
        }
        
        this.score += totalScore;
        this.scoreDisplay.textContent = this.score;
        
        await this.delay(300);
        
        // 移除匹配的宝石
        for (const match of matches) {
            for (const { row, col } of match) {
                this.board[row][col] = null;
                const cell = this.getCellElement(row, col);
                if (cell) {
                    const gem = cell.querySelector('.gem');
                    if (gem) {
                        gem.classList.remove('gem-matched');
                        gem.classList.add('gem-removing');
                    }
                }
            }
        }
        
        await this.delay(300);
        
        // 更新显示
        this.updateBoard();
        
        // 填充空位
        await this.fillBoard();
        
        // 检查是否有新的匹配
        const newMatches = this.findMatches();
        if (newMatches.length > 0) {
            await this.processMatches(newMatches);
        } else {
            this.isProcessing = false;
        }
    }
    
    /**
     * 填充游戏板
     */
    async fillBoard() {
        // 处理每一列
        for (let col = 0; col < this.size; col++) {
            // 从底部向上检查每一列
            let emptyRow = -1;
            for (let row = this.size - 1; row >= 0; row--) {
                if (this.board[row][col] === null) {
                    // 找到一个空位
                    if (emptyRow === -1) emptyRow = row;
                } else if (emptyRow !== -1) {
                    // 将宝石下移
                    this.board[emptyRow][col] = this.board[row][col];
                    this.board[row][col] = null;
                    
                    this.updateCell(emptyRow, col);
                    this.updateCell(row, col);
                    
                    emptyRow--;
                }
            }
        }
        
        await this.delay(300);
        
        // 从顶部添加新宝石
        for (let col = 0; col < this.size; col++) {
            for (let row = 0; row < this.size; row++) {
                if (this.board[row][col] === null) {
                    // 生成随机宝石
                    this.board[row][col] = this.getRandomGemType();
                    
                    // 更新显示
                    this.updateCell(row, col, true);
                }
            }
        }
        
        // 等待新宝石出现动画完成
        await this.delay(300);
    }
    
    /**
     * 查找匹配的宝石
     * @returns {Array} - 匹配的宝石数组
     */
    findMatches() {
        const matches = [];
        const visited = Array(this.size).fill().map(() => Array(this.size).fill(false));
        
        // 检查水平匹配
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size - 2; col++) {
                const gemType = this.board[row][col];
                if (!gemType) continue;
                
                let matchLength = 1;
                let c = col + 1;
                while (c < this.size && this.board[row][c] === gemType) {
                    matchLength++;
                    c++;
                }
                
                if (matchLength >= this.minMatchLength) {
                    const match = [];
                    for (let i = 0; i < matchLength; i++) {
                        if (!visited[row][col + i]) {
                            visited[row][col + i] = true;
                            match.push({ row, col: col + i });
                        }
                    }
                    
                    if (match.length > 0) {
                        matches.push(match);
                    }
                }
            }
        }
        
        // 检查垂直匹配
        for (let col = 0; col < this.size; col++) {
            for (let row = 0; row < this.size - 2; row++) {
                const gemType = this.board[row][col];
                if (!gemType) continue;
                
                let matchLength = 1;
                let r = row + 1;
                while (r < this.size && this.board[r][col] === gemType) {
                    matchLength++;
                    r++;
                }
                
                if (matchLength >= this.minMatchLength) {
                    const match = [];
                    for (let i = 0; i < matchLength; i++) {
                        if (!visited[row + i][col]) {
                            visited[row + i][col] = true;
                            match.push({ row: row + i, col });
                        }
                    }
                    
                    if (match.length > 0) {
                        matches.push(match);
                    }
                }
            }
        }
        
        return matches;
    }
    
    /**
     * 获取单元格元素
     * @param {Number} row - 行索引
     * @param {Number} col - 列索引
     * @returns {Element} - 单元格元素
     */
    getCellElement(row, col) {
        return this.gameBoard.querySelector(`.grid-cell[data-row="${row}"][data-col="${col}"]`);
    }
    
    /**
     * 更新单元格显示
     * @param {Number} row - 行索引
     * @param {Number} col - 列索引
     * @param {Boolean} isNew - 是否是新宝石
     */
    updateCell(row, col, isNew = false) {
        const cell = this.getCellElement(row, col);
        if (!cell) return;
        
        const gemType = this.board[row][col];
        const oldGem = cell.querySelector('.gem');
        
        if (oldGem) {
            cell.removeChild(oldGem);
        }
        
        // 如果有宝石，创建新的宝石元素
        if (gemType) {
            const gem = document.createElement('div');
            gem.className = `gem gem-${gemType}`;
            
            if (isNew) {
                gem.classList.add('gem-new');
            }
            
            cell.appendChild(gem);
        }
    }
    
    /**
     * 更新整个游戏板
     */
    updateBoard() {
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                this.updateCell(row, col);
            }
        }
    }
    
    /**
     * 获取随机宝石类型
     * @returns {String} - 宝石类型
     */
    getRandomGemType() {
        const index = Math.floor(Math.random() * this.gemTypes.length);
        return this.gemTypes[index];
    }
    
    /**
     * 创建初始游戏板，确保没有初始匹配
     */
    createInitialBoard() {
        this.board = Array(this.size).fill().map(() => 
            Array(this.size).fill().map(() => this.getRandomGemType())
        );
        
        let hasMatches = true;
        while (hasMatches) {
            const matches = this.findMatches();
            if (matches.length > 0) {
                for (const match of matches) {
                    for (const { row, col } of match) {
                        let newGemType;
                        do {
                            newGemType = this.getRandomGemType();
                        } while (
                            (row > 0 && this.board[row - 1][col] === newGemType) ||
                            (row < this.size - 1 && this.board[row + 1][col] === newGemType) ||
                            (col > 0 && this.board[row][col - 1] === newGemType) ||
                            (col < this.size - 1 && this.board[row][col + 1] === newGemType)
                        );
                        
                        this.board[row][col] = newGemType;
                    }
                }
            } else {
                hasMatches = false;
            }
        }
    }
    
    /**
     * 开始新游戏
     */
    newGame() {
        this.score = 0;
        this.movesLeft = 30;
        this.level = 1;
        this.gameOver = false;
        this.won = false;
        this.selectedCell = null;
        
        // 创建初始游戏板
        this.createInitialBoard();
        this.updateBoard();
        
        this.scoreDisplay.textContent = this.score;
        this.movesDisplay.textContent = this.movesLeft;
        this.levelDisplay.textContent = this.level;
        
        // 隐藏消息
        this.hideMessage();
        
        // 保存游戏状态
        GameStorage.saveLevel(this.level);
        GameStorage.clearSavedGame();
    }
    
    /**
     * 重试当前关卡
     */
    retryLevel() {
        this.score = 0;
        this.movesLeft = 30;
        this.gameOver = false;
        this.won = false;
        this.selectedCell = null;
        
        // 创建初始游戏板
        this.createInitialBoard();
        this.updateBoard();
        
        this.scoreDisplay.textContent = this.score;
        this.movesDisplay.textContent = this.movesLeft;
        
        // 隐藏消息
        this.hideMessage();
        
        // 保存游戏状态
        GameStorage.clearSavedGame();
    }
    
    /**
     * 进入下一关
     */
    nextLevel() {
        this.level++;
        this.score = 0;
        this.movesLeft = 30;
        this.gameOver = false;
        this.won = false;
        this.selectedCell = null;
        
        // 创建初始游戏板
        this.createInitialBoard();
        this.updateBoard();
        
        // 更新显示
        this.scoreDisplay.textContent = this.score;
        this.movesDisplay.textContent = this.movesLeft;
        this.levelDisplay.textContent = this.level;
        
        // 隐藏消息
        this.hideMessage();
        
        // 保存游戏状态
        GameStorage.saveLevel(this.level);
        GameStorage.clearSavedGame();
    }
    
    /**
     * 检查游戏状态
     */
    checkGameStatus() {
        // 检查是否达到目标分数
        const targetScore = this.level * 1000;
        if (this.score >= targetScore) {
            this.won = true;
            this.gameOver = true;
            GameStorage.saveBestScore(this.score);
            this.showMessage(`恭喜！你完成了第${this.level}关！`, true);
        } else if (this.movesLeft <= 0) {
            this.gameOver = true;
            this.showMessage('游戏结束！步数用完了！');
        }
    }
    
    /**
     * 显示游戏消息
     * @param {String} message - 消息内容
     * @param {Boolean} won - 是否是胜利消息
     */
    showMessage(message, won = false) {
        const messageText = this.messageContainer.querySelector('p');
        if (messageText) {
            messageText.textContent = message;
        }
        
        this.messageContainer.className = `game-message ${won ? 'game-won' : 'game-over'}`;
        this.messageContainer.style.display = 'flex';
        
        // 显示/隐藏相应的按钮
        document.getElementById('next-level-button').style.display = won ? 'block' : 'none';
        document.getElementById('retry-button').style.display = won ? 'none' : 'block';
    }
    
    /**
     * 隐藏游戏消息
     */
    hideMessage() {
        this.messageContainer.style.display = 'none';
    }
    
    /**
     * 保存游戏状态
     */
    saveGameState() {
        GameStorage.saveGame({
            board: this.board,
            score: this.score,
            level: this.level,
            movesLeft: this.movesLeft
        });
        
        if (this.score > GameStorage.getBestScore()) {
            GameStorage.saveBestScore(this.score);
            this.bestScoreDisplay.textContent = this.score;
        }
    }
    
    /**
     * 加载游戏状态
     * @param {Object} savedState - 保存的游戏状态
     */
    loadGameState(savedState) {
        if (!savedState) return;
        
        this.board = savedState.board;
        this.score = savedState.score;
        this.level = savedState.level || 1;
        this.movesLeft = savedState.movesLeft || 30;
        
        this.updateBoard();
        this.scoreDisplay.textContent = this.score;
        this.movesDisplay.textContent = this.movesLeft;
        this.levelDisplay.textContent = this.level;
    }
    
    /**
     * 延迟函数
     * @param {Number} ms - 延迟毫秒数
     * @returns {Promise} - Promise对象
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 当页面加载完成时初始化游戏
document.addEventListener('DOMContentLoaded', () => {
    new Match3Game();
});