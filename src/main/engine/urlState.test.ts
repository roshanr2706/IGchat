import { describe, expect, it } from 'vitest';
import { classifyEngineUrl, isAllowedNavigation, RedirectPolicy, threadIdFromUrl } from './urlState';

describe('classifyEngineUrl', () => {
  it('recognizes the DM app as ready', () => {
    expect(classifyEngineUrl('https://www.instagram.com/direct/inbox/')).toEqual({ kind: 'ready' });
    expect(classifyEngineUrl('https://www.instagram.com/direct/t/1000000000000001/')).toEqual({ kind: 'ready' });
  });

  it('recognizes pages that need the user', () => {
    expect(classifyEngineUrl('https://www.instagram.com/accounts/login/?next=%2Fdirect%2Finbox%2F')).toEqual({ kind: 'needsUser', reason: 'login' });
    expect(classifyEngineUrl('https://www.instagram.com/accounts/onetap/?next=%2F')).toEqual({ kind: 'needsUser', reason: 'login' });
    expect(classifyEngineUrl('https://www.instagram.com/challenge/AbC/')).toEqual({ kind: 'needsUser', reason: 'challenge' });
    expect(classifyEngineUrl('https://www.instagram.com/auth_platform/codeentry/')).toEqual({ kind: 'needsUser', reason: 'challenge' });
    expect(classifyEngineUrl('https://www.instagram.com/consent/?flow=x')).toEqual({ kind: 'needsUser', reason: 'login' });
  });

  it('sends other Instagram pages back to the inbox and flags foreign sites', () => {
    expect(classifyEngineUrl('https://www.instagram.com/')).toEqual({ kind: 'goInbox' });
    expect(classifyEngineUrl('https://www.instagram.com/explore/')).toEqual({ kind: 'goInbox' });
    expect(classifyEngineUrl('https://www.facebook.com/login')).toEqual({ kind: 'foreign' });
    expect(classifyEngineUrl('https://instagram.com.evil.com/direct/')).toEqual({ kind: 'foreign' });
  });

  it('treats blank and invalid urls as starting', () => {
    expect(classifyEngineUrl('about:blank')).toEqual({ kind: 'starting' });
    expect(classifyEngineUrl('')).toEqual({ kind: 'starting' });
  });
});

describe('classifyEngineUrl edge cases', () => {
  it('only treats /direct and its children as the DM app', () => {
    expect(classifyEngineUrl('https://www.instagram.com/direct')).toEqual({ kind: 'ready' });
    expect(classifyEngineUrl('https://www.instagram.com/directv/')).toEqual({ kind: 'goInbox' });
  });

  it('leaves password reset alone as a normal Instagram page', () => {
    expect(classifyEngineUrl('https://www.instagram.com/accounts/password/reset/')).toEqual({ kind: 'goInbox' });
  });

  it('rejects http, other ports and lookalike hosts', () => {
    expect(classifyEngineUrl('http://www.instagram.com/direct/inbox/')).toEqual({ kind: 'foreign' });
    expect(classifyEngineUrl('https://www.instagram.com:8443/direct/inbox/')).toEqual({ kind: 'foreign' });
    expect(classifyEngineUrl('https://instagram.com.evil.com/direct/inbox/')).toEqual({ kind: 'foreign' });
  });
});

describe('isAllowedNavigation', () => {
  it('allows https Instagram, Facebook and Meta hosts only', () => {
    expect(isAllowedNavigation('https://www.instagram.com/accounts/login/')).toBe(true);
    expect(isAllowedNavigation('https://m.facebook.com/login')).toBe(true);
    expect(isAllowedNavigation('https://accountscenter.meta.com/x')).toBe(true);
    expect(isAllowedNavigation('http://www.instagram.com/')).toBe(false);
    expect(isAllowedNavigation('https://notinstagram.com/')).toBe(false);
    expect(isAllowedNavigation('https://instagram.com.evil.com/')).toBe(false);
    expect(isAllowedNavigation('not a url')).toBe(false);
  });
});

describe('RedirectPolicy', () => {
  it('backs off 1s, 2s, 4s then gives up, and resets', () => {
    const p = new RedirectPolicy(3, 60_000, () => 0);
    expect(p.record()).toEqual({ action: 'reload', delayMs: 1000 });
    expect(p.record()).toEqual({ action: 'reload', delayMs: 2000 });
    expect(p.record()).toEqual({ action: 'reload', delayMs: 4000 });
    expect(p.record()).toEqual({ action: 'giveUp' });
    p.reset();
    expect(p.record()).toEqual({ action: 'reload', delayMs: 1000 });
  });

  it('forgets redirects older than the window', () => {
    let t = 0;
    const p = new RedirectPolicy(3, 60_000, () => t);
    p.record();
    p.record();
    p.record();
    t = 61_000;
    expect(p.record()).toEqual({ action: 'reload', delayMs: 1000 });
  });
});

describe('threadIdFromUrl', () => {
  it('reads the thread id from a DM url', () => {
    expect(threadIdFromUrl('https://www.instagram.com/direct/t/1000000000000001/')).toBe('1000000000000001');
    expect(threadIdFromUrl('https://www.instagram.com/direct/inbox/')).toBeNull();
    expect(threadIdFromUrl('nope')).toBeNull();
  });
});
