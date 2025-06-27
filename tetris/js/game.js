// 俄罗斯方块游戏主逻辑

// 游戏常量
const COLS = 10;           // 游戏区域宽度（列数）
const ROWS = 20;           // 游戏区域高度（行数）
const BLOCK_SIZE = 30;     // 方块大小（像素）
const COLORS = [
    null,
    '#00bcd4', // I - 青色
    '#2196f3', // J - 蓝色
    '#ff9800', // L - 橙色
    '#ffeb3b', // O - 黄色
    '#4caf50', // S - 绿色
    '#9c27b0', // T - 紫色
    '#f44336'  // Z - 红色
];

// 方块形状定义（每种方块的四种旋转状态）
const SHAPES = [
    // I形方块
    [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0]
    ],
    // J形方块
    [
        [2, 0, 0],
        [2, 2, 2],
        [0, 0, 0]
    ],
    // L形方块
    [
        [0, 0, 3],
        [3, 3, 3],
        [0, 0, 0]
    ],
    // O形方块
    [
        [4, 4],
        [4, 4]
    ],
    // S形方块
    [
        [0, 5, 5],
        [5, 5, 0],
        [0, 0, 0]
    ],
    // T形方块
    [
        [0, 6, 0],
        [6, 6, 6],
        [0, 0, 0]
    ],
    // Z形方块
    [
        [7, 7, 0],
        [0, 7, 7],
        [0, 0, 0]
    ]
];

// 游戏状态
let canvas, ctx;                // 主游戏画布和上下文
let nextPieceCanvas, nextCtx;   // 下一个方块画布和上下文
let board;                      // 游戏板状态
let currentPiece;               // 当前方块
let nextPiece;                  // 下一个方块
let score = 0;                  // 分数
let level = 1;                  // 等级
let lines = 0;                  // 消除的行数
let gameInterval;               // 游戏循环间隔
let gameSpeed = 1000;           // 游戏速度（毫秒）
let isPaused = false;           // 游戏是否暂停
let isGameOver = false;         // 游戏是否结束
let isGameStarted = false;      // 游戏是否已开始

// DOM元素
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const resetBtn = document.getElementById('reset-btn');
const scoreElement = document.getElementById('score');
const levelElement = document.getElementById('level');
const linesElement = document.getElementById('lines');
const difficultyBtns = document.querySelectorAll('.difficulty-btn');
const themeToggle = document.getElementById('theme-toggle');

// 初始化游戏
function init() {
    // 初始化主游戏画布
    canvas = document.getElementById('tetris-canvas');
    ctx = canvas.getContext('2d');
    
    // 初始化下一个方块画布
    nextPieceCanvas = document.getElementById('next-piece-canvas');
    nextCtx = nextPieceCanvas.getContext('2d');
    
    // 设置事件监听器
    document.addEventListener('keydown', handleKeyPress);
    startBtn.addEventListener('click', startGame);
    pauseBtn.addEventListener('click', togglePause);
    resetBtn.addEventListener('click', resetGame);
    
    // 难度按钮事件
    difficultyBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            difficultyBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            gameSpeed = parseInt(btn.dataset.speed);
            
            if (isGameStarted && !isPaused) {
                clearInterval(gameInterval);
                gameInterval = setInterval(moveDown, gameSpeed);
            }
        });
    });
    
    // 主题切换
    themeToggle.addEventListener('change', () => {
        document.body.setAttribute('data-theme', themeToggle.checked ? 'dark' : 'light');
    });
    
    // 初始化游戏
    resetGame();
    drawBoard();
}

// 创建空游戏板
function createBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

// 生成随机方块
function getRandomPiece() {
    const shapeIndex = Math.floor(Math.random() * SHAPES.length);
    const shape = SHAPES[shapeIndex];
    
    // 深拷贝形状数组
    const piece = {
        shape: JSON.parse(JSON.stringify(shape)),
        x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
        y: 0
    };
    
    return piece;
}

// 绘制游戏板
function drawBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 绘制网格
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid-border');
    ctx.lineWidth = 0.5;
    
    // 绘制水平线
    for (let i = 0; i <= ROWS; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * BLOCK_SIZE);
        ctx.lineTo(COLS * BLOCK_SIZE, i * BLOCK_SIZE);
        ctx.stroke();
    }
    
    // 绘制垂直线
    for (let i = 0; i <= COLS; i++) {
        ctx.beginPath();
        ctx.moveTo(i * BLOCK_SIZE, 0);
        ctx.lineTo(i * BLOCK_SIZE, ROWS * BLOCK_SIZE);
        ctx.stroke();
    }
    
    // 绘制已固定的方块
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (board[y][x] !== 0) {
                drawBlock(ctx, x, y, board[y][x]);
            }
        }
    }
    
    // 绘制当前方块
    if (currentPiece) {
        drawPiece(ctx, currentPiece);
    }
}

// 绘制下一个方块预览
function drawNextPiece() {
    nextCtx.clearRect(0, 0, nextPieceCanvas.width, nextPieceCanvas.height);
    
    if (!nextPiece) return;
    
    const blockSize = 24; // 预览区块大小
    const shape = nextPiece.shape;
    const width = shape[0].length;
    const height = shape.length;
    
    // 计算居中位置
    const offsetX = (nextPieceCanvas.width - width * blockSize) / 2;
    const offsetY = (nextPieceCanvas.height - height * blockSize) / 2;
    
    // 绘制方块
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x] !== 0) {
                nextCtx.fillStyle = COLORS[shape[y][x]];
                nextCtx.fillRect(offsetX + x * blockSize, offsetY + y * blockSize, blockSize, blockSize);
                
                // 绘制边框
                nextCtx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--block-border');
                nextCtx.lineWidth = 1;
                nextCtx.strokeRect(offsetX + x * blockSize, offsetY + y * blockSize, blockSize, blockSize);
                
                // 绘制高光效果
                nextCtx.fillStyle = 'rgba(255, 255, 255, 0.2)';
                nextCtx.fillRect(offsetX + x * blockSize, offsetY + y * blockSize, blockSize, blockSize / 4);
                nextCtx.fillRect(offsetX + x * blockSize, offsetY + y * blockSize, blockSize / 4, blockSize);
            }
        }
    }
}

// 绘制单个方块
function drawBlock(context, x, y, colorIndex) {
    const blockX = x * BLOCK_SIZE;
    const blockY = y * BLOCK_SIZE;
    
    // 绘制方块主体
    context.fillStyle = COLORS[colorIndex];
    context.fillRect(blockX, blockY, BLOCK_SIZE, BLOCK_SIZE);
    
    // 绘制边框
    context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--block-border');
    context.lineWidth = 1;
    context.strokeRect(blockX, blockY, BLOCK_SIZE, BLOCK_SIZE);
    
    // 绘制高光效果
    context.fillStyle = 'rgba(255, 255, 255, 0.2)';
    context.fillRect(blockX, blockY, BLOCK_SIZE, BLOCK_SIZE / 4);
    context.fillRect(blockX, blockY, BLOCK_SIZE / 4, BLOCK_SIZE);
}

// 绘制方块
function drawPiece(context, piece) {
    const shape = piece.shape;
    
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x] !== 0) {
                drawBlock(context, piece.x + x, piece.y + y, shape[y][x]);
            }
        }
    }
}

// 检查碰撞
function checkCollision(piece, offsetX = 0, offsetY = 0) {
    const shape = piece.shape;
    
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x] !== 0) {
                const newX = piece.x + x + offsetX;
                const newY = piece.y + y + offsetY;
                
                // 检查边界
                if (newX < 0 || newX >= COLS || newY >= ROWS) {
                    return true;
                }
                
                // 检查与已固定方块的碰撞
                if (newY >= 0 && board[newY][newX] !== 0) {
                    return true;
                }
            }
        }
    }
    
    return false;
}

// 旋转方块
function rotatePiece() {
    if (isPaused || isGameOver || !isGameStarted) return;
    
    const originalShape = currentPiece.shape;
    const rows = originalShape.length;
    const cols = originalShape[0].length;
    
    // 创建新的旋转后的形状
    const rotatedShape = Array.from({ length: cols }, () => Array(rows).fill(0));
    
    // 执行旋转
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            rotatedShape[x][rows - 1 - y] = originalShape[y][x];
        }
    }
    
    // 保存原始形状
    const originalPiece = JSON.parse(JSON.stringify(currentPiece));
    
    // 应用旋转
    currentPiece.shape = rotatedShape;
    
    // 检查旋转后是否发生碰撞，如果是则恢复原始形状
    if (checkCollision(currentPiece)) {
        currentPiece = originalPiece;
    }
    
    drawBoard();
}

// 向左移动方块
function moveLeft() {
    if (isPaused || isGameOver || !isGameStarted) return;
    
    if (!checkCollision(currentPiece, -1, 0)) {
        currentPiece.x--;
        drawBoard();
    }
}

// 向右移动方块
function moveRight() {
    if (isPaused || isGameOver || !isGameStarted) return;
    
    if (!checkCollision(currentPiece, 1, 0)) {
        currentPiece.x++;
        drawBoard();
    }
}

// 向下移动方块
function moveDown() {
    if (isPaused || isGameOver || !isGameStarted) return;
    
    if (!checkCollision(currentPiece, 0, 1)) {
        currentPiece.y++;
        drawBoard();
        return;
    }
    
    // 如果发生碰撞，固定当前方块
    lockPiece();
    
    // 检查并清除已完成的行
    clearLines();
    
    // 生成新方块
    spawnPiece();
}

// 快速下落（直接落到底部）
function hardDrop() {
    if (isPaused || isGameOver || !isGameStarted) return;
    
    let dropDistance = 0;
    
    // 计算可以下落的最大距离
    while (!checkCollision(currentPiece, 0, dropDistance + 1)) {
        dropDistance++;
    }
    
    // 应用下落
    currentPiece.y += dropDistance;
    
    // 更新分数（每个格子2分）
    updateScore(dropDistance * 2);
    
    // 固定方块并生成新方块
    lockPiece();
    clearLines();
    spawnPiece();
    
    drawBoard();
}

// 固定当前方块到游戏板
function lockPiece() {
    const shape = currentPiece.shape;
    
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x] !== 0) {
                // 检查是否游戏结束（方块固定在顶部）
                if (currentPiece.y + y <= 0) {
                    gameOver();
                    return;
                }
                
                // 将方块固定到游戏板
                board[currentPiece.y + y][currentPiece.x + x] = shape[y][x];
            }
        }
    }
}

// 清除已完成的行
function clearLines() {
    let linesCleared = 0;
    
    for (let y = ROWS - 1; y >= 0; y--) {
        // 检查当前行是否已满
        const isRowFull = board[y].every(cell => cell !== 0);
        
        if (isRowFull) {
            // 移除当前行
            for (let yy = y; yy > 0; yy--) {
                board[yy] = [...board[yy - 1]];
            }
            
            // 创建新的空行
            board[0] = Array(COLS).fill(0);
            
            // 行计数增加
            linesCleared++;
            
            // 由于行已移除，需要重新检查当前行
            y++;
        }
    }
    
    // 更新分数和等级
    if (linesCleared > 0) {
        // 更新已清除的行数
        lines += linesCleared;
        linesElement.textContent = lines;
        
        // 根据清除的行数计算分数
        // 1行=100分，2行=300分，3行=500分，4行=800分
        const points = [0, 100, 300, 500, 800][linesCleared];
        updateScore(points * level);
        
        // 每清除10行提升一个等级
        if (lines >= level * 10) {
            levelUp();
        }
        
        // 显示消息
        const messages = ['', '单消！', '双消！', '三消！', '四消！'];
        showNotification(messages[linesCleared], 1500);
    }
}

// 更新分数
function updateScore(points) {
    score += points;
    scoreElement.textContent = score;
}

// 提升等级
function levelUp() {
    level++;
    levelElement.textContent = level;
    
    // 提高游戏速度
    gameSpeed = Math.max(100, 1000 - (level - 1) * 100);
    
    // 更新游戏循环
    if (isGameStarted && !isPaused) {
        clearInterval(gameInterval);
        gameInterval = setInterval(moveDown, gameSpeed);
    }
    
    showNotification(`升级到 ${level} 级！`, 2000);
}

// 生成新方块
function spawnPiece() {
    // 使用下一个方块作为当前方块
    currentPiece = nextPiece || getRandomPiece();
    
    // 生成新的下一个方块
    nextPiece = getRandomPiece();
    
    // 绘制下一个方块预览
    drawNextPiece();
    
    // 检查新生成的方块是否立即碰撞（游戏结束条件）
    if (checkCollision(currentPiece)) {
        gameOver();
    }
}

// 游戏结束
function gameOver() {
    isGameOver = true;
    clearInterval(gameInterval);
    
    // 更新按钮状态
    startBtn.disabled = false;
    startBtn.textContent = '重新开始';
    pauseBtn.disabled = true;
    
    // 显示游戏结束消息
    showGameOverMessage();
}

// 显示游戏结束消息
function showGameOverMessage() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.font = 'bold 36px Arial';
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--game-over-text');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('游戏结束', canvas.width / 2, canvas.height / 2 - 30);
    
    ctx.font = '24px Arial';
    ctx.fillText(`最终分数: ${score}`, canvas.width / 2, canvas.height / 2 + 20);
    
    // 显示通知
    showNotification('游戏结束！', 3000);
}

// 开始游戏
function startGame() {
    if (isGameStarted && !isGameOver) {
        return;
    }
    
    // 重置游戏状态
    resetGame();
    
    // 更新按钮状态
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    
    // 开始游戏循环
    isGameStarted = true;
    gameInterval = setInterval(moveDown, gameSpeed);
    
    // 显示通知
    showNotification('游戏开始！', 1500);
}

// 暂停/继续游戏
function togglePause() {
    if (!isGameStarted || isGameOver) {
        return;
    }
    
    isPaused = !isPaused;
    
    if (isPaused) {
        // 暂停游戏
        clearInterval(gameInterval);
        pauseBtn.textContent = '继续';
        
        // 显示暂停消息
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.font = 'bold 36px Arial';
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--game-over-text');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('已暂停', canvas.width / 2, canvas.height / 2);
        
        showNotification('游戏已暂停', 1500);
    } else {
        // 继续游戏
        gameInterval = setInterval(moveDown, gameSpeed);
        pauseBtn.textContent = '暂停';
        drawBoard();
        
        showNotification('游戏继续', 1500);
    }
}

// 重置游戏
function resetGame() {
    // 重置游戏状态
    board = createBoard();
    score = 0;
    level = 1;
    lines = 0;
    isGameOver = false;
    isPaused = false;
    isGameStarted = false;
    
    // 更新显示
    scoreElement.textContent = score;
    levelElement.textContent = level;
    linesElement.textContent = lines;
    
    // 重置按钮状态
    startBtn.disabled = false;
    startBtn.textContent = '开始游戏';
    pauseBtn.disabled = true;
    pauseBtn.textContent = '暂停';
    
    // 获取当前选中的难度
    const activeBtn = document.querySelector('.difficulty-btn.active');
    gameSpeed = parseInt(activeBtn.dataset.speed);
    
    // 清除游戏循环
    clearInterval(gameInterval);
    
    // 生成初始方块
    nextPiece = getRandomPiece();
    currentPiece = getRandomPiece();
    
    // 绘制游戏板和下一个方块
    drawBoard();
    drawNextPiece();
}

// 处理键盘输入
function handleKeyPress(event) {
    if (isGameOver) return;
    
    switch (event.keyCode) {
        case 37: // 左箭头
            moveLeft();
            break;
        case 39: // 右箭头
            moveRight();
            break;
        case 40: // 下箭头
            moveDown();
            break;
        case 38: // 上箭头
            rotatePiece();
            break;
        case 32: // 空格键
            hardDrop();
            break;
        case 80: // P键
            togglePause();
            break;
    }
}

// 显示通知消息
function showNotification(message, duration = 2000) {
    if (typeof showToast === 'function') {
        showToast(message, duration);
    }
}

// 当页面加载完成时初始化游戏
document.addEventListener('DOMContentLoaded', init);