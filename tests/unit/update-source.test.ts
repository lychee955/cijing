import {afterEach, describe, expect, it, vi} from "vitest";
import stableManifest from "../../updates/stable.json";
import {
    StaticManifestSource,
    UPDATE_ENDPOINTS,
    updateManifestSchema,
    validateMetadata,
    validateReleaseUrl
} from "../../src/main/updates/release-source";
import type {UpdateEnvironment} from "../../src/shared/update";

const env: UpdateEnvironment = {
    version: "0.9.0",
    platform: "win32",
    arch: "x64",
    systemVersion: "10.0.26100",
    installation: "nsis",
    channel: "stable",
    canCheck: true,
    canInstall: true
};
const sha512 = Buffer.alloc(64, 1).toString("base64");
const portableHash = Buffer.alloc(64, 2).toString("base64");
function fixture(version = "0.10.0") {
    const tag = `v${version}`;
    const base = `https://github.com/lychee955/cijing/releases/download/${tag}/`;
    const asset = (kind: string, hash: string) => {
        const name = `cijing-${version}-win-x64-${kind}.exe`;
        return {name, url: base + name, size: 100, sha512: hash};
    };
    const platform = {
        nsis: asset("setup", sha512),
        portable: asset("portable", portableHash),
        minimumSystemVersion: "10.0.0"
    };
    const manifest = {
        schemaVersion: 1,
        channel: "stable",
        release: {
            version,
            tag,
            releaseUrl: `https://github.com/lychee955/cijing/releases/tag/${tag}`,
            publishedAt: "2026-10-03T00:00:00Z",
            notes: "<script>alert(1)</script>",
            platforms: {"win32-x64": platform}
        }
    };
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(manifest)));
    return {manifest, platform, fetcher, source: new StaticManifestSource(fetcher)};
}

describe("static update manifest", () => {
    afterEach(() => vi.useRealTimers());
    it("checks with one Raw JSON request, without API calls, metadata requests or credentials", async () => {
        const f = fixture();
        expect(await f.source.check(env)).toMatchObject({
            phase: "available",
            candidate: {version: "0.10.0", sha512, minimumSystemVersion: "10.0.0", notes: f.manifest.release.notes}
        });
        expect(f.fetcher).toHaveBeenCalledOnce();
        expect(f.fetcher.mock.calls[0]![0]).toBe(
            "https://raw.githubusercontent.com/lychee955/cijing/main/updates/stable.json"
        );
        expect(UPDATE_ENDPOINTS).toEqual([f.fetcher.mock.calls[0]![0]]);
        expect(f.fetcher.mock.calls[0]![1]).toMatchObject({
            headers: {Accept: "application/json"},
            credentials: "omit",
            cache: "no-cache"
        });
        expect(f.fetcher.mock.calls[0]![1].headers).not.toHaveProperty("Authorization");
    });
    it.each(["0.9.0", "0.8.9"])("does not update to equal or older %s", async (version) => {
        expect(await fixture(version).source.check(env)).toMatchObject({phase: "upToDate"});
    });
    it("keeps the checked-in manifest compatible with the client schema", () => {
        expect(updateManifestSchema.safeParse(stableManifest).success).toBe(true);
    });
    it("represents the absence of a stable release explicitly", async () => {
        const source = new StaticManifestSource(
            async () => new Response(JSON.stringify({schemaVersion: 1, channel: "stable", release: null}))
        );
        expect(await source.check(env)).toEqual({phase: "upToDate", message: "暂无正式版本发布。"});
    });
    it.each(["0.10.0-beta.1", "0.10.0-snapshot.20261004.1"])("rejects prerelease %s", async (version) => {
        await expect(fixture(version).source.check(env)).rejects.toThrow("非正式");
    });
    it.each([{platform: "darwin"}, {arch: "arm64"}, {installation: "unknown" as const}])(
        "does not offer a package for an unsupported environment %o",
        async (patch) => {
            expect(await fixture().source.check({...env, ...patch})).toMatchObject({phase: "noCompatiblePackage"});
        }
    );
    it("selects the portable file and its own checksum", async () => {
        expect(await fixture().source.check({...env, installation: "portable", canInstall: false})).toMatchObject({
            phase: "available",
            candidate: {assetName: "cijing-0.10.0-win-x64-portable.exe", sha512: portableHash}
        });
    });
    it("treats an absent platform as no compatible package", async () => {
        const f = fixture();
        f.manifest.release.platforms = {} as typeof f.manifest.release.platforms;
        expect(await f.source.check(env)).toMatchObject({phase: "noCompatiblePackage"});
    });
    it.each(["nsis", "portable"])("rejects a partial platform missing %s", async (kind) => {
        const f = fixture();
        Reflect.deleteProperty(f.platform, kind);
        await expect(f.source.check(env)).rejects.toThrow("不完整");
    });
    it.each([
        {url: "https://evil.test/setup.exe"},
        {url: "https://github.com/other/repo/releases/download/v0.10.0/setup.exe"},
        {name: "cijing-0.10.0-win-arm64-setup.exe"},
        {sha512: "wrong"},
        {size: 0}
    ])("rejects mismatched or malformed package information %o", async (patch) => {
        const f = fixture();
        Object.assign(f.platform.nsis, patch);
        await expect(f.source.check(env)).rejects.toThrow("不完整");
    });
    it("validates unselected packages before reporting up to date", async () => {
        const f = fixture("0.8.0");
        f.platform.portable.url = "https://evil.test/portable.exe";
        await expect(f.source.check(env)).rejects.toThrow("不完整");
    });
    it.each([
        {tag: "v0.11.0"},
        {releaseUrl: "https://evil.test/"},
        {publishedAt: "yesterday"},
        {version: "nonsense"},
        {notes: "x".repeat(30_001)}
    ])("rejects inconsistent release fields %o", async (patch) => {
        const f = fixture();
        Object.assign(f.manifest.release, patch);
        await expect(f.source.check(env)).rejects.toThrow();
    });
    it.each([{schemaVersion: 2}, {channel: "snapshot"}, {release: undefined}])(
        "rejects unsupported or incomplete manifest %o",
        async (patch) => {
            const f = fixture();
            Object.assign(f.manifest, patch);
            await expect(f.source.check(env)).rejects.toThrow("清单格式");
        }
    );
    it("enforces minimum OS for both installation forms", async () => {
        const f = fixture();
        f.platform.minimumSystemVersion = "11.0.0";
        for (const installation of ["nsis", "portable"] as const)
            expect(await f.source.check({...env, installation})).toMatchObject({phase: "noCompatiblePackage"});
        await expect(f.source.check({...env, systemVersion: "unknown"})).rejects.toThrow("当前系统");
        for (const minimum of ["invalid", "", "v10.0.0"]) {
            f.platform.minimumSystemVersion = minimum;
            await expect(f.source.check(env)).rejects.toThrow("最低系统");
        }
    });
    it.each([404, 500])("keeps HTTP %s failures distinct from up to date", async (status) => {
        const source = new StaticManifestSource(async () => new Response("", {status}));
        await expect(source.check(env)).rejects.toThrow(status === 404 ? "清单" : "网络");
    });
    it("maps offline and invalid JSON to failures", async () => {
        await expect(
            new StaticManifestSource(async () => {
                throw new Error("secret");
            }).check(env)
        ).rejects.toThrow("网络");
        await expect(new StaticManifestSource(async () => new Response("<html>")).check(env)).rejects.toThrow("网络");
    });
    it("preserves rate-limit cooldown", async () => {
        const source = new StaticManifestSource(
            async () => new Response("", {status: 429, headers: {"retry-after": "120"}}),
            () => 1000
        );
        await expect(source.check(env)).rejects.toMatchObject({retryAt: 121000});
    });
    it("times out stalled requests", async () => {
        vi.useFakeTimers();
        const source = new StaticManifestSource(
            async (_url, init) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal!.addEventListener("abort", () => reject(new Error("aborted")), {once: true});
                })
        );
        const assertion = expect(source.check(env)).rejects.toThrow("超时");
        await vi.advanceTimersByTimeAsync(20_000);
        await assertion;
    });
    it("rejects oversized responses", async () => {
        await expect(
            new StaticManifestSource(async () => new Response("x".repeat(1_000_001))).check(env)
        ).rejects.toThrow("过大");
    });
    it("can fall back to another configured endpoint after a transport failure", async () => {
        const f = fixture();
        f.fetcher.mockRejectedValueOnce(new Error("offline"));
        const endpoints = ["https://primary.test/stable.json", "https://backup.test/stable.json"];
        expect(await new StaticManifestSource(f.fetcher, Date.now, endpoints).check(env)).toMatchObject({
            phase: "available"
        });
        expect(f.fetcher.mock.calls.map(([url]) => url)).toEqual(endpoints);
    });
    it("does not mask a malformed manifest using a backup", async () => {
        const f = fixture();
        f.manifest.schemaVersion = 2;
        await expect(
            new StaticManifestSource(f.fetcher, Date.now, ["https://one.test", "https://two.test"]).check(env)
        ).rejects.toThrow("清单格式");
        expect(f.fetcher).toHaveBeenCalledOnce();
    });
});

describe("download metadata remains pinned to the manifest", () => {
    async function candidate() {
        const result = await fixture().source.check(env);
        if (result.phase !== "available") throw new Error("Expected candidate");
        const selected = result.candidate;
        const metadata = {
            version: selected.version,
            path: selected.assetName,
            sha512: selected.sha512,
            minimumSystemVersion: selected.minimumSystemVersion,
            files: [{url: selected.assetName, sha512: selected.sha512, size: selected.size}]
        };
        return {selected, metadata};
    }
    it("accepts matching metadata and rejects version, file, checksum, size and OS changes", async () => {
        const {selected, metadata} = await candidate();
        expect(() => validateMetadata(metadata, {...selected}, env.systemVersion)).not.toThrow();
        for (const patch of [
            {version: "0.11.0"},
            {path: "arm64.exe"},
            {sha512: "wrong"},
            {files: [{...metadata.files[0], size: 101}]},
            {files: [...metadata.files, ...metadata.files]},
            {minimumSystemVersion: "11.0.0"},
            {minimumSystemVersion: undefined},
            {packages: {}},
            {stagingPercentage: 50}
        ])
            expect(() => validateMetadata({...metadata, ...patch}, {...selected}, env.systemVersion)).toThrow("不完整");
        expect(() => validateMetadata(metadata, {...selected}, "9.0.0")).toThrow("更高");
    });
    it.each([
        "http://github.com/lychee955/cijing/releases/tag/v0.10.0",
        "https://evil.test/",
        "https://github.com/other/repo/releases/tag/v0.10.0",
        "https://github.com/lychee955/cijing/releases/tag/v0.10.0?x=1"
    ])("refuses untrusted release URL %s", (url) => {
        expect(() => validateReleaseUrl(url, "v0.10.0")).toThrow();
    });
});
