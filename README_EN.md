# <img src="./assets/images/flea-game.png" width="80" height="80"> Flea Game [![build and deploy](https://img.shields.io/github/actions/workflow/status/huazie/huazie.github.io/pages.yml?branch=main&label=build%20and%20deploy&logo=github)](https://github.com/huazie/huazie.github.io/actions/workflows/pages.yml) [![license](https://img.shields.io/badge/license-MIT-orange)](https://github.com/huazie/hexo-theme-diversity/blob/main/LICENSE) [![GitHub Repo stars](https://img.shields.io/github/stars/huazie/flea-game?style=flat)](https://github.com/huazie/flea-game/stargazers)

Flea Game is a collection of small web-based games, aiming to provide a series of simple, fun, and easily accessible browser games. Each game is built with pure HTML, CSS, and JavaScript — no installation required, just open your browser and play.

[中文说明/Chinese Documentation](README.md)

## 🎯 Game List

| Game | Description | Dev Difficulty | Game Difficulty | Status |
|------|------|----------|-----------|------|
| [Sudoku](./shudu/) | Classic number logic game with multiple difficulty levels and save support | 🛠️🛠️🛠️ | 🎮🎮🎮 | ✅ Completed |
| [2048](./2048/) | Number merging game — see how high you can score | 🛠️🛠️ | 🎮🎮 | ✅ Completed |
| [Snake](./snake/) | Classic snake game that tests your reflexes | 🛠️🛠️ | 🎮 | ✅ Completed |
| [Memory Match](./memory/) | Memory-testing card flipping game — find all the pairs | 🛠️ | 🎮🎮 | ✅ Completed |
| [Minesweeper](./minesweeper/) | Classic logic deduction game — watch out for mines | 🛠️🛠️🛠️ | 🎮🎮🎮 | ✅ Completed |
| [Tetris](./tetris/) | Classic block stacking game that challenges your spatial thinking | 🛠️🛠️🛠️ | 🎮🎮🎮 | ✅ Completed |
| [Gomoku](./gomoku/) | Classic strategy game — line up five in a row to win | 🛠️🛠️🛠️ | 🎮🎮🎮🎮 | ✅ Completed |
| [Match 3](./match3/) | Classic match-3 game — connect identical elements for high scores | 🛠️🛠️ | 🎮🎮 | ✅ Completed |
| [Sokoban](./sokoban/) | Classic box-pushing puzzle game — push all boxes to the targets, with level creation, sharing, and batch export | 🛠️🛠️🛠️ | 🎮🎮🎮 | ✅ Completed |
| [Dino Run](./dino/) | Pixel dino runner — jump over cacti, duck under pterodactyls, with long-press high jumps and dive drops | 🛠️🛠️🛠️ | 🎮🎮 | ✅ Completed |

### Dev Difficulty (🛠️)
- 🛠️ Beginner: basic DOM operations, simple logic
- 🛠️🛠️ Intermediate: requires some algorithm basics, relatively simple state management
- 🛠️🛠️🛠️ Advanced: requires more complex algorithms and moderately challenging state management
- 🛠️🛠️🛠️🛠️ Expert: requires complex algorithms and data structures, complex state management

### Game Difficulty (🎮)
- 🎮 Beginner: simple rules, easy to pick up
- 🎮🎮 Basic: requires basic strategic thinking
- 🎮🎮🎮 Intermediate: requires solid thinking skills and technique
- 🎮🎮🎮🎮 Expert: requires deep thinking and complex strategies

## 🚀 Quick Start

1. Clone the project
```bash
git clone https://github.com/huazie/flea-game.git
cd flea-game
```

2. Install dependencies
```bash
npm install
```

3. Start the dev server
```bash
# Normal mode
npm start

# Dev mode (caching disabled)
npm run dev
```

## 📂 Project Structure

```txt
flea-game/
├── assets/          # Static assets
│   ├── css/         # Stylesheets
│   ├── js/          # JavaScript files
│   └── images/      # Image assets
├── config/          # Configuration files
│   └── games.json   # Game configuration
├── shudu/           # Sudoku game
├── 2048/            # 2048 game
├── snake/           # Snake game
├── memory/          # Memory Match game
├── minesweeper/     # Minesweeper game
├── tetris/          # Tetris game
├── gomoku/          # Gomoku game
├── match3/          # Match 3 game
├── sokoban/         # Sokoban game
├── dino/            # Dino Run game
└── index.html       # Entry page
```

## 🛠️ Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Storage**: LocalStorage (game progress saving)
- **Responsive Design**: adapts to both desktop and mobile devices

## 🤝 How to Contribute

Contributions of all kinds are welcome, whether new games, feature improvements, or bug fixes:

1. Fork the project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Adding a New Game

1. Add the game configuration in `config/games.json`:
```json
{
  "id": "game-id",
  "name": "Game name",
  "description": "Game description",
  "link": "game-folder/index.html",
  "status": "active",
  "images": {
    "light": "assets/images/game-light.png",
    "dark": "assets/images/game-dark.png"
  }
}
```

2. Create the game directory and files

   - Create a new game folder in the project root
   - Implement the game logic and UI
   - Add a game-specific README.md
   - Update the game list in the main README.md
   - Submit a Pull Request

3. Update the game icon and preview images

## 📜 License

This project is open source under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👏 Acknowledgements

Thanks to all the developers and game enthusiasts who have contributed to this project.
