import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createPinia, setActivePinia} from "pinia";
import {useDesktopStore} from "../../src/renderer/src/stores/desktop";
import type {CredentialStatus, DesktopStatus} from "../../src/shared/models";
import type {Result} from "../../src/shared/result";

const desktopStatus: DesktopStatus = {
    settings: {shortcut: "", closeBehavior: "hide", theme: "system"},
    shortcutRegistered: false,
    trayAvailable: true,
    hideSupported: true,
    recovering: false
};
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((finish) => {
        resolve = finish;
    });
    return {promise, resolve};
}
function setup() {
    const desktop = vi.fn().mockResolvedValue({ok: true, data: desktopStatus});
    const credential = vi.fn().mockResolvedValue({ok: true, data: {configured: false, available: true}});
    const media = {matches: false};
    const dataset: Record<string, string> = {};
    vi.stubGlobal("window", {
        desktop: {desktop: {status: desktop}, credentials: {status: credential}},
        matchMedia: () => media
    });
    vi.stubGlobal("document", {documentElement: {dataset}});
    return {store: useDesktopStore(), desktop, credential, media, dataset};
}
describe("shared desktop state", () => {
    beforeEach(() => setActivePinia(createPinia()));
    afterEach(() => vi.unstubAllGlobals());
    it("merges concurrent reads and allows a later refresh", async () => {
        const {store, desktop, credential} = setup();
        const pending = deferred<Result<CredentialStatus>>();
        credential.mockReturnValueOnce(pending.promise);
        const first = store.refresh();
        const second = store.refresh();
        expect(credential).toHaveBeenCalledOnce();
        expect(desktop).toHaveBeenCalledOnce();
        pending.resolve({ok: true, data: {configured: true, available: true}});
        await Promise.all([first, second]);
        expect(store.credentials.configured).toBe(true);
        await store.refresh();
        expect(credential).toHaveBeenCalledTimes(2);
    });
    it("re-reads after a mutation during an in-flight read and discards the stale state", async () => {
        const {store, credential} = setup();
        const old = deferred<Result<CredentialStatus>>();
        const latest = deferred<Result<CredentialStatus>>();
        credential.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
        const first = store.refresh();
        const changed = store.refresh(true);
        const alsoChanged = store.refresh(true);
        old.resolve({ok: true, data: {configured: true, available: true, invalid: true}});
        await vi.waitFor(() => expect(credential).toHaveBeenCalledTimes(2));
        expect(store.credentialsLoaded).toBe(false);
        latest.resolve({ok: true, data: {configured: true, available: true, verified: true}});
        await Promise.all([first, changed, alsoChanged]);
        expect(store.credentials).toEqual({configured: true, available: true, verified: true});
        expect(credential).toHaveBeenCalledTimes(2);
    });
    it("releases a failed read so a retry can succeed", async () => {
        const {store, credential} = setup();
        credential.mockRejectedValueOnce(new Error("offline"));
        await store.refresh();
        expect(store.credentialsLoaded).toBe(false);
        expect(store.message).toContain("无法连接");
        await store.refresh();
        expect(store.credentialsLoaded).toBe(true);
    });
    it("resolves system appearance while keeping explicit theme choices", async () => {
        const {store, desktop, media, dataset} = setup();
        await store.refresh();
        expect(dataset).toEqual({theme: "system", colorScheme: "light"});
        media.matches = true;
        store.applyTheme();
        expect(dataset.colorScheme).toBe("dark");
        desktop.mockResolvedValue({
            ok: true,
            data: {...desktopStatus, settings: {...desktopStatus.settings, theme: "light"}}
        });
        await store.refresh();
        expect(dataset).toEqual({theme: "light", colorScheme: "light"});
        store.applyTheme();
        expect(dataset.colorScheme).toBe("light");
    });
});
