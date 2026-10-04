const {mkdirSync} = require("node:fs");
const {join, resolve} = require("node:path");
const {spawnSync} = require("node:child_process");
const {version} = require("../package.json");
const {releaseConfig} = require("./release-config.cjs");
const {channel} = releaseConfig(version);
// Each build gets an empty output directory. Existing releases and user files are never removed.
const output = resolve(__dirname, "../dist", `release-${version}-${Date.now()}`);
mkdirSync(resolve(__dirname, "../dist"), {recursive: true});
mkdirSync(output, {recursive: false});
const result = spawnSync(
    process.execPath,
    [
        require.resolve("electron-builder/cli.js"),
        "--win",
        "--x64",
        "--publish",
        "never",
        `--config.directories.output=${output}`,
        `--config.publish.channel=${channel}`
    ],
    {stdio: "inherit"}
);
if (result.status !== 0) process.exit(result.status ?? 1);
const smoke = spawnSync(process.execPath, [join(__dirname, "smoke-package.cjs"), output], {stdio: "inherit"});
if (smoke.status !== 0) process.exit(smoke.status ?? 1);
const verified = spawnSync(process.execPath, [join(__dirname, "verify-release.cjs"), output], {stdio: "inherit"});
process.exit(verified.status ?? 1);
