import type {BrowserWindow} from "electron";
import {z} from "zod";
import {channels} from "../../shared/contracts";
import {createIpcRegistrar} from "./register";
import type {UpdateService} from "../updates/service";

export function registerUpdateIpc(window: BrowserWindow, allowedUrl: string, service: UpdateService): void {
    const handle = createIpcRegistrar(window, allowedUrl);
    const noArgs = z.tuple([]);
    const actions = {
        [channels.updateStatus]: () => service.status(),
        [channels.updateCheck]: () => service.check(),
        [channels.updateDownload]: () => service.download(),
        [channels.updateInstall]: () => service.install(),
        [channels.updateOpenRelease]: () => service.openRelease()
    };
    for (const [channel, action] of Object.entries(actions)) handle(channel, noArgs, action);
}
