# 反恐突袭 · 美术圣经（v3 / Phase 6 视觉升级 · Lean）

> 适用：`cs/` 第 11 款游戏。渲染路线 WebGL + three.js r147 UMD（本地打包，无 CDN 运行时请求）。
> **版权红线**：「偏现实风格、参考 CS:GO」只取**视觉方向**（人体比例、战术装备剪影、枪械形制、砖/混凝土/金属材质构成、低饱和军事配色）。**绝不使用 Valve / CS:GO 专有模型、贴图、UI、商标**；`cs/assets/` 全部为**无争议 CC0** 可商用免署名资源（逐文件凭证见 `cs/assets/LICENSE.md`）。
> **用户裁定（2026-11-14）**：以「零歧义 CC0」优先，移除全部 Quaternius 来源资产（通用许可页 QAL 版本歧义）。**人物项因此未立体化**，见 §2、§6.1；此前含 `char_swat.glb` / `gun_ar.glb` 的规格整份作废。

## 1. 视觉锚点（人物 / 枪械 / 墙体三项统一）

| 维度 | 统一规格 |
|---|---|
| 比例 | 真人 7–7.5 头身、身高 **1.75 m**（沿用 `C.BOT_Y0=0.10 → BOT_Y1=1.85` 公告板判定）；枪全长 **0.78–0.85 m**；墙高 `WALL_H=3.0 m`；12 个 AABB 尺寸与判定**一律不改** |
| 配色 | 低饱和军事色：炭黑 `#2c3a4a`、枪灰 `#4a5a6e`、砖褐 `#7b6a58`、混凝土灰 `#8d8f8b`、锈金属 `#6b5a48`、沙灰地 `#9a9a93`；青蓝 `#1063a0`（玩家）/ 橙棕 `#a9530b`（Bot）仅作识别色，面积 ≤10%。双主题取色仍走 `--cs-*`（ADR-4），颜色**不得**写死在渲染热路径 |
| 材质 | 写实 = 砖 / 混凝土 / 锈蚀金属 / 水泥地面的粗糙漫反射表面；1K PBR **三通道**（base color / normal(GL) / roughness），无 displacement / AO；`metalness ≤ 0.25`、`roughness 0.65–0.9`，禁镜面塑料感 |
| 构图 | 沿用 v1 固定水平 FOV 75°、FPS↔TPS 同景双读；写实贴图替换墙面/地面色块、单一 GLB 替换枪械视图模型，**相机位、hitscan 射线、数值全不动** |
| 一致性 | 三项均须落在此表内；偏离项集中列于 §6，不散落 |

## 2. 人物规格（**MC 方块人 · 程序化几何，未用外部人物资产**）

- **资产**：**无 3D 人物模型、无新外部资产**。Bot 与 TPS 玩家用**程序化几何拼出 Minecraft 风格方块人**：2D 由多面公告板分块（`renderer.js` 的 `genBots` / `genPlayer`），3D 由 6 个 Box 人偶（`renderer-gl.js` 的 `makeMannequin`）。`ASSETS.models.bot` / `ASSETS.models.player` **仍置空**——「许可零歧义 CC0」与「立体人物」之间用户裁定不引入人物 GLB，本轮的方块化是**程序化视觉增强**，非 3D 资产化，**不包装为已达成**。
- **形制（MC 分块，v3.17）**：在 1.75 m 判定盒内分块——头（大方块，含暗色眼×2 + 鼻 + 嘴，v3.20.3 补齐五官）、躯干、双腿、双臂。2D 每 bot 6 面 + 1 面枪 stub（+开火 1 面火光），TPS 玩家 6 面 + 1 面竖条枪；3D 人偶 6 Box / 72 tris。躯干半宽收窄到 0.24 让双臂轮廓露出，双臂外沿恰卡 `BOT_HALF_W=0.32`；所有部件落在 `|u|≤0.32, y∈[0.10,1.85]` 判定盒内。判定尺寸常量 `BOT_Y0/Y1/SPLIT/HALF_W/HEAD_HALF_W` **一律未改**。识别色玩家 `--cs-player` / Bot `--cs-bot`；无阵营徽记、无第三方商标。**风格偏移**：MC 方块剪影取代原「7–7.5 头身写实」视觉方向（用户本轮明确要求），属知情取舍。
- **敌人持枪（v3.17 新增）**：2D 每 bot 加 1 面枪 stub（`s=+0.28`, y[0.98,1.18], halfW0.04, `--cs-gun-body`），靠画家算法 `dist=torsoDist-0.02` 保证不被躯干盖住；3D 每个 bot 槽挂 1 把程序化兜底枪（位置 `(0.26,1.06,0.12)`, rotY=π, scale0.8），随 `b.facing` 转向，永久走兜底（人物未立体化，bot 枪不参与 glTF 替换）。开火火光（0.04 s）保持不变。
- **朝向 / 动画**：状态机只有 `巡逻 / 停步 / 开火 / 死亡`，**禁止引入新状态或 AnimationMixer**。巡逻 = 位移沿用 `World.move`；停步 = 静止；开火 = 只触发既有枪口火光与 2D 屏幕特效；死亡 = 隐藏 / 渐隐，无骨骼 clip。
- **命中**：仍以公告板矩形为准（**ADR-5**），方块视觉与判定彻底解耦、不改判定；跳跃 / 蹲伏的 y 跟随沿用 ADR-7。切镜零数值收益（ADR-2）不变。
- **可访问性**：**不得只靠颜色区分**——方块剪影 + 轮廓描边 + 亮度差 + 受击闪 + 脸部眼/鼻/嘴共同满足色觉可辨。可访问性分级 **Basic**，UX 规格须引用本级。
- **面池预算**：2D `MAX_FACES=80` 硬上限。MC 分块后实测 3 bot 场景峰值 42 面、满编 5 bot + 全开火估算 67 面，均 <80（实测数据见 qa-smoke v3.17）。脸部眼睛用 `ctx.fillRect` 在所属头面绘制后立即叠加，**不占面池**。
- **TPS 越肩构图（v3.18）**：第三人称相机移到玩家右后上方（`TPS_BACK=3.2 / TPS_UP=0.50 / TPS_SHOULDER=0.38`），角色沉到画面左下、让出中央准星；相机看向眼位前方 `TPS_FOCUS=7 m` 聚焦点使准星与弹道在该距离重合。玩家头面在 TPS 画**后脑勺头盔带而非正脸**（背影读感）。相机位/朝向纯呈现层，hitscan 从眼位发出与其解耦，**零数值收益改变**。详见 ADR-34。

## 3. 枪械规格

- **资产**：**唯一** `gun_blaster.glb`（Kenney *Blaster Kit 2.1* / `blaster-p`，CC0 1.0，882 tris，1 材质 `colormap` + `KHR_texture_transform`）。FPS 视图模型与 TPS 持枪**统一用它**，不再有两套剪影。模型不参与任何数值与命中判定。
- **形制**：低模紧凑枪械剪影，机匣 / 枪管 / 握把 / 弹匣可辨；长轴为 **+Z**（与相机前向同向），实测 `0.160 × 0.371 × 0.862 m` → 目标 0.80 m 需 `gunTpsScale ≈ 0.93`。因 CC0 低模为科幻造型、带彩色图集，须在 init 期把 `colormap` 材质压向 `--cs-gun-dark #2c3a4a` / `--cs-gun-body #4a5a6e` 的低饱和枪械色；此为**已标注的风格偏差**（§6.2），绝不用 Valve 资产抹平。
- **FPS 视图模型**：挂 `gunPivot`，锚点沿用 `(0.72W, 0.85H)` 语义、`gunDist=0.62`。**11.3 全部动画常数不得改**：sway ±6 px×(速度/4.0) @1.6 Hz、lag 60 ms / 上限 10 px / τ=0.15 s、后坐上移 12 px + 后缩 4 px / τ=0.10 s、换弹下移 40 px + 下旋 25°（0.25 / 0.90 / 0.25 s，锁 1.4 s）、火光 0.04 s。做法是把 px/s 常数在 init 期一次性换算成 `gunPivot.position / rotation` 的系数（建议 1 px ≈ 0.0016 m，`swayX→position.x`，`12 px→position.y += 0.019`，`4 px→position.z += 0.006`，`40 px→position.y -= 0.064`，`25°→rotation.x += 0.436 rad`），逐帧只做原地赋值、零分配。视角真实上踢 `+1.2°` 仍进 hitscan 方向，**不得**因 3D 模型改动。FPS 的 `gunScale` / `gunRotY` 具体值**由 T2 实测标定**（主理人裁定，非本域拍板）。
- **TPS 持枪**：同一 `gun_blaster.glb` 挂玩家组右肩 `(+0.30 m, 1.30 m)`，随 TPS 玩家组显隐；跳跃时随 `player.y` 抬升（ADR-7）。替代 v2 的「竖条枪」表现，零数值差异，符合 ADR-2。

### 3.1 标定值（本域可定项；`CS.GLAssets`）

| 项 | 值 | 说明 |
|---|---|---|
| `opt.tile` | **1.0 m** | 按米平铺：墙面 `U=面宽/1.0`、`V=3` 次；地面 32×32 次；`RepeatWrapping` |
| `opt.yawMirror` | **-1（保持 T2 现值）** | 由 `worldRoot.scale.x=-1` 手性适配决定，与资产无关 |
| `gunTpsScale` | **≈0.93** | `gun_blaster.glb` 长轴 Z 0.862 m → 0.80 m |
| `gunTpsRotY` | **≈0** | 长轴已是 +Z，无需 90° 轴向对齐 |

> `ASSETS.models.bot` / `player` 置空；`models.gun` = `models.gunTps` = `'gun_blaster.glb'`；12 槽 4 组与 `wallGroups` 分配不变。FPS 的 `gunScale` / `gunRotY` 由 T2 实测标定。全部为 init 期一次性常量，逐帧只原地赋值（ADR-3）；运行时 `Box3().setFromObject()` 复核。

## 4. 墙体 / 地面规格（12 AABB）

`world.js RAW` 索引 0–3 = 外围围墙；4–11 = 8 块掩体；地面为 32×32 m 平面。材质分配沿用 `renderer.js` 的 `boxTex[k]` 语义（`k<4 → 砖`，否则 `k%2 ? 箱 : 混凝土`），**不新增几何**。

| 索引 | 用途 | 材质组 | base color | normal (OpenGL) | roughness |
|---|---|---|---|---|---|
| 0–3 | 外围砖墙 | brick | `tex_brick_basecolor.jpg` | `tex_brick_normal.jpg` | `tex_brick_roughness.jpg` |
| 4,6,8,10 | 混凝土掩体 | concrete | `tex_concrete_basecolor.jpg` | `tex_concrete_normal.jpg` | `tex_concrete_roughness.jpg` |
| 5,7,9,11 | 锈蚀金属箱 | metal | `tex_metal_basecolor.jpg` | `tex_metal_normal.jpg` | `tex_metal_roughness.jpg` |
| 地面 | 水泥地面 | ground | `tex_ground_basecolor.jpg` | `tex_ground_normal.jpg` | `tex_ground_roughness.jpg` |

- **UV 平铺（按米，避免拉伸）**：`tile = 1.0 m`；墙面 `U = 面宽 / 1.0`、`V = 3.0 / 1.0 = 3` 次；地面 32×32 次。`wrapS/wrapT = THREE.RepeatWrapping`，`anisotropy ≤ 4`；只改 UV，不动 AABB 顶点。
- **PBR 通道**：base color = sRGB（r147 用 `texture.encoding = THREE.sRGBEncoding`）；normal / roughness = linear（`LinearEncoding`），`roughnessMap` 读 G 通道，配 `material.roughness=1.0, metalness=0.0` 由贴图调制；`normalScale` 建议 `(0.6, 0.6)`，金属箱降到 `(0.35, 0.35)`。
- **明暗双主题降级**：写实贴图在暗色主题下须降亮度，避免「亮墙暗 HUD」割裂。仅在 init / `themeChanged` 读一次 `--cs-wall-a / --cs-floor`（ADR-4），对 `material.color` 做乘色调制：亮主题 `0xffffff`，暗主题约 `0x93a7c4`（≈0.58/0.65/0.77 系数）；禁止逐帧 `getComputedStyle`。
- **命名规范**：`tex_<组>_<通道>.jpg`、`<类别>_<形制>.glb`；全部小写 + 下划线，禁空格/中文/版本号；新增须同步 `LICENSE.md`。

## 5. 体积预算（裁定后重算，实测字节 2026-11-14）

| 文件 | 字节 | 文件 | 字节 |
|---|---:|---|---:|
| `tex_brick_basecolor.jpg` | 574,381 | `tex_metal_basecolor.jpg` | 564,932 |
| `tex_brick_normal.jpg` | 295,279 | `tex_metal_normal.jpg` | 403,156 |
| `tex_brick_roughness.jpg` | 211,093 | `tex_metal_roughness.jpg` | 135,023 |
| `tex_concrete_basecolor.jpg` | 79,320 | `tex_ground_basecolor.jpg` | 776,097 |
| `tex_concrete_normal.jpg` | 179,270 | `tex_ground_normal.jpg` | 192,757 |
| `tex_concrete_roughness.jpg` | 156,479 | `tex_ground_roughness.jpg` | 318,550 |
| `gun_blaster.glb` | 80,460 | `LICENSE.md`（清单，随编辑变动） | ≈14,000 |
| **资产合计（13 个资产文件，固定）** | **3,966,797 B ≈ 3.97 MB** | 建议上限 | 5,000,000 B |
| **`cs/assets/` 目录（含清单，14 文件）** | **≈3.98 MB** | 硬上限 | 8 MB（`cs/` 整目录实测 ≈4.96 MB） |

- 已删除：`char_swat.glb` 889,396 B、`gun_ar.glb` 98,500 B，合计 **987,896 B**；删除后 `cs/` 整目录由 ≈5.95 MB 降至 ≈4.96 MB，远低于 8 MB 硬上限。
- 若要再腾空间：优先弃 `tex_metal_normal.jpg`（403 KB，金属箱改用 concrete normal ×0.35）→ 资产降至 ≈3.56 MB。

## 6. 已知风险与降级方案

1. **人物项未立体化（已知限制 · 用户裁定）**：2026-11-14 用户以「零歧义 CC0 优先」选择折中方案，移除 Quaternius 人物 GLB；Bot 与 TPS 玩家回退公告板 + 程序化几何。这是许可确定性与视觉立体感之间的**知情取舍**，非实现遗漏，不得在交付说明中表述为「人物已 3D 化」。若后续用户批准引入明确 CC0 的真人比例人物模型，可沿 §2 的 1.75 m 对齐规格挂接，命中判定仍走公告板（ADR-5）。
2. **风格偏差（已标注）**：唯一保留的 CC0 低模枪为科幻造型、带彩色图集，与「偏现实风格」存在落差。缓释 = `colormap` 材质压向低饱和枪灰/炭黑、1K 写实墙面贴图承担主要写实度、暗主题乘色统一；**绝不用 Valve 资产抹平落差**。
3. **T2 接口挂接**：`ASSETS.enabled` 须置 `true`；12 槽 4 组与 `wallGroups` 现值已正确；`models.bot/player` 置空、`models.gun/gunTps` 均填 `gun_blaster.glb`。任一 URL 失败只跳过该项，回退程序化几何/纹理（T2 已有兜底）。填表值与标定见 `LICENSE.md` §4。
4. **加载与格式**：全部资源本地相对路径，无 CDN；`file://` 下 XHR/fetch 可能被 CORS 拦 → 须静态服务器预览。`gun_blaster.glb` 用 `KHR_texture_transform`（r147 非 module `GLTFLoader.js` 支持），内嵌 colormap 图集、无外部依赖。
5. **可访问性**：Basic 级——色觉可辨（§2）、准星/HP/弹药文本仍走 HUD DOM 可缩放，3D 化不得降低对比度；UX 规格须引用本分级。
