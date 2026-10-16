import type { ErrorCode } from '../../shared/ipc';
import type { Envelope } from './types';

export const GRAPHQL_PATH = '/api/graphql';

/** Form fields that belong to one request rather than the session. */
const PER_REQUEST = new Set(['doc_id', 'variables', 'fb_api_req_friendly_name', 'fb_api_caller_class', 'fb_api_analytics_tags', 'server_timestamps', '__req', 'qpl_active_flow_ids']);
/** Headers copied from the page's own requests; everything else (UA, sec-ch-*, cookies) is the browser's job. */
const ENVELOPE_HEADERS = ['X-IG-App-ID', 'X-FB-LSD', 'X-ASBD-ID', 'X-CSRFToken'];

export function parseForm(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

export function envelopeFromRequest(postData: string, headers: Record<string, string>): Envelope | null {
  const form = parseForm(postData);
  if (!form.fb_dtsg || !form.lsd) return null;
  const keep: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) if (!PER_REQUEST.has(k)) keep[k] = v;
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const hdrs: Record<string, string> = {};
  for (const name of ENVELOPE_HEADERS) {
    const v = lower.get(name.toLowerCase());
    if (v) hdrs[name] = v;
  }
  return { form: keep, headers: hdrs };
}

export function buildGraphQLRequest(
  envelope: Envelope,
  name: string,
  docId: string,
  variables: unknown,
  req: number
): { path: string; body: string; headers: Record<string, string> } {
  const form: Record<string, string> = {
    ...envelope.form,
    __req: req.toString(36),
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: name,
    variables: JSON.stringify(variables),
    server_timestamps: 'true',
    doc_id: docId
  };
  return {
    path: GRAPHQL_PATH,
    body: new URLSearchParams(form).toString(),
    headers: { ...envelope.headers, 'Content-Type': 'application/x-www-form-urlencoded', 'X-FB-Friendly-Name': name }
  };
}

/** Parses a GraphQL response body; Instagram may prefix `for (;;);` and stream several JSON lines. Throws when none parse. */
export function parseGraphQLText(text: string): Record<string, unknown> {
  const body = text.replace(/^for \(;;\);/, '');
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // try the next line
    }
  }
  throw new Error('Unparseable GraphQL response');
}

export function classifyGraphQLFailure(status: number, finalUrl: string, json: Record<string, unknown> | null): ErrorCode | null {
  if (/\/accounts\/login/.test(finalUrl) || status === 401 || status === 403) return 'AuthExpired';
  if (/\/challenge\//.test(finalUrl)) return 'Checkpoint';
  if (status === 429) return 'RateLimited';
  if (status >= 500 || status === 0) return 'Network';
  if (status >= 400) return 'Unknown';
  const errors = Array.isArray(json?.errors) ? (json!.errors as unknown[]) : [];
  if (errors.length && !json?.data) {
    const text = JSON.stringify(errors).toLowerCase();
    if (text.includes('log in') || text.includes('login')) return 'AuthExpired';
    if (text.includes('checkpoint') || text.includes('challenge')) return 'Checkpoint';
    if (text.includes('rate') && text.includes('limit')) return 'RateLimited';
    return 'Unknown';
  }
  return null;
}
