import {load, JSON_SCHEMA} from "js-yaml";
import {gt, valid, prerelease, lt} from "semver";
import {z} from "zod";
import type {UpdateCandidate, UpdateEnvironment} from "../../shared/update";

export const REPOSITORY = "lychee955/cijing";
const root = `https://github.com/${REPOSITORY}/releases`;
const assetSchema = z.object({
    name: z.string(),
    size: z.number().int().positive(),
    browser_download_url: z.string().url()
});
const releaseSchema = z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    html_url: z.string().url(),
    published_at: z.string(),
    body: z.string().nullable(),
    assets: z.array(assetSchema).max(100)
});
const metadataSchema = z.object({
    version: z.string(),
    files: z
        .array(
            z.object({
                url: z.string(),
                sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
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
        (info.path && info.path !== file.url) ||
        (info.sha512 && info.sha512 !== file.sha512) ||
        info.packages !== undefined ||
        info.stagingPercentage !== undefined
    )
        throw new UpdateFailure("更新发布不完整：版本、文件或校验信息不一致。");
    if (info.minimumSystemVersion && (!valid(info.minimumSystemVersion) || !valid(systemVersion)))
        throw new UpdateFailure("更新发布不完整：无法判断最低系统要求。");
    if (info.minimumSystemVersion && lt(systemVersion, info.minimumSystemVersion))
        throw new IncompatibleSystem("新版需要更高的系统版本，暂不适用于此设备。");
    candidate.sha512 = file.sha512;
    candidate.minimumSystemVersion = info.minimumSystemVersion;
}

export class GithubReleaseSource {
    constructor(
        private readonly fetcher: UpdateFetch,
        private readonly now = Date.now
    ) {}
    private async read(url: string, json: boolean): Promise<unknown> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
            const response = await this.fetcher(url, {
                headers: {
                    Accept: json ? "application/vnd.github+json" : "application/octet-stream"
                },
                signal: controller.signal,
                credentials: "omit"
            });
            if (response.status === 403 || response.status === 429) {
                const retry = response.headers.get("retry-after"),
                    reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
                const retryTime = retry
                    ? /^\d+$/.test(retry)
                        ? this.now() + Number(retry) * 1000
                        : Date.parse(retry)
                    : 0;
                throw new UpdateFailure(
                    "GitHub 暂时限制访问，请稍后重试。",
                    Math.max(this.now() + 60_000, reset || 0, retryTime || 0)
                );
            }
            if (!response.ok)
                throw new UpdateFailure(
                    response.status === 404
                        ? "无法确认正式发布信息或附件，发布可能尚未完成，请稍后重试。"
                        : "更新检查失败，请检查网络后重试。"
                );
            const text = await response.text();
            if (text.length > 1_000_000) throw new UpdateFailure("更新发布信息过大，无法安全读取。");
            return json ? JSON.parse(text) : load(text, {schema: JSON_SCHEMA});
        } catch (error) {
            if (error instanceof UpdateFailure) throw error;
            throw new UpdateFailure(
                controller.signal.aborted ? "更新检查超时，请稍后重试。" : "无法读取更新信息，请检查网络后重试。"
            );
        } finally {
            clearTimeout(timer);
        }
    }
    async check(env: UpdateEnvironment): Promise<ReleaseResult> {
        const raw = await this.read(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, true);
        const parsed = releaseSchema.safeParse(raw);
        if (!parsed.success) throw new UpdateFailure("更新发布信息无效，请稍后重试。");
        const release = parsed.data,
            version = valid(release.tag_name);
        if (!version || !valid(env.version)) throw new UpdateFailure("无法比较应用版本。");
        if (release.draft || release.prerelease || prerelease(version))
            throw new UpdateFailure("正式更新源返回了非正式版本，请稍后重试。");
        validateReleaseUrl(release.html_url, release.tag_name);
        if (!gt(version, env.version)) return {phase: "upToDate", message: "已是正式渠道的最新适用版本。"};
        const suffix = env.installation === "portable" ? "portable" : "setup";
        const name = `cijing-${version}-win-${env.arch}-${suffix}.exe`;
        const asset = release.assets.find((a) => a.name === name);
        if (env.platform !== "win32" || !asset)
            return {
                phase: "noCompatiblePackage",
                message: "暂无适用于此设备的更新包。"
            };
        const base = downloadBase(release.tag_name);
        if (asset.browser_download_url !== base + name) throw new UpdateFailure("更新发布不完整：附件地址不匹配。");
        const candidate: UpdateCandidate = {
            version,
            tag: release.tag_name,
            releaseUrl: release.html_url,
            assetName: name,
            assetUrl: asset.browser_download_url,
            size: asset.size,
            publishedAt: release.published_at,
            notes: (release.body ?? "").slice(0, 30_000)
        };
        // Both distribution forms follow the same complete-release policy; latest.yml describes NSIS only.
        const setupName = `cijing-${version}-win-${env.arch}-setup.exe`;
        const portableName = `cijing-${version}-win-${env.arch}-portable.exe`;
        for (const required of [setupName, `${setupName}.blockmap`, portableName, "latest.yml"]) {
            const entries = release.assets.filter((a) => a.name === required);
            if (entries.length !== 1 || entries[0]!.browser_download_url !== base + required)
                throw new UpdateFailure("更新发布不完整：缺少安装包、便携包或更新元数据。");
        }
        const setup = release.assets.find((a) => a.name === setupName)!;
        const installer = {
            ...candidate,
            assetName: setupName,
            assetUrl: setup.browser_download_url,
            size: setup.size
        };
        try {
            validateMetadata(await this.read(base + "latest.yml", false), installer, env.systemVersion);
        } catch (error) {
            if (error instanceof IncompatibleSystem) return {phase: "noCompatiblePackage", message: error.message};
            throw error;
        }
        if (env.installation === "nsis") Object.assign(candidate, installer);
        return {
            phase: "available",
            candidate,
            message: env.canInstall ? "发现新版本，下载后可重启安装。" : "发现新版本，可前往发布页面下载。"
        };
    }
}
