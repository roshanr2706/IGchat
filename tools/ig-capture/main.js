// IGchat traffic capture — a standalone dev tool for Plan 2.
//
// Opens instagram.com in its own isolated Electron window. You log in yourself and use DMs
// normally. Every DM-related HTTP request/response and every realtime WebSocket frame is
// written to .ig-capture/<timestamp>/ as JSON so the real endpoints and payload shapes can
// be studied. Cookies and auth/CSRF headers are stripped before anything is written.
//
// Run:  npx electron tools/ig-capture/main.js
// Stop: close the window. Output stays local (.ig-capture/ is git-ignored).

const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = path.join(__dirname, '..', '..', '.ig-capture', new Date().toISOString().replace(/[:.]/g, '-'));
const PARTITION = 'persist:ig-capture';

// Requests worth keeping: DM REST endpoints, GraphQL, and anything mentioning "direct".
const INTERESTING = [/\/api\/v1\/direct_v2\//, /\/api\/graphql/, /\/graphql\/query/, /direct/i, /\/api\/v1\/users\/.+\/info/];
// Matched against the URL path only, so e.g. a login page with ?next=/direct/ is not captured.
const isInteresting = (url) => {
  try {
    const { pathname } = new URL(url);
    return !pathname.startsWith('/accounts/') && INTERESTING.some((re) => re.test(pathname));
  } catch {
    return false;
  }
};
// Never written to disk.
const REDACT_HEADERS = /^(cookie|set-cookie|authorization|x-csrftoken|x-ig-www-claim|x-instagram-ajax|x-fb-lsd|x-asbd-id)$/i;
const MAX_FRAME_CHARS = 20000;

let seq = 0;

function write(kind, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${String(++seq).padStart(5, '0')}-${kind}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function cleanHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) out[k] = REDACT_HEADERS.test(k) ? '[redacted]' : v;
  return out;
}

function cleanBody(text) {
  if (typeof text !== 'string') return text;
  // Strip common token fields from form bodies and JSON.
  return text
    .replace(/(fb_dtsg|lsd|jazoest|__hs|__rev|__s|__hsi|__dyn|__csr|__comet_req)=[^&]*/g, '$1=[redacted]')
    .replace(/"(fb_dtsg|lsd|csrf_token|token)"\s*:\s*"[^"]*"/g, '"$1":"[redacted]"');
}

function parseMaybeJson(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.replace(/^for \(;;\);/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.length > MAX_FRAME_CHARS ? `${trimmed.slice(0, MAX_FRAME_CHARS)}…[truncated]` : trimmed;
  }
}

async function attach(win) {
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Network.enable', { maxPostDataSize: 1_000_000 });

  const pending = new Map(); // requestId -> { request }
  const sockets = new Map(); // requestId -> url

  dbg.on('message', async (_event, method, params) => {
    try {
      if (method === 'Network.requestWillBeSent') {
        const { request, requestId } = params;
        if (!isInteresting(request.url)) return;
        pending.set(requestId, {
          url: request.url,
          method: request.method,
          headers: cleanHeaders(request.headers),
          postData: cleanBody(request.postData)
        });
      } else if (method === 'Network.responseReceived') {
        const entry = pending.get(params.requestId);
        if (entry) {
          entry.status = params.response.status;
          entry.responseHeaders = cleanHeaders(params.response.headers);
          entry.mimeType = params.response.mimeType;
        }
      } else if (method === 'Network.loadingFinished') {
        const entry = pending.get(params.requestId);
        if (!entry) return;
        pending.delete(params.requestId);
        try {
          const { body, base64Encoded } = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
          entry.response = base64Encoded ? '[binary]' : parseMaybeJson(cleanBody(body));
        } catch {
          entry.response = '[unavailable]';
        }
        write('http', entry);
        console.log(`[http] ${entry.method} ${entry.status} ${entry.url.slice(0, 140)}`);
      } else if (method === 'Network.webSocketCreated') {
        sockets.set(params.requestId, params.url);
        write('ws-open', { url: params.url });
        console.log(`[ws] open ${params.url}`);
      } else if (method === 'Network.webSocketFrameReceived' || method === 'Network.webSocketFrameSent') {
        const url = sockets.get(params.requestId) ?? 'unknown';
        const { opcode, payloadData } = params.response;
        write(method.endsWith('Sent') ? 'ws-sent' : 'ws-recv', {
          url,
          opcode,
          // opcode 2 = binary (base64 from CDP). Kept so MQTT/Thrift framing can be decoded later.
          payload: opcode === 1 ? parseMaybeJson(cleanBody(payloadData)) : payloadData.slice(0, MAX_FRAME_CHARS)
        });
      }
    } catch (err) {
      console.error('[capture] error', err);
    }
  });
}

app.whenReady().then(async () => {
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));

  const win = new BrowserWindow({
    width: 1200,
    height: 850,
    title: 'IGchat capture — log in and use DMs, then close this window',
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain) console.error(`[capture] page failed to load: ${code} ${desc} ${url}`);
  });
  // CDP's Network.enable never resolves on a webContents that has not navigated yet, so load a
  // blank page first; otherwise the tool hangs here and the window stays blank.
  await win.loadURL('about:blank');
  await attach(win);
  await win.loadURL('https://www.instagram.com/direct/inbox/');
  console.log(`\nCapturing to ${OUT_DIR}\nLog in, then: open a few DMs and a group, scroll up in one, send a message,\nreact to one, reply to one, edit one, unsend one, send an image. Close the window when done.\n`);
});

app.on('window-all-closed', () => {
  console.log(`\nDone. ${seq} entries written to ${OUT_DIR}`);
  app.quit();
});
