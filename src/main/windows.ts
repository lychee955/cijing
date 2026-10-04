import {app, BrowserWindow, nativeTheme, screen} from "electron";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {channels} from "../shared/contracts";
import type {DesktopSettings, PageName} from "../shared/models";
import type {SettingsStore} from "./storage/settings";
import {windowIcon} from "./icon";
import {visibleBounds} from "./window-bounds";
import brand from "../shared/brand.json";

export class WindowManager {
    readonly window: BrowserWindow;
    readonly allowedUrl: string;
    private quitting = false;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    private nextPage: PageName = "search";

    constructor(
        private readonly settings: SettingsStore,
        private readonly canHide: () => boolean
    ) {
        const rendererFile = join(__dirname, "../renderer/index.html");
        const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
        if (devUrl) {
            const parsed = new URL(devUrl);
            if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(parsed.hostname))
                throw new Error("Development renderer must use loopback HTTP");
        }
        this.allowedUrl = devUrl ? new URL(devUrl).href : pathToFileURL(rendererFile).href;
        const bounds = visibleBounds(settings.bounds(), this.workAreas());
        this.window = new BrowserWindow({
            ...bounds,
            minWidth: Math.min(620, bounds.width),
            minHeight: Math.min(580, bounds.height),
            show: false,
            title: brand.title,
            backgroundColor: "#f5f3ee",
            autoHideMenuBar: true,
            icon: windowIcon(),
            webPreferences: {
                preload: join(__dirname, "../preload/index.js"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                webSecurity: true,
                webviewTag: false
            }
        });
        this.window.setMenu(null);
        this.window.webContents.setWindowOpenHandler(() => ({action: "deny"}));
        this.window.webContents.on("will-navigate", (event) => event.preventDefault());
        this.window.webContents.on("will-attach-webview", (event) => event.preventDefault());
        this.window.on("move", () => this.scheduleSave());
        this.window.on("resize", () => this.scheduleSave());
        this.window.on("close", (event) => {
            this.saveBounds();
            if (this.quitting) return;
            event.preventDefault();
            if (this.settings.read().closeBehavior === "quit") app.quit();
            else this.hide();
        });
        app.on("before-quit", () => {
            this.quitting = true;
            this.saveBounds();
        });
        this.window.webContents.on("did-finish-load", () => this.navigate(this.nextPage));
        this.window.once("ready-to-show", () => this.reveal(this.nextPage));
        screen.on("display-removed", this.correctBounds);
        screen.on("display-metrics-changed", this.correctBounds);
        this.applyTheme(settings.read());
    }

    load(): void {
        void this.window.loadURL(this.allowedUrl).catch(() => {
            console.error("[desktop] renderer-load-failed");
            this.window.show();
        });
    }
    reveal(page: PageName = "search"): void {
        if (this.window.isDestroyed()) return;
        this.nextPage = page;
        this.correctBounds();
        if (this.window.isMinimized()) this.window.restore();
        this.window.show();
        this.window.focus();
        this.navigate(page);
    }
    hide(): void {
        if (this.canHide()) this.window.hide();
        else this.window.minimize(); // Keep a taskbar/dock entry when the tray cannot be trusted.
    }
    prepareUpdateExit(): void {
        this.quitting = true;
        this.saveBounds();
    }
    applyTheme(settings: DesktopSettings): void {
        nativeTheme.themeSource = settings.theme;
    }
    private navigate(page: PageName): void {
        if (!this.window.webContents.isLoadingMainFrame()) this.window.webContents.send(channels.navigate, page);
    }
    private workAreas() {
        const primary = screen.getPrimaryDisplay();
        return [
            primary.workArea,
            ...screen
                .getAllDisplays()
                .filter((display) => display.id !== primary.id)
                .map((display) => display.workArea)
        ];
    }
    private correctBounds = (): void => {
        if (this.window.isDestroyed() || this.window.isMaximized() || this.window.isFullScreen()) return;
        const current = this.window.getBounds(),
            next = visibleBounds(current, this.workAreas());
        if (Object.keys(next).some((key) => next[key as keyof typeof next] !== current[key as keyof typeof next]))
            this.window.setBounds(next);
    };
    private scheduleSave(): void {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.saveBounds(), 300);
    }
    private saveBounds(): void {
        clearTimeout(this.saveTimer);
        if (this.window.isDestroyed()) return;
        try {
            this.settings.saveBounds(this.window.getNormalBounds());
        } catch {
            console.warn("[storage] window-bounds-save-failed");
        }
    }
    dispose(): void {
        clearTimeout(this.saveTimer);
        screen.removeListener("display-removed", this.correctBounds);
        screen.removeListener("display-metrics-changed", this.correctBounds);
    }
}
