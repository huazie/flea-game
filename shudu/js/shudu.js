class Shudu {
    constructor() {
        this.board = Array(9).fill().map(() => Array(9).fill(0));
        this.solution = Array(9).fill().map(() => Array(9).fill(0));
        this.initialBoard = Array(9).fill().map(() => Array(9).fill(0));
    }

    // 生成新的数独游戏
    generate(difficulty = 'easy') {
        // 首先生成完整的解决方案
        this.generateSolution();
        
        // 复制解决方案到当前板
        this.board = this.solution.map(row => [...row]);
        
        // 根据难度移除数字
        const cellsToRemove = this.getDifficultyRemovalCount(difficulty);
        this.removeNumbers(cellsToRemove);
        
        // 保存初始板状态
        this.initialBoard = this.board.map(row => [...row]);
    }

    // 获取不同难度级别需要移除的数字数量
    getDifficultyRemovalCount(difficulty) {
        const difficultyLevels = {
            'easy': 35,      // 保留46个数字
            'medium': 45,    // 保留36个数字
            'hard': 52,      // 保留29个数字
            'expert': 58     // 保留23个数字
        };
        return difficultyLevels[difficulty] || difficultyLevels['easy'];
    }

    // 生成完整的数独解决方案
    generateSolution() {
        // 清空棋盘
        this.solution = Array(9).fill().map(() => Array(9).fill(0));
        
        // 填充对角线上的3个3x3方块（这些可以独立填充）
        for (let i = 0; i < 9; i += 3) {
            this.fillBox(i, i);
        }
        
        // 填充剩余的单元格
        this.solveShudu(this.solution);
    }

    // 填充3x3的方块
    fillBox(row, col) {
        const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        this.shuffleArray(numbers);
        
        let index = 0;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                this.solution[row + i][col + j] = numbers[index++];
            }
        }
    }

    // 移除指定数量的数字
    removeNumbers(count) {
        const positions = [];
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                positions.push([i, j]);
            }
        }
        this.shuffleArray(positions);

        for (let i = 0; i < count && i < positions.length; i++) {
            const [row, col] = positions[i];
            this.board[row][col] = 0;
        }
    }

    // 检查数字在指定位置是否有效
    isValid(board, row, col, num) {
        // 检查行
        for (let x = 0; x < 9; x++) {
            if (board[row][x] === num) return false;
        }

        // 检查列
        for (let x = 0; x < 9; x++) {
            if (board[x][col] === num) return false;
        }

        // 检查3x3方块
        const startRow = Math.floor(row / 3) * 3;
        const startCol = Math.floor(col / 3) * 3;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (board[i + startRow][j + startCol] === num) return false;
            }
        }

        return true;
    }

    // 求解数独
    solveShudu(board) {
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                if (board[row][col] === 0) {
                    const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
                    this.shuffleArray(numbers);
                    
                    for (const num of numbers) {
                        if (this.isValid(board, row, col, num)) {
                            board[row][col] = num;
                            
                            if (this.solveShudu(board)) {
                                return true;
                            }
                            
                            board[row][col] = 0;
                        }
                    }
                    return false;
                }
            }
        }
        return true;
    }

    // 检查指定位置是否有冲突
    hasConflict(row, col, num) {
        const originalValue = this.board[row][col];
        this.board[row][col] = 0;
        
        // 检查行
        for (let j = 0; j < 9; j++) {
            if (j !== col && this.board[row][j] === num) {
                this.board[row][col] = originalValue;
                return true;
            }
        }

        // 检查列
        for (let i = 0; i < 9; i++) {
            if (i !== row && this.board[i][col] === num) {
                this.board[row][col] = originalValue;
                return true;
            }
        }

        // 检查3x3方块
        const boxRow = Math.floor(row / 3) * 3;
        const boxCol = Math.floor(col / 3) * 3;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const currentRow = boxRow + i;
                const currentCol = boxCol + j;
                if ((currentRow !== row || currentCol !== col) && 
                    this.board[currentRow][currentCol] === num) {
                    this.board[row][col] = originalValue;
                    return true;
                }
            }
        }

        this.board[row][col] = originalValue;
        return false;
    }

    // 检查游戏是否完成
    isComplete() {
        // 检查是否有空格
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                if (this.board[i][j] === 0) {
                    return false;
                }
            }
        }

        // 检查每行
        for (let row = 0; row < 9; row++) {
            const rowNums = new Set();
            for (let col = 0; col < 9; col++) {
                rowNums.add(this.board[row][col]);
            }
            if (rowNums.size !== 9) return false;
        }

        // 检查每列
        for (let col = 0; col < 9; col++) {
            const colNums = new Set();
            for (let row = 0; row < 9; row++) {
                colNums.add(this.board[row][col]);
            }
            if (colNums.size !== 9) return false;
        }

        // 检查每个3x3方块
        for (let boxRow = 0; boxRow < 9; boxRow += 3) {
            for (let boxCol = 0; boxCol < 9; boxCol += 3) {
                const boxNums = new Set();
                for (let i = 0; i < 3; i++) {
                    for (let j = 0; j < 3; j++) {
                        boxNums.add(this.board[boxRow + i][boxCol + j]);
                    }
                }
                if (boxNums.size !== 9) return false;
            }
        }

        return true;
    }

    // 辅助函数：随机打乱数组
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}