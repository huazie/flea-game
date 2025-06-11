// 全局变量存储游戏配置数据
let gamesData = null;

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', function() {
    // 初始化主题
    initTheme();
    
    // 加载游戏配置并生成游戏卡片
    loadGamesConfig();
    
    // 添加页面加载动画
    document.body.style.opacity = '0';
    setTimeout(() => {
        document.body.style.transition = 'opacity 0.5s ease-in';
        document.body.style.opacity = '1';
    }, 100);
});

// 初始化主题
function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = themeToggle.querySelector('i'); // 修改：直接从按钮中获取图标元素
    
    // 从localStorage获取主题设置
    const currentTheme = localStorage.getItem('color_scheme') || 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeIcon(themeIcon, currentTheme);
    
    // 添加主题切换事件监听器
    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        // 更新主题
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('color_scheme', newTheme);
        updateThemeIcon(themeIcon, newTheme);
        
        // 重新生成游戏卡片（不重新加载配置）
        refreshGameCards();
    });
}

// 更新主题图标
function updateThemeIcon(iconElement, theme) {
    iconElement.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
}

// 加载游戏配置
function loadGamesConfig() {
    // 如果已经有缓存的游戏数据，直接使用
    if (gamesData) {
        refreshGameCards();
        return;
    }
    
    fetch('config/games.json')
        .then(response => response.json())
        .then(data => {
            // 缓存游戏数据
            gamesData = data;
            
            // 刷新游戏卡片
            refreshGameCards();
        })
        .catch(error => {
            console.error('加载游戏配置失败:', error);
            showToast('加载游戏配置失败，请刷新页面重试');
        });
}

// 刷新游戏卡片（不重新获取配置）
function refreshGameCards() {
    if (!gamesData) return;
    
    // 生成游戏卡片
    generateGameCards(gamesData.games);
    
    // 为游戏卡片添加事件监听器
    setupGameCardEvents();
}

// 生成游戏卡片
function generateGameCards(games) {
    const container = document.querySelector('.games-grid'); // 修改：使用正确的容器选择器
    if (!container) return;
    
    container.innerHTML = ''; // 清空容器
    
    // 获取当前主题
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    
    games.forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card';
        card.setAttribute('data-game', game.id);
        
        // 获取当前主题对应的图片
        const imgSrc = game.images && game.images[currentTheme] ? game.images[currentTheme] : `assets/images/${game.id}.png`;
        
        // 使用提供的模板生成卡片内容
        card.innerHTML = `
            <img src="${imgSrc}" alt="${game.name}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'200\\' height=\\'200\\' viewBox=\\'0 0 200 200\\'%3E%3Crect width=\\'200\\' height=\\'200\\' fill=\\'%23f0f0f0\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-family=\\'Arial\\' font-size=\\'16\\' fill=\\'%23666\\'%3E${game.name}%3C/text%3E%3C/svg%3E'">
            <h3>${game.name}</h3>
            <p>${game.description}</p>
            <a href="${game.link}" class="play-button">开始游戏</a>
        `;
        
        container.appendChild(card);
    });
}

// 为游戏卡片添加事件监听器
function setupGameCardEvents() {
    // 由于我们现在使用了<a>标签作为游戏链接，不需要为整个卡片添加点击事件
    // 但我们可以添加一些额外的交互效果
    const cards = document.querySelectorAll('.game-card');
    cards.forEach(card => {
        // 添加鼠标悬停效果
        card.addEventListener('mouseenter', () => {
            card.classList.add('hover');
        });
        
        card.addEventListener('mouseleave', () => {
            card.classList.remove('hover');
        });
        
        // 对于状态为"即将推出"的游戏，可以添加特殊处理
        const gameId = card.getAttribute('data-game');
        const game = gamesData.games.find(g => g.id === gameId);
        if (game && game.status === 'coming_soon') {
            const playButton = card.querySelector('.play-button');
            if (playButton) {
                playButton.textContent = '即将推出';
                playButton.classList.add('coming-soon');
                playButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    showToast('该游戏即将推出，敬请期待！');
                });
            }
        }
    });
}

// 显示提示消息
function showToast(message, duration = 3000) {
    // 检查是否已存在toast元素
    let toast = document.querySelector('.toast');
    
    // 如果不存在，创建一个
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    
    // 设置消息并显示
    toast.textContent = message;
    toast.classList.add('show');
    
    // 设置定时器，自动隐藏
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}