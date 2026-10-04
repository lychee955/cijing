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
| `npm run format` | 统一代码格式、拆分长行 |
| `npm run format:check` | 检查代码格式 |
| `npm run check` | 格式检查、单元测试和生产构建 |
| `npm run test:e2e` | 构建并运行桌面回归 |
| `npm run dist` | 构建、打包并校验 Windows x64 发行文件 |
| `npm run release:verify -- <目录>` | 重新校验指定目录的发行文件 |

普通测试使用模拟接口和临时数据，不使用真实 Token 或修改真实账号。桌面回归需要可交互的桌面及可用的系统加密服务；真实在线音频测试默认跳过。

TS/JS 的 Prettier 规则参照 IDEA 2024.1 原生默认：4 空格缩进、双引号、分号、120 列目标宽度，对象和导入的大括号内不加空格；JSON、CSS 和 HTML 使用 2 空格。换行统一为 LF。Prettier 与 IDEA 的排版算法不同，具体折行、类型大括号空格及保留已有尾逗号的行为仍有差异；本项目不额外添加尾逗号。`npm ci` 会通过 Husky 安装提交 hook，提交前自动格式化暂存的代码文件；若安装时禁用了脚本，可运行 `npm run prepare` 安装 hook。

<details>
<summary>依赖安装与调试排障</summary>

- 确保网络可访问 npm registry、Electron 及原生模块的下载地址；原生编译环境配置见 [node-gyp Windows 说明](https://github.com/nodejs/node-gyp#on-windows)。
- 如果安装时禁用了脚本，运行 `node node_modules/electron/install.js`，然后运行 `npm run rebuild`。
- 遇到 `NODE_MODULE_VERSION` 不匹配时，运行 `npm run rebuild`。
- PowerShell 若阻止执行 `npm.ps1`，将命令中的 `npm` 替换为 `npm.cmd`。
- 在「设置 → 桌面行为」打开开发者工具。AI 请求由主进程发出，应查看启动终端或 `%APPDATA%/cijing/logs/ai.log`，而非页面 Network。

</details>

## 本地打包

在 Windows x64 环境安装依赖后，依次运行：

```powershell
npm run check
npm run test:e2e
npm run dist
```

产物位于本次新建的 `dist/release-<版本>-<时间戳>/`，包含安装版、便携版、更新配套文件和本地核对清单。打包会检查 EXE 版本、SQLite 原生模块及文件完整性，但仍需在测试账号或虚拟机中验证实际安装与启动。打包不会上传文件，也不需要 GitHub 发布权限。产物清单与复核方法见[发布与更新指南](docs/RELEASING.md#本地构建与产物)。

## 发布到 GitHub Releases

发布顺序：更新版本与说明 → 检查并打包 → 提交及推送标签 → 上传草稿附件 → 核对后公开。快照须标记为 Pre-release；正式版需先完成签名与实机升级验收。完整步骤、命令和附件核对方法见[发布与更新指南](docs/RELEASING.md#发布操作)。

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
