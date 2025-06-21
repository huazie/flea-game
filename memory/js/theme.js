// 导入存储管理器
import { storageManager } from './storage.js';

// 主题管理类
class ThemeManager {
    constructor() {
        this.themeButton = document.getElementById('theme-button');
        this.themeIcon = this.themeButton.querySelector('i');
        this.init();
    }

    init() {
        // 加载保存的主题设置
        const savedTheme = storageManager.getTheme();
        this.applyTheme(savedTheme);
        
        // 设置主题切换事件
        this.themeButton.addEventListener('click', () => this.toggleTheme());
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        this.updateThemeIcon(theme);
    }

    updateThemeIcon(theme) {
        if (theme === 'dark') {
            this.themeIcon.classList.remove('fa-sun');
            this.themeIcon.classList.add('fa-moon');
        } else {
            this.themeIcon.classList.remove('fa-moon');
            this.themeIcon.classList.add('fa-sun');
        }
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        this.applyTheme(newTheme);
        storageManager.setTheme(newTheme);
    }
}

// 初始化主题管理器
document.addEventListener('DOMContentLoaded', () => {
    new ThemeManager();
});