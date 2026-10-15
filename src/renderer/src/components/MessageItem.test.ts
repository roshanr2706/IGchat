import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeText, makeThread, makeUser } from '../../../shared/test/factories';
import type { Message, User } from '../../../shared/types';
import { setBridge } from '../lib/api';
import { createFakeBridge, type FakeBridge } from '../lib/fakeBridge';
import { inbox } from '../stores/inbox.svelte';
import { messages } from '../stores/messages.svelte';
import { ui } from '../stores/ui.svelte';
import MessageItem from './MessageItem.svelte';

const me = makeUser({ id: 'me', fullName: 'Me' });
const alex = makeUser({ id: 'ua', fullName: 'Alex' });
const thread = makeThread({ id: 't1', participants: [alex] });
const users = new Map<string, User>([me, alex].map((u) => [u.id, u]));
let bridge: FakeBridge;

function renderMessage(m: Message) {
  messages.byThread = { t1: { messages: [m], hasOlder: false, loadingOlder: false, loaded: true, firstUnreadId: null } };
  const message = messages.get('t1')!.messages[0]!;
  return render(MessageItem, { props: { message, showHeader: true, thread, users, myId: 'me' } });
}

beforeEach(() => {
  bridge = createFakeBridge({
    'msg:edit': (_t, id, text) => ({ ...(messages.find('t1', id) as Message), text, editedAt: Date.now() }) as Message,
    'msg:react': (_t, id, emoji) => ({ ...messages.find('t1', id)!, reactions: [{ emoji, userIds: ['me'] }] }),
    'msg:unsend': () => undefined
  });
  setBridge(bridge);
  inbox.me = me;
  ui.editingId = null;
  ui.replyTo = null;
  ui.confirmUnsend = null;
  ui.contextMenu = null;
});

describe('MessageItem interactions', () => {
  it('shows the hover toolbar with edit and unsend for your recent text', async () => {
    const user = userEvent.setup();
    renderMessage(makeText({ id: 'm1', threadId: 't1', senderId: 'me', timestamp: Date.now() - 1000, text: 'helo' }));
    expect(screen.queryByRole('toolbar')).toBeNull();
    await user.hover(screen.getByText('helo'));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unsend' })).toBeTruthy();
  });

  it("hides edit and unsend on other people's messages", async () => {
    const user = userEvent.setup();
    renderMessage(makeText({ id: 'm1', threadId: 't1', senderId: 'ua', timestamp: Date.now(), text: 'hi' }));
    await user.hover(screen.getByText('hi'));
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unsend' })).toBeNull();
  });

  it('edits inline and saves with Enter', async () => {
    const user = userEvent.setup();
    renderMessage(makeText({ id: 'm1', threadId: 't1', senderId: 'me', timestamp: Date.now() - 1000, text: 'helo' }));
    await user.hover(screen.getByText('helo'));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const box = screen.getByRole('textbox', { name: 'Edit message' });
    await user.clear(box);
    await user.type(box, 'hello{Enter}');
    await vi.waitFor(() => expect(bridge.calls.find((c) => c.channel === 'msg:edit')?.args).toEqual(['t1', 'm1', 'hello']));
    expect(ui.editingId).toBeNull();
  });

  it('cancels an edit with Escape', async () => {
    const user = userEvent.setup();
    renderMessage(makeText({ id: 'm1', threadId: 't1', senderId: 'me', timestamp: Date.now() - 1000, text: 'helo' }));
    ui.editingId = 'm1';
    await vi.waitFor(() => screen.getByRole('textbox', { name: 'Edit message' }));
    await user.keyboard('{Escape}');
    expect(ui.editingId).toBeNull();
    expect(bridge.calls.some((c) => c.channel === 'msg:edit')).toBe(false);
  });

  it('asks to unsend when an edit is saved empty', async () => {
    const user = userEvent.setup();
    renderMessage(makeText({ id: 'm1', threadId: 't1', senderId: 'me', timestamp: Date.now() - 1000, text: 'helo' }));
    ui.editingId = 'm1';
    const box = await vi.waitFor(() => screen.getByRole('textbox', { name: 'Edit message' }));
    await user.clear(box);
    await user.type(box, '{Enter}');
    expect(ui.confirmUnsend).toEqual({ threadId: 't1', messageId: 'm1' });
  });

  it('opens the confirm dialog on Unsend and skips it with Shift', async () => {
    const user = userEvent.setup();
    renderMessage(makeText({ id: 'm1', threadId: 't1', senderId: 'me', timestamp: Date.now() - 1000, text: 'oops' }));
    await user.hover(screen.getByText('oops'));
    await user.click(screen.getByRole('button', { name: 'Unsend' }));
    expect(ui.confirmUnsend).toEqual({ threadId: 't1', messageId: 'm1' });
    ui.confirmUnsend = null;
    await user.hover(screen.getByText('oops'));
    await fireEvent.click(screen.getByRole('button', { name: 'Unsend' }), { shiftKey: true });
    expect(ui.confirmUnsend).toBeNull();
    await vi.waitFor(() => expect(bridge.calls.some((c) => c.channel === 'msg:unsend')).toBe(true));
  });

  it('starts a reply and quick-reacts from the toolbar', async () => {
    const user = userEvent.setup();
    renderMessage(makeText({ id: 'm1', threadId: 't1', senderId: 'ua', timestamp: Date.now(), text: 'hey' }));
    await user.hover(screen.getByText('hey'));
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    expect(ui.replyTo?.id).toBe('m1');
    await user.hover(screen.getByText('hey'));
    await user.click(screen.getByRole('button', { name: 'React with ❤️' }));
    await vi.waitFor(() => expect(bridge.calls.find((c) => c.channel === 'msg:react')?.args).toEqual(['t1', 'm1', '❤️']));
  });

  it('opens the context menu on right-click', async () => {
    renderMessage(makeText({ id: 'm1', threadId: 't1', senderId: 'ua', timestamp: Date.now(), text: 'hey' }));
    await fireEvent.contextMenu(screen.getByText('hey'), { clientX: 10, clientY: 20 });
    expect(ui.contextMenu).toEqual({ threadId: 't1', messageId: 'm1', x: 10, y: 20 });
  });
});
