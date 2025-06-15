// 全局变量存储游戏配置数据
let gamesData = null;

// 全局变量存储搜索关键词
let searchKeyword = '';

// 全局变量存储当前选中的分类
let currentCategory = 'all';

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', function() {
    // 初始化主题
    initTheme();
    
    // 初始化搜索功能
    initSearch();
    
    // 加载游戏配置并生成游戏卡片
    loadGamesConfig();
    
    // 添加页面加载动画
    document.body.style.opacity = '0';
    setTimeout(() => {
        document.body.style.transition = 'opacity 0.5s ease-in';
        document.body.style.opacity = '1';
    }, 100);
});

// 初始化分类导航
function initCategories() {
    if (!gamesData || !gamesData.categories) return;
    
    const categoriesList = document.getElementById('categoriesList');
    if (!categoriesList) return;
    
    // 清空现有分类
    categoriesList.innerHTML = '';
    
    // 添加"全部"分类
    const allCategoryItem = document.createElement('li');
    allCategoryItem.className = 'category-item';
    const allCategoryButton = document.createElement('button');
    allCategoryButton.className = 'category-button active';
    allCategoryButton.setAttribute('data-category', 'all');
    allCategoryButton.textContent = '全部';
    allCategoryItem.appendChild(allCategoryButton);
    categoriesList.appendChild(allCategoryItem);
    
    // 添加其他分类
    gamesData.categories.forEach(category => {
        const categoryItem = document.createElement('li');
        categoryItem.className = 'category-item';
        
        const categoryButton = document.createElement('button');
        categoryButton.className = 'category-button';
        categoryButton.setAttribute('data-category', category.id);
        categoryButton.textContent = category.name;
        
        categoryItem.appendChild(categoryButton);
        categoriesList.appendChild(categoryItem);
    });
    
    // 添加分类点击事件
    const categoryButtons = document.querySelectorAll('.category-button');
    categoryButtons.forEach(button => {
        button.addEventListener('click', function() {
            // 移除所有分类按钮的active类
            categoryButtons.forEach(btn => btn.classList.remove('active'));
            
            // 为当前点击的按钮添加active类
            this.classList.add('active');
            
            // 更新当前选中的分类
            currentCategory = this.getAttribute('data-category');
            
            // 重新加载游戏卡片
            refreshGameCards();
        });
    });
}

// 初始化搜索功能
function initSearch() {
    const searchInput = document.getElementById('gameSearch');
    const searchButton = document.getElementById('searchButton');
    
    // 搜索按钮点击事件
    searchButton.addEventListener('click', function() {
        searchKeyword = searchInput.value.trim().toLowerCase();
        refreshGameCards(); // 重新加载游戏并应用搜索过滤
    });
    
    // 输入框回车事件
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchKeyword = searchInput.value.trim().toLowerCase();
            refreshGameCards(); // 重新加载游戏并应用搜索过滤
        }
    });
    
    // 输入框清空事件
    searchInput.addEventListener('input', function() {
        if (this.value.trim() === '' && searchKeyword !== '') {
            searchKeyword = '';
            refreshGameCards(); // 如果搜索框被清空，重新加载所有游戏
        }
    });
}

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
    iconElement.className = theme === 'light' ? 'fas fa-sun' : 'fas fa-moon';
}

// 加载游戏配置
function loadGamesConfig() {
    // 如果已经有缓存的游戏数据，直接使用
    if (gamesData) {
        initCategories();
        refreshGameCards();
        return;
    }
    
    fetch('config/games.json')
        .then(response => response.json())
        .then(data => {
            // 缓存游戏数据
            gamesData = data;
            
            // 初始化分类导航
            initCategories();
            
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
    const container = document.querySelector('.games-grid');
    if (!container) return;
    
    container.innerHTML = ''; // 清空容器
    
    // 根据搜索关键词和分类过滤游戏
    let filteredGames = games;
    
    // 应用搜索过滤
    if (searchKeyword) {
        filteredGames = filteredGames.filter(game => 
            game.name.toLowerCase().includes(searchKeyword) || 
            (game.description && game.description.toLowerCase().includes(searchKeyword))
        );
    }
    
    // 应用分类过滤
    if (currentCategory !== 'all') {
        filteredGames = filteredGames.filter(game => 
            game.categories && game.categories.includes(currentCategory)
        );
    }
    
    // 如果没有匹配的游戏，显示提示信息
    if (filteredGames.length === 0) {
        const noResults = document.createElement('div');
        noResults.className = 'no-results';
        noResults.textContent = '没有找到匹配的游戏';
        container.appendChild(noResults);
        return;
    }
    
    // 获取当前主题
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    
    filteredGames.forEach(game => {
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
                    // 连续显示多个提示以测试效果
                    showToast(`《${game.name}》即将推出，敬请期待！`);
                    setTimeout(() => {
                        showToast(`开发团队正在努力开发《${game.name}》中...`, 'info');
                    }, 300);
                    setTimeout(() => {
                        showToast(`预计《${game.name}》将在下个版本发布`, 'success');
                    }, 600);
                });
            }
        }
    });
}

// 显示提示消息
function showToast(message, duration = 3000) {
    Toast.info(message, duration);
}