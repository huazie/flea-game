// 移动端触摸控制
class TouchControls {
    constructor(game) {
        this.game = game;
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.minSwipeDistance = 30; // 最小滑动距离，单位像素
        this.lastTapTime = 0;  // 添加最后点击时间记录
        
        // 创建虚拟方向键
        this.createDirectionPad();
        
        // 添加滑动事件监听
        this.addSwipeListeners();
        
        // 根据屏幕宽度决定是否显示控制器
        this.checkScreenSize();
        window.addEventListener('resize', () => this.checkScreenSize());
        
        // 确保在页面加载完成后立即检查屏幕大小
        document.addEventListener('DOMContentLoaded', () => this.checkScreenSize());
    }
    
    createDirectionPad() {
        // 创建方向键容器
        this.directionPad = document.createElement('div');
        this.directionPad.className = 'direction-pad';
        
        // 创建四个方向按钮
        const directions = [
            { name: 'up', icon: '↑', x: 0, y: -1 },
            { name: 'right', icon: '→', x: 1, y: 0 },
            { name: 'down', icon: '↓', x: 0, y: 1 },
            { name: 'left', icon: '←', x: -1, y: 0 }
        ];
        
        directions.forEach(dir => {
            const button = document.createElement('button');
            button.className = `direction-button ${dir.name}`;
            button.innerHTML = dir.icon;
            button.addEventListener('click', (e) => {
                e.preventDefault(); // 防止双击缩放
                this.handleDirectionChange(dir.x, dir.y);
            });
            this.directionPad.appendChild(button);
        });
        
        // 添加到游戏控制区域
        const gameControls = document.querySelector('.game-controls');
        gameControls.appendChild(this.directionPad);
        
        // 默认隐藏
        this.directionPad.style.display = 'none';
    }

    addSwipeListeners() {
        const canvas = this.game.canvas;
        
        // 记录触摸开始时间和位置
        let touchStartTime = 0;
        
        // 触摸开始
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault(); // 防止滚动
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now(); // 记录触摸开始时间
        }, { passive: false });
        
        // 触摸结束
        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const touchDuration = Date.now() - touchStartTime;
            const currentTime = Date.now();
            
            const deltaX = touchEndX - this.touchStartX;
            const deltaY = touchEndY - this.touchStartY;
            
            // 如果触摸时间短且移动距离小，视为点击
            if (touchDuration < 300 && Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
                // 防抖动：确保两次点击之间至少间隔500毫秒
                if (currentTime - this.lastTapTime > 500) {
                    this.lastTapTime = currentTime;
                    
                    // 如果游戏结束，不响应点击
                    if (!this.game.isGameOver) {
                        this.game.togglePause();
                    }
                }
            } else {
                // 如果游戏暂停或结束，不响应滑动
                if (!this.game.isPaused && !this.game.isGameOver) {
                    this.detectSwipe(deltaX, deltaY);
                }
            }
        }, { passive: false });
    }
    
    detectSwipe(deltaX, deltaY) {
        // 确保滑动距离足够长
        if (Math.abs(deltaX) < this.minSwipeDistance && Math.abs(deltaY) < this.minSwipeDistance) {
            return;
        }
        
        // 判断主要滑动方向
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            // 水平滑动
            if (deltaX > 0) {
                this.handleDirectionChange(1, 0); // 右
            } else {
                this.handleDirectionChange(-1, 0); // 左
            }
        } else {
            // 垂直滑动
            if (deltaY > 0) {
                this.handleDirectionChange(0, 1); // 下
            } else {
                this.handleDirectionChange(0, -1); // 上
            }
        }
    }
    
    handleDirectionChange(x, y) {
        // 防止180度转向
        if ((x === 1 && this.game.direction.x === -1) ||
            (x === -1 && this.game.direction.x === 1) ||
            (y === 1 && this.game.direction.y === -1) ||
            (y === -1 && this.game.direction.y === 1)) {
            return;
        }
        
        this.game.nextDirection = { x, y };
    }
    
    checkScreenSize() {
        // 在小屏幕上显示虚拟方向键
        if (window.innerWidth <= 768) {
            this.directionPad.style.display = 'grid';
            // 更新控制提示
            const controlInfo = document.querySelector('.control-info p');
            if (controlInfo) {
                controlInfo.textContent = '滑动或使用方向键控制 | 点击开始/暂停';
            }
        } else {
            this.directionPad.style.display = 'none';
            // 恢复原始控制提示
            const controlInfo = document.querySelector('.control-info p');
            if (controlInfo) {
                controlInfo.textContent = '方向键/WASD移动 | 空格暂停';
            }
        }
    }
}

export default TouchControls;