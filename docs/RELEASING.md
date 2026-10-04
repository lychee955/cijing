# Windows 发布与更新

当前代码版本：0.0.2-snapshot.20261004.1，处于快照测试阶段。首期分发仓库为公开的 `lychee955/cijing`，只构建 Windows x64。首次含更新功能的版本仍须手动安装。

## 当前交付状态

- 当前仅分发快照测试版，使用 Pre-release，正式版验收条件保持不变。
- Logo 下方版本入口、更新面板、后台检查、便携版下载入口已实现。
- NSIS 下载、校验、退出协调已实现，但 `src/main/updates/policy.json` 的实机验收开关为 `false`。未验收的安装版使用发布页面手动更新。
- 不改变 `com.lychee955.cijing`、包名 `cijing`、数据库结构或用户数据位置。Windows 同一账号仍使用 `%APPDATA%/cijing/`。
- 不包括 GitHub Actions、macOS/ARM 安装支持、自动降级和真实用户数据迁移测试。
- 2026-10-03 匿名仓库页面与 Releases feed 返回 200；匿名 GitHub API 返回 403 限流。因此正式更新 API 的成功链路尚待复核。

## 本地构建与产物

```powershell
npm ci
npm run check
npm run dist
```

`dist` 总是通过 `--win --x64 --publish never` 打包，不读取发布令牌进行上传。每次生成全新的 `dist/release-<版本>-<时间戳>/`，不清空历史目录。构建成功后，用打包 EXE 的 Node 模式读取包名与版本，在内存数据库中验证打包的 SQLite 原生模块，然后验证元数据、文件大小与 SHA-512，生成 `release-manifest.json`。内存冒烟测试不访问用户数据库，也不能代替安装器启动验收。

仅上传清单中的四个文件：

1. `cijing-<版本>-win-x64-setup.exe`
2. `cijing-<版本>-win-x64-setup.exe.blockmap`
3. `cijing-<版本>-win-x64-portable.exe`
4. `snapshot.yml`（快照）或 `latest.yml`（正式版），以清单的 `metadataFile` 为准

不要上传 `win-unpacked`、调试文件、旧名称安装包或无关的测试构建。快照只能以 Pre-release 发布。清单用于复核，可以本地保存；它不是客户端更新元数据。

单独复核：

```powershell
npm run release:verify -- "dist/release-0.0.2-snapshot.20261004.1-具体时间戳"
```

锁定工具：electron-builder 26.15.3、electron-updater 6.8.9。正式版打包实验确认 `latest.yml.files` 只有 x64 NSIS 安装包；便携包不进入该列表。未来多架构不得直接合并或相互覆盖同名 `latest.yml`，须另行验收。

## 签名与自动安装启用条件

当前环境生成的 EXE 为 `NotSigned`，`app-update.yml` 没有 `publisherName`。不能将当前包标记为自动升级验收通过。

正式启用前需要：

1. 配置 Windows 签名证书与构建密钥，密钥仅保存在受限构建环境中。按锁定 builder 的配置设置 `win.signtoolOptions.publisherName` 为证书**完整 Subject/DN 字符串**，并启用 `forceCodeSigning: true`，让缺少签名直接导致正式构建失败。不要填虚构发布者。
2. 检查生成的 `resources/app-update.yml` 确实包含完整 `publisherName`；用 `Get-AuthenticodeSignature` 验证安装包为 `Valid`，Subject 与配置完全一致。
3. 在隔离 Windows 账号或虚拟机，使用隔离的公开测试分发仓库构建两个连续版本，完整执行下节验收。测试源需在测试构建中修改固定仓库常量和 builder 配置；生产渲染层没有更换源入口，也没有开发模式强制更新开关。
4. 留下验收记录后，才把 `windowsX64NsisValidated` 改为 `true`，重新构建、复核并发布。开关不能代替签名配置；运行环境同时要求安装标记、卸载程序、x64 和签名发布者配置。

更新器通过自定义严格校验函数调用 Windows Authenticode：必须有有效签名、相同文件路径和完全匹配的完整发布者 Subject。PowerShell 缺失、超时、输出损坏、签名错误或发布者不匹配都会拒绝安装，不沿用组件在旧 PowerShell 上忽略校验的回退行为。发行机器需具备支持 `Get-AuthenticodeSignature` 和 `ConvertTo-Json` 的 PowerShell。

## 实机验收清单（尚待执行）

- 实际运行 NSIS 安装器：验证 `resources/cijing-nsis-installation` 与卸载程序同时存在，更新环境识别为安装版。直接运行解包 EXE 应显示未识别形式。
- 实际运行 portable：确认 `PORTABLE_EXECUTABLE_FILE` 已由启动器设置，显示便携版、仅能打开发布页，不能下载并运行安装器。
- 安装旧版本，在**测试账号**保存测试 Token、AI 配置、历史与桌面设置；发布更高测试版；旧版检查、用户下载、签名校验、用户安装、重启后版本与数据均正确。
- 添加、确认恢复、分析、翻译、AI 连接测试进行时拒绝安装；通过空闲检查后新 IPC 业务请求被阻止。
- 下载期间正常使用；关闭面板不取消下载；普通退出不启动安装；更新退出不隐藏到托盘。
- 断网、超时、限流、磁盘空间不足、下载损坏、无效签名、启动安装器失败后可恢复。不要为了通过测试关闭签名验证。
- 便携版手动替换为新版 EXE 后，用户数据仍可读。
- 数据库结构未变；未来任何结构迁移须另行增加备份恢复验收。不要承诺降级或数据库自动回滚。

测试构建不得覆盖用户当前安装、操作真实凭证，或用正式 Release 充当实验源。仅构建成功、单元测试和模拟更新面板不能代替真实升级。

## 快照发布

快照版本格式为 `X.Y.Z-snapshot.YYYYMMDD.N`，每轮公开构建使用唯一版本号和标签。先完成检查、打包校验，并在隔离账号或虚拟机中验证安装、启动和核心功能。允许保留未签名与未完成自动升级验收的限制，但必须在说明中明确，并保持自动安装关闭。

快照 Release 必须标记 Pre-release，不设为 Latest；上传本轮清单中的四项附件，其中元数据为 `snapshot.yml`。快照不能代替真实升级测试，当前也未隔离应用标识和数据目录。客户端仍只查询正式版，不发现快照；没有正式版时会提示无法确认发布信息。

## 手动发布正式版

完成签名与实机验收后再发布正式 Release。先更新 `package.json` 和锁文件版本，运行检查并生成本轮产物。将代码提交与 `vX.Y.Z` 标签绑定，在相同标签的 Release **草稿**中上传清单四个文件，核对资产名、版本、大小与校验值，写入对应发布说明，最后一次性公开。

项目打包脚本不会自动上传；可使用 GitHub CLI 或 GitHub 网页处理草稿和发布，完整命令见 [README 的发布流程](../README.md#发布到-github-releases)。不得把发布 Token 写入客户端。不得在已发布版本下替换二进制文件而不提升版本。

正式发布后匿名检查 API 和 `latest.yml`。若出现 403/429，等限流窗口恢复后再检查；客户端会保留失败状态与重试时间。404 视为无法确认发布信息，不会误报最新版。没有当前设备的包显示无适用更新；存在目标包但缺少配套文件显示发布不完整。

客户端先解析固定仓库的同一正式 Release，然后把安装更新源固定到该标签的 GitHub 附件目录，使用 generic provider 执行该版本下载。下载前再次核对正式候选、元数据和组件实际解析出的文件；后台检查不会自动下载。

日志位于 `%APPDATA%/cijing/logs/updates.log`，记录启动版本、安装形式、状态、失败阶段和安装器启动结果，不记录业务密钥。安装器启动日志并不证明升级成功，须核对下一次启动版本与数据。

参考：[electron-builder 自动更新文档](https://www.electron.build/v26/docs/features/auto-update/)、[发布配置](https://www.electron.build/v26/docs/publish/)。
