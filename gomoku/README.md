# 五子棋游戏

一个现代化的五子棋游戏实现，支持人机对战和双人对战模式。

## 功能特性

- 🎮 经典五子棋游戏玩法
- 🤖 支持人机对战和双人对战模式
- 🌓 支持明暗主题切换
- 🎨 简洁美观的棋盘和棋子设计
- 📱 响应式设计，支持移动端和PC端
- 🏆 记录对战历史
- 👆 鼠标悬停显示棋子虚影，提升操作体验

## 游戏规则

1. 棋盘为15×15的网格
2. 黑白双方轮流落子
3. 先在横、竖或斜方向连成五子的一方获胜

## 如何玩

### PC端操作
- 鼠标点击棋盘交叉点落子
- 鼠标悬停在棋盘上会显示半透明的棋子虚影，预览落子位置
- 游戏自动切换玩家回合
- 胜利时自动显示获胜方

### 移动端操作
- 触摸棋盘交叉点落子
- 其他规则与PC端相同

## 游戏功能

- **新游戏**：随时开始新的游戏
- **模式选择**：人机对战或双人对战
- **主题切换**：支持明暗两种主题
- **胜负判定**：自动检测五连珠
- **游戏记录**：记录对战历史

## 技术实现

- 使用原生JavaScript实现，不依赖任何框架
- 使用Canvas绘制棋盘和棋子
- 使用Canvas绘制半透明棋子实现鼠标悬停虚影效果
- 通过mousemove和mouseleave事件监听器实现鼠标位置追踪
- 使用CSS3实现流畅的动画效果
- 响应式设计适配不同设备
- 模块化的代码结构，便于维护和扩展

## 浏览器兼容性

- Chrome（推荐）
- Firefox
- Safari
- Edge
- 现代移动端浏览器

## 本地运行

1. 克隆或下载项目代码
2. 使用现代浏览器打开`index.html`文件
3. 开始游戏！

## 项目结构

```
gomoku/
├── css/           # 样式文件
│   └── style.css   # 游戏样式
├── js/            # JavaScript源代码
│   ├── game.js    # 游戏核心逻辑
│   └── storage.js # 存储管理
├── index.html     # 游戏主页面
└── README.md      # 项目说明文档
```

## 开发说明

游戏的核心逻辑在`GomokuGame`类中实现，主要包括：
- 游戏初始化
- 棋盘状态管理
- 落子逻辑
- 胜负判定
- 人机对战AI
- 主题切换
- 设备适配
- 鼠标悬停虚影效果

数据持久化由`GameStorage`类处理，负责：
- 游戏状态的保存和加载
- 对战历史记录

## 贡献

欢迎通过GitHub提交：
- Bug报告
- 功能请求
- Pull Request

## 许可

MIT License