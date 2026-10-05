import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {ClientError} from "../maimemo/errors";
import {tokenSchema} from "../maimemo/schemas";
import type {CredentialStatus} from "../../shared/models";

import {canEncrypt, type Encryption} from "./encryption";
export type {Encryption} from "./encryption";
export interface CredentialSnapshot {
    profileId: string;
    token: string;
}
const fileSchema = z.object({
    version: z.literal(1),
    profileId: z.string().uuid(),
    ciphertext: z.string().min(1)
});

export class CredentialStore {
    constructor(
        private readonly path: string,
        private readonly encryption: Encryption,
        private readonly platform = process.platform
    ) {}

    private available(): boolean {
        return canEncrypt(this.encryption, this.platform);
    }

    status(): CredentialStatus {
        const configured = existsSync(this.path);
        if (!this.available()) return {configured, available: false};
        if (configured) {
            try {
                this.snapshot();
            } catch {
                return {configured: true, available: false};
            }
        }
        return {configured, available: true};
    }

    snapshot(): CredentialSnapshot {
        if (!this.available()) throw new ClientError("CREDENTIAL_UNAVAILABLE");
        if (!existsSync(this.path)) throw new ClientError("NO_CREDENTIAL");
        try {
            const file = fileSchema.parse(JSON.parse(readFileSync(this.path, "utf8")));
            return {
                profileId: file.profileId,
                token: tokenSchema.parse(this.encryption.decryptString(Buffer.from(file.ciphertext, "base64")))
            };
        } catch {
            throw new ClientError("CREDENTIAL_UNAVAILABLE");
        }
    }

    identity(): string | null {
        if (!existsSync(this.path)) return null;
        try {
            return fileSchema.parse(JSON.parse(readFileSync(this.path, "utf8"))).profileId;
        } catch {
            return null;
        }
    }

    save(input: string): void {
        const parsed = tokenSchema.safeParse(input);
        if (!parsed.success) throw new ClientError("INVALID_INPUT");
        if (!this.available()) throw new ClientError("CREDENTIAL_UNAVAILABLE");
        let ciphertext: string;
        try {
            ciphertext = this.encryption.encryptString(parsed.data).toString("base64");
        } catch {
            throw new ClientError("CREDENTIAL_UNAVAILABLE");
        }
        try {
            mkdirSync(dirname(this.path), {recursive: true});
            const file = {version: 1, profileId: randomUUID(), ciphertext};
            writeFileSync(`${this.path}.tmp`, JSON.stringify(file), {mode: 0o600});
            renameSync(`${this.path}.tmp`, this.path);
        } catch {
            throw new ClientError("STORAGE_ERROR");
        }
    }

    clear(): void {
        try {
            rmSync(this.path, {force: true});
            rmSync(`${this.path}.tmp`, {force: true});
        } catch {
            throw new ClientError("STORAGE_ERROR");
        }
    }
}
