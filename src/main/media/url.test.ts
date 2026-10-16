import { describe, expect, it } from 'vitest';
import { fromMediaUrl, isAllowedMediaHost, toMediaUrl } from './url';

describe('media urls', () => {
  it('allows only Instagram/Facebook CDN hosts over https', () => {
    expect(isAllowedMediaHost('scontent-sea1-1.cdninstagram.com')).toBe(true);
    expect(isAllowedMediaHost('scontent.xx.fbcdn.net')).toBe(true);
    expect(isAllowedMediaHost('cdninstagram.com.evil.com')).toBe(false);
    expect(toMediaUrl('http://scontent.cdninstagram.com/a.jpg')).toBe('');
    expect(toMediaUrl('https://evil.example.com/a.jpg')).toBe('');
    expect(toMediaUrl(null)).toBe('');
  });

  it('round-trips an allowed url', () => {
    const src = 'https://scontent.cdninstagram.com/v/t51/abc.jpg?stp=dst-jpg&_nc_ht=x';
    const media = toMediaUrl(src);
    expect(media.startsWith('igmedia://m/')).toBe(true);
    expect(fromMediaUrl(media)).toBe(src);
  });

  it('rejects tampered media urls', () => {
    expect(fromMediaUrl('igmedia://m/' + encodeURIComponent('https://evil.example.com/x'))).toBeNull();
    expect(fromMediaUrl('https://scontent.cdninstagram.com/x')).toBeNull();
    expect(fromMediaUrl('igmedia://x/' + encodeURIComponent('https://scontent.cdninstagram.com/x'))).toBeNull();
    expect(fromMediaUrl('not a url')).toBeNull();
  });

  it('rejects userinfo and odd ports, and normalizes via href', () => {
    expect(toMediaUrl('https://user:pw@scontent.cdninstagram.com/a.jpg')).toBe('');
    expect(toMediaUrl('https://scontent.cdninstagram.com:8443/a.jpg')).toBe('');
    expect(toMediaUrl('https://scontent.cdninstagram.com:443/a.jpg')).toBe('igmedia://m/' + encodeURIComponent('https://scontent.cdninstagram.com/a.jpg'));
    expect(fromMediaUrl('igmedia://m/' + encodeURIComponent('https://u@scontent.cdninstagram.com/a.jpg'))).toBeNull();
    expect(fromMediaUrl('igmedia://m/' + encodeURIComponent('https://scontent.cdninstagram.com:81/a.jpg'))).toBeNull();
    expect(fromMediaUrl('igmedia://m/' + encodeURIComponent('http://scontent.cdninstagram.com/a.jpg'))).toBeNull();
    expect(fromMediaUrl('igmedia://m/' + encodeURIComponent('https://SCONTENT.CdnInstagram.com/a.jpg'))).toBe('https://scontent.cdninstagram.com/a.jpg');
    expect(fromMediaUrl('igmedia://m/' + encodeURIComponent(encodeURIComponent('https://scontent.cdninstagram.com/a.jpg')))).toBeNull();
  });
});
