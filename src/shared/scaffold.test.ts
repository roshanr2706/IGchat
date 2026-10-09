import { describe, expect, it } from 'vitest';

describe('scaffold', () => {
  it('runs vitest in a DOM environment', () => {
    expect(typeof document.createElement).toBe('function');
  });
});
