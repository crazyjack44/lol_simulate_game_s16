---
feature: s16-worlds-game
status: delivered
updated: 2026-09-25
branch: feature/s16-worlds-game
commits: e33e39d..c2b7909
---

# S16 全球总决赛 · 策略对决（网页小游戏）

## Report

**What was built** — 在 `s16lolgaming` 按 DEVELOPMENT.md 全新重写纯前端 S16 全球总决赛策略对决网页游戏：打开 `index.html` 即可从说明书进入选队（真实 16 队五路名单 + 队伍雷达 + 选手照片/队标），经积分赛→八强→半决赛→决赛→冠军加冕完整赛程。战前仅决策阵容体系（meta/signature/offmeta）与团战风格（四风格克制环）；对局由六因子 softmax 预测事件并程序抽取，触发团战 Canvas 动画与选手 ID 级击杀播报。

数据与素材全部本地化：选手图/队标/英雄图标拷贝至 `assets/`，`scripts/extract_roster.py` 从 lol-radar-titan 最新赛段（LPL Split 3 / LCK Rounds 3-4 / LEC·LCS Summer）生成 `js/roster.js`（T1 五路为 Doran/Oner/Faker/Peyz/Keria）。独立 Review 发现的三项关键问题（红方对阵配置、击杀 feed 重复死亡、`gadget` 风格越界）已修复并复审通过。

**Verification** — `node smoke.js` ALL PASS（含 200 场团战击杀不重复、T1 名单、克制环、概率归一化）；`node check-dom.js` ALL PASS（屏幕/脚本顺序/DOM id）；`node smoke-dom.js` ALL PASS（选队→战前→赛果→冠军全流程 + 素材路径存在）；Node 全届赛事模拟可决出冠军。浏览器视觉与手感未在本环境实机点击验证，属 T9 手工清单残留。

**Journey log** — 1) 真实 S16 名单与指南示例名单不一致，按用户选择以 rosters.json 为准，13 队 + LYON/FLY/SR 补位。2) 首版 roster 匹配把 row 当 id 导致全员 fallback，改为按 season_l1 扫描 + 精确/前缀匹配后对齐。3) Review 指出红方 `startAutoMatch` 接错队伍对象——凡「玩家非蓝方」分支必须同时修正 lineup 与 style 两侧。4) `buildKillFeed` 在 totalKills>5 时必然重复死者，改为一命一人并回写 kills 计数。5) 静态 style `gadget` 不在克制环内会静默失去风格系数，用 `normalizeStyle` 归一到四风格。

## [S1] Problem

玩家需要一款可离线打开的 S16 全球总决赛网页小游戏：执教 16 支真实参赛战队之一，经历积分赛→八强→半决赛→决赛→加冕，用赛前阵容/风格决策影响程序推演的战局，并用真实选手名单、雷达数据与视觉素材建立可信度。

现有 `lol/` 工程已有一版实现，但本工程 `s16lolgaming` 要求**按开发指南全新重写**，并对齐真实 S16 名单与全量素材（选手图、战队 logo、英雄图标），而不是指南里的示例名单。

## [S2] Design

### 2.1 产品与技术约束

- 纯前端：HTML + CSS + 原生 JavaScript，无构建步骤，打开 `index.html` 即玩。
- 不依赖 CDN / 网络；素材全部本地拷贝到 `assets/`。
- 命名空间 `window.S16`；脚本加载顺序：`roster.js` → `data.js` → `radar.js` → `engine.js` → `anim.js` → `game.js`。
- 浏览器需支持 ES2020。
- 内部工程根：`C:\Users\14208\XiaomiMiMoProjects\s16lolgaming`。

### 2.2 视觉方向（签名时刻）

- **风格锚点**：LoL Worlds 转播 HUD × 电竞经理策略台——深空底、金色描边斜切面板、红蓝方高饱和对位。
- **色板**：`--bg #0b0e14` / `--panel #151c28` / `--gold #c8aa6e` / `--gold-hi #f0e6d2` / `--blue #0ac8b9` / `--red #e84057`。
- **字体**：`Segoe UI, PingFang SC, Microsoft YaHei, sans-serif`；标题 28–40px/600，正文 14–16px/400，数据 12px mono 风格数字。
- **布局**：顶栏 + 单屏切换；卡片网格 8px 节奏；对阵/对位用左右对称双栏。
- **签名时刻 1**：选队/对位的五路选手照片墙 + 双队雷达叠图。
- **签名时刻 2**：小龙/大龙团 Canvas 动画，单位头像+选手 ID，死亡播报与 skill 闪屏。

### 2.3 文件结构

```text
s16lolgaming/
├── index.html
├── css/style.css
├── js/
│   ├── roster.js          # 生成物：真实名单+雷达（scripts/extract_roster.py）
│   ├── data.js            # 队伍静态配置、阵容、风格、事件、文案
│   ├── radar.js           # 雷达绘制 API
│   ├── engine.js          # 预测、模拟、击杀 feed
│   ├── anim.js            # 团战 Canvas 动画
│   └── game.js            # 流程与 UI
├── assets/
│   ├── players/           # S16 选手图
│   ├── teams/             # 战队 logo
│   └── champions/         # 英雄图标
├── scripts/extract_roster.py
├── data/rosters.json      # 自 worlds_s16 拷贝的名单源
├── smoke.js
└── check-dom.js
```

### 2.4 数据契约

**战队（16 支）**

| 来源 | 队伍 |
| --- | --- |
| `rosters.json` 确认 13 队 | GEN, HLE, T1, DK, AL, BLG, TES, iG, TL, C9, G2, KOI, KC |
| 待定席位补全 3 队 | LYON, FLY(FlyQuest), SR(Sentinels) — 取 LCS-2026-Summer 真实雷达；无选手图则用队标+色块头像 |

位置代码统一为 `top/jng/mid/bot/sup`（源数据 `jgl`→`jng`）。

**roster.js 生成物字段（每队）**

```js
{
  id, name, short, region, color, note, style, signature, heroes,
  logo: "assets/teams/...",
  roster: [{ pos, id, name, photo, radar: {label:value}, textScore, source }],
  teamRadar: { label: value },   // 8 维队伍雷达
  radarPower,                    // 0-100
  dataSource, season
}
```

**战力映射（与指南一致）**

```text
power = clamp(70, 96, radarPower + (静态power-85)*0.15)
```

**雷达数据源（最新赛段）**

| 赛区 | season |
| --- | --- |
| LPL | LPL-2026-Split_3 |
| LCK | LCK-2026-Rounds_3-4 |
| LEC | LEC-2026-Summer |
| LCS | LCS-2026-Summer |

选手 JSON：`lol-radar-titan/web/data/season_l1/<season>/player/*.json` 的 `dimensions[].label/value`。  
队伍 JSON：同目录 `team/*.json`。  
抽取匹配：规范化全名精确 → startswith 且长度≥3；禁止宽松 includes（防 `gam`/`gen` 误配）。  
缺数队伍用 `fallback_roster()` 印象阵容，`source: "fallback impression"`。

**素材映射**

| 类型 | 源 | 目标 |
| --- | --- | --- |
| 选手图 | `worlds_s16/<Player>.png/.jpg` | `assets/players/` |
| 战队 logo | `lol_web/assets/teams/<REGION>__<Name>.png` | `assets/teams/` |
| 英雄图标 | `lol_web/assets/champion_icons/<Name>_<id>.png` | `assets/champions/` |

英雄图标用于阵容体系展示与团战单位；文件名按 `data.js` 英雄池映射到 champion id。

### 2.5 玩法系统（对齐 DEVELOPMENT.md）

1. **屏幕流**：doc → pick → hub → prep → battle → result → champion。
2. **赛制**：积分赛 8×BO1 → 八强 1v8/4v5/2v7/3v6 → 半决赛 → 决赛 → 冠军。
3. **战前**：三选一阵容（meta/signature/offmeta）+ 四风格循环克制（engage→protect→teamfight→split→engage）。
4. **引擎**：`predictEvents` 六因子（phase/style/economy/power/momentum/vs）→ softmax(temp=1.15) → `sample` 抽取事件；事件自然克制环（early: invade>lane>ambush>invade；dragon/baron: rush>wrap>camp>rush）。
5. **团战**：条件触发 → `simulateTeamfight` + `autoSkillCast` → `buildKillFeed`（真实选手 ID 级播报）→ Canvas 动画。
6. **胜负**：

```text
final = base * eco * styleEdge * rand(0.97,1.03) * (1 + kills*0.012)
score = final + kills*1.8 + objs*2.5
```

7. **UI 可解释性**：预测 Top3 概率条 + 六因子数值 + 实际抽取对照；击杀 feed 与团战死亡日志。

### 2.6 对外 API

```js
S16.Engine = {
  rand, pick, clamp, softmax, sample,
  resolveLineup, styleEdge, counterEdge,
  predictEvents, simulateMatch, simulateTeamfight,
  autoSkillCast, buildKillFeed, autoPicks, autoLineup, drawGroupStage
}
S16.Radar.drawRadar / roleMiniBars
S16.TeamfightAnim
S16.Game = { state, bind, show }
S16.applyRoster()
```

### 2.7 验证边界

- `node smoke.js`：克制环、预测归一化、自动对局、抽签、killFeed 不重复死者、真实五路名单抽查（T1=Doran/Oner/Faker/Peyz/Keria）。
- `node check-dom.js`：game.js 动态按钮白名单 + DOM id 对齐。
- 手工：选队雷达、预测面板、击杀文案、团战单位选手名、完整赛事路径、刷新回说明书。

## [S3] Out of Scope

- 构建工具 / 框架 / CDN / 网络请求。
- 完整 Ban/Pick、玩家事件卡、手动技能、装备经济面板（按指南并入系数）。
- BO3 淘汰、逐步交互式 `nextStep()` 引擎、Three.js 沙盘（记入后续迭代）。
- 与 Riot 官方数据/资源授权；队名选手仅作演示。
- 修改外部 `lol-radar-titan` / `lol_web` 源目录（只读抽取）。

## Tasks

- [x] T1: 素材与数据落盘 — 拷贝选手图/队标/英雄图标/rosters.json 到 `assets/` 与 `data/`，校验尺寸与命名 (covers: S2.4)
- [x] T2: roster 抽取脚本 — `scripts/extract_roster.py` 从 season_l1 最新赛段生成 `js/roster.js`，13+3 队、五路与队伍雷达、power 映射 (covers: S2.4)
- [x] T3: data.js 静态层 — 真实 16 队配置、LINEUPS/STYLES/PHASES/HERO_SKILLS/NARRATIVE、素材路径、applyRoster (covers: S2.4, S2.5)
- [x] T4: radar.js + style.css + index.html 骨架 — 设计 token、七屏 DOM、雷达绘制 API、选手卡/对阵布局 (covers: S2.2, S2.3, S2.5)
- [x] T5: engine.js — 预测/模拟/团战/击杀 feed/抽签/自动 AI，导出 §2.6 API (covers: S2.5, S2.6)
- [x] T6: anim.js 团战动画 — 单位头像+选手名、弹道粒子、死亡日志、onLog/onDone (covers: S2.2, S2.5)
- [x] T7: game.js 流程 — 选队/Hub/战前/回放式观战/赛果/冠军，快速模拟与阶段推进 (covers: S2.5)
- [x] T8: smoke.js + check-dom.js — 引擎回归与 DOM 对齐，全部通过 (covers: S2.7)
- [ ] T9: 端到端验收 — 手工清单走通 + 抽查真实名单/雷达/素材显示 (covers: S2.4, S2.7) — 自动化路径已过；浏览器实机点击清单待人工
