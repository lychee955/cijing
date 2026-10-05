import {gt, valid, prerelease, lt} from "semver";
import {z} from "zod";
import type {UpdateCandidate, UpdateEnvironment} from "../../shared/update";
import {retryAfterDelay} from "../../shared/retry-after";

export const REPOSITORY = "lychee955/cijing";
export const UPDATE_ENDPOINTS: readonly string[] = [
    `https://raw.githubusercontent.com/${REPOSITORY}/main/updates/stable.json`
];
const root = `https://github.com/${REPOSITORY}/releases`;
const sha512Schema = z.string().regex(/^[A-Za-z0-9+/]{86}==$/);
const assetSchema = z.strictObject({
    name: z.string(),
    size: z.number().int().positive(),
    url: z.string().url(),
    sha512: sha512Schema
});
export const updateManifestSchema = z.strictObject({
    schemaVersion: z.literal(1),
    channel: z.literal("stable"),
    release: z
        .strictObject({
            version: z.string(),
            tag: z.string(),
            releaseUrl: z.string().url(),
            publishedAt: z.iso.datetime(),
            notes: z.string().max(30_000),
            platforms: z.record(
                z.string().regex(/^win32-(x64|arm64|ia32)$/),
                z.strictObject({
                    nsis: assetSchema,
                    portable: assetSchema,
                    minimumSystemVersion: z.string().optional()
                })
            )
        })
        .nullable()
});
const metadataSchema = z.object({
    version: z.string(),
    files: z
        .array(
            z.object({
                url: z.string(),
                sha512: sha512Schema,
                size: z.number().int().positive()
            })
        )
        .length(1),
    path: z.string().optional(),
    sha512: z.string().optional(),
    minimumSystemVersion: z.string().optional(),
    packages: z.unknown().optional(),
    stagingPercentage: z.unknown().optional()
});
export class UpdateFailure extends Error {
    constructor(
        message: string,
        readonly retryAt?: number
    ) {
        super(message);
    }
}
class IncompatibleSystem extends UpdateFailure {}
export type ReleaseResult =
    | {phase: "upToDate" | "noCompatiblePackage"; message: string}
    | {phase: "available"; candidate: UpdateCandidate; message: string};
export type UpdateFetch = (url: string, init: RequestInit) => Promise<Response>;
export function releaseUrl(tag: string): string {
    if (!/^v\d+\.\d+\.\d+$/.test(tag) || !valid(tag)) throw new UpdateFailure("更新发布不完整：版本标签无效。");
    return `${root}/tag/${tag}`;
}
export function downloadBase(tag: string): string {
    releaseUrl(tag);
    return `${root}/download/${tag}/`;
}
export function validateReleaseUrl(url: string, tag: string): void {
    if (url !== releaseUrl(tag)) throw new UpdateFailure("更新发布地址无效。");
}
export function validateMetadata(raw: unknown, candidate: UpdateCandidate, systemVersion: string): void {
    const parsed = metadataSchema.safeParse(raw);
    if (!parsed.success) throw new UpdateFailure("更新发布不完整：更新元数据无效。");
    const info = parsed.data,
        file = info.files[0]!;
    if (
        info.version !== candidate.version ||
        file.url !== candidate.assetName ||
        file.size !== candidate.size ||
        (candidate.sha512 && file.sha512 !== candidate.sha512) ||
        info.minimumSystemVersion !== candidate.minimumSystemVersion ||
        (info.path && info.path !== file.url) ||
        (info.sha512 && info.sha512 !== file.sha512) ||
        info.packages !== undefined ||
        info.stagingPercentage !== undefined
    )
        throw new UpdateFailure("更新发布不完整：版本、文件或校验信息不一致。");
    if (
        info.minimumSystemVersion !== undefined &&
        (valid(info.minimumSystemVersion) !== info.minimumSystemVersion || !valid(systemVersion))
    )
        throw new UpdateFailure("更新发布不完整：无法判断最低系统要求。");
    if (info.minimumSystemVersion && lt(systemVersion, info.minimumSystemVersion))
        throw new IncompatibleSystem("新版需要更高的系统版本，暂不适用于此设备。");
    candidate.sha512 = file.sha512;
    candidate.minimumSystemVersion = info.minimumSystemVersion;
}

export class StaticManifestSource {
    constructor(
        private readonly fetcher: UpdateFetch,
        private readonly now = Date.now,
        private readonly endpoints: readonly string[] = UPDATE_ENDPOINTS
    ) {}
    private async read(url: string): Promise<unknown> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
            const response = await this.fetcher(url, {
                headers: {
                    Accept: "application/json"
                },
                signal: controller.signal,
                credentials: "omit",
                cache: "no-cache"
            });
            if (response.status === 403 || response.status === 429) {
                const retry = response.headers.get("retry-after"),
                    reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
                const now = this.now();
                const delay = retryAfterDelay(retry, now, true);
                const retryTime = delay === undefined ? 0 : now + delay;
                throw new UpdateFailure(
                    "更新源暂时限制访问，请稍后重试。",
                    Math.max(this.now() + 60_000, reset || 0, retryTime || 0)
                );
            }
            if (!response.ok)
                throw new UpdateFailure(
                    response.status === 404
                        ? "无法读取正式更新清单，发布可能尚未完成，请稍后重试。"
                        : "更新检查失败，请检查网络后重试。"
                );
            const text = await response.text();
            if (text.length > 1_000_000) throw new UpdateFailure("更新发布信息过大，无法安全读取。");
            return JSON.parse(text);
        } catch (error) {
            if (error instanceof UpdateFailure) throw error;
            throw new UpdateFailure(
                controller.signal.aborted ? "更新检查超时，请稍后重试。" : "无法读取更新信息，请检查网络后重试。"
            );
        } finally {
            clearTimeout(timer);
        }
    }
    private async readManifest(): Promise<unknown> {
        let failure: unknown = new UpdateFailure("未配置更新源。");
        for (const endpoint of this.endpoints) {
            try {
                return await this.read(endpoint);
            } catch (error) {
                failure = error;
            }
        }
        throw failure;
    }
    async check(env: UpdateEnvironment): Promise<ReleaseResult> {
        const parsed = updateManifestSchema.safeParse(await this.readManifest());
        if (!parsed.success) throw new UpdateFailure("更新发布不完整：更新清单格式无效。");
        const release = parsed.data.release;
        if (!valid(env.version)) throw new UpdateFailure("无法比较应用版本。");
        if (!release) return {phase: "upToDate", message: "暂无正式版本发布。"};
        const version = valid(release.version);
        if (!version || version !== release.version) throw new UpdateFailure("无法比较应用版本。");
        if (prerelease(version)) throw new UpdateFailure("正式更新源返回了非正式版本，请稍后重试。");
        if (release.tag !== `v${version}`) throw new UpdateFailure("更新发布不完整：版本与标签不一致。");
        validateReleaseUrl(release.releaseUrl, release.tag);
        const base = downloadBase(release.tag);
        // Validate every entry before comparing versions, including packages for other architectures.
        for (const [target, platform] of Object.entries(release.platforms)) {
            const arch = target.slice("win32-".length);
            for (const kind of ["nsis", "portable"] as const) {
                const asset = platform[kind];
                const name = `cijing-${version}-win-${arch}-${kind === "nsis" ? "setup" : "portable"}.exe`;
                if (asset.name !== name || asset.url !== base + name)
                    throw new UpdateFailure("更新发布不完整：附件地址、版本或架构不匹配。");
            }
            if (
                platform.minimumSystemVersion !== undefined &&
                valid(platform.minimumSystemVersion) !== platform.minimumSystemVersion
            )
                throw new UpdateFailure("更新发布不完整：无法判断最低系统要求。");
        }
        if (!gt(version, env.version)) return {phase: "upToDate", message: "已是正式渠道的最新适用版本。"};
        const platform = release.platforms[`${env.platform}-${env.arch}`];
        if (!platform || !["nsis", "portable"].includes(env.installation))
            return {
                phase: "noCompatiblePackage",
                message: "暂无适用于此设备的更新包。"
            };
        if (platform.minimumSystemVersion) {
            if (!valid(env.systemVersion)) throw new UpdateFailure("无法判断当前系统是否适用于新版。");
            if (lt(env.systemVersion, platform.minimumSystemVersion))
                return {phase: "noCompatiblePackage", message: "新版需要更高的系统版本，暂不适用于此设备。"};
        }
        const asset = env.installation === "portable" ? platform.portable : platform.nsis;
        const candidate: UpdateCandidate = {
            version,
            tag: release.tag,
            releaseUrl: release.releaseUrl,
            assetName: asset.name,
            assetUrl: asset.url,
            size: asset.size,
            sha512: asset.sha512,
            minimumSystemVersion: platform.minimumSystemVersion,
            publishedAt: release.publishedAt,
            notes: release.notes
        };
        return {
            phase: "available",
            candidate,
            message: env.canInstall ? "发现新版本，下载后可重启安装。" : "发现新版本，可前往发布页面下载。"
        };
    }
}
