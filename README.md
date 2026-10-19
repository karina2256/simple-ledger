# 记账簿

Windows 本地离线记账桌面应用。数据全部存在你自己的电脑上，不联网、不上传，断网可用。

技术栈：Electron + React + TypeScript + Vite + better-sqlite3 + Tailwind CSS + ECharts + onnxruntime（本地 OCR），打包用 electron-builder。

- **只想用**：看第二节「安装与运行（给最终用户）」，双击 `release\` 里的安装包就行。
- **要改代码**：从第一节「源码安装」开始。
- **准备上架 / 发布**：看 [docs/上架与发布清单.md](docs/上架与发布清单.md)。

---

## 一、源码安装（开发者）

要求：Windows 10/11 x64，Node.js 18 以上（开发机实测 Node 24.18.0）。

```powershell
# 1. 装依赖（刻意跳过 npm 的自动编译脚本，原因见下）
npm install --ignore-scripts

# 2. 下载 Electron 运行时 + better-sqlite3 预编译二进制
npm run setup
```

`npm run setup` 做两件事：下载 Electron 运行时（直连 GitHub 失败会自动改走 npmmirror 镜像），
以及把与当前 Electron ABI 匹配的 `better_sqlite3.node` 放进 `node_modules/better-sqlite3/build/Release/`。

### 为什么不用 npm 自动编译

这台机器上只有 VS 18，node-gyp 9 认不出来，`better-sqlite3` 的源码编译会直接失败。
而 better-sqlite3 官方为每个 Electron ABI 都发布了预编译包，直接下载即可，不需要任何 C++ 工具链。
`package.json` 里 `electron` 和 `better-sqlite3` 都锁了精确版本，就是为了让 ABI 对得上，
升级这两个包时需要重新执行 `npm run setup`（先删掉旧的 `better_sqlite3.node`）。

---

## 二、安装与运行（给最终用户）

打包产物在 `release\` 目录：

| 产物 | 大小 | 用法 |
| --- | --- | --- |
| `release\daily-ledger-0.1.0-installer.msi` | 91 MB | **双击安装**，装完在桌面 / 开始菜单出现「记账簿」 |
| `release\daily-ledger-0.1.0-setup.exe` | 82 MB | 双击安装，可自选安装目录 |
| `release\daily-ledger-0.1.0-portable.exe` | 81 MB | **免安装**，双击即用，不写注册表 |
| `release\win-unpacked\记账簿.exe` | — | 解包目录，直接双击也能跑 |

装好或双击之后：首次启动会有引导页，选币种和数据目录即可开始记账。
Windows 可能提示「未知发布者」（没有代码签名），点「更多信息 → 仍要运行」。

**托盘行为**：启动后右下角出现账本图标；点窗口右上角 X **收进托盘而不是退出**，任务栏图标也一并消失；
左键单击托盘图标显示 / 隐藏窗口；右键菜单是 `打开主界面` 与 `退出`，只有点 `退出` 才真正结束进程。

---

## 三、开发命令

```powershell
npm run dev              # 开发模式：热更新 + Electron 窗口
npm run build            # 只编译到 out/
npm run typecheck        # 类型检查（主进程 + 渲染进程）
npm run selftest         # 数据层自检：增删改查、余额口径、备注配色、账户与分类归档迁移、附件策略、日历汇总与周期规则
npm run verify:upgrade   # 升级路径验证：造一个 v1 老库，跑真实迁移，检查数据完好
npm run smoke:pages      # 逐页冒烟：把构建产物跑起来，逐页检查渲染内容与渲染进程报错（含深色模式）
npm run verify:motion    # 动效验证：动画是否真的挂上、是否收在终态、减少动态效果是否生效
npm run verify:exchange  # 导入导出自检：写记录 → 导出 CSV → 再解析 → 再入库的往返一致性
npm run verify:security  # 自检：PIN 加盐哈希 / 错 PIN 必拒 / 清空即失效 + 自动备份到期与清理 + 版本号比较
npm run verify:update    # 检查更新自检：起本地 HTTP 服务，验正常 / 同版本 / 清单坏了 / 连不上 / 未配置
npm run verify:ocr       # 截图识别实测：拿真实账单截图跑「识别 → 版面 → 解析 → 逐日核对」
npm run setup:ocr        # 下载 PP-OCRv4 模型到 resources/ocr（约 15MB；仓库里不带模型，打包前跑一次）
npm run shots            # 逐页截图到 docs/screenshots（浅色 + 深色 + 动效证据图）
npm run seed:demo        # 写入一份示例数据（最近 12 个月，约 160 笔；幂等，可选）
npm run icons            # 重新生成应用图标与托盘图标
npm run site             # 本地预览官网（零依赖静态服务器，默认 http://127.0.0.1:5173）
npm run verify:site      # 官网自检：SEO 元素、链接、资源、图片比例、体积（35 项）
npm run course           # 生成教学讲义 PDF（Markdown → HTML → PDF，用项目自带的 Electron 打印）
npm run verify:course    # 讲义自检：重新生成并逐份检查页数 / 内嵌字体 / 六段结构（124 项）
```

验证脚本都使用 `.tmp/` 下的临时数据目录，不影响你正在用的数据；只有 `seed:demo` 是往当前数据目录写示例数据。

最近一次结果：`selftest` **88/88**，`verify:upgrade` **21/21**，`smoke:pages` **18/18**（含汇总图表、搜索、预算、回收站、截图记账），
`verify:motion` **34/34**，`verify:exchange` **37/37**（含 xlsx 容器外部可解），`verify:security` **32/32**，
`verify:update` **11/11**，`verify:billshot` **32/32**，`verify:site` **35/35**，`verify:course` **124/124**，
`verify:packaged` **19/19**（拿 `release\` 里的 exe 真跑，含托盘、重启后数据仍在、版本号与 ProductVersion 一致）。

---

## 三之二、教学讲义（24 讲）

`course\` 目录里是一套面向零基础的 PDF 网课讲义，**以本项目为教材**，从"会用终端"一路讲到"能独立做一个自己的软件"。

```powershell
npm run course          # 生成 PDF 到 course/pdf（25 份：总纲 + 24 讲）
npm run verify:course   # 自检：页数、内嵌字体、六段结构、正文长度
```

**7 个模块 · 24 讲 · 每讲 40 分钟**（阅读 + 动手）：热身 → 程序是什么 → 项目骨架 → 会读代码 → 会改代码 →
质量与安全 → 打包发布 → 独立造东西。每讲固定六段：本节目标 / 概念（现实比喻）/ 在项目里看真实文件 /
动手任务 / 自测题 / 术语表。

撰写方式是 `course\lessons\*.md`（Markdown），流水线自建且零新依赖：Markdown → 排版 HTML → Electron `printToPDF`。

---

## 四、打包

```powershell
npm run build:win         # 编译 + 出 nsis / msi / portable 三个包，输出到 release/
npm run verify:packaged   # 拿 release\ 里的 exe 真跑一遍：托盘 + 写入 + 重启读回 + 免安装版启动
```

打包配置在 `electron-builder.yml`，三个关键点：

| 配置 | 原因 |
| --- | --- |
| `npmRebuild: false` | 本机没有可用的 MSVC 工具链，better-sqlite3 不能重新编译，用已按 Electron ABI 预编译好的 `.node` |
| `asarUnpack: node_modules/better-sqlite3/**` | 原生模块必须解包到 asar 外，否则运行时 require 不进来 |
| `electronDist: node_modules/electron/dist` | 直接用本地已下载的 Electron，不再拉一次 100MB |

工具链（winCodeSign / wix / nsis）默认走 npmmirror 镜像，直连 GitHub 会超时；
可用环境变量 `ELECTRON_BUILDER_BINARIES_MIRROR` 覆盖。

> 升级 Electron 或 better-sqlite3 时，要删掉 `node_modules/better-sqlite3/build/Release/better_sqlite3.node`
> 并重新执行 `npm run setup`，否则 ABI 会对不上。

### 分享给别人

`分享包\` 目录是给非开发者的分发件，由 `release\` 里的产物整理而成：

| 内容 | 说明 |
| --- | --- |
| `分享包\记账簿-0.1.0\` | 文件夹：三个安装包 + `使用说明.txt`（UTF-8 BOM，记事本直接看） |
| `分享包\记账簿-0.1.0-完整版.zip` | 254 MB，上面这个文件夹的压缩包 |
| `分享包\记账簿-0.1.0-免安装轻量版.zip` | 81 MB，只含免安装版 exe + 使用说明，适合直接发人 |

两个压缩包都验证过：解压 → 双击免安装版 → 托盘行为 9/9 通过。

---

## 五、账户、分类与记录的删除规则

### 账户与分类（同一套规则）

| 情况 | 结果 |
| --- | --- |
| 余额 / 记录为 0，且没有关联记录、周期规则、子分类 | 允许**真删除**，不可恢复 |
| 其它情况 | 弹窗二选一：**仅归档**，或**迁移到其它账户 / 分类并归档** |

归档（`accounts.is_archived`、`categories.is_archived`）：

- 归档后不再出现在新增 / 编辑记录的下拉与筛选中；
- 历史记录仍然显示它的名字和金额，余额 / 汇总口径不变；
- 一级分类归档时，它下面的子分类一并归档；
- 「设置 → 已归档账户」与「分类页底部 → 已归档分类」可以查看并恢复。

迁移并归档在一个事务里完成：

1. 源账户名下的 `records.account_id` / `records.to_account_id` 全部指向目标账户；
2. `recurring.account_id` / `recurring.to_account_id` 一并迁移；
3. 源账户的初始余额并入目标账户的初始余额（否则合并后总余额会少一截）；
4. 原本发生在源账户与目标账户之间的转账，合并后会变成「自己转自己」，
   这类记录**软删除**（留在库里可恢复，不参与余额计算），目标账户因此不会被凭空扣钱；
5. 变成自己转自己的周期规则自动停用；
6. 源账户置为归档。

分类迁移：该分类（含子分类）下的记录改挂到目标分类，相关预算一并迁移；目标上已有同周期预算时保留目标那条；
源分类整棵子树随后归档。迁移只允许在同类型（收入↔收入、支出↔支出）之间进行。

> `budgets` 表按分类而不是按账户，所以账户迁移不涉及预算；分类迁移会带上预算。

### 记录

| 操作 | 附件行为 |
| --- | --- |
| 删除（移到回收站） | 记录软删除，可撤销；**物理附件不动** |
| 撤销删除 | 记录恢复，附件一直都在 |
| 彻底删除 | 记录行从数据库移除；弹窗询问是否同时删除收据文件，**默认不勾选（保留文件）** |

---

## 六、数据位置

| 内容 | 位置 |
| --- | --- |
| 引导文件 | `%APPDATA%\daily-ledger\config.json`（记录数据目录，独立于数据库） |
| 数据库 | `<你选的数据目录>\daily-ledger.db`（另有 `.db-wal` / `.db-shm`，SQLite 日志文件，属正常） |
| 收据附件 | `<数据目录>\attachments\年\月\<uuid>.<扩展名>` |
| 备份 | `<数据目录>\backup\daily-ledger-YYYYMMDD-HHmmss.db` |

数据目录在首次启动引导里选择，之后可以在「设置 → 数据」里查看和打开。

**手动恢复备份**：先完全退出应用（确认托盘/任务栏里没有进程），把备份文件复制成
`daily-ledger.db` 覆盖原文件，并删掉同目录下的 `daily-ledger.db-wal` 与 `daily-ledger.db-shm`，
再启动应用。

写入策略：`journal_mode=WAL` + `synchronous=FULL`，每次事务提交都会 fsync 到磁盘；
启动时会跑一次 `PRAGMA quick_check`，数据库损坏时会弹窗给出数据目录与备份目录路径。

---

## 七、日历与周期记账

**四级视图**：年 → 月 → 周 → 日，状态写在地址里（`#/calendar?view=month&date=2026-09-26`），
刷新、浏览器返回、面包屑跳转都一致。每一级都显示收入 / 支出 / 净变化，转账不计入收支。

| 视图 | 内容 | 进入下一级 |
| --- | --- | --- |
| 年 | 12 个月格 + 全年合计 | 点月格 → 月视图 |
| 月 | 日历格 + 左侧周序号列，补位日期照常显示真实数据 | 点日期 → 日视图；点「第 N 周」→ 周视图 |
| 周 | 7 天列，列内是该日流水（超过 6 条折叠） | 点日期 → 日视图 |
| 日 | 当天全部记录 | — |

想在某天记一笔：月视图格子悬停点「＋」、周视图列头「＋」、日视图「＋ 记一笔」，表单日期会自动预填成那天。

**周期记账**：默认**只做标记，不自动生成记录**。规则在「周期记账」页维护（新增 / 编辑 / 启停 / 删除），
标记 `⟳` 会出现在年视图月格、月视图日期格、周视图列头、日视图记录上方四处。

发生点的推算口径：

- 第 k 次发生从 `start_date` 直接算，不依赖上一次结果 → 「1 月 31 日」的月租在 2 月落 2/28，3 月回到 3/31；
- `end_date` 为空表示长期有效，到期后不再标记；
- `next_date` 只是「下次记账」的显示缓存，**不参与**标记计算，避免它过期后标记凭空消失。

**示例数据（可选）**：`npm run seed:demo` 会往当前数据目录写最近 12 个月的示例记录与两条周期规则，
用固定随机种子生成、只写一次。不想要示例数据就别执行这条命令。

**截图**：`npm run shots` 生成 `docs/screenshots/`，含浅色 10 张与深色日历 4 张；`npm run verify:motion` 另留 4 张动效证据图。

---

## 八、动效

动效是**零依赖**的：不引 framer-motion / GSAP / Lottie，全部靠 Chromium 132 的原生能力（`linear()` 弹簧曲线、`animation-timeline: view()/scroll()`、`::view-transition-*`、`backdrop-filter`）。

### 三档强度（设置 → 动效）

| 档位 | 内容 |
| --- | --- |
| **炫技（默认）** | 环境渐变 + 毛玻璃 + 滚动揭示 + 英雄区钉住 + 3D 倾斜高光 + View Transition 转场 + 主题圆形擦除 + 弹簧数字 + 粒子庆祝 |
| 标准 | 只保留基础过渡：时长与缓动统一、无位移特效、无背景虚化、无渐变层 |
| 极简 | 几乎不动，等同系统「减少动态效果」，适合录屏或低配机器 |

档位写在 `<html data-motion>` 上，CSS 侧全靠它决定开哪一层；`prefers-reduced-motion: reduce` **永远优先**于档位设置。

### 炫技档用了什么

| 效果 | 实现手段 |
| --- | --- |
| 环境渐变（活的底色） | 3 个 `blur(72px)` 径向渐变色斑，26/32/38s 缓慢漂移 + 反向滚动视差 |
| 毛玻璃 | 侧栏 / 顶栏 / 卡片 / 弹窗 / 提示条都用 `backdrop-filter: blur(22px) saturate(180%)` + `color-mix()` 半透明底 + 顶部内高光 |
| 卡片滚动揭示 | `animation-timeline: view()`：进视口时「上浮 34px + 缩放 0.93 + 去 9px 模糊」 |
| 英雄区钉住 | 汇总卡片 `position: sticky`，用 `scroll()` 时间线在 240px 内缩到 0.94 并虚化，同时垫一层毛玻璃 HUD |
| 滚动进度条 | 顶部 3px 渐变条，`transform: scaleX()` 直接绑滚动进度（静止时为 0，不活跃时间线也不露出） |
| 路由转场 | `document.startViewTransition` + `flushSync` 提交路由状态；旧页缩到 0.965 并虚化，新页从 1.035 弹回来 |
| 标题 morph | 各页 `<h1>` 带 `view-transition-name: page-title`，换页时标题是同一个元素在动，不是各自出现 |
| 主题圆形擦除 | 从主题按钮坐标发出 `clip-path: circle()`，640ms 扩散到全屏 |
| 卡片 3D 倾斜 + 高光 | 指针位置写进 `--tilt-x/--tilt-y/--mx/--my`，`perspective(1000px)` 倾斜 + 跟随光标的高光 |
| 弹簧数字 | 金额逐帧滚动改用弹簧采样（7.5% 过冲再回落），变化瞬间叠一个缩放冲击波 |
| 粒子庆祝 | 记账成功时 12 颗粒子沿圆周飞出 + 一圈扩散光环 + 描线对勾 |
| 弹窗 = iOS sheet | 从下方 9% 弹入、缩放 0.86 → 过冲到 1.03 再收住，背景整体虚化 |
| 吊起 / 高光扫过 | 按钮按下缩到 0.93、悬停上浮 + 阴影、主按钮有斜向高光扫过与发光 |

### 弹簧曲线是算出来的，不是抄的

`--x-soft / --x-snappy / --x-bouncy` 三条 `linear()` 曲线由**阻尼弹簧方程**采样生成（峰值分别 1.00 / 1.075 / 1.227），不是随手填的贝塞尔。JS 侧的金额滚动用同一张采样表，所以「数字回弹」和「CSS 回弹」手感一致。

### 怎么改 / 怎么关

- **改时长、曲线、光斑颜色**：只改 `src/renderer/src/styles/cinematic.css` 里的 `--x-*` / `--ambient-*` 变量。
- **加减某个效果**：组件上就是 `cinema-*` 类名（`cinema-reveal` / `cinema-tilt` / `cinema-glass` / `cinema-hero` …），删类名即回退。
- **整层关掉**：设置里降到「标准」；或删掉 `main.tsx` 里对 `styles/cinematic.css` 的 import。
- **踩过的坑**：`<tr>` 上**不能**加 `position: relative` 或 `::before`——Chromium 会因此把表格列宽算歪（实测日期列 112px → 96px、行高 42px → 61px），侧条改用 `inset box-shadow`。

### 验证

`npm run verify:motion` —— **34/34**，靠主进程注入的探针（`src/main/motion-probe.ts`）分 9 步断言：动画是否真的挂上、是否都收在终态（不卡半透明）、`view()`/`scroll()` 时间线是否真的接上（看 `ViewTimeline`/`ScrollTimeline` 类型而不是眼睛）、View Transition 是否真的被调用、弹簧是否真的越过目标再回落、粒子数量、减少动态效果是否把时长压到 0。

探针会真在临时数据目录里记一笔 12.34 元，并把 4 张证据图写进 `docs/screenshots/motion-*.png`（弹窗进场 / 校验失败 / 记账成功 / 滚动到英雄区钉住）。

口径取舍、弹簧推导、逐条踩坑记录都在 [docs/动效-报告.md](docs/动效-报告.md)。

---

## 九、数据、报表与发布相关能力

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| **导出 Excel / CSV** | 设置 → 导入 / 导出 | 可选本月 / 今年 / 全部。**Excel**（.xlsx，自写最小写出器，金额是数值单元格可直接求和、表头加粗）；**CSV**（带 UTF-8 BOM，任何记账软件都能读）。金额按元、类型写中文 |
| **导入 CSV** | 设置 → 导入 / 导出 | 先解析成表格给你核对，**确认后才写库**；重复行默认不勾；分类名不存在时可勾选「自动新建分类」；账户匹配不上落到默认账户。只收 CSV：xlsx 要解析共享字符串与日期序列号，风险大一个量级，而所有记账软件都能导出 CSV |
| **汇总统计** | 左侧「汇总」 | 本月 / 近 3 个月 / 今年 / 全部；四张概览卡 + 年度月度趋势折线 + 支出/收入构成饼图 + 单笔极值与日均；转账不计入收支 |
| **预算** | 左侧「预算」 | 按一级分类或「总预算」设月度 / 年度额度；进度条三档配色（<80% 主色 / 80–100% 警示 / 超支红）；同一分类同周期只允许一条 |
| **搜索** | 左侧「搜索」 | 关键词 + 日期区间 + 类型 + 账户 + 一/二级分类 + 金额档位组合筛选，改条件自动查询（300ms 防抖） |
| **回收站** | 左侧「回收站」 | 集中查看已删除记录；恢复 / 彻底删除 / 清空；彻底删除时**默认保留**收据图片，要删得自己勾 |
| **自动备份** | 设置 → 数据 | 关闭 / 每天 / 每周，启动时检查是否到期；保留份数可选 3–30；另有「立即备份」 |
| **便携版数据隔离** | 自动 | 免安装版把引导文件与默认数据目录放在 **exe 同级**，不会和系统里安装版的数据混在一起；exe 目录不可写时自动退回 `%APPDATA%` |
| **首次引导可选起点** | 首次启动 | 「预设模板」（2 账户 + 55 分类）或「从空白开始」（只建一个「现金」账户）；界面明写「这是全新账本，没有任何历史记录」 |
| **全局快捷键** | 自动 | `Ctrl+N` 新增记录、`Ctrl+F` 搜索、`Ctrl+D` 切主题；可在设置里改成别的组合（这次是真的接上了监听，之前只是显示） |
| **应用锁** | 设置 → 安全 | 4–32 位 PIN（主进程 scrypt 加盐哈希，渲染进程拿不到 PIN）；可设启动锁定、可立即锁定；连错 5 次进 10 秒冷却 |
| **界面字号** | 设置 → 动效 | 小 / 默认 / 大；改的是 html 根字号，Tailwind 的 rem 会带着整站等比缩放（**默认档必须是 16px**，写成 14px 会把表格列宽行高一起缩水——这个坑被动效探针抓住了） |
| **检查更新** | 设置 → 关于 | 读一个静态 JSON 清单比对版本号，有新版本给下载链接；不配清单地址会明确提示「未配置」，**不做静默自动升级** |
| **记账币种口径** | 设置 → 币种 | 说清楚了：只有「记账币种」+「附带显示折算金额」，不是多币种账户，折算不参与汇总、不改历史金额 |

---

## 十、目录结构

```
src/
├─ main/        主进程：窗口、IPC、SQLite、迁移、备份、附件、OCR、各类探针
├─ preload/     contextBridge 暴露的白名单 API（window.api）
├─ shared/      主进程与渲染进程共用：类型、IPC 契约、常量、金额/日期工具、CSV 与账单解析
└─ renderer/    React 界面
   ├─ motion/   动效基础模块：系统偏好、弹簧数字、错峰、抖动、3D 倾斜、View Transition
   └─ styles/   index.css 基础动效层（--m-*）+ cinematic.css 炫技层（--x-* / 环境渐变 / 毛玻璃 / 转场）
resources/
├─ icons/       应用与托盘图标（由 scripts/make-icons.mjs 生成）
└─ ocr/models/  PP-OCRv4 模型（npm run setup:ocr 下载；打包时随包发）
scripts/        setup / selftest / 各类 verify-* 验证脚本
docs/           每轮的方案与报告、上架与发布清单
```

安全边界：渲染进程 `contextIsolation: true`、`nodeIntegration: false`，拿不到任何 Node 能力，
只能调 `window.api` 里列出的方法；数据库只有主进程能碰。
收据图片通过主进程注册的 `ledger://` 协议读取，且限制在数据目录内，越界访问直接 403。
