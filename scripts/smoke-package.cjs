const {join, resolve} = require("node:path");
const {spawnSync} = require("node:child_process");
const assert = require("node:assert/strict");

if (process.argv[2] === "--child") {
    const root = process.argv[3],
        expected = process.argv[4];
    const pkg = require(join(root, "package.json"));
    assert.equal(pkg.name, "cijing");
    assert.equal(pkg.version, expected);
    const Database = require(join(root, "node_modules/better-sqlite3"));
    const db = new Database(":memory:");
    try {
        db.exec("CREATE TABLE smoke (value TEXT); INSERT INTO smoke VALUES ('native-module-ok')");
        assert.equal(db.prepare("SELECT value FROM smoke").get().value, "native-module-ok");
        console.log(
            JSON.stringify({
                name: pkg.name,
                version: pkg.version,
                sqlite: db.prepare("SELECT sqlite_version() AS version").get().version
            })
        );
    } finally {
        db.close();
    }
} else {
    if (!process.argv[2]) throw new Error("Pass the exact Windows release output directory.");
    const output = resolve(process.argv[2]),
        version = process.argv[3] ?? require("../package.json").version;
    const result = spawnSync(
        join(output, "win-unpacked", "词境.exe"),
        [__filename, "--child", join(output, "win-unpacked", "resources", "app.asar"), version],
        {
            env: {...process.env, ELECTRON_RUN_AS_NODE: "1"},
            windowsHide: true,
            stdio: "inherit",
            timeout: 30_000
        }
    );
    if (result.error) console.error(result.error.message);
    process.exit(result.status ?? 1);
}
