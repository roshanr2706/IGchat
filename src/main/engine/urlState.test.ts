import { describe, expect, it } from 'vitest';
import { classifyEngineUrl } from './urlState';

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
