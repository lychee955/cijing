import {execFile} from "node:child_process";
import {join, resolve} from "node:path";
import {promisify} from "node:util";

const execute = promisify(execFile);
// Fail closed, including missing/old PowerShell. Publisher configuration uses the full certificate Subject.
export async function verifyWindowsSignature(publishers: string[], file: string): Promise<string | null> {
    try {
        const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0");
        const {stdout, stderr} = await execute(
            join(powershell, "powershell.exe"),
            [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                '$ErrorActionPreference="Stop"; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $s=Get-AuthenticodeSignature -LiteralPath $env:CIJING_UPDATE_SIGNATURE_FILE; [pscustomobject]@{Status=[int]$s.Status; Subject=$s.SignerCertificate.Subject; Path=$s.Path} | ConvertTo-Json -Compress'
            ],
            {
                windowsHide: true,
                timeout: 20_000,
                maxBuffer: 1024 * 1024,
                env: {
                    ...process.env,
                    PSModulePath: join(powershell, "Modules"),
                    CIJING_UPDATE_SIGNATURE_FILE: file
                }
            }
        );
        if (stderr.trim()) return "无法完成 Windows 签名验证。";
        return signatureResult(publishers, file, JSON.parse(stdout.replace(/^\uFEFF/, "")));
    } catch {
        return "无法完成 Windows 签名验证。";
    }
}
export function signatureResult(publishers: string[], file: string, result: unknown): string | null {
    const info = result as {
        Status?: unknown;
        Subject?: unknown;
        Path?: unknown;
    } | null;
    if (
        !info ||
        info.Status !== 0 ||
        typeof info.Subject !== "string" ||
        typeof info.Path !== "string" ||
        resolve(info.Path).toLowerCase() !== resolve(file).toLowerCase() ||
        !publishers.some((subject) => subject.includes("=") && subject === info.Subject)
    )
        return "更新包签名或发布者不匹配。";
    return null;
}
