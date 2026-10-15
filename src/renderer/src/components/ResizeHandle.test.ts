import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ResizeHandle from './ResizeHandle.svelte';

function setup() {
  const onlive = vi.fn();
  const oncommit = vi.fn();
  const view = render(ResizeHandle, { props: { side: 'left', width: 200, min: 100, max: 400, onlive, oncommit } });
  const handle = view.getByRole('separator');
  Object.assign(handle, { setPointerCapture: vi.fn() });
  return { handle, onlive, oncommit };
}

const ptr = (clientX: number) => ({ clientX, pointerId: 1 });

describe('ResizeHandle', () => {
  it('commits the final position on pointerup', async () => {
    const { handle, oncommit } = setup();
    await fireEvent.pointerDown(handle, ptr(0));
    await fireEvent.pointerMove(handle, ptr(50));
    await fireEvent.pointerUp(handle, ptr(80));
    expect(oncommit).toHaveBeenCalledExactlyOnceWith(280);
  });

  it('commits the last live width, not the cancel position, on pointercancel', async () => {
    const { handle, onlive, oncommit } = setup();
    await fireEvent.pointerDown(handle, ptr(0));
    await fireEvent.pointerMove(handle, ptr(50));
    expect(onlive).toHaveBeenLastCalledWith(250);
    await fireEvent.pointerCancel(handle, ptr(300));
    expect(oncommit).toHaveBeenCalledExactlyOnceWith(250);
  });

  it('commits the start width when cancelled without moving', async () => {
    const { handle, oncommit } = setup();
    await fireEvent.pointerDown(handle, ptr(0));
    await fireEvent.pointerCancel(handle, ptr(300));
    expect(oncommit).toHaveBeenCalledExactlyOnceWith(200);
  });
});
