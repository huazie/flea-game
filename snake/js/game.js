class SnakeGame {
    constructor() {
        this.canvas = document.getElementById('game-board');
        this.ctx = this.canvas.getContext('2d');
        this.scoreElement = document.getElementById('score');
        this.startBtn = document.getElementById('start-btn');
        this.restartBtn = document.getElementById('restart-btn');
        this.themeToggleBtn = document.getElementById('theme-toggle-btn');

        // 游戏配置
        this.tileSize = 20;
        this.tileCount = 30;
        this.speed = 10;

        // 初始化画布大小
        this.initCanvas();

        // 初始化游戏状态
        this.reset();

        // 绑定事件处理器
        this.bindEvents();

        // 初始主题
        this.isDarkMode = false;
        this.updateTheme();

        // 初始渲染
        this.draw();
    }

    initCanvas() {
        // 设置画布大小
        this.canvas.width = this.tileSize * this.tileCount;
        this.canvas.height = this.tileSize * this.tileCount;
    }

    reset() {
        // 初始化蛇的位置和方向
        this.snake = [
            { x: 15, y: 15 },
            { x: 14, y: 15 },
            { x: 13, y: 15 }
        ];
        this.direction = { x: 1, y: 0 };
        this.nextDirection = { x: 1, y: 0 };

        // 初始化游戏状态
        this.score = 0;
        this.isGameOver = false;
        this.isPaused = true;

        // 生成第一个食物
        this.generateFood();

        // 更新分数显示
        this.updateScore();

        // 更新按钮状态
        this.updateButtons();
    }

    bindEvents() {
        // 键盘控制
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));

        // 按钮点击事件
        this.startBtn.addEventListener('click', () => this.togglePause());
        this.restartBtn.addEventListener('click', () => this.restart());
        this.themeToggleBtn.addEventListener('click', () => this.toggleTheme());
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
        // 清空画布
        this.ctx.fillStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--board-bg');
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 绘制蛇
        const snakeColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--snake-color');
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
        const foodColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--food-color');
        this.ctx.fillStyle = foodColor;
        this.ctx.fillRect(
            this.food.x * this.tileSize,
            this.food.y * this.tileSize,
            this.tileSize - 1,
            this.tileSize - 1
        );

        // 游戏结束显示
        if (this.isGameOver) {
            this.ctx.fillStyle = this.isDarkMode ? '#fff' : '#000';
            this.ctx.font = '48px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('游戏结束!', this.canvas.width / 2, this.canvas.height / 2);
        }
    }

    gameLoop() {
        this.move();
        this.draw();

        if (!this.isGameOver) {
            setTimeout(() => {
                requestAnimationFrame(() => this.gameLoop());
            }, 1000 / this.speed);
        }
    }

    togglePause() {
        if (this.isGameOver) return;

        this.isPaused = !this.isPaused;
        this.updateButtons();

        if (!this.isPaused) {
            this.gameLoop();
        }
    }

    restart() {
        this.reset();
        this.draw();
    }

    gameOver() {
        this.isGameOver = true;
        this.isPaused = true;
        this.updateButtons();
    }

    updateScore() {
        this.scoreElement.textContent = this.score;
    }

    updateButtons() {
        this.startBtn.textContent = this.isPaused ? '开始游戏' : '暂停游戏';
        this.startBtn.disabled = this.isGameOver;
    }

    toggleTheme() {
        this.isDarkMode = !this.isDarkMode;
        this.updateTheme();
    }

    updateTheme() {
        document.documentElement.setAttribute(
            'data-theme',
            this.isDarkMode ? 'dark' : 'light'
        );
    }
}

// 当页面加载完成后初始化游戏
window.addEventListener('load', () => {
    new SnakeGame();
});