const {readFileSync, statSync, createReadStream, writeFileSync} = require("node:fs");
const {resolve, join} = require("node:path");
const {createHash} = require("node:crypto");
const yaml = require("js-yaml");
const {valid} = require("semver");
const {z} = require("zod");
const {version} = require("../package.json");
const {releaseConfig} = require("./release-config.cjs");
async function hash(path, algorithm, encoding) {
    const digest = createHash(algorithm);
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    return digest.digest(encoding);
}
async function verifyRelease(dir, options = {}) {
    dir = resolve(dir);
    const releaseVersion = options.version ?? version;
    const config = releaseConfig(releaseVersion);
    const installer = `cijing-${releaseVersion}-win-x64-setup.exe`;
    const portable = `cijing-${releaseVersion}-win-x64-portable.exe`;
    const names = [installer, `${installer}.blockmap`, portable, config.metadataFile];
    const info = yaml.load(readFileSync(join(dir, config.metadataFile), "utf8"), {
        schema: yaml.JSON_SCHEMA
    });
    if (
        info.version !== releaseVersion ||
        info.files?.length !== 1 ||
        info.path !== installer ||
        info.files[0].url !== installer ||
        (info.minimumSystemVersion !== undefined &&
            (typeof info.minimumSystemVersion !== "string" ||
                valid(info.minimumSystemVersion) !== info.minimumSystemVersion)) ||
        info.packages !== undefined ||
        info.stagingPercentage !== undefined
    )
        throw new Error("Metadata does not describe this Windows x64 NSIS release.");
    const manifest = [];
    for (const name of names) {
        const path = join(dir, name),
            size = statSync(path).size;
        if (!size) throw new Error(`Empty artifact: ${name}`);
        manifest.push({name, size, sha256: await hash(path, "sha256", "hex")});
    }
    const sha512 = await hash(join(dir, installer), "sha512", "base64");
    if (info.files[0].size !== manifest[0].size || info.files[0].sha512 !== sha512 || info.sha512 !== sha512)
        throw new Error("Generated size or SHA-512 does not match the installer.");
    let updateManifest;
    if (!config.prerelease) {
        if (!/^\d+\.\d+\.\d+$/.test(releaseVersion))
            throw new Error("Stable update versions must use X.Y.Z without build metadata.");
        const publishedAt = options.publishedAt ?? info.releaseDate ?? new Date().toISOString();
        if (!z.iso.datetime().safeParse(publishedAt).success)
            throw new Error("Publication date must be an ISO UTC timestamp.");
        const notes = options.notes ?? "";
        if (typeof notes !== "string" || notes.length > 30_000)
            throw new Error("Release notes must contain at most 30000 characters.");
        const builder = yaml.load(readFileSync(join(__dirname, "../electron-builder.yml"), "utf8"), {
            schema: yaml.JSON_SCHEMA
        });
        const {owner, repo} = builder.publish;
        if (![owner, repo].every((part) => typeof part === "string" && /^[A-Za-z0-9_.-]+$/.test(part)))
            throw new Error("Invalid GitHub distribution repository.");
        const root = `https://github.com/${owner}/${repo}/releases`;
        const tag = `v${releaseVersion}`;
        updateManifest = {
            schemaVersion: 1,
            channel: "stable",
            release: {
                version: releaseVersion,
                tag,
                releaseUrl: `${root}/tag/${tag}`,
                publishedAt,
                notes,
                platforms: {
                    "win32-x64": {
                        nsis: {
                            name: installer,
                            url: `${root}/download/${tag}/${installer}`,
                            size: manifest[0].size,
                            sha512
                        },
                        portable: {
                            name: portable,
                            url: `${root}/download/${tag}/${portable}`,
                            size: manifest[2].size,
                            sha512: await hash(join(dir, portable), "sha512", "base64")
                        },
                        ...(info.minimumSystemVersion ? {minimumSystemVersion: info.minimumSystemVersion} : {})
                    }
                }
            }
        };
    } else if (options.notes !== undefined || options.publishedAt !== undefined) {
        throw new Error("Snapshots cannot generate a stable update manifest.");
    }
    writeFileSync(
        join(dir, "release-manifest.json"),
        JSON.stringify({version: releaseVersion, tag: `v${releaseVersion}`, ...config, artifacts: manifest}, null, 2) +
            "\n"
    );
    if (updateManifest) writeFileSync(join(dir, "stable.json"), JSON.stringify(updateManifest, null, 2) + "\n");
    return {updateManifest, artifacts: manifest};
}
async function main() {
    if (!process.argv[2]) throw new Error("Pass the exact release output directory to verify.");
    const options = {};
    for (let i = 3; i < process.argv.length; i += 2) {
        const flag = process.argv[i],
            value = process.argv[i + 1];
        if (!value || !["--notes", "--published-at"].includes(flag))
            throw new Error("Expected --notes <file> or --published-at <ISO UTC timestamp>.");
        if (flag === "--notes") options.notes = readFileSync(resolve(value), "utf8");
        else options.publishedAt = value;
    }
    const dir = resolve(process.argv[2]);
    const {updateManifest, artifacts} = await verifyRelease(dir, options);
    console.log(
        `Verified ${artifacts.length} release artifacts in ${dir}. Upload only the files listed in release-manifest.json.`
    );
    if (updateManifest)
        console.log("Generated stable.json. Update updates/stable.json only after the release is public and verified.");
}
module.exports = {verifyRelease};
if (require.main === module)
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
