class Gomoku {
    constructor() {
        this.canvas = document.getElementById("gomoku-board");
        this.ctx = this.canvas.getContext("2d");
        this.storage = new GameStorage();
        
        // 初始化颜色配置
        this.colors = {};
        
        // 棋盘大小和格子数
        this.boardSize = 450;
        this.gridCount = 15;
        this.gridSize = this.boardSize / this.gridCount;
        
        // 棋子半径
        this.pieceRadius = this.gridSize * 0.4;
        
        // 游戏状态
        this.board = Array(this.gridCount).fill().map(() => Array(this.gridCount).fill(0));
        this.currentPlayer = 1; // 1: 黑棋, 2: 白棋
        this.gameOver = false;
        this.moveHistory = [];
        
        // 设置初始画布大小
        this.resizeBoard();
        
        // 分数
        const savedScores = this.storage.loadGameScores();
        this.blackScore = savedScores.black;
        this.whiteScore = savedScores.white;
        
        // 初始化游戏
        this.initGame();
        this.setupEventListeners();
        this.updateScoreDisplay();
    }
    
    // 初始化游戏
    initGame() {
        // 尝试加载保存的游戏状态
        const savedState = this.storage.loadGameState();
        
        if (savedState) {
            this.board = savedState.board;
            this.currentPlayer = savedState.currentPlayer;
            this.gameOver = savedState.gameOver;
            this.moveHistory = savedState.moveHistory;
        } else {
            this.resetGame();
        }
        
        // 初始化时更新颜色，然后绘制棋盘
        this.updateColors();
        this.drawBoard();
        this.updateCurrentPlayerDisplay();
        
        if (this.gameOver) {
            this.showGameOverMessage();
        }
    }
    
    // 重置游戏
    resetGame() {
        this.board = Array(this.gridCount).fill().map(() => Array(this.gridCount).fill(0));
        this.currentPlayer = 1;
        this.gameOver = false;
        this.moveHistory = [];
        this.hideGameOverMessage();
        this.storage.clearGameState();
    }
    
    // 获取CSS变量值
    getCssVariable(name) {
        return getComputedStyle(document.body).getPropertyValue(name).trim();
    }

    // 更新颜色配置
    updateColors() {
        this.colors = {
            boardBackground: this.getCssVariable('--bg-board'),
            gridLine: this.getCssVariable('--board-line'),
            blackPiece: this.getCssVariable('--stone-black'),
            whitePiece: this.getCssVariable('--stone-white'),
            whitePieceBorder: this.getCssVariable('--stone-white'),
            pieceShadow: "rgba(0, 0, 0, 0.5)",
            starPoint: this.getCssVariable('--board-line')
        };
    }

    // 绘制棋盘
    drawBoard(forceUpdateColors = false) {
        // 只在必要时更新颜色
        if (forceUpdateColors) {
            this.updateColors();
        }
        // 清空画布
        this.ctx.clearRect(0, 0, this.boardSize, this.boardSize);
        
        // 绘制棋盘背景
        this.ctx.fillStyle = this.colors.boardBackground;
        this.ctx.fillRect(0, 0, this.boardSize, this.boardSize);
        
        // 绘制网格线
        this.ctx.strokeStyle = this.colors.gridLine;
        this.ctx.lineWidth = 1;
        
        for (let i = 0; i < this.gridCount; i++) {
            // 横线
            this.ctx.beginPath();
            this.ctx.moveTo(this.gridSize / 2, i * this.gridSize + this.gridSize / 2);
            this.ctx.lineTo(this.boardSize - this.gridSize / 2, i * this.gridSize + this.gridSize / 2);
            this.ctx.stroke();
            
            // 竖线
            this.ctx.beginPath();
            this.ctx.moveTo(i * this.gridSize + this.gridSize / 2, this.gridSize / 2);
            this.ctx.lineTo(i * this.gridSize + this.gridSize / 2, this.boardSize - this.gridSize / 2);
            this.ctx.stroke();
        }
        
        // 绘制天元和星位
        const starPoints = [3, 7, 11];
        for (let i of starPoints) {
            for (let j of starPoints) {
                this.drawStarPoint(i, j);
            }
        }
        
        // 绘制棋子
        for (let i = 0; i < this.gridCount; i++) {
            for (let j = 0; j < this.gridCount; j++) {
                if (this.board[i][j] !== 0) {
                    this.drawPiece(i, j, this.board[i][j]);
                }
            }
        }
    }
    
    // 绘制星位点
    drawStarPoint(x, y) {
        this.ctx.fillStyle = this.colors.starPoint;
        this.ctx.beginPath();
        this.ctx.arc(
            x * this.gridSize + this.gridSize / 2,
            y * this.gridSize + this.gridSize / 2,
            3,
            0,
            Math.PI * 2
        );
        this.ctx.fill();
    }
    
    // 绘制棋子
    drawPiece(x, y, player) {
        const centerX = x * this.gridSize + this.gridSize / 2;
        const centerY = y * this.gridSize + this.gridSize / 2;
        
        // 绘制阴影
        this.ctx.shadowColor = this.colors.pieceShadow;
        this.ctx.shadowBlur = 3;
        this.ctx.shadowOffsetX = 2;
        this.ctx.shadowOffsetY = 2;
        
        // 绘制棋子
        this.ctx.fillStyle = player === 1 ? this.colors.blackPiece : this.colors.whitePiece;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, this.pieceRadius, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 重置阴影
        this.ctx.shadowColor = "transparent";
        this.ctx.shadowBlur = 0;
        this.ctx.shadowOffsetX = 0;
        this.ctx.shadowOffsetY = 0;
        
        // 如果是白棋，添加高光效果
        if (player === 2) {
            this.ctx.strokeStyle = this.colors.whitePieceBorder;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, this.pieceRadius, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }
    
    // 处理落子
    placePiece(x, y) {
        if (this.gameOver || this.board[x][y] !== 0) {
            return false;
        }
        
        this.board[x][y] = this.currentPlayer;
        this.moveHistory.push({ x, y, player: this.currentPlayer });
        
        // 检查是否获胜
        if (this.checkWin(x, y)) {
            this.gameOver = true;
            if (this.currentPlayer === 1) {
                this.blackScore++;
            } else {
                this.whiteScore++;
            }
            this.updateScoreDisplay();
            this.storage.saveGameScores(this.blackScore, this.whiteScore);
            this.showGameOverMessage();
        } else {
            // 切换玩家
            this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
            this.updateCurrentPlayerDisplay();
        }
        
        // 保存游戏状态
        this.saveGameState();
        
        // 重绘棋盘
        this.drawBoard();
        
        return true;
    }
    
    // 检查是否获胜
    checkWin(x, y) {
        const directions = [
            [1, 0],   // 水平
            [0, 1],   // 垂直
            [1, 1],   // 右下对角线
            [1, -1]   // 右上对角线
        ];
        
        const player = this.board[x][y];
        
        for (const [dx, dy] of directions) {
            let count = 1;
            
            // 正向检查
            for (let i = 1; i < 5; i++) {
                const nx = x + dx * i;
                const ny = y + dy * i;
                
                if (nx >= 0 && nx < this.gridCount && ny >= 0 && ny < this.gridCount && this.board[nx][ny] === player) {
                    count++;
                } else {
                    break;
                }
            }
            
            // 反向检查
            for (let i = 1; i < 5; i++) {
                const nx = x - dx * i;
                const ny = y - dy * i;
                
                if (nx >= 0 && nx < this.gridCount && ny >= 0 && ny < this.gridCount && this.board[nx][ny] === player) {
                    count++;
                } else {
                    break;
                }
            }
            
            if (count >= 5) {
                return true;
            }
        }
        
        return false;
    }
    
    // 悔棋
    undoMove() {
        if (this.moveHistory.length === 0 || this.gameOver) {
            return;
        }
        
        const lastMove = this.moveHistory.pop();
        this.board[lastMove.x][lastMove.y] = 0;
        this.currentPlayer = lastMove.player;
        this.saveGameState();
        this.drawBoard();
        this.updateCurrentPlayerDisplay();
    }
    
    // 保存游戏状态
    saveGameState() {
        const gameState = {
            board: this.board,
            currentPlayer: this.currentPlayer,
            gameOver: this.gameOver,
            moveHistory: this.moveHistory
        };
        
        this.storage.saveGameState(gameState);
    }
    
    // 更新当前玩家显示
    updateCurrentPlayerDisplay() {
        const playerDisplay = document.getElementById("current-player");
        playerDisplay.textContent = this.currentPlayer === 1 ? "黑方" : "白方";
    }
    
    // 更新分数显示
    updateScoreDisplay() {
        document.getElementById("black-score").textContent = this.blackScore;
        document.getElementById("white-score").textContent = this.whiteScore;
    }
    
    // 显示游戏结束消息
    showGameOverMessage() {
        const messageContainer = document.querySelector(".game-message");
        const messageText = document.querySelector(".game-message p");
        
        messageText.textContent = this.currentPlayer === 1 ? "黑方 获胜" : "白方 获胜";
        messageContainer.classList.add("game-over");
    }
    
    // 隐藏游戏结束消息
    hideGameOverMessage() {
        const messageContainer = document.querySelector(".game-message");
        messageContainer.classList.remove("game-over");
    }
    
    // 调整棋盘大小
    resizeBoard() {
        const boardContainer = this.canvas.parentElement;
        const containerWidth = boardContainer.clientWidth;
        const containerHeight = boardContainer.clientHeight;
        
        // 使用容器的较小边作为棋盘的大小
        const size = Math.min(containerWidth, containerHeight);
        
        // 设置画布大小
        this.canvas.width = size;
        this.canvas.height = size;
        
        // 更新棋盘大小和格子大小
        this.boardSize = size;
        this.gridSize = this.boardSize / this.gridCount;
        this.pieceRadius = this.gridSize * 0.4;
        
        // 重绘棋盘，但不强制更新颜色
        this.drawBoard(false);
    }
    
    // 设置事件监听器
    setupEventListeners() {
        // 处理点击或触摸事件的通用函数
        const handleInteraction = (event) => {
            if (this.gameOver) {
                return;
            }
            
            // 阻止默认行为，防止滚动和缩放
            event.preventDefault();
            
            const rect = this.canvas.getBoundingClientRect();
            let x, y;
            
            // 判断是触摸事件还是鼠标事件
            if (event.type === 'touchstart' || event.type === 'touchend') {
                // 触摸事件
                const touch = event.changedTouches[0];
                x = touch.clientX - rect.left;
                y = touch.clientY - rect.top;
            } else {
                // 鼠标事件
                x = event.clientX - rect.left;
                y = event.clientY - rect.top;
            }
            
            // 计算点击的格子坐标
            const gridX = Math.floor(x / this.gridSize);
            const gridY = Math.floor(y / this.gridSize);
            
            if (gridX >= 0 && gridX < this.gridCount && gridY >= 0 && gridY < this.gridCount) {
                this.placePiece(gridX, gridY);
            }
        };
        
        // 棋盘点击事件
        this.canvas.addEventListener("click", handleInteraction);
        
        // 棋盘触摸事件
        this.canvas.addEventListener("touchend", handleInteraction, { passive: false });
        
        // 防止长按出现上下文菜单
        this.canvas.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            return false;
        });
        
        // 防止双击缩放
        this.canvas.addEventListener("touchstart", (event) => {
            event.preventDefault();
        }, { passive: false });
        
        // 窗口大小调整事件
        window.addEventListener("resize", () => {
            this.resizeBoard();
        });
        
        // 新游戏按钮
        document.getElementById("new-game-button").addEventListener("click", () => {
            this.resetGame();
            this.drawBoard();
            this.updateCurrentPlayerDisplay();
        });
        
        // 悔棋按钮
        document.getElementById("undo-button").addEventListener("click", () => {
            this.undoMove();
        });
        
        // 再来一局按钮
        document.querySelector(".retry-button").addEventListener("click", () => {
            this.resetGame();
            this.drawBoard();
            this.updateCurrentPlayerDisplay();
        });
        
        // 监听主题变化事件
        document.addEventListener('themeChanged', () => {
            this.drawBoard(true); // 强制更新颜色
        });
    }
}

// 当页面加载完成后初始化游戏
document.addEventListener("DOMContentLoaded", () => {
    new Gomoku();
});