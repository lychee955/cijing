import {afterEach, describe, expect, it} from "vitest";
import {createRequire} from "node:module";
import {mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {dump} from "js-yaml";
import {StaticManifestSource} from "../../src/main/updates/release-source";

const require = createRequire(import.meta.url);
const {verifyRelease} = require("../../scripts/verify-release.cjs");
const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true});
});
function artifacts(version = "0.10.0") {
    const dir = mkdtempSync(join(tmpdir(), "cijing-manifest-"));
    dirs.push(dir);
    const installer = `cijing-${version}-win-x64-setup.exe`;
    const setup = Buffer.from("setup artifact"),
        portable = Buffer.from("portable artifact");
    const checksum = (data: Buffer) => createHash("sha512").update(data).digest("base64");
    const metadata = {
        version,
        path: installer,
        sha512: checksum(setup),
        minimumSystemVersion: "10.0.0",
        releaseDate: "2026-10-05T00:00:00Z",
        files: [{url: installer, size: setup.length, sha512: checksum(setup)}]
    };
    const metadataFile = version.includes("snapshot") ? "snapshot.yml" : "latest.yml";
    writeFileSync(join(dir, installer), setup);
    writeFileSync(join(dir, installer + ".blockmap"), "blockmap");
    writeFileSync(join(dir, `cijing-${version}-win-x64-portable.exe`), portable);
    writeFileSync(join(dir, metadataFile), dump(metadata));
    return {dir, version, metadata, metadataFile, checksum, portable};
}
describe("verified static manifest generation", () => {
    it("generates a manifest consumed by the client with real artifact sizes and independent hashes", async () => {
        const f = artifacts();
        const {updateManifest, artifacts: verified} = await verifyRelease(f.dir, {
            version: f.version,
            notes: "正式发布说明",
            publishedAt: "2026-10-05T03:00:00Z"
        });
        expect(verified).toHaveLength(4);
        expect(verified.map((a: {name: string}) => a.name)).not.toContain("stable.json");
        expect(JSON.parse(readFileSync(join(f.dir, "stable.json"), "utf8"))).toEqual(updateManifest);
        const source = new StaticManifestSource(async () => new Response(JSON.stringify(updateManifest)));
        for (const installation of ["nsis", "portable"] as const) {
            expect(
                await source.check({
                    version: "0.9.0",
                    platform: "win32",
                    arch: "x64",
                    systemVersion: "10.0.26100",
                    installation,
                    channel: "stable",
                    canCheck: true,
                    canInstall: installation === "nsis"
                })
            ).toMatchObject({
                phase: "available",
                candidate: {
                    version: f.version,
                    notes: "正式发布说明",
                    minimumSystemVersion: "10.0.0",
                    publishedAt: "2026-10-05T03:00:00Z",
                    ...(installation === "portable" ? {sha512: f.checksum(f.portable), size: f.portable.length} : {})
                }
            });
        }
    });
    it("never emits a stable manifest for a snapshot", async () => {
        const f = artifacts("0.10.0-snapshot.20261005.1");
        const result = await verifyRelease(f.dir, {version: f.version});
        expect(result.updateManifest).toBeUndefined();
        expect(existsSync(join(f.dir, "stable.json"))).toBe(false);
        await expect(verifyRelease(f.dir, {version: f.version, notes: "snapshot"})).rejects.toThrow("Snapshots");
    });
    it("does not write a candidate when the actual installer differs from metadata", async () => {
        const f = artifacts();
        f.metadata.files[0]!.size++;
        writeFileSync(join(f.dir, f.metadataFile), dump(f.metadata));
        await expect(verifyRelease(f.dir, {version: f.version})).rejects.toThrow("SHA-512");
        expect(existsSync(join(f.dir, "stable.json"))).toBe(false);
    });
    it("requires all release artifacts before generating a manifest", async () => {
        const f = artifacts();
        rmSync(join(f.dir, `cijing-${f.version}-win-x64-setup.exe.blockmap`));
        await expect(verifyRelease(f.dir, {version: f.version})).rejects.toThrow();
        expect(existsSync(join(f.dir, "stable.json"))).toBe(false);
    });
    it("rejects malformed publication information and minimum system versions", async () => {
        const f = artifacts();
        await expect(verifyRelease(f.dir, {version: f.version, publishedAt: "yesterday"})).rejects.toThrow("timestamp");
        await expect(verifyRelease(f.dir, {version: f.version, notes: "x".repeat(30_001)})).rejects.toThrow(
            "characters"
        );
        for (const minimum of ["invalid", "", "v10.0.0"]) {
            f.metadata.minimumSystemVersion = minimum;
            writeFileSync(join(f.dir, f.metadataFile), dump(f.metadata));
            await expect(verifyRelease(f.dir, {version: f.version})).rejects.toThrow("Metadata");
        }
    });
});
