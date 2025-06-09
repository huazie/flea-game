// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', function() {
    // 为所有游戏卡片添加点击效果
    const gameCards = document.querySelectorAll('.game-card');
    
    gameCards.forEach(card => {
        card.addEventListener('click', function(e) {
            // 如果点击的不是"即将推出"的按钮，则允许点击
            const playButton = this.querySelector('.play-button');
            if (!playButton.textContent.includes('即将推出')) {
                // 获取游戏链接
                const gameLink = playButton.getAttribute('href');
                if (gameLink && gameLink !== '#') {
                    window.location.href = gameLink;
                }
            }
        });
    });

    // 添加图片加载错误处理
    const gameImages = document.querySelectorAll('.game-card img');
    gameImages.forEach(img => {
        img.addEventListener('error', function() {
            // 错误处理已在HTML中通过onerror属性处理
            console.log('图片加载失败：', this.alt);
        });
    });

    // 添加页面加载动画
    document.body.style.opacity = '0';
    setTimeout(() => {
        document.body.style.transition = 'opacity 0.5s ease-in';
        document.body.style.opacity = '1';
    }, 100);

    // 为"即将推出"的游戏添加提示
    const comingSoonButtons = document.querySelectorAll('.play-button[style*="background-color: #999"]');
    comingSoonButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            showToast('该游戏正在开发中，敬请期待！');
        });
    });
});

// 显示提示信息
function showToast(message) {
    // 创建toast元素
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 4px;
        z-index: 1000;
        transition: opacity 0.3s ease-in-out;
    `;
    toast.textContent = message;

    // 添加到页面
    document.body.appendChild(toast);

    // 2秒后移除
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 2000);
}

// 检查游戏链接是否有效
function checkGameAvailability() {
    const gameLinks = document.querySelectorAll('.play-button[href]:not([href="#"])');
    gameLinks.forEach(link => {
        const href = link.getAttribute('href');
        
        // 跳过本地文件链接（以file:开头或相对路径）
        if (href.startsWith('file:') || !href.startsWith('http')) {
            console.log('本地链接，跳过检查:', href);
            return;
        }

        // 只检查网络链接
        fetch(href)
            .then(response => {
                if (!response.ok) {
                    markGameAsUnavailable(link);
                }
            })
            .catch(() => {
                markGameAsUnavailable(link);
            });
    });
}

// 标记游戏为不可用
function markGameAsUnavailable(link) {
    link.style.backgroundColor = '#999';
    link.textContent = '暂不可用';
    link.href = '#';
}

// 主题切换功能
function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = themeToggle.querySelector('i');
    
    // 从localStorage获取保存的主题
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeUI(savedTheme, themeIcon);

    // 切换主题
    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeUI(newTheme, themeIcon);
    });
}

// 更新主题UI元素
function updateThemeUI(theme, icon) {
    if (theme === 'dark') {
        icon.className = 'fas fa-moon';
    } else {
        icon.className = 'fas fa-sun';
    }
}

// 页面加载完成后初始化
window.addEventListener('load', () => {
    checkGameAvailability();
    initTheme();
});