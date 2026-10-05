import {EventEmitter} from "node:events";
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {BrowserWindow, IpcMainInvokeEvent} from "electron";
import {z} from "zod";
import {createIpcRegistrar} from "../../src/main/ipc/register";
import {registerAnalysisIpc} from "../../src/main/ipc/analysis";
import type {AnalysisService} from "../../src/main/services/analysis-service";
import {ExitGate} from "../../src/main/updates/exit-gate";
import {channels} from "../../src/shared/contracts";

const handlers = vi.hoisted(
    () => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>()
);
vi.mock("electron", () => ({
    ipcMain: {
        handle: (name: string, handler: typeof handlers extends Map<string, infer V> ? V : never) =>
            handlers.set(name, handler),
        removeHandler: (name: string) => handlers.delete(name)
    }
}));
function setup() {
    const frame = {url: "file:///app/index.html"};
    const window = Object.assign(new EventEmitter(), {webContents: {mainFrame: frame}}) as unknown as BrowserWindow;
    const trusted = {sender: window.webContents, senderFrame: frame} as unknown as IpcMainInvokeEvent;
    return {window, frame, trusted};
}
describe("shared IPC registration", () => {
    beforeEach(() => handlers.clear());
    it("validates the complete source and tuple, passes normalized input, and removes handlers", async () => {
        const {window, frame, trusted} = setup();
        const action = vi.fn((value: string) => value);
        const handle = createIpcRegistrar(window, frame.url);
        handle("test", z.tuple([z.string().trim().min(1)]), action);
        const invoke = handlers.get("test")!;
        expect(await invoke(trusted, " value ")).toEqual({ok: true, data: "value"});
        action.mockClear();
        for (const args of [[], [""], ["value", "extra"]])
            expect(await invoke(trusted, ...args)).toMatchObject({ok: false, error: {code: "INVALID_INPUT"}});
        for (const event of [
            {...trusted, sender: {}},
            {...trusted, senderFrame: null},
            {...trusted, senderFrame: {url: frame.url}},
            {...trusted, senderFrame: {...frame, url: frame.url + "?evil"}}
        ])
            expect(await invoke(event as IpcMainInvokeEvent, "value")).toMatchObject({
                ok: false,
                error: {code: "FORBIDDEN"}
            });
        expect(action).not.toHaveBeenCalled();
        window.emit("closed");
        expect(handlers.size).toBe(0);
    });
    it("preserves business gate errors", async () => {
        const {window, frame, trusted} = setup();
        const gate = new ExitGate();
        const action = vi.fn();
        createIpcRegistrar(window, frame.url, {run: (next) => gate.run(next)})("test", z.tuple([]), action);
        expect(gate.acquire(() => false)).toBe(true);
        expect(await handlers.get("test")!(trusted)).toMatchObject({ok: false, error: {code: "BUSY"}});
        expect(action).not.toHaveBeenCalled();
    });
    it("preserves AI error mapping and cancellation on close", async () => {
        const {window, frame, trusted} = setup();
        const gate = new ExitGate();
        const service = {store: {configuration: vi.fn()}, cancel: vi.fn()} as unknown as AnalysisService;
        registerAnalysisIpc(window, frame.url, service, gate);
        const invoke = handlers.get(channels.aiConfig)!;
        expect(await invoke({...trusted, senderFrame: null} as IpcMainInvokeEvent)).toMatchObject({
            ok: false,
            error: {code: "FORBIDDEN"}
        });
        expect(await invoke(trusted, "extra")).toMatchObject({ok: false, error: {code: "INVALID_INPUT"}});
        gate.acquire(() => false);
        expect(await invoke(trusted)).toMatchObject({ok: false, error: {code: "AI_BUSY"}});
        expect(service.store.configuration).not.toHaveBeenCalled();
        window.emit("closed");
        expect(service.cancel).toHaveBeenCalledOnce();
        expect(handlers.size).toBe(0);
    });
});
