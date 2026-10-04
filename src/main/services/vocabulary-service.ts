import type {Vocabulary} from "../../shared/models";
import {ClientError} from "../maimemo/errors";
import {DictionaryError, type Dictionary} from "../dictionary/uapi";
import type {MaimemoClient} from "../maimemo/client";
import type {CredentialSnapshot} from "../storage/credential-store";

export class VocabularyService {
    private readonly known = new Map<string, Map<string, Vocabulary>>();
    constructor(
        private readonly client: MaimemoClient,
        private readonly dictionary: Dictionary
    ) {}

    async validate(credentials: CredentialSnapshot): Promise<void> {
        // A read-only probe; do not populate selectable words or create study history.
        await this.client.lookup(credentials.token, "apple");
    }

    async lookup(credentials: CredentialSnapshot, spelling: string): Promise<Vocabulary[]> {
        // Maimemo is authoritative for whether a spelling can be added. UAPI only
        // enriches the matches, so an empty or failed dictionary lookup must never
        // remove a Maimemo result.
        const matches = await this.client.lookup(credentials.token, spelling);
        const words = await Promise.all(matches.map((word) => this.enrich(word)));
        const entries = this.known.get(credentials.profileId) ?? new Map<string, Vocabulary>();
        for (const word of words) entries.set(word.id, word);
        while (entries.size > 2000) entries.delete(entries.keys().next().value!);
        this.known.set(credentials.profileId, entries);
        return words;
    }

    get(profileId: string, id: string): Vocabulary {
        const word = this.known.get(profileId)?.get(id);
        if (!word) throw new ClientError("UNKNOWN_WORD");
        return word;
    }

    clear(): void {
        this.known.clear();
    }

    private async enrich(word: Vocabulary): Promise<Vocabulary> {
        try {
            return {...word, ...(await this.dictionary.lookup(word.spelling))};
        } catch (error) {
            return {
                ...word,
                interpretationError: error instanceof DictionaryError ? error.message : "词典查询失败，请稍后重试。"
            };
        }
    }
}
