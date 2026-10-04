import {ClientError} from "../maimemo/errors";

export interface SenderInfo {
    trustedContents: boolean;
    mainFrame: boolean;
    url: string;
}
export function validateSender(sender: SenderInfo, allowedUrl: string): void {
    if (!sender.trustedContents || !sender.mainFrame || sender.url !== allowedUrl) throw new ClientError("FORBIDDEN");
}
