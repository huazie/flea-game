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
