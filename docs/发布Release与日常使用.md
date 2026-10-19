# 发布 Release 与日常使用

这一份解决两件事：**怎么把安装包发布到 GitHub**，以及**日常怎么用 git**。

---

## 一、日常使用（第 3 件事）—— 就三句

```powershell
cd "C:\Users\34123\Desktop\记账簿"
git add -A                              # 把所有改动加入待提交
git commit -m "改了什么的简短说明"        # 拍一张快照
git push                                # 推到 GitHub
```

**你现在仓库的状态**（截至本文写作时）：

| 项 | 值 |
| --- | --- |
| 远程仓库 | `https://github.com/karina2256/simple-ledger` |
| 分支 | `master` |
| 已推送提交 | 3 个（初始提交 → 上传手册 → 讲义更新） |
| 本地与远程 | 完全一致 |

### 只有 6 条命令要记

| 命令 | 干什么 | 什么时候用 |
| --- | --- | --- |
| `git status` | 看哪些文件改了 | 每次开工前 |
| `git diff` | 看具体改了哪几行 | 想确认自己改了什么 |
| `git restore 文件名` | 把某个文件还原到上次提交 | **改坏了** |
| `git add -A` + `git commit -m "..."` | 保存一个快照 | 写完一个功能 |
| `git push` | 备份到 GitHub | 一天结束 |
| `git log --oneline` | 看历史 | 想回顾 / 找某个版本 |

### 什么时候该提交

**"能跑通就提交一次"是个好习惯。**

| 时机 | 提交信息怎么写 |
| --- | --- |
| 加完一个功能 | `feat: 给记录列表加净额列` |
| 修完一个 bug | `fix: 删除记录后回收站刷新不出来` |
| 只改文档 | `docs: 补充安装说明` |
| 只改样式 | `style: 调深色模式的卡片底色` |

前缀（`feat` / `fix` / `docs` / `style`）不是必须的，但**能让你以后翻历史时一眼看懂**。

**别攒太久**：攒一周再提交，中间出问题就没法精细回退了。

---

## 二、发布 Release（第 2 件事）

### 为什么要发 Release

**GitHub 仓库不适合放安装包**：单文件上限 100 MB，而三个安装包是 116–127 MB，**根本推不上去**。

**Release 是专门放"发布产物"的地方**：单附件上限 2 GB，而且每个文件有**永久直链**，可以拿来当下载地址。

### 安装包（已确认是最新版）

| 文件 | 大小 | 构建时间 |
| --- | --- | --- |
| `release\daily-ledger-0.1.0-portable.exe` | 116.1 MB | 2026-09-30 21:14 |
| `release\daily-ledger-0.1.0-setup.exe` | 116.3 MB | 2026-09-30 21:14 |
| `release\daily-ledger-0.1.0-installer.msi` | 127.5 MB | 2026-09-30 21:14 |

### 方式 A：网页操作（推荐，最直观）

1. 打开 https://github.com/karina2256/simple-ledger/releases/new
2. **Choose a tag**：输入 `v0.1.0`，点「Create new tag」
3. **Release title**：`记账簿 0.1.0`
4. **Describe this release**（复制下面这段）：

```markdown
## 首个版本

Windows 本地离线记账软件。数据只存在你自己的电脑上，不联网、不上传，断网可用。

### 功能
- 记一笔：日期、金额、账户、二级分类、备注、标签、收据截图
- 截图记账：微信账单截图自动识别成记录（本地 OCR，图片不出本机）
- 日历：年 / 月 / 周 / 日四级视图
- 汇总：收支趋势折线 + 构成饼图 + 单笔极值
- 预算：分类额度与超支提醒
- 搜索：关键词 + 日期 + 账户 + 分类 + 金额档位组合筛选
- 回收站：软删除可恢复
- 导入导出：CSV / Excel（xlsx）
- 自动备份、应用锁、深色模式、三种动效档位

### 下载
| 文件 | 说明 |
| --- | --- |
| `daily-ledger-0.1.0-portable.exe` | 免安装版，双击即用（推荐） |
| `daily-ledger-0.1.0-setup.exe` | 安装版，建快捷方式 |
| `daily-ledger-0.1.0-installer.msi` | MSI 安装包 |

### 注意
本版本**未做代码签名**，首次打开 Windows 可能提示「已保护你的电脑」。
点「更多信息」→「仍要运行」即可，不是病毒。

### 数据
数据保存在你第一次打开时选的目录里（`daily-ledger.db`）。卸载软件不会删除数据，
但**请自行把数据目录备份到这台电脑之外**（网盘 / 移动硬盘），本地软件无法防止硬盘损坏。
```

5. **Attach binaries**：把 `release\` 里的三个文件拖进上传区
6. 点 **Publish release**

**上传可能需要几分钟**（三个文件共 360 MB）。

### 方式 B：命令行（需要 Token）

如果你想用命令发布，需要先创建一个 **Personal Access Token**：

1. 打开 https://github.com/settings/tokens/new
2. Note 填 `ledger-release`
3. Expiration 选 90 days（或自定义）
4. **Scopes 勾选 `repo`**（发布 Release 需要）
5. 点 Generate token，**复制那串 `ghp_...`**（只显示一次）

然后执行（把 TOKEN 换成你的）：

```powershell
$env:GITHUB_TOKEN = "ghp_你的token"
$release = @{
  tag_name = "v0.1.0"
  name     = "记账簿 0.1.0"
  body     = "首个版本：本地离线记账软件"
  draft    = $false
} | ConvertTo-Json

# 1. 创建 Release
$r = Invoke-RestMethod -Method Post `
  -Uri "https://api.github.com/repos/karina2256/simple-ledger/releases" `
  -Headers @{ Authorization = "token $env:GITHUB_TOKEN"; "User-Agent" = "ledger-release" } `
  -ContentType "application/json" -Body $release

# 2. 上传三个安装包
$uploadBase = "https://uploads.github.com/repos/karina2256/simple-ledger/releases/$($r.id)/assets"
foreach ($f in @("daily-ledger-0.1.0-portable.exe","daily-ledger-0.1.0-setup.exe","daily-ledger-0.1.0-installer.msi")) {
  $path = "release\$f"
  Invoke-RestMethod -Method Post -Uri "$uploadBase?name=$f" `
    -Headers @{ Authorization = "token $env:GITHUB_TOKEN"; "User-Agent" = "ledger-release"; "Content-Type" = "application/octet-stream" } `
    -InFile $path | Select-Object name, size
}
```

### 发布之后

三个文件会得到永久直链，形如：

```
https://github.com/karina2256/simple-ledger/releases/download/v0.1.0/daily-ledger-0.1.0-portable.exe
```

**把这三条发给我**，我帮你填进 `website\main.js` 的 `DOWNLOADS` 对象，官网的下载按钮就能真正生效了。

---

## 三、仓库美化（可选，30 秒）

在 https://github.com/karina2256/simple-ledger 页面右侧点 ⚙️（在 About 旁边）：

**Description**：
```
完全离线的 Windows 本地记账软件 · Electron + React + TypeScript + SQLite
```

**Topics**（点 Add topics，逐个输入）：
```
electron  react  typescript  sqlite  accounting  offline  privacy  local-first
```

**Topics 的作用**：GitHub 会按话题给仓库分类，**搜这些词的人能搜到你**。这是最省事的曝光方式。

---

## 四、当前进度

| 事项 | 状态 |
| --- | --- |
| git 仓库初始化 | ✅ 完成 |
| 隐私审计（真实路径、.tmp、大文件） | ✅ 完成 |
| 首次推送 | ✅ 完成（3 个提交已同步到远程） |
| 讲义 git 章节更新 + PDF 重新生成 | ✅ 完成 |
| **发布 Release（上传安装包）** | ⬜ **需要你的 Token 或网页操作** |
| **填下载直链进官网** | ⬜ 等 Release 发布后我来做 |
| 仓库描述与 Topics | ⬜ 你花 30 秒，或给我 Token 我来 |

**卡点说明**：发布 Release 需要 GitHub API Token，这东西**只能你自己创建**（它等价于你账号的写权限）。我不会向你要密码，也不会保存你的 Token——你操作完后可以直接删掉那个 Token。
