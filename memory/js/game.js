// 导入存储管理器
import { storageManager } from './storage.js';

// 记忆翻牌游戏类
class MemoryGame {
    constructor() {
        // 游戏状态属性
        this.cards = [];
        this.flippedCards = [];
        this.moves = 0;
        this.bestMoves = Infinity;
        this.isPlaying = false;
        this.canFlip = true;
        this.gridSize = 4;
        this.matchedPairs = 0;
        
        // DOM 元素
        this.gameBoard = document.getElementById('game-board');
        this.movesDisplay = document.getElementById('moves');
        this.bestMovesDisplay = document.getElementById('best-moves');
        this.startButton = document.getElementById('start-btn');
        this.restartButton = document.getElementById('restart-btn');
        this.gridSizeSelect = document.getElementById('grid-size');
        this.backButton = document.getElementById('back-button');
        
        // 初始化游戏
        this.init();
    }
    
    // 初始化方法
    init() {
        // 加载保存的设置
        this.bestMoves = storageManager.getBestMoves();
        this.gridSize = storageManager.getGridSize();
        this.gridSizeSelect.value = this.gridSize;
        
        this.setupEventListeners();
        this.updateButtonStates();
        this.updateMovesDisplay();
    }
    
    // 设置事件监听器
    setupEventListeners() {
        this.startButton.addEventListener('click', () => this.startGame());
        this.restartButton.addEventListener('click', () => this.restartGame());
        this.gridSizeSelect.addEventListener('change', () => {
            this.gridSize = parseInt(this.gridSizeSelect.value);
            storageManager.setGridSize(this.gridSize);
            this.updateButtonStates();
        });
        this.backButton.addEventListener('click', () => {
            window.location.href = '../index.html';
        });
    }
    
    // 更新按钮状态
    updateButtonStates() {
        this.startButton.disabled = this.isPlaying;
        this.restartButton.disabled = !this.isPlaying;
        this.gridSizeSelect.disabled = this.isPlaying;
    }
    
    // 开始游戏
    startGame() {
        this.isPlaying = true;
        this.moves = 0;
        this.matchedPairs = 0;
        this.flippedCards = [];
        this.canFlip = true;
        this.updateButtonStates();
        this.updateMovesDisplay();
        this.initializeGame();
    }
    
    // 重新开始游戏
    restartGame() {
        this.startGame();
    }
    
    // 初始化游戏
    initializeGame() {
        const size = this.gridSize;
        const totalPairs = (size * size) / 2;
        this.gameBoard.className = `memory-board grid-${size}`;
        this.gameBoard.innerHTML = '';
        
        // 生成卡片对
        const cardValues = this.generateCardPairs(totalPairs);
        this.cards = this.shuffle(cardValues);
        
        // 创建卡片元素
        this.cards.forEach((value, index) => {
            const card = this.createCard(value, index);
            this.gameBoard.appendChild(card);
        });
    }
    
    // 生成卡片对
    generateCardPairs(totalPairs) {
        const emojis = ['🎮', '🎲', '🎯', '🎨', '🎭', '🎪', '🎫', '🎬', 
                        '🎤', '🎧', '🎵', '🎹', '🎷', '🎸', '🎺', '🎻',
                        '🌟', '🌈', '⭐', '🌠', '🌞', '🌙', '🌍', '🌋',
                        '🦋', '🐬', '🦁', '🦊', '🐼', '🐶', '🐱', '🦉'];
        const pairs = [];
        for (let i = 0; i < totalPairs; i++) {
            pairs.push(emojis[i], emojis[i]);
        }
        return pairs;
    }
    
    // 洗牌函数
    shuffle(array) {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    }
    
    // 创建卡片元素
    createCard(value, index) {
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
        
        // 使用箭头函数确保 this 指向正确
        card.addEventListener('click', () => this.handleCardClick(card));
        
        return card;
    }
    
    // 处理卡片点击
    handleCardClick(card) {
        if (!this.isPlaying || !this.canFlip || 
            card.classList.contains('flipped') || 
            card.classList.contains('matched')) {
            return;
        }
        
        this.flipCard(card);
        
        if (this.flippedCards.length === 2) {
            this.canFlip = false;
            this.checkMatch();
        }
    }
    
    // 翻转卡片
    flipCard(card) {
        card.classList.add('flipped');
        this.flippedCards.push(card);
    }
    
    // 检查匹配
    checkMatch() {
        const [card1, card2] = this.flippedCards;
        const match = card1.dataset.value === card2.dataset.value;
        
        this.moves++;
        this.updateMovesDisplay();
        
        setTimeout(() => {
            if (match) {
                this.handleMatch(card1, card2);
            } else {
                this.handleMismatch(card1, card2);
            }
            
            this.flippedCards = [];
            this.canFlip = true;
            
            if (this.matchedPairs === (this.gridSize * this.gridSize) / 2) {
                this.handleGameWin();
            }
        }, 1000);
    }
    
    // 处理匹配的卡片
    handleMatch(card1, card2) {
        card1.classList.add('matched');
        card2.classList.add('matched');
        this.matchedPairs++;
    }
    
    // 处理不匹配的卡片
    handleMismatch(card1, card2) {
        card1.classList.remove('flipped');
        card2.classList.remove('flipped');
    }
    
    // 处理游戏胜利
    handleGameWin() {
        if (this.moves < this.bestMoves) {
            this.bestMoves = this.moves;
            storageManager.setBestMoves(this.bestMoves);
            this.updateMovesDisplay();
        }
        
        this.showGameOverMessage();
        this.isPlaying = false;
        this.updateButtonStates();
    }
    
    // 显示游戏结束消息
    showGameOverMessage() {
        const gameOver = document.createElement('div');
        gameOver.className = 'game-over';
        gameOver.innerHTML = `
            <h2>恭喜!</h2>
            <p>你用了 ${this.moves} 步完成游戏</p>
            <p>最佳记录: ${this.bestMoves} 步</p>
        `;
        
        this.gameBoard.appendChild(gameOver);
        setTimeout(() => gameOver.classList.add('show'), 100);
        
        setTimeout(() => {
            gameOver.classList.remove('show');
            setTimeout(() => gameOver.remove(), 300);
        }, 3000);
    }
    
    // 更新步数显示
    updateMovesDisplay() {
        this.movesDisplay.textContent = this.moves;
        this.bestMovesDisplay.textContent = this.bestMoves === Infinity ? '0' : this.bestMoves;
    }
}

// 当DOM加载完成后初始化游戏
document.addEventListener('DOMContentLoaded', () => {
    new MemoryGame();
});