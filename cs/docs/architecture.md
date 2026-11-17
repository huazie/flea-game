# 反恐突袭 · 架构决策记录（Lean ADR）

范围：Phase 3 技术搭建 + Phase 5 制作合并执行。引擎基线：浏览器原生 ES5+ / 零构建 / 普通 `<script>` 顺序加载；v3 起默认渲染后端为 three.js r147 UMD + WebGL2，v2 的 Canvas 2D 软渲染保留为降级链后两级。
约束来源：`design-brief.md` 第 6、9、10 节（v2 基线）与 v3 任务书（WebGL 后端 / 三项表现层 / 数值零漂移）。本文只记录影响可维护性与验收的关键决策；ADR-9~11 为 v3 追加，ADR-1~8 描述的历史决策不因升级而追溯改写。

---

## ADR-1 软渲染选型：手写透视投影 + 画家算法

- **上下文**：站点为纯静态零构建项目；硬约束禁止 Three.js / WebGL / CDN 运行时库 / 贴图包。设计支柱要求「单帧几十面」「低多边形纯色块」，且必须实现 0.1 m 近裁剪面，否则穿墙时投影发散。
- **备选**：① WebGL / Three.js（能力最强，但违反零依赖且引入 GPU 深度缓冲）；② 2.5D 射线投射（raycasting，类似早期迷宫游戏，实现简单但无法表达「后上方」TPS 相机与俯仰）；③ 直接 2D 俯视图（无透视，违背形态定义）。
- **决定**：Canvas 2D 手写相机基向量（forward / right / up）→ 相机空间 → 单平面 Sutherland-Hodgman 近裁剪（cz ≥ 0.1）→ 透视除法；面中心到相机的**平方距离**降序画家算法；水平 FOV 固定 75°。墙体只生成朝向相机的侧面（+X/-X/+Z/-Z 与可见顶面），背面剔除 + 远裁剪 60 m。
- **后果**：获得真实的第三人称后上方相机与抬头/低头；代价是没有深度缓冲，共面/相交面会排序瑕疵——用「AABB 互不相交 + y 恒定 + 面池上限 80」把该风险压到零。所有颜色必须来自 CSS 变量（见 ADR-4）。

## ADR-2 FPS / TPS 同景双读：单一数据源，切镜只改相机位

- **上下文**：设计红线要求「切镜零数值收益」，防止 TPS 成为主导策略；同时要求切镜不中断射击 / 换弹 / 受击、不提供无敌帧，且「绝不自动改写视角状态位」。
- **备选**：① 两套相机 + 两套数值（易做成强度开关，禁止）；② TPS 从相机位置发射射线交叉点补偿（射线随视角变化，产生数值差异）；③ 相机收敛式瞄准（改 yaw/pitch，违反「共用 yaw/pitch」）。
- **决定**：全局只有一份 `player.{x,z,yaw,pitch,hp,ammo}`、一份 `bots`、一份 `CFG` 数值表。**hitscan 射线固定为「玩家眼位 (x,1.6,z) + 由 yaw/pitch 与散布构成的方向」**，与相机位置完全解耦；V 键仅切换 `Renderer.setCamera` 的相机位（眼位 ↔ 水平后退 2.4 m + 抬升 0.22 m）与自身模型显隐。TPS 相机沿后退方向对墙射线回缩（最短 0.3 m），近墙只把玩家模型 alpha 改为 0.38，不触碰 viewMode。
- **后果**：两种视角的伤害、命中、散布、FOV、计时逐位一致，天然无主导策略；代价是 TPS 存在约 0.22 m 的竖直视差（真实 TPS 共性问题）。已把它限定为纯视觉：不改判定、不给收益，并在交付说明中列为已知限制。切镜只写一个布尔与一次 HUD 高亮，任何计时器都不重置。

## ADR-3 性能预算与逐帧零分配

- **预算**：逐帧可见面 ≤ 80（实测上限：12 墙 × 最多 3 面 ≈ 36 + 5 Bot × 2 面 + 2 玩家面 + 少量枪口闪光 ≈ 48）；60 fps；`cs/` 内 html+css+js+svg < 100 KB。
- **备选**：① 每帧 `map/filter/sort` 与临时对象（GC 抖动，60fps 不稳）；② 全量重绘 6 个 HUD 文本节点（DOM 写入浪费）；③ 用 `setTimeout` 驱动换弹/波间（与帧率解耦但会在暂停时漏算）。
- **决定**：模块加载时预分配 80 个 face 对象（含 `Float64Array` 顶点缓冲）、排序索引数组、4 个击杀浮字槽、5 个 Bot 对象池；裁剪缓冲 `Float64Array` 全局复用；排序用插入排序原地交换索引，无闭包无新数组。渲染热路径不出现 `new` / 对象字面量 / 数组字面量 / 字符串拼接。HUD 用「缓存上次值，变化才写 DOM」。所有射速 / 换弹 / Bot 开火 / 波间 / 受击闪红按累计 dt 计时，dt 上限 0.05 s；暂停、失焦、切后台直接停帧并把 `last` 置为当前时间，禁止补算。低端机（`pointer: coarse` 或宽 < 700）内部渲染分辨率 ×0.8 后由 CSS 放大。
- **后果**：帧时间稳定、无 GC 尖峰；代价是代码偏命令式、缓冲区上限写死（faceCount 达 80 时丢弃后续面，本场景不会触发）。

## ADR-4 主题取色与零硬编码颜色

- **上下文**：站点把 `data-theme` 标在 `document.documentElement`，切换时派发 `themeChanged`；画布必须与 HUD 同步换色。
- **备选**：① JS 内写死两套色值（与站点主题脱节）；② 每次绘制都读 `getComputedStyle`（每帧一次布局查询，浪费）。
- **决定**：`cs/css/style.css` 的 `:root` / `[data-theme="dark"]` 定义同名 `--cs-*` 变量；渲染器只在 init 与 `themeChanged` 时读一次并缓存，再由 `U.shade()` 派生墙面明暗（3 档），逐帧只引用缓存字符串。CSS 规则内颜色一律 `var()`。
- **后果**：切换主题零延迟、零每帧样式查询；代价是 `--cs-*` 必须是 hex（供通道缩放解析），透明层另用独立变量。

## ADR-5 命中与碰撞：hitscan + 公告板，无投射物

- **上下文**：硬约束禁飞行弹丸 / 投射物物理；玩家与 Bot y 恒定。
- **备选**：① 子弹实体 + 每帧步进（违反约束）；② 纯球体距离判定（无法表达墙体遮挡）。
- **决定**：`World.rayWalls`（slab 法，12 个 AABB）取最近墙距 → `Entities.hitScan` 逐 Bot 求「面向射手的竖直公告板矩形」交点 → 取最近者。同帧多个 Bot 命中伤害先累加到 `pendingDamage`，帧末统一扣血并判死（HP 下限 0，死亡立即冻结输入与波次生成）。移动碰撞为圆 r=0.4 m vs AABB 的 x/z 轴分离推出，形成贴墙滑动。
- **后果**：判定确定、与帧率无关、无物理系统；代价是公告板始终朝向射手（近距 TPS 下有轻微视觉偏斜，不影响判定）。

## ADR-6 渲染器接口与双实现降级（v2）

- **上下文**：v2 要求程序化纹理、伪光照、距离雾、天空渐变的「真实感升级」，同时守住零依赖红线与移动端 60fps 预算；下轮规划 WebGL 版本，低端机需要纯色块兜底。
- **备选**：① 直接在 v1 渲染器里堆分支（后续无法换后端）；② 引 Three.js / WebGL（违反零依赖）；③ 只做纹理不做降级（低端机实测掉帧无兜底）。
- **决定**：抽 `Renderer{beginFrame, submitFace, drawBillboard, drawViewmodel, endFrame}` 五方法接口，面数据以平铺 `Float64Array` 按引用传递（零拷贝）。`Renderer2D` 实现：4 种程序化纹理（砖墙/混凝土/木箱/地面，64×64 离屏 canvas，init 一次生成 ×2 主题共 8 张缓存，`themeChanged` 仅换引用）、伪光照 shade=0.55+0.45×max(0,n·L)（6 个面朝向档位预计算，绘制后同路径叠黑 alpha=1−shade）、天空渐变（gradient 对象 init 缓存）、距离雾 f=clamp((d−10)/40,0,1)²（面绘制后同路径填雾色）。`Renderer2DFlat` 同接口纯色块实现。`CS.useRenderer('tex'|'flat')` 切换；游戏每帧调 `checkPerf(dt)`，实测窗口 1s 平均 <45fps 自动降级为 Flat（本会话单向）。
- **后果**：纹理墙每面 3 次 fill（图案/叠黑/雾）+ 描边，最坏 ~49 面 ≈ 200 次绘制调用，Canvas 2D@60fps 实测可承受，超预算由自动降级兜底；代价是纹理为屏幕空间 pattern，不做透视映射（风格化处理，柱面/地面纹理不随视角旋转）。`RendererGL` 下轮写同接口即可替换，游戏层零改动。

## ADR-7 跳/蹲物理：玩家引入 y 轴，射线仍与相机解耦（v2）

- **上下文**：v2 放开蹲伏与跳跃（11.1 数值基线：跳跃初速 4.5 m/s、重力 12 m/s²、空中加速度 3.6 m/s²、蹲眼位 1.60→1.05 m 平滑 0.15 s 反向排队、蹲移速 2.0 m/s）；红线要求切镜零收益且 Bot 命中率不调。
- **备选**：① 相机 y 与眼位耦合（射线随视角漂移，破坏「同景双读」）；② AABB 顶面站立/完整物理（超范围，列愿景）；③ 蹲提供规避收益（Bot 命中率下调）——违反 11.2「蹲不躲视线」。
- **决定**：玩家新增 `y`（脚部高度）、`vy`、`onGround`、`eyeCur/eyeFrom/eyeTarget/eyeT/eyePend`（眼位状态机）。跳跃只改 y 轴：x/z 碰撞完全复用 `World.move`（圆 r=0.4），y≤0 即落地，不支持站上 AABB 顶面；空中水平速度按 3.6 m/s² 向期望速度矢量加速，地面维持 v1 直接置速。命中射线固定从实际眼位 `(x, y+eyeCur, z)` 发出，pitch 取 `pitch+kick`；开火时 `kick=+1.2°` 随 0.15 s 线性回落（真实进射线，鼠标可下拉补偿）。Bot 状态机零新增状态：视线判定仍用 2D 墙体遮挡（蹲不躲视线、跳不越视线），命中率维持 0.35/0.45/0.55。
- **后果**：切镜零收益红线逐位成立（harness 空中切镜射线一致性断言覆盖）；代价是 TPS 玩家公告板需跟随跳跃 y（genPlayer 以 `player.y` 抬升模型与竖条枪），且首发出膛带 +1.2° 上踢（12 m 处 ≈0.25 m，2 发击杀 Bot 公告板高 1.75 m 内仍可命中，下拉补偿即可，属概念卡明示的真实代价）。

## ADR-8 表现层特效与音频：屏幕空间池 + cs 内合成器（v2）

- **上下文**：弹孔/粒子/弹壳/火光/枪械视图模型全部要求「不占 3D 面池」且逐帧零分配；音效要求迁出站点公共模块 `assets/js/sound.js`（禁改），在 cs/ 内独立实现。
- **备选**：① 特效进 3D 面池（面数逼近 80 上限，排序瑕疵风险）；② 每帧 new 粒子对象（GC 抖动，违反 ADR-3）；③ 继续引公共 FleaSound（被 11.5 明确禁止）。
- **决定**：全部特效为预分配环形池——弹孔 32 FIFO（0.06 m 方片沿命中面法线偏移 0.01 m，复用墙体投影作附属绘制）、粒子 64（墙火花 8/血雾 10，寿命 0.3~0.5 s，世界坐标投影 + fillRect）、弹壳 8（屏幕空间右抛 + 重力，0.5 s 消失）、枪口火光 1（0.04 s 星形面片）、视图模型（5 多边形几何枪，锚点 (0.72W, 0.85H)，sway/lag/后坐/换弹动画全部常数系数）。音频为 cs/js/sfx.js 独立 WebAudio 小合成器：1 s 白噪声缓冲 init 生成一次，音色=振荡器/噪声+包络组合（射击/空仓/换弹/脚步 2.2 Hz/跳/落地按落速/命中墙/命中 Bot/受击），AudioContext 首次手势后 resume。
- **后果**：面池最坏 49 面 < 80 维持不变，热路径零分配维持；音频分配仅发生在事件驱动调用（非逐帧），可接受。代价是弹孔绘制在所有面之后（无深度测试），极远墙弹孔可能覆盖近墙——本地图墙距上限 50 m 且弹孔仅产生于被射击墙面，实际不可见此瑕疵，列为已知取舍。

## ADR-9 WebGL 后端选型：three.js r147 UMD 本地打包（v3）

- **上下文**：v3 要求墙体改为带 base / normal / roughness 三通道 PBR 贴图的 3D 网格，Bot 与 FPS 视图模型改为 glTF/GLB 低面数模型。站点仍是纯静态零构建项目：无 npm 依赖、无打包器、无 CDN 运行时库请求、无 ES module（`file://` 下 module 受 CORS 限制），脚本必须继续以普通 `<script>` 顺序加载并共用全局 `CS` 命名空间。ADR-6 已经把渲染器抽成五方法接口，具备换后端条件；同时 v1/v2 全部数值、AI、胜负、操作映射必须逐位不变。
- **备选**：① 继续 Canvas 2D 手写投影、把贴图绘制到面上（无法表达法线贴图、深度缓冲与真 3D 模型，人物/枪械仍是公告板与多边形色块）；② 引当前 three.js ES module + importmap + 构建步骤（违反零构建 / 无 npm，且 `file://` 打开会失败）；③ 手写 WebGL shader 与矩阵库并自研 GLB 解析（工作量与风险都不可控）；④ 引 three.js **r147** 的 UMD 构建 `build/three.min.js`（全局 `THREE`）+ `examples/js/loaders/GLTFLoader.js`（挂 `THREE.GLTFLoader`），两份文件落地到 `cs/vendor/`。
- **决定**：采用 ④。r147 是最后一代仍随包发布 `examples/js` 非 module 加载器的版本；两文件本地落盘（607,784 B + 103,311 B = 711,095 B），配 `vendor/LICENSE.md` 记录 MIT 许可、版本、直链与访问日期。加载顺序固定为 `js/renderer.js` → `vendor/three.min.js` → `vendor/GLTFLoader.js` → `js/renderer-gl.js` → 其余游戏模块；`renderer-gl.js` 在加载时把 `CS.Renderer` 指向 `RendererGL`，因此 **`game.js` 零改动**。three.js 只负责「画」：`RendererGL` 复用 ADR-6 的 `Renderer{beginFrame, submitFace, drawBillboard, drawViewmodel, endFrame}` 全接口，`submitFace` 退化为接口计数 no-op（2D 面池保留给降级后端）。WebGL canvas（`cs-gl-canvas`，z-index 0）置于底层，原 `cs-canvas` 保留为 2D overlay（z-index 1）承载弹孔 / 粒子 / 弹壳 / 火光 / 浮字 / HUD 相关屏幕空间绘制。
- **后果**：获得 GPU 深度缓冲、`MeshStandardMaterial` 三通道 PBR 与 glTF 实例化能力，且零构建红线不破。代价：① 引入 711 KB vendor，`cs/` 体积预算须由 ADR-3 的「html+css+js+svg < 100 KB」修订为整目录 ≤ 8 MB（见 ADR-11）；② 新增 WebGL2 上下文依赖，必须由 ADR-11 降级链兜底；③ three.js 版本被钉死在 r147，若升级到 r148+ 需重新验证 `examples/js` 是否存在（该目录自 r148 起移除）；④ 保留一份「只画不算」的镜像世界状态，后续若引入自定义 shader 需显式处理镜像（见 ADR-10）。

## ADR-10 绘制与判定解耦：手性镜像 + 水平 FOV 换算（v3）

- **上下文**：v2 手写投影为「看向 +Z」的左手式相机基（`right × up = +forward`），12 个 AABB、rayWalls slab、公告板 hitscan、TPS 后退 2.4 m + 抬升 0.22 m、近墙 alpha 0.38、水平 FOV 75° 全部建立在 v2 坐标系上。three.js 是右手系、`PerspectiveCamera` 默认看向 −Z，且 `camera.fov` 是**垂直** FOV。红线要求 hitscan 仍走 `CS.World.rayWalls` 与 `CS.Entities.hitScan`、切镜零收益、所有数值逐位不变。
- **备选**：① 用 `THREE.Raycaster` 对模型三角面做命中（浮点与三角面差异会破坏数值零漂移，且模型替换后判定随美术变化，明确禁止）；② 把逻辑坐标系整体翻成右手系（要改 `world.js` / `entities.js` / `game.js` 的射线、AABB、朝向与全部数值，违反零漂移）；③ 仅在渲染层做镜像：`worldRoot.scale.x = -1`，相机位 / forward / up 同步施加 `M(x,y,z)=(-x,y,z)`，逻辑层一个字节不动；④ 把 `camera.fov` 直接写 75（水平 FOV 会随宽高比漂移，破坏准星、散布、HUD 与视图模型锚点的一致性）。
- **决定**：采用 ③ 并叠加严格 FOV 换算 `vFOV = 2·atan(tan(75°/2) / aspect)`；`resize()` 重算 `camera.fov` / `camera.aspect` / `updateProjectionMatrix()`，同时保留 `focal = 0.5·cssW / tan(75°/2)` 供 2D overlay 投影与视图模型锚点复用（1100×800 → 58.3279°，375×667 → 107.5397°，1024×600 → 48.418°）。`RendererGL` 不写任何游戏状态：眼位、相机位、TPS 回缩、玩家 alpha 均由只读的 `player` / `viewMode` 推导；`rayWalls(7 参)` 与 `hitScan(8 参)` 签名保持不变。glTF 模型到位后只替换网格几何，Bot / 玩家的判定盒尺寸（`BOT_Y0/Y1/HALF_W`）不变。
- **后果**：真实 three.js 相机 `Vector3.project(cam)` 与 v2 手写投影在四组 yaw/pitch 下的最大误差为 **1.637e-11 px**（harness 用真实 vendor 文件实测），即 WebGL 与 2D 投影逐像素对齐；判定与绘制完全解耦，换模型、换贴图、切主题都不会触碰任何数值。代价：① `worldRoot.scale.x = -1` 为负行列式变换，r147 已正确处理法线与背面剔除，后续自定义 shader 需显式处理；② 模型朝向与缩放由 `CS.GLAssets.opt` 的 `yawMirror` / `rotY` / `scale` 单点标定，资产清单到位后需逐项验证。

## ADR-11 三级降级链、资产表驱动加载与性能/体积预算修订（v3）

- **上下文**：WebGL 上下文可能创建失败、运行中丢失或被浏览器禁用；低端机 GPU 可能达不到 45 fps 下限。T1 与主程序并行落盘 CC0 资产；用户折中裁定（移除人物 GLB、零歧义 CC0 优先）后，主理人已中转唯一有效清单（`cs/assets/LICENSE.md` §4.1/§4.2），12 个贴图槽、模型槽与标定值均已按清单填妥并 `enabled=true` 启用；v2 的 ADR-3 预算（60 fps、面池 ≤ 80、`cs/` 内 html+css+js+svg < 100 KB）与 ADR-6 的「两级降级」已不足以描述 v3。
- **备选**：① 只做单一 WebGL 后端（无兜底，违反「禁用 WebGL 仍可玩」红线）；② 把资产文件名硬编码进渲染器（T1 并行期无法接线，且任一文件缺失会整帧报错）；③ 任一资产失败即整体回退 2D（一项缺失拖垮三项表现层）；④ 三级降级链 + 单点资产表 + 逐项失败跳过。
- **决定**：
  1. **降级链**：默认 `RendererGL`；`webglcontextlost` / context create failed / 缺 `THREE` API / 1 s 采样窗口实测 <45 fps → `forceFallback()` 单向切到 `Renderer2D`；`Renderer2D` 再实测 <45 fps → `Renderer2DFlat`。`forceFallback` 记录 `lastFallbackReason`、隐藏 GL canvas、复用已 init 的 2D overlay，并把 `CS.Renderer` 指向 `Renderer2D`；此后 `checkPerf` 由 2D 实现接管，单向不可回切。
  2. **资产表（最终规格）**：`CS.GLAssets = ASSETS`，`enabled=true` / `base='assets/'` / `textures`（**brick / concrete / metal / ground 四组 × color / normal / rough 三通道 = 12 槽，全部填 Poly Haven 1K JPG**）/ `wallGroups[0..11]`（沿用 `renderer.js` 的 `boxTex[k]` 语义：0–3 外围砖墙、4/6/8/10 混凝土、5/7/9/11 锈蚀金属箱）/ `models`（**bot / player 置空，gun / gunTps 均为 Kenney `gun_blaster.glb`**）/ `opt`（tile、镜像、旋转、缩放、枪距、火光锚点，以及只在 glTF 到位时生效的 `opt.gltf` 标定值）。**人物项未立体化**是用户以「零歧义 CC0 优先」裁定的结果，Bot 与 TPS 玩家保留公告板 / 程序化低模，判定盒不变。加载器只按表显式引用、不扫描 `cs/assets/`；`loadTexture` / `loadModel` 单项失败只跳过该项并保留程序化纹理与几何兜底；glTF 到位后以 `clone(true)` 实例化到 FPS 枪 / TPS 枪，材质 clone 保证槽位独立并按 `--cs-gun-dark/gun-body` 重着色。base color 走 `sRGBEncoding`、normal/roughness 走 `LinearEncoding`，`RepeatWrapping` + `anisotropy ≤ 4`，金属箱 `normalScale 0.35`、其余 `0.6`，亮主题 `0xffffff` / 暗主题 `0x93a7c4` 乘色。**Kenney GLB 的 `colormap` 是未随包提供的外部 URI**，用 `THREE.LoadingManager.setURLModifier` 重定向到清单内已有的 CC0 混凝土 basecolor（2 次重定向，0 个 404 / 0 个失败），避免为缺图新增资产文件。实测 `Box3` 尺寸 `0.160 × 0.371 × 0.862 m`（长轴 Z，无需 90° 轴向旋转），FPS `scale=0.42 / rotY=0`、TPS `scale=0.93 / rotY=0`。
  3. **特效与主题不退化**：弹孔 32 FIFO、粒子 64、弹壳 8、火光 1、视图模型与 HUD 全部沿用 ADR-8；2D overlay 每帧先 `clearRect` 再重画，避免残留帧或覆盖枪口火光。逐帧复用 `Vector3` / `Quaternion` / `Matrix4` / 几何 / 材质 / 特效池，热路径零分配。init 与 `themeChanged` 时读 `getComputedStyle(document.documentElement)` 的 `--cs-*` 并刷新 sky / fog / background / ambient / sun / viewLight / 材质色；CSS 规则内颜色一律 `var()`。
  4. **预算修订**：60 fps 目标不变；绘制调用改以 `renderer.info.render.calls` / `triangles` 观测（当前场景 11~30 calls、122~240 tris，远优于 2D 最坏 ~200 次 fill）；`cs/` **整目录 ≤ 8 MB**（含 vendor 711 KB 与 T1 资产）；移动端继续 `renderScale = 0.8`；`dt` 上限 0.05 s、暂停/失焦停帧不补算、1 s 性能判定窗口均不变。
- **后果**：任一级失效都可继续游玩，且 v1/v2 数值逐位不变；CDP B 组以 `--disable-webgl` 实测回退 `Renderer2D` 且仍出图可玩（回退路径不发起任何资产请求），C 组以确定性 40 fps 驱动实测 `gl → tex → flat` 完整三级链。CDP A 组实测 12 张贴图 + 2 个模型全部加载成功、0 失败，4 组材质各挂 1024² 三通道贴图；「摘除贴图再渲染」差分 Δ=292、色数 804→148、还原后恢复，证明贴图确实贡献像素而非仅加载成功。代价：① 人物项未立体化，属用户许可裁定后的知情取舍，不得包装为已达成；② Kenney GLB 缺内嵌 colormap，需 URL 重定向兜底（见上），若后续换成自带贴图的 GLB 应移除该 modifier；③ 体积预算放宽后仍需交付前逐项实测；④ headless/节流环境下 `dt` 上限 0.05 s 意味着 1 s 判定窗口至少需要 20 个样本，短窗口不误触发降级（测试侧需按此设计断言）。

## ADR-12 手机横屏：系统锁定优先 + 旋转引导兜底（v3.1）

- **上下文**：手机竖屏（375×667）下水平 75° FOV 换算出的垂直 FOV 达 107.5°，HUD 与摇杆挤占画面；用户要求「phone 端自动切换到横屏模式」。网页无法真正旋转设备：Android Chrome 仅在**全屏状态 + 用户手势**下支持 `screen.orientation.lock('landscape')`，iOS Safari 既无该 API 也无 `requestFullscreen`。
- **备选**：① 只提示旋转（不构成「自动切换」）；② CSS `rotate(90deg)` 伪横屏（需在 `input.js` 对摇杆 / 拖拽的 pointer delta 做逆变换，并重新回归三视口布局与 renderer resize，改动面大）；③ 系统锁定优先 + 竖屏引导遮罩 + 自动暂停 / 恢复 + 跳过逃生口。
- **决定**：采用 ③，新增 `js/orientation.js`（`CS.Orientation`）。`isPhone()` = `CS.Input.isTouch && min(innerWidth, innerHeight) ≤ 480`，用于排除平板与触屏笔记本，PC / 触屏笔记本零介入、不触碰 Pointer Lock。`onStart()` 位于点击「开始任务」的**同步手势链路**内：先 `documentElement.requestFullscreen()`，其 Promise 与 `fullscreenchange` 各尝试一次 `lock('landscape')`，失败静默降级。以 `innerWidth < innerHeight` 判竖屏，显示 `#screen-rotate`（`z-index: 4000`，高于站点 share/comments 浮动按钮 3100 / 面板 3250 / 评论 2100、低于通知 9999，颜色全用 `var()`）并 `game.pause()` 冻结 dt；`orientationchange` / `resize` / `fullscreenchange` / `visibilitychange` / `orientation.change` 统一走 `sync()`，转横屏自动 `hideGate → game.resume()`；`resume()` 加 `isBlocking()` 守卫，防止绕过遮罩恢复。点「跳过」置会话级 `skipped`，以竖屏继续且不再引导；`toMenu` / `finish` 调 `stop()` 收起遮罩。
- **后果**：Android Chrome 进游戏即真横屏；iOS / 系统锁定竖屏的浏览器有明确引导与逃生口，不会卡死。不新增依赖，不改渲染器、触控坐标系与任何 CFG 数值，既有三视口布局与 Pointer Lock 路径保持原样。横屏成为手机主路径后暴露一处既有布局缺陷：原 `@media (max-height:520px)` 把 HP / 弹药压在左下 / 右下，667×375 下与摇杆、开火钮及站点浮动按钮重叠（CDP 实测 4 对、最大 6987 px²）；新增 `@media (max-height:520px) and (pointer: coarse)` 把两块 HUD 并排移到摇杆右侧、开火钮右移让出 fab，竖屏 375×667 与 PC / 触屏笔记本布局逐字节不变。已知限制：网页无权强制旋转设备，锁定失败时仍需用户手动转屏（或点「跳过」）；站点公共浮动按钮在该宽度下仍有约 26 px 被视口右缘裁切，属公共组件既有表现，不在 cs 内改动。

## ADR-13 手机触控与渲染性能调优：关 MSAA、禁手势争抢、大摇杆（v3.2）

- **上下文**：用户反馈 phone 端「滑动视角有点卡」并要求「移动方向布局再大点」。headless CDP（手机视口 + 触屏模拟 + CPU 节流 2×）实测静止 ≈55 fps / 拖拽 ≈61 fps，`rAF` 间隔与 `endFrame` 耗时均无异常，JS 事件链与逻辑层开销可忽略——真机卡顿无法在桌面复现，瓶颈指向真机 GPU 渲染与浏览器手势管线，而非脚本。
- **决定**：
  1. **渲染**：`WebGLRenderer` 由 `antialias:true` 改为 `antialias:false` 并加 `powerPreference:'high-performance'`。内部渲染本就是 CSS×0.8 低分辨率（横屏 534×300），MSAA 在手机 GPU 上开销大而视觉收益小；`setPixelRatio(1)` 与 `renderScale=0.8` 不变。仅渲染参数，CFG 数值与判定零漂移。
  2. **手势**：`html, body` 加 `overscroll-behavior:none`（禁橡皮筋滚动 / 下拉刷新），`body` 加 `user-select:none`（禁长按选择 / 放大镜），避免浏览器手势与滑动视角争抢。
  3. **摇杆**：竖屏 116→132 逻辑 px（knob 44→52、left 16→14、bottom 24→20），横屏矮屏 96→112；`JOY_RADIUS=48` 满速半径不变，手感零漂移。竖屏 HP `bottom:150→165`、横屏 HP `left:120→136` / 弹药 `left:252→268` 让位，CDP 实测 15 控件两两重叠 0 对。
- **后果**：`antialias:false` 会使既有像素 checksum 快照失效（渲染视觉参数变化，属本项优化目的）；判定、散布与 CFG 65 项不变。2D 兜底渲染器未动（WebGL 不可用回退场景的真机帧率维持原状）。headless 下 WebGL / 全屏均受限，真机收益需真机复测确认。

---

## ADR-14 画质自动降级增强：慢帧判定 + 降级记忆 + toast 提示（v3.3）

- **上下文**：用户反馈「感觉 3D 不行，能否自行切换降 2D」。既有降级链（ADR-11）只按「1 s 窗口平均 <45 fps」判定——真机常见「帧率达标但帧节奏卡」（平均 fps ≥45 而 30 ms+ 慢帧占比高）不会触发；且降级完全静默，下次进游戏又从 GL 重新开始，用户无从感知与保持。
- **决定**（均在 `renderer-gl.js` / `hud.js`，不动 `renderer.js` 与 CFG）：
  1. **判定增强**：`checkPerf` 窗口内统计 `dt > 34 ms` 慢帧；窗口结束时「平均 <45 fps **或** 慢帧占比 >40%」记为低窗口，**连续 2 个低窗口**才 `forceFallback('low-fps')`——比旧口径更敏感（捕捉帧节奏卡）也更稳（防波次生成瞬时尖峰误切）。
  2. **降级记忆**：low-fps 降级时写 `localStorage.cs_render='2d'`（try/catch 包裹，隐私模式静默）；模块加载时读到该值直接 `CS.Renderer = Renderer2D`（`lastFallbackReason='pref-2d'`，不创建 glCanvas）。`cs_render` 仅由 low-fps 路径写入；WebGL 不可用 / 上下文丢失（`context-create-failed` 等）**不写**——那类设备无「恢复 3D」可言，写值反而丢失语义。
  3. **可见反馈**：`CS.HUD.toast(msg)`（`hud.js` 新增，`#perf-toast` 顶部居中提示条，`is-show` 类 CSS 过渡显隐，2.6 s 自动消失，`pointer-events:none` 不挡操作）；forceFallback 时提示「已自动切换至 2D 画质模式」。z-index 3600 高于站点面板 3250、低于旋转引导 4000；颜色全 `var()` 双主题。
- **恢复 3D**：清除 `localStorage.cs_render` 后刷新即回 GL（CDP F8 实测）。无菜单内开关，保持 diff 最小。
- **后果**：验证 `qa-fallback.mjs`（SwiftShader 软件 WebGL）8/8：初始 GL → 强制慢帧连续 2 窗口降级 → GL canvas 隐藏 + localStorage 写入 + toast 可见 → 降级后可正常开局 → 刷新直接 2D（pref-2d 且 glCanvas=null）→ 清除后恢复 GL；全程 pageerror=0。既有 29 断言回归零变化。已知限制：记忆粒度为「设备/浏览器全局」，PC 上若曾手动触发过 slow-feed 测试需清除后才能回 3D（正常游玩 PC 帧率不会触发）。

## ADR-15 画质手动切换：主菜单「画质」按钮 3D↔2D（v3.4）

- **上下文**：ADR-14 之后用户要求「添加 2D 和 3D 可切换，如果 3D 不支持保持降级到 2D」——需要菜单内手动开关，且不支持 3D 的设备必须始终落在 2D。
- **决定**（`index.html` 菜单 + `game.js` `toggleQuality` + `hud.js` 按钮/标签 + `renderer-gl.js` `supported` 探测，不动 `renderer.js` / CFG / 自动降级链）：
  1. **UI**：主菜单新增「画质 <3D/2D>」mini-btn（与「起始视角」同款交互），标签始终与 `CS.Renderer.id` 严格一致（`showMenu` 时刷新）。
  2. **3D→2D**：`useRenderer('tex')` 即时切换 + `cs_render='2d'` 记忆 + `renderStatic`，无需刷新（本会话 GL 必已初始化）。
  3. **2D→3D**：本会话 GL 健康（`isReady && !fallbackDone`，即被手动切走的）→ `useRenderer('gl')` 即时切回；`fallbackDone` 或未初始化过 GL（pref-2d 启动）→ 写 `cs_render='3d'` 后 `location.reload()` 重新探测（GL 场景对象仅存活一个后端会话，不做运行时重建）；three API 缺失或 WebGL 上下文探测失败（`RendererGL.supported=false`）→ toast「当前设备不支持 3D 渲染」，不写偏好、不刷新、保持 2D。
  4. **与自动降级的键语义**：`cs_render` 值域扩展为 `2d`/`3d`/空（缺省=3D 若支持）。自动 low-fps 降级仍写 `2d`（覆盖手动 `3d`——符合「3D 跑不动就保持 2D」）；手动选 3D 后真不支持的设备每次点按钮都会得到明确 toast，不会静默循环刷新（点一次刷新一次，init 失败落回 2D）。
- **后果**：验证 `qa-quality.mjs`（SwiftShader + `--disable-webgl` 双实例）7/7：默认 3D 启动 → 即时切 2D（id/记忆/GL 隐藏/toast）→ 即时切回 3D → pref-2d 启动点 3D 走「写偏好+刷新」恢复 GL → 无 WebGL 时 supported=false、toast、保持 2D、零刷新零写入；pageerror=0。回归 `qa-landscape` 31/31、`qa-fallback` 8/8、`qa-walls` 4/4、`qa-aim-sprint` 8/8 零变化。已知限制：pref-2d 启动后切 3D 需一次页面刷新（即时切换仅限本会话 GL 已初始化的场景）；自动降级记忆会覆盖手动 3D 偏好（设备能力优先）。

## ADR-16 手机默认 2D：低端手机 GPU 跑不动 three.js/GL（v3.5）

- **上下文**：用户真机反馈「phone 端不能玩啊，很卡」。此前手机默认与 PC 同为 `RendererGL`，依赖 ADR-14 的 low-fps 自动降级兜底——但降级需连续 2 个 1s 低窗口（≈2.5 s），且降级前的首发体验已经「不能玩」；three.js 全场景（PBR 贴图墙 + glTF + 光照雾）在低端手机 GPU 上从头就不达标。
- **决定**（仅 `renderer-gl.js` 模块加载选择段）：`localStorage.cs_render` 无显式偏好（既非 `'2d'` 也非 `'3d'`）且设备为手机（`(pointer: coarse)` + 短边 ≤480，与 CS.Orientation 同口径；此时 `CS.Input` 尚未加载故直接判 media query）时，默认 `CS.Renderer = Renderer2D`（`lastFallbackReason='phone-default'`，不创建 glCanvas、不加载任何纹理/模型）。**优先级：显式偏好 > 手机默认 > PC 默认 3D**。手机默认不写 localStorage——PC 行为、偏好语义、自动降级链全部不变；手机用户仍可经菜单「画质」钮写 `'3d'` 显式尝试 GL（若跑不动，low-fps 降级会写回 `'2d'` 并保持）。
- **后果**：验证 `qa-quality.mjs` 扩到 10/10：新增 Q8 手机无偏好默认 2D（phone-default、零写入）、Q9 手动选 3D 显式偏好优先刷新恢复 GL、Q10 清除偏好回落 phone-default；回归 `qa-landscape` 31/31、`qa-fallback` 8/8、`qa-walls` 4/4、`qa-aim-sprint` 8/8 零变化。已知限制：手机 2D 模式仍会下载 `vendor/three.min.js` + `GLTFLoader.js`（约 700 KB，静态 `<script>` 标签，影响首载流量不影响帧率）；按需动态注入是后续可选项。

## ADR-17 手机 2D 帧率机制修复：限帧 60 + 慢帧自适应降分辨率 + 评论懒加载 + FPS 读数（v3.6）

- **上下文**：用户真机反馈「手机端用 2D 也很卡，是不是机制就有问题」。逐项排查（先实测后落码）：Canvas 2D 渲染路径无 `shadowBlur`/`ctx.filter`/逐帧渐变重建（渐变与 pattern 均 init/resize 缓存）；HUD 全部 DOM 写入有 change-guard；主循环仅在 playing 时 update/render；门户 `common.js`/`sound.js` 无常驻 rAF/interval；门户 CSS 无无限动画。真正的机制问题有三：① **120Hz 高刷屏**（当下中高端手机标配）使 rAF 以 120 次/s 驱动全部逻辑与重绘，逐帧预算仅 8.3 ms，中端机直接超预算；② **giscus 评论 iframe 在页面加载即初始化**，游玩期间在弱机上抢主线程；③ 2D 慢帧只有「flat」一档兜底，缺中间档。
- **决定**：
  1. **限帧 60**（`game.js` `frame`）：`now - lastPaint < 15` 的 rAF 帧直接跳过，跳过帧不更新 `last`，dt 自然累计（仍受 `DT_MAX` 钳制）——120Hz 设备逻辑与重绘负载减半，60Hz 设备零影响。
  2. **2D 慢帧自适应**（`renderer.js` `checkPerf`）：窗口 <45fps 且纹理模式时，先 `scaleOverride=0.65` 重算内部分辨率（手机 667×375 下 534×300→434×244，toast「已降低渲染分辨率以提升流畅度」），下一窗口仍低才降 `Renderer2DFlat`；会话内不回弹。
  3. **评论懒加载**（`index.html` + `game.js`）：移除页面加载时的 `FleaComments.init('cs')`，改为 `__csCommentsLazy()` 在首次结算 / 回主菜单 / **主菜单停留 5s 兜底**（照顾开局前浏览评论；触发时若已开局则跳过留给结算）三个时机初始化。
  4. **实测 FPS 读数**（`hud.js` + `index.html` + `style.css`）：`#hud-fps`（hud-view 块正下方，避开右上角门户 FAB）每 0.5s 汇报实测帧率，change-guard 防逐帧 DOM 写——供真机诊断回报。
- **后果**：验证新 `qa-perf2d.mjs` 7/7：加载后评论未初始化、合成时间戳驱动限帧（<15ms 跳过 / ≥15ms 绘制）、低窗口 1 降分辨率（434=667×0.65 + toast）、低窗口 2 降 flat、开局后 FPS 读数为正、toMenu 触发懒加载；pageerror=0。回归 `qa-landscape` 31/31（B10 断言同步：comments FAB 懒加载后初始可缺席）、`qa-fallback` 8/8、`qa-walls` 4/4、`qa-aim-sprint` 8/8、`qa-quality` 10/10。已知限制：限帧阈值 15ms 硬编码（60/90/120Hz 三档通吃，非 CFG 项）；若真机 2D 仍卡，FPS 读数可定位是渲染瓶颈（数值低）还是环境瓶颈（数值高但仍卡，如浏览器后台任务）。

---

## ADR-18 触控按钮布局设置：拖动定位 + 步进缩放 + localStorage 持久化（v3.7）

- **上下文**：用户要求 phone 端可调整各操作按钮的布局和大小。既有触控按钮（摇杆/跳/蹲/开火/换弹/换镜/暂停）位置全部写死在 CSS 断点里，不同手型/横竖屏习惯无法个性化；而触屏玩家对按钮位置敏感度远高于键鼠玩家。
- **决定**：新增独立模块 `touchcfg.js`（`CS.TouchCfg`），**只改布局、零游戏逻辑侵入**：
  1. 主菜单新增「按钮布局 · 设置」入口，仅触屏显示/绑定（`(pointer: coarse)` CSS 分流 + `CS.Input.isTouch` JS 双保险；触屏笔记本主指针为鼠标，仍走 PC 路径）。
  2. 编辑态：body 加 `is-tcfg-edit`，控件浮到菜单 overlay 之上（`#touch-buttons`/`#joystick` z-index 60），菜单面板隐藏，顶部固定工具条（提示 + 选中名 + −/＋ + 恢复默认/取消/保存，top 60px 避开站点 FAB）；窗口捕获级 `click` blocker 吞掉工具条外一切点击防误触。
  3. 拖动 = pointerdown 选中并起拖，window 捕获级 pointermove 把**控件中心点**换算为视口百分比（clamp 5%~95% / 6%~94%），旋转/换机安全；点选（无位移）弹出大小步进，`--ts` 缩放 0.7~1.6 步进 0.1，CSS `translate(-50%,-50%) scale(var(--ts))` 统一定位缩放，`:active` 按压反馈按 `calc(var(--ts)*0.94)` 保留。
  4. 持久化 `localStorage.cs_touch`（`{v:1, items:{id:{x,y,s}}}`），加载时 clamp 校验后应用；「恢复默认」清空并可经「取消」从快照还原；保存有 toast 反馈。
  5. **「暂停」钮固定不调**——防止玩家把它拖进死角后无法退出对局；编辑态将其弱化（opacity 0.45）示意不可拖。
- **后果**：验证新 `qa-touchcfg.mjs`（合成 PointerEvent 走 window 捕获链，与真机手势同路径）9/9：触屏入口显示/编辑态三要素/拖动 ≈30%/42% 定位/点选 + 两次＋ 120%/保存写 LS + toast/刷新自动应用/取消还原/恢复默认清空/PC 入口隐藏且 `enter()` 不生效；pageerror=0。回归 `qa-landscape` 31/31、`qa-fallback` 8/8、`qa-walls` 4/4、`qa-aim-sprint` 8/8、`qa-quality` 10/10、`qa-perf2d` 7/7。已知限制：位置以视口百分比存储，极端宽高比切换（如平板横竖互换）按钮相对位置保持但可能与 HUD 信息块重叠——属玩家自选布局，提供「恢复默认」逃生口；工具条为中文（游戏内 UI 不做 i18n，与既有「跳/蹲/开火」一致）。

---

## ADR-19 手机端 HUD 顶置 + 暂停钮右上 + 游戏中隐藏站点 FAB（v3.8）

- **上下文**：用户反馈三点：① phone 端血量/弹夹位置不合理（竖屏血量压在摇杆上方、弹匣悬在中部；横屏两块挤在底部拇指热区）；② 暂停钮应移到左上或右上角；③ 游戏模式隐藏左下/右下的站点分享与评论浮动按钮。横屏矮屏右下区已排满 6 个控件（SCORE/跳/蹲/换弹/换镜/开火），弹药块 104×64 无现成空位，需要整列微排。
- **决定**：
  1. **HUD 顶置**（`style.css` 末尾 `(pointer: coarse)` 组）：血量 `top:132px left:10`（左列 view/FPS 下方），弹匣 `top:132px right:10`（右列 SCORE 下方）——远离摇杆/开火拇指区，竖屏两翼对称；竖屏 FPS 读数 `top:98 left:10`（原 `top:62 left:84` 与居中 WAVE 块擦碰，目检发现顺手修）。
  2. **横屏矮屏特调**（`max-height:520px and pointer:coarse` 组，置于通用组之后）：弹匣 `top:160 right:132`（SCORE 正下、跳/蹲左侧），SCORE 下移 `top:92`，跳/蹲上提 `bottom:136`、换弹 `bottom:108`、换镜 `bottom:66`、开火 `bottom:68`——右列自上而下 [暂停|SCORE]/弹匣/跳蹲/换弹·换镜·开火全部错位。第一版弹匣直接放 `top:10 right:10` 与站点音效/主题钮（floating-buttons，**非懒加载 FAB，不受 cs-in-game 隐藏**）重叠，由扩充后的 C5 实测抓出后改为现方案。
  3. **暂停钮右上**：`#btn-pause { top:10 right:112 }`（横屏 `right:120`），与站点音效/主题钮同排左留 10px 间隙；不再参与触控布局编辑（ADR-18 已固定），编辑态弱化示意不变。
  4. **游戏中隐藏站点 FAB**：`game.js` start 加 `body.cs-in-game`、toMenu/finish 移除（结算页恢复分享/评论），CSS `body.cs-in-game #flea-share-fab, #flea-comments-fab { display:none !important }`；暂停（局内）保持隐藏。全端一致（PC playing 同样隐藏）。
- **后果**：`qa-landscape.mjs` OVERLAP 清单从 15 控件扩到 **18 控件**（补 btn-jump/btn-crouch/hud-fps——此前跳/蹲与弹匣的第一次重叠正是清单盲区漏检，目检截图发现）；C6 改断言横屏新布局四块 y 值，新增 C7「游戏中 FAB display none」；**32/32 PASS**。回归 `qa-fallback` 8/8、`qa-walls` 4/4、`qa-aim-sprint` 8/8、`qa-quality` 10/10、`qa-perf2d` 7/7、`qa-touchcfg` 9/9。已知取舍：横屏弹药与换弹钮 y 间隙 5px、跳/蹲与开火 6px，均为 0 重叠但偏紧；横屏菜单态 HUD 弹匣（overlay 之下）与站点 FAB（overlay 之上）分属两层不互相拦截。

---

## ADR-20 超矮横屏弹匣移位：≤364px 断点（v3.9）

- **上下文**：用户真机反馈横屏有大问题。专项排查发现 BUG-03：横屏矮屏组弹匣面板 `top:160`（top 锚）与换弹钮 `bottom:108`（bottom 锚）相向逼近，换弹顶 = H−146，弹匣底 ≈ 218，**H≥364 才不撞**——375 高（iPhone SE）侥幸通过、360 高压 2px、344 高压 18px（747px²）。真机触发面极广：安卓未全屏横屏可视高度常为 340~360，iPhone Safari 横屏无全屏 API、扣掉地址栏后 ~346 必现。此前 qa-landscape 只测 667×375 单点，属验收盲区。
- **决定**：新增 `@media (max-height:364px) and (pointer:coarse)` 组，弹匣移到**左列 HP 正右**（`top:132; right:auto; left:144`）。不选右列压缩方案：右列 SCORE 底(~152)到换弹顶(H−146)在 344 高下纵向仅剩 ~46px，塞不下 58px 面板；左列 HP [132,194] 与摇杆顶(H−132)之间有充足空档，且与 wave 居中块、FPS 读数纵向错开。
- **后果**：`qa-land-sweep.mjs` 104 组合（13 宽 × 8 高）重叠 0 对；`qa-land-diag.mjs` 28/28（真实 `dispatchTouchEvent` 驱动摇杆/滑屏视角/双指并发/开火/跳蹲换弹换镜 + 旋转流转 + 5 档分辨率命中）。方法论修正：横屏几何断言从此**穷举分辨率**（sweep 脚本），触控功能用真实触控事件而非 rect 推断；top/bottom 锚混排的列必须在最矮目标高度复核。

---

## ADR-21 手机端 HUD 全顶置 + 视角·帧率合并块（v3.10）

- **上下文**：用户要求 ① 得分/HP/弹匣全部放到最上方（此前 HP/弹匣挂 top132 第二排、SCORE top92/62，散在顶部区域中段）；② 「FPS 视角标识」与「FPS 54」帧率读数合并到一起展示——两块相邻但分立（PC 顶左 `top:20 left:84` 与 `top:62 left:84`，手机端各排一处）。
- **决定**：
  1. **合并块（全端）**：`#hud-fps` 独立元素删除，`fps-value` 内嵌进 `#hud-view`（`<span id="view-mode">FPS</span><span class="hud-dot">·</span><span id="fps-value">`），显示为 `FPS · 60`；`hud.js setView` 改写 `#view-mode` 子节点（原 textContent 整写会抹掉子元素）；`.hud-fps` 基础定位规则删除，新增 `.hud-view .hud-tiny { font-weight: normal; letter-spacing: 0 }` 保数字不随块内粗体/字距。
  2. **竖屏顶置两排**（coarse 组）：第一排 `top:60` HP 左 / 弹匣 右（60 = 站点返回/音效/主题钮行 top10 高42 之下）；第二排 `top:140` 视角·帧率 左 / WAVE 中 / SCORE 右。140 而非 128：HP 面板高 ~71（label+血条+数字），128 会与 HP 左下角碰 3px。
  3. **横屏一排**（max-height:520 coarse 组）：宽度充足，四块并 `top:60` 一排——HP 左 / 视角·帧率 `left:142` / SCORE `right:124` / 弹匣 `right:10`；WAVE 回顶行 `top:20` 居中（与返回/暂停/音效/主题钮同排，640 宽起互不撞）。
  4. **删除 ADR-20 的 ≤364px 弹匣移位补丁**：弹匣不再进右列中段，右列从上到下只剩触控钮，BUG-03 的触发条件（top 锚 HUD 与 bottom 锚按钮相向逼近）整体消失，超矮横屏无需特调。
- **后果**：`qa-land-diag.mjs` 扩到 **30/30**（新增 R3 竖屏游玩态顶置布局零重叠——跳过引导后实测、R4 合并块断言：`view-mode`/`fps-value` 同块、旧 `#hud-fps` 已删、帧率实际刷新）；`qa-land-sweep.mjs` 104 组合重叠 **0 对**；PC 干净探针（1100×800 fine）：合并块 `84,20`、HP/弹匣保持底部两角经典 FPS 布局不动。PC 端未要求顶置，维持经典布局（HP 左下/弹匣右下），仅合并块全端生效。

---

## ADR-22 手机端 HP / SCORE / 弹匣 三块尺寸统一（v3.10.1）

- **上下文**：ADR-21 顶置后用户反馈「HP 偏大」——实测竖/横屏下 HP `124×73`、SCORE `70×56`、弹匣 `104×56`。HP 因血条独占一行高 17px、min-width 多 20px，三块视觉不齐。
- **决定**：在 coarse 组里把 HP 改为 grid 两列（`grid-template-columns: 1fr auto`，label 跨两列），血条内联到数字同一行（`.hud-bar margin 2px 0`），min-width 124→104；SCORE 补 `min-width: 104px`。三块统一为 **104×56**。不改 HTML 结构、不影响 PC（coarse 限定）。
- **后果**：`probe-hud-size.mjs` 实测竖/横屏三块均 `104×56`；`qa-land-diag.mjs` 30/30、`qa-land-sweep.mjs` 104 组合零重叠无回归；截图目检血条与数字并排、三块齐平。竖屏第二排 SCORE 右缘 365 与 WAVE 右缘 252 留 9px、横屏 SCORE 右缘 616 与弹匣左边 626 留 10px，均不撞。

---

## ADR-23 手机端 FPS 块移到返回键旁（v3.10.2）

- **上下文**：ADR-21 顶置后 FPS 合并块在竖屏第二排左（top140 left10）、横屏一排左二（top60 left142），用户要求「FPS 显示放到返回按键旁边」。PC 端 `.hud-view` 本就 top20 left84 紧贴返回键，无需改。
- **决定**：coarse 组的竖屏与横屏两处 `.hud-view` 统一改为 `top:13 left:62`——返回键 x10..52（42×42），块左缘留 10px 间隙；top13 使 36 高块相对 42 高返回键垂直居中（10+(42−36)/2=13）。竖屏原第二排空出的左位不影响 WAVE 居中 / SCORE 右。
- **后果**：`probe-hud-size.mjs` 实测竖/横 view 均 `x62 y13`（竖 78×36 / 横 83×36），与暂停钮竖屏 x209（间隙 69px）、横屏 x566 不撞；`qa-land-diag.mjs` 30/30、`qa-land-sweep.mjs` 104 组合零重叠无回归；竖横截图目检返回键与 FPS 块同排紧挨。

---

## ADR-24 手机端三块 HUD 进一步紧凑化（v3.10.3）

- **上下文**：ADR-22 把 HP/SCORE/弹匣统一为 104×56 后用户仍觉偏大，要求继续缩小。
- **决定**：在 coarse 组加一条共享规则 `.hud-hp, .hud-score, .hud-ammo { padding: 5px 8px; min-width: 88px; line-height: 1.2 }`，label 11→10px、big 17→15px（窄屏组的 17 被覆盖），HP 血条高 7→5、margin 2→1、grid 列间距 8→6。三块从 **104×56 缩到 88×42**（面积 −37%）。PC 端非 coarse 不受影响。
- **后果**：`probe-hud-size.mjs` 竖/横三块均 `88×42`；`qa-land-diag.mjs` 30/30、`qa-land-sweep.mjs` 104 组合零重叠无回归；截图目检 HP 血条/99999 与弹匣「8/∞」仍清晰无裁切。88 是 min-width 下限，QA 无敌补丁 HP=99999（5 位）实测未撑破，正常 3 位数值余量充足。

---

## ADR-25 PC 端 HUD 与手机横屏对齐（v3.11）

- **上下文**：用户要求「PC 端 HP、得分、弹夹、FPS 展示和大小与手机横屏一致」。基线实测：手机横屏三块 88×42 顶排（top60 HP left10 / SCORE right124 / 弹匣 right10）、FPS 83×36 贴返回键（top13 left62）；PC 三块仍是基础大尺寸（HP 156×77 / 弹匣 128×60 底部两角、SCORE 70×60 top20）、FPS 83×36 top20 left84。
- **决定**：新增 `@media (pointer: fine) and (min-width: 821px)` 段，复刻手机横屏那套紧凑规则（padding 5×8 / min-width 88 / line-height 1.2 / label 10 / big 15 / HP grid 血条内联）到 PC，不动任何 coarse 规则。坐标按 PC 坐标系换算：
  - 返回键 PC 50×50(top20) 底缘 70（手机 42×42 底缘 52）→ 三块顶排 `top:80`（留 10px，对应手机 top60）；HP left20 / 弹匣 right20（PC 边距体系）/ SCORE right124（与手机同值，避开右上 FAB）。
  - FPS 大小两端本就一致（83×36），仅 `top:27` 使 36 高块在 50 高返回键内垂直居中（20+(50−36)/2=27，对应手机 top13）。
  - `min-width:821px` 防御：避免无条件 fine 规则覆盖 820px 以下窄屏组的 WAVE(top62)，造成 WAVE 与三块(top80) 重叠。
- **后果**：`probe-pc-align.mjs` 实测两端三块均 88×42，PC 顶排 top80 / FPS top27，与手机横屏同构；PC 截图目检布局对齐、右上角音效/主题钮与 SCORE 不撞；`qa-land-diag.mjs` 30/30、`qa-land-sweep.mjs` 104 组合零重叠无回归。PC 端暂停钮仍为 hover 显示（`.hud-pause` 未纳入本次对齐，用户未要求）。

---

## ADR-26 修复限帧阈值导致的 90Hz 腰斩（v3.12）

- **上下文**：用户反馈「FPS 45 phone 端很卡」。CPU 剖析（`qa-profile-phone.mjs`，6s）证明非算力问题：JS 各阶段合计 <150ms/6s（update 18.7、endFrame 126.8、其余 <5），97% 时间在 `(program)`/`(idle)`；已降 0.65 分辨率、13 面、headless 实测 60fps。真机报 45 = 90Hz÷2，锁定为限帧算法缺陷。
- **根因**：`game.frame` 的跳帧判定 `now - lastPaint < 15`（为 120Hz 省电设计）对所有刷新率用固定阈值。90Hz 帧间隔 11.1ms、75Hz 13.3ms 均 <15 被逐帧误跳——真实代码驱动（`qa-refresh-rate.mjs` 假时钟）实测：60Hz→60、90Hz→45、120Hz→60、75Hz→**8.3**、144Hz→48。限帧目标 60 对非 60 的整数倍刷新率必然腰斩。
- **决定**：阈值 `15 → 8`（`cs/js/game.js` 一处数字 + 注释）。8ms 远小于最矮目标帧间隔，60/75/90/120Hz 各跑满原生刷新率（144Hz 间隔 6.9<8 跳成 72 仍流畅）。负载兜底保留 `checkPerf`（<45fps 降分辨率→Flat），不靠牺牲高刷体验换省电。
- **后果**：`qa-refresh-rate.mjs` 假时钟真驱动验证 90Hz 45→**90fps**、60Hz 保持 60；`qa-perf2d.mjs` 7/7（P2 断言口径同步改为「<8ms 跳过、90Hz 11ms 正常绘制」，P4a/P4b 降档兜底仍 PASS）；`qa-land-diag.mjs` 30/30 无回归。README 中英帧率描述同步。
- **教训**：限帧/跳帧阈值必须远小于最矮目标帧间隔；"限帧到 60"对 90/75/144Hz 屏有反效果——高刷屏应跑满原生刷新率，负载控制交给自适应降级而非一刀切限帧。

---

## ADR-27 触控 pointerId 泄漏卡死的三层防御（v3.12.1）

- **上下文**：用户反馈「方向键（摇杆）和手滑转向之间会卡死」，四种现象全选：摇杆粘住不回中、控件失灵、切另一个才恢复、画面冻结。合成 touch 序列（含 touchCancel/双指并发）全通过，说明标准 Pointer Events 路径正常，卡死源于真机上 pointerup/cancel 丢失导致 `lookId`/`joyId` 永久停在旧 ID——`onLookDown`/`onJoyDown` 的 `id !== -1` 判定把后续所有手指挡掉。
- **决定**：`cs/js/input.js` 加三层防御（元素级监听保留做即时响应）：
  1. **document 级兜底**：`pointerup`/`pointercancel` 在 document 上按 pointerId 无条件清理 lookId/joyId（冒泡必经，元素级丢失也能兜住）。
  2. **lostpointercapture**：捕获被系统转移/丢失即视为抬指，清理对应 ID。
  3. **心跳 stale 检测**：down/move 刷新 `joyBeat`/`lookBeat`，`sanitize()` 在超过 2s 无心跳时强制释放 ID 与速度（覆盖 up 彻底丢失、冒泡被吞的极端）；`game.frame` 每 0.5s 调用一次（复用 FPS 窗口）。
- **后果**：`qa-touch-fallback.mjs` 验证 document 兜底（S3/S4 真实路径 PASS；S2 合成 PointerEvent 的 pointerId 与真实 touch 不匹配属探针口径问题）；`qa-touch-stale.mjs` 3/3——pointerup 彻底丢失 2.6s 后自动归零解锁、新手指恢复；`qa-touch-lock.mjs` 7/7、`qa-perf2d.mjs` 7/7、`qa-land-diag.mjs` 30/30 全绿无回归。
- **权衡**：stale 阈值 2s——按住静止超 2s 若浏览器未发 coalesced move 会被误释放，代价仅是重新按一次，远优于永久卡死。真机若仍卡，需按实际现象继续定位（如特定 WebView 把 touch 识别为 mouse 被 `pointerType==='mouse'` 过滤）。

---

## ADR-28 布局设置横屏呈现 + 默认按钮调大内移 + FAB 仅主菜单（v3.13）

- **背景**：用户真机反馈四点——① 手机点「按钮布局·设置」时编辑器显示竖屏（设置的是横屏游戏布局，所见非所得）；② 默认摇杆偏小、太贴左下角；③ 默认开火钮偏小、太贴右下角；④ 右下角站点分享/评论 FAB 在子页面也显示、应只在主菜单出现。
- **决策**：
  1. **布局设置进入横屏**：`CS.Orientation` 暴露 `onConfig()`，在「设置」点击手势链路内（game.js touch 回调）调用 `requestLandscape()`——复用「开始任务」的全屏+锁横屏路径，但**不设 active**（不触发旋转引导/自动暂停），编辑器按横屏视口呈现。
  2. **默认按钮调大内移**（仅横屏 coarse 组，最小 diff）：摇杆 112→128px、left14→26、bottom10→24；开火 62→76px、right28→44、bottom68→84；开火变大后左缘逼近换弹/换镜列 → 跳/蹲 bottom136→164、换弹/换镜 right120→132，全分辨率零重叠。
  3. **FAB 白名单**：HUD 新增 `syncFab()`，按「menu 激活 && help 未开 && 非 is-tcfg-edit && 非旋转引导」判定，唯一维护 `body.cs-fab-off`（CSS `display:none!important`）；setScreen/showHelp/hideHelp/init 及 TouchCfg.enter/exit 均调用。保留 `cs-in-game` 作状态切换时序兜底。取代原先仅靠 cs-in-game（结算页会误恢复）的黑名单。
- **理由**：横屏请求复用既有全屏手势链路，无新权限/新 API；按钮尺寸只改 CSS 媒体查询组，不碰任何判定逻辑与 CFG 数值；FAB 白名单把「谁该显示」收敛到单一函数，避免散落在各状态切换处遗漏。
- **验证**：`qa-settings.mjs` 15/15（onConfig→全屏→锁横屏 spy、横屏视口、D1–D9 FAB 九态、按钮尺寸断言、零重叠）；`qa-land-sweep.mjs` 104/104 组合零重叠；`qa-land-diag.mjs` 30/30、`qa-touch-lock.mjs` 7/7、`qa-perf2d.mjs` 7/7 无回归。截图 `shot-menu-fab.png` / `shot-land-cfg.png` / `shot-land-buttons.png` 目检通过。

---

## ADR-29 「换镜」语义纠正为「开镜」：触控端按住瞄准（v3.14）

- **背景**：用户反馈「PC 右键能开镜，phone 端没有功能可以；换镜感觉也不对，其实是切换人称视角」。核对代码：`#btn-view`「换镜」绑定 `act('view')` → `Game.toggleView()`（FPS/TPS 切换），与 PC 右键 `aim`（减速 1.8 m/s + 散布归零）语义完全不同——按钮名不副实，且触控端确实缺少开镜入口。
- **决策**：
  1. **按钮改造**：`#btn-view`「换镜」→ `#btn-aim`「开镜」，从「点击切人称」改为「按住瞄准」——`pointerdown` 置 `aim=true` 并记 `pointerId`，`pointerup/cancel/leave` + document 全局兜底 + `lostpointercapture` 清理；与 `fireBtn` 同模式。`reset()` 清 aim 状态。
  2. **位置**：开镜钮固定在右上角暂停左侧（横屏 `right:182` → x≈504..558；竖屏 `right:174` → x≈147..201），紧挨暂停且不碰 FAB/WAVE/FPS；从右下按钮群移除（原位置空出，右下不再有该钮）。
  3. **切人称保留**：菜单「起始视角」钮 + V 键继续走 `view` action（`game.js case 'view'` 未动），仅从触控按钮上移除。帮助/副标题/暂停页文案同步（「换镜」→「开镜」/「V 视角」）。
  4. **touchcfg 同步**：控件表 `IDS`/`NAME` 的 `btn-view`→`btn-aim`（「换镜」→「开镜」），布局编辑仍可拖动该钮；靠「读当前视觉中心建档」自动适配新默认位置，无硬编码坐标。
- **理由**：命名与语义严格对齐——「开镜=瞄准」「切视角=观察工具」是两个独立功能，不应共用一个按钮。开镜不走 stale 自动释放：精瞄常需按住 >2s 且不发 pointermove，stale 会误清；抬指可靠性由全局 pointerup/cancel + lostpointercapture 保证（元素级偶发丢失时兜底），长按不会被打断。
- **验证**：`qa-aim.mjs` 19/19（换镜消失、开镜按住/抬起、右上角零重叠×2、长按 2.3s 保持、全局兜底、PC 右键无回归、V 键/菜单切人称、`aimWalk<walk`）；`qa-settings.mjs` 15/15、`qa-land-diag.mjs` 30/30（T8 断言迁移至 V 键）、`qa-land-sweep.mjs` 104/104 组合零重叠、`qa-touch-lock.mjs` 7/7、`qa-perf2d.mjs` 7/7。截图 `shot-aim-land.png` 目检开镜高亮按住态紧挨暂停。注意：旧 QA 脚本中 `btn-view` 引用已批量改 `btn-aim`（按钮 id 变更）。
- **坑**：合成 `PointerEvent` 的 `pointerId` 与 CDP 真实 touch 分配的 ID 不同，测全局兜底须先用 capture 监听记录真实 pointerId 再派发。

---

## ADR-30 左手副开火键：三指操作的双槽独立 pointerId（v3.15）

- **背景**：用户要求「phone 端左手边也添加一个开火按键在方向键的右斜上方，方便三指操作」。既有开火只有右下 `#btn-fire`，右手食指要兼顾开火与转视角/开镜；三指玩法缺一个左手独立开火入口。
- **决策**：
  1. **新增按钮**：`#touch-buttons` 内加 `#btn-fire-left`（文案「开火」），复用 `.tbtn-fire` 圆形/主色视觉。横屏 coarse 最终 `left100/bottom195`（历经 162/170 → 130/190 → 108/193 → 100/195 四轮左上微调，详见 ADR-32 / ADR-35）；竖屏 `left150/bottom130`（避开右列换弹 bottom210/高 38，初版 bottom170 曾与换弹重叠 900px²）。PC fine pointer 下随 `.touch-only` 隐藏。
  2. **开火意图从单布尔改为三槽**（`input.js`）：`mouseFiring` / `fireSlot` / `fireLeftSlot`，`syncFire()` 取三者 OR 得到对外 `firing`。通用 `bindFire(btn, slot)` 按 pointerId 绑定——同键第二指不覆盖首指、另一键抬指不动本槽；鼠标左键走独立槽，Pointer Lock 丢失只清鼠标槽。全局 `pointerup/cancel` + `lostpointercapture` 按真实 pointerId 清对应槽；`reset()` 全清。与开镜一致**不走 stale**（长按连发不误清）。
  3. **布局设置**：`touchcfg.js` 控件表 `IDS`/`NAME` 纳入 `btn-fire-left`（「左开火」），沿用「读当前视觉中心建档 + `--ts` 缩放」，重载自动应用。
  4. **文案**：帮助页移动端、中英 README 操作表补三指说明。
- **理由**：若沿用原先单个 `firing` 布尔 + 无 pointerId 的 `releaseFire`，两键只要有一个抬指就会清掉另一个的开火状态（左手按住时右手点一下即停火），三指玩法不成立——必须把「开火意图」从「按钮状态」解耦为按输入源分槽。位置只动 CSS 媒体查询，判定与 CFG 数值一律不碰。
- **验证**：`qa-fire-left.mjs` **22/22**（新建）：横竖屏定位、56 组横屏分辨率零重叠、PC 隐藏；真实触控按下/抬起、双开火同时按下后单独抬右手 `firing` 保持、按真实 pointerId 全局兜底、三指并发（`moveX<-0.5` + `firing` + `yaw` 变化）、实际弹药减少；布局设置选中/调大小/持久化/重载生效；PC 左键回归。回归 `qa-aim.mjs` 19/19、`qa-touch-lock.mjs` 7/7、`qa-land-diag.mjs` 30/30、`qa-settings.mjs` 15/15。截图 `qa-fire-left-playing.png` 目检：左手开火在摇杆右斜上方、食指可及，不遮 HUD 与右侧控件。
- **坑**：「右斜上方」按**中心点**口径断言（边缘轻微交错但零重叠仍合格）；测全局兜底须先 capture 记录 CDP 真实 pointerId，合成 PointerEvent 的 ID 与之不同。

---

## ADR-31 开镜回右下 + 点击视角块切 FPS/TPS（v3.16）

- **背景**：用户反馈两点——① 「开镜既然已经改了，就不用移到右上角了吧」：ADR-29 把「换镜」改成「开镜」时一并挪到右上角暂停左侧，如今语义已正、该位置却占了顶部一排并远离拇指操作区；② 「FPS 和 TPS 切换没了，点击左上角 FPS 可切换」：ADR-29 同时把切人称从触控按钮移除，只剩菜单「起始视角」+ V 键，触屏玩家在局内找不到切视角入口。
- **决策**：
  1. **开镜回右下**：`#btn-aim` 从右上角移回右下操作区，与换弹同列、位于其上——竖屏 `right:120/bottom:256`（换弹 `bottom:210` 上方 8px）；横屏 coarse `right:132/bottom:162`（换弹 `bottom:108` 上方 16px）。右上角只留暂停。touchcfg 控件表不变（仍可调位置/大小），靠读当前视觉中心建档自动适配新默认值。
  2. **点击左上角视角块切视角**：`.hud-view` 原在 `.hud`（`pointer-events:none`）内不可点，单独放开 `pointer-events:auto; cursor:pointer`；在 `HUD.init` 给 `el.view` 绑 `click → cb.view()`（复用菜单起始视角钮的同一回调，走 `Game.toggleView()`，含音效 + 0.6s 高亮）。
  3. **输入层白名单**：`Input.isUI()` 增加 `.hud-view`，避免 PC 上点击该块时被 `onMouseDown` 当成画布点击 → 误开火 + 触发 Pointer Lock。
- **理由**：开镜是高频战斗操作，应回到拇指可达的右下群；切视角是观察工具，与开镜解耦后需要一个局内入口——顶部视角块既显示当前模式又承担切换，语义自洽、零新增 UI。两者都复用既有回调/样式，不碰任何战斗数值与 CFG。
- **验证**：`qa-aim.mjs` **24/24**（开镜横竖屏右下定位、与换弹/开火/摇杆/HUD 零重叠、与换弹同列在其上；点击 FPS 块命中/切换/标签同步 TPS/高亮/不误开火；原按住瞄准/长按/兜底/PC 右键/V 键/菜单入口全回归）；`qa-fire-left.mjs` **22/22**、`qa-settings.mjs` **15/15**、`qa-land-diag.mjs` **30/30** 无回归。截图 `shot-aim-back-right.png`（开镜在右下、右上仅暂停）、`shot-tps-by-hud.png`（点击后 TPS 高亮 + 第三人称模型出图）目检通过。
- **坑**：开镜回右下后占用了旧 QA 探针的取样点——`qa-land-diag.mjs` 的 look-zone 中心点、`qa-fire-left.mjs` 三指并发的转向触点都落在新开镜钮上，造成假 FAIL；探针取样点已改到空白区（look-zone 取右半屏上 1/4，转向取 x400,y180）。功能本身无回归（T1/T2/T3 转向用例始终 PASS）。

---

## ADR-32 左手开火键两轮左上微调（v3.16.1）

- **背景**：用户对 ADR-30 初版（横屏 `left162/bottom170`）与首次微调（`left130/bottom190`）后仍觉得左手开火键位置偏右下，要求「再往左上来点」「再往左上角去点」，共两轮视觉微调。
- **决策**：仅改 `cs/css/style.css` 中 `.tbtn-fire-left` 横屏媒体查询定位常量，判定逻辑/CFG/其他控件一律不动。两轮落点：`162/170 → 130/190`（工程负责人执行，左移 32/上移 20）→ **`108/193`**（左移 22/上移 3）。竖屏维持 `150/130` 不动——竖屏左缘受摇杆右缘 x146、上缘受换弹 bottom210 双面夹击，安全余量近零。
- **理由（几何实测，CDP 探针量取 H=320 各控件矩形）**：HUD view `x[62,140] y[13,48.5]`、HP `x[10,98] y[60,102]`、摇杆顶缘 `y168`。`left108` 使开火左缘距 HP 右缘 10px；`bottom193` 使顶缘 y51 距 view 底缘 2.5px、底缘 y127 距摇杆顶缘 41px——零重叠且中心点判定（`x146>摇杆90`、`y89<摇杆232`）仍为右斜上方。**上移硬上限**：`bottom>193`（H=320 顶缘 y<51）即压 HUD view，故本轮以左移为主、上移为辅。
- **验证**：`qa-fire-left.mjs` 22/22（含 56 组横屏分辨率零重叠、三指并发、双开火独立槽、布局设置持久化、PC 回归）；探针脚本 `probe-fireleft.mjs`（仓库外）量取 H∈{320,344,360,375,400,480} 矩形。截图 `qa-fire-left-playing.png` 目检：开火键更贴左上、位于 HP 下方摇杆右斜上方，不遮 HUD/摇杆。
- **坑**：QA 的 B8「实际消耗弹药」在 B1–B7 连续开火后弹匣已空（ammo=0）偶发假 FAIL；脚本改为 B8 前重置 `ammo=30` 再测，功能本身无回归。
- **后续**：v3.18.2 用户仍觉离 HP 偏远，再微调至 `left100/bottom195`（详见 ADR-35）；本 ADR 保留两轮微调历史记录。

---

## ADR-33 敌我人物 MC 方块化 + 敌人持枪 + 玩家枪补枪托（v3.17）

- **背景**：用户反馈「敌我双方人物模仿 MC 中的人物，重新优化展示；另外敌人的枪械看不到；自己的枪械缺少枪尾，只有一半」。基线截图确认：2D 敌人=T 恤色柱+头块+火光、无四肢无枪；玩家 TPS=柱+头块+竖条枪；FPS 枪无枪托。
- **决策**（仅 `renderer.js` / `renderer-gl.js`，零外部资产，不改判定/数值/CFG）：
  1. **2D 人物 MC 分块**（`genBots` / `genPlayer`）：每 bot 由 2 面改为 6 面（双腿/躯干/双臂/头）+1 面枪 stub（+开火 1 面火光）；TPS 玩家 6 面 + 竖条枪。躯干半宽 0.24 让双臂露出，双臂外沿 0.25+0.07=0.32 恰卡判定盒 `BOT_HALF_W`。所有部件落在 `|u|≤0.32, y∈[0.10,1.85]`，视觉与 hitscan 彻底解耦。
  2. **脸部眼睛**：新增 `drawFaceMark(f)`，在头面 billboard 绘制后立即用 `ctx.fillRect` 叠两只暗色眼（`palette.gunDark`），`f.n!==4` 跳过近剪切面；紧跟所属面绘制使更近物体自然遮挡，**不占面池**。头面加 `mark=1/2` 标记。
  3. **敌人持枪**：2D 枪 stub 偏 `+0.28`、y[0.98,1.18]、halfW0.04、`--cs-gun-body`，画家算法 `dist=torsoDist-0.02` 防被躯干盖住；3D 每个 bot 槽挂程序化兜底枪（`(0.26,1.06,0.12)`, rotY=π, scale0.8），随 `b.facing` 转向、材质并入 `slot.mats` 随受击闪刷新；bot 枪永久走兜底（人物未立体化，不参与 glTF 替换）。
  4. **玩家枪补枪托**：2D 新增 6 个屏幕空间多边形（`GUN_STOCK/HI/LO/CHEEK/BUTT/STOCK_HOLE`，枪口 -x、y 负为上，x 最大 108），在机匣/握把之前绘制被其压住前缘；3D `makeFallbackGun` 追加 4 个枪托 Box（局部 +Z）。全部预分配、逐帧零分配；sway/lag/recoil/reload/火光常数一律不动。
  5. **3D 人偶 MC 化**（`makeMannequin`）：6 Box/72 tris，方头 0.42 m、双臂外沿 ±0.32 对齐判定盒、身高 1.76 m 贴 `BOT_Y1=1.85`。
- **理由**：MC 方块剪影是用户本轮明确的视觉取舍，取代原「7–7.5 头身写实」方向（记为**已标注风格偏移**，art-bible §2）；程序化几何遵守 CC0 零歧义裁定。方块部件全部收进原判定盒——满足「改视觉不改判定」硬约束。枪 stub 用画家算法排序而非改 3D 深度，避免碰 hitscan。
- **验证**：改造后截图 `after-2d-fps.png`/`after-2d-tps.png` 目检——敌人/玩家均为清晰 MC 方块人（含眼睛）、敌人持枪可辨、玩家枪托完整。**faceCount 实测**（`probe-facecount.mjs`，6 位置采样）：3 bot 场景峰值 **42 面**（FPS）/42（TPS），满编 5 bot + 全开火估算 67 面，均 < `MAX_FACES=80`（纠正旧文档 v3.12 残留的 13 面读数，那是 MC 改造前的历史值）。QA 全绿：`qa-fire-left` 22/22、`qa-aim` 24/24、`qa-land-diag` 30/30、`qa-settings` 15/15、`qa-perf2d` 7/7（合计 98 断言、pageerror=0）。JS 语法 `node -c` 双文件通过。
- **坑**：① 枪 stub 与躯干共面会被画家算法盖住——用 `dist=torsoDist-0.02` 微调排序（非游戏数值）；② 眼睛若独立 billboard 会穿模且吃面池——改为所属头面绘制后立即叠加；③ 双臂外沿必须卡在 0.32，躯干半宽需收窄到 0.24 才能露出四肢轮廓；④ bot 枪在主线程无 GPU 的 headless 下走 2D 兜底（`rid=tex`），3D 路径需真机 WebGL 才能目视，本轮 3D 改动仅做语法与静态核对。

---

## ADR-34 越肩第三人称重构（v3.18）

- **背景**：用户反馈「切换 TPS 第三人称，感觉看不出来是第三人称」。基线截图（`probe-tps-empty.png`）定位三处硬伤：① 玩家角色居中挡住准星；② 头面画正脸眼睛（面朝相机的公告板）→ 像照镜子、无背影代入感；③ 相机太贴（TPS_BACK 2.4、TPS_UP 0.22）、角色过大顶到准星。
- **决策**（`config.js` 常量 + `renderer.js`/`renderer-gl.js` 的 `setCamera` + `drawFaceMark`，双端逐行一致）：
  1. **越肩相机**：相机位 = 眼位 − 水平前向×BACK + 右向×SHOULDER + 上抬×UP。常量 `TPS_BACK 2.4→3.2`、`TPS_UP 0.22→0.50`、新增 `TPS_SHOULDER=0.38`、`TPS_FOCUS=7`。角色沉到画面左下、让出中央准星。
  2. **准星对齐弹道**：相机朝向不再等于玩家 yaw，而是看向「眼位 + 玩家前向×FOCUS」的聚焦点，使屏幕中心准星在 7 m（典型交战距离）与 hitscan 射线重合；以新前向重建正交基 `right=cross(up,fwd)`、`up=cross(fwd,right)` 供投影。3D 端同步用 `camera.lookAt(camPos + fwd)`。
  3. **后背读感**：`drawFaceMark` 按 `mark` 分支——敌人(mark1)保留正脸双眼；玩家 TPS(mark2)改画后脑勺头盔横条 + 护目带，不再画眼睛，消除"照镜子"感。
- **理由**：核心约束是 **hitscan 固定从眼位沿 yaw/pitch 发出、与相机位完全解耦**（game.js:366-386, ADR-2「切镜零数值收益」）——所以改相机位与朝向不影响命中、伤害、散布等任何数值。FOCUS=7 是权衡：该距离零视差，近距(3-5 m)横/纵偏差 ≤0.15 m（敌人半宽 0.32 m，可接受），比初版 FOCUS=14 的近距 0.33 m 偏差显著改善。
- **验证**：越肩几何用 `probe-tps-view.mjs` 量相机位/角色投影，经两轮调参（SHOULDER 0.52→0.38、UP 0.85→0.50、FOCUS 14→7）定稿；截图 `probe-tps-empty.png`（空旷）、`tpsfinal-tps.png`（带敌人）目检——角色左下背影、准星空出、前方敌人可见，第三人称感明确。`qa-tps-ots.mjs` **9/9**（越肩参数/相机几何/视差/准星空出/弹道命中/面生成/无异常）。全套回归 `qa-fire-left` 22/22、`qa-aim` 24/24、`qa-land-diag` 30/30、`qa-settings` 15/15、`qa-perf2d` 7/7（pageerror=0），合计 107 断言全绿。faceCount TPS 峰值 32 <80。三文件 `node -c` 语法通过。
- **坑**：① 改相机朝向后必须重建正交基（right/up），否则投影错乱；② 准星视差随距离变化，FOCUS 取常见交战距离而非最远——超远距离(>14 m)偏差回升但敌人小、影响有限；③ headless 无 GPU 仍走 2D 兜底，3D 端越肩仅做语法与算法一致性核对，真机 WebGL 目视待补；④ QA 探针勿读未暴露的内部 `camX/camZ`（只有 playerAlpha/camDist/faceCount 有 getter），改用配置常量算几何。

---

## ADR-35 左手开火键再靠 HP 微调（v3.18.2）

- **背景**：用户对 ADR-32 落点（横屏 `left108/bottom193`）仍觉得离 HP 偏远，要求「左边开火按键再往上移动一些，靠近 HP 一点」。
- **决策**：仅改 `cs/css/style.css` 横屏 coarse 媒体查询 `.tbtn-fire-left` 的坐标 `108/193 → 100/195`（左移 8 / 上移 2），尺寸 76×76、竖屏 `150/130`、判定逻辑/CFG/其他控件一律不动。
- **理由（几何实测，CDP 探针量取 H=320 各控件矩形）**：HUD view `x[62,140] y[13,48.5]`、HP `x[10,98] y[60,102]`、摇杆顶缘 `y168`。新落点开火 `x[100,176] y[49,125]`：左缘距 HP 右缘 2px、顶缘距 view 底缘 0.5px、底缘距摇杆顶缘 43px → 零重叠；中心 `x138>摇杆90`、`y87<摇杆232` → 仍为右斜上方。**上移硬极限**由 H=320 时 view 底缘锁定（余量 0.5px），故本轮以左移为主、上移 2px。
- **验证**：`qa-fire-left.mjs` **22/22**（含 56 组横屏分辨率零重叠扫描、三指并发、双开火独立槽、布局设置持久化、PC 回归）；`probe-fireleft.mjs`（仓库外）量取多分辨率矩形。截图 `shot-fireleft-up.png` 目检：更贴近左上 HP、不遮 HUD/摇杆、仍在摇杆右斜上方。
- **坑**：继续上移会压 HUD view（余量仅 0.5px），后续若还要靠 HP 只能改视图布局或缩按钮，纯平移无空间。未 commit。

---

## ADR-36 开火时枪口朝向射击方向（v3.19）

- **背景**：用户要求「射击时枪械朝向射击方向；停止射击恢复默认」，经确认为**第一人称枪**。既有 2D 视图模型枪口局部朝 -x（`MUZ(-180,-57)`）且只做 recoil 位移+缩放，枪身朝向恒定 `VM_TILT=-0.12`，开火时枪口并不指向它射击的方向——视觉与弹道脱节。3D 枪管朝 -Z（已对准射击方向），无此问题但缺抬枪反馈。
- **决策**（`config.js` + `renderer.js` / `renderer-gl.js` 的 `drawViewmodel`）：
  1. **2D 几何求解**：FPS 射击方向在屏幕空间恒为视图中心（准星 `(cssW/2,cssH/2)`）。枪口绕锚点 `(ax,ay)=(0.72W,0.85H)` 随枪身旋转 α，枪管局部 -x；令枪口射线穿过中心得 `bx·sinα − by·cosα = −MUZ_Y·vs`（`bx,by` 为中心相对锚点、`vs` 为缩放），解析解 `α=π−asin(k/R)−atan2(−by,bx)`（`k=−MUZ_Y·vs/R` 夹到 ±1），`aimGeom=α−VM_TILT` 即相对默认姿态的附加角。**5 视口验证垂距 <0.01px**（精确穿心）。
  2. **抬枪/落回**：`vm.aim` 平滑趋近 `firing ? aimGeom×VM_AIM_GAIN : 0`；开火 `VM_AIM_TAU=0.06` 快抬、停火 `VM_REST_TAU=0.16` 慢落，`|aim|<0.0002` 归零。`VM_AIM_GAIN=0.58` 控制视觉幅度——GAIN=1 精确穿心但枪身过度上扬遮准星，0.58 兼顾「朝向明确」与「不挡视线」。最终 `ctx.rotate(VM_TILT + VM_ROT·rf + vm.aim)`。
  3. **3D 等价**：枪管恒朝 -Z 已是射击方向，仅把 roll 从 `VM_TILT` 抬向 `VM_AIM_ROLL_3D=0.08`（按 `vm.aim×VM_AIM_GAIN` 插值），表达抬枪对准；与 2D 共用 TAU/GAIN 节奏。
  4. **隔离**：四常量入 CFG；`clearFx` 重置 `vm.aim`；双端暴露 `get vmAim()` 供 QA。hitscan/散布/kick/射速/相机一律不动。
- **理由**：改的是纯视图模型的屏幕旋转，与 ADR-2「切镜零数值收益」同理——弹道固定从眼位沿 yaw/pitch 发出，抬枪不影响命中。选解析解而非试凑角度，使横竖屏（抬枪角 0.56~1.31 rad）自动适配且可数学验证；GAIN 与 TAU 分离，视觉幅度与响应速度可独立调。
- **验证**：`qa-vm-aimdir.mjs` **15/15**（真实鼠标按住/抬指驱动，非赋值 getter）；几何 5 视口垂距 <0.01px、横屏角<竖屏角、朝向正确非反向；全套回归 127 断言全绿、pageerror=0；截图 `vmaim-land-idle.png`/`vmaim-land-firing.png` 目检抬枪到位。三文件 `node -c` 通过。
- **坑**：① `CS.Input.firing` 是 getter（三槽 `syncFire()` 合成），QA 必须用真实鼠标事件，赋值无效；② clearFx 断言须在停火后调用，否则下一帧开火态回填 aim 造成假 FAIL；③ headless 竖屏触发横屏引导、游戏非 playing 使 `vmAim.geom=0`，竖屏几何改由数学组覆盖；④ 3D 真机 WebGL 目视待补（headless 无 GPU）。未 commit。

---

## ADR-37 相机遮挡淡出（X-ray）：贴墙不糊屏、人物不被墙吞（v3.20）

**背景**：TPS 越肩（ADR-34）后用户实测（截图）：贴着四周围墙走时，相机被墙碰撞钳到墙前 ~0.1m（`TPS_BACK+SHOULDER` 侧向偏移把相机推向墙面），围墙内侧整面糊满半屏，把内部墙体、箱子、人物全挡住；玩家背靠内部掩体时，人物也会被「相机→玩家」线段上的墙整只吞掉。

**决策**：引入**相机遮挡淡出**，只动可见性、不动几何：
1. `world.js` 新增纯查询 `occluderMask(ax,az,bx,bz)`（线段×AABB 2D slab，返回 12 盒位掩码）与 `nearBoxes(px,pz,r)`（点到盒 2D 距离 < r 的位掩码），不碰 `rayWalls/LOS/move` 任何判定。
2. 两渲染器各挂 `wallFade[12]`（指数趋近，`XRAY_TAU=0.07` 快淡出 / `XRAY_REST_TAU=0.22` 慢恢复）：TPS 下「线段穿越 **或** 距相机 < `XRAY_PROX=1.0`」的墙淡到 `XRAY_MIN=0.16`；近距规则覆盖截图场景——该墙不在相机→玩家线段上，但在相机旁边糊屏。
3. **FPS 完全不淡出**（mask 恒 0）：避免贴墙透视看到墙后敌人的作弊口子；TPS 淡出仅作用于相机近旁，不泄露远处掩体信息。
4. 2D 画家算法透传 `wallFade[k]` 作面 alpha（含顶面）；弹孔 `drawHoles` 按所属盒同步淡出防悬浮。3D 每墙懒备克隆透明材质，淡出中切换、常态还原共享组材质（保留「按组替换资产」设计）；`clearFx` 两端复位。

**后果**：其余遮挡保持真实近挡远（QA C2/D2 断言远墙恒为 1）；相机几何与 hitscan 零改动（E3）；代价是 TPS 近墙短暂可见穿墙视差（业界标准做法，可接受）。代码注释引用本 ADR 编号。

## ADR-38 换弹/瞄准镜头圆钮化：与跳/蹲同规格圆形图标钮（v3.20.1）

**背景**：用户附大逃杀手游布局截图，要求开镜/换弹/跳/蹲按钮统一为「圆形半透明底 + 居中白图标」风格；此前开镜 68px 宽胶囊系为规避与蹲钮重叠的权宜（v3.16 注）。

**决策**：仅 `style.css`——`#btn-reload, #btn-aim` 按 ID 覆盖为 44×44 `border-radius:50%`（`.tbtn-sm` 仍被暂停文字胶囊复用，不可动整类）；图标统一 24px；**列中心不变**（竖屏 147 / 横屏 159，右移值按「中心−22」回推），同列同心与零重叠关系全部保留；竖屏开镜 bottom 285→262 收紧列间距。规避历史坑：加宽导致的蹲钮重叠（v3.16）由「窄化 + 中心不变」根除，而非再次上移错位。

**后果**：纯视觉，无 JS/几何逻辑改动；`qa-aim/fire-left/land-diag/touchcfg/settings/xray` 119 断言全绿证明重叠扫描与布局设置兼容。已知极限：竖屏左开火键与换弹垂直间距 4px（与改前持平），后续调整右列须先查此约束。

### ADR-39 MC 脸部标记的屏幕坐标符号（2026-11-17）

**背景**：用户截图反馈敌人眼睛画在躯干上而非头块内；`drawFaceMark` 自 v3.17 引入起就带此偏差（玩家后脑盔带同样下移到躯干顶部，视觉上"像衣领"未被察觉）。

**决策**：`renderer.js` `drawFaceMark` 统一改为**自面顶 `sy[3]` 向下定位**。依据：`drawBillboard` 角点 Q0/Q1=世界 y0（底）、Q2/Q3=y1（顶），投影公式 `sy = cssH/2 − focal·u/z` 使屏幕 y 反转——`sy[0]` 是面的屏幕**底**（值大）、`sy[3]` 是**顶**（值小）；旧代码误按「sy0 顶」用 `sy[0] + |hh|×k` 定位（自底向下加＝画出面外）。新增 `lastMark` getter（mark/top/bottom/y）供 QA 做确定性几何断言，替代易被墙面纹理污染的像素扫描。

**后果**：眼 48%、盔带 22%、后脑带 62% 均落在头面内（探针 top≤y≤bottom 断言通过）；仅视觉层，hitscan/判定/排序未动。**通用教训入档：屏幕坐标 y 向下，billboard 面 `sy[0]` 恒为底——凡"自顶向下 k%"的特征定位必须从 `sy[3]` 起算。**

## 风险与知识缺口

1. Pointer Lock 在部分移动浏览器不可用 → 已用 `navigator.maxTouchPoints` 检测并降级为拖拽转视角；锁被拒绝时同样退化为鼠标拖拽。
2. AudioContext 需用户手势后才能 resume → 首次「开始任务」按钮点击后才发声，符合站点惯例。
3. 无深度缓冲 → 已靠 AABB 互不相交 + y 恒定规避；若后续扩展地图需重新验证。
4. TPS 相机 0.22 m 竖直视差（见 ADR-2）为已知纯视觉限制，不影响任何数值与判定。
5. 引擎/平台知识缺口：v2 不依赖特定引擎版本；v3 起钉死 three.js **r147**（见 ADR-9）。`examples/js` 自 r148 起移除，升级需改用 ES module 或自带 loader，属待验证知识缺口，不在本轮范围内。`backdrop-filter` 为渐进增强，缺失时仅失去毛玻璃效果。
6. WebGL 上下文创建失败 / 运行中丢失 / 浏览器禁用 3D API：已由 ADR-11 三级降级链覆盖；CDP B 组（`--disable-webgl`）与 C 组（确定性 <45 fps）分别实测，回退后 Canvas 2D 仍可出图可玩、pageerror = 0。
7. T1 资产清单已闭环：主理人中转的 `cs/assets/LICENSE.md` §4.1/§4.2 为唯一有效版本（用户折中裁定：移除人物 GLB、零歧义 CC0 优先），此前含 `char_swat.glb` / `gun_ar.glb` 的旧清单整份作废。`CS.GLAssets` 已 `enabled=true`、12 个贴图槽全部填入 Poly Haven 1K JPG、`models.bot/player` 置空、`models.gun/gunTps` 均为 `gun_blaster.glb`；`opt.gltf.gun=0.42 / gunRotY=0 / gunTps=0.93 / gunTpsRotY=0` 由 CDP 用真实 vendor 的 `Box3.setFromObject()` 包围盒 + 枪械像素采样 / 目视截图实测标定（世界包围盒 `0.160 × 0.371 × 0.862 m`，长轴 Z 无需 90° 旋转）。人物项保留公告板 + 程序化几何兜底，判定盒与命中率不变；加载器只按表显式引用、不扫描 `cs/assets/`；逐项失败只跳过该项，程序化兜底仍可完整游玩。CDP A 组已实测 12 张贴图 + 2 个模型加载成功、0 失败，4 组逐组材质贴图绑定与摘除差分、FPS/TPS 枪械像素采样、人物公告板仍在、明暗主题乘色、三视口、完整通关与 pageerror=0；B 组 `--disable-webgl` 回退 Renderer2D 后仍可完整通关。剩余已知限制：① Kenney GLB 缺内嵌 `colormap`，靠 `LoadingManager.setURLModifier` 重定向到清单内已有 CC0 混凝土 basecolor（2 次重定向），若后续换成自带贴图的 GLB 应移除该 modifier；② 人物项未立体化属用户许可裁定后的知情取舍，不得包装为已达成；③ 镜像适配见风险 8；④ 交付前按实测复核 `cs/` 体积总账（ADR-11 已把预算修订为整目录 ≤ 8 MB）。`cs/assets/` 内文件与 `cs/docs/art-bible.md` 由美术方向维护，主程序不写入、改名或删除。
8. `worldRoot.scale.x = -1` 镜像世界为渲染层适配层（ADR-10）：r147 已处理负行列式下的法线与背面剔除；若后续引入自定义 shader 或后处理，必须显式处理镜像，否则会出现光照翻面。
9. 站点既有的 Font Awesome CSS 外链属样式表，不是 JS 运行时库；本轮「无 CDN 运行时库请求」红线按 JS 运行时依赖校验。若要求站点级「零外链」，需单独审批并改动公共样式引用。
10. headless SwiftShader 的 rAF 节流会把帧时间放大到 50 ms（`dt` 上限值），短窗口内样本数不足 20 不会触发 1 s 性能判定；这是产品按设计不误降级，不是降级链失效，验收须用确定性帧率驱动验证（见 ADR-11）。
