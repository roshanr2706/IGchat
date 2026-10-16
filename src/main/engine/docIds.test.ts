import { describe, expect, it } from 'vitest';
import { DocIdRegistry, SEED_DOC_IDS } from './docIds';

describe('DocIdRegistry', () => {
  it('prefers observed over scraped over seeded ids', () => {
    const r = new DocIdRegistry();
    expect(r.get('IGDirectTextSendMutation')).toBe(SEED_DOC_IDS.IGDirectTextSendMutation);
    r.scrape('IGDirectTextSendMutation', '111');
    expect(r.get('IGDirectTextSendMutation')).toBe('111');
    r.observe('IGDirectTextSendMutation', '222');
    r.scrape('IGDirectTextSendMutation', '333');
    expect(r.get('IGDirectTextSendMutation')).toBe('222');
    expect(r.get('NoSuchOp')).toBeNull();
  });

  it('ignores non-numeric ids', () => {
    const r = new DocIdRegistry();
    r.observe('X', 'abc');
    expect(r.get('X')).toBeNull();
  });
});
