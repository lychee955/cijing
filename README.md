<p align="center">
  <img src="build/logo.svg" width="88" height="88" alt="词境 Logo">
</p>

# 词境 · Cijing

**查词、理解句子，把遇到的生词加入学习规划。**

词境是一款桌面英语学习工具，整合词典查询、AI 句子分析与墨墨生词收录。基于 Electron、Vue 3 和 TypeScript 构建，当前处于快照开发阶段，版本为 `0.0.2-snapshot.20261004.1`，支持构建 Windows x64 安装版和便携版。

[查看测试版本](https://github.com/lychee955/cijing/releases) · [快速上手](#快速上手) · [本地开发](#本地开发) · [本地打包](#本地打包) · [发布版本](#发布到-github-releases) · [问题反馈](https://github.com/lychee955/cijing/issues)

> 词境为独立第三方工具，不属于墨墨官方产品。

## 功能

- **查词与发音**：查看中文释义、英美音标，按需播放发音。
- **生词收录**：连接个人墨墨账号，添加词条、查看学习状态并确认待处理结果。
- **句子分析与翻译**：分析句子主干、从句、语法和重点词汇，也可切换为仅翻译模式。
- **自选 AI 服务**：支持 OpenAI 兼容接口和 Gemini 原生接口，可保存、测试及切换多套配置。
- **本地历史与桌面操作**：回看查词收录和分析记录，支持托盘、全局快捷键及浅色／深色主题。

## 下载与安装

当前提供快照测试版，前往 [GitHub Releases](https://github.com/lychee955/cijing/releases)，从 Assets 选择一个 `.exe` 文件：

| 发行文件 | 使用方式 |
| --- | --- |
| `cijing-<版本>-win-x64-setup.exe` | 安装版，按向导安装 |
| `cijing-<版本>-win-x64-portable.exe` | 便携版，下载后直接运行 |

`snapshot.yml`（快照）或 `latest.yml`（正式版）和 `.blockmap` 是更新配套文件，无需手动打开。当前尚未提供 macOS、Linux 和 Windows ARM64 发行包；Windows 包尚未签名，可能显示安全提示。

Logo 下方的版本入口仅检查正式版，不发现快照。快照需要从 Releases 列表手动下载；没有正式版时，检查更新会提示无法确认发布信息。快照与已有安装共用数据目录，测试前请备份或使用独立账号。

## 快速上手

查词收录和 AI 分析分别配置，**仅使用 AI 功能时无需墨墨 Token**。

1. **配置墨墨**：在墨墨 App → 我的 → 更多设置 → 实验功能 → 开放 API 获取个人 Token，保存到词境「设置」，并在手机端开启自动同步。
2. **配置 AI**：在「设置 → AI 服务」新增配置，填写服务地址、API Key 和模型，测试连接后设为当前配置。费用和额度由所选服务商决定。
3. **开始使用**：在「查词」查询并收录生词；在「句子分析」输入单句或短段落。关闭「详细分析」可直接获取译文。

| 操作 | Windows 快捷键 |
| --- | --- |
| 唤出窗口并聚焦查词 | `Ctrl + Shift + M`，可在设置中修改 |
| 切换查词／历史／设置／句子分析 | `Ctrl + 1 / 2 / 3 / 4` |
| 添加所选词条、提交分析或翻译 | `Ctrl + Enter`，依当前页面执行 |
| 隐藏窗口 | `Esc`，弹窗打开时优先关闭弹窗 |

详细操作、服务配置与常见问题见 [使用指南](docs/USAGE.md)。

## 数据与隐私

- 配置和历史保存在 `%APPDATA%/cijing/`；**便携版也使用这个目录**。Token 和 API Key 使用系统加密能力保存在本机，历史原文和分析结果以普通数据保存。
- 查词与收录使用墨墨服务，释义和发音使用 UAPI；AI 输入会发送至你配置的服务商。
- AI 诊断日志默认包含请求与响应正文。分享日志前检查个人信息；启动前设置 `CIJING_AI_LOG_CONTENT=0` 可关闭正文记录。
- 备份前退出应用并保存完整数据目录，包括 SQLite 主文件及可能存在的 `-wal`、`-shm` 文件。恢复细节见 [数据与恢复](docs/USAGE.md#数据与恢复)。

## 本地开发

### 环境准备

| 工具 | 要求 |
| --- | --- |
| 操作系统 | 当前验证和发行平台为 Windows x64 |
| [Node.js](https://nodejs.org/en/download) | 最低 22.12，建议使用 24.x x64，包含 npm |
| [Git](https://git-scm.com/downloads) | 用于获取源码和管理版本 |
| 原生编译工具 | 仅在缺少预构建模块时需要：Python 3、Visual Studio Build Tools 的「使用 C++ 的桌面开发」及 Windows SDK |

### 获取源码并启动

```powershell
git clone https://github.com/lychee955/cijing.git
cd cijing
npm ci
npm run dev
```

`npm ci` 会按锁文件安装依赖、下载 Electron 并重建 `better-sqlite3`。开发模式支持渲染界面热更新，主进程改动后自动重启；更新依赖或启动配置后需重新运行开发服务。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发环境 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 单元测试，使用与 Electron 一致的 SQLite ABI |
| `npm run build` | 生成图标、检查类型并构建生产代码 |
| `npm start` | 运行已经构建的应用 |
| `npm run check` | 单元测试和生产构建 |
| `npm run test:e2e` | 构建并运行桌面回归 |
| `npm run dist` | 构建、打包并校验 Windows x64 发行文件 |
| `npm run release:verify -- <目录>` | 重新校验指定目录的发行文件 |

普通测试使用模拟接口和临时数据，不使用真实 Token 或修改真实账号。桌面回归需要可交互的桌面及可用的系统加密服务；真实在线音频测试默认跳过。

<details>
<summary>依赖安装与调试排障</summary>

- 确保网络可访问 npm registry、Electron 及原生模块的下载地址；原生编译环境配置见 [node-gyp Windows 说明](https://github.com/nodejs/node-gyp#on-windows)。
- 如果安装时禁用了脚本，运行 `node node_modules/electron/install.js`，然后运行 `npm run rebuild`。
- 遇到 `NODE_MODULE_VERSION` 不匹配时，运行 `npm run rebuild`。
- PowerShell 若阻止执行 `npm.ps1`，将命令中的 `npm` 替换为 `npm.cmd`。
- 在「设置 → 桌面行为」打开开发者工具。AI 请求由主进程发出，应查看启动终端或 `%APPDATA%/cijing/logs/ai.log`，而非页面 Network。

</details>

## 本地打包

当前发行脚本只构建 **Windows x64 安装版和便携版**，并会运行打包后的 Windows EXE 检查原生模块。请在 Windows x64 电脑或 Windows x64 虚拟机中执行以下流程；目前不提供 macOS、Linux 或 ARM64 的发行打包流程。

完成上面的依赖安装后，在仓库根目录逐条执行；任何一步失败都应先解决，再继续后续步骤：

```powershell
npm run check
npm run test:e2e
npm run dist
```

`dist` 由 `scripts/package-release.cjs` 调用 electron-builder，使用 `--win --x64 --publish never` 生成发行包，随后运行打包 EXE 的版本及 SQLite 内存读写检查，并校验发行文件。

只在本地打包不需要 GitHub 账号、发布令牌或代码签名证书；所需构建工具由项目依赖提供，无需全局安装 Electron 或 electron-builder。首次打包还需要下载 electron-builder 的 Windows 打包工具，请确保可以访问相应下载地址。

每次打包会创建独立目录 `dist/release-<版本号>-<时间戳>/`，实际路径见命令输出。版本号来自 `package.json`。例如版本为 `0.0.2-snapshot.20261004.1` 时：

| 文件 | 用途 |
| --- | --- |
| `cijing-0.0.2-snapshot.20261004.1-win-x64-setup.exe` | NSIS 安装版 |
| `cijing-0.0.2-snapshot.20261004.1-win-x64-portable.exe` | 便携版 |
| `cijing-0.0.2-snapshot.20261004.1-win-x64-setup.exe.blockmap` | 安装版更新配套文件 |
| `snapshot.yml` | 快照元数据，描述本次安装包的版本、大小和 SHA-512 |
| `release-manifest.json` | 本地核对清单，包含四项发布附件的名称、大小和 SHA-256 |

安装版和便携版都将配置及历史保存在 `%APPDATA%/cijing/`，便携版不会将数据保存在 EXE 旁。未配置签名证书的包可能触发 Windows 安全提示；当前应用内自动安装更新保持关闭。打包检查通过后，正式分发前还应在测试账号或虚拟机中验证实际安装与便携版启动，避免影响日常使用的数据。

可随时重新校验某一次产物；将目录替换为本次打包输出的实际路径：

```powershell
npm run release:verify -- "dist/release-0.0.2-snapshot.20261004.1-实际时间戳"
```

## 发布到 GitHub Releases

发布顺序：**更新版本与说明 → 检查并打包 → 提交及推送标签 → 上传草稿附件 → 核对后公开**。本地打包不会自动上传。

<details>
<summary>展开完整发布步骤与命令（PowerShell）</summary>

本节适用于有目标仓库写入和发布权限的维护者。其他开发者可直接执行上面的本地打包流程；若要发行自己的 Fork，请先将 `origin` 指向自己的仓库，并在构建前同步修改 `electron-builder.yml` 的 `publish.owner` / `publish.repo` 以及 `src/main/updates/release-source.ts` 的 `REPOSITORY`，让打包配置和客户端更新源指向同一仓库。

以下命令使用 [GitHub CLI](https://cli.github.com/)。先安装并登录拥有仓库发布权限的账号；`setup-git` 用于配置 HTTPS 推送的登录凭证。选择网页发布时，可跳过 CLI 登录，使用自己的 Git 认证方式推送：

```powershell
gh auth login
gh auth status
gh auth setup-git
```

### 1. 确定版本并编写发布说明

以下以发布快照 `0.0.2-snapshot.20261004.1` 为例，在同一个 PowerShell 会话中操作；后续发布应替换成尚未发布的版本号：

```powershell
$version = '0.0.2-snapshot.20261004.1'
$tag = "v$version"
$repo = 'lychee955/cijing' # Fork 发布时改为自己的 owner/repo
$notes = "docs/RELEASE_NOTES_$version.md"

npm version $version --no-git-tag-version
```

这条命令同步更新 `package.json` 和 `package-lock.json`，不会创建 Git 提交或标签。参照 [发布说明模板](docs/RELEASE_NOTES_TEMPLATE.md) 新建 `$notes` 指向的 Markdown 文件，写明本次变化、下载方式和已知限制。同步维护 [发布流程](docs/RELEASING.md) 中的当前版本。快照编号格式为 `X.Y.Z-snapshot.YYYYMMDD.N`，每轮公开构建增加编号；正式版使用 `X.Y.Z`。

### 2. 构建并确认本次产物

在版本、代码和发布说明确定后执行：

```powershell
npm run check
npm run test:e2e
npm run dist

# 替换为刚才命令输出的真实目录；不要混用其他构建目录。
$releaseDir = 'dist/release-0.0.2-snapshot.20261004.1-实际时间戳'
npm run release:verify -- $releaseDir

$manifest = Get-Content -LiteralPath (Join-Path $releaseDir 'release-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $version) { throw '产物版本与待发布版本不一致' }
$metadataFile = $manifest.metadataFile
$assets = @($manifest.artifacts | ForEach-Object { Join-Path $releaseDir $_.name })
$manifest.artifacts | Format-Table name, size, sha256 -AutoSize
```

确认实际安装、启动及核心功能可用后继续。只上传清单中的四项附件；`release-manifest.json` 留作本地复核，`win-unpacked/` 和其他中间文件不上传。修改了代码或版本号后，需要重新构建并更新 `$releaseDir`。

### 3. 提交并推送代码与标签

先检查 `git status` 和差异，再暂存本次要发布的文件。以下示例适用于当前工作区所有改动都属于本次发布的情况；如有无关改动，应改为明确指定文件：

```powershell
git status --short
git diff
git add -A
git diff --cached --check
git diff --cached --stat
git commit -m "chore: release $tag"
git tag $tag
git push --atomic origin HEAD "refs/tags/$tag"
```

在正常本地分支上执行上述命令，并确保 `origin` 对应 `$repo`。若仓库要求通过 PR 合并，先完成合并，再检出最终发布提交、打标签并推送标签；发布附件必须由该提交的代码构建。不要移动已发布标签或覆盖已公开的安装包，后续修改应提升版本号。

### 4. 创建草稿、上传附件并公开

创建草稿时一次上传清单中的四个文件，并从 Markdown 文件读取完整发布说明：

```powershell
gh release create $tag @assets --repo $repo --draft --prerelease --latest=false --verify-tag --title "词境 $tag" --notes-file $notes
gh release view $tag --repo $repo --json tagName,isDraft,assets,url
gh release view $tag --repo $repo --web
```

`--verify-tag` 要求标签已存在于远端。打开草稿，核对发布说明、版本和四个附件；可用下面的命令查看远端附件大小和 SHA-256，与本地 `release-manifest.json` 比较：

```powershell
gh api "repos/$repo/releases/tags/$tag" --jq '.assets[] | {name, size, digest}'
```

如果上传中断，先检查草稿现有附件，再用 `gh release upload $tag "缺失文件的完整路径" --repo $repo` 补传缺失文件。确认完整后，公开快照预发布版：

```powershell
gh release edit $tag --repo $repo --draft=false --prerelease --latest=false
gh release view $tag --repo $repo --json tagName,isDraft,url
```

也可以使用 GitHub 网页：进入目标仓库的 **Releases → Draft a new release**，选择已推送的标签，填写标题和发布说明，上传清单中的四项附件，勾选 **Set as a pre-release**，不设为 Latest，核对后点击 **Publish release**。网页方式无需安装 GitHub CLI。

发布后检查 `https://github.com/<owner>/<repo>/releases/tag/<tag>` 和 `https://github.com/<owner>/<repo>/releases/download/<tag>/<metadataFile>` 可公开访问（元数据文件名以清单为准，快照为 `snapshot.yml`），元数据版本与安装包一致。匿名 GitHub API 可能限流，403/429 不代表附件上传失败。

正式版须满足正式发布验收条件；使用不带快照后缀的版本号，草稿不加 `--prerelease`，公开时使用 `--prerelease=false --latest`，元数据为 `latest.yml`。

CLI 参数说明见 [创建 Release](https://cli.github.com/manual/gh_release_create)、[上传附件](https://cli.github.com/manual/gh_release_upload) 和 [发布草稿](https://cli.github.com/manual/gh_release_edit)。签名配置、自动安装启用条件与完整升级验收要求见 [发布与更新说明](docs/RELEASING.md)。

</details>

## 项目结构

```text
src/
  main/        主进程：接口、业务服务、数据库、窗口与更新
  preload/     向渲染层提供受限的桌面接口
  renderer/    Vue 页面、组件和 Pinia 状态
  shared/      跨进程契约、数据类型与品牌配置
tests/
  unit/        单元测试
  e2e/         Electron 桌面回归
scripts/       构建、打包与校验脚本
build/         图标和安装器资源
docs/          使用指南、发布流程与设计验收记录
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用指南](docs/USAGE.md) | 查词、AI 配置、历史、数据恢复与常见问题 |
| [发布与更新](docs/RELEASING.md) | 签名配置、更新策略及实机验收 |
| [发布说明模板](docs/RELEASE_NOTES_TEMPLATE.md) | 编写新版本说明 |
| [技术方案](TECHNICAL_PLAN.md) | 项目架构与技术设计 |
| [句子分析方案](docs/SENTENCE_ANALYSIS_PLAN.md) | AI 接口、提示词与结果契约 |
| [分析质量样例](docs/SENTENCE_ANALYSIS_SAMPLES.md) | 人工质量核对样例 |
| [更新验收记录](docs/UPDATE_RELEASE_ACCEPTANCE.md) | 已完成验证及待验收事项 |

## 反馈与贡献

欢迎通过 [Issues](https://github.com/lychee955/cijing/issues) 报告问题或讨论改进。报告问题时请附上应用版本、Windows 版本、复现步骤和必要截图；不要提交 Token、API Key 或未经检查的完整日志。

提交代码前运行 `npm run check`；涉及桌面行为时运行 `npm run test:e2e`。PR 请说明改动目的、用户可见的变化和验证结果。

## 相关服务

- [墨墨开放 API](https://open.maimemo.com/api_bundle.yaml)：词条查询与学习规划；项目内保留 [接口规范快照](docs/api_bundle.yaml)。
- [UAPI 词典](https://uapis.cn/docs/api-reference/get-dictionary-lookup)与[发音接口](https://uapis.cn/docs/api-reference/get-dictionary-audio)：中文释义、音标和音频。
