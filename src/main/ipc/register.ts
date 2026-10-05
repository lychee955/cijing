import {ipcMain, type BrowserWindow} from "electron";
import {z} from "zod";
import {ClientError, resultOf} from "../maimemo/errors";
import {validateSender} from "./security";

interface RegistrationOptions {
    result?: typeof resultOf;
    error?: (code: "FORBIDDEN" | "INVALID_INPUT") => Error;
    run?: (action: () => unknown) => unknown;
    onClose?: () => void;
}

export function createIpcRegistrar(window: BrowserWindow, allowedUrl: string, options: RegistrationOptions = {}) {
    const registered: string[] = [];
    const result = options.result ?? resultOf;
    const error = options.error ?? ((code) => new ClientError(code));
    window.on("closed", () => {
        options.onClose?.();
        for (const channel of registered) ipcMain.removeHandler(channel);
    });
    return <T extends unknown[]>(channel: string, schema: z.ZodType<T>, action: (...args: T) => unknown): void => {
        registered.push(channel);
        ipcMain.handle(channel, (event, ...args: unknown[]) =>
            result(() => {
                try {
                    validateSender(
                        {
                            trustedContents: event.sender === window.webContents,
                            mainFrame: event.senderFrame !== null && event.senderFrame === window.webContents.mainFrame,
                            url: event.senderFrame?.url ?? ""
                        },
                        allowedUrl
                    );
                } catch {
                    throw error("FORBIDDEN");
                }
                const parsed = schema.safeParse(args);
                if (!parsed.success) throw error("INVALID_INPUT");
                const invoke = () => action(...parsed.data);
                return options.run ? options.run(invoke) : invoke();
            })
        );
    };
}
