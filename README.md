# 墨墨桌面查词

Electron + Vue 3 + TypeScript 桌面客户端。**已实施到 M2（日常可用）**：查词、添加与确认、SQLite 历史和重启恢复、托盘、可配置全局快捷键、单实例及窗口设置。M1 已使用用户真实账号新增 `apple`，并确认手机端可见；M2 的异常和恢复验证使用隔离模拟接口，不额外修改真实学习规划。

## 启动

需要 Node.js 22.12+，推荐 Node.js 24 LTS。本机已在 `.tools/` 准备便携 Node.js，可在项目目录的 PowerShell 中运行：

```powershell
.\start.ps1
```

已有 Node.js 的环境：

```sh
npm ci
npm run dev
```

`npm ci` 的项目 postinstall 会下载锁定版本的 Electron，并为其重建 `better-sqlite3`。网络需允许访问 npm registry 和 Electron/SQLite 官方发布下载地址；如果安装时禁用了脚本，补运行 `node node_modules/electron/install.js` 和 `npm run rebuild`。原生模块缺少对应平台预构建文件时，需要该平台的 C++ 构建工具。

更新 Electron 或安装依赖后如遇 `NODE_MODULE_VERSION` 不匹配，运行 `npm run rebuild`。M1 旧进程如仍在运行，请从窗口退出后启动 M2。

构建后运行：

```sh
npm run build
npm start
```

## 使用

1. 在「设置」粘贴个人 Token 并保存。Token 获取位置：墨墨 App → 我的 → 更多设置 → 实验功能 → 开放 API。
2. 在手机 App 开启自动同步。
3. 返回「查词」，输入拼写，按 Enter 查询。只去除首尾空白，保留大小写和词形。
4. 多结果时选择词条；点击「加入学习规划」或按 Ctrl/Cmd + Enter。
5. 如显示「结果待确认」或「未新增」，用「再次确认状态」查询记录。
6. 「历史」可按当前配置/全部记录查看，支持分页与待处理筛选。旧配置只读，不能向当前账号确认旧配置操作。

桌面快捷键：

| 操作 | 按键或入口 |
| --- | --- |
| 全局唤出并聚焦查词 | `Ctrl/Cmd + Shift + M`，可在设置中修改或停用 |
| 查词 / 历史 / 设置 | `Ctrl/Cmd + 1 / 2 / 3` |
| 隐藏窗口 | `Esc`；托盘不可用时改为最小化 |
| 退出应用 | 托盘「退出墨墨」或设置「退出应用」 |

默认关闭窗口会隐藏到托盘，可在设置中改为退出。快捷键注册失败会保留原快捷键；状态显示在设置页。Linux 为避免不可见的托盘宿主，隐藏操作默认改为最小化。窗口位置自动保存；显示器断开或布局改变后会校正到可见区域。外观支持跟随系统、浅色、深色。

「已加入学习规划」只对应本次 `added_count=1`。「已在学习规划中」只说明查到记录，不说明由本次新增。学习记录暂时为空不能证明写入失败。查询不会返回完整词典释义。

Token 经 Electron `safeStorage` 加密写入应用数据目录下的 `credentials.v1.json`。界面只读取凭证状态；复制按钮由主进程写入系统剪贴板。替换 Token 会轮换本地配置 ID，旧记录保留、旧任务暂停；存在请求或恢复确认时禁止替换或清除。明确鉴权失败会持久化暂停该配置，更新 Token 后恢复使用。Linux `basic_text` 后端不可用作凭证保护。

## 数据与恢复

SQLite 文件为应用数据目录下的 `momo.sqlite3`，只由主进程访问，包含版本化迁移、配置、操作日志和桌面设置。Windows 默认在 `%APPDATA%/momo-desktop/`。保留 SQLite 主文件及可能存在的 `-wal`、`-shm` 文件；不要在应用运行时手动替换数据库。

发送添加请求前会提交一条 `submitting` 日志。正常退出或崩溃后，重启将遗留日志转换成 `uncertain`，最多自动确认当前配置的 5 条待确认操作；遇鉴权、网络或限流错误停止本轮，其余记录可在历史页手动确认。整个恢复流程只读，不自动重新添加。

M1 已保存的加密 Token 会直接复用。M1 的历史只存在旧进程内存中，无法补入 M2 数据库；M2 历史从升级后的首次操作开始记录。

## 验证

```sh
npm test           # Vitest：77 项测试，包括真实 SQLite 临时数据库
npm run build      # strict 类型检查与三个进程的生产构建
npm run test:e2e   # Playwright：9 项 Electron 桌面流程
```

普通测试不使用真实 Token、不访问真实账号。`npm test` 在 Electron 的 Node 模式下运行 Vitest，使测试与应用使用相同的 SQLite ABI。桌面测试通过独立测试入口替换 `net.fetch`，使用临时应用数据目录，并实际调用 Windows `safeStorage`；生产入口没有模拟模式。端到端测试需要可运行 Electron 的桌面环境及可用的系统加密服务。当前验证平台为 Windows x64；其他平台尚未验收。

详细记录见 [M2 验收记录](docs/M2_ACCEPTANCE.md)，此前真实账号联调见 [M1 验收记录](docs/M1_ACCEPTANCE.md)。

## 当前边界

- 已具备主进程网络访问、有限 preload 契约、IPC 参数和来源校验、严格生产 CSP、导航/新窗口限制。
- 写入不自动重试；按配置与词条合并并发添加，历史中的待确认结果会阻止重新提交。查询有限重试，包含三时间窗口限流和服务端 `Retry-After` 处理。
- 本地记录表示本客户端的操作结果，不能当作手机端全部学习状态；学习记录同步可能延迟。
- 安装包、各平台 CI、签名与 macOS/Linux 实机验收仍属于 M3；没有默认启用开机启动、自动更新或剪贴板监听。

## 结构

```text
src/main/maimemo/    官方接口适配、响应校验、错误与限流
src/main/services/   查询词条授权、添加与确认状态机
src/main/storage/    SQLite 迁移、操作日志、配置和加密凭证
src/main/windows.ts 窗口、隐藏和显示器校正
src/main/tray.ts     托盘菜单
src/main/shortcuts.ts 全局快捷键注册与回滚
src/main/ipc/        业务 IPC 与来源校验
src/preload/        仅暴露类型化业务方法
src/renderer/       Vue 界面与 Pinia 临时状态
src/shared/         跨进程契约及可序列化 Result
tests/unit/         业务、凭证、参数、来源、查询顺序测试
tests/e2e/          独立模拟入口与 Electron 操作流程
```

接口按 [官方 OpenAPI](https://open.maimemo.com/api_bundle.yaml) 与 [官方 CLI 的响应处理](https://github.com/maimemo/memo-api-cli/blob/main/src/client.ts) 实施。公开规范快照见 `docs/api_bundle.yaml`；多结果查询的具体适配决定见验收记录。
