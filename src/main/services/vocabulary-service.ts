import type { Vocabulary } from '../../shared/models'
import { ClientError } from '../maimemo/errors'
import type { MaimemoClient } from '../maimemo/client'
import type { CredentialSnapshot } from '../storage/credential-store'

export class VocabularyService {
  private readonly known = new Map<string, Map<string, Vocabulary>>()
  constructor(private readonly client: MaimemoClient) {}

  async lookup(credentials: CredentialSnapshot, spelling: string): Promise<Vocabulary[]> {
    const words = await this.client.lookup(credentials.token, spelling)
    const entries = this.known.get(credentials.profileId) ?? new Map<string, Vocabulary>()
    for (const word of words) entries.set(word.id, word)
    while (entries.size > 2000) entries.delete(entries.keys().next().value!)
    this.known.set(credentials.profileId, entries)
    return words
  }

  get(profileId: string, id: string): Vocabulary {
    const word = this.known.get(profileId)?.get(id)
    if (!word) throw new ClientError('UNKNOWN_WORD')
    return word
  }

  clear(): void { this.known.clear() }
}
