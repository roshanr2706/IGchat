import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLICK_SEND_SCRIPT, clickThreadLinkScript, setFileOnPageInput, threadPathFor } from './pageScripts';
import { FakeCdp } from './testing';

const run = (script: string): unknown => (0, eval)(script);

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('page scripts', () => {
  it('builds thread paths safely', () => {
    expect(threadPathFor('1000000000000001')).toBe('/direct/t/1000000000000001/');
    expect(threadPathFor('a/b')).toBe('/direct/t/a%2Fb/');
  });

  it('clicks the thread link when the page shows it', () => {
    document.body.innerHTML = '<a href="/direct/t/111/">one</a><a href="/direct/t/222/">two</a>';
    const link = document.querySelector('a[href="/direct/t/222/"]') as HTMLAnchorElement;
    const click = vi.fn((e: Event) => e.preventDefault());
    link.addEventListener('click', click);
    expect(run(clickThreadLinkScript('222'))).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(run(clickThreadLinkScript('333'))).toBe(false);
  });

  it('clicks a Send button by label or text', () => {
    document.body.innerHTML = '<div role="button" aria-label="Send"></div>';
    const btn = document.querySelector('[role="button"]') as HTMLElement;
    const click = vi.fn();
    btn.addEventListener('click', click);
    expect(run(CLICK_SEND_SCRIPT)).toBe(true);
    expect(click).toHaveBeenCalled();
    document.body.innerHTML = '<button> Send </button>';
    expect(run(CLICK_SEND_SCRIPT)).toBe(true);
    document.body.innerHTML = '<button>Cancel</button>';
    expect(run(CLICK_SEND_SCRIPT)).toBe(false);
  });

  it('hands a file to the page file input through CDP', async () => {
    const cdp = new FakeCdp();
    cdp.responses.set('DOM.getDocument', { root: { nodeId: 1 } });
    cdp.responses.set('DOM.querySelectorAll', { nodeIds: [5, 9] });
    expect(await setFileOnPageInput(cdp, 'C:\tmp\a.png')).toBe(true);
    expect(cdp.sent.at(-1)).toEqual({ method: 'DOM.setFileInputFiles', params: { nodeId: 9, files: ['C:\tmp\a.png'] } });
    cdp.responses.set('DOM.querySelectorAll', { nodeIds: [] });
    expect(await setFileOnPageInput(cdp, 'x')).toBe(false);
  });
});
