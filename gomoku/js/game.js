class Gomoku {
    constructor() {
        // 确保viewport meta标签存在
        if (!document.querySelector('meta[name="viewport"]')) {
            const meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
            document.head.appendChild(meta);
        }

        this.canvas = document.getElementById("gomoku-board");
        this.ctx = this.canvas.getContext("2d");
        
        // 确保画布元素存在
        if (!this.canvas) {
            console.error('Canvas element not found!');
            return;
        }
        
        // 鼠标悬停位置
        this.hoverX = -1;
        this.hoverY = -1;

        // 确保画布在移动设备上有基本样式
        if (window.innerWidth <= 768) {
            this.canvas.style.width = '100%';
            this.canvas.style.maxWidth = '500px';
            this.canvas.style.height = 'auto';
        }
        
        // 设置画布尺寸 - 与CSS保持一致
        const boardContainer = document.querySelector('.board-container');
        if (boardContainer) {
            const rect = boardContainer.getBoundingClientRect();
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
            // 设置画布尺寸
        } else {
            // 回退设置
            this.canvas.width = 450;
            this.canvas.height = 450;
        }
        
        // 确保画布可见
        this.canvas.style.display = 'block';
        this.canvas.style.visibility = 'visible';
        
        this.storage = new GameStorage();
        
        // 初始化UI元素
        this.modeSelect = document.getElementById("mode-select");
        this.container = document.querySelector(".container");
        
        // 初始化页面显示状态
        this.modeSelect.style.display = 'flex';
        this.container.style.display = 'none';
        
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
        this.gameMode = 'free';
        
        // 设置初始画布大小
        this.resizeBoard();
        
        // 分数 - 初始化为0，会在startGame时根据模式加载
        this.blackScore = 0;
        this.whiteScore = 0;
        
        // 初始化游戏
        this.initGame();
        this.setupEventListeners();
        this.updateScoreDisplay();
    }
    
    // AI落子逻辑
    makeAIMove() {
        // 评分系统: 评估每个空位置的得分
        let bestScore = -1;
        let bestMoves = [];
        
        for (let i = 0; i < this.gridCount; i++) {
            for (let j = 0; j < this.gridCount; j++) {
                if (this.board[i][j] === 0) {
                    // 评估这个位置的得分
                    const score = this.evaluatePosition(i, j);
                    
                    // 记录最佳位置
                    if (score > bestScore) {
                        bestScore = score;
                        bestMoves = [{x: i, y: j}];
                    } else if (score === bestScore) {
                        bestMoves.push({x: i, y: j});
                    }
                }
            }
        }
        
        // 如果有多个最佳位置，随机选择一个
        if (bestMoves.length > 0) {
            const bestMove = bestMoves[Math.floor(Math.random() * bestMoves.length)];
            this.placePiece(bestMove.x, bestMove.y);
        }
    }
    
    // 评估位置得分
    evaluatePosition(x, y) {
        // 模拟落子
        this.board[x][y] = 2; // AI是白棋(2)
        
        // 检查AI是否能直接获胜
        if (this.checkWin(x, y)) {
            this.board[x][y] = 0; // 恢复空位置
            return 1000; // 最高优先级
        }
        
        // 检查玩家是否能直接获胜(需要防守)
        this.board[x][y] = 1; // 假设玩家(黑棋)落子
        if (this.checkWin(x, y)) {
            this.board[x][y] = 0; // 恢复空位置
            return 900; // 高优先级防守
        }
        this.board[x][y] = 0; // 恢复空位置
        
        // 评估棋型得分
        let score = 0;
        const directions = [
            [1, 0], [0, 1], [1, 1], [1, -1] // 水平、垂直、对角线
        ];
        
        for (const [dx, dy] of directions) {
            // 评估AI棋型
            score += this.evaluateLine(x, y, dx, dy, 2) * 2;
            
            // 评估玩家棋型(防守)
            score += this.evaluateLine(x, y, dx, dy, 1);
        }
        
        // 中心位置加分(开局策略)
        const centerDist = Math.abs(x - 7) + Math.abs(y - 7);
        score += (14 - centerDist) * 2;
        
        return score;
    }
    
    // 评估一条线上的棋型
    evaluateLine(x, y, dx, dy, player) {
        let score = 0;
        let count = 1; // 当前连续棋子数
        let emptyEnds = 0; // 开放端数量
        
        // 正向检查
        for (let i = 1; i < 5; i++) {
            const nx = x + dx * i;
            const ny = y + dy * i;
            
            if (nx >= 0 && nx < this.gridCount && ny >= 0 && ny < this.gridCount) {
                if (this.board[nx][ny] === player) {
                    count++;
                } else if (this.board[nx][ny] === 0) {
                    emptyEnds++;
                    break;
                } else {
                    break;
                }
            }
        }
        
        // 反向检查
        for (let i = 1; i < 5; i++) {
            const nx = x - dx * i;
            const ny = y - dy * i;
            
            if (nx >= 0 && nx < this.gridCount && ny >= 0 && ny < this.gridCount) {
                if (this.board[nx][ny] === player) {
                    count++;
                } else if (this.board[nx][ny] === 0) {
                    emptyEnds++;
                    break;
                } else {
                    break;
                }
            }
        }
        
        // 根据棋型评分
        if (count >= 4) {
            score += 100; // 活四或冲四
        } else if (count === 3) {
            if (emptyEnds === 2) {
                score += 50; // 活三
            } else if (emptyEnds === 1) {
                score += 30; // 眠三
            }
        } else if (count === 2) {
            if (emptyEnds === 2) {
                score += 10; // 活二
            } else if (emptyEnds === 1) {
                score += 5; // 眠二
            }
        }
        
        return score;
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
        this.hoverX = -1;
        this.hoverY = -1;
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
        
        // 绘制鼠标悬停位置的棋子虚影
        this.drawHoverPiece(this.hoverX, this.hoverY);
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
    
    // 绘制棋子虚影
    drawHoverPiece(x, y) {
        if (x < 0 || x >= this.gridCount || y < 0 || y >= this.gridCount || this.board[x][y] !== 0 || this.gameOver) {
            return;
        }
        
        const centerX = x * this.gridSize + this.gridSize / 2;
        const centerY = y * this.gridSize + this.gridSize / 2;
        
        // 绘制半透明的棋子虚影
        this.ctx.globalAlpha = 0.5;
        this.ctx.fillStyle = this.currentPlayer === 1 ? this.colors.blackPiece : this.colors.whitePiece;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, this.pieceRadius, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 如果是白棋，添加高光效果
        if (this.currentPlayer === 2) {
            this.ctx.strokeStyle = this.colors.whitePieceBorder;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, this.pieceRadius, 0, Math.PI * 2);
            this.ctx.stroke();
        }
        
        // 恢复透明度
        this.ctx.globalAlpha = 1.0;
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
            this.storage.saveGameScores(this.gameMode, this.blackScore, this.whiteScore);
            this.showGameOverMessage();
        } else {
            // 切换玩家
            this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
            this.updateCurrentPlayerDisplay();
            
            // 在AI模式下，玩家落子后自动触发AI落子
            if (!this.gameOver && this.gameMode === 'ai' && this.currentPlayer === 2) {
                setTimeout(() => {
                    this.makeAIMove();
                }, 500);
            }
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
        // 更新模式显示
        const modeDisplay = document.getElementById('current-mode-display');
        if (modeDisplay) {
            modeDisplay.textContent = this.gameMode === 'free' ? '自由对战' : '人机对战';
        }
        
        // 更新分数显示
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
    
    // 调整棋盘大小 - 手机端优化
    resizeBoard() {
        const boardContainer = this.canvas.parentElement;
        
        // 确保容器存在且已渲染
        if (!boardContainer || boardContainer.clientWidth === 0) {
            // 最多重试5次，每次间隔100ms
            if (this.resizeRetryCount === undefined) {
                this.resizeRetryCount = 0;
            } else if (this.resizeRetryCount >= 5) {
                console.warn('Failed to get container size after multiple retries');
                return;
            }
            this.resizeRetryCount++;
            setTimeout(() => this.resizeBoard(), 100);
            return;
        }
        this.resizeRetryCount = 0;
        
        // 计算可用空间
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        // 确保最小尺寸
        const minSize = 300; // 最小棋盘尺寸
        const maxSize = Math.min(windowWidth, 500) - 40; // 最大尺寸减去边距
        
        // 计算最终尺寸
        let size = minSize; // 默认最小尺寸
        if (boardContainer.clientWidth > 0 && boardContainer.clientHeight > 0) {
            size = Math.min(
                Math.min(boardContainer.clientWidth, boardContainer.clientHeight),
                maxSize
            );
            size = Math.max(size, minSize); // 确保不小于最小尺寸
        }
        
        // 设置画布大小
        this.canvas.width = size;
        this.canvas.height = size;
        
        // 更新棋盘大小和格子大小
        this.boardSize = size;
        this.gridSize = this.boardSize / this.gridCount;
        this.pieceRadius = this.gridSize * 0.4;
        
        // 重绘棋盘，但不强制更新颜色
        this.drawBoard(false);
        
        // 手机端额外处理
        if (window.innerWidth <= 768) {
            this.canvas.style.touchAction = 'none'; // 禁用默认触摸行为
            this.canvas.style.webkitTapHighlightColor = 'transparent'; // 移除点击高亮
            this.canvas.style.width = '100%';
            this.canvas.style.maxWidth = '500px';
            this.canvas.style.height = 'auto';
            this.canvas.style.margin = '0 auto';
        }
    }
    
    // 开始游戏
    startGame(mode) {
        this.gameMode = mode;
        this.modeSelect.style.display = 'none';
        this.container.style.display = 'block';
        
        // 确保画布可见
        this.canvas.style.display = 'block';
        this.canvas.style.visibility = 'visible';
        
        // 重置画布尺寸
        this.resizeBoard();
        
        // 检查容器和画布的实际尺寸
        const containerRect = this.container.getBoundingClientRect();
        const canvasRect = this.canvas.getBoundingClientRect();
        
        // 加载当前模式的分数
        const scores = this.storage.loadGameScores(this.gameMode);
        this.blackScore = scores.black;
        this.whiteScore = scores.white;
        
        this.resetGame();
        this.drawBoard(true); // 强制重绘
        this.updateCurrentPlayerDisplay();
        this.updateScoreDisplay();
    }

    // 显示模式选择页面
    showModeSelect() {
        this.modeSelect.style.display = 'flex';
        this.container.style.display = 'none';
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
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            let x, y;
            
            // 判断是触摸事件还是鼠标事件
            if (event.type === 'touchstart' || event.type === 'touchend') {
                // 触摸事件
                const touch = event.changedTouches[0];
                x = (touch.clientX - rect.left) * scaleX;
                y = (touch.clientY - rect.top) * scaleY;
            } else {
                // 鼠标事件
                x = (event.clientX - rect.left) * scaleX;
                y = (event.clientY - rect.top) * scaleY;
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
        
        // 添加鼠标移动事件监听器
        this.canvas.addEventListener("mousemove", (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            
            // 计算鼠标所在的格子坐标
            const gridX = Math.floor(x / this.gridSize);
            const gridY = Math.floor(y / this.gridSize);
            
            // 如果鼠标位置改变，重绘棋盘
            if (this.hoverX !== gridX || this.hoverY !== gridY) {
                this.hoverX = gridX;
                this.hoverY = gridY;
                this.drawBoard();
            }
        });
        
        // 添加鼠标离开事件监听器
        this.canvas.addEventListener("mouseleave", () => {
            // 鼠标离开画布时，清除悬停位置并重绘棋盘
            this.hoverX = -1;
            this.hoverY = -1;
            this.drawBoard();
        });
        
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

        // 模式选择按钮
        document.getElementById("free-mode-btn").addEventListener("click", () => {
            this.startGame('free');
        });
        
        document.getElementById("ai-mode-btn").addEventListener("click", () => {
            this.startGame('ai');
        });
        
        // 监听主题变化事件
        document.addEventListener('themeChanged', () => {
            this.drawBoard(true); // 强制更新颜色
        });

        // 监听beforeBack事件
        window.addEventListener('beforeBack', (e) => {
            if (this.container.style.display !== 'none') {
                this.showModeSelect();
                e.detail.defaultPrevented = true;
            }
        });
    }
}

// 当页面加载完成后初始化游戏
document.addEventListener("DOMContentLoaded", () => {
    new Gomoku();
});