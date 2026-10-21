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

  it('remembers learned ids across runs, below anything learned this run', () => {
    const saved: Record<string, string>[] = [];
    const first = new DocIdRegistry({ load: () => ({}), save: (all) => void saved.push(all) });
    first.observe('IGDOmniPickerSearchResultsListQuery', '555');
    first.observe('IGDOmniPickerSearchResultsListQuery', '555');
    expect(saved).toEqual([{ IGDOmniPickerSearchResultsListQuery: '555' }]);
    const next = new DocIdRegistry({ load: () => ({ ...saved.at(-1), Junk: 'abc', __proto__: '1' }), save: () => {} });
    expect(next.get('IGDOmniPickerSearchResultsListQuery')).toBe('555');
    expect(next.get('Junk')).toBeNull();
    next.scrape('IGDOmniPickerSearchResultsListQuery', '666');
    expect(next.get('IGDOmniPickerSearchResultsListQuery')).toBe('666');
  });

  it('works without storage when loading fails', () => {
    const r = new DocIdRegistry({
      load: () => {
        throw new Error('disk');
      },
      save: () => {
        throw new Error('disk');
      }
    });
    expect(() => r.observe('A', '1')).not.toThrow();
    expect(r.get('A')).toBe('1');
  });

  it('ignores non-numeric ids', () => {
    const r = new DocIdRegistry();
    r.observe('X', 'abc');
    expect(r.get('X')).toBeNull();
  });
});
