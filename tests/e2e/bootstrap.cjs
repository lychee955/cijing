// Separate test entry: never imported or bundled by the real application.
const {app, net, BrowserWindow, globalShortcut, nativeImage} = require("electron");
const {join} = require("node:path");
if (!process.env.MOMO_TEST_USER_DATA) throw new Error("Isolated test directory required");
app.setPath("userData", process.env.MOMO_TEST_USER_DATA);
globalThis.momoMock = {
    mode: process.env.MOMO_TEST_MODE || "added",
    calls: [],
    shows: 0,
    hides: 0,
    shortcuts: {}
};
BrowserWindow.prototype.show = function () {
    globalThis.momoMock.shows++;
}; // No desktop focus stealing.
BrowserWindow.prototype.focus = function () {};
const originalHide = BrowserWindow.prototype.hide;
BrowserWindow.prototype.hide = function () {
    globalThis.momoMock.hides++;
    return originalHide.call(this);
};
const originalRegister = globalShortcut.register.bind(globalShortcut);
globalShortcut.register = (key, callback) => {
    if (process.env.MOMO_TEST_SHORTCUT_FAIL || key === "Control+Alt+F12") return false;
    const success = originalRegister(key, callback);
    if (success) globalThis.momoMock.shortcuts[key] = callback;
    return success;
};
if (process.env.MOMO_TEST_TRAY_FAIL)
    nativeImage.createFromBitmap = () => {
        throw new Error("Simulated missing tray");
    };
net.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (["ai.example", "generativelanguage.googleapis.com", "openrouter.ai"].includes(new URL(url).hostname)) {
        if (init.redirect !== "error") throw new Error("AI redirects must be disabled");
        const body = JSON.parse(init.body),
            gemini = path.endsWith(":generateContent");
        const prompt = gemini ? body.systemInstruction.parts[0].text : body.messages[0].content;
        const translating = prompt.startsWith("Translate the input from English");
        const input = gemini ? body.contents[0].parts[0].text : body.messages[1].content;
        const text = translating ? input : JSON.parse(input).text;
        globalThis.momoMock.calls.push({path, body, ai: true});
        if (globalThis.momoMock.aiMode === "pending")
            return new Promise((resolve) => {
                globalThis.momoMock.resolveAi = resolve;
            });
        if (globalThis.momoMock.aiMode === "auth") return new Response("{}", {status: 401});
        if (globalThis.momoMock.aiMode === "server")
            return new Response(
                JSON.stringify({
                    error: {
                        code: 503,
                        message: "Provider returned error",
                        metadata: {
                            provider_name: "ModelRun",
                            raw: "ModelRun is unavailable: dummy-ai-key <script>alert(1)</script>"
                        }
                    }
                }),
                {status: 503}
            );
        if (globalThis.momoMock.aiMode === "rate")
            return new Response(
                JSON.stringify({
                    error: {
                        code: 429,
                        message: "Upstream model is temporarily rate limited",
                        metadata: {provider_name: "test-provider"}
                    }
                }),
                {status: 429, headers: {"Retry-After": "13"}}
            );
        const result = {
            version: 1,
            summary: text.includes("They") ? "They 指代前句的 Birds。" : "",
            sentences: text.split(/(?<=[.!?])\s+/).map((original) => ({
                original,
                translation: original.includes("apple")
                    ? "我吃你给我的那个苹果。"
                    : original.includes("They")
                      ? "它们飞翔。"
                      : "鸟儿歌唱。",
                backbone: original.includes("apple")
                    ? "I eat the apple：我吃苹果。"
                    : original.includes("They")
                      ? "They fly：它们飞翔。"
                      : "Birds sing：鸟儿歌唱。",
                nodes: original.includes("apple")
                    ? [
                          {
                              id: "clause",
                              parentId: null,
                              kind: "clause",
                              role: "定语从句",
                              quotes: [{text: "that you gave me", occurrence: 1}],
                              explanation: "that 引导定语从句，在从句中作宾语，修饰 apple。",
                              target: "apple"
                          },
                          {
                              id: "subject",
                              parentId: "clause",
                              kind: "component",
                              role: "主语",
                              quotes: [{text: "you", occurrence: 1}],
                              explanation: "you 是从句主语。",
                              target: ""
                          }
                      ]
                    : [],
                grammar: ["先识别主语和谓语。"],
                vocabulary: original.includes("apple") ? [{word: "apple", lemma: "apple", meaning: "苹果"}] : [],
                notes: []
            }))
        };
        const content = translating
            ? text
                  .split(/(\n+)/)
                  .map((part) =>
                      /^\n+$/.test(part)
                          ? part
                          : part.includes("They")
                            ? "它们飞翔。"
                            : part.includes("apple")
                              ? "我吃你给我的那个苹果。"
                              : "鸟儿歌唱。"
                  )
                  .join("")
            : JSON.stringify(result);
        return new Response(
            JSON.stringify(
                gemini
                    ? {
                          modelVersion: "mock-gemini",
                          candidates: [
                              {
                                  content: {parts: [{text: content}]},
                                  finishReason: "STOP"
                              }
                          ]
                      }
                    : {
                          model: "mock-openai",
                          choices: [{message: {content}, finish_reason: "stop"}]
                      }
            )
        );
    }
    if (new URL(url).origin === "https://uapis.cn" && path === "/api/v1/dictionary/lookup") {
        if (init.headers.Authorization) throw new Error("Maimemo credentials leaked to dictionary");
        globalThis.momoMock.calls.push({
            path,
            word: new URL(url).searchParams.get("word")
        });
        if (globalThis.momoMock.mode === "definition-error") return new Response("{}", {status: 429});
        const word = new URL(url).searchParams.get("word");
        return new Response(
            JSON.stringify(
                word === "apple"
                    ? {
                          found: true,
                          entry: {
                              word,
                              definitions: [{meaning: "n. 苹果"}, {part_of_speech: "n.", meaning: "苹果树"}],
                              phonetics: {uk: {text: "ˈæpl"}, us: {text: "ˈæpəl"}}
                          }
                      }
                    : {found: false}
            )
        );
    }
    if (!url.startsWith("https://open.maimemo.com/open/api/v1/memo/")) throw new Error("Unexpected host");
    const body = init.body ? JSON.parse(init.body) : null;
    globalThis.momoMock.calls.push({path, body});
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (globalThis.momoMock.mode === "auth") return new Response("{}", {status: 401});
    if (globalThis.momoMock.mode === "offline") throw new TypeError("Simulated offline connection");
    if (globalThis.momoMock.mode === "rate")
        return new Response("{}", {
            status: 429,
            headers: {"Retry-After": "60"}
        });
    let data;
    if (path.endsWith("/vocabulary/query")) {
        const spelling = body.spellings[0];
        data = {
            voc:
                spelling === "unknown"
                    ? []
                    : spelling === "multiple"
                      ? [
                            {id: "v1", spelling: "apple"},
                            {id: "v2", spelling: "Apple"}
                        ]
                      : [
                            {
                                id: spelling === "apple" ? "v1" : "v-" + spelling.replace(/[^a-zA-Z0-9]/g, "_"),
                                spelling
                            }
                        ]
        };
    } else if (path.endsWith("/interpretations")) {
        if (globalThis.momoMock.mode === "definition-error") return new Response("{}", {status: 403});
        const id = new URL(url).searchParams.get("voc_id");
        data = {
            interpretations: id === "v1" ? [{interpretation: "n. 苹果"}, {interpretation: "n. 苹果树"}] : []
        };
    } else if (path.endsWith("/study/add_words")) {
        if (globalThis.momoMock.mode === "uncertain") throw new TypeError("Simulated connection loss");
        if (globalThis.momoMock.mode === "pending") return new Promise(() => {});
        data = {added_count: globalThis.momoMock.mode === "zero" ? 0 : 1};
    } else if (path.endsWith("/study/query_study_records")) {
        data = {
            records: globalThis.momoMock.mode === "present" ? [{voc_id: body.voc_ids[0]}] : [],
            count: 0
        };
    } else throw new Error("Unexpected endpoint");
    return new Response(JSON.stringify({success: true, data, errors: []}), {
        status: 200
    });
};
require(join(__dirname, "../../out/main/index.js"));
