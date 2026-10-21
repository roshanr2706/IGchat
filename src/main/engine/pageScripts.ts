import type { CdpLike } from './types';

export const FILE_INPUT_SELECTOR = 'input[type="file"]';

export function threadPathFor(threadId: string): string {
  return `/direct/t/${encodeURIComponent(threadId)}/`;
}

/** True when the url is the thread's page (a trailing slash is optional). */
export function pathMatchesThread(url: string, threadId: string): boolean {
  try {
    const p = new URL(url).pathname;
    return (p.endsWith('/') ? p : p + '/') === threadPathFor(threadId);
  } catch {
    return false;
  }
}

/** Polls the page url until it is the thread's page. Returns false if it never gets there within timeoutMs. */
export async function waitForThreadUrl(
  getUrl: () => string,
  threadId: string,
  sleep: (ms: number) => Promise<void>,
  timeoutMs = 8000,
  stepMs = 250
): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += stepMs) {
    if (pathMatchesThread(getUrl(), threadId)) return true;
    await sleep(stepMs);
  }
  return pathMatchesThread(getUrl(), threadId);
}

/** Clicks the thread's link in Instagram's own inbox list (an in-app navigation, like a user's click). Returns false if not shown. */
export function clickThreadLinkScript(threadId: string): string {
  return `(() => { const href = ${JSON.stringify(threadPathFor(threadId))}; const a = Array.from(document.querySelectorAll('a[href]')).find((el) => el.getAttribute('href') === href); if (!a) return false; a.click(); return true; })()`;
}

/**
 * Clicks Instagram's Send control if one is showing (used after attaching an image). Language-independent first:
 * the submit control in the form around the last attach input (the one setFileOnPageInput fills). Falls back to a control labelled "send".
 */
export const CLICK_SEND_SCRIPT = `(() => { const inputs = document.querySelectorAll('input[type="file"]'); const input = inputs[inputs.length - 1]; const form = input && input.closest('form'); const submit = form && form.querySelector('button[type="submit"], [role="button"][type="submit"], input[type="submit"]'); if (submit) { submit.click(); return true; } const els = Array.from(document.querySelectorAll('[role="button"], button')); const send = els.find((el) => (el.getAttribute('aria-label') || '').trim().toLowerCase() === 'send' || (el.textContent || '').trim().toLowerCase() === 'send'); if (!send) return false; send.click(); return true; })()`;

/** Gives a local file to the page's own attach input, exactly as a user's file picker would. */
export async function setFileOnPageInput(cdp: CdpLike, filePath: string): Promise<boolean> {
  const doc = await cdp.send<{ root?: { nodeId: number } }>('DOM.getDocument', { depth: 0 });
  if (!doc?.root) return false;
  const found = await cdp.send<{ nodeIds?: number[] }>('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: FILE_INPUT_SELECTOR });
  const target = found?.nodeIds?.at(-1);
  if (!target) return false;
  await cdp.send('DOM.setFileInputFiles', { nodeId: target, files: [filePath] });
  return true;
}

/**
 * Looks up an operation's doc id through the page's own module system. If Instagram hasn't loaded that module yet,
 * its lazy loader fetches it, the same way the page does when the matching UI (e.g. the new-message dialog) opens.
 * Resolves to the id string, or null.
 */
export function docIdLookupScript(operationName: string, timeoutMs = 8000): string {
  if (!/^\w{1,100}$/.test(operationName)) return 'Promise.resolve(null)';
  const mod = JSON.stringify(`${operationName}_instagramRelayOperation`);
  return `(() => new Promise((resolve) => {
  const asId = (m) => { const v = m && typeof m === 'object' && 'default' in m ? m.default : m; return typeof v === 'string' && /^[0-9]{5,25}$/.test(v) ? v : null; };
  try {
    if (typeof window.require === 'function') {
      try { const v = asId(window.require(${mod})); if (v) return resolve(v); } catch (e) {}
    }
    if (typeof window.requireLazy !== 'function') return resolve(null);
    const t = setTimeout(() => resolve(null), ${Math.max(1, Math.floor(timeoutMs))});
    window.requireLazy([${mod}], (m) => { clearTimeout(t); resolve(asId(m)); });
  } catch (e) { resolve(null); }
}))()`;
}

/**
 * Diagnostics for a failed doc id lookup: only the shape of the page's module system and the names of search-related
 * operation modules (public code identifiers). Never reads any user data.
 */
export const DOC_ID_DIAG_SCRIPT = `(() => {
  const req = window.require;
  const dbg = req && req.__debug && typeof req.__debug === 'object' ? req.__debug : null;
  const mods = dbg && dbg.modules && typeof dbg.modules === 'object' ? Object.keys(dbg.modules) : [];
  const ops = mods.filter((n) => /_instagramRelayOperation$/.test(n));
  return {
    require: typeof req,
    requireLazy: typeof window.requireLazy,
    debugModules: mods.length,
    relayOperations: ops.length,
    searchOperations: ops.filter((n) => /search|omni|picker|recipient|typeahead/i.test(n)).map((n) => n.replace(/_instagramRelayOperation$/, '')).slice(0, 25)
  };
})()`;
