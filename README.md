# <img src="./assets/images/flea-game.png" width="80" height="80"> Flea Game [![build and deploy](https://img.shields.io/github/actions/workflow/status/huazie/huazie.github.io/pages.yml?branch=main&label=build%20and%20deploy&logo=github)](https://github.com/huazie/huazie.github.io/actions/workflows/pages.yml) [![license](https://img.shields.io/badge/license-MIT-orange)](https://github.com/huazie/hexo-theme-diversity/blob/main/LICENSE) [![GitHub Repo stars](https://img.shields.io/github/stars/huazie/flea-game?style=flat)](https://github.com/huazie/flea-game/stargazers)

Flea Game是一个基于Web技术的小游戏合集项目，旨在提供一系列简单有趣、易于访问的浏览器游戏。每个游戏都使用纯HTML、CSS和JavaScript实现，无需安装，打开浏览器即可游玩。

## 🎯 游戏列表

| 游戏 | 描述 | 开发难度 | 游戏难度 | 状态 |
|------|------|----------|-----------|------|
| [数独](./shudu/) | 经典数字逻辑游戏，支持多难度级别和游戏存档 | 🛠️🛠️🛠️ | 🎮🎮🎮 | ✅ 已完成 |
| [2048](./2048/) | 数字合并游戏，看看你能达到多高的分数 | 🛠️🛠️ | 🎮🎮 | ✅ 已完成 |
| [贪吃蛇](./snake/) | 经典贪吃蛇游戏，考验你的反应能力 | 🛠️🛠️ | 🎮 | ✅ 已完成 |
| [记忆翻牌](./memory/) | 考验记忆力的翻牌游戏，找出所有配对 | 🛠️ | 🎮🎮 | ✅ 已完成 |
| [扫雷](./minesweeper/) | 经典的逻辑推理游戏，小心地雷 | 🛠️🛠️🛠️ | 🎮🎮🎮 | ✅ 已完成 |
| [俄罗斯方块](./tetris/) | 经典的方块堆叠游戏，挑战你的空间思维 | 🛠️🛠️🛠️ | 🎮🎮🎮 | ✅ 已完成 |
| [五子棋](./gomoku/) | 经典的策略对战游戏，五子连珠获胜 | 🛠️🛠️🛠️ | 🎮🎮🎮🎮 | ✅ 已完成 |
| [消消乐](./match3/) | 经典的三消游戏，连接相同元素获得高分 | 🛠️🛠️ | 🎮🎮 | ✅ 已完成 |
| [推箱子](./sokoban/) | 经典的推箱子益智游戏，把所有箱子推到目标点，支持自制、分享与批量导出关卡 | 🛠️🛠️🛠️ | 🎮🎮🎮 | ✅ 已完成 |

### 开发难度（🛠️）
- 🛠️ 入门级：基础DOM操作，简单逻辑
- 🛠️🛠️ 进阶级：需要一定算法基础，状态管理相对简单
- 🛠️🛠️🛠️ 复杂级：需要较复杂的算法，状态管理有一定难度
- 🛠️🛠️🛠️🛠️ 专家级：需要复杂算法和数据结构，状态管理复杂

### 游戏难度（🎮）
- 🎮 入门级：规则简单，容易上手
- 🎮🎮 基础级：需要基本策略思维
- 🎮🎮🎮 进阶级：需要较强的思维能力和技巧
- 🎮🎮🎮🎮 专家级：需要深度思考和复杂策略

## 🚀 快速开始

1. 克隆项目
```bash
git clone https://github.com/huazie/flea-game.git
cd flea-game
```

2. 安装依赖
```bash
npm install
```

3. 启动开发服务器
```bash
# 普通模式
npm start

# 开发模式（禁用缓存）
npm run dev
```

## 📂 项目结构

```txt
flea-game/
├── assets/          # 静态资源
│   ├── css/         # 样式文件
│   ├── js/          # JavaScript文件
│   └── images/      # 图片资源
├── config/          # 配置文件
│   └── games.json   # 游戏配置
├── shudu/           # 数独游戏
├── 2048/            # 2048游戏
├── snake/           # 贪吃蛇游戏
├── memory/          # 记忆翻牌游戏
├── minesweeper/     # 扫雷游戏
├── tetris/          # 俄罗斯方块游戏
├── gomoku/          # 五子棋游戏
├── match3/          # 消消乐游戏
├── sokoban/         # 推箱子游戏
└── index.html       # 入口页面
```

## 🛠️ 技术栈

- **前端**：HTML5, CSS3, JavaScript (ES6+)
- **存储**：LocalStorage (游戏进度保存)
- **响应式设计**：适配桌面和移动设备

## 🤝 如何贡献

我们欢迎各种形式的贡献，无论是新游戏、功能改进还是bug修复：

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

### 添加新游戏

1. 在 `config/games.json` 中添加游戏配置：
```json
{
  "id": "game-id",
  "name": "游戏名称",
  "description": "游戏描述",
  "link": "game-folder/index.html",
  "status": "active",
  "images": {
    "light": "assets/images/game-light.png",
    "dark": "assets/images/game-dark.png"
  }
}
```

2. 创建游戏目录和文件

   - 在项目根目录创建新的游戏文件夹
   - 实现游戏逻辑和界面
   - 添加游戏专属README.md
   - 更新主README.md中的游戏列表
   - 提交Pull Request

3. 更新游戏图标和预览图

## 📜 许可证

本项目基于 MIT 许可证开源 - 查看 [LICENSE](LICENSE) 文件了解更多细节

## 👏 致谢

感谢所有为这个项目做出贡献的开发者和游戏爱好者。