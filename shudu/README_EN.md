# Sudoku Game

<p align="center">
  <img src="../assets/images/shudu.png" alt="Sudoku Game" width="200">
</p>

An elegant, responsive web-based Sudoku game with multiple difficulty levels and rich gameplay features. No installation required—just open and play, perfect for Sudoku fans of all ages.

[中文说明/Chinese Documentation](README.md)

## 🎮 Introduction

Sudoku is a number logic puzzle that has taken the world by storm. It originated in 18th-century Switzerland, later gained popularity in Japan, and was given the name "Sudoku" there. This game is a modern web implementation of the classic puzzle, preserving the traditional challenge while adding a modern interactive experience and helpful assist features.

## 📏 Game Rules

1. The board is a 9×9 grid divided into nine 3×3 subgrids
2. The goal is to fill every empty cell with a digit from 1 to 9
3. Each row, column, and 3×3 subgrid must contain no duplicate digits
4. When the game starts, some cells are pre-filled (given numbers)
5. Players must fill in all empty cells through logical deduction

## ✨ Features

- **Multiple difficulty levels**: Four levels—Easy (default), Medium, Hard, and Expert
- **Smart hint system**: Optionally get a hint for your next move
- **Notes feature**: Record possible candidates in cells
- **Error detection**: Real-time validation of your entries, with optional error display
- **Auto-save**: Game progress is saved automatically so you can continue anytime
- **Game history**: Saves your last 10 games and best results
- **Multi-platform support**: Responsive design that works perfectly on desktop and mobile
- **Dual input modes**: Supports both keyboard and touch controls
- **Dark mode**: Easy on the eyes, more comfortable for nighttime play
- **Timer system**: Tracks your solving time so you can challenge yourself

## 🚀 Quick Start

### Play Online
Visit the [game homepage](https://blog.huazie.com/diversity/game/shudu/) to start playing.

### Run Locally
1. Clone the repository: `git clone https://github.com/huazie/flea-game.git`
2. Enter the project directory: `cd flea-game`
3. Open the Sudoku game: run `open shudu/index.html` (Mac) or double-click the `shudu/index.html` file

## 🎯 Controls

### Basic Controls
1. Click any empty cell to select it
2. Type a digit from 1 to 9 to fill it in
3. Incorrect entries are shown in red
4. The game ends when all cells are completed

### Detailed Controls

| Action | Desktop | Mobile |
|--------|---------|--------|
| Select a cell | Mouse click | Tap |
| Enter a number | Keyboard 1-9 / tap the number pad | Tap the number pad |
| Delete a number | Backspace / Delete | Tap the "Clear" button |
| Add a note | Hold Shift + number key | Enable notes mode, then tap a number |
| Move selection | Arrow keys | Swipe (enable in settings) |
| Get a hint | H key / tap the "Hint" button | Tap the "Hint" button |

## 🌟 Difficulty Levels

| Difficulty | Given Numbers | Characteristics | Best For |
|------------|---------------|-----------------|----------|
| Easy | 41-45 | Basic logical deduction | Beginners, casual players |
| Medium | 31-35 | Requires some skill | Experienced players |
| Hard | 21-25 | Complex deduction chains | Advanced players, challengers |
| Expert | 11-15 | Advanced technique combinations | Sudoku experts, competitive players |

## 🛠 Feature Details

### Notes System
- Record candidate digits in cells
- Conflicting notes are removed automatically
- Visual indicator for notes mode

### Timer & Statistics
- Precise timing down to the second
- The timer pauses while the game is paused
- Best times recorded per difficulty
- Shows completion rate and average solve time

### Save System
The following are saved automatically:
- Current board state
- Elapsed time
- Difficulty level
- Notes content
- Error count

### Assist Features
- Highlights matching numbers
- Conflict detection with warnings
- Optional auto-fill of cells with a single possible value
- Undo/redo support

## 📱 Mobile Experience

### Touch Optimization
- Large touch targets
- Mistap prevention
- Gesture navigation support
- Virtual number pad

### Screen Adaptation
- Automatically resizes the grid
- Optimized landscape/portrait layouts
- Special optimizations for small screens
- Enhanced tablet view

## 💻 Technical Implementation

### Frontend Technologies
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Storage**: LocalStorage for data persistence

### Core Algorithms
- Backtracking algorithm to generate valid Sudoku puzzles
- Unique-solution verification algorithm
- Difficulty rating system
- Efficient solver

### Performance Optimizations
- Lazy loading of non-critical resources
- Event delegation to reduce listeners
- Debounced window resizing
- Efficient DOM operation strategies

## 📁 Project Structure

```
shudu/
├── css/
│   └── style.css      # Responsive style files
├── js/
│   ├── shudu.js       # Core Sudoku logic (generation, validation)
│   ├── storage.js     # Storage management (saves, history)
│   └── game.js        # Main game logic (flow control)
├── index.html         # Main page entry
└── README.md          # Project documentation
```

## ❓ FAQ

### The game is too hard—any tips?
Try using "cross-hatching" and "naked singles" techniques, starting with the cells that have the highest certainty. You can also use the in-game hint feature for help.

### How do I use the notes feature?
On desktop, hold the Shift key while clicking a number. On mobile, tap the "Notes" button first to enable notes mode, then tap a number.

### Is game progress saved?
Yes, the game saves your progress automatically. The next time you open the game, you can choose to continue your previous game or start a new one.

### How do I change the difficulty?
Tap the difficulty selector on the interface, choose your desired level, then tap "New Game".

### How do I enable dark mode?
Tap the theme toggle button in the top-right corner to switch between light and dark modes.

## 👥 Contributing

We welcome all forms of contribution, including but not limited to:
- Reporting issues and suggestions
- Submitting feature requests
- Code contributions and Pull Requests
- Documentation improvements

Please contribute through GitHub Issues or Pull Requests.

## 📄 License

This project is licensed under the MIT License. For details, see the [LICENSE](../LICENSE) file.
