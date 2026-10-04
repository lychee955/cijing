import {_electron as electron, expect, test, type ElectronApplication} from "@playwright/test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

let app: ElectronApplication;
let data: string;
test.beforeEach(async () => {
    data = await mkdtemp(join(tmpdir(), "cijing-updates-e2e-"));
    const env = Object.fromEntries(
        Object.entries(process.env).filter(
            (e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RUN_AS_NODE"
        )
    );
    app = await electron.launch({
        args: [join(process.cwd(), "tests/e2e/bootstrap.cjs")],
        env: {...env, MOMO_TEST_USER_DATA: data}
    });
});
test.afterEach(async () => {
    await app?.close();
    await rm(data, {recursive: true, force: true});
});
test("brand update dialog supports keyboard, narrow layout, themes, reload and development isolation", async () => {
    const page = await app.firstWindow();
    const version = await app.evaluate(({app}) => app.getVersion());
    const entry = page.getByRole("button", {name: `v${version}`, exact: true});
    await expect(entry).toBeVisible();
    await entry.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {name: "版本与更新"});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("开发模式不访问正式更新源。").first()).toBeVisible();
    await expect(dialog.getByRole("button", {name: "检查更新"})).toBeDisabled();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
    const before = await app.evaluate(() => (globalThis as unknown as {momoMock: {hides: number}}).momoMock.hides);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(entry).toBeFocused();
    expect(await app.evaluate(() => (globalThis as unknown as {momoMock: {hides: number}}).momoMock.hides)).toBe(
        before
    );
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0]!.setSize(620, 700));
    await entry.click();
    for (const theme of ["light", "dark"]) {
        await page.evaluate((theme) => {
            document.documentElement.dataset.theme = theme;
        }, theme);
        await page.screenshot({
            path: `test-results/updates-${theme}-620.png`,
            fullPage: true,
            animations: "disabled"
        });
        expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.reload();
    await expect(entry).toBeVisible();
    const status = await page.evaluate(() => window.desktop.updates.check());
    expect(status).toMatchObject({
        ok: true,
        data: {
            phase: "unsupported",
            environment: {canCheck: false, canInstall: false}
        }
    });
    expect(await page.evaluate(() => window.desktop.updates.install())).toMatchObject({
        ok: true,
        data: {phase: "unsupported"}
    });
});
test("external release notes stay plain text and update events preserve progress across panel close", async () => {
    const page = await app.firstWindow();
    await expect(page.locator(".update-entry")).toBeVisible();
    const snapshot = await page.evaluate(() => window.desktop.updates.status());
    if (!snapshot.ok) throw new Error("Missing snapshot");
    const state = {
        ...snapshot.data,
        revision: 100,
        phase: "available" as const,
        environment: {
            ...snapshot.data.environment,
            installation: "nsis" as const,
            canCheck: true,
            canInstall: true
        },
        candidate: {
            version: "0.3.0",
            tag: "v0.3.0",
            releaseUrl: "https://github.com/lychee955/cijing/releases/tag/v0.3.0",
            assetUrl: "",
            assetName: "cijing-0.3.0-win-x64-setup.exe",
            size: 100,
            publishedAt: "2026-10-03T00:00:00Z",
            notes: "<img src=x onerror=alert(1)> 更新说明"
        },
        message: "发现新版本"
    };
    const send = async () =>
        app.evaluate(
            ({BrowserWindow}, status) => BrowserWindow.getAllWindows()[0]!.webContents.send("updates:changed", status),
            state
        );
    await send();
    await page.getByRole("button", {name: "NEW · v0.3.0 可更新"}).click();
    await expect(page.locator(".update-notes")).toContainText("<img src=x onerror=alert(1)>");
    await expect(page.locator(".update-notes img")).toHaveCount(0);
    await expect(page.getByRole("button", {name: "下载更新", exact: true})).toBeVisible();
    Object.assign(state, {revision: 101, phase: "downloading", progress: 45});
    await send();
    await expect(page.getByRole("progressbar")).toHaveAttribute("value", "45");
    await page.getByRole("button", {name: "关闭更新面板"}).click();
    await expect(page.getByRole("button", {name: "下载更新 45%"})).toBeVisible();
    Object.assign(state, {revision: 102, phase: "downloaded", progress: 100});
    await send();
    await page.locator(".update-entry").click();
    await expect(page.getByRole("dialog").getByRole("button", {name: "重启并更新"})).toBeVisible();
    Object.assign(state, {revision: 99, phase: "available"});
    await send();
    await expect(page.getByRole("dialog").getByRole("button", {name: "重启并更新"})).toBeVisible();
});
