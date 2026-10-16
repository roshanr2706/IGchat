import type { CdpLike } from './types';

export const FILE_INPUT_SELECTOR = 'input[type="file"]';

export function threadPathFor(threadId: string): string {
  return `/direct/t/${encodeURIComponent(threadId)}/`;
}

/** Clicks the thread's link in Instagram's own inbox list (an in-app navigation, like a user's click). Returns false if not shown. */
export function clickThreadLinkScript(threadId: string): string {
  return `(() => { const href = ${JSON.stringify(threadPathFor(threadId))}; const a = Array.from(document.querySelectorAll('a[href]')).find((el) => el.getAttribute('href') === href); if (!a) return false; a.click(); return true; })()`;
}

/** Clicks Instagram's Send control if one is showing (used after attaching an image). */
export const CLICK_SEND_SCRIPT = `(() => { const els = Array.from(document.querySelectorAll('[role="button"], button')); const send = els.find((el) => (el.getAttribute('aria-label') || '').trim().toLowerCase() === 'send' || (el.textContent || '').trim().toLowerCase() === 'send'); if (!send) return false; send.click(); return true; })()`;

/** Gives a local file to the page's own attach input, exactly as a user's file picker would. */
export async function setFileOnPageInput(cdp: CdpLike, filePath: string): Promise<boolean> {
  const doc = await cdp.send<{ root?: { nodeId: number } }>('DOM.getDocument', { depth: -1, pierce: true });
  if (!doc.root) return false;
  const found = await cdp.send<{ nodeIds?: number[] }>('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: FILE_INPUT_SELECTOR });
  const target = found.nodeIds?.at(-1);
  if (!target) return false;
  await cdp.send('DOM.setFileInputFiles', { nodeId: target, files: [filePath] });
  return true;
}
