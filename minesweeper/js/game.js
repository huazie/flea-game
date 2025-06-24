// 游戏配置
const DIFFICULTY_SETTINGS = {
    beginner: { rows: 9, cols: 9, mines: 10 },
    intermediate: { rows: 16, cols: 16, mines: 40 },
    expert: { rows: 16, cols: 30, mines: 99 },
    intermediate_phone: { rows: 22, cols: 12, mines: 40 },
    expert_phone: { rows: 40, cols: 12, mines: 99 }
};

// 游戏状态
class MinesweeperGame {
    constructor() {
        // DOM 元素
        this.gameBoard = document.getElementById('gameBoard');
        this.mineCountDisplay = document.getElementById('mineCount');
        this.timerDisplay = document.getElementById('timer');
        this.newGameBtn = document.getElementById('newGameBtn');
        this.difficultySelect = document.getElementById('difficulty');

        // 游戏状态
        this.grid = [];
        this.isGameOver = false;
        this.isFirstClick = true;
        this.timerInterval = null;
        this.seconds = 0;
        this.flaggedCount = 0;
        this.revealedCount = 0;

        // 当前难度
        this.difficulty = 'beginner';
        this.rows = DIFFICULTY_SETTINGS[this.difficulty].rows;
        this.cols = DIFFICULTY_SETTINGS[this.difficulty].cols;
        this.totalMines = DIFFICULTY_SETTINGS[this.difficulty].mines;

        // 初始化事件监听
        this.initEventListeners();
        
        // 开始新游戏
        this.startNewGame();
    }

    // 初始化事件监听
    initEventListeners() {
        this.newGameBtn.addEventListener('click', () => this.startNewGame());
        
        this.difficultySelect.addEventListener('change', () => {
            this.difficulty = this.difficultySelect.value;
            this.rows = DIFFICULTY_SETTINGS[this.difficulty].rows;
            this.cols = DIFFICULTY_SETTINGS[this.difficulty].cols;
            this.totalMines = DIFFICULTY_SETTINGS[this.difficulty].mines;
            this.startNewGame();
        });
    }

    // 开始新游戏
    startNewGame() {
        // 重置游戏状态
        this.isGameOver = false;
        this.isFirstClick = true;
        this.seconds = 0;
        this.flaggedCount = 0;
        this.revealedCount = 0;
        this.newGameBtn.textContent = '😊';
        this.timerDisplay.textContent = '0';
        this.mineCountDisplay.textContent = this.totalMines;
        
        // 清除计时器
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        
        // 创建游戏面板
        this.createGameBoard();
    }

    // 创建游戏面板
    createGameBoard() {
        // 清空游戏面板
        this.gameBoard.innerHTML = '';
        
        // 调整游戏面板的网格列数
        this.gameBoard.style.gridTemplateColumns = `repeat(${this.cols}, 30px)`;
        
        // 初始化网格数组
        this.grid = Array(this.rows).fill().map(() => Array(this.cols).fill().map(() => ({
            isMine: false,
            isRevealed: false,
            isFlagged: false,
            neighborMines: 0
        })));
        
        // 创建格子元素
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = row;
                cell.dataset.col = col;
                
                // 添加点击事件
                cell.addEventListener('click', (e) => this.handleCellClick(row, col));
                
                // 添加右键点击事件（标记）
                cell.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.handleCellRightClick(row, col);
                });
                
                this.gameBoard.appendChild(cell);
            }
        }
    }

    // 放置地雷（在第一次点击后）
    placeMines(firstRow, firstCol) {
        let minesPlaced = 0;
        
        while (minesPlaced < this.totalMines) {
            const row = Math.floor(Math.random() * this.rows);
            const col = Math.floor(Math.random() * this.cols);
            
            // 确保不在第一次点击的位置及其周围放置地雷
            if (!this.grid[row][col].isMine && 
                (Math.abs(row - firstRow) > 1 || Math.abs(col - firstCol) > 1)) {
                this.grid[row][col].isMine = true;
                minesPlaced++;
            }
        }
        
        // 计算每个格子周围的地雷数量
        this.calculateNeighborMines();
    }

    // 计算每个格子周围的地雷数量
    calculateNeighborMines() {
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                if (!this.grid[row][col].isMine) {
                    let count = 0;
                    
                    // 检查周围8个方向
                    for (let r = Math.max(0, row - 1); r <= Math.min(this.rows - 1, row + 1); r++) {
                        for (let c = Math.max(0, col - 1); c <= Math.min(this.cols - 1, col + 1); c++) {
                            if (this.grid[r][c].isMine) {
                                count++;
                            }
                        }
                    }
                    
                    this.grid[row][col].neighborMines = count;
                }
            }
        }
    }

    // 处理格子点击
    handleCellClick(row, col) {
        // 如果游戏已结束或格子已被标记，则不做任何操作
        if (this.isGameOver || this.grid[row][col].isFlagged) {
            return;
        }
        
        // 如果是第一次点击
        if (this.isFirstClick) {
            this.isFirstClick = false;
            this.placeMines(row, col);
            this.startTimer();
        }
        
        // 如果点击到地雷，游戏结束
        if (this.grid[row][col].isMine) {
            this.gameOver(false);
            return;
        }
        
        // 揭示格子
        this.revealCell(row, col);
        
        // 检查是否获胜
        this.checkWin();
    }

    // 处理格子右键点击（标记）
    handleCellRightClick(row, col) {
        // 如果游戏已结束或格子已被揭示，则不做任何操作
        if (this.isGameOver || this.grid[row][col].isRevealed) {
            return;
        }
        
        const cell = this.grid[row][col];
        
        // 切换标记状态
        if (cell.isFlagged) {
            cell.isFlagged = false;
            this.flaggedCount--;
        } else {
            cell.isFlagged = true;
            this.flaggedCount++;
        }
        
        // 更新显示
        this.updateCellDisplay(row, col);
        this.mineCountDisplay.textContent = this.totalMines - this.flaggedCount;
    }

    // 揭示格子
    revealCell(row, col) {
        const cell = this.grid[row][col];
        
        // 如果格子已被揭示或已被标记，则不做任何操作
        if (cell.isRevealed || cell.isFlagged) {
            return;
        }
        
        // 标记为已揭示
        cell.isRevealed = true;
        this.revealedCount++;
        
        // 更新显示
        this.updateCellDisplay(row, col);
        
        // 如果周围没有地雷，自动揭示周围的格子
        if (cell.neighborMines === 0) {
            for (let r = Math.max(0, row - 1); r <= Math.min(this.rows - 1, row + 1); r++) {
                for (let c = Math.max(0, col - 1); c <= Math.min(this.cols - 1, col + 1); c++) {
                    if (r !== row || c !== col) {
                        this.revealCell(r, c);
                    }
                }
            }
        }
    }

    // 更新格子显示
    updateCellDisplay(row, col) {
        const cell = this.grid[row][col];
        const cellElement = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        
        // 重置类名
        cellElement.className = 'cell';
        
        if (cell.isRevealed) {
            cellElement.classList.add('revealed');
            
            if (cell.isMine) {
                cellElement.classList.add('mine');
                cellElement.textContent = '💣';
            } else if (cell.neighborMines > 0) {
                cellElement.dataset.number = cell.neighborMines;
                cellElement.textContent = cell.neighborMines;
            } else {
                cellElement.textContent = '';
            }
        } else if (cell.isFlagged) {
            cellElement.classList.add('flagged');
            cellElement.textContent = '🚩';
        } else {
            cellElement.textContent = '';
        }
    }

    // 揭示所有地雷
    revealAllMines() {
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                if (this.grid[row][col].isMine) {
                    this.grid[row][col].isRevealed = true;
                    this.updateCellDisplay(row, col);
                }
            }
        }
    }

    // 开始计时器
    startTimer() {
        this.timerInterval = setInterval(() => {
            this.seconds++;
            this.timerDisplay.textContent = this.seconds;
        }, 1000);
    }

    // 检查是否获胜
    checkWin() {
        const totalCells = this.rows * this.cols;
        const nonMineCells = totalCells - this.totalMines;
        
        if (this.revealedCount === nonMineCells) {
            this.gameOver(true);
        }
    }

    // 游戏结束
    gameOver(isWin) {
        this.isGameOver = true;
        
        // 停止计时器
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        
        if (isWin) {
            this.newGameBtn.textContent = '😎';
            // 标记所有未标记的地雷
            for (let row = 0; row < this.rows; row++) {
                for (let col = 0; col < this.cols; col++) {
                    if (this.grid[row][col].isMine && !this.grid[row][col].isFlagged) {
                        this.grid[row][col].isFlagged = true;
                        this.updateCellDisplay(row, col);
                    }
                }
            }
            setTimeout(() => alert('恭喜你赢了！'), 100);
        } else {
            this.newGameBtn.textContent = '😵';
            this.revealAllMines();
            setTimeout(() => alert('游戏结束！'), 100);
        }
    }
}

// 当页面加载完成后初始化游戏
document.addEventListener('DOMContentLoaded', () => {
    new MinesweeperGame();
});