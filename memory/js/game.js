// 导入存储管理器
import { storageManager } from './storage.js';

// 游戏状态
let gameState = {
    cards: [],
    flippedCards: [],
    moves: 0,
    bestMoves: Infinity,
    isPlaying: false,
    canFlip: true,
    gridSize: 4,
    matchedPairs: 0
};

// DOM 元素
const gameBoard = document.getElementById('game-board');
const movesDisplay = document.getElementById('moves');
const bestMovesDisplay = document.getElementById('best-moves');
const startButton = document.getElementById('start-btn');
const restartButton = document.getElementById('restart-btn');
const gridSizeSelect = document.getElementById('grid-size');
const backButton = document.getElementById('back-button');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 加载保存的设置
    gameState.bestMoves = storageManager.getBestMoves();
    gameState.gridSize = storageManager.getGridSize();
    gridSizeSelect.value = gameState.gridSize;
    
    setupEventListeners();
    updateButtonStates();
    updateMovesDisplay();
});

// 设置事件监听器
function setupEventListeners() {
    startButton.addEventListener('click', startGame);
    restartButton.addEventListener('click', restartGame);
    gridSizeSelect.addEventListener('change', () => {
        gameState.gridSize = parseInt(gridSizeSelect.value);
        storageManager.setGridSize(gameState.gridSize);
        updateButtonStates();
    });
    backButton.addEventListener('click', () => {
        window.location.href = '../index.html';
    });
}

// 更新按钮状态
function updateButtonStates() {
    startButton.disabled = gameState.isPlaying;
    restartButton.disabled = !gameState.isPlaying;
    gridSizeSelect.disabled = gameState.isPlaying;
}

// 开始游戏
function startGame() {
    gameState.isPlaying = true;
    gameState.moves = 0;
    gameState.matchedPairs = 0;
    gameState.flippedCards = [];
    gameState.canFlip = true;
    updateButtonStates();
    updateMovesDisplay();
    initializeGame();
}

// 重新开始游戏
function restartGame() {
    startGame();
}

// 初始化游戏
function initializeGame() {
    const size = gameState.gridSize;
    const totalPairs = (size * size) / 2;
    gameBoard.className = `memory-board grid-${size}`;
    gameBoard.innerHTML = '';
    
    // 生成卡片对
    const cardValues = generateCardPairs(totalPairs);
    gameState.cards = shuffle(cardValues);
    
    // 创建卡片元素
    gameState.cards.forEach((value, index) => {
        const card = createCard(value, index);
        gameBoard.appendChild(card);
    });
}

// 生成卡片对
function generateCardPairs(totalPairs) {
    const emojis = ['🎮', '🎲', '🎯', '🎨', '🎭', '🎪', '🎫', '🎬', 
                    '🎤', '🎧', '🎵', '🎹', '🎷', '🎸', '🎺', '🎻',
                    '�', '�', '⭐', '�', '�', '�', '�', '�',
                    '🦋', '🐬', '🦁', '🦊', '🐼', '🐶', '🐱', '🦉'];
    const pairs = [];
    for (let i = 0; i < totalPairs; i++) {
        pairs.push(emojis[i], emojis[i]);
    }
    return pairs;
}

// 洗牌函数
function shuffle(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// 创建卡片元素
function createCard(value, index) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.index = index;
    card.dataset.value = value;
    
    const front = document.createElement('div');
    front.className = 'card-front';
    front.textContent = value;
    
    const back = document.createElement('div');
    back.className = 'card-back';
    
    card.appendChild(front);
    card.appendChild(back);
    
    card.addEventListener('click', () => handleCardClick(card));
    
    return card;
}

// 处理卡片点击
function handleCardClick(card) {
    if (!gameState.isPlaying || !gameState.canFlip || 
        card.classList.contains('flipped') || 
        card.classList.contains('matched')) {
        return;
    }
    
    flipCard(card);
    
    if (gameState.flippedCards.length === 2) {
        gameState.canFlip = false;
        checkMatch();
    }
}

// 翻转卡片
function flipCard(card) {
    card.classList.add('flipped');
    gameState.flippedCards.push(card);
}

// 检查匹配
function checkMatch() {
    const [card1, card2] = gameState.flippedCards;
    const match = card1.dataset.value === card2.dataset.value;
    
    gameState.moves++;
    updateMovesDisplay();
    
    setTimeout(() => {
        if (match) {
            handleMatch(card1, card2);
        } else {
            handleMismatch(card1, card2);
        }
        
        gameState.flippedCards = [];
        gameState.canFlip = true;
        
        if (gameState.matchedPairs === (gameState.gridSize * gameState.gridSize) / 2) {
            handleGameWin();
        }
    }, 1000);
}

// 处理匹配的卡片
function handleMatch(card1, card2) {
    card1.classList.add('matched');
    card2.classList.add('matched');
    gameState.matchedPairs++;
}

// 处理不匹配的卡片
function handleMismatch(card1, card2) {
    card1.classList.remove('flipped');
    card2.classList.remove('flipped');
}

// 处理游戏胜利
function handleGameWin() {
    if (gameState.moves < gameState.bestMoves) {
        gameState.bestMoves = gameState.moves;
        storageManager.setBestMoves(gameState.bestMoves);
        updateMovesDisplay();
    }
    
    showGameOverMessage();
    gameState.isPlaying = false;
    updateButtonStates();
}

// 显示游戏结束消息
function showGameOverMessage() {
    const gameOver = document.createElement('div');
    gameOver.className = 'game-over';
    gameOver.innerHTML = `
        <h2>恭喜!</h2>
        <p>你用了 ${gameState.moves} 步完成游戏</p>
        <p>最佳记录: ${gameState.bestMoves} 步</p>
    `;
    
    gameBoard.appendChild(gameOver);
    setTimeout(() => gameOver.classList.add('show'), 100);
    
    setTimeout(() => {
        gameOver.classList.remove('show');
        setTimeout(() => gameOver.remove(), 300);
    }, 3000);
}

// 更新步数显示
function updateMovesDisplay() {
    movesDisplay.textContent = gameState.moves;
    bestMovesDisplay.textContent = gameState.bestMoves === Infinity ? '0' : gameState.bestMoves;
}

// 更新步数显示函数结束