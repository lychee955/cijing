import {EventEmitter} from "node:events";
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {BrowserWindow, IpcMainInvokeEvent} from "electron";
import {registerUpdateIpc} from "../../src/main/ipc/updates";
import {channels} from "../../src/shared/contracts";
import type {UpdateService} from "../../src/main/updates/service";

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
describe("update IPC boundary", () => {
    beforeEach(() => handlers.clear());
    it("accepts only no-argument actions from the owned main frame, removing handlers on close", async () => {
        const frame = {url: "file:///app/index.html"};
        const window = Object.assign(new EventEmitter(), {
            webContents: {mainFrame: frame}
        }) as unknown as BrowserWindow;
        const service = {
            status: vi.fn(() => "status"),
            check: vi.fn(() => "check"),
            download: vi.fn(),
            install: vi.fn(),
            openRelease: vi.fn()
        };
        registerUpdateIpc(window, frame.url, service as unknown as UpdateService);
        const trusted = {
            sender: window.webContents,
            senderFrame: frame
        } as unknown as IpcMainInvokeEvent;
        expect(await handlers.get(channels.updateCheck)!(trusted)).toEqual({
            ok: true,
            data: "check"
        });
        for (const channel of [
            channels.updateStatus,
            channels.updateCheck,
            channels.updateDownload,
            channels.updateInstall,
            channels.updateOpenRelease
        ]) {
            const action = handlers.get(channel)!;
            expect(await action(trusted, "https://evil.test/payload.exe")).toMatchObject({
                ok: false,
                error: {code: "INVALID_INPUT"}
            });
            expect(await action({...trusted, sender: {}} as IpcMainInvokeEvent)).toMatchObject({
                ok: false,
                error: {code: "FORBIDDEN"}
            });
            expect(await action({...trusted, senderFrame: null} as IpcMainInvokeEvent)).toMatchObject({
                ok: false,
                error: {code: "FORBIDDEN"}
            });
        }
        expect(service.install).not.toHaveBeenCalled();
        window.emit("closed");
        expect(handlers.size).toBe(0);
    });
});
