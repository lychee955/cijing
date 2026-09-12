# M2 实施与验收记录

日期：2026-09-12。版本：0.2.0。范围：技术方案 M2「日常可用」。当前验证平台为 Windows x64。

## 实现

| 项目 | 实施结果 |
| --- | --- |
| 查词、历史、设置 | 三页可用，支持 Ctrl/Cmd + 1/2/3 导航；历史分页、当前/全部配置与待处理筛选 |
| SQLite | better-sqlite3 13.0.3，schema v1；profiles、word_operations、settings；索引、短事务、WAL、FULL 同步及版本校验 |
| 操作可靠性 | 网络写入前持久化 submitting；落盘失败则不发请求；结果保存失败保留待确认，防止重复写入 |
| 重启恢复 | 提交中转为 uncertain；最多只读确认当前配置的 5 条记录，遇错误停止，不自动添加 |
| 配置归属 | 复用 M1 加密凭证；替换 Token 生成新本地配置；旧历史只读，旧任务不在新账号执行 |
| 凭证失效 | 明确 401 持久化暂停当前配置；查询、添加和恢复均受检查，设置中更新 Token 后恢复 |
| 日常网络异常 | 15 秒单次超时、受限响应大小、读请求最多一次重试、写请求不重试、多时间窗口限流及 Retry-After |
| 桌面入口 | 原生托盘菜单、默认 Ctrl/Cmd + Shift + M、冲突回滚、退出注销、单实例重复启动唤回 |
| 窗口与设置 | Esc 隐藏、关闭行为可选、无可靠托盘时最小化、位置持久化与显示器校正、浅/深/系统主题 |
| IPC | 有限 history/desktop 方法、来源和参数校验、事件取消订阅；无任意文件、SQL、网络入口 |

## 验证结果

环境：Node.js 24.21.0、Electron 44.3.0、better-sqlite3 13.0.3、@electron/rebuild 4.2.0；全部版本锁定在 package-lock.json。

| 检查 | 结果 |
| --- | --- |
| `npm test` | 77 passed，7 个测试文件 |
| `npm run build` | strict 类型检查、main/preload/renderer 生产构建通过 |
| `npm run test:e2e` | 9 passed，包含保留的 M1 流程与 6 个 M2 场景 |
| 历史与深色设置截图 | 检查通过，无重叠或截断，截图输出至 test-results |

重点回归包括：提交前日志可见；磁盘写入失败不发送请求；结果落盘失败不重发；强制退出后仅查询；暂未查到记录保持待确认；查询旧失败记录不能解除新不确定写入的保护；配置切换后旧记录不可操作；401 跨重启暂停；429 阻止紧接着的重复网络请求；快捷键冲突和设置写入失败时保持旧绑定；第二次真实启动唤回现有窗口；托盘/快捷键不可用时保留最小化窗口；断开显示器后的坐标校正。

SQLite 单元测试使用真实临时数据库，Vitest 在 Electron Node 模式运行，避免 Node 与 Electron 的原生 ABI 不一致。端到端测试使用真实 Electron 和 Windows safeStorage，模拟网络接口，并以 `app.exit(0)` 验证提交中强制退出。测试入口为了不抢桌面焦点替换 show/focus，并记录显隐调用；全局快捷键实际注册后由测试调用捕获的回调验证唤出链路，未模拟物理键盘按键或系统托盘鼠标点击。

单实例测试启动第二个真实 Electron 进程，验证它退出且首个窗口收到唤回；Windows 测试中使用实际 Electron `process.execPath`，而不是 Playwright 的外层 cmd.exe 启动器。

## 升级及使用

1. 退出正在运行的旧 M1 进程，安装依赖并运行 `npm run rebuild`（`npm ci` 已自动执行重建）。
2. `npm run dev` 或在本机 PowerShell 运行 `.\start.ps1`。
3. M1 保存的 Token 会直接使用，不迁移或暴露明文。M1 没有持久化操作日志，因此其过去的内存记录不会虚构补入数据库。
4. 默认关闭隐藏，托盘可打开查词、历史和设置，也可明确退出；不便使用托盘时在设置中把关闭行为改为退出。
5. 待确认的操作先在历史中确认。更换 Token 后旧配置记录只读；没有实现把旧记录迁移到另一个账号或在旧账号重新授权的流程。

## 范围说明

M2 未执行新的真实账号写请求。M1 的 apple 实际新增与手机端验收仍见 M1_ACCEPTANCE.md。本轮通过模拟错误和真实本地持久化验证恢复，避免为了异常测试反复更改用户学习规划。

macOS/Linux 的系统密钥、托盘宿主、Wayland Portal、物理全局快捷键与安装包实机验收随 M3 进行。Linux 的窗口隐藏保守地改为最小化，避免托盘对象创建成功但桌面没有可见宿主。安装包、签名、公证、自动更新、离线批量队列不属于本轮。

参考：[Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut)、[Tray](https://www.electronjs.org/docs/latest/api/tray)、[better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)。
