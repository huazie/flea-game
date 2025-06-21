class Game {
    constructor() {
        console.log('Game constructor initializing...');
        this.shudu = new Shudu();
        this.boardElement = document.getElementById('shuduBoard');
        this.numberSelector = document.getElementById('numberSelector');
        this.selectedCell = null;
        this.gameStarted = false;
        this.difficulty = 'easy';
        
        // 计时器相关属性
        this.timerElement = document.getElementById('timer');
        this.startTime = 0;
        this.elapsedTime = 0;
        this.timerInterval = null;

        // 设置事件监听器
        this.setupEventListeners();

        // 点击其他区域时隐藏数字选择器
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#numberSelector') && 
                !e.target.closest('.cell')) {
                this.hideNumberSelector();
            }
        });

        // 初始化游戏（异步操作）
        this.init();
    }
    
    async init() {
        // 检查是否有保存的游戏
        const savedGame = GameStorage.loadGame();
        if (savedGame) {
            const shouldContinue = await Dialog.confirm('发现保存的游戏，是否继续？');
            if (shouldContinue) {
                this.loadGame();
                return;
            }
        }

        // 如果没有加载保存的游戏，自动开始新游戏
        console.log('Starting new game automatically...');
        this.startNewGame();
    }

    startNewGame() {
        this.gameStarted = true;
        this.difficulty = document.getElementById('difficulty').value;
        this.shudu.generate(this.difficulty);
        this.shudu.initialBoard = this.createInitialBoardSnapshot(this.shudu.board);
        this.updateBoard();
        
        // 重置并启动计时器
        this.resetTimer();
        this.startTimer();
        
        // 更新最少用时显示
        this.updateMinTimer();

        Toast.success('新游戏已加载');
    }
    
    updateMinTimer() {
        const minTimerElement = document.getElementById('min-timer');
        if (!minTimerElement) return;
        
        const bestTime = GameStorage.getBestTime(this.difficulty);
        if (bestTime > 0) {
            minTimerElement.textContent = this.formatTime(bestTime);
        } else {
            minTimerElement.textContent = '--:--';
        }
    }
    
    // 计时器相关方法
    startTimer() {
        // 确保计时器元素存在
        if (!this.timerElement) {
            this.timerElement = document.getElementById('timer');
            if (!this.timerElement) {
                console.error('Timer element not found');
                return;
            }
        }

        // 清除现有计时器
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        
        // 设置开始时间，考虑已经过的时间
        this.startTime = Date.now() - (this.elapsedTime || 0);
        
        // 立即更新一次显示
        this.updateTimer();
        
        // 设置定时器，每秒更新一次
        this.timerInterval = setInterval(() => {
            this.updateTimer();
        }, 1000);
    }
    
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
            // 保存停止时的已用时间
            const currentTime = Date.now();
            this.elapsedTime = currentTime - this.startTime;
        }
    }
    
    resetTimer() {
        this.stopTimer();
        this.startTime = 0;
        this.elapsedTime = 0;
        if (this.timerElement) {
            this.timerElement.textContent = '00:00';
        }
    }
    
    updateTimer() {
        if (!this.startTime || !this.timerElement) return;
        
        const currentTime = Date.now();
        this.elapsedTime = currentTime - this.startTime;
        
        // 使用formatTime方法来格式化时间显示
        const formattedTime = this.formatTime(this.elapsedTime);
        
        // 更新显示
        this.timerElement.textContent = formattedTime;
    }
    
    formatTime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        // 根据时间长度自动格式化
        if (hours > 0) {
            return `${this.padZero(hours)}:${this.padZero(minutes)}:${this.padZero(seconds)}`;
        } else {
            return `${this.padZero(minutes)}:${this.padZero(seconds)}`;
        }
    }
    
    padZero(num) {
        return num.toString().padStart(2, '0');
    }

    updateBoard() {
        this.boardElement.innerHTML = '';
        
        if (!this.shudu.initialBoard) {
            this.shudu.initialBoard = this.createInitialBoardSnapshot(this.shudu.board);
        }
        
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = i;
                cell.dataset.col = j;

                const value = this.shudu.board[i][j];
                if (value !== 0) {
                    // 创建数字元素
                    const numberElement = document.createElement('span');
                    numberElement.className = 'number-display';
                    numberElement.textContent = value;
                    cell.appendChild(numberElement);
                    
                    if (this.shudu.initialBoard[i][j] !== 0) {
                        cell.classList.add('fixed');
                    } else {
                        cell.classList.add('filled');
                        
                        // 为非固定数字添加删除按钮
                        const deleteButton = document.createElement('span');
                        deleteButton.className = 'delete-button';
                        deleteButton.innerHTML = '×';
                        deleteButton.dataset.row = i;
                        deleteButton.dataset.col = j;
                        cell.appendChild(deleteButton);
                    }
                }

                this.boardElement.appendChild(cell);
            }
        }
    }

    handleCellClick(cell) {
        if (!this.gameStarted || cell.classList.contains('fixed')) {
            this.hideNumberSelector();
            return;
        }

        // 移除所有单元格的选中和相关状态
        document.querySelectorAll('.cell').forEach(c => {
            c.classList.remove('selected', 'related');
        });

        // 更新选中的单元格
        this.selectedCell = cell;
        cell.classList.add('selected');

        // 高亮相关单元格（同行、同列、同宫）
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);
        
        // 高亮同行
        for (let j = 0; j < 9; j++) {
            if (j !== col) {
                this.getCellElement(row, j)?.classList.add('related');
            }
        }
        
        // 高亮同列
        for (let i = 0; i < 9; i++) {
            if (i !== row) {
                this.getCellElement(i, col)?.classList.add('related');
            }
        }
        
        // 高亮同宫
        const boxRow = Math.floor(row / 3) * 3;
        const boxCol = Math.floor(col / 3) * 3;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const currentRow = boxRow + i;
                const currentCol = boxCol + j;
                if (currentRow !== row || currentCol !== col) {
                    this.getCellElement(currentRow, currentCol)?.classList.add('related');
                }
            }
        }

        // 显示数字选择器
        this.showNumberSelector(cell);
    }

    showNumberSelector(cell) {
        const rect = cell.getBoundingClientRect();
        
        // 先临时显示选择器以获取正确的尺寸
        this.numberSelector.style.visibility = 'hidden';
        this.numberSelector.classList.add('active');
        
        // 获取选择器的尺寸
        const selectorRect = this.numberSelector.getBoundingClientRect();
        
        // 计算最佳位置
        let left = rect.left + (rect.width - selectorRect.width) / 2;
        let top = rect.bottom + 8; // 默认显示在单元格下方

        // 检查是否超出视口边界
        if (top + selectorRect.height > window.innerHeight) {
            // 如果下方放不下，就显示在上方
            top = rect.top - selectorRect.height - 8;
        }
        if (left < 0) {
            left = 0;
        } else if (left + selectorRect.width > window.innerWidth) {
            left = window.innerWidth - selectorRect.width;
        }

        // 设置位置
        this.numberSelector.style.left = `${left}px`;
        this.numberSelector.style.top = `${top}px`;
        
        // 恢复可见性并确保选择器显示
        this.numberSelector.style.visibility = 'visible';
    }

    hideNumberSelector() {
        this.numberSelector.classList.remove('active');
    }

    getCellElement(row, col) {
        return this.boardElement.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    }

    handleNumberInput(number) {
        if (!this.selectedCell || !this.gameStarted) return;

        const row = parseInt(this.selectedCell.dataset.row);
        const col = parseInt(this.selectedCell.dataset.col);

        // 检查是否是初始固定数字
        if (this.shudu.initialBoard[row][col] !== 0) return;

        // 清除数字
        if (number === 0) {
            this.clearCell(row, col);
            this.hideNumberSelector();
            return;
        }

        // 填入数字
        this.shudu.board[row][col] = number;
        
        // 更新单元格显示
        this.selectedCell.innerHTML = '';
        
        // 创建数字元素
        const numberElement = document.createElement('span');
        numberElement.className = 'number-display';
        numberElement.textContent = number;
        this.selectedCell.appendChild(numberElement);
        
        // 添加删除按钮
        const deleteButton = document.createElement('span');
        deleteButton.className = 'delete-button';
        deleteButton.innerHTML = '×';
        deleteButton.dataset.row = row;
        deleteButton.dataset.col = col;
        this.selectedCell.appendChild(deleteButton);
        
        // 检查是否正确
        if (this.shudu.hasConflict(row, col, number)) {
            this.selectedCell.classList.add('error');
            this.selectedCell.classList.remove('filled');
            
            // 添加错误提示动画
            this.selectedCell.classList.add('shake');
            this.selectedCell.addEventListener('animationend', () => {
                this.selectedCell.classList.remove('error', 'shake');
                if (this.shudu.board[row][col] !== 0) {
                    this.selectedCell.classList.add('filled');
                }
            }, { once: true });
        } else {
            this.selectedCell.classList.remove('error');
            this.selectedCell.classList.add('filled');
            
            // 添加成功动画
            this.selectedCell.classList.add('pop');
            this.selectedCell.addEventListener('animationend', () => {
                this.selectedCell.classList.remove('pop');
                // 检查是否完成
                if (this.shudu.isComplete()) {
                    this.handleGameComplete();
                }
            }, { once: true });
        }

        // 隐藏数字选择器
        this.hideNumberSelector();
    }

    clearCell(row, col) {
        this.shudu.board[row][col] = 0;
        const cell = this.getCellElement(row, col);
        if (cell) {
            cell.innerHTML = '';
            cell.classList.remove('error', 'filled');
        }
    }

    handleDeleteButtonClick(deleteButton) {
        const row = parseInt(deleteButton.dataset.row);
        const col = parseInt(deleteButton.dataset.col);
        
        // 清除单元格
        this.clearCell(row, col);
        
        // 如果当前选中的是被删除的单元格，保持选中状态
        if (this.selectedCell && 
            parseInt(this.selectedCell.dataset.row) === row && 
            parseInt(this.selectedCell.dataset.col) === col) {
            this.selectedCell.classList.add('selected');
        }
    }

    handleGameComplete() {
        // 停止计时器
        this.stopTimer();
        
        // 保存最少用时
        const isNewRecord = GameStorage.saveBestTime(this.difficulty, this.elapsedTime);
        const bestTime = GameStorage.getBestTime(this.difficulty);
        
        // 移除所有高亮效果
        document.querySelectorAll('.cell').forEach(cell => {
            cell.classList.remove('selected', 'related');
        });

        setTimeout(() => {
            // 显示完成消息和最少用时
            const bestTimeFormatted = bestTime > 0 ? this.formatTime(bestTime) : '--:--';
            const message = isNewRecord 
                ? `恭喜！新纪录！用时: ${this.formatTime(this.elapsedTime)}\n最少用时: ${bestTimeFormatted}`
                : `恭喜！你完成了这局游戏！用时: ${this.formatTime(this.elapsedTime)}\n最少用时: ${bestTimeFormatted}`;
            
            Toast.success(message);
            
            // 添加胜利动画效果
            document.querySelectorAll('.cell').forEach((cell, index) => {
                setTimeout(() => {
                    cell.style.animation = 'victory 0.5s ease';
                }, index * 20);
            });
        }, 100);
    }

    saveGame() {
        if (!this.gameStarted) return;

        try {
            if (!this.shudu.initialBoard || !Array.isArray(this.shudu.initialBoard)) {
                this.shudu.initialBoard = this.createInitialBoardSnapshot(this.shudu.board);
            }

            const gameState = {
                board: this.shudu.board,
                solution: this.shudu.solution,
                initialBoard: this.shudu.initialBoard,
                difficulty: this.difficulty,
                elapsedTime: this.elapsedTime
            };

            if (GameStorage.saveGame(gameState)) {
                Toast.success('游戏已保存');
            } else {
                Toast.error('保存游戏失败');
            }
        } catch (error) {
            console.error('Failed to save game:', error);
            Toast.error('保存游戏失败');
        }
    }

    loadGame() {
        try {
            const savedGame = GameStorage.loadGame();
            if (!savedGame) {
                Toast.warning('没有找到保存的游戏');
                return;
            }

            this.shudu.board = savedGame.board;
            this.shudu.solution = savedGame.solution;
            this.shudu.initialBoard = savedGame.initialBoard;
            this.difficulty = savedGame.difficulty;
            this.gameStarted = true;
            
            // 恢复计时器状态
            if (savedGame.elapsedTime) {
                this.elapsedTime = savedGame.elapsedTime;
                // 确保计时器元素存在
                this.timerElement = document.getElementById('timer');
                // 立即更新显示
                this.timerElement.textContent = this.formatTime(this.elapsedTime);
            } else {
                this.resetTimer();
            }
            // 启动计时器
            this.startTimer();
            // 更新数独棋盘
            this.updateBoard();
            Toast.success('暂存游戏已加载');
        } catch (error) {
            console.error('Failed to load game:', error);
            Toast.error('加载游戏失败');
            GameStorage.clearSavedGame();
        }
    }
    
    createInitialBoardSnapshot(board) {
        const initialBoard = Array(9).fill().map(() => Array(9).fill(0));
        
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                if (board[i][j] !== 0 && board[i][j] === this.shudu.solution[i][j]) {
                    initialBoard[i][j] = board[i][j];
                }
            }
        }
        
        return initialBoard;
    }

    setupEventListeners() {
        // 处理返回按钮点击
        document.getElementById('back-button').addEventListener('click', () => {
            // 停止计时器
            this.stopTimer();
        });

        // 处理单元格点击
        this.boardElement.addEventListener('click', (e) => {
            // 处理删除按钮点击
            if (e.target.classList.contains('delete-button')) {
                e.stopPropagation(); // 阻止事件冒泡
                this.handleDeleteButtonClick(e.target);
                return;
            }
            
            // 处理单元格点击
            const cell = e.target.closest('.cell');
            if (cell) {
                this.handleCellClick(cell);
            }
        });

        // 处理数字按钮点击
        document.querySelectorAll('.number').forEach(button => {
            button.addEventListener('click', () => {
                const number = parseInt(button.dataset.number);
                this.handleNumberInput(number);
            });
        });

        // 处理橡皮擦按钮点击
        document.getElementById('eraser').addEventListener('click', () => {
            this.handleNumberInput(0);
        });

        // 处理键盘输入
        document.addEventListener('keydown', (e) => {
            if (this.selectedCell) {
                if (e.key >= '1' && e.key <= '9') {
                    this.handleNumberInput(parseInt(e.key));
                } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
                    this.handleNumberInput(0);
                } else if (e.key === 'Escape') {
                    this.selectedCell.classList.remove('selected');
                    document.querySelectorAll('.cell').forEach(cell => {
                        cell.classList.remove('related');
                    });
                    this.selectedCell = null;
                } else if (e.key.startsWith('Arrow')) {
                    this.handleArrowKey(e.key);
                }
            }
        });

        // 处理游戏控制按钮
        document.getElementById('newGame').addEventListener('click', async () => {
            if (!this.gameStarted || await Dialog.confirm('确定要开始新游戏吗？当前进度将丢失。')) {
                this.startNewGame();
            }
        });

        document.getElementById('saveGame').addEventListener('click', () => {
            if (this.gameStarted) {
                this.saveGame();
            }
        });

        document.getElementById('loadGame').addEventListener('click', async () => {
            if (!this.gameStarted || await Dialog.confirm('确定要加载保存的游戏吗？当前进度将丢失。')) {
                this.loadGame();
            }
        });
        
        // 处理难度切换
        document.getElementById('difficulty').addEventListener('change', () => {
            this.difficulty = document.getElementById('difficulty').value;
            this.updateMinTimer();
        });
    }

    handleArrowKey(key) {
        if (!this.selectedCell) return;

        const currentRow = parseInt(this.selectedCell.dataset.row);
        const currentCol = parseInt(this.selectedCell.dataset.col);
        let newRow = currentRow;
        let newCol = currentCol;

        switch (key) {
            case 'ArrowUp':
                newRow = Math.max(0, currentRow - 1);
                break;
            case 'ArrowDown':
                newRow = Math.min(8, currentRow + 1);
                break;
            case 'ArrowLeft':
                newCol = Math.max(0, currentCol - 1);
                break;
            case 'ArrowRight':
                newCol = Math.min(8, currentCol + 1);
                break;
        }

        if (newRow !== currentRow || newCol !== currentCol) {
            const newCell = this.getCellElement(newRow, newCol);
            if (newCell) {
                // 隐藏数字选择器
                this.hideNumberSelector();
                
                // 移除所有单元格的选中和相关状态
                document.querySelectorAll('.cell').forEach(c => {
                    c.classList.remove('selected', 'related');
                });

                // 更新选中的单元格
                this.selectedCell = newCell;
                newCell.classList.add('selected');

                // 高亮相关单元格
                this.highlightRelatedCells(newRow, newCol);

                // 显示数字选择器
                if (!newCell.classList.contains('fixed')) {
                    this.showNumberSelector(newCell);
                }

                // 添加平滑过渡效果
                newCell.classList.add('smooth-select');
                setTimeout(() => {
                    newCell.classList.remove('smooth-select');
                }, 200);
            }
        }
    }

    highlightRelatedCells(row, col) {
        // 高亮同行
        for (let j = 0; j < 9; j++) {
            if (j !== col) {
                this.getCellElement(row, j)?.classList.add('related');
            }
        }
        
        // 高亮同列
        for (let i = 0; i < 9; i++) {
            if (i !== row) {
                this.getCellElement(i, col)?.classList.add('related');
            }
        }
        
        // 高亮同宫
        const boxRow = Math.floor(row / 3) * 3;
        const boxCol = Math.floor(col / 3) * 3;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const currentRow = boxRow + i;
                const currentCol = boxCol + j;
                if (currentRow !== row || currentCol !== col) {
                    this.getCellElement(currentRow, currentCol)?.classList.add('related');
                }
            }
        }
    }
}

// 初始化游戏
document.addEventListener('DOMContentLoaded', () => {
    new Game();
});