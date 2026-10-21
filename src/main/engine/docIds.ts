/** doc_ids seen in the 2026-10-15 captures; used only until the live page reveals current ones. */
export const SEED_DOC_IDS: Record<string, string> = {
  IGDThreadListOffMsysPaginationQuery: '28774058922187457',
  IGDMessageListOffMsysQuery: '28798548116496168',
  IGDirectTextSendMutation: '26911679871773184',
  IGDirectEditMessageMutation: '32480262318254796',
  IGDMessageUnsendDialogOffMsysMutation: '26948700068153789',
  IGDirectReactionSendMutation: '24374451552236906'
};

export type DocIdStorage = { load(): Record<string, string>; save(all: Record<string, string>): void };

const isDocId = (id: unknown): id is string => typeof id === 'string' && /^[0-9]{1,25}$/.test(id);

/**
 * Operation name -> doc_id. Priority: observed in live page requests > scraped from JS bundles > remembered from an
 * earlier run > seeded. Learned ids are remembered so an operation the page only uses rarely (e.g. people search)
 * keeps working after a restart.
 */
export class DocIdRegistry {
  private readonly observed = new Map<string, string>();
  private readonly scraped = new Map<string, string>();
  private readonly remembered = new Map<string, string>();

  constructor(private readonly storage?: DocIdStorage) {
    try {
      for (const [name, id] of Object.entries(storage?.load() ?? {})) {
        if (/^[A-Za-z0-9_]{1,100}$/.test(name) && isDocId(id)) this.remembered.set(name, id);
      }
    } catch {
      // No memory from earlier runs; seeds and live learning still work.
    }
  }

  observe(name: string, id: string): void {
    if (isDocId(id)) this.learn(this.observed, name, id);
  }

  scrape(name: string, id: string): void {
    if (isDocId(id)) this.learn(this.scraped, name, id);
  }

  get(name: string): string | null {
    return this.observed.get(name) ?? this.scraped.get(name) ?? this.remembered.get(name) ?? SEED_DOC_IDS[name] ?? null;
  }

  private learn(into: Map<string, string>, name: string, id: string): void {
    into.set(name, id);
    if (this.remembered.get(name) === id) return;
    this.remembered.set(name, id);
    try {
      this.storage?.save(Object.fromEntries(this.remembered));
    } catch {
      // Remembering is best effort.
    }
  }
}
