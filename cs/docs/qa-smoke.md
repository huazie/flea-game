# 反恐突袭 · Phase 6 冒烟测试与质量门（T3 / 严守真）

**判定：CONCERNS** — 功能链路、数值基线、防作弊、错误路径、门户接入全部通过，0 个 Blocker/Critical；但发现 1 个 **Major** UI 缺陷（PC 误显移动端摇杆并遮挡 HP）和 1 个 **Minor** 外部依赖风险。建议修复 BUG-01 后复测放行；质量门为建议性，最终放行由用户决定。（**此为 T3 时点判定，保留作历史记录；T5 回归复测后最终判定：PASS，见文末「BUG-01 回归复测」一节。**）

- 环境：Chromium **153.0.8010.12** headless（`AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`），Node 22 内置 WebSocket + CDP（零 npm 包、零仓库污染），本地静态服 `127.0.0.1`；外部 CDN 主动阻断以模拟纯静态离线部署。
- **浏览器穷尽查找**（推翻「标准路径无浏览器」初查）：查过 12 个标准安装路径、`where.exe` 8 个名称、注册表 HKLM/HKCU/WOW6432 App Paths、4 个根目录递归 glob、5 处 npx/playwright 缓存 → 命中两处：注册表 `App Paths\Google Chrome.exe` → `C:\Users\Administrator\AppData\Local\Google\Chrome\Bin\chrome.exe`(v109)，以及 `ms-playwright\chromium-1243`(v153，实测 `--dump-dom` exit 0)。**真实浏览器验证已执行，非静态审查冒充**。
- 证据目录（全部仓库外）：`E:/fleaworkspace/qa-cdp/` — 5 个脚本、4 份 JSON、8 张 PNG。未改任何产品代码 / 全局文件 / package.json，未 commit、未留 node_modules。

## 逐条验证（怎么测 / 实际观测 / 结论）

| # | 项 | 怎么测 | 实际观测 | 结论 |
|---|---|---|---|---|
|1|真实浏览器|CDP 导航 `cs/index.html`，捕获 pageerror/console/log；`getImageData` 采样；截 1100×800 与 375×667|pageerror **0**、log error 0；console.error 2 条均为被阻断的外部 SDK 日志；菜单态 55000 采样点全 opaque / 137 色 / 亮度 88–235，游戏态 119 色，移动端 300×534 / 10050 点全 opaque / 96 色 → **真的绘制出非空画面，非黑屏**|**PASS**|
|1b|投影有限性|导航前注入 hook 包装 `moveTo/lineTo/fillRect/rect/arc` 捕获 NaN/Infinity|`__qaNonFinite = []`（0 处）→ 近裁剪 cz≥0.1 生效|**PASS**|
|1c|375×667 布局|`Emulation` 视口 + 触屏模拟后 reload，量 15 个控件 rect/z-index|scrollWidth=clientWidth=375，无 X/Y 溢出；15 控件两两重叠 **0 对**；`isTouchJS=true`、`renderScale=0.8`、`pointer:coarse=true`|**PASS**|
|1d|FAB 层级|量 `flea-comments-fab`/`flea-share-menu` computed 定位|`right:-27px`、右边界 402>375 初判出血；查 `assets/js/fab-stack.js:161-165` 确认为**触屏默认收起态**（PEEK=18，露 18px 边条、点击展开、localStorage 持久化），非缺陷；与 cs 触控控件无重叠|**PASS**|
|2|CSS 主题一致性|比对 `:root`/`[data-theme=dark]` 变量集；扫规则块硬编码色；切 dark 后采样 canvas|43↔43 变量一一对应（`missingInDark=[]`），13 个 `--cs-*` 全合法 hex，规则块硬编码 hex/rgb/hsl **0**；`renderer.js:41-61` 有完整 `\|\|` fallback、init 与 `themeChanged` 均刷新；切 dark 后 checksum 466522960→169622681、色数 119→86、minLum 110→46 → **真的换色，非取空串变黑**|**PASS**|
|3|数值与红线|运行时读 `CS.CFG`（45 键）逐项对照概念卡第 6 节|HP100 / DMG40 / MAG8 / 0.20s / 1.4s / 4.0-1.8 / ±3° / FOV75 / pitch±60 / BotHP80 / 3-4-5 / 0.35-0.45-0.55 / 1.2s / 8点 / 上限2 / 18m / 120° / 12 AABB / 2.0s+20 / 0.05s / Score=100×杀+10×中 **全部吻合**；12 盒 0 对相交、y 恒定|**PASS**|
|4|切镜零收益（防作弊）|同一目标分别以 FPS/TPS 相机位调 `doHitscan`；切镜前后快照；近墙回缩|FPS/TPS 命中各 1（`identical=true`，TPS 相机距 2.41m）→ **hitscan 从玩家眼位 `p.x,EYE_Y,p.z` 发出，与相机位解耦，无透视作弊**；切镜后 reloadT/fireT/intermission/hp/ammo/state/elapsed 全不变、FOV 固定 75、无无敌帧；近墙 camDist=0.352≥0.3、alpha=0.38、viewMode 仍 tps|**PASS**|
|5|错误路径与边缘情况|`blur`/`visibilitychange`/伪造 `pointerlockchange`；5s 大帧；多 Bot 同帧；HP 归零；结算后空转|全部 → paused，elapsed 900ms 冻结、须主动点「继续」；5s 大帧 delta=**0.05**=DT_MAX（不补算）；`shooterSlots=2`（上限2）/`pendingDamage=16`（2×8 累加后统一判死）；HP 下限 0 + 输入冻结 + 结算显示；结算后 900ms 无波次生成；Bot 失视线 2.0s 重选巡逻点(11→0)；空仓不发射/自动换弹/重复 R 与左键不排队/换弹中切镜计时继续；暂停态按 W 位置不变、resume 清空输入；重开全状态归零|**PASS**|
|6|性能硬指标|提取 renderer.js 14 个逐帧函数体扫 `new`/对象/数组字面量/字符串拼接/数组方法|13 个零违规；`drawFloats` 1 处经复核为**正则误报**（`'+100'` 浮字常量，非拼接）→ 实际零分配；`MAX_FACES=80`+faceGuard+预分配，实测 `faceCount=13`；暂停/失焦停帧；无 ES module/require/Three.js/WebGL/JS 内硬编码色/http/贴图/音频；核心 html+css+js+svg **78,776 B** < 100KB|**PASS**|
|6b|性能 Minor 观察|扫 hud.js 拼接|`hud.js:114` 波间 2s 窗口每帧生成一段短字符串；其余 11 处都在「值变化才写 DOM」分支内。ADR-3「逐帧零分配」若涵盖 HUD 路径则表述略宽，开销可忽略|**Minor**|
|7|门户接入完整性|首页加载 + 切主题；读 games.json / README / SVG；验证 `FleaSound.init`|首页 light→`assets/images/cs.svg`(naturalWidth 320)、dark→`cs-dark.svg`(320)，共 11 卡片；games=11 末项 cs；中英 README 表格行+结构树行齐全、链接 `./cs/`；两 SVG 合法、明暗共享色 **0**、无 script；`game.js:8` 顶层 `FleaSound.init('cs_sound')` 恰好 1 次，运行时 toggle 写入 localStorage `cs_sound` 证实生效|**PASS**|
|7b|门户 Minor 风险|阻断外部 CDN 后记录请求|`cs/index.html:12` font-awesome CDN CSS + `assets/js/comments.js:25` DiversityComments SDK CDN JS 共 2 个外部运行时请求；离线时 2 条 console.error、顶部 3 个圆钮图标空白。与概念卡第 8 行「零运行时依赖 / 纯静态可部署」有张力，属站点统一范式、不影响核心逻辑|**Minor**|
|8|可玩性冒烟|真实 CDP 键鼠输入走完整链路 + 3 波推进 + 重开|开始 → W 前进 z 0→1.734(4.0m/s，散布 3°) → yaw 0→0.15、pitch 钳至 60° → 左键 620ms 打出 4 发 / 2 命中 / 1 击杀 / **Score 120**(=100+2×10) / 弹匣 8→6；3 波推进到 waveIdx2、`state=over`、标题「任务完成」、3/3；「再来一局」全状态归零；暂停中开火无效；结算后波次不再生成|**PASS**|

## Bug 清单（发现即报，不自行修改产品代码）

| ID | 严重度 | 文件:行 | 复现步骤 | 观测 / 影响 | 建议 |
|---|---|---|---|---|---|
|BUG-01|**Major**|`cs/css/style.css:180` 与 `:182-187`|Chromium 1100×800（`pointer:fine`）加载 `cs/index.html` → 点「开始任务」|左下出现 116×116 虚拟摇杆：computed `display:flex`（应为 none）、`z-index:8`；与 `#hud-hp`(z=2, x20–176 / y703–780) 重叠 **8159 px²**，遮挡 HP 数字与血条；误触该区域会触发开火（`isUI()` 未排除 joystick）。根因：`#joystick{display:flex}` 特异性(1,0,0) 压过 `.touch-only{display:none}`(0,1,0)，媒体查询关不掉。**不阻断逻辑**（PC 键鼠仍可通关），但主视口 HUD 被遮挡|把 `display:flex` 从 `#joystick` 基础规则移入 `@media (max-width:820px),(pointer:coarse)` 内，或提高 `.touch-only` 特异性；修复后复测 PC 视口|
|BUG-02|**Minor**|`cs/index.html:12`；`assets/js/comments.js:25`（站点公共模块）|纯静态离线部署 / 阻断外部 CDN 后加载页面|2 个外部运行时请求失败，顶部「返回/音效/主题」圆钮图标空白、评论区不可用；核心游戏逻辑不受影响|确认是否作为站点已知范式接受；若要求严格零依赖，改内联 SVG 图标 + 本地化 SDK|

## 证据缺口 MISSING（不以「静态审查通过」代替实测）
1. **真实桌面 Pointer Lock 完整链路**：headless 缺用户手势，`requestPointerLock()` 未真正锁定；已用伪造 `pointerLockElement` + `pointerlockchange` 验证「丢失→自动暂停」路径，用 `CS.Input.lookDX` setter 注入验证 yaw，但真实 `movementX/Y` 驱动转视角未复现。
2. **真机多点触控 / AudioContext 实际发声**：headless 无法听声，仅确认 `FleaSound` API 与 `cs_sound` 持久化生效、无异常。
3. **60s 连续帧时间 / GC 抖动**：仅有静态零分配、`faceCount=13`、44 帧渲染证据，未做长稳帧采样（headless 调度与真机不同）。
4. **外部 CDN 可达时的完整视觉**：本次主动阻断，图标与评论区为降级态。
5. T2 所列「3D 观感 / TPS 穿墙回缩手感」属主观项，已改用可测量证据（像素采样、面数、色值、FOV、camDist / alpha）替代；截图见文末。

## 待审批 / 下一步建议
1. **BUG-01 修复前是否放行**：我建议「修复 + PC 视口复测后放行」；若用户接受带此 Major 上线，请显式记录豁免。
2. **BUG-02 是否接受为已知范式**：需主理人 / 用户确认，或列入后续「去除外部依赖」改造项。
3. 建议补一次真机 / 联网环境的 Pointer Lock 与 FAB 展开交互复测。
4. T4 汇编可继续；本报告为建议性质量门，不构成发布签字。

## 截图与数据（仓库外绝对路径）
PNG（`E:/fleaworkspace/qa-cdp/`）：`cs-pc-1100x800-menu.png`、`cs-pc-1100x800-playing.png`、`cs-pc-1100x800-playing-confirm.png`、`cs-pc-1100x800-tps.png`、`cs-pc-1100x800-dark.png`、`cs-mobile-375x667.png`、`cs-mobile-375x667-playing.png`、`cs-mobile-375x667-dark.png`
JSON：`qa-browser-result.json`、`qa-supplement-result.json`、`qa-static-result.json`、`qa-visual2-result.json`

---

## BUG-01 回归复测（T5 / 严守真）

**最终质量门判定：PASS** — BUG-01 已修复且三视口独立复测通过，无阻塞项；BUG-02 经主理人裁定为站点已知范式、保留为已知风险，不压判定；T3 的 5 项 MISSING 继续如实保留。本节结论全部来自我自己的 CDP 证据链，实现者脚本 `cs-cdp-check.js` 仅作交叉比对、不作结论来源。

- 修复核对（读磁盘原文）：`cs/css/style.css:186` 已删 `display:flex`（现仅 `align-items/justify-content`）；`:257` 在 `@media (max-width:820px),(pointer:coarse)` 内新增 `#joystick{display:flex}`；`:180 .touch-only{display:none}`、`@media (max-height:520px)` 内 `#joystick` 尺寸、以及 JS/HTML/README/games.json 均未动，未 commit。
- 方法：自建 `E:/fleaworkspace/qa-cdp/qa-regression.mjs`（Node 22 内置 WebSocket + CDP，Chromium 153 headless，本地静态服，外部 CDN 阻断）。三视口各自 `Page.reload` 后量测 computed display / rect / offsetParent / `elementFromPoint` / knob 中心偏移 / 15 控件两两重叠 / canvas `getImageData`，并跑真实键鼠链路。证据：`qa-regression-result.json` + 5 张 `reg-*.png`。

### 判据口径确认（实现者提醒，已独立验证成立）
PC 下 `#btn-fire` 等 4 个 `.tbtn` 的 computed display 仍为 **`'block'`**（父 `#touch-buttons` display:none 不改写子元素自身 computed display），但 `rect=0×0`、`offsetParent===null`、`elementFromPoint` 返回 null → 不可见。若按「tbtn computed display 应为 none」判定会**假阳性**。本次统一采用 **rect / offsetParent / 命中测试**口径。

### 三视口观测

| 视口 | 怎么测 | 实际观测值 | 结论 |
|---|---|---|---|
|A: PC 1100×800 / pointer:fine|`Emulation` 1100×800 + `setTouchEmulationEnabled(false)` + reload；菜单态与游戏态各量一次|`mediaCoarse=false`、`renderScale=1`；`#joystick` display **none** / rect **0×0** / offsetParent=null / visibleByRect=false；`#look-zone`、`#touch-buttons` display **none** / rect 0；**joystick 与 `#hud-hp` 重叠 = 0**（修复前 8159 px²）；原缺陷坐标 (74,670) 游戏态 `elementFromPoint` = **`cs-canvas`**（修复前命中 joystick）→ 左下恢复穿透到画布；15 控件重叠 **0 对**；截图 `reg-pc-fine-playing.png` 目视确认摇杆消失、HP 块（HP/绿条/92）完整无遮挡|**PASS**|
|B: 375×667 / coarse|`Emulation` 375×667 mobile:true DPR2 + 触屏模拟 + reload|`mediaCoarse=true`、`maxTouchPoints=5`、`isTouchJS=true`、`renderScale=0.8`；`#joystick` display **flex** / rect (16,527,116,116)；`#joy-knob` 相对中心偏移 **[0,0]**；`#look-zone`/`#touch-buttons` display **block**；4 个 tbtn 全部 rect 有效、offsetParent 非 null、`elementFromPoint` 各自命中自身；**真实点击 btn-view 中心 (244,486) → HUD 由 FPS 变 TPS**（worked=true）→ 可见且可点；15 控件重叠 0 对；scrollWidth=clientWidth=375 无溢出|**PASS**|
|C: 1100×800 / pointer:coarse|保持 1100 宽、`setTouchEmulationEnabled(true)` + reload（命中第二分支）|`mediaCoarse=true`（无需 `setEmulatedMedia`）、`renderScale=0.8`；`#joystick` display **flex** / rect (16,660,116,116)；knob 偏移 **[0,0]**；`#look-zone` **block** (550,0,550,800)、`#touch-buttons` **block** (0,0,1100,800)；4 tbtn rect 有效（btn-fire 1008,574,76×76 等）；15 控件重叠 0 对；joystick 与 hud-hp 重叠 0（媒体查询把 HP 上移到 bottom:150px）→ 宽屏触屏第二分支同样生效|**PASS**|

### 无回归项（独立观测）

| 项 | 实际观测 | 结论 |
|---|---|---|
|画布非空|PC 菜单 55000 采样点全 opaque / 119 色 / checksum 466522960；PC 游戏态 138 色；移动端 300×534 / 10050 全 opaque / 96 色；宽屏触屏 880×640 / 35200 全 opaque / 85 色|**PASS**|
|暗色主题|切 dark 后 PC checksum 465598242 → **161999564**、色数 138→121，`darkChecksumChanged=true` → 调色板仍刷新、无「取空串变黑」|**PASS**|
|核心可玩链路|真实 W 前进 z 0→1.666(4.0m/s，散布 3°)、lookDX 使 yaw 0→0.12；左键 620ms → 4 发 / 2 命中 / 1 击杀 / **Score 120** / 弹匣 8→6；3 波推进 → `state=over`、waveIdx 2、「任务完成」、结算可见；点「再来一局」→ waveIdx0/score0/kills0/hp100/ammo8/elapsed0/alive3/reloading=false/intermission=0 全归零|**PASS**|
|控制台|pageerror **0**；console.error 4 条全部为主动阻断的 DiversityComments SDK 外链日志（4 次导航各 1 条），无新增错误|**PASS**|
|静态/基线|`node --check cs/js/*.js` **7/7 OK**；`E:/fleaworkspace/cs-harness.js` 74 断言复跑 **ALL PASS**；`git status --short` 与修复前一致（M README.md / README_EN.md / config/games.json + ?? 两张 SVG + ?? cs/），未 commit、无 node_modules 落入仓库|**PASS**|
|交叉比对|实现者 `cs-cdp-check.js` 三视口 20 断言 ALL PASS，其 A/B/C 的 joystick rect、knob offset、4 tbtn rect、look-zone/touch-buttons display 与我的独立观测**逐项一致**；差异仅在其 B 阶段 `pointer:coarse=false`（由 `max-width:820px` 分支命中），我额外开触屏模拟使 coarse=true，不影响 CSS 结论|一致|

### 遗留与阻塞项
- **阻塞项：无。** BUG-01 已关闭；BUG-02 由主理人裁定「属站点 10 款游戏统一范式、用户要求参考现有项目结构」→ **接受为已知风险，不修、不压判定**；`hud.js:114` 波间短字符串拼接仍为 Minor 观察，不影响 60fps 目标。
- T3 列出的 5 项 **MISSING 继续如实保留**（真实 Pointer Lock 手势链路 / 真机多点触控与 AudioContext 发声 / 60s 帧时间与 GC / 外部 CDN 可达时视觉 / 主观观感）。本次为 CSS 修复回归，未新增能消除这些缺口的证据，不以静态审查顶替。
- 待用户审批：① 是否接受带上述 5 项 MISSING 放行（我建议可放行，质量门为 advisory）；② 是否在后续迭代补真机 Pointer Lock / 联网 CDN 视觉复测。

### T5 证据（仓库外）
`E:/fleaworkspace/qa-cdp/`：`qa-regression.mjs`、`qa-regression-result.json`、`reg-pc-fine-menu.png`、`reg-pc-fine-playing.png`、`reg-pc-fine-dark.png`、`reg-mobile-375-playing.png`、`reg-pc-coarse-1100x800.png`

---

## v2 独立质量门（T8 / 严守真）

**判定：PASS** — 跳/蹲、枪械视图模型、程序化纹理渲染、特效全部按概念卡第 11 节落地且经真实浏览器 CDP 独立复测通过：0 个 Blocker/Critical/Major，红线（切镜零收益、零分配、零依赖）逐位成立；T7 三项声明取舍经验证确为取舍而非缺陷；无阻塞项。

- 方法：自建 `E:/fleaworkspace/qa-cdp/qa-v2-t8.mjs` + `qa-v2-t8-kick.mjs`（Node22 原生 WebSocket + CDP，Chromium 153 headless，本地静态服，外部 CDN 主动阻断，零 npm 包/零仓库污染/未 commit）。数值对照读运行时 `CS.CFG`；跳/蹲/开火用真实 `Input.dispatchKeyEvent/MouseEvent/TouchEvent`；瞄准经 `CS.Input.lookDX/lookDY` 输入管线注入。证据：`qa-v2-t8-result.json`、`qa-v2-t8-kick.json`、5 张 `t8-*.png`（全部仓库外）。
- T7 自测报告仅作背景交叉参考，本节全部结论来自我自己的证据链。

### 逐项验证

| # | 项 | 怎么测 / 实际观测 | 结论 |
|---|---|---|---|
|1|体积·语法·依赖红线|`node --check` 8/8 OK；html+css+js 合计 **114,425 B** ≤ 150KB；Grep 无 import/require/ES module/箭头函数/class/WebGL；外部运行时请求仅 `index.html:12` font-awesome CDN（T5 已裁定站点范式，维持 BUG-02）|**PASS**|
|2|逐帧零分配|renderer.js 25 个逐帧函数 + game/entities/world 12 个热函数扫 new/字面量/拼接/数组方法/模板串：**全零违规**（`drawFloats` 的 `'+100'` 仍为常量误报）；`hud.js` update 9 处拼接全部在「值变化才写 DOM」分支内——落地衰减 0.30s/换弹进度/整备倒计时窗口近每帧短字符串，属 HUD 路径豁免口径，**标注不压判定**（沿 v1 Minor）；音效分配仅事件驱动调用（sfx.js 顶部注释自认，豁免已标注）|**PASS**|
|3|数值对照（11.1/11.3/11.5/11.6）|运行时读 `CS.CFG` 全部吻合：JUMP_V 4.5 / CROUCH_JUMP_MUL 0.85(=3.825) / GRAVITY 12 / AIR_ACCEL 3.6 / AIR_SPREAD 12 / LAND_SPREAD 10·LAND_DECAY 0.30 / EYE 1.60→1.05·TRANS 0.15 / CROUCH_SPEED 2.0 / CROUCH_SPREAD 1.0 / KICK 1.2°·0.15s / SWAY 6px·1.6Hz / LAG 0.06s·10px·τ0.15 / RECOIL 12·4·τ0.10 / VM 0.72·0.85·DROP40·ROT25 / RELOAD 0.25·0.90·0.25 / MUZZLE 0.04s / HOLE 32·0.06m·0.01m / PARTICLE 64 / SHELL 8 / MAX_FACES 80 / FOG 10·40 / FPS_MIN 45 / FOOTSTRIDE 1.8|**PASS**|
|4|画布非空·纹理·渐变·视图模型|`getImageData` 全画布：菜单 97,989 点全 opaque/403 色、游戏态 451 色；`debugPatterns` 4×true、`debugTex` 砖3/混凝土3/木箱7/地面3 色全不透明、`debugPatternTest`=3；天空渐变像素实测 顶部[129,140,153] ≠ 1/4 处[176,191,207]；FPS 视图模型区域 21,788 采样点 217 色 minLum=55（深色枪体像素存在）；截图 `t8-pc-playing.png` 目视：砖纹/混凝土/木箱 X 撑/网格地面/右下几何枪/准星/HUD 齐全|**PASS**|
|5|跳/蹲实测（真实键盘）|Space：peakY **0.807**（理论 0.84 − 60fps 半隐式离散 ≈0.03，吻合）、峰值 vy 4.30（初速 4.5 首帧衰减）、滞空 ≈0.75s、落地 onGround 恢复。ControlLeft：eyeCur 1.60→1.478→1.294→1.111→**1.05**（≈0.15s）；**过渡期 spreadDeg=+1.0 后归 0**（蹲起过渡惩罚实测）；KeyC 别名等效；松开对称回 1.60|**PASS**|
|6|踢枪进射线+下拉补偿|13m 有视线 Bot 公告板顶沿(y=1.80)瞄准：无补偿首发 **未命中**（+1.2° 上踢越顶，12m 外越顶沿成立）、−1.2° 补偿后 **命中**（score+10）；0.15s 后 kick=0 回落。→ T7 取舍③验证为「概念卡 11.3 明示的真实代价」，**Minor/Known-Issue 不压判定**|**PASS**|
|7|空中/落地散布|Shift 按住起跳：空中 spread 恒 **12**（Shift 空中无效）；落地系列 7.78→6.11→3.89→1.67→0 线性衰减 ≈0.30s（±10→0 @0.30s）|**PASS**|
|8|弹孔 FIFO·粒子·弹壳池|对北墙真实按住左键连打 40 发：holes 时间线 6→10→…→**32 封顶不增**（>32 后 FIFO 覆盖）；maxParticles 32≤64、maxShells 3≤8，全程无越界|**PASS**|
|9|切镜零收益（动态眼位）|暂停态同起点同方向 FPS vs TPS 各跑 `doHitscan`：**空中眼位 y=2.40** 与 **蹲眼位 y=1.05** 两组 `E.hitT=15.77049263624013 / hitAxis=2 / hitSign=−1` **逐位相等**；Score 公式不变（通关实测 1440=12×100+24×10）|**PASS**|
|10|暂停/失焦/停帧|真实 `blur` 事件 → paused，elapsed 5.4998 两次采样冻结不变，恢复须点「继续」（v1 断言回归通过）|**PASS**|
|11|暗色主题|`theme-button` 切换后画布 checksum 833041785→**289823852**、色数 264→222；纹理/调色板经 `themeChanged` 重建（代码路径 renderer.js:165-221）|**PASS**|
|12|<45fps 自动降级|`Emulation.setCPUThrottlingRate(16)` 压帧 → `CS.Renderer.id='flat'`（单向切换），Flat 纯色块出图非空（264 色，`t8-pc-flat.png` 目视无纹理纯色块）；通关阶段 headless rAF 自然 <45fps 亦自动触发——两条路径均验证 `game.js:409` checkPerf 链路|**PASS**|
|13|移动端 375×667|scrollWidth=clientWidth=375 无溢出；`btn-jump`/`btn-crouch` 各 **44×44** 且蹲在跳左侧、开火钮左上方位次正确；12 个可见控件两两重叠 **0 对**；真实触点 tap 跳钮 → peakY 0.802、tap 蹲钮 → `crouch=true`+`is-on` 类、再点还原（11.7 切换式）|**PASS**|
|14|完整通关+再来一局|真实键鼠链路 1 次尝试通关：**12 杀 / 24 发 24 中 / score 1440 / waveIdx 2 / 结算「任务完成」**，期间穿插真实 Space 跳跃与 Ctrl 蹲（射线随实际眼位命中成立）；「再来一局」→ waveIdx0/score0/kills0/shots0/hp100/ammo8/elapsed0 全归零|**PASS**|
|15|门户|`.games-grid` 渲染 **12 卡**（11 旧 + `sg/` 并行新增——如实记录，见隔离节）；cs 卡 light→cs.svg、dark→cs-dark.svg 均 naturalWidth>0 有效|**PASS**|

### Bug 清单

| ID | 严重度 | 文件:行 | 说明 |
|---|---|---|---|
|—|—|—|本轮 cs/ v2 范围 **未发现新缺陷**（0 Blocker / 0 Critical / 0 Major / 0 Minor 缺陷）|
|OBS-01|Minor 观察|`cs/js/hud.js:89-126`|9 处字符串拼接均在「值变化才写 DOM」分支；连续变化窗口（落地 0.30s/换弹/整备）近每帧短字符串。v1 已记录，开销可忽略，不压判定|
|OBS-02|Known-Issue|`cs/index.html:12`|font-awesome CDN 外部请求（T5 裁定的站点统一范式 BUG-02 延续）；本轮阻断下仅该图标降级，核心逻辑零影响|

### 证据缺口 MISSING（如实，不以静态审查顶替）
1. **真实桌面 Pointer Lock 手势链路**：headless 无用户手势，`requestPointerLock()` 未真正锁定；瞄准经输入管线 setter 注入，真实 movementX/Y 未复现（沿 v1）。
2. **真机多点触控 / AudioContext 实际发声**：触控经 CDP 触屏模拟，真机未测；发声仅验证 API/状态机无异常，无法听声（沿 v1）。
3. **60s 连续帧时间 / GC 长稳**：本轮最长单会话 ≈40s（通关 34.4s 实跑）但未采样帧时间序列；headless 调度与真机不同（沿 v1）。
4. **外部 CDN 可达时的完整视觉**：主动阻断，图标为降级态（沿 v1）。
5. **主观观感**：以像素采样/截图替代，不做主观评分（沿 v1）。
6. **距离雾独立取证**：天空渐变已像素验证、雾为同路径叠填（renderer.js:709-713 代码验证 + 截图目视），未做逐面隔离测量。
7. **蹲起反向输入排队（eyePend）行为化复现**：0.15s 内蹲→起→蹲防抖未实测，仅代码路径验证（game.js:230-245）。

### 与并行变更的隔离确认
cs/ 变更未波及并行产物：`sg/`、`docs/`、`assets/images/sg*.svg` 全程未被我读取修改、仍然存在；根 README sg 行（README.md:22/79、README_EN.md 对应行）完好；`git status` 与开工时一致（M README×2 / M games.json / ?? cs*.svg / ?? cs/ + 并行 ?? sg/ ?? docs/ ?? sg*.svg），未 commit、assets/js 公共模块无 M、仓库无 node_modules。**如实记录**：`config/games.json` 现为 **12 项**（cs 第 11 项 + sg 第 12 项并行注册），首页因此渲染 12 卡——此为并行变更所致，不作评价、不纳入 cs/ 判定。

### 待主理人/用户审批
1. 门户/manifest 因并行 sg 注册变为 12 卡/12 项，超出本工单「11」口径——请确认并行变更归属与口径。
2. 上述 5 项沿袭 MISSING + 2 项新增小缺口是否接受放行（我建议可放行，质量门为 advisory）。
3. T7 三项取舍已经验证确为取舍（纹理屏幕空间 pattern / 弹孔无深度测试 / 踢枪首发越顶沿可下拉补偿），建议记录为 Known-Issue，无需返工。

---

## v3 独立质量门（T3 / 严守真 · Phase 6 前置 · WebGL）

**判定：CONCERNS**（建议性质量门，不构成发布签字）— 功能/数值/错误路径/许可/门户逐条 PASS，**0 Blocker / 0 Critical / 0 Major**；3 项文档·规格一致性待裁定（OBS-01/02/04），裁定并加注后可转 PASS，**不阻塞 T4 汇编**。
- 方法：自建 `E:/fleaworkspace/qa-v3/*.mjs`（Node22 原生 WebSocket + Chromium153 headless/SwiftShader，本地静态服，外部 CDN 阻断，零 npm 包），独立设计「逐组染色 / 隐藏枪 / 注入失败 / 确定性 40fps」差分；T2 自测仅作背景、结论未复用。`cs/` 4,963,087 B / 34 文件；8 个逻辑文件与 `git show HEAD:` 逐字节一致；`node --check` 11/11 OK。

### 逐条验证（怎么测 → 实际观测值 → 结论）
| # | 项 | 怎么测 → 实际观测值 | 判定 |
|---|---|---|---|
|1|真实浏览器 / 错误|CDP 导航 `cs/index.html`，捕获 pageerror/exception/console/网络；`gl.readPixels` 全画布|pageerror **0**、exception **0**、console.error 仅被阻断 SDK 与降级预期日志；GL canvas 全 opaque、4955 色、checksum 65472259（非黑屏/非纯色）|**PASS**|
|2|12 槽进采样管线|读 4 组材质 12 槽 uuid/尺寸/encoding + 逐组把 map 换 1×1 纯色重渲染读像素 + 摘除 normal/rough|12 uuid 唯一、全 1024²、color sRGB(3001) / normal·rough Linear(3000)、metal normalScale 0.35 其余 0.6；染色 brick→红1664 / concrete→绿4249 / metal→蓝974 / ground→黄5300 像素且**仅目标色出现**；Δnormal 45324、Δrough 70946499；还原 Δ=**0**|**PASS**|
|3|墙组绑定|遍历 `worldRoot` 12 个 BoxGeometry 的 material|序列 = brick×4 / concrete·metal 交替×8，与 `wallGroups` 逐项一致|**PASS**|
|4|枪械 FPS/TPS|`gunGroup`/`tpsGunGroup` 几何与 `Box3`、隐藏后区域像素差分|均 glTF clone（BufferGeometry×2，非兜底 Box）；TPS `Box3` 0.1488×0.3449×0.8017 m（≈0.80 m）；FPS 隐藏右下 Δ40321900、TPS 隐藏全屏 Δ1362540；`gunPivot.visible` FPS true / TPS false|**PASS**|
|5|人物未立体化|读资产表、模板、场景 Group 几何、hitscan 源码|`models.bot/player=''`、模板 bot/player=null、无人物 GLB 请求；6 槽为 6×BoxGeometry 程序化人偶；判定仍走 `entities.js` 公告板矩形（BOT_Y0 0.10 / Y1 1.85 / HALF_W 0.32）|**PASS**（口径见 OBS-02）|
|6|明暗主题|切 `data-theme=dark` + `themeChanged` 后重渲染读像素|checksum 2436364382→974549291、色数 29111→5120；`material.color` ffffff→93a7c4|**PASS**|
|7|三视口|`Emulation` 1100×800 / 375×667 / 1024×600 reload，量 rect、重叠、vFov|无溢出（scrollW=clientW）；16 个可见控件两两重叠 **0 对**；vFov 58.3279 / 107.5397 / 48.4179° 与 `hFovToVFov(75,w,h)` 误差 **0°**；GL 位图 1100×800 / 300×534 / 1024×600 均出图；干净会话 15 控件 `elementFromPoint` 全命中自身/预期事件层、真实触屏 tap 换镜/开火生效|**PASS**|
|8|完整通关 / 再来一局|GL 后端保持下同步驱动 `g.update(0.05)` 三波 + 真实键鼠事件|id 全程 **gl**；12 杀 / score 1320 / waveIdx 2 /「任务完成」3/3 → 再来一局全归零；真实 W 0→1.2 m（4.0 m/s）、左键 2 发 8→6|**PASS**|
|9|切镜零收益（WebGL）|4+3 组（地面 / 空中 y0.8 / 蹲 1.05 / 空中+蹲+pitch），FPS vs TPS 各跑 `doHitscan` 比玩家快照、fov、hitT/axis/sign、命中索引、score|全部 `identical=true`；含真实 Bot 命中（hitT 5 / 5.036、score 10、botHp 80→40）；`player` 前后逐位相等 → RendererGL 不写游戏状态|**PASS**|
|10|数值零漂移|8 逻辑文件 `cmp git show HEAD:` + 运行时读 CFG|逐字节一致（3179/5790/5934/36898/4561/10742/7288/18882 B）；CFG **65 项 0 mismatch**，波次 3/4/5、命中率 0.35/0.45/0.55、Score=100×杀+10×中；`rayWalls` 7 参 / `hitScan` 8 参；GL 全文无 `THREE.Raycaster`|**PASS**|
|11|降级链|`--disable-webgl --disable-3d-apis` 启动 / `webglcontextlost` / 短窗口 / 确定性 40fps|禁 WebGL→`Renderer2D`（reason `context-create-failed`）、**0 资产请求**、2D 出图 317 色、完整通关；contextlost→单向 `tex`（reason `webglcontextlost`）；10 短帧不误降级；40fps×2 轮 → **gl→tex→flat**|**PASS**|
|12|资产失败错误路径|`Network.setBlockedURLs` 注入全失败 / 部分失败 / `file://`|全失败 failed=**14**、12 槽全 64² 程序化、模板全空、枪 5×Box 兜底、0 个 HTTP 4xx/404、仍通关；部分失败 textures=9、brick 兜底其余 1024²、仍通关；`file://` 14 项失败但兜底出图且通关|**PASS**|
|13|setURLModifier 定向|A1 / D2 网络请求计数对照|A1：`colormap.png` **零网络请求**、`tex_concrete_basecolor.jpg` 3 次（1 正常 + **2 重定向**）、其余贴图各 1 次；D2 阻断 GLB 后该图**恰好 1 次**、redirects=0 → 未串改其它贴图|**PASS**|
|14|性能 / 体积 / 依赖|游戏态 `frameStats` + 20 个热函数体扫描 + `find` + vendor|drawCalls **10** / triangles **1826**；热路径零 `new` / 字面量 / 拼接 / 数组方法（音效事件驱动豁免）；4,963,087 B ≤8 MB；cs/js 零 import/export/require/module；vendor 607784+103311 B、`THREE.REVISION='147'`、GLTFLoader 挂全局|**PASS**|
|15|许可 / 门户|文档逐条核对 + 首页加载|assets 14 文件仅 Poly Haven + Kenney CC0、直链/许可/日期/「未使用 Valve 声明」齐备；vendor LICENSE 为 MIT 全文；Valve/CS:GO 与 char_swat/gun_ar/Quaternius/QAL 仅否定或「已删除」语境、无过期填表值；games.json **11 项**、首页 **11 卡**、cs.svg/cs-dark.svg 各 320px 有效；根 README 中文「人物为几何表现」/ 英文「characters stay procedural」|**PASS**|

### 发现 / 待裁定（均 Minor，非阻塞）
- **OBS-01**：`cs/js/game.js` **无** `FleaSound.init('cs_sound')`（主理人核查点与实物不符）；全仓 `cs_sound` 仅见 `qa-smoke.md:23` 的 v1 历史 PASS 断言。`cs/index.html:152` 引入 `../assets/js/sound.js` 却从不调用；音效由 `cs/js/sfx.js` 的 `CS.Sfx` 独立合成器承担（ADR-8 / 11.5 明确禁用公共模块），实测点 `#sound-button` → `CS.Sfx.isEnabled()` true/false/true，但 `localStorage.cs_sound` 前后皆 **null**（开关不持久化、刷新重置）。非 v3 回归；「只引不 init 会静默失声」对 cs 不成立（`Sfx.resume()` 在 `start()` 链）。请裁定：接受独立 Sfx 设计并给 v1:23 加注，或补 init / 改文档。
- **OBS-02**：GL 默认路径人物为 **3D 程序化 Box 人偶**（`renderer-gl.js:220-230` makeMannequin，6 Box/槽），`drawBillboard` 在 GL 下仅服务枪口火光（`:660`），并非 v2 的 2D 公告板；但**未**被 glTF 模型替换、判定盒不变，降级到 `Renderer2D` 时 2D 公告板仍在（`debugPatterns` 4×true）。task 字面「人物公告板仍在」若按严格 2D 口径则 GL 不符；按 art-bible §2 / ADR-11「程序化几何兜底」口径则符合。请裁定验收口径。
- **OBS-03**：`renderer-gl.js:962-975` 的 `CS.useRenderer('gl')` 在已降 flat 时会 `baseUse('tex')` → 实测后端被拉回 **tex**，严格说破坏「单向不可回切」表述；正常流程不触发（仅 QA/控制台），不影响实际。
- **OBS-04**：外部请求 2 个 — `cs/index.html:12` Font Awesome CSS（站点级样式表）+ `assets/js/comments.js:25` DiversityComments SDK **JS 运行时 CDN**（站点公共模块，非 cs 自有代码）。阻断后 SDK 打印 console.error；沿 v1 BUG-02 / T5 裁定为站点统一范式，请显式确认豁免。
- **OBS-05**：`--disable-webgl` 启动产生 7 条 `THREE.WebGLRenderer ... could not be created` console.error（three.js 内部），pageerror/exception 仍为 0，属预期降级日志。
- **OBS-06**：headless SwiftShader rAF 节流使 playing 跑满 ~20 帧即触发 `low-fps` 降级（ADR-11 风险 #10 / v2 T8 已记录）；故 GL 通关用确定性同步驱动取证、真实键鼠用「真实事件 + 同步 `g.update()`」绕过节流。测试会话污染（D4 移动端 `elementFromPoint` 命中 `flea-comments-drawer-body`）经清 localStorage 干净复核已消除，非 cs 缺陷。

### 证据缺口 MISSING（如实保留，不以静态审查顶替）
- 沿袭 v1/v2：① 真实桌面 Pointer Lock 手势 / `movementX|Y` 链路 ② 真机多点触控与 AudioContext 实际发声 ③ 60s 连续帧时间与 GC 抖动 ④ 外部 CDN 可达时完整视觉 ⑤ 主观观感 ⑥ 距离雾逐面隔离测量 ⑦ `eyePend` 蹲起防抖行为化复现。
- v3 新增：⑧ PBR normal/rough 通道仅以整体 checksum 差分验证（12 槽绑定与三级链已证），未做逐面材质隔离；⑨ 人物 3D 人偶 vs「公告板」验收口径待裁定；⑩ 真机 GPU（非 SwiftShader）下帧时间与 45fps 阈值未测。

### 历史记录加注（保留 v1/v2 不覆盖）
- **`qa-smoke.md:117` 与 `:137` 的「12 卡 / 12 项（含 sg 并行新增）」属 v2 时点历史**：`sg/`（墨守·汉末）已由用户确认**有意删除**、工作区不存在，`config/games.json` 现为 **11 项**、首页现 **11 卡**（本轮 F2 实测）；该历史不修改、不覆盖，也不将 sg 纳入 v3 任何结论。

### 证据（仓库外绝对路径）/ 待审批
- 脚本与 JSON：`E:/fleaworkspace/qa-v3/` 下 `cdp-lib.mjs`、`probe.mjs`、`qa-v3-gl.mjs` + `qa-v3-gl-result.json`、`qa-v3-extra.mjs` + `qa-v3-extra-result.json`、`qa-v3-errors.mjs` + `qa-v3-errors-result.json`、`qa-v3-mobileclean.mjs` + `qa-v3-mobileclean-result.json`；PNG **11 张**（含 `v3-gl-*.png`、`v3-fallback-disabled-webgl.png`、`v3-assets-all-failed.png`、`v3-mobile-375x667-ingame.png`、`v3-portal-11cards.png`）。未改产品代码 / 未 commit / 仓库无 node_modules。
- 待主理人/用户审批：① OBS-01 是否接受独立 Sfx 设计并给 `qa-smoke.md:23` 加注（建议接受 + 加注，勿在 T4 沿用过期断言）；② OBS-02 验收口径（建议按 art-bible §2「程序化几何兜底」判 PASS）；③ OBS-04 站点 CDN 范式显式豁免；④ 上述 10 项 MISSING 是否接受放行（建议可放行，advisory）。裁定 ①②③ 后本门可转 **PASS**；本轮不 commit。

### 主理人裁定与最终判定
**最终判定：CONCERNS → PASS**（含下述已知风险与 10 项 MISSING）——判定由主理人裁定转 PASS，属建议性质量门，不构成发布签字；本轮不 commit。
- ① OBS-01 裁定：**接受独立 `CS.Sfx` 设计**（ADR-8 / `design-brief.md` 11.5 既定设计、非缺陷，`Sfx.resume()` 挂在 `start()` 链，实测 `#sound-button` true/false/true）。`qa-smoke.md:23` 的 v1 断言「`FleaSound.init('cs_sound')` 已验证」**仅适用 v1 时点**，v2 起改用 `CS.Sfx`，**T4 汇编不沿用该断言**；原行保留不覆盖。`cs/index.html:152` 的 `../assets/js/sound.js` 死引用与 `localStorage.cs_sound` 不持久化列为**后续改造项 Known-Issue**：非 v3 回归、超出本轮「纯表现层渲染升级」范围，本轮不动任何产品代码、不重跑验证、**不阻塞**。
- ② OBS-02 裁定：按 `art-bible.md §2` / ADR-11「程序化几何兜底」口径 **判 PASS**。验收口径明确为 **GL 默认路径 = 3D 程序化 Box 人偶（6 Box/槽）／降级 `Renderer2D` = 2D 公告板／两者均非 glTF 模型**；人物未被 glTF 替换、判定盒 `BOT_Y0/Y1/HALF_W` 不变，符合用户「人物项未立体化」裁定，避免后续误读为「glTF 人物」。
- ③ OBS-04 裁定：**站点 CDN 范式显式豁免**。`cs/index.html:12` Font Awesome CSS 与 `assets/js/comments.js:25` DiversityComments SDK JS 为站点所有页面统一范式（v1 BUG-02 / T5 已裁定接受）；阻断后仅图标与评论区降级、核心逻辑不受影响，不压判定。
- ④ OBS-03 / 05 / 06 裁定：**Minor 已知限制，本轮不修**——`CS.useRenderer('gl')` 仅 QA/控制台路径可拉回 tex、three.js 内部降级 console.error、headless SwiftShader rAF 节流已由确定性驱动取证；正常流程不触发，记入 v3 节即可。
- ⑤ **10 项 MISSING 接受放行**（advisory、非发布签字），全部如实保留、禁止以静态审查顶替；后续迭代建议补真机 Pointer Lock 手势、联网 CDN 可达视觉、60s 连续帧时间/GC 采样、真机 GPU 阈值。
- 裁定后状态：**PASS**。功能/数值/错误路径/许可/门户 15 条独立实测全 PASS、0 Blocker/Critical/Major；上述 5 组观察项与 10 项 MISSING 均为已知风险，不构成阻塞，**T4 汇编可继续**。证据与产物不变（`E:/fleaworkspace/qa-v3/` 脚本、4 份 JSON、11 张 PNG），唯一落盘交付物仍为 `cs/docs/qa-smoke.md`，v1/v2 历史逐行未动，未写产品代码 / 未改根 README / 未 commit。

---

## 横屏真机流程专项复测（v3.9 / 触控链路 + 104 组合扫描）

**背景**：此前横屏验证只覆盖 667×375 单一分辨率的几何断言（qa-landscape C 组），用户真机反馈「横屏有大问题」。本轮补两类此前缺失的实测：① 真实触控事件（`Input.dispatchTouchEvent`，非几何推断）驱动完整游玩链路；② 13 宽 × 8 高 = **104 组合**横屏分辨率穷举扫描。

### 发现与修复
| ID | 严重度 | 位置 | 复现 | 修复 |
|---|---|---|---|---|
|BUG-03|**Major**（真机必现）|`cs/css/style.css` 横屏矮屏组|横屏高度 ≤364px（安卓未全屏可视高度 / **iPhone Safari 横屏扣地址栏后 ~346**）任一宽度：弹匣面板（top:160 锚定）压住换弹钮（bottom:108 锚定）上缘——344 高压 18px（747px²），360 高压 2px；375+ 侥幸不撞。根因：右列 top 锚 HUD 与 bottom 锚按钮相向逼近，此前只测 375 高未暴露|新增 `@media (max-height:364px) and (pointer:coarse)` 组：弹匣移至左列 HP 正右（`top:132 right:auto left:144`）——右列 SCORE 底(~152)到换弹顶(H−146)纵向仅剩 ~46px 塞不下 58px 面板，左列 HP [132,194] 与摇杆顶(H−132)之间有充足空档|

### 验证结果（脚本均在仓库外 `E:/fleaworkspace/qa-cdp/`）
- **`qa-land-diag.mjs` 端到端 28/28 PASS**：竖屏点开始→引导拦截暂停→转横屏自动放行→canvas 位图随横屏重设（无拉伸）；真实触控下摇杆前推位移、滑屏转视角 yaw、**双指并发（左手摇杆+右手滑屏）**、触控开火弹药消耗、跳/蹲/换弹/换镜/暂停逐项生效；5 档分辨率（667×375/740×360/812×375/915×412/800×360）触点命中+零重叠+canvas 无拉伸；横↔竖来回旋转状态不坏（回竖屏重新引导+暂停属设计内：旋转放行≠跳过）。
- **`qa-land-sweep.mjs` 104/104 组合零重叠**（修复后）：344/360/375/390/393/412/414/430 高 × 640~915 宽全部控件两两重叠 0 对。修复前 344 高全宽度 747px²、360 高全宽度 75px² 重叠。
- 教训入档：**几何断言必须穷举分辨率而非单点**；触控功能要用真实 `dispatchTouchEvent` 验证而非只量 rect；HUD/按钮「top 锚 vs bottom 锚」混排的列必须在最矮目标高度下复核。

---

## HUD 全顶置 + 视角·帧率合并块复测（v3.10）

**改动**：① `#hud-fps` 删除，帧率读数内嵌 `#hud-view`（显示 `FPS · 60`，全端生效，`hud.js setView` 改写 `#view-mode` 子节点）；② 手机端得分/HP/弹匣全部顶置——竖屏两排（60: HP 左/弹匣 右；140: 视角·帧率 左/WAVE 中/SCORE 右），横屏一排四块（top:60）+ WAVE 回顶行（top:20）；③ ADR-20 的 ≤364px 弹匣移位补丁删除（右列中段不再有 HUD，BUG-03 触发条件消失）。

**验证**：
- `qa-land-diag.mjs` **30/30**：原 28 项触控/流转/5 档分辨率全绿 + 新增 R3 竖屏游玩态顶置 HUD 零重叠（跳过引导后实测）+ R4 合并块断言（`view-mode`='FPS'、`fps-value` 实际刷新、旧 `#hud-fps` 不存在）。
- `qa-land-sweep.mjs` **104/104 组合**（13 宽 × 8 高）控件两两重叠 0 对。
- PC 干净探针（`probe-pc2.mjs`，1100×800 fine）：合并块 `84,20 83x36`、`view-mode`/`fps-value` 正常、`#hud-fps` 已删、HP (20,552) / 弹匣 (936,569) 底部两角不动、wave/score 顶行正常。
- 截图：`diag-land-740x360.png`（横屏单排）、`diag-portrait-375-hudtop.png`（竖屏两排）、`diag-pc-1100x800-merged.png`（PC 合并块）。

---

## HUD 三块尺寸统一复测（v3.10.1）

**改动**：用户反馈手机端 HP 偏大。实测 HP `124×73`（血条独占一行 +20px 宽/+17px 高）、SCORE `70×56`、弹匣 `104×56`。修复：`@media (pointer:coarse)` 内 HP 改 grid 两列（label 跨列、血条内联数字同行），min-width 124→104；SCORE 补 min-width 104。三块统一 `104×56`，HTML 结构不变、PC 不受影响。

**验证**：`probe-hud-size.mjs` 竖屏/横屏三块均 `104×56`；`qa-land-diag.mjs` **30/30**、`qa-land-sweep.mjs` **104/104 组合零重叠**（无回归）；`diag-land-740x360.png` 目检血条与数字并排、三块齐平。

---

## FPS 块移到返回键旁复测（v3.10.2）

**改动**：用户要求 FPS 显示放到返回键旁。手机端 coarse 组竖屏（原 top140 left10）与横屏（原 top60 left142）两处 `.hud-view` 统一改 `top:13 left:62`——返回键 x10..52（42×42），块左缘留 10px 间隙，top13 使 36 高块与 42 高键垂直居中。PC 端本就 top20 left84 贴返回键，未动。

**验证**：`probe-hud-size.mjs` 竖/横 view 均 `x62 y13`，与暂停钮（竖 x209 / 横 x566）间隙充足；`qa-land-diag.mjs` **30/30**、`qa-land-sweep.mjs` **104/104 组合零重叠**；`diag-land-740x360.png` / `diag-portrait-375-hudtop.png` 目检返回键与 FPS 块同排紧挨、无遮挡。

---

## HUD 三块进一步紧凑化复测（v3.10.3）

**改动**：用户反馈 104×56 仍偏大。coarse 组加共享规则三块 `padding 5x8 / min-width 88 / line-height 1.2`、label 11→10px、big 17→15px、HP 血条 7→5 高、margin 1px、grid 列间距 6。三块缩至 **88×42**（面积 −37%），PC 端不受影响。

**验证**：`probe-hud-size.mjs` 竖/横三块均 `88×42`；`qa-land-diag.mjs` **30/30**、`qa-land-sweep.mjs` **104/104 组合零重叠**；`diag-land-740x360.png` 目检 HP 血条+数字、弹匣「8/∞」清晰无裁切、三块一致。

---

## PC 端 HUD 对齐手机横屏复测（v3.11）

**改动**：用户要求 PC 端 HP/得分/弹夹/FPS 展示与大小和手机横屏一致。新增 `@media (pointer:fine) and (min-width:821px)` 段，复刻手机横屏紧凑规则（三块 88×42 / padding5x8 / label10 / big15 / HP grid 血条内联）到 PC，坐标按 PC 坐标系换算：三块 top80（PC 返回键 50 高底缘 70，留 10px）/ HP left20 / 弹匣 right20 / SCORE right124；FPS top27（36 高块在 50 高返回键内垂直居中）。min-width821 防御窄屏 WAVE 与三块重叠。coarse 规则零改动。

**验证**：`probe-pc-align.mjs` 同进程对比两端——三块均 88×42，PC (top80 / HP x20 / SCORE x888 / 弹匣 x992) 与手机横屏 (top60 / x10 / x528 / x642) 同构；FPS 均 83×36；PC 截图 `pc-align-after.png` 目检顶行+一排布局对齐、右上钮不撞；`qa-land-diag.mjs` **30/30**、`qa-land-sweep.mjs` **104/104 组合零重叠**无回归。

---

## 手机端 45fps 卡顿根治：限帧阈值修复（v3.12）

**现象**：用户反馈手机端 FPS 45 很卡。CPU 剖析（`qa-profile-phone.mjs`，CDP Profiler 6s）排除算力问题——JS 各阶段合计 <150ms/6s、97% 在 `(program)`/`(idle)`，已 0.65 分辨率、13 面。真机 45 = 90Hz÷2 指向限帧缺陷。

**根因与修复**：`game.frame` 跳帧判定 `now-lastPaint<15` 固定阈值，把 90Hz(11.1ms)/75Hz(13.3ms) 每帧误跳→90Hz 腰斩 45fps。真实代码假时钟驱动（`qa-refresh-rate.mjs`）实测旧值：60→60 / 90→45 / 120→60 / 75→8.3 / 144→48 fps。阈值改 8 后：60/75/90/120Hz 各跑满原生、144→72。

**验证**：
- `qa-refresh-rate.mjs`：90Hz 45→**90fps**（540 rAF / 540 绘制），60Hz 保持 60；2s 版测 120→120、75→75、144→72。
- `qa-perf2d.mjs` **7/7**（P2 断言口径同步更新：`<8ms` 跳过、90Hz 11ms 正常绘制；P4a/P4b 降分辨率→flat 兜底 PASS）。
- `qa-land-diag.mjs` **30/30** 触控/布局无回归。
- 文档：ADR-26、README 中英帧率描述同步。改动仅 `game.js` 一处阈值 + 注释。未 commit。

---

## 触控 pointerId 泄漏卡死三层防御（v3.12.1）

**现象**：用户反馈「方向键和手滑转向之间卡死」，四现象全选（摇杆粘住/控件失灵/切另一个恢复/画面冻结）。合成 touch 序列全通过 → 标准路径正常，锁定真机 pointerup/cancel 丢失致 ID 泄漏。

**修复**（`cs/js/input.js`）：① document 级 pointerup/cancel 兜底清理；② lostpointercapture 清理；③ 心跳 stale 检测（down/move 刷新，>2s 无心跳强制释放，game.frame 每 0.5s 调 sanitize）。元素级监听保留。

**验证**：`qa-touch-stale.mjs` 3/3（pointerup 彻底丢失 2.6s 自动解锁、新手指恢复）；`qa-touch-lock.mjs` 7/7（双指并发/cancel/跨指恢复）；`qa-perf2d.mjs` 7/7；`qa-land-diag.mjs` 30/30。新增探针仓库外 qa-cdp/：qa-touch-lock / qa-touch-fallback / qa-touch-fallback2 / qa-touch-stale.mjs。文档 ADR-27。未 commit。

---

## 布局设置横屏 + 默认按钮调大内移 + FAB 仅主菜单复测（v3.13）

**改动**：① 布局设置入口在点击手势内 `CS.Orientation.onConfig()` 请求全屏+锁横屏（不设 active），编辑器按横屏呈现；② 横屏 coarse 默认摇杆 112→128px（left26/bottom24）、开火 62→76px（right44/bottom84），跳/蹲上移 bottom164、换弹/换镜左移 right132 保持零重叠；③ FAB 改为白名单——HUD.syncFab() 唯一维护 `body.cs-fab-off`，仅纯主菜单显示，子页面全隐藏。

**验证**：
- `qa-settings.mjs` **15/15**：A1 spy 验证 onConfig→requestFullscreen→orientation.lock 全链路（cfg/fs/lock 均 1）；A2 横屏视口；B1/B2 摇杆 128×128@left26/bottom24、开火 76×76@right44/bottom84；B3 未建档（CSS 默认值）；B4 按钮两两零重叠；D1–D9 FAB 九态（主菜单可见、帮助/编辑/游戏/暂停/结算隐藏、各态返回恢复）。
- `qa-land-sweep.mjs` **104/104 组合零重叠**（新尺寸全分辨率验证）。
- `qa-land-diag.mjs` **30/30**、`qa-touch-lock.mjs` **7/7**、`qa-perf2d.mjs` **7/7** 无回归。
- 截图目检：`shot-menu-fab.png`（主菜单右下 FAB 可见）、`shot-land-cfg.png`（横屏编辑器 + 按钮高亮 + 无 FAB）、`shot-land-buttons.png`（游戏态大摇杆/开火内移、零重叠、无 FAB）。

---

## 「换镜」纠正为「开镜」触控瞄准复测（v3.14）

**改动**：用户反馈 phone 端无开镜功能、换镜按钮实为切人称。① `#btn-view`「换镜」→ `#btn-aim`「开镜」，点击切人称改为按住瞄准（对齐 PC 右键 `aim`：减速 1.8m/s + 散布归零），pointerId 记录 + 全局 pointerup/cancel/lostpointercapture 兜底清理，不走 stale（防长按误清）；② 位置移到右上角暂停左侧（横屏 right182 / 竖屏 right174），从右下按钮群移除；③ 切人称保留在菜单「起始视角」+ V 键；④ touchcfg 控件表同步；⑤ 中英 README / 帮助 / 副标题 / 暂停页文案同步。

**验证**：
- `qa-aim.mjs` **19/19**（新建）：换镜已删、开镜文案、右上角几何竖横屏零重叠且紧挨暂停（间隙 5~30px）、按住 aim=true 高亮/抬起 false、长按 2.3s 保持、全局 pointerup 兜底、PC 右键仍工作、V 键与菜单仍切人称、aimWalk<walk。
- `qa-settings.mjs` **15/15**、`qa-land-diag.mjs` **30/30**（T8 从触控切人称改为 V 键）、`qa-land-sweep.mjs` **104/104 组合零重叠**、`qa-touch-lock.mjs` **7/7**、`qa-perf2d.mjs` **7/7** 无回归。
- 截图 `shot-aim-land.png`（开镜高亮按住态紧挨暂停）、`shot-aim-port.png`（竖屏几何，被性能 toast 遮挡但 B4/B5 断言通过）。
- 测试脚本适配：全部旧脚本中 `btn-view` 引用批量改 `btn-aim`（按钮 id 变更所致）；测全局兜底须先 capture 记录真实 pointerId（合成事件 ID 与 CDP touch 分配的不同）。

---

## 左手副开火键：三指操作复测（v3.15）

**改动**：① `#touch-buttons` 新增 `#btn-fire-left`，横屏 76×76 @ left162/bottom170（摇杆右斜上方），竖屏 left150/bottom130（避开换弹），PC 隐藏；② `input.js` 开火从单布尔改三槽（`mouseFiring` / 右下 `fireSlot` / 左下 `fireLeftSlot`），`syncFire()` OR 合成 `firing`，`bindFire()` 按 pointerId 独立释放，全局兜底 + lostcapture + reset 同步覆盖，不走 stale；③ `touchcfg.js` 控件表纳入「左开火」；④ 帮助页与中英 README 补三指说明。

**验证**：
- `qa-fire-left.mjs` **22/22**（新建，仓库外 qa-cdp/）：
  - 几何 A1–A8：文案/尺寸、横竖屏「摇杆右斜上方」（中心点口径）、横竖屏与摇杆/其他控件/HUD 零重叠、**56 组横屏分辨率**（7 宽 × 8 高）全通过、PC fine pointer 下不可见。
  - 触控 B1–B8：真实 touch 按下/抬起、双开火同时按下后单独抬右手 `firing` 仍 true、按真实 pointerId 的全局 pointerup 兜底、三指并发（左摇杆 `moveX<-0.5` + 左开火 `firing` + 右手拖屏 `yaw` 变化）、全抬归零、左下开火实际消耗弹药。
  - 布局 C1–C4：布局设置中可选中「左开火」、大小调到 110%、写入 `localStorage.cs_touch`、重载自动 `is-cfg` 生效。
  - 回归 E1–E2：PC 左键按下/抬起 firing 正常。
- 回归：`qa-aim.mjs` **19/19**、`qa-touch-lock.mjs` **7/7**、`qa-land-diag.mjs` **30/30**、`qa-settings.mjs` **15/15**，合计连新脚本 93 断言全绿。
- 截图目检：`qa-fire-left-playing.png`（游戏态横屏：左手开火位于摇杆右斜上方，与右下开火分列两翼，HUD/开镜/暂停无遮挡）、`qa-fire-left-land.png` / `qa-fire-left-port.png`（主菜单态几何）。

**坑**：竖屏初版 `bottom170` 与换弹钮重叠 900px²，下移 `bottom130` 后消除；「右斜上方」用中心点口径判定，边框轻微交错但零重叠仍合格。未 commit。

---

## 相机遮挡淡出 X-ray（v3.20）

**改动**：`config.js` + `world.js` + `renderer.js` + `renderer-gl.js`。用户反馈（附截图）：TPS 贴四周围墙时围墙内侧整面糊满半屏、挡住内部墙体与人物；背靠内部掩体时人物也会被墙吞掉。根因：`TPS_BACK=3.2 + SHOULDER=0.38` 的侧向偏移把相机推向墙面，墙碰撞钳位后相机距墙内表面仅 ~0.1m，且该墙**不在**相机→玩家线段上（截图中人物在墙前可见即为佐证）。方案（ADR-37）：只动可见性不动几何——`world.js` 新增纯查询 `occluderMask`（线段×AABB 2D slab 位掩码）与 `nearBoxes`（点到盒 2D 距离位掩码）；两渲染器挂 `wallFade[12]` 指数趋近（`XRAY_TAU=0.07` 淡出 / `XRAY_REST_TAU=0.22` 恢复），TPS 下「线段穿越 或 距相机 < `XRAY_PROX=1.0`」的墙淡到 `XRAY_MIN=0.16`；**FPS mask 恒 0**（防贴墙透视作弊）；2D 画家算法透传面 alpha + 弹孔按所属盒同步淡出，3D 每墙克隆透明材质、常态还原共享组材质（保留按组换资产设计）；`clearFx` 复位。相机几何/hitscan/LOS 零改动。

**验证**：`qa-xray.mjs` **15/15**（新建）：常量与 API 齐全；`occluderMask` 纵穿盒 6 命中 bit6、不穿越线段为 0、`nearBoxes` 贴东墙命中 bit1 / 场地中心为 0；TPS 贴东墙（x=14.5 朝北）东墙淡出 <0.4 且远处内部墙恒为 1、`camDist` 几何未变；移回中心 1.7s 后全部恢复 1；TPS 面朝西时线段上的盒 6 淡出、远处西围墙不误淡出；FPS 贴同一面墙不淡出；`clearFx` 复位；pageerror=0、相机参数未变。全套回归 vm-aimdir 15 + aim 28 + fire-left 22 + land-diag 30 + settings 15 + touchcfg 9 + touch-lock 7 + tps-ots 9 + perf2d 7 = **135 断言全绿**。截图 `xray-before.png`（east=1，深色砖墙糊满右半屏，复现用户截图）/ `xray-after.png`（east=0.16，墙体半透明、内部墙/箱子/人物全清晰）目检通过。四文件 `node -c` 通过。

**坑**：① 淡出 τ=0.07s 太快，截图脚本直接拍「前」已近稳态——须先 `XRAY_TAU=1e9` 冻结再传送玩家才拍得到不透明基线；② 近距规则必须限制 TPS：FPS 相机即眼位，若同样淡出，贴墙瞄准可透视看到墙后敌人；③ 3D 真机 WebGL 目视待补（headless 无 GPU 走 2D 兜底）。未 commit。

---

## MC 脸部补鼻/嘴（v3.20.3）

**改动**：仅 `js/renderer.js` `drawFaceMark` mark=1 分支。用户反馈「没有画嘴巴和鼻子」：在 v3.20.2 修复符号后的敌人正脸上补 MC 三件套——眼 48%（原有，两只方眼）+ **鼻 60%**（居中窄方 `0.10×0.10`）+ **嘴 78%**（居中横条 `0.34×0.06`），远距离以 ≥1px 兜底可见；`lastMark` 扩展 `y2/y3`（鼻/嘴）供断言。玩家 mark=2 后脑勺不带五官（背影读感）。仍纯 `ctx.fillRect` 叠加、不占面池。

**验证**：探针 `probe-bot-face.mjs`——敌人头面 [139.8,196.1] 内眼 y=166.8 / 鼻 y=173.6 / 嘴 y=183.7 依次排列全部落面内 ✓；特写 `bot-face-zoom.png` 目检五官齐整（贯穿鼻嘴的竖线为屏幕中心准星叠加，非脸部）。回归 `qa-tps-ots` 9 + `qa-vm-aimdir` 15 + `qa-xray` 15 全绿，pageerror=0。未 commit。

---

## MC 脸部标记符号修复（v3.20.2）

**改动**：仅 `js/renderer.js` `drawFaceMark`。用户截图反馈「敌人的眼睛画在身体上」：土黄头块上没有脸，两个深色眼点落在头块下方的橙色躯干顶部。根因是**屏幕坐标符号错误**——`drawBillboard` 角点 Q0/Q1=世界 y0（底）、Q2/Q3=y1（顶），投影后 `sy[0]` 是面的屏幕**底**（值大）、`sy[3]` 是**顶**（值小），而 `drawFaceMark` 注释误设「sy0 顶」，眼/带定位全部用 `sy[0] + |hh|×k`（自底继续向下加），把眼睛/头盔带画到了面外的下方（躯干上）。修复：统一改为自面顶 `sy[3]` 向下（眼 48%、盔带 22%、后脑带 62%），更正注释；新增 `lastMark` getter（最近一次标记的 top/bottom/y 屏幕几何）供确定性断言。

**验证**：探针 `probe-bot-face.mjs`——bot 固定玩家正前 3m：TPS 玩家 mark=2 头面 [223.9,246.2] 盔带 y=228.8 ✓、FPS 敌人 mark=1 头面 [139.8,196.1] 眼 y=166.8 ✓（top≤y≤bottom 恒成立）；特写 `bot-face-zoom.png` 目检：双眼回到头块内 MC 脸位、玩家盔带回到浅蓝头块上。回归 `qa-tps-ots` 9 + `qa-vm-aimdir` 15 + `qa-xray` 15 + `qa-aim` 28 + `qa-fire-left` 22 + `qa-land-diag` 30 + `qa-touchcfg` 9 = **128 断言全绿**，pageerror=0。教训：**屏幕 y 向下，billboard sy[0] 永远是底**——凡"自顶向下 k%"定位必须从 sy[3] 起算。未 commit。

---

## 换弹/瞄准镜头圆钮化（v3.20.1）

**改动**：仅 `css/style.css`。用户附大逃杀手游布局截图，要求开镜/换弹/跳/蹲按钮参考其「圆形半透明底 + 居中白图标」风格。跳/蹲在 v3.18.1 已是 44×44 圆形图标钮；本轮把换弹/瞄准镜头从胶囊（54×38 / 68×38）改为同规格 44×44 圆钮（`border-radius:50%`），图标统一 24px。**关键约束**：`.tbtn-sm` 同时被暂停（文字胶囊）复用，故只按 `#btn-reload, #btn-aim` ID 覆盖，不动整类。列中心不变：竖屏右 125（147−22）、横屏右 137（159−22），换弹/开镜保持同列同心；竖屏开镜 bottom 285→262 收紧与换弹的列间距（31→8px，蹲钮仅 x 向 5px 间隔零重叠）。

**验证**：`qa-aim` 28 + `qa-fire-left` 22（含 56 组横屏分辨率零重叠扫描）+ `qa-land-diag` 30 + `qa-touchcfg` 9 + `qa-settings` 15 + `qa-xray` 15 = **119 断言全绿**——同列同心（<3px）、邻居零重叠、布局设置拖动/缩放/持久化不受形状影响。截图 `btn-circle-land.png` 目检：瞄准镜头（准星图标）/换弹/蹲/跳四钮同规格圆形白图标，与橙色主开火钮形成主次层级。横屏矩形实测：aim [899,294,943,338]、reload [899,348,943,392]、crouch [964,292,1008,336]、fire [960,340,1036,416] 全零重叠。

**坑**：换弹从 38 高变 44 后，竖屏左开火键（top y=206）与换弹底（y=210）仅余 4px——与改动前同为 4px（原 38 高时 206→210），无回归但已是极限间距，后续上移换弹须先查此约束。未 commit。

---

## 开火时枪口朝向射击方向（v3.19）

**改动**：`config.js` + `renderer.js` + `renderer-gl.js`。用户要求「射击时枪械朝向射击方向，停止射击恢复默认」，落点选**第一人称枪**。核心事实：FPS 射击方向在屏幕空间恒为视图中心（准星），而 2D 枪口局部位于 `MUZ(-180,-57)`、默认只水平朝左从不旋转。2D 解析求「枪口射线穿过中心」的总旋转 `α=π−asin(−MUZ_Y·vs/R)−atan2(−by,bx)`，`aimGeom=α−VM_TILT` 为相对默认姿态的附加角；开火以 `VM_AIM_TAU=0.06` 快抬向 `aimGeom×VM_AIM_GAIN(0.58)`，停火以 `VM_REST_TAU=0.16` 慢落回 0。3D 枪管本就朝 -Z（视线=射击方向），等价地把 roll 从 `VM_TILT` 抬向 `VM_AIM_ROLL_3D=0.08`。四常量集中在 CFG；仅改视图模型屏幕旋转，`clearFx` 重置 `vm.aim`，双端各暴露 `vmAim` getter 供 QA。命中/散布/kick/射速一律未碰。

**验证**：`qa-vm-aimdir.mjs` **15/15**（新建）：常量齐全、getter 可用；真实鼠标按住→`vmAim.cur` 抬升趋近 target 且消耗弹药、抬指→平滑衰减（非瞬时）→归零、`clearFx` 瞬时重置；几何解析解 5 视口（667×375/740×360/812×375/375×667/390×844）枪口射线垂距均 **<0.01px**，横屏抬枪角小于竖屏（自适应）；开火后枪口射线更接近准星（朝向正确非反向）；无 pageerror、命中/散布/后坐/射速配置未变。全套回归 aim 28 + fire-left 22 + land-diag 30 + settings 15 + touchcfg 9 + touch-lock 7 + tps-ots 9 + perf2d 7 = **127 断言全绿**。截图 `vmaim-land-idle.png` / `vmaim-land-firing.png` 目检：默认枪身水平偏低，开火时枪口明显上扬朝向准星并伴随后坐。三文件 `node -c` 通过。

**坑**：① `CS.Input.firing` 是 getter（由 `mouseFiring`/`fireSlot`/`fireLeftSlot` 经 `syncFire()` 合成），QA 不能赋值、须用真实 `dispatchMouseEvent` 按住才生效；② clearFx 断言须在抬指停火后调用，否则下一帧开火态又把 aim 抬起造成假 FAIL；③ `gain=0.58` 是视觉幅度控制（解析解 GAIN=1 才精确穿心，0.58 抬枪明显但不遮挡准星）；④ headless 竖屏自动触发横屏引导使游戏未进入 playing，`vmAim.geom=0`，竖屏几何正确性改由 C 组数学验证覆盖；⑤ 3D 真机 WebGL 目视待补（headless 无 GPU 走 2D 兜底）。未 commit。

---

## 左手开火键再靠 HP 微调（v3.18.2）

**改动**：仅 `css/style.css` 横屏 coarse 媒体查询 `.tbtn-fire-left` 定位 `left108/bottom193 → left100/bottom195`（左移 8 贴近 HP、上移 2），尺寸 76×76、竖屏 `150/130`、判定逻辑/CFG/其他控件一律不动。

**验证**：`qa-fire-left.mjs` **22/22**（含 56 组横屏分辨率零重叠、三指并发、双开火独立槽、布局设置持久化、PC 回归）；`probe-fireleft.mjs`（仓库外）量取多分辨率矩形。H=320 硬约束实测：HUD view `x[62,140] y[13,48.5]`、HP `x[10,98] y[60,102]`、摇杆顶缘 `y168`；新落点开火 `x[100,176] y[49,125]` — 左缘距 HP 右缘 2px、顶缘距 view 底缘 0.5px、底缘距摇杆顶缘 43px → 零重叠，中心 `x138>摇杆90`、`y87<摇杆232` 仍为右斜上方。截图 `shot-fireleft-up.png` 目检：更贴近左上 HP、不遮 HUD，仍在摇杆右斜上方。未 commit。

**坑**：上移硬极限由 H=320 时 HUD view 底缘锁定（余量仅 0.5px），继续上移会压 view，故本轮以左移为主、上移 2px；后续若还要靠 HP 只能改视图布局或缩按钮，纯平移无空间。

---

## 触控按钮图标化（v3.18.1）

**改动**：`index.html` + `css/style.css`。用户要求四个触控按钮文字换图标：① 瞄准镜头→十字准星、② 换弹→旋转箭头、③ 跳→跃起人形、④ 蹲→下蹲人形（含地面线）。全部用**内联 SVG**（零外部依赖、离线可用、不依赖被 CDN 屏蔽的 Font Awesome），`fill/stroke=currentColor` 继承主题色与高亮态；新增 `.tbtn-icon` 统一样式（22px / 圆钮 24px）。保留 `aria-label` + `title` 无障碍文案；touchcfg 设置面板 NAME 表仍是文字（设置里显示文字名更清晰，qa-touchcfg 不受影响）。开火/暂停保持文字（用户未要求）。

**验证**：放大对照图 `icon-zoom.png` 目检——跳(跃起)/蹲(下蹲+地面线)清晰区分、换弹(循环箭头)、瞄准(准星圆环)语义明确；游戏态 `shot-aimscope-on.png` 确认高亮态橙色填充下准星图标清晰、右下布局不重叠。全套 QA：`qa-aim` **28/28**（A2 改为校验 SVG 图标+aria-label）、`qa-fire-left` **22/22**、`qa-land-diag` **30/30**、`qa-settings` **15/15**、`qa-touchcfg` **9/9**、`qa-tps-ots` **9/9**、`qa-perf2d` **7/7**，合计 120 断言全绿。未 commit。

**坑**：① 不用 Font Awesome CDN（QA 屏蔽 + 零外部依赖约束），改内联 SVG；② 图标化后 textContent 变空白，qa-aim A2 断言从文案改为 SVG+aria-label；③ 瞄准钮仍保留 68px 宽（图标居中两侧留白，避免改尺寸引发 land-diag R3 竖屏重叠回归）。

---

## 越肩第三人称重构（v3.18）

**改动**：`config.js` + `renderer.js`/`renderer-gl.js` 的 `setCamera` + `drawFaceMark`。① 相机改越肩：眼位 −前向×BACK + 右向×SHOULDER + 上抬×UP（`TPS_BACK 2.4→3.2`、`TPS_UP 0.22→0.50`、新增 `TPS_SHOULDER=0.38`/`TPS_FOCUS=7`），角色沉左下让出准星；② 相机看向「眼位+前向×FOCUS」聚焦点使准星在 7m 与弹道重合，以新前向重建正交基；③ 玩家头面(mark2)改画后脑勺头盔带而非正脸眼睛。核心约束：hitscan 与相机解耦，零数值收益改变。

**验证**：
- `qa-tps-ots.mjs` **9/9**（新建）：越肩参数齐全、相机偏离中轴/在后方/高于眼位、FOCUS 处准星弹道重合(<1cm)、屏幕中央未被玩家蓝占据、弹道命中正前方敌人、TPS 比 FPS 多玩家面、无异常。
- 全套回归 `qa-fire-left` **22/22**、`qa-aim` **24/24**、`qa-land-diag` **30/30**、`qa-settings` **15/15**、`qa-perf2d` **7/7**（pageerror=0），合计 107 断言。`probe-facecount.mjs` TPS 峰值 32 面 <80。三文件 node -c 通过。
- 截图 `probe-tps-empty.png`（两轮调参后定稿）、`tpsfinal-tps.png`（带敌人游戏态）目检：角色左下背影、准星空出、前方敌人可见，第三人称感明确。

**坑**：两轮调参定稿——初版 SHOULDER0.52/UP0.85/FOCUS14 角色贴底边且近距视差 0.33m，收敛到 0.38/0.50/7 后近距偏差 ≤0.15m、构图合理。改相机朝向后必须重建 right/up 正交基。headless 走 2D 兜底，3D 越肩仅语法核对，真机 WebGL 目视待补。未 commit。

---

## 敌我人物 MC 方块化 + 敌人持枪 + 玩家枪补枪托（v3.17）

**改动**：仅 `cs/js/renderer.js` / `cs/js/renderer-gl.js`（零外部资产、不改判定/数值/CFG）。① 2D `genBots` 每 bot 2 面→6 面 MC 分块（双腿/躯干/双臂/头）+1 面枪 stub（+开火火光）；`genPlayer` 2 面→6 面+竖条枪。② 新增 `drawFaceMark(f)` 在头面绘制后立即叠两只暗色眼睛（`ctx.fillRect`，不占面池，`f.n!==4` 跳过近剪切面）。③ 3D `makeMannequin` 方头短身 6 Box/72 tris；每个 bot 槽挂程序化兜底枪随 `b.facing` 转向。④ 玩家枪补枪托：2D 新增 6 个 `GUN_STOCK*` 屏幕多边形（x 最大 108）、3D `makeFallbackGun` 加 4 个枪托 Box。双臂外沿恰卡 `BOT_HALF_W=0.32`，部件全在 `y[0.10,1.85]` 判定盒内。

**验证**：
- 截图目检 `after-2d-fps.png` / `after-2d-tps.png`：敌人/玩家均为清晰 MC 方块人（含眼睛、四肢分明）、敌人右侧持枪可辨、玩家枪托完整；近景 `enemygun-fps.png` 确认 1.6 m 距离枪 stub 可见。
- **faceCount 实测**（`probe-facecount.mjs`，6 位置采样）：3 bot 场景峰值 **42 面**（改造前 19 面），满编 5 bot + 全开火估算 67 面，均 < `MAX_FACES=80`。**纠正**：qa-smoke v3.12 残留的「13 面」是 MC 改造前历史值，不代表当前代码。
- QA 全绿：`qa-fire-left` **22/22**、`qa-aim` **24/24**、`qa-land-diag` **30/30**、`qa-settings` **15/15**、`qa-perf2d` **7/7**（pageerror=0），合计 98 断言；`node -c` 双渲染器语法通过；HEAD 仍 6053468。

**坑**：① 枪 stub 与躯干共面被画家算法盖住——用 `dist=torsoDist-0.02/-0.04` 微调排序（非游戏数值）；② 眼睛独立 billboard 会穿模且吃面池——改所属头面绘制后立即叠加；③ 躯干半宽需收窄到 0.24 才能露出双臂轮廓；④ headless 无 GPU 走 2D 兜底（`rid=tex`），3D 改动本轮仅语法+静态核对，真机 WebGL 目视待补。未 commit。

---

## 左手开火键两轮左上微调复测（v3.16.1）

**改动**：仅 `cs/css/style.css` 的 `.tbtn-fire-left` 横屏定位：`162/170 → 130/190 → 108/193`（左移为主、上移为辅）。竖屏 `150/130` 不变。几何实测依据：H=320 时 HUD view `y[13,48.5]`、HP `x[10,98]`、摇杆顶缘 `y168`；`108/193` 距 HP 10px、距 view 2.5px、距摇杆 41px，零重叠。上移硬上限 bottom≈193，再高即压 HUD view。

**验证**：`qa-fire-left.mjs` **22/22**（56 组横屏分辨率零重叠、三指并发、双开火独立槽、布局设置持久化、PC 回归全过）；`probe-fireleft.mjs` 探针量取 6 档横屏高度矩形。截图 `qa-fire-left-playing.png` 目检开火键更贴左上、不遮 HUD。

**坑**：B8「实际消耗弹药」因 B1–B7 连续开火打空弹匣（ammo=0）偶发假 FAIL；脚本在 B8 前重置 `ammo=30` 后 22/22 全绿，功能无回归。未 commit。

---

## 开镜回右下 + 点击视角块切 FPS/TPS 复测（v3.16）

**改动**：① `#btn-aim` 从右上角移回右下操作区，与换弹同列位于其上（竖屏 right120/bottom256、横屏 right132/bottom162），右上只留暂停；② `.hud-view` 单独放开 `pointer-events:auto` 并在 HUD.init 绑定 `click → cb.view()`，复用 `Game.toggleView()`；③ `Input.isUI()` 白名单加 `.hud-view`，防 PC 点击误开火/锁鼠标；④ 帮助页与中英 README 同步。

**验证**：
- `qa-aim.mjs` **24/24**（原 19 + 新增 5）：B1–B6 开镜横竖屏右下定位、零重叠、与换弹同列在其上；C2-1~C2-5 点击 FPS 块可命中/切换 TPS/标签同步/高亮/不误开火；A/C/D/E 组原用例（按住瞄准、长按 2.3s、全局兜底、PC 右键、V 键、菜单起始视角）全回归。
- `qa-fire-left.mjs` **22/22**、`qa-settings.mjs` **15/15**、`qa-land-diag.mjs` **30/30** 无回归。
- 截图目检：`shot-aim-back-right.png`（开镜在右下换弹上方、蹲左侧，右上仅暂停）、`shot-tps-by-hud.png`（点击后左上角 TPS 橙色高亮、第三人称蓝色模型出图）。

**坑**：开镜移位占用旧 QA 探针取样点——`qa-land-diag.mjs` look-zone 中心取样、`qa-fire-left.mjs` 三指转向触点（x500,y200）均落在新开镜钮上致假 FAIL；已把取样点改到空白区（look-zone 取右半屏 y28%，转向取 x400,y180）。属探针口径问题，非产品回归。未 commit。
