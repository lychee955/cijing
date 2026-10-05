import {randomUUID} from "node:crypto";
import type {AiConfiguration, AiProfile, AiProfileInput, OutputMode} from "../../shared/ai";
import type {AnalysisHistory, AnalysisRecord} from "../../shared/analysis";
import {canEncrypt, type Encryption} from "./encryption";
import type {OperationsDatabase} from "./database";
import {AiError} from "../ai/errors";
import {optionsSchema, profileInputSchema} from "../ai/config";

interface Row {
    id: string;
    name: string;
    protocol: AiProfile["protocol"];
    base_url: string;
    model: string;
    options: string;
    ciphertext: Buffer;
    revision: number;
    auth_invalid: number;
    updated_at: string;
}

export interface AiSnapshot {
    profile: AiProfile;
    key: string;
}

export class AiStore {
    constructor(
        private readonly db: OperationsDatabase,
        private readonly encryption: Encryption,
        private readonly platform = process.platform
    ) {}

    private rows(): Row[] {
        return this.db.connection.prepare("SELECT * FROM ai_profiles ORDER BY created_at, rowid").all() as Row[];
    }

    private row(id: string): Row | undefined {
        return this.db.connection.prepare("SELECT * FROM ai_profiles WHERE id=?").get(id) as Row | undefined;
    }

    private public(row: Row): AiProfile {
        return {
            id: row.id,
            name: row.name,
            protocol: row.protocol,
            baseUrl: row.base_url,
            model: row.model,
            options: optionsSchema.strip().parse(JSON.parse(row.options)),
            revision: row.revision,
            hasKey: row.ciphertext.length > 0,
            authInvalid: !!row.auth_invalid,
            updatedAt: row.updated_at
        };
    }

    configuration(): AiConfiguration {
        return {
            profiles: this.rows().map((r) => this.public(r)),
            activeId: (this.db.readSetting("aiActive") as string | null) ?? null,
            supplement: (this.db.readSetting("aiSupplement") as string) ?? ""
        };
    }

    private available(): boolean {
        return canEncrypt(this.encryption, this.platform);
    }

    save(input: AiProfileInput): AiProfile {
        const parsed = profileInputSchema.safeParse(input);
        if (!parsed.success) throw new AiError("INVALID_INPUT");
        const value = parsed.data,
            old = value.id ? this.row(value.id) : undefined;
        if (value.id && !old) throw new AiError("AI_CONFIG");
        const hostChanged = old && new URL(old.base_url).host !== new URL(value.baseUrl).host;
        let ciphertext = hostChanged ? Buffer.alloc(0) : (old?.ciphertext ?? Buffer.alloc(0));
        if (value.key) {
            if (!this.available()) throw new AiError("AI_KEY");
            try {
                ciphertext = this.encryption.encryptString(value.key);
            } catch {
                throw new AiError("AI_KEY");
            }
        }
        const id = old?.id ?? randomUUID(),
            now = new Date().toISOString();
        this.db.connection.transaction(() => {
            this.db.connection
                .prepare(
                    `INSERT INTO ai_profiles (id, name, protocol, base_url, model, options, ciphertext, revision,
                                              created_at,
                                              updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO
                    UPDATE
                        SET name =excluded.name, protocol=excluded.protocol, base_url=excluded.base_url, model=excluded.model, options =excluded.options, ciphertext=excluded.ciphertext, revision=excluded.revision, auth_invalid=0, updated_at=excluded.updated_at`
                )
                .run(
                    id,
                    value.name,
                    value.protocol,
                    value.baseUrl,
                    value.model,
                    JSON.stringify(value.options),
                    ciphertext,
                    (old?.revision ?? 0) + 1,
                    now,
                    now
                );
            if (!this.db.readSetting("aiActive")) this.db.writeSetting("aiActive", id);
        })();
        return this.public(this.row(id)!);
    }

    select(id: string): void {
        if (!this.rows().some((r) => r.id === id)) throw new AiError("AI_CONFIG");
        this.db.writeSetting("aiActive", id);
    }

    deleteProfile(id: string): void {
        this.db.connection.transaction(() => {
            this.db.connection.prepare("DELETE FROM ai_profiles WHERE id=?").run(id);
            if (this.configuration().activeId === id) this.db.writeSetting("aiActive", null);
        })();
    }

    supplement(value: string): void {
        this.db.writeSetting("aiSupplement", value);
    }

    snapshot(id: string): AiSnapshot {
        const row = this.rows().find((r) => r.id === id);
        if (!row) throw new AiError("AI_CONFIG");
        if (!row.ciphertext.length || !this.available()) throw new AiError("AI_KEY");
        try {
            return {
                profile: this.public(row),
                key: this.encryption.decryptString(row.ciphertext)
            };
        } catch {
            throw new AiError("AI_KEY");
        }
    }

    markInvalid(id: string): void {
        this.db.connection.prepare("UPDATE ai_profiles SET auth_invalid=1 WHERE id=?").run(id);
    }

    markValid(id: string): void {
        this.db.connection.prepare("UPDATE ai_profiles SET auth_invalid=0 WHERE id=?").run(id);
    }

    verifiedMode(profile: AiProfile): OutputMode | undefined {
        return this.db.readSetting(
            `aiMode:${profile.protocol}:${profile.baseUrl}:${profile.model}:${profile.options.outputMode}`
        ) as OutputMode | undefined;
    }

    rememberMode(profile: AiProfile, mode: OutputMode): void {
        this.db.writeSetting(
            `aiMode:${profile.protocol}:${profile.baseUrl}:${profile.model}:${profile.options.outputMode}`,
            mode
        );
    }

    saveAnalysis(record: AnalysisRecord, reuseKey: string): void {
        this.db.connection
            .prepare("INSERT INTO sentence_analyses (id,record,reuse_key,created_at) VALUES (?,?,?,?)")
            .run(
                record.id,
                JSON.stringify(record),
                record.mode !== "translation" && record.result.degraded ? null : reuseKey,
                record.createdAt
            );
    }

    reuse(key: string): AnalysisRecord | undefined {
        return this.readRecord(
            this.db.connection
                .prepare(
                    "SELECT record FROM sentence_analyses WHERE reuse_key=? ORDER BY created_at DESC, rowid DESC LIMIT 1"
                )
                .get(key)
        );
    }

    get(id: string): AnalysisRecord | undefined {
        return this.readRecord(this.db.connection.prepare("SELECT record FROM sentence_analyses WHERE id=?").get(id));
    }

    history(offset: number, limit: number): AnalysisHistory {
        return {
            total: (
                this.db.connection.prepare("SELECT count(*) AS total FROM sentence_analyses").get() as {total: number}
            ).total,
            items: (
                this.db.connection
                    .prepare(
                        "SELECT record FROM sentence_analyses ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?"
                    )
                    .all(limit, offset) as {record: string}[]
            ).map((r) => JSON.parse(r.record))
        };
    }

    deleteHistory(id?: string): void {
        if (id) this.db.connection.prepare("DELETE FROM sentence_analyses WHERE id=?").run(id);
        else this.db.connection.prepare("DELETE FROM sentence_analyses").run();
    }

    private readRecord(row: unknown): AnalysisRecord | undefined {
        return row ? (JSON.parse((row as {record: string}).record) as AnalysisRecord) : undefined;
    }
}
