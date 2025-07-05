/**
 * 处理各种公共逻辑：
 * - 1. 主题切换点击事件
 * - 2. 返回按钮点击事件
 */
class CommonManager {
    constructor() {
        this.themeButton = document.getElementById('theme-button');
        this.backButton = document.getElementById('back-button');
        this.themeKey = 'color_scheme';
        
        this.initTheme();
        this.bindEvents();
    }
    
    initTheme() {
        // 从本地存储加载主题设置
        const savedTheme = localStorage.getItem(this.themeKey);
        
        if (savedTheme === 'dark') {
            document.body.dataset.theme = 'dark';
            this.updateThemeIcon(true);
        } else {
            document.body.dataset.theme = 'light';
            this.updateThemeIcon(false);
        }
    }
    
    bindEvents() {
        // 主题切换按钮点击事件
        this.themeButton && this.themeButton.addEventListener('click', () => this.toggleTheme());
        
        // 返回按钮点击事件
        this.backButton && this.backButton.addEventListener('click', () => this.goBack());
    }
    
    toggleTheme() {
        // 检查当前主题是否为深色
        const currentIsDark = document.body.dataset.theme === 'dark';
        // 切换到相反的主题
        const newTheme = currentIsDark ? 'light' : 'dark';
        document.body.dataset.theme = newTheme;
        
        // 保存主题设置到本地存储
        localStorage.setItem(this.themeKey, newTheme);
        
        // 更新图标 - 传入新主题是否为深色
        this.updateThemeIcon(!currentIsDark);
        
        // 触发自定义事件，通知游戏画布重绘
        document.dispatchEvent(new CustomEvent('themeChanged'));
    }
    
    updateThemeIcon(isDarkTheme) {
        const themeIcon = this.themeButton.querySelector('i');
        
        if (isDarkTheme) {
            themeIcon.classList.remove('fa-sun');
            themeIcon.classList.add('fa-moon');
        } else {
            themeIcon.classList.remove('fa-moon');
            themeIcon.classList.add('fa-sun');
        }
    }
    
    /**
     * 返回操作处理 - 基于事件机制
     */
    goBack() {
        // 创建并派发beforeBack事件
        const beforeEvent = new CustomEvent('beforeBack', {
            cancelable: true,
            detail: { defaultPrevented: false }
        });
        window.dispatchEvent(beforeEvent);

        // 检查是否阻止默认行为
        if (!beforeEvent.detail.defaultPrevented) {
            window.location.href = '../';
            
            // 创建并派发afterBack事件
            const afterEvent = new CustomEvent('afterBack');
            window.dispatchEvent(afterEvent);
        }
    }
}

new CommonManager();