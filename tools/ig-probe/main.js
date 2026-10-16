// IGchat store probe: a read-only dev tool for Plan 2.
//
// Opens instagram.com/direct in a HIDDEN window using the capture tool's saved login, and looks
// for Instagram's in-memory Relay store (where the web app keeps threads and messages). It walks
// the React fiber tree for an object that looks like a Relay Environment.
//
// Prints STRUCTURE only: record type names, counts and field names. No message contents, names
// or tokens are printed. It sends nothing and changes nothing.
//
// Run: npx electron tools/ig-probe/main.js

const { app, BrowserWindow, session } = require('electron');

const PARTITION = 'persist:ig-capture';
const WAIT_MS = 25000;
const WATCH_MS = process.argv.includes('--watch') ? 120000 : 0;

// Runs inside the Instagram page. Must be self-contained and must only return structural info.
const PROBE = (watch) => `(() => {
  const WATCH = ${watch ? 'true' : 'false'};
  const out = { url: location.pathname, hasMetaRequire: typeof window.require === 'function' };
  const hasKey = (el) => Object.keys(el).find((k) => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
  let root = null, containerKey = null;
  for (const el of document.querySelectorAll('*')) {
    const k = hasKey(el);
    if (k) { root = el; containerKey = k; break; }
  }
  out.rootTag = root ? root.tagName + (root.id ? '#' + root.id.replace(/[0-9]+/g, 'N') : '') : null;
  out.metaDebug = typeof window.require === 'function' && window.require.__debug ? Object.keys(window.require.__debug) : null;
  const relayModuleHits = [];
  for (const name of ['PolarisRelayEnvironment', 'IGDRelayEnvironment', 'RelayFBEnvironment', 'CometRelayEnvironment', 'PolarisRelayEnvironmentFactory', 'IGDSRelayEnvironment', 'RelayModernEnvironment', 'relay-runtime']) {
    try { const m = window.require(name); relayModuleHits.push([name, typeof m, m && typeof m === 'object' ? Object.keys(m).slice(0, 8) : null]); } catch (e) { /* not defined */ }
  }
  out.relayModuleHits = relayModuleHits;
  out.reactRootFound = Boolean(containerKey);
  if (!containerKey) return out;

  const isEnv = (v) => v && typeof v === 'object' && typeof v.getStore === 'function' && typeof v.execute === 'function';
  let env = null, path = null, visited = 0;
  let start = root[containerKey];
  if (start && start.current) start = start.current;
  const stack = [{ f: start, depth: 0 }];
  while (stack.length && !env && visited < 200000) {
    const { f, depth } = stack.pop();
    if (!f) continue;
    visited++;
    for (const [where, v] of [['memoizedProps', f.memoizedProps], ['stateNode', f.stateNode]]) {
      if (!v || typeof v !== 'object') continue;
      if (isEnv(v.environment)) { env = v.environment; path = where + '.environment'; break; }
      if (isEnv(v.value)) { env = v.value; path = where + '.value'; break; }
      if (v.value && isEnv(v.value.environment)) { env = v.value.environment; path = where + '.value.environment'; break; }
    }
    if (f.child) stack.push({ f: f.child, depth: depth + 1 });
    if (f.sibling) stack.push({ f: f.sibling, depth });
  }
  out.fibersVisited = visited;
  out.environmentFound = Boolean(env);
  out.environmentPath = path;
  if (!env) return out;

  const store = env.getStore();
  out.storeMethods = ['getSource', 'subscribe', 'publish', 'notify', 'lookup', 'check'].filter((m) => typeof store[m] === 'function');
  const source = store.getSource();
  const ids = source.getRecordIDs();
  out.recordCount = ids.length;
  const byType = {};
  const fieldsByType = {};
  for (const id of ids) {
    const rec = source.get(id);
    if (!rec) continue;
    const t = rec.__typename || '(none)';
    byType[t] = (byType[t] || 0) + 1;
    if (!fieldsByType[t]) fieldsByType[t] = Object.keys(rec).filter((k) => !k.startsWith('__')).slice(0, 60);
  }
  if (WATCH) {
    // Wrap store.notify (still calling the original) and count SlideMessage records over time.
    const countMessages = () => source.getRecordIDs().filter((id) => { const r = source.get(id); return r && r.__typename === 'SlideMessage'; }).length;
    window.__igchatProbe = { start: Date.now(), baseline: countMessages(), events: [] };
    const original = store.notify.bind(store);
    store.notify = (...args) => {
      const res = original(...args);
      const n = countMessages();
      const p = window.__igchatProbe;
      if (n !== p.last) p.events.push({ t: Math.round((Date.now() - p.start) / 1000), slideMessages: n });
      p.last = n;
      p.notifies = (p.notifies || 0) + 1;
      return res;
    };
  }
  out.typesByCount = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 60);
  const interesting = Object.keys(fieldsByType).filter((t) => /thread|message|slide|direct|user|reaction/i.test(t));
  out.fieldsOfInterestingTypes = Object.fromEntries(interesting.slice(0, 25).map((t) => [t, fieldsByType[t]]));
  return out;
})()`;

app.whenReady().then(async () => {
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 850,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await win.loadURL('https://www.instagram.com/direct/inbox/');
  await new Promise((r) => setTimeout(r, WAIT_MS));
  const path = new URL(win.webContents.getURL()).pathname;
  if (!path.startsWith('/direct')) {
    console.log(JSON.stringify({ error: 'not logged in or redirected', path }));
    app.quit();
    return;
  }
  try {
    const result = await win.webContents.executeJavaScript(PROBE(WATCH_MS > 0));
    if (WATCH_MS > 0) {
      console.log(`Watching the store for ${WATCH_MS / 1000}s. Send yourself a message now (e.g. from your phone).`);
      await new Promise((r) => setTimeout(r, WATCH_MS));
      const watch = await win.webContents.executeJavaScript('window.__igchatProbe');
      console.log(JSON.stringify({ watch }, null, 2));
      app.quit();
      return;
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ error: String(err) }));
  }
  app.quit();
});
