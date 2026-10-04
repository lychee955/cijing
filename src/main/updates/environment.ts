import {existsSync, readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {load} from "js-yaml";
import type {UpdateEnvironment} from "../../shared/update";
import policy from "./policy.json";

export function detectEnvironment(input: {
    packaged: boolean;
    version: string;
    platform: string;
    arch: string;
    systemVersion: string;
    resourcesPath: string;
    execPath: string;
    portable?: string;
    validated?: boolean;
}): UpdateEnvironment {
    const base = {
        version: input.version,
        platform: input.platform,
        arch: input.arch,
        systemVersion: input.systemVersion,
        channel: "stable" as const
    };
    if (!input.packaged)
        return {
            ...base,
            installation: "development",
            canCheck: false,
            canInstall: false,
            reason: "开发模式不访问正式更新源。"
        };
    let marked = false,
        signedPolicy = false;
    try {
        marked =
            readFileSync(join(input.resourcesPath, "cijing-nsis-installation"), "utf8").trim() ===
                "com.lychee955.cijing" && existsSync(join(dirname(input.execPath), "Uninstall 词境.exe"));
        const config = load(readFileSync(join(input.resourcesPath, "app-update.yml"), "utf8")) as {
            publisherName?: unknown;
        };
        signedPolicy =
            typeof config.publisherName === "string"
                ? config.publisherName.includes("=")
                : Array.isArray(config.publisherName) &&
                  config.publisherName.length > 0 &&
                  config.publisherName.every((v) => typeof v === "string" && v.includes("="));
    } catch {
        /* Unknown packages never acquire installation capability. */
    }
    const installation =
        input.platform === "win32"
            ? input.portable
                ? "portable"
                : marked
                  ? "nsis"
                  : "unknown"
            : input.platform === "darwin"
              ? "mac-app"
              : "unknown";
    const canCheck = input.platform === "win32" && input.arch === "x64" && ["portable", "nsis"].includes(installation);
    const canInstall =
        canCheck && installation === "nsis" && signedPolicy && (input.validated ?? policy.windowsX64NsisValidated);
    const reason = !canCheck
        ? "此平台、架构或安装形式尚未支持更新。"
        : installation === "portable"
          ? "便携版请下载新版程序，退出当前程序后手动替换；用户数据保留在应用数据目录。"
          : !canInstall
            ? "此安装版尚未完成签名配置和实机升级验收，请通过发布页面手动更新。"
            : undefined;
    return {...base, installation, canCheck, canInstall, reason};
}
