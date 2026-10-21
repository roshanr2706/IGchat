import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeText, makeThread, makeUser } from '../../../shared/test/factories';
import { setBridge } from '../lib/api';
import { loadEmoji } from '../lib/emoji';
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
    await vi.waitFor(() => expect(bridge.calls.find((c) => c.channel === 'msg:sendText')?.args).toEqual(['t1', 'hello', null, expect.stringMatching(/^temp-/)]));
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
    await vi.waitFor(() => expect(bridge.calls.find((c) => c.channel === 'msg:sendText')?.args).toEqual(['t1', 'yes', 'orig', expect.stringMatching(/^temp-/)]));
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

describe('Composer emoji', () => {
  beforeEach(async () => {
    await loadEmoji();
  });

  it('suggests emoji for :wilt and inserts the closest one on Enter, without sending', async () => {
    const user = userEvent.setup();
    render(Composer, { props: { thread } });
    await user.type(box(), 'so sad :wilt');
    const list = await screen.findByRole('listbox', { name: 'Emoji suggestions' });
    expect(within(list).getAllByRole('option')[0]?.textContent).toContain('🥀');
    await user.keyboard('{Enter}');
    expect(box().value).toBe('so sad 🥀 ');
    expect(bridge.calls.some((c) => c.channel === 'msg:sendText')).toBe(false);
    expect(screen.queryByRole('listbox', { name: 'Emoji suggestions' })).toBeNull();
  });

  it('moves through suggestions with the arrow keys, and Escape closes them', async () => {
    const user = userEvent.setup();
    render(Composer, { props: { thread } });
    await user.type(box(), ':gri');
    const options = within(await screen.findByRole('listbox', { name: 'Emoji suggestions' })).getAllByRole('option');
    expect(options[0]?.textContent).toContain('😁');
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowDown}');
    expect(within(screen.getByRole('listbox', { name: 'Emoji suggestions' })).getAllByRole('option')[1]?.getAttribute('aria-selected')).toBe('true');
    const second = options[1]!.textContent!.trim().slice(0, 2);
    await user.keyboard('{Tab}');
    expect(box().value.startsWith(second)).toBe(true);
    await user.type(box(), ' :gri');
    await screen.findByRole('listbox', { name: 'Emoji suggestions' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Emoji suggestions' })).toBeNull();
  });

  it('turns a completed :code: into its emoji', async () => {
    const user = userEvent.setup();
    render(Composer, { props: { thread } });
    await user.type(box(), 'hi :wilted_flower:');
    expect(box().value).toBe('hi 🥀');
  });

  it('reacts to the latest message with "+:code:" or "+emoji" instead of sending it', async () => {
    messages.byThread.t1!.messages = [makeText({ id: 'm1', threadId: 't1', senderId: 'ua', text: 'yo', timestamp: 1 }), makeText({ id: 'm2', threadId: 't1', senderId: 'ua', text: 'there', timestamp: 2 })];
    const user = userEvent.setup();
    render(Composer, { props: { thread } });
    await user.type(box(), '+:wilted_flower:');
    // The closing colon already turned it into the emoji; Enter reacts.
    expect(box().value).toBe('+🥀');
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(bridge.calls.find((c) => c.channel === 'msg:react')?.args).toEqual(['t1', 'm2', '🥀']));
    expect(bridge.calls.some((c) => c.channel === 'msg:sendText')).toBe(false);
    expect(box().value).toBe('');
  });

  it('inserts emoji from the picker at the caret', async () => {
    const user = userEvent.setup();
    render(Composer, { props: { thread } });
    await user.type(box(), 'ab');
    box().setSelectionRange(1, 1);
    await user.click(screen.getByRole('button', { name: 'Emoji' }));
    const picker = await screen.findByRole('dialog', { name: 'Pick an emoji' });
    await user.type(within(picker).getByRole('textbox', { name: 'Search emoji' }), 'wilted');
    await user.click(await within(picker).findByRole('button', { name: 'Insert 🥀' }));
    expect(box().value).toBe('a🥀b');
    expect(screen.queryByRole('dialog', { name: 'Pick an emoji' })).toBeNull();
  });
});
