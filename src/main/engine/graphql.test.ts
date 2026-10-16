import { describe, expect, it } from 'vitest';
import { buildGraphQLRequest, classifyGraphQLFailure, envelopeFromRequest, parseForm, parseGraphQLText } from './graphql';

const pageBody =
  'av=17841400000000001&__user=0&__a=1&__req=1a&__hs=20000.HYP&dpr=1&__ccg=GOOD&__rev=1029000000&__s=abc&__hsi=7560000000000000000&__dyn=7xe&__csr=gc&__comet_req=7&fb_dtsg=NAft_TOKEN&jazoest=26123&lsd=LSD_TOKEN&__spin_r=1029000000&__spin_b=trunk&__spin_t=1792100000&__crn=comet.igweb.PolarisDirectInboxRoute&fb_api_caller_class=RelayModern&fb_api_req_friendly_name=IGDBadgeCountOffMsysQuery&variables=%7B%7D&server_timestamps=true&doc_id=27393860900250970';
const pageHeaders = { 'X-IG-App-ID': '936619743392459', 'X-FB-LSD': 'LSD_TOKEN', 'X-ASBD-ID': '359341', 'X-CSRFToken': 'CSRF', 'X-FB-Friendly-Name': 'IGDBadgeCountOffMsysQuery', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0', 'sec-ch-ua': '"Chromium"' };

describe('graphql envelope', () => {
  it('parses url-encoded forms', () => {
    expect(parseForm('a=1&b=%7B%7D&c=x+y')).toEqual({ a: '1', b: '{}', c: 'x y' });
  });

  it('extracts the page envelope without per-request fields or browser-owned headers', () => {
    const env = envelopeFromRequest(pageBody, pageHeaders)!;
    expect(env.form.fb_dtsg).toBe('NAft_TOKEN');
    expect(env.form.lsd).toBe('LSD_TOKEN');
    expect(env.form).not.toHaveProperty('doc_id');
    expect(env.form).not.toHaveProperty('variables');
    expect(env.form).not.toHaveProperty('fb_api_req_friendly_name');
    expect(env.form).not.toHaveProperty('__req');
    expect(env.headers).toEqual({ 'X-IG-App-ID': '936619743392459', 'X-FB-LSD': 'LSD_TOKEN', 'X-ASBD-ID': '359341', 'X-CSRFToken': 'CSRF' });
  });

  it('rejects envelopes without page tokens', () => {
    expect(envelopeFromRequest('a=1', {})).toBeNull();
  });

  it('builds a request for another operation from the envelope', () => {
    const env = envelopeFromRequest(pageBody, pageHeaders)!;
    const req = buildGraphQLRequest(env, 'IGDirectTextSendMutation', '26911679871773184', { text: { sensitive_string_value: 'hi' } }, 46);
    expect(req.path).toBe('/api/graphql');
    const form = parseForm(req.body);
    expect(form).toMatchObject({ fb_dtsg: 'NAft_TOKEN', lsd: 'LSD_TOKEN', __req: '1a', fb_api_caller_class: 'RelayModern', fb_api_req_friendly_name: 'IGDirectTextSendMutation', server_timestamps: 'true', doc_id: '26911679871773184' });
    expect(JSON.parse(form.variables!)).toEqual({ text: { sensitive_string_value: 'hi' } });
    expect(req.headers).toMatchObject({ 'X-FB-Friendly-Name': 'IGDirectTextSendMutation', 'Content-Type': 'application/x-www-form-urlencoded', 'X-FB-LSD': 'LSD_TOKEN' });
  });
});

describe('graphql responses', () => {
  it('parses plain, prefixed and multi-line responses', () => {
    expect(parseGraphQLText('{"data":{"a":1}}')).toEqual({ data: { a: 1 } });
    expect(parseGraphQLText('for (;;);{"data":{"a":2}}')).toEqual({ data: { a: 2 } });
    expect(parseGraphQLText('{"data":{"a":3}}\n{"label":"x","data":{}}')).toEqual({ data: { a: 3 } });
    expect(() => parseGraphQLText('<html>')).toThrow();
    expect(parseGraphQLText(String.fromCharCode(0xfeff) + '\nfor (;;);{"data":{"a":4}}')).toEqual({ data: { a: 4 } });
    expect(parseGraphQLText('{\n  "data": {"a": 5}\n}')).toEqual({ data: { a: 5 } });
    expect(parseGraphQLText('{"label":"x"}\n{"data":{"a":6}}')).toEqual({ data: { a: 6 } });
  });
  it('classifies challenges, body-reported failures and partial data', () => {
    const url = 'https://www.instagram.com/api/graphql';
    expect(classifyGraphQLFailure(403, 'https://www.instagram.com/challenge/abc/', null)).toBe('Checkpoint');
    expect(classifyGraphQLFailure(400, url, { message: 'checkpoint_required' })).toBe('Checkpoint');
    expect(classifyGraphQLFailure(400, url, { message: 'login_required' })).toBe('AuthExpired');
    expect(classifyGraphQLFailure(403, url, null)).toBe('AuthExpired');
    expect(classifyGraphQLFailure(404, url, null)).toBe('Unknown');
    expect(classifyGraphQLFailure(0, url, null)).toBe('Network');
    expect(classifyGraphQLFailure(200, url, { data: { a: 1 }, errors: [{ message: 'partial' }] })).toBeNull();
  });

  it('classifies failures', () => {
    expect(classifyGraphQLFailure(200, 'https://www.instagram.com/api/graphql', { data: {} })).toBeNull();
    expect(classifyGraphQLFailure(200, 'https://www.instagram.com/accounts/login/?next=x', null)).toBe('AuthExpired');
    expect(classifyGraphQLFailure(401, 'https://www.instagram.com/api/graphql', null)).toBe('AuthExpired');
    expect(classifyGraphQLFailure(200, 'https://www.instagram.com/challenge/abc/', null)).toBe('Checkpoint');
    expect(classifyGraphQLFailure(429, 'https://www.instagram.com/api/graphql', null)).toBe('RateLimited');
    expect(classifyGraphQLFailure(502, 'https://www.instagram.com/api/graphql', null)).toBe('Network');
    expect(classifyGraphQLFailure(200, 'https://www.instagram.com/api/graphql', { errors: [{ message: 'Please log in' }] })).toBe('AuthExpired');
    expect(classifyGraphQLFailure(200, 'https://www.instagram.com/api/graphql', { errors: [{ message: 'oops' }] })).toBe('Unknown');
  });
});
