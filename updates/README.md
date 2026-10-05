# 静态更新清单

`stable.json` 是正式渠道的远端公告文件。客户端通过固定地址
`https://raw.githubusercontent.com/lychee955/cijing/main/updates/stable.json`
读取它，不请求 GitHub Releases REST API。文件必须提交到 `main`；仅在本地编辑或随安装包分发不会更新远端公告。

没有正式版时使用：

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "release": null
}
```

有正式版时，`release` 包含以下字段。由 `scripts/verify-release.cjs` 根据完整且校验通过的构建产物生成，不手填大小或校验值。

| 字段 | 含义 |
| --- | --- |
| `version` | 正式语义版本 `X.Y.Z`，不接受预发布或构建后缀 |
| `tag` | 必须等于 `v<version>` |
| `releaseUrl` | 固定仓库该标签的 HTTPS Release 页面 |
| `publishedAt` | Release 实际发布时刻，UTC ISO 字符串 |
| `notes` | 纯文本发布说明，最多 30000 字符 |
| `platforms.win32-x64.nsis` | 安装包的 `name`、`url`、`size`、`sha512` |
| `platforms.win32-x64.portable` | 便携包的独立文件信息和校验值 |
| `platforms.win32-x64.minimumSystemVersion` | 可选，与该标签 `latest.yml` 中的值一致 |

`size` 为正整数字节数，`sha512` 为 SHA-512 的 Base64 值。包名必须包含相同版本、架构和安装形式；地址必须指向固定仓库该标签的附件目录。每个平台都必须同时提供安装包与便携包。没有对应平台时显示无适用更新，不扫描历史版本。首期仅分发 Windows x64；增加架构前需单独验收打包与安装行为。

## 生成与公告

1. 构建正式版本，在产物目录校验安装包、blockmap、便携包和 `latest.yml`。
2. 公开对应 Release，确认四项附件可匿名下载。
3. 运行 `npm run release:verify -- <产物目录> --notes <说明文件> --published-at <UTC发布时间>`。脚本在产物目录生成 `stable.json`，不会上传附件，也不会覆盖仓库清单。省略参数时说明为空、日期取构建元数据的 `releaseDate`，正式公告前应填入实际发布信息。
4. 审阅候选清单，将它复制到仓库的 `updates/stable.json`，提交并推送到 `main`。发布快照不执行此步骤。
5. 检查 Raw 地址及隔离旧版客户端的检测结果。

完整命令见 [发布说明](../docs/RELEASING.md)。`release-manifest.json` 是本地产物核对清单；`stable.json` 是客户端公告，两者用途不同。调整 Fork 时同步修改客户端 `REPOSITORY` 与 builder 的 `publish.owner`、`publish.repo`，并保证静态清单位于配置地址对应的分支。

## 客户端行为

客户端先校验完整清单，再用 `semver` 比较本机版本，选择平台、架构、安装形式并检查最低系统要求。检查只读取 JSON；下载前重新检查候选，随后由现有 Electron 更新器读取固定标签的 `latest.yml`，验证文件信息、SHA-512 和 Windows 签名。普通退出不自动安装，便携版仍需手动替换。

JSON 404、损坏、断网、超时、限流都显示失败；不会当作“已是最新版”。`release: null` 明确表示暂无正式版，复用现有 `upToDate` 状态并显示对应说明。读取超时为 20 秒，响应限制为 1000000 字符，检查间隔沿用启动后 10 秒首次检查、之后每 6 小时检查。

`UPDATE_ENDPOINTS` 预留由代码配置的备用地址，当前只有仓库 Raw 源。读取失败时顺序尝试下一地址，成功获取但清单校验失败时停止，不用其他源掩盖发布错误。以后增加自有镜像时需保证清单同步，避免缓存返回旧版本。静态文件避开 REST API 的匿名配额，仍可能受访问和缓存限制；客户端无需 GitHub Token。
