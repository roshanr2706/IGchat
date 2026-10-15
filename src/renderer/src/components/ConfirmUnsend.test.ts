import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeText } from '../../../shared/test/factories';
import { setBridge } from '../lib/api';
import { createFakeBridge, type FakeBridge } from '../lib/fakeBridge';
import { messages } from '../stores/messages.svelte';
import { ui } from '../stores/ui.svelte';
import ConfirmUnsend from './ConfirmUnsend.svelte';

let bridge: FakeBridge;

beforeEach(() => {
  bridge = createFakeBridge({ 'msg:unsend': () => undefined });
  setBridge(bridge);
  messages.byThread = {
    t1: { messages: [makeText({ id: 'm1', threadId: 't1', senderId: 'me', text: 'regret' })], hasOlder: false, loadingOlder: false, loaded: true, firstUnreadId: null }
  };
  ui.confirmUnsend = { threadId: 't1', messageId: 'm1' };
});

describe('ConfirmUnsend', () => {
  it('shows the message and unsends on confirm', async () => {
    const user = userEvent.setup();
    render(ConfirmUnsend);
    expect(screen.getByText('regret')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Unsend' }));
    expect(ui.confirmUnsend).toBeNull();
    await vi.waitFor(() => expect(bridge.calls.find((c) => c.channel === 'msg:unsend')?.args).toEqual(['t1', 'm1']));
  });

  it('does nothing on cancel', async () => {
    const user = userEvent.setup();
    render(ConfirmUnsend);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ui.confirmUnsend).toBeNull();
    expect(bridge.calls).toHaveLength(0);
  });
});
