import { describe, expect, it, vi } from 'vitest';
import { Emitter } from './emitter';

type Events = { ping: (n: number) => void; pair: (a: string, b: string) => void };

describe('Emitter', () => {
  it('delivers events to listeners and supports unsubscribe', () => {
    const e = new Emitter<Events>();
    const fn = vi.fn();
    const off = e.on('ping', fn);
    e.emit('ping', 1);
    off();
    e.emit('ping', 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('passes multiple arguments', () => {
    const e = new Emitter<Events>();
    const fn = vi.fn();
    e.on('pair', fn);
    e.emit('pair', 'a', 'b');
    expect(fn).toHaveBeenCalledWith('a', 'b');
  });
});
