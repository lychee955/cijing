import {_electron as electron, expect, test, type ElectronApplication, type Page} from "@playwright/test";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {channels} from "../../src/shared/contracts";
let app: ElectronApplication, page: Page, userData: string;
test.setTimeout(90_000);
async function launch() {
    const env = Object.fromEntries(
        Object.entries(process.env).filter(
            (e): e is [string, string] => e[1] !== undefined && e[0] !== "ELECTRON_RUN_AS_NODE"
        )
    );
    app = await electron.launch({
        args: [join(process.cwd(), "tests/e2e/bootstrap.cjs")],
        env: {...env, MOMO_TEST_USER_DATA: userData}
    });
    page = await app.firstWindow();
    await expect(page.getByRole("heading", {name: "今天遇见了什么词？"})).toBeVisible();
}
async function profile(protocol: "openai" | "gemini" = "openai") {
    await page.getByRole("button", {name: "设置", exact: true}).click();
    await expect(page.getByRole("heading", {name: "AI 服务", exact: true})).toBeVisible();
    await page.getByRole("button", {name: "新增 AI 配置", exact: true}).click();
    await expect(page.getByRole("dialog", {name: "新增 AI 配置", exact: true})).toBeVisible();
    await page.getByLabel("配置名称", {exact: true}).fill(protocol);
    await page.getByLabel("接口类型", {exact: true}).selectOption(protocol);
    await page.getByLabel("API 基础地址", {exact: true}).fill("https://ai.example/v1");
    await page.getByLabel("API Key", {exact: true}).fill("dummy-ai-key");
    await page.getByLabel("模型 ID", {exact: true}).fill("test-model");
    await page.getByRole("button", {name: "保存 AI 配置", exact: true}).click();
    await expect(page.locator(".ai-settings [role=status]")).toContainText("配置已保存");
}
async function aiCalls() {
    return app.evaluate(
        () => (globalThis as unknown as {momoMock: {calls: {ai?: boolean}[]}}).momoMock.calls.filter((c) => c.ai).length
    );
}
async function mode(aiMode: string) {
    await app.evaluate((_electron, aiMode) => {
        (globalThis as unknown as {momoMock: {aiMode: string}}).momoMock.aiMode = aiMode;
    }, aiMode);
}
async function analyze(text = "I eat the apple that you gave me.") {
    await page.getByRole("button", {name: "句子分析", exact: true}).click();
    await page.getByLabel("英文句子或短段落").fill(text);
    await page.getByRole("button", {name: "分析句子", exact: true}).click();
    await expect(page.locator(".analysis-result")).toBeVisible();
}
test.beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), "momo-analysis-e2e-"));
    await launch();
});
test.afterEach(async () => {
    await app?.close();
    await rm(userData, {recursive: true, force: true});
});

test("read failures show recovery actions instead of missing AI configuration or zero history", async () => {
    await profile();
    const saved = await page.evaluate(() => window.desktop.ai.configuration());
    await app.evaluate(({ipcMain}, channels) => {
        for (const channel of [channels.aiConfig, channels.analysisHistory]) {
            ipcMain.removeHandler(channel);
            ipcMain.handle(channel, () => ({
                ok: false,
                error: {code: "AI_STORAGE", message: "本地数据读取失败"}
            }));
        }
    }, channels);
    await page.getByRole("button", {name: "句子分析", exact: true}).click();
    await expect(page.getByText("AI 配置读取失败：", {exact: false})).toBeVisible();
    await expect(page.getByText("请先在设置中配置 AI 服务。句子分析无需墨墨 Token。")).toHaveCount(0);
    await expect(page.locator(".analysis-history summary")).toHaveText("分析历史（读取失败）");
    await page.getByRole("button", {name: "设置", exact: true}).click();
    await expect(page.locator(".ai-settings [role=alert]")).toContainText("AI 配置读取失败");
    await app.evaluate(
        ({ipcMain}, {channel, saved}) => {
            ipcMain.removeHandler(channel);
            ipcMain.handle(channel, () => saved);
        },
        {channel: channels.aiConfig, saved}
    );
    await page.getByRole("button", {name: "重新读取 AI 配置"}).click();
    await expect(page.locator(".ai-settings [role=alert]")).toHaveCount(0);
    await expect(page.locator(".ai-profile")).toHaveCount(1);
});

test("profile dialogs support templates, cancellation, validation and editing without exposing saved keys", async () => {
    async function checkFieldSpacing() {
        const fields = await page.locator(".ai-profile-dialog label:visible").evaluateAll((labels) =>
            labels.map((label) => {
                const title = label.querySelector("span")!.getBoundingClientRect();
                const control = label.querySelector("input, select")!.getBoundingClientRect();
                return {
                    gap: control.top - title.bottom,
                    left: control.left - title.left,
                    right: control.right <= label.getBoundingClientRect().right + 1
                };
            })
        );
        expect(fields.length).toBeGreaterThanOrEqual(5);
        for (const field of fields) {
            expect(field.gap).toBeCloseTo(8);
            expect(field.left).toBeCloseTo(0);
            expect(field.right).toBe(true);
        }
    }
    await page.getByRole("button", {name: "设置", exact: true}).click();
    await expect(page.getByLabel("配置名称", {exact: true})).not.toBeVisible();
    await page.getByRole("button", {name: "新增 AI 配置", exact: true}).click();
    const add = page.getByRole("dialog", {name: "新增 AI 配置", exact: true});
    await expect(add).toBeVisible();
    await add.getByLabel("新增配置模板", {exact: true}).selectOption({label: "Gemini"});
    await expect(add.getByLabel("接口类型", {exact: true})).toHaveValue("gemini");
    await expect(add.getByLabel("API 基础地址", {exact: true})).toHaveValue(
        "https://generativelanguage.googleapis.com/v1beta"
    );
    await checkFieldSpacing();
    await page.screenshot({
        path: join(process.cwd(), "test-results/ai-add-dialog-light.png")
    });
    await add.getByLabel("API Key", {exact: true}).fill("cancelled-key");
    await page.keyboard.press("Escape");
    await expect(add).not.toBeVisible();
    await expect(page.locator(".ai-profile")).toHaveCount(0);
    await page.getByRole("button", {name: "新增 AI 配置", exact: true}).click();
    await expect(add.getByLabel("API Key", {exact: true})).toHaveValue("");
    await add.getByRole("button", {name: "取消", exact: true}).click();
    await profile();
    await page.locator(".ai-profile").getByRole("button", {name: "编辑", exact: true}).click();
    const edit = page.getByRole("dialog", {name: "编辑 AI 配置", exact: true});
    await expect(edit).toBeVisible();
    await expect(edit.getByLabel("配置名称", {exact: true})).toHaveValue("openai");
    await expect(edit.getByLabel("API Key", {exact: true})).toHaveValue("");
    await expect(edit.getByLabel("新增配置模板", {exact: true})).toHaveCount(0);
    await checkFieldSpacing();
    await edit.getByText("高级选项", {exact: true}).click();
    await checkFieldSpacing();
    await edit.getByText("高级选项", {exact: true}).click();
    await edit.evaluate((el) => {
        el.scrollTop = 0;
    });
    await page.screenshot({
        path: join(process.cwd(), "test-results/ai-edit-dialog-light.png")
    });
    await edit.getByLabel("配置名称", {exact: true}).fill("取消的名称");
    await edit.getByRole("button", {name: "取消", exact: true}).click();
    await expect(page.locator(".ai-profile")).toContainText("openai");
    await page.locator(".ai-profile").getByRole("button", {name: "编辑", exact: true}).click();
    await edit.getByLabel("API 基础地址", {exact: true}).fill("http://ai.example/v1");
    await edit.getByRole("button", {name: "保存 AI 配置", exact: true}).click();
    await expect(edit.getByRole("alert")).toContainText("输入或配置不符合要求");
    await expect(edit).toBeVisible();
    await edit.getByLabel("API 基础地址", {exact: true}).fill("https://ai.example/v1");
    await edit.getByLabel("配置名称", {exact: true}).fill("编辑后的名称");
    await edit.getByRole("button", {name: "保存 AI 配置", exact: true}).click();
    await expect(edit).not.toBeVisible();
    await expect(page.locator(".ai-profile")).toContainText("编辑后的名称");
    await expect(page.locator(".ai-profile")).toContainText("密钥已保存");
    expect(await aiCalls()).toBe(0);
    await page.getByRole("button", {name: "停用", exact: true}).click();
    await page.getByLabel("外观", {exact: true}).selectOption("dark");
    await page.getByRole("button", {name: "保存桌面设置", exact: true}).click();
    await expect(page.getByText("桌面设置已保存。", {exact: true})).toBeVisible();
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0]!.setSize(560, 640));
    await page.locator(".ai-profile").getByRole("button", {name: "编辑", exact: true}).click();
    await expect(edit).toHaveCSS("background-color", "rgb(44, 53, 44)");
    expect(await edit.evaluate((el) => el.scrollTop)).toBe(0);
    await checkFieldSpacing();
    expect(
        await edit.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return (
                r.left >= 0 &&
                r.right <= innerWidth &&
                r.top >= 0 &&
                r.bottom <= innerHeight &&
                el.scrollWidth <= el.clientWidth
            );
        })
    ).toBe(true);
    await page.screenshot({
        path: join(process.cwd(), "test-results/ai-edit-dialog-dark.png")
    });
    await edit.getByRole("button", {name: "取消", exact: true}).click();
});

test("create, test, nested analysis without Maimemo, lookup and return, cache, restart and delete", async () => {
    await profile();
    expect(await aiCalls()).toBe(0);
    const cfg = await page.evaluate(() => window.desktop.ai.configuration());
    expect(JSON.stringify(cfg)).not.toContain("dummy-ai-key");
    await page.getByRole("button", {name: "测试连接", exact: true}).click();
    await expect(page.locator(".ai-settings [role=status]")).toContainText("连接成功");
    expect(await aiCalls()).toBe(1);
    await analyze();
    await page.getByText("成分与从句（2）", {exact: true}).click();
    await page.locator(".analysis-node.clause > summary").click();
    await page.locator(".analysis-node.component > summary").click();
    await expect(page.getByText("you 是从句主语。", {exact: true})).toBeVisible();
    await page.getByText("重点词汇", {exact: true}).click();
    await page.getByRole("button", {name: "查词 apple", exact: true}).click();
    await expect(page.getByRole("textbox", {name: "单词拼写"})).toHaveValue("apple");
    await expect(page.getByRole("alert")).toContainText("请先在设置中保存 Token");
    await page.keyboard.press("Control+4");
    await expect(page.getByLabel("英文句子或短段落")).toHaveValue("I eat the apple that you gave me.");
    await expect(page.locator(".analysis-result")).toBeVisible();
    await page.getByRole("button", {name: "分析句子", exact: true}).click();
    await expect(page.locator(".analysis-result")).toContainText("复用已完成分析");
    expect(await aiCalls()).toBe(2);
    await app.close();
    await launch();
    await page.getByRole("button", {name: "句子分析", exact: true}).click();
    await page.getByText("分析历史（1）", {exact: true}).click();
    await page.getByRole("button", {name: "查看分析", exact: true}).click();
    await expect(page.locator(".analysis-result")).toContainText("mock-openai");
    expect(await aiCalls()).toBe(0);
    const file = await readFile(join(userData, "cijing.sqlite3"));
    expect(file.toString()).not.toContain("dummy-ai-key");
    await page.getByRole("button", {name: "删除分析", exact: true}).click();
    await page.getByRole("button", {name: "确认删除分析", exact: true}).click();
    await expect(page.getByText("分析历史（0）", {exact: true})).toBeVisible();
});

test("Gemini native paragraph, current profile switching and force retains old results", async () => {
    await profile("openai");
    await profile("gemini");
    const openaiProfile = page.locator(".ai-profile").filter({has: page.getByText("openai", {exact: true})});
    const geminiProfile = page.locator(".ai-profile").filter({has: page.getByText("gemini", {exact: true})});
    await expect(openaiProfile.getByRole("button", {name: "已是当前", exact: true})).toBeDisabled();
    await expect(geminiProfile.getByRole("button", {name: "设为当前", exact: true})).toBeEnabled();
    await geminiProfile.getByRole("button", {name: "设为当前", exact: true}).click();
    await expect(geminiProfile.getByRole("button", {name: "已是当前", exact: true})).toBeDisabled();
    await expect(openaiProfile.getByRole("button", {name: "设为当前", exact: true})).toBeEnabled();
    await analyze("Birds sing. They fly.");
    await expect(page.locator(".sentence-card")).toHaveCount(2);
    await expect(page.locator(".analysis-result")).toContainText("mock-gemini");
    await expect(page.getByLabel("全文翻译", {exact: true})).toHaveText("鸟儿歌唱。它们飞翔。");
    await page.getByRole("button", {name: "重新分析", exact: true}).click();
    await expect(page.getByText("分析历史（2）", {exact: true})).toBeVisible();
    expect(await aiCalls()).toBe(2);
    await page.getByLabel("当前 AI 配置").selectOption({label: "openai · test-model"});
    await page.getByRole("button", {name: "分析句子", exact: true}).click();
    await expect(page.locator(".analysis-result")).toContainText("mock-openai");
    expect(await aiCalls()).toBe(3);
    await page.getByText("分析历史（3）", {exact: true}).click();
    await page.getByRole("button", {name: "清空分析历史", exact: true}).click();
    await page.getByRole("button", {name: "确认清空", exact: true}).click();
    await expect(page.getByText("分析历史（0）", {exact: true})).toBeVisible();
});

test("cancel and profile switch suppress late response and allow retry", async () => {
    await profile();
    await mode("pending");
    await page.getByRole("button", {name: "句子分析", exact: true}).click();
    await page.getByLabel("英文句子或短段落").fill("Birds sing.");
    await page.getByRole("button", {name: "分析句子", exact: true}).click();
    await expect(page.getByRole("button", {name: "取消分析", exact: true})).toBeVisible();
    await page.getByRole("button", {name: "取消分析", exact: true}).click();
    await expect(page.getByRole("alert")).toContainText("分析已取消");
    await app.evaluate(() => {
        const mock = (
            globalThis as unknown as {
                momoMock: {resolveAi: (r: Response) => void};
            }
        ).momoMock;
        mock.resolveAi(new Response("{}"));
    });
    await expect(page.locator(".analysis-result")).toHaveCount(0);
    await expect(page.getByText("分析历史（0）", {exact: true})).toBeVisible();
    await mode("");
    await page.getByRole("button", {name: "重试分析", exact: true}).click();
    await expect(page.locator(".analysis-result")).toBeVisible();
    expect(await aiCalls()).toBe(2);
});

test("rate limit logs request and provider response, redacts keys and reports local cooldown", async () => {
    await profile();
    await mode("rate");
    await page.getByRole("button", {name: "句子分析", exact: true}).click();
    await page.getByLabel("英文句子或短段落").fill("Birds sing.");
    await page.getByRole("button", {name: "分析句子", exact: true}).click();
    await expect(page.getByRole("alert")).toContainText("AI 服务请求受限或模型繁忙");
    await expect(page.getByRole("alert")).toContainText("建议 13 秒后重试");
    await expect(page.getByRole("alert")).toContainText("Upstream model is temporarily rate limited");
    await page.getByRole("button", {name: "重试分析", exact: true}).click();
    await expect
        .poll(async () => (await readFile(join(userData, "logs/ai.log"), "utf8")).includes("cooldown"))
        .toBe(true);
    const raw = await readFile(join(userData, "logs/ai.log"), "utf8");
    expect(raw).not.toContain("dummy-ai-key");
    const entries = raw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    const request = entries.find((e) => e.phase === "request"),
        response = entries.find((e) => e.phase === "response");
    expect(request.headers.Authorization).toBe("[REDACTED]");
    expect(request.body.messages[1].content).toContain("Birds sing.");
    expect(response).toMatchObject({
        requestId: request.requestId,
        status: 429,
        retryAfterSeconds: 13,
        body: {
            error: {
                message: "Upstream model is temporarily rate limited",
                metadata: {provider_name: "test-provider"}
            }
        }
    });
    expect(entries.find((e) => e.phase === "cooldown")).toMatchObject({
        requestSent: false
    });
    expect(await aiCalls()).toBe(1);
});

test("analysis displays provider errors safely and clears details after a successful retry", async () => {
    await profile();
    await mode("server");
    await page.getByRole("button", {name: "句子分析", exact: true}).click();
    await page.getByLabel("英文句子或短段落").fill("Birds sing.");
    await page.getByRole("button", {name: "分析句子", exact: true}).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("生成调用 1 次");
    await expect(alert).toContainText("HTTP 503");
    await expect(alert).toContainText("Provider returned error");
    await expect(alert).toContainText("ModelRun is unavailable: [REDACTED] <script>alert(1)</script>");
    await expect(alert).not.toContainText("dummy-ai-key");
    await expect(alert.locator("script")).toHaveCount(0);
    await app.evaluate(({BrowserWindow}) => {
        BrowserWindow.getAllWindows()[0]!.setSize(560, 720);
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mode("");
    await page.getByRole("button", {name: "重试分析", exact: true}).click();
    await expect(page.locator(".analysis-result")).toBeVisible();
    await expect(alert).toHaveCount(0);
});

test("output limit controls are absent and requests remain unlimited after editing and restarting", async () => {
    await profile();
    await page.locator(".ai-profile").getByRole("button", {name: "编辑", exact: true}).click();
    await page.getByText("高级选项", {exact: true}).click();
    await expect(page.getByLabel("最大输出 Token", {exact: true})).toHaveCount(0);
    await expect(page.getByRole("button", {name: "由服务决定输出长度", exact: true})).toHaveCount(0);
    await page.getByRole("button", {name: "保存 AI 配置", exact: true}).click();
    await expect(page.locator(".ai-settings [role=status]")).toContainText("配置已保存");
    await page.getByRole("button", {name: "测试连接", exact: true}).click();
    await expect(page.locator(".ai-settings [role=status]")).toContainText("连接成功");
    await analyze("Birds sing.");
    async function assertNoLimits() {
        const bodies = await app.evaluate(() =>
            (
                globalThis as unknown as {
                    momoMock: {
                        calls: {ai?: boolean; body: Record<string, unknown>}[];
                    };
                }
            ).momoMock.calls
                .filter((c) => c.ai)
                .map((c) => c.body)
        );
        for (const body of bodies) {
            expect(body).not.toHaveProperty("max_tokens");
            expect(body).not.toHaveProperty("max_completion_tokens");
        }
        const config = await page.evaluate(() => window.desktop.ai.configuration());
        expect(JSON.stringify(config)).not.toContain("maxOutputTokens");
    }
    await assertNoLimits();
    expect(await aiCalls()).toBe(2);
    await app.close();
    await launch();
    await page.getByRole("button", {name: "设置", exact: true}).click();
    await page.getByRole("button", {name: "测试连接", exact: true}).click();
    await expect(page.locator(".ai-settings [role=status]")).toContainText("连接成功");
    await assertNoLimits();
    expect(await aiCalls()).toBe(1);
});

test("AI auth error is local, changing host clears key, and unconfigured AI preserves lookup", async () => {
    await profile();
    await mode("auth");
    await page.getByRole("button", {name: "句子分析", exact: true}).click();
    await page.getByLabel("英文句子或短段落").fill("Birds sing.");
    await page.getByRole("button", {name: "分析句子", exact: true}).click();
    await expect(page.getByRole("alert")).toContainText("AI 密钥无效");
    const status = await page.evaluate(() => window.desktop.credentials.status());
    expect(status).toMatchObject({ok: true, data: {configured: false}});
    await page.getByRole("button", {name: "设置", exact: true}).click();
    await page.locator(".ai-profile").getByRole("button", {name: "编辑", exact: true}).click();
    await page.getByLabel("API 基础地址", {exact: true}).fill("https://another.example/v1");
    await page.getByRole("button", {name: "保存 AI 配置", exact: true}).click();
    await expect(page.locator(".ai-profile")).toContainText("缺少密钥");
    const deleteButton = page.locator(".ai-profile").getByRole("button", {name: "删除配置", exact: true});
    const deleteDialog = page.getByRole("dialog", {
        name: "删除配置？",
        exact: true
    });
    await deleteButton.click();
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog).toContainText("确定删除“openai”配置？分析历史会保留。");
    await page.screenshot({
        path: join(process.cwd(), "test-results/ai-delete-dialog-light.png")
    });
    await expect(deleteDialog.getByRole("button", {name: "保留", exact: true})).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(deleteDialog.getByRole("button", {name: "确认删除配置", exact: true})).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(deleteDialog.getByRole("button", {name: "保留", exact: true})).toBeFocused();
    const hides = await app.evaluate(() => (globalThis as unknown as {momoMock: {hides: number}}).momoMock.hides);
    await page.keyboard.press("Escape");
    await expect(deleteDialog).not.toBeVisible();
    await expect(deleteButton).toBeFocused();
    expect(await app.evaluate(() => (globalThis as unknown as {momoMock: {hides: number}}).momoMock.hides)).toBe(hides);
    await expect(page.locator(".ai-profile")).toHaveCount(1);
    await deleteButton.click();
    await deleteDialog.getByRole("button", {name: "保留", exact: true}).click();
    await expect(deleteDialog).not.toBeVisible();
    await expect(page.locator(".ai-profile")).toHaveCount(1);
    await app.evaluate(({BrowserWindow}) => {
        BrowserWindow.getAllWindows()[0]!.setSize(560, 720);
    });
    await page.getByRole("button", {name: "停用", exact: true}).click();
    await page.getByLabel("外观", {exact: true}).selectOption("dark");
    await page.getByRole("button", {name: "保存桌面设置", exact: true}).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await deleteButton.click();
    await expect(deleteDialog).toHaveCSS("background-color", "rgb(44, 53, 44)");
    await expect(deleteDialog.getByRole("button", {name: "确认删除配置", exact: true})).toHaveCSS(
        "color",
        "rgb(224, 161, 141)"
    );
    expect(
        await deleteDialog.evaluate((el) => {
            const bounds = el.getBoundingClientRect();
            return (
                bounds.left >= 0 &&
                bounds.right <= window.innerWidth &&
                bounds.top >= 0 &&
                bounds.bottom <= window.innerHeight
            );
        })
    ).toBe(true);
    await page.screenshot({
        path: join(process.cwd(), "test-results/ai-delete-dialog-dark.png")
    });
    await deleteDialog.getByRole("button", {name: "确认删除配置", exact: true}).click();
    await expect(deleteDialog).not.toBeVisible();
    await expect(page.locator(".ai-profile")).toHaveCount(0);
    await page.getByLabel("输入 Token").fill("momo-e2e-dummy-token");
    await page.getByRole("button", {name: "保存 Token", exact: true}).click();
    await expect(page.locator(".account-card [role=status]")).toContainText("验证通过");
    await page.keyboard.press("Control+1");
    await page.getByRole("textbox", {name: "单词拼写"}).fill("apple");
    await page.getByRole("textbox", {name: "单词拼写"}).press("Enter");
    await expect(page.locator(".word-spelling")).toHaveText("apple");
});

test("narrow window and dark theme retain readable analysis controls", async () => {
    await profile();
    await analyze();
    await page.getByRole("button", {name: "设置", exact: true}).click();
    await page.getByRole("button", {name: "停用", exact: true}).click();
    await page.getByLabel("外观", {exact: true}).selectOption("dark");
    await page.getByRole("button", {name: "保存桌面设置", exact: true}).click();
    await expect(page.getByText("桌面设置已保存。", {exact: true})).toBeVisible();
    await page.keyboard.press("Control+4");
    await app.evaluate(({BrowserWindow}) => {
        BrowserWindow.getAllWindows()[0]!.setSize(560, 720);
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator(".sentence-card")).toBeVisible();
    await page.screenshot({
        path: join(process.cwd(), "test-results/analysis-dark.png"),
        fullPage: true
    });
    await page.getByRole("button", {name: "设置", exact: true}).click();
    await page.getByLabel("外观", {exact: true}).selectOption("light");
    await page.getByRole("button", {name: "保存桌面设置", exact: true}).click();
    await page.keyboard.press("Control+4");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.screenshot({
        path: join(process.cwd(), "test-results/analysis-light.png"),
        fullPage: true
    });
});

for (const protocol of ["openai", "gemini"] as const) {
    test(
        protocol +
            " translation-only mode preserves paragraphs, caches, restores history and switches to detailed analysis",
        async () => {
            await profile(protocol);
            await page.locator(".ai-profile").getByRole("button", {name: "编辑", exact: true}).click();
            const editor = page.getByRole("dialog", {
                name: "编辑 AI 配置",
                exact: true
            });
            await editor.getByText("高级选项", {exact: true}).click();
            await editor.getByLabel("输出格式", {exact: true}).selectOption("schema");
            await editor.getByRole("button", {name: "保存 AI 配置", exact: true}).click();
            await expect(editor).not.toBeVisible();
            await page.getByLabel("补充提示词", {exact: true}).fill("Always explain grammar in detail.");
            await page.getByRole("button", {name: "保存提示词偏好", exact: true}).click();
            await expect(page.locator(".ai-settings [role=status]")).toContainText("提示词偏好已保存");
            await page.getByRole("button", {name: "句子分析", exact: true}).click();
            let checkbox = page.getByRole("checkbox", {
                name: "详细分析",
                exact: true
            });
            await expect(checkbox).toBeChecked();
            await checkbox.uncheck();
            const text = "Birds sing.\n\nThey fly.",
                translation = "鸟儿歌唱。\n\n它们飞翔。";
            await page.getByLabel("英文句子或短段落").fill(text);
            await page.getByLabel("英文句子或短段落").press("Control+Enter");
            await expect(page.getByLabel("全文翻译", {exact: true})).toHaveText(translation);
            await expect(page.getByLabel("全文翻译", {exact: true})).toHaveCSS("white-space", "pre-wrap");
            await expect(page.locator(".sentence-card")).toHaveCount(0);
            await expect(page.locator(".analysis-result")).toContainText("仅翻译");
            expect(await aiCalls()).toBe(1);
            const body = JSON.parse(
                await app.evaluate(() =>
                    JSON.stringify(
                        (
                            globalThis as unknown as {
                                momoMock: {calls: {ai?: boolean; body: unknown}[]};
                            }
                        ).momoMock.calls
                            .filter((c) => c.ai)
                            .at(-1)!.body
                    )
                )
            );
            expect(protocol === "openai" ? body.messages[1].content : body.contents[0].parts[0].text).toBe(text);
            expect(protocol === "openai" ? body.messages[0].content : body.systemInstruction.parts[0].text).not.toMatch(
                /Schema|JSON|Always explain/
            );
            expect(body.response_format).toBeUndefined();
            expect(body.generationConfig?.responseMimeType).toBeUndefined();
            expect(body.generationConfig?.responseJsonSchema).toBeUndefined();
            expect(body.max_tokens).toBeUndefined();
            expect(body.generationConfig?.maxOutputTokens).toBeUndefined();
            await page.getByRole("button", {name: "翻译全文", exact: true}).click();
            await expect(page.locator(".analysis-result")).toContainText("复用已完成翻译");
            expect(await aiCalls()).toBe(1);
            await app.close();
            await launch();
            checkbox = page.getByRole("checkbox", {name: "详细分析", exact: true});
            await page.getByRole("button", {name: "句子分析", exact: true}).click();
            expect(await page.evaluate(() => localStorage.getItem("cijing:analysis-mode"))).toBe("translation");
            await expect(checkbox).not.toBeChecked();
            await page.getByText("分析历史（1）", {exact: true}).click();
            await page.getByRole("button", {name: "查看翻译", exact: true}).click();
            await expect(page.getByLabel("英文句子或短段落")).toHaveValue(text);
            await expect(page.getByLabel("全文翻译", {exact: true})).toHaveText(translation);
            await expect(page.locator(".sentence-card")).toHaveCount(0);
            expect(await aiCalls()).toBe(0);
            if (protocol === "openai") {
                await page.screenshot({
                    path: join(process.cwd(), "test-results/translation-light.png"),
                    fullPage: true
                });
                await page.getByRole("button", {name: "设置", exact: true}).click();
                await page.getByRole("button", {name: "停用", exact: true}).click();
                await page.getByLabel("外观", {exact: true}).selectOption("dark");
                await page.getByRole("button", {name: "保存桌面设置", exact: true}).click();
                await expect(page.getByText("桌面设置已保存。", {exact: true})).toBeVisible();
                await page.getByRole("button", {name: "句子分析", exact: true}).click();
                await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0]!.setSize(620, 720));
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                await page.screenshot({
                    path: join(process.cwd(), "test-results/translation-dark-narrow.png"),
                    fullPage: true
                });
            }
            await checkbox.check();
            await page.getByRole("button", {name: "分析句子", exact: true}).click();
            await expect(page.locator(".sentence-card")).toHaveCount(2);
            await expect(page.getByText("分析历史（2）", {exact: true})).toBeVisible();
            expect(await aiCalls()).toBe(1);
            const detailedBody = JSON.parse(
                await app.evaluate(() =>
                    JSON.stringify(
                        (
                            globalThis as unknown as {
                                momoMock: {calls: {ai?: boolean; body: unknown}[]};
                            }
                        ).momoMock.calls
                            .filter((c) => c.ai)
                            .at(-1)!.body
                    )
                )
            );
            if (protocol === "openai") expect(detailedBody.response_format.type).toBe("json_schema");
            else expect(detailedBody.generationConfig.responseJsonSchema).toBeDefined();
            await checkbox.uncheck();
            await expect(page.locator(".sentence-card")).toHaveCount(0);
            await page.getByRole("button", {name: "翻译全文", exact: true}).click();
            await expect(page.locator(".analysis-result")).toContainText("复用已完成翻译");
            await expect(page.getByLabel("全文翻译", {exact: true})).toHaveText(translation);
            expect(await aiCalls()).toBe(1);
        }
    );
}
test("translation cancellation and provider error details preserve input and allow retry", async () => {
    await profile();
    await mode("pending");
    await page.getByRole("button", {name: "句子分析", exact: true}).click();
    const checkbox = page.getByRole("checkbox", {
        name: "详细分析",
        exact: true
    });
    await checkbox.uncheck();
    await page.getByLabel("英文句子或短段落").fill("Birds sing.");
    await page.getByRole("button", {name: "翻译全文", exact: true}).click();
    await expect(checkbox).toBeDisabled();
    await page.getByRole("button", {name: "取消翻译", exact: true}).click();
    await expect(page.getByRole("alert")).toContainText("翻译已取消");
    await expect(checkbox).toBeEnabled();
    await expect(page.locator(".analysis-result")).toHaveCount(0);
    await mode("server");
    await page.getByRole("button", {name: "重试翻译", exact: true}).click();
    await expect(page.getByRole("alert")).toContainText("HTTP 503");
    await expect(page.getByRole("alert")).toContainText("ModelRun is unavailable: [REDACTED]");
    await expect(page.getByLabel("英文句子或短段落")).toHaveValue("Birds sing.");
    await mode("");
    await page.getByRole("button", {name: "重试翻译", exact: true}).click();
    await expect(page.getByLabel("全文翻译", {exact: true})).toHaveText("鸟儿歌唱。");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("分析历史（1）", {exact: true})).toBeVisible();
});
