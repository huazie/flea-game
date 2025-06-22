// 移动端触摸控制
class TouchControls {
    constructor(game) {
        this.game = game;
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.minSwipeDistance = 30; // 最小滑动距离，单位像素
        this.lastTapTime = 0;  // 添加最后点击时间记录
        
        // 创建转向轮
        this.createControlWheel();
        
        // 添加滑动事件监听
        this.addSwipeListeners();
        
        // 根据屏幕宽度决定是否显示控制器
        this.checkScreenSize();
        window.addEventListener('resize', () => this.checkScreenSize());
        
        // 确保在页面加载完成后立即检查屏幕大小
        document.addEventListener('DOMContentLoaded', () => this.checkScreenSize());
    }

    createControlWheel() {
        this.controlWheel = document.querySelector('.control-wheel');
        this.wheelBase = this.controlWheel.querySelector('.wheel-base');
        this.wheelKnob = this.controlWheel.querySelector('.wheel-knob');
        
        // 添加触摸事件监听
        this.wheelBase.addEventListener('touchstart', this.handleWheelStart.bind(this), { passive: false });
        this.wheelBase.addEventListener('touchmove', this.handleWheelMove.bind(this), { passive: false });
        this.wheelBase.addEventListener('touchend', this.handleWheelEnd.bind(this), { passive: false });
        
        // 默认隐藏
        this.controlWheel.style.display = 'none';
    }

    handleWheelStart(e) {
        e.preventDefault();
        const rect = this.wheelBase.getBoundingClientRect();
        this.wheelCenterX = rect.left + rect.width / 2;
        this.wheelCenterY = rect.top + rect.height / 2;
        this.wheelRadius = rect.width / 2;
        this.isWheelActive = true;
        
        // 初始位置
        this.handleWheelMove(e);
    }

    handleWheelMove(e) {
        if (!this.isWheelActive || this.game.isPaused || this.game.isGameOver) return;
        e.preventDefault();
        
        const touchX = e.touches[0].clientX;
        const touchY = e.touches[0].clientY;
        
        // 计算相对于中心的位置
        const deltaX = touchX - this.wheelCenterX;
        const deltaY = touchY - this.wheelCenterY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // 限制在轮子范围内
        const angle = Math.atan2(deltaY, deltaX);
        const limitedDistance = Math.min(distance, this.wheelRadius * 0.7);
        const limitedX = Math.cos(angle) * limitedDistance;
        const limitedY = Math.sin(angle) * limitedDistance;
        
        // 更新旋钮位置
        this.wheelKnob.style.transform = `translate(${limitedX}px, ${limitedY}px)`;
        
        // 计算方向向量 (归一化)
        const directionX = deltaX / distance;
        const directionY = deltaY / distance;
        
        // 确定主要方向 (上、下、左、右)
        let x = 0, y = 0;
        if (Math.abs(directionX) > Math.abs(directionY)) {
            x = directionX > 0 ? 1 : -1;
        } else {
            y = directionY > 0 ? 1 : -1;
        }
        
        // 防止180度转向
        if ((x === 1 && this.game.direction.x === -1) ||
            (x === -1 && this.game.direction.x === 1) ||
            (y === 1 && this.game.direction.y === -1) ||
            (y === -1 && this.game.direction.y === 1)) {
            return;
        }
        
        this.game.nextDirection = { x, y };
    }

    handleWheelEnd() {
        this.isWheelActive = false;
        // 重置旋钮位置
        this.wheelKnob.style.transform = 'translate(0, 0)';
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
        // 在小屏幕上显示转向轮
        if (window.innerWidth <= 768) {
            this.controlWheel.style.display = 'block';
            // 更新控制提示
            const controlInfo = document.querySelector('.control-info p');
            if (controlInfo) {
                controlInfo.textContent = '滑动或转向轮控制 | 点击开始/暂停';
            }
        } else {
            this.controlWheel.style.display = 'none';
            // 恢复原始控制提示
            const controlInfo = document.querySelector('.control-info p');
            if (controlInfo) {
                controlInfo.textContent = '方向键/WASD移动 | 空格暂停';
            }
        }
    }
}

export default TouchControls;