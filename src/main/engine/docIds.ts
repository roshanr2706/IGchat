/** doc_ids seen in the 2026-10-15 captures; used only until the live page reveals current ones. */
export const SEED_DOC_IDS: Record<string, string> = {
  IGDThreadListOffMsysPaginationQuery: '28774058922187457',
  IGDMessageListOffMsysQuery: '28798548116496168',
  IGDirectTextSendMutation: '26911679871773184',
  IGDirectEditMessageMutation: '32480262318254796',
  IGDMessageUnsendDialogOffMsysMutation: '26948700068153789',
  IGDirectReactionSendMutation: '24374451552236906'
};

/** Operation name -> doc_id. Priority: observed in live page requests > scraped from JS bundles > seeded. */
export class DocIdRegistry {
  private readonly observed = new Map<string, string>();
  private readonly scraped = new Map<string, string>();

  observe(name: string, id: string): void {
    if (/^\d+$/.test(id)) this.observed.set(name, id);
  }

  scrape(name: string, id: string): void {
    if (/^\d+$/.test(id)) this.scraped.set(name, id);
  }

  get(name: string): string | null {
    return this.observed.get(name) ?? this.scraped.get(name) ?? SEED_DOC_IDS[name] ?? null;
  }
}
