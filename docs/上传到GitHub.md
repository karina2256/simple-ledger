# 上传到 GitHub（操作手册）

本仓库已经**初始化完成、首次提交完成**。剩下的只是"在 GitHub 上建一个空仓库 → 把本地推上去"。

**当前状态**：

| 项 | 值 |
| --- | --- |
| git 仓库 | ✅ 已初始化（`.git` 目录） |
| 首次提交 | ✅ `50f674a` 初始提交：记账簿 0.1.0 |
| 提交文件数 | **257 个**，共 43,469 行，约 13.8 MB |
| git 身份 | `karina2256 <3412302394@qq.com>`（你机器上原有的配置） |
| 远程仓库 | ❌ 还没有（需要你在 GitHub 上建） |
| 分支名 | `master` |

---

## 一、为什么不能把全部东西都推上去

上传前我做了一次隐私与体积审计，处理了三类问题：

| 问题 | 处理 |
| --- | --- |
| **`.tmp/` 里有 20 个 `.db` 文件**（测试沙箱生成的假数据库） | 已加入 `.gitignore`，不进版本库 |
| **`分享包/` + `分享包.zip` + 各种 exe/msi 共 1.3 GB** | 已排除。GitHub 单文件上限 **100 MB**，任何一个安装包都推不上去 |
| **OCR 模型 15.5 MB**（二进制） | 已排除。克隆者跑 `npm run setup:ocr` 会自动下载 |
| **讲义里 31 处写了你的真实数据目录名** | 已替换成 `<你的数据目录>` 占位符 |

**最终只有 13.8 MB** —— 全是源码、文档、网站、讲义，可以正常推。

> **注意**：如果你想让别人能直接下载安装包，用 **GitHub Releases**（不是塞进仓库）。
> 见文末"发布安装包"一节。

---

## 二、在 GitHub 上操作（你来做，约 3 分钟）

### 步骤 1：建一个空仓库

1. 打开 <https://github.com/new>（用你已登录的账号）
2. 填写：
   - **Repository name**：`jizhangbu`（或 `daily-ledger` / `记账簿` 都行）
   - **Description**：`完全离线的 Windows 本地记账软件（Electron + React + SQLite）`
   - **Public**（公开）还是 **Private**（私有）？
     - 想让人搜到、想免费部署官网 → **Public**
     - 只想自己备份 → **Private**
   - ⚠️ **下面三个选项全都不要勾**：不勾 "Add a README"、不勾 ".gitignore"、不勾 "license"
     （勾了会产生初始提交，和你本地的冲突）
3. 点 **Create repository**

### 步骤 2：记下仓库地址

创建成功后会跳到一个页面，显示类似：

```
https://github.com/karina2256/jizhangbu.git
```

**把这个地址复制下来**（后面要用）。

### 步骤 3：告诉我，或者你自己执行

**最简单的方式：把仓库地址发给我，我帮你配好并推送。**

如果你想自己来，在 PowerShell 里执行这三行（把地址换成你的）：

```powershell
cd "C:\Users\34123\Desktop\记账簿"
git remote add origin https://github.com/你的用户名/jizhangbu.git
git push -u origin master
```

**推送时会弹窗让你登录 GitHub**（浏览器授权，或用 Personal Access Token）。
你机器上已有保存的 GitHub 凭据，所以可能直接通过。

---

## 三、推上去之后检查什么

推送完打开 `https://github.com/你的用户名/jizhangbu`，确认：

- [ ] 首页显示 README（就是项目里那份说明）
- [ ] 能看到 `src/`、`website/`、`course/`、`docs/` 这些目录
- [ ] **看不到** `node_modules/`、`release/`、`.tmp/`、`分享包/`
- [ ] 仓库显示约 **257 个文件**
- [ ] 点进 `course/lessons/`，24 个 `.md` 讲义都在

关于"某个文件"的诚信问题：

- [ ] 没有 `.db` 文件（搜一下 `daily-ledger` 应该只出现在代码和文档里，不该有 `.db`）
- [ ] 没有 `D:\加速器` 这种你的真实路径（讲义里已替换成占位符）

---

## 四、发布安装包（Releases）

**仓库里不放安装包**，用 Releases：

1. 仓库页面 → 右侧 **Releases** → **Create a new release**
2. **Choose a tag**：填 `v0.1.0`（新建 tag）
3. **Release title**：`记账簿 0.1.0`
4. **Describe this release**：写更新内容
5. **Attach binaries**：把 `release\` 里的三个文件拖进去
   - `daily-ledger-0.1.0-portable.exe`（116 MB）
   - `daily-ledger-0.1.0-setup.exe`（116 MB）
   - `daily-ledger-0.1.0-installer.msi`（127 MB）
6. 点 **Publish release**

**注意**：GitHub **单个附件上限 2 GB**，所以三个都放得下。
发布后每个文件都有一个永久直链，形如：

```
https://github.com/你的用户名/jizhangbu/releases/download/v0.1.0/daily-ledger-0.1.0-portable.exe
```

**把这三个直链发给我**，我可以帮你填进官网的 `website\main.js`（那个 `DOWNLOADS` 对象），下载按钮就能真正生效了。

---

## 五、日常使用（推上去之后）

**每次改完代码，三步**：

```powershell
cd "C:\Users\34123\Desktop\记账簿"
git add -A
git commit -m "改了什么的简短说明"
git push
```

**查看改了什么**：

```powershell
git status        # 哪些文件改了
git diff          # 具体改了哪几行
```

**改坏了想还原**（这就是 4-1 讲说"建议尽快学 git"的原因）：

```powershell
git restore 文件名          # 还原单个文件到上次提交
git log --oneline           # 看历史提交
git reset --hard 提交号      # 彻底回到某个提交（慎用）
```

---

## 六、我做完的部分 / 需要你做

| 事项 | 状态 |
| --- | --- |
| git 仓库初始化 | ✅ 我做了 |
| 隐私审计与清理（.tmp、真实路径、大文件） | ✅ 我做了 |
| `.gitignore` 完善 | ✅ 我做了 |
| 首次提交（257 文件 / 43,469 行） | ✅ 我做了 |
| **在 GitHub 建仓库** | ⬜ **需要你**（登录你的账号） |
| **推送（git push）** | ⬜ 需要你，或者把仓库地址给我，我配好 remote 后你执行推送 |
| 发布 Release（上传安装包） | ⬜ 需要你（或我帮你写好命令） |
| 把下载直链填进官网 | ⬜ 拿到 Release 链接后我来做 |

**下一步只有一个动作**：去 <https://github.com/new> 建一个空仓库（三个勾选项都别勾），然后把仓库地址发我。
