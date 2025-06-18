import GameStorage from './storage.js';

class SnakeGame {
    constructor() {
        this.canvas = document.getElementById('game-board');
        this.ctx = this.canvas.getContext('2d');
        this.scoreElement = document.getElementById('score');
        this.bestScoreElement = document.getElementById('best-score');
        this.startBtn = document.getElementById('start-btn');
        this.restartBtn = document.getElementById('restart-btn');
        this.boardContainer = document.querySelector('.game-board-container');

        // 游戏配置
        this.tileCount = 20; // 减少网格数量以适应更小的视图
        this.speed = 10;

        // 初始化画布大小
        this.initCanvas();

        // 初始化游戏状态
        this.reset();

        // 绑定事件处理器
        this.bindEvents();

        // 初始渲染
        this.draw();

        // 添加窗口大小改变的监听
        window.addEventListener('resize', () => {
            this.initCanvas();
            this.draw();
        });
        
        // 添加主题变化的监听
        document.addEventListener('themeChanged', () => {
            const currentTheme = document.body.dataset.theme || 'light';
            this.draw(); // 重新绘制画布以应用新主题
        });
    }

    initCanvas() {
        // 获取容器的大小
        const containerRect = this.boardContainer.getBoundingClientRect();
        const size = Math.min(containerRect.width, containerRect.height);
        
        // 设置画布大小
        this.canvas.width = size;
        this.canvas.height = size;
        
        // 计算瓦片大小
        this.tileSize = size / this.tileCount;
    }

    loadBestScore() {
        return GameStorage.getBestScore();
    }

    saveBestScore(score) {
        GameStorage.saveBestScore(score);
    }

    reset() {
        // 初始化蛇的位置和方向 - 使用相对位置而不是固定位置
        const centerX = Math.floor(this.tileCount / 2);
        const centerY = Math.floor(this.tileCount / 2);
        this.snake = [
            { x: centerX, y: centerY },
            { x: centerX - 1, y: centerY },
            { x: centerX - 2, y: centerY }
        ];
        this.direction = { x: 1, y: 0 };
        this.nextDirection = { x: 1, y: 0 };

        // 初始化游戏状态
        this.score = 0;
        this.bestScore = this.loadBestScore();
        console.log("重置时加载的最高分：" + this.bestScore); // 添加调试日志
        this.isGameOver = false;
        this.isPaused = true;
        this.isGameStarted = false; // 添加新状态来跟踪游戏是否已经开始

        // 生成第一个食物
        this.generateFood();

        // 更新分数显示
        this.updateScore();
        this.updateBestScore();

        // 更新按钮状态
        this.updateButtons();
    }

    bindEvents() {
        // 键盘控制
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));

        // 按钮点击事件
        this.startBtn.addEventListener('click', () => this.togglePause());
        this.restartBtn.addEventListener('click', () => this.restart());
    }

    handleKeyPress(e) {
        const key = e.key.toLowerCase();

        // 处理方向键和WASD
        switch (key) {
            case 'arrowup':
            case 'w':
                if (this.direction.y !== 1) {
                    this.nextDirection = { x: 0, y: -1 };
                }
                break;
            case 'arrowdown':
            case 's':
                if (this.direction.y !== -1) {
                    this.nextDirection = { x: 0, y: 1 };
                }
                break;
            case 'arrowleft':
            case 'a':
                if (this.direction.x !== 1) {
                    this.nextDirection = { x: -1, y: 0 };
                }
                break;
            case 'arrowright':
            case 'd':
                if (this.direction.x !== -1) {
                    this.nextDirection = { x: 1, y: 0 };
                }
                break;
            case ' ':
                e.preventDefault(); // 防止空格键滚动页面
                this.togglePause();
                break;
        }
    }

    generateFood() {
        do {
            this.food = {
                x: Math.floor(Math.random() * this.tileCount),
                y: Math.floor(Math.random() * this.tileCount)
            };
        } while (this.snake.some(segment => 
            segment.x === this.food.x && segment.y === this.food.y));
    }

    move() {
        if (this.isPaused || this.isGameOver) return;

        // 更新方向
        this.direction = this.nextDirection;

        // 计算新的头部位置
        const head = { ...this.snake[0] };
        head.x += this.direction.x;
        head.y += this.direction.y;

        // 检查碰撞
        if (this.checkCollision(head)) {
            this.gameOver();
            return;
        }

        // 移动蛇
        this.snake.unshift(head);

        // 检查是否吃到食物
        if (head.x === this.food.x && head.y === this.food.y) {
            this.score += 10;
            this.updateScore();
            this.generateFood();
        } else {
            this.snake.pop();
        }
    }

    checkCollision(head) {
        // 检查墙壁碰撞
        if (head.x < 0 || head.x >= this.tileCount ||
            head.y < 0 || head.y >= this.tileCount) {
            return true;
        }

        // 检查自身碰撞
        return this.snake.some(segment =>
            segment.x === head.x && segment.y === head.y);
    }

    draw() {
        // 获取并记录所有颜色 - 从body元素获取计算样式
        const style = getComputedStyle(document.body);
        const boardBgColor = style.getPropertyValue('--board-bg').trim();
        const snakeColor = style.getPropertyValue('--snake-color').trim();
        const foodColor = style.getPropertyValue('--food-color').trim();
        const gameOverTextColor = style.getPropertyValue('--game-over-text').trim();
            
        // 打印所有颜色，以便调试主题切换
        console.log('当前主题颜色：', {
            boardBgColor,
            snakeColor,
            foodColor,
            gameOverTextColor
        });
            
        // 清空画布
        this.ctx.fillStyle = boardBgColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 绘制蛇
        this.snake.forEach((segment, index) => {
            this.ctx.fillStyle = snakeColor;
            this.ctx.fillRect(
                segment.x * this.tileSize,
                segment.y * this.tileSize,
                this.tileSize - 1,
                this.tileSize - 1
            );
        });

        // 绘制食物
        this.ctx.fillStyle = foodColor;
        this.ctx.fillRect(
            this.food.x * this.tileSize,
            this.food.y * this.tileSize,
            this.tileSize - 1,
            this.tileSize - 1
        );

        // 游戏结束显示
        if (this.isGameOver) {
            // 添加半透明背景以增强文本可读性
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            // 使用CSS变量获取游戏结束文本颜色 - 从body元素获取
            const gameOverTextColor = getComputedStyle(document.body).getPropertyValue('--game-over-text').trim();
            console.log('游戏结束文本颜色:', gameOverTextColor); // 添加调试日志
            this.ctx.fillStyle = gameOverTextColor;
            // 根据画布大小调整字体大小
            const fontSize = Math.max(16, Math.min(32, this.canvas.width / 10));
            this.ctx.font = `${fontSize}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('游戏结束!', this.canvas.width / 2, this.canvas.height / 2);
            
            // 添加分数显示
            const smallerFontSize = fontSize * 0.7;
            this.ctx.font = `${smallerFontSize}px Arial`;
            this.ctx.fillText(`最终得分: ${this.score}`, this.canvas.width / 2, this.canvas.height / 2 + fontSize);
        }
    }

    gameLoop() {
        if (this.isPaused || this.isGameOver) {
            return; // 如果游戏暂停或结束，不继续游戏循环
        }
        
        this.move();
        this.draw();

        // 使用setTimeout和requestAnimationFrame结合控制游戏速度
        setTimeout(() => {
            if (!this.isPaused && !this.isGameOver) {
                requestAnimationFrame(() => this.gameLoop());
            }
        }, 1000 / this.speed);
    }

    togglePause() {
        if (this.isGameOver) return;

        this.isPaused = !this.isPaused;
        
        // 如果这是游戏第一次启动
        if (!this.isGameStarted && !this.isPaused) {
            this.isGameStarted = true;
        }
        
        this.updateButtons();

        if (!this.isPaused) {
            // 确保游戏循环重新启动
            requestAnimationFrame(() => this.gameLoop());
        }
    }

    restart() {
        this.reset();
        this.isPaused = false;
        this.isGameStarted = true;
        this.updateButtons();
        this.draw();
        // 启动游戏循环
        requestAnimationFrame(() => this.gameLoop());
    }

    gameOver() {
        this.isGameOver = true;
        this.isPaused = true;
        
        // 检查是否更新最高分
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            this.saveBestScore(this.bestScore);
            this.updateBestScore();
        }
        
        this.updateButtons();
    }

    updateScore() {
        this.scoreElement.textContent = this.score;
        
        // 实时更新最高分：如果当前分数高于最高分，立即更新最高分
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            this.saveBestScore(this.bestScore);
            this.updateBestScore();
            console.log("最高分已更新为：" + this.bestScore); // 添加调试日志
        }
    }

    updateBestScore() {
        if (this.bestScoreElement) {
            this.bestScoreElement.textContent = this.bestScore;
            console.log("更新UI上的最高分显示为：" + this.bestScore); // 添加调试日志
        } else {
            console.error("bestScoreElement not found!"); // 添加错误日志
        }
    }

    updateButtons() {
        this.startBtn.textContent = this.isPaused ? '开始游戏' : '暂停游戏';
        this.startBtn.disabled = this.isGameOver;
    }
}

// 当页面加载完成后初始化游戏
window.addEventListener('load', () => {
    new SnakeGame();
});