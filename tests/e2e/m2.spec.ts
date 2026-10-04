import {_electron as electron, expect, test, type ElectronApplication, type Page} from "@playwright/test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";

let app: ElectronApplication, page: Page, userData: string;
const bootstrap = join(process.cwd(), "tests/e2e/bootstrap.cjs");
function environment(extra: Record<string, string> = {}) {
    return {
        ...Object.fromEntries(
            Object.entries(process.env).filter(
                (pair): pair is [string, string] => pair[1] !== undefined && pair[0] !== "ELECTRON_RUN_AS_NODE"
            )
        ),
        MOMO_TEST_USER_DATA: userData,
        ...extra
    };
}
async function launch(extra: Record<string, string> = {}) {
    app = await electron.launch({args: [bootstrap], env: environment(extra)});
    page = await app.firstWindow();
    await expect(page.getByRole("heading", {name: "今天遇见了什么词？"})).toBeVisible();
}
async function configure(token = "m2-dummy-token") {
    expect(await page.evaluate((token) => window.desktop.credentials.save(token), token)).toMatchObject({ok: true});
}
async function lookup() {
    await page.getByRole("textbox", {name: "单词拼写"}).fill("apple");
    await page.getByRole("textbox", {name: "单词拼写"}).press("Enter");
    await expect(page.getByRole("radio")).toHaveCount(1);
}
async function history() {
    return page.evaluate(() =>
        window.desktop.history.list({
            scope: "all",
            offset: 0,
            limit: 100,
            pendingOnly: false
        })
    );
}
async function calls() {
    return app.evaluate(() => (globalThis as unknown as {momoMock: {calls: {path: string}[]}}).momoMock.calls);
}
async function setMode(mode: string) {
    await app.evaluate((_electron, mode) => {
        (globalThis as unknown as {momoMock: {mode: string}}).momoMock.mode = mode;
    }, mode);
}
test.beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), "momo-m2-e2e-"));
});
test.afterEach(async () => {
    await app?.close().catch(() => {});
    await rm(userData, {recursive: true, force: true});
});

test("history persists after exit and old configurations are read-only", async () => {
    await launch();
    await configure();
    await lookup();
    await page.getByRole("button", {name: "加入学习规划"}).click();
    await expect(page.getByRole("status")).toHaveText("已加入学习规划");
    await page.getByRole("button", {name: "历史", exact: true}).click();
    await expect(page.getByText("本次新增", {exact: true})).toBeVisible();
    await expect(page.getByRole("button", {name: "确认学习记录", exact: true})).toBeVisible();
    await setMode("present");
    await page.getByRole("button", {name: "确认学习记录", exact: true}).click();
    await expect(page.getByRole("button", {name: "重新查询", exact: true})).toBeVisible();
    await page.getByRole("button", {name: "重新查询", exact: true}).click();
    await expect(page.getByRole("button", {name: "重新查询", exact: true})).toBeEnabled();
    expect((await calls()).filter((call) => call.path.endsWith("/add_words"))).toHaveLength(1);
    await page.screenshot({
        path: "test-results/m2-history.png",
        fullPage: true
    });
    await app.close();
    await launch();
    const result = await history();
    expect(result.ok && result.data.items[0]).toMatchObject({
        spelling: "apple",
        state: "added",
        activeProfile: true
    });
    expect((await calls()).filter((call) => call.path.endsWith("/add_words"))).toHaveLength(0);
    await configure("another-account");
    const old = await history();
    if (!old.ok) throw new Error("History unavailable");
    expect(old.data.items[0]?.activeProfile).toBe(false);
    expect(await page.evaluate((id) => window.desktop.history.confirm(id), old.data.items[0]!.id)).toMatchObject({
        ok: false,
        error: {code: "FORBIDDEN"}
    });
    await page.getByRole("button", {name: "历史", exact: true}).click();
    await page.getByLabel("历史范围").selectOption("all");
    await expect(page.getByText("旧配置 · 只读")).toBeVisible();
    await expect(page.getByRole("button", {name: /确认学习记录|重新查询/})).toHaveCount(0);
});

test("hard exit during a write recovers by reading only", async () => {
    await launch({MOMO_TEST_MODE: "pending"});
    await configure();
    await lookup();
    await expect(page.getByRole("button", {name: "加入学习规划", exact: true})).toBeEnabled();
    await page.evaluate(() => {
        void window.desktop.study.add("v1");
    });
    await expect
        .poll(async () => {
            const result = await history();
            return result.ok ? result.data.items[0]?.state : "";
        })
        .toBe("submitting");
    const closed = app.waitForEvent("close");
    await app.evaluate(({app}) => app.exit(0)).catch(() => {});
    await closed;
    await launch({MOMO_TEST_MODE: "present"});
    await expect
        .poll(async () => {
            const result = await history();
            return result.ok ? result.data.items[0]?.state : "";
        })
        .toBe("present");
    const requests = await calls();
    expect(requests.some((call) => call.path.endsWith("/query_study_records"))).toBe(true);
    expect(requests.some((call) => call.path.endsWith("/add_words"))).toBe(false);
});

test("an unconfirmed recovered operation remains pending without write retries", async () => {
    await launch({MOMO_TEST_MODE: "uncertain"});
    await configure();
    await lookup();
    await page.getByRole("button", {name: "加入学习规划"}).click();
    await expect(page.getByRole("status")).toContainText("结果待确认");
    await app.close();
    await launch();
    await expect
        .poll(async () => {
            const result = await page.evaluate(() => window.desktop.desktop.status());
            return result.ok && result.data.recovering;
        })
        .toBe(false);
    await lookup();
    const result = await page.evaluate(() => window.desktop.study.add("v1"));
    expect(result).toMatchObject({ok: true, data: {state: "uncertain"}});
    expect((await calls()).some((call) => call.path.endsWith("/add_words"))).toBe(false);
});

test("credential failure persists, and 429 blocks repeated network requests", async () => {
    await launch();
    await configure();
    await setMode("auth");
    expect(await page.evaluate(() => window.desktop.vocabulary.lookup("apple"))).toMatchObject({
        ok: false,
        error: {code: "AUTH"}
    });
    const count = (await calls()).length;
    await page.evaluate(() => window.desktop.vocabulary.lookup("apple"));
    expect((await calls()).length).toBe(count);
    await app.close();
    await launch();
    expect(await page.evaluate(() => window.desktop.credentials.status())).toMatchObject({
        ok: true,
        data: {invalid: true}
    });
    await configure("replacement-token");
    await setMode("rate");
    expect(await page.evaluate(() => window.desktop.vocabulary.lookup("apple"))).toMatchObject({
        ok: false,
        error: {code: "RATE_LIMIT"}
    });
    await page.evaluate(() => window.desktop.vocabulary.lookup("apple"));
    expect(await calls()).toHaveLength(1);
});

test("shortcut changes, conflict rollback, Escape, settings persistence and second launch", async () => {
    await launch();
    const initial = await page.evaluate(() => window.desktop.desktop.status());
    expect(initial).toMatchObject({ok: true, data: {trayAvailable: true}});
    const settings = {
        shortcut: "Control+Alt+F11",
        closeBehavior: "hide" as const,
        theme: "dark" as const
    };
    expect(await page.evaluate((settings) => window.desktop.desktop.save(settings), settings)).toMatchObject({
        ok: true,
        data: {shortcutRegistered: true}
    });
    expect(
        await page.evaluate(
            (settings) =>
                window.desktop.desktop.save({
                    ...settings,
                    shortcut: "Control+Alt+F12"
                }),
            settings
        )
    ).toMatchObject({ok: false, error: {code: "SHORTCUT_CONFLICT"}});
    expect(await page.evaluate(() => window.desktop.desktop.status())).toMatchObject({ok: true, data: {settings}});
    await page.getByRole("button", {name: "设置", exact: true}).click();
    await expect(page.getByLabel("外观")).toHaveValue("dark");
    await page.screenshot({
        path: "test-results/m2-settings-dark.png",
        fullPage: true
    });
    const shownBefore = await app.evaluate(() => (globalThis as unknown as {momoMock: {shows: number}}).momoMock.shows);
    await app.evaluate(() =>
        (
            globalThis as unknown as {
                momoMock: {shortcuts: Record<string, () => void>};
            }
        ).momoMock.shortcuts["Control+Alt+F11"]!()
    );
    await expect(page.getByRole("heading", {name: "今天遇见了什么词？"})).toBeVisible();
    expect(
        await app.evaluate(() => (globalThis as unknown as {momoMock: {shows: number}}).momoMock.shows)
    ).toBeGreaterThan(shownBefore);
    await page.getByRole("textbox", {name: "单词拼写"}).press("Escape");
    expect(
        await app.evaluate(() => (globalThis as unknown as {momoMock: {hides: number}}).momoMock.hides)
    ).toBeGreaterThan(0);
    await page.getByRole("button", {name: "历史", exact: true}).click();
    const binary = await app.evaluate(() => process.execPath);
    // Match Playwright's first process integrity level under elevated Windows test runners.
    const second = spawn(binary, ["--disable-features=AutoDeElevate", bootstrap], {
        env: environment(),
        windowsHide: true,
        stdio: "ignore"
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
        second.once("exit", resolve);
        second.once("error", reject);
    });
    expect(exitCode).toBe(0);
    await expect(page.getByRole("heading", {name: "今天遇见了什么词？"})).toBeVisible();
    await expect(page.getByRole("textbox", {name: "单词拼写"})).toBeFocused();
    expect(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length)).toBe(1);
    await app.close();
    await launch();
    expect(await page.evaluate(() => window.desktop.desktop.status())).toMatchObject({ok: true, data: {settings}});
});

test("missing tray and shortcut preserve a normal minimized window entry", async () => {
    await launch({MOMO_TEST_TRAY_FAIL: "1", MOMO_TEST_SHORTCUT_FAIL: "1"});
    expect(await page.evaluate(() => window.desktop.desktop.status())).toMatchObject({
        ok: true,
        data: {
            trayAvailable: false,
            shortcutRegistered: false,
            hideSupported: false
        }
    });
    await app.evaluate(({BrowserWindow}) => {
        BrowserWindow.getAllWindows()[0]!.close();
    });
    expect(
        await app.evaluate(({BrowserWindow}) => ({
            count: BrowserWindow.getAllWindows().length,
            minimized: BrowserWindow.getAllWindows()[0]?.isMinimized()
        }))
    ).toEqual({count: 1, minimized: true});
});
