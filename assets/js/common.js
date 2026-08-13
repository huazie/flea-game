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
    
    /**
     * 统一写入主题：所有页面都把 data-theme 标在 <html>(documentElement)。
     * 门户 main.js 与游戏页 common.js 一致，SDK（评论）、canvas 取色等
     * 从 document.documentElement 读主题的代码都能正确拿到。
     */
    applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
    }

    initTheme() {
        // 从本地存储加载主题设置
        const savedTheme = localStorage.getItem(this.themeKey);
        const theme = (savedTheme === 'dark') ? 'dark' : 'light';
        this.applyTheme(theme);
        this.updateThemeIcon(theme === 'dark');
    }
    
    bindEvents() {
        // 主题切换按钮点击事件
        this.themeButton && this.themeButton.addEventListener('click', () => this.toggleTheme());
        
        // 返回按钮点击事件
        this.backButton && this.backButton.addEventListener('click', () => this.goBack());
    }
    
    toggleTheme() {
        // 检查当前主题是否为深色（主题统一标在 <html>）
        const currentIsDark = document.documentElement.dataset.theme === 'dark';
        // 切换到相反的主题
        const newTheme = currentIsDark ? 'light' : 'dark';
        this.applyTheme(newTheme);

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