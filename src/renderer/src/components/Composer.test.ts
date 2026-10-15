import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeText, makeThread, makeUser } from '../../../shared/test/factories';
import { setBridge } from '../lib/api';
import { createFakeBridge, type FakeBridge } from '../lib/fakeBridge';
import { inbox } from '../stores/inbox.svelte';
import { messages } from '../stores/messages.svelte';
import { ui } from '../stores/ui.svelte';
import Composer from './Composer.svelte';

const alex = makeUser({ id: 'ua', username: 'alex', fullName: 'Alex' });
const thread = makeThread({ id: 't1', title: 'Alex', participants: [alex] });
let bridge: FakeBridge;

beforeEach(() => {
  bridge = createFakeBridge({
    'msg:sendText': (threadId, text) => makeText({ id: `real-${text}`, threadId, senderId: 'me', text })
  });
  setBridge(bridge);
  inbox.me = makeUser({ id: 'me' });
  messages.byThread = { t1: { messages: [], hasOlder: false, loadingOlder: false, loaded: true, firstUnreadId: null } };
  ui.replyTo = null;
  ui.editingId = null;
});

const box = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Message @alex' }) as HTMLTextAreaElement;

describe('Composer', () => {
  it('sends on Enter and clears the box', async () => {
    const user = userEvent.setup();
    render(Composer, { props: { thread } });
    await user.type(box(), 'hello{Enter}');
    await vi.waitFor(() => expect(bridge.calls.find((c) => c.channel === 'msg:sendText')?.args).toEqual(['t1', 'hello', null]));
    expect(box().value).toBe('');
  });

  it('inserts a newline on Shift+Enter instead of sending', async () => {
    const user = userEvent.setup();
    render(Composer, { props: { thread } });
    await user.type(box(), 'a{Shift>}{Enter}{/Shift}b');
    expect(box().value).toBe('a\nb');
    expect(bridge.calls.some((c) => c.channel === 'msg:sendText')).toBe(false);
  });

  it('does not send whitespace-only messages', async () => {
    const user = userEvent.setup();
    render(Composer, { props: { thread } });
    await user.type(box(), '   {Enter}');
    expect(bridge.calls.some((c) => c.channel === 'msg:sendText')).toBe(false);
  });

  it('edits your last message with ArrowUp in an empty box', async () => {
    const user = userEvent.setup();
    messages.byThread.t1!.messages = [makeText({ id: 'mine', threadId: 't1', senderId: 'me', timestamp: Date.now() - 1000 })];
    render(Composer, { props: { thread } });
    await user.type(box(), '{ArrowUp}');
    expect(ui.editingId).toBe('mine');
  });

  it('shows the reply banner and sends the reply reference', async () => {
    const user = userEvent.setup();
    ui.replyTo = makeText({ id: 'orig', threadId: 't1', senderId: 'ua', text: 'are you coming?' });
    render(Composer, { props: { thread } });
    expect(screen.getByText('Alex')).toBeTruthy();
    expect(screen.getByText('are you coming?')).toBeTruthy();
    await user.type(box(), 'yes{Enter}');
    await vi.waitFor(() => expect(bridge.calls.find((c) => c.channel === 'msg:sendText')?.args).toEqual(['t1', 'yes', 'orig']));
    expect(ui.replyTo).toBeNull();
  });

  it('cancels a reply with the ✕ button', async () => {
    const user = userEvent.setup();
    ui.replyTo = makeText({ id: 'orig', threadId: 't1', senderId: 'ua' });
    render(Composer, { props: { thread } });
    await user.click(screen.getByRole('button', { name: 'Cancel reply' }));
    expect(ui.replyTo).toBeNull();
  });
});
