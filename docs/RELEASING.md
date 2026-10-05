# Windows 发布与更新

当前代码版本：0.0.2-snapshot.20261004.1，处于快照测试阶段。首期分发仓库为公开的 `lychee955/cijing`，只构建 Windows x64。首次含更新功能的版本仍须手动安装。

## 当前交付状态

- 当前仅分发快照测试版，使用 Pre-release，正式版验收条件保持不变。
- Logo 下方版本入口、更新面板、后台检查、便携版下载入口已实现。
- NSIS 下载、校验、退出协调已实现，但 `src/main/updates/policy.json` 的实机验收开关为 `false`。未验收的安装版使用发布页面手动更新。
- 不改变 `com.lychee955.cijing`、包名 `cijing`、数据库结构或用户数据位置。Windows 同一账号仍使用 `%APPDATA%/cijing/`。
- 不包括 GitHub Actions、macOS/ARM 安装支持、自动降级和真实用户数据迁移测试。
- 客户端读取源码仓库 `updates/stable.json` 的 Raw 地址，不再查询 GitHub Releases REST API。清单尚无正式版，`release` 为 `null`；该文件须推送到 `main` 后才能供客户端读取。

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

不要上传 `win-unpacked`、调试文件、旧名称安装包或无关的测试构建。快照只能以 Pre-release 发布。`release-manifest.json` 用于本地复核；正式版校验还会在产物目录生成客户端使用的 `stable.json`，它不列入四项 Release 附件，也不会自动覆盖仓库中的 `updates/stable.json`。快照不生成正式更新清单。

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

快照 Release 必须标记 Pre-release，不设为 Latest；上传本轮清单中的四项附件，其中元数据为 `snapshot.yml`。快照不能代替真实升级测试，当前也未隔离应用标识和数据目录。快照发布不得修改 `updates/stable.json`。客户端仅检查正式清单；`release: null` 显示“暂无正式版本发布。”，清单无法访问则显示检查失败。

## 手动发布正式版

完成签名与实机验收后再发布正式 Release。先更新 `package.json` 和锁文件版本，运行检查并生成本轮产物。将代码提交与 `vX.Y.Z` 标签绑定，在相同标签的 Release **草稿**中上传清单四个文件，核对资产名、版本、大小与校验值，写入对应发布说明，最后一次性公开。

项目打包脚本不会自动上传；可使用 GitHub CLI 或 GitHub 网页处理草稿和发布，操作命令见下节。不得把发布 Token 写入客户端。不得在已发布版本下替换二进制文件而不提升版本。

正式发布后先确认四项附件可匿名下载，再将生成的 `stable.json` 更新到仓库的 `updates/stable.json` 并推送 `main`。客户端每次检查只请求一次静态 JSON，校验整个清单后比较版本、匹配平台、架构、安装形式和最低系统版本。没有对应平台显示无适用更新；清单缺字段、地址或校验值无效显示发布不完整。404、断网、超时和 403/429 保持检查失败，不能解释为最新版。

客户端从静态清单取得正式候选，再把安装更新源固定到该标签的 GitHub 附件目录，使用 generic provider 执行该版本下载。用户下载前再次读取静态清单核对候选；下载时读取该标签的 `latest.yml`，核对文件名、大小、SHA-512 和最低系统版本，再执行文件与 Windows 签名校验。检查阶段不请求 `latest.yml`，后台检查不会自动下载。

日志位于 `%APPDATA%/cijing/logs/updates.log`，记录启动版本、安装形式、状态、失败阶段和安装器启动结果，不记录业务密钥。安装器启动日志并不证明升级成功，须核对下一次启动版本与数据。

## 发布操作

以下以快照 `0.0.2-snapshot.20261004.1` 为例。后续发布要换成尚未发布的版本号；正式版还须满足上文的签名与实机验收条件。需要目标仓库的写入及发布权限。若发布自己的 Fork，先将 `origin` 指向该仓库，并在构建前同步修改 `electron-builder.yml` 的 `publish.owner` / `publish.repo` 和 `src/main/updates/release-source.ts` 的 `REPOSITORY`。

1. **确定版本和说明。** 在同一个 PowerShell 会话中设置变量，并参照[发布说明模板](RELEASE_NOTES_TEMPLATE.md)编写本次说明：

   ```powershell
   $version = '0.0.2-snapshot.20261004.1'
   $tag = "v$version"
   $repo = 'lychee955/cijing' # Fork 发布时改为自己的 owner/repo
   $notes = "docs/RELEASE_NOTES_$version.md"
   if ((Get-Content package.json -Raw | ConvertFrom-Json).version -ne $version) {
     npm version $version --no-git-tag-version
   }
   ```

   如需提升版本，`npm version` 会同步更新 `package.json` 与 `package-lock.json`，不创建提交或标签。同步更新本文开头的当前版本。快照编号格式为 `X.Y.Z-snapshot.YYYYMMDD.N`；正式版使用 `X.Y.Z`。

2. **构建并核对产物。** 任何检查失败都应先解决再继续。将目录替换为本次命令输出的真实路径，修改代码或版本后需重新构建。

   ```powershell
   npm run check
   npm run test:e2e
   npm run dist
   $releaseDir = 'dist/release-0.0.2-snapshot.20261004.1-实际时间戳'
   npm run release:verify -- $releaseDir
   $manifest = Get-Content -LiteralPath (Join-Path $releaseDir 'release-manifest.json') -Raw | ConvertFrom-Json
   if ($manifest.version -ne $version) { throw '产物版本与待发布版本不一致' }
   $metadataFile = $manifest.metadataFile
   $assets = @($manifest.artifacts | ForEach-Object { Join-Path $releaseDir $_.name })
   $manifest.artifacts | Format-Table name, size, sha256 -AutoSize
   ```

   在测试账号或虚拟机中确认安装、启动与核心功能。只上传清单中的四项附件；`release-manifest.json` 留在本地，不上传 `win-unpacked/` 或其他中间文件。

3. **提交并推送代码与标签。** 检查工作区，仅暂存本次发布的文件。以下命令暂存版本文件和发布说明；其他本次变更也要用 `git add -- 文件路径` 明确暂存。若仓库要求通过 PR 合并，先合并，再从最终发布提交构建并打标签。

   ```powershell
   git status --short
   git diff
   git add -- package.json package-lock.json $notes
   git diff --cached --check
   git diff --cached --stat
   git commit -m "chore: release $tag"
   git tag $tag
   git push --atomic origin HEAD "refs/tags/$tag"
   ```

   确认 `origin` 对应 `$repo`，附件由标签所指代码构建。已发布标签和安装包不应覆盖；后续修改应提升版本号。

4. **创建草稿、核对附件并公开。** 以下命令使用 [GitHub CLI](https://cli.github.com/)；首次使用前运行 `gh auth login`、`gh auth status`，HTTPS 推送需要时运行 `gh auth setup-git`。

   ```powershell
   gh release create $tag @assets --repo $repo --draft --prerelease --latest=false --verify-tag --title "词境 $tag" --notes-file $notes
   gh release view $tag --repo $repo --json tagName,isDraft,assets,url
   gh release view $tag --repo $repo --web
   gh api "repos/$repo/releases/tags/$tag" --jq '.assets[] | {name, size, digest}'
   ```

   对照本地清单核对版本、附件名称、大小和 SHA-256。上传中断时，先检查草稿现有附件，再用 `gh release upload $tag "缺失文件的完整路径" --repo $repo` 补传。确认完整后公开快照：

   ```powershell
   gh release edit $tag --repo $repo --draft=false --prerelease --latest=false
   gh release view $tag --repo $repo --json tagName,isDraft,url
   ```

   也可在 GitHub 网页的 **Releases → Draft a new release** 中选择已推送标签、填写说明、上传四项附件，勾选 **Set as a pre-release** 且不设为 Latest，核对后公开。网页方式无需安装 GitHub CLI。

公开后检查 Release 页面及四项附件可匿名访问，元数据版本与安装包一致。正式版草稿不加 `--prerelease`；公开时使用 `--prerelease=false --latest`，元数据为 `latest.yml`。CLI 参数见[创建 Release](https://cli.github.com/manual/gh_release_create)、[上传附件](https://cli.github.com/manual/gh_release_upload)和[发布草稿](https://cli.github.com/manual/gh_release_edit)。

5. **正式版公开后更新静态清单。** 快照跳过本步骤。完成附件匿名下载核对后，使用实际发布日期与发布说明重新生成清单，审阅后提交到 `main`：

   ```powershell
   # $releaseDir、$notes、$version 均须对应刚公开的正式版
   $publishedAt = '2026-10-05T03:00:00Z' # 替换为实际 Release 的 UTC 发布时刻
   npm run release:verify -- $releaseDir --notes $notes --published-at $publishedAt
   if ($LASTEXITCODE -ne 0) { throw '更新清单生成失败' }
   $stable = Get-Content -LiteralPath (Join-Path $releaseDir 'stable.json') -Raw | ConvertFrom-Json
   if ($stable.channel -ne 'stable' -or $stable.release.version -ne $version) { throw '清单渠道或版本不一致' }
   Copy-Item -LiteralPath (Join-Path $releaseDir 'stable.json') -Destination 'updates/stable.json'
   git diff -- updates/stable.json
   git add -- updates/stable.json
   git commit -m "chore: announce stable $version"
   git push origin HEAD:main
   ```

   若仓库要求 PR，合并清单变更到 `main` 后才算完成更新公告。清单更新提交晚于应用构建标签是正常流程。验证 `https://raw.githubusercontent.com/lychee955/cijing/main/updates/stable.json` 返回对应版本，随后在隔离旧版客户端检查。旧客户端的更新地址已编译在应用中，必须先安装含本次改动的版本才能使用静态源。JSON 格式、异常处理和备用地址规则见 [静态更新清单](../updates/README.md)。

参考：[electron-builder 自动更新文档](https://www.electron.build/v26/docs/features/auto-update/)、[发布配置](https://www.electron.build/v26/docs/publish/)。
