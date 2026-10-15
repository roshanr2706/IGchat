import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeText, makeThread, makeUser } from '../../../shared/test/factories';
import type { Message } from '../../../shared/types';
import { setBridge } from '../lib/api';
import { createFakeBridge, type FakeBridge } from '../lib/fakeBridge';
import { inbox } from '../stores/inbox.svelte';
import { messages } from '../stores/messages.svelte';
import MessageList from './MessageList.svelte';

const alex = makeUser({ id: 'ua', fullName: 'Alex Rivera', username: 'alex_r' });
const thread = makeThread({ id: 't1', title: 'Alex Rivera', participants: [alex] });
const now = Date.now();
let bridge: FakeBridge;

function load(list: Message[]): void {
  messages.byThread = { t1: { messages: list, hasOlder: false, loadingOlder: false, loaded: true, firstUnreadId: null } };
}

beforeEach(() => {
  bridge = createFakeBridge({ 'msg:react': (_t, id, emoji) => ({ ...messages.find('t1', id)!, reactions: [{ emoji, userIds: ['me'] }] }) });
  setBridge(bridge);
  inbox.me = makeUser({ id: 'me', fullName: 'Me Myself', username: 'me' });
});

describe('MessageList', () => {
  it('groups consecutive messages under one header', () => {
    load([
      makeText({ threadId: 't1', senderId: 'ua', timestamp: now - 180_000, text: 'one' }),
      makeText({ threadId: 't1', senderId: 'ua', timestamp: now - 170_000, text: 'two' }),
      makeText({ threadId: 't1', senderId: 'ua', timestamp: now - 160_000, text: 'three' }),
      makeText({ threadId: 't1', senderId: 'me', timestamp: now - 150_000, text: 'four' })
    ]);
    const { container } = render(MessageList, { props: { thread } });
    expect(container.querySelectorAll('.message')).toHaveLength(4);
    expect(container.querySelectorAll('.message.with-header')).toHaveLength(2);
    expect(screen.getByText('Alex Rivera', { selector: '.name' })).toBeTruthy();
    expect(screen.getByText('Me Myself')).toBeTruthy();
  });

  it('shows the day divider and the beginning of the conversation', () => {
    load([makeText({ threadId: 't1', senderId: 'ua', timestamp: now - 1000 })]);
    render(MessageList, { props: { thread } });
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText(/This is the beginning of your conversation/)).toBeTruthy();
  });

  it('renders edited labels, replies and unsupported messages', () => {
    const original = makeText({ id: 'orig', threadId: 't1', senderId: 'ua', timestamp: now - 5000, text: 'hey' });
    load([
      original,
      { ...makeText({ threadId: 't1', senderId: 'me', timestamp: now - 4000, text: 'yo' }), editedAt: now - 3000 } as Message,
      makeText({ threadId: 't1', senderId: 'me', timestamp: now - 2000, text: 'reply!', replyTo: { messageId: 'orig', senderId: 'ua', preview: 'hey' } }),
      { ...makeText({ threadId: 't1', senderId: 'ua', timestamp: now - 1000 }), kind: 'unsupported', rawType: 'voice_media' } as Message
    ]);
    render(MessageList, { props: { thread } });
    expect(screen.getByText('(edited)')).toBeTruthy();
    expect(screen.getByText('hey', { selector: '.reply-preview' })).toBeTruthy();
    expect(screen.getByText(/voice_media/)).toBeTruthy();
  });

  it('toggles a reaction when its pill is clicked', async () => {
    load([{ ...makeText({ id: 'r1', threadId: 't1', senderId: 'ua', timestamp: now }), reactions: [{ emoji: '😂', userIds: ['ua'] }] }]);
    render(MessageList, { props: { thread } });
    await fireEvent.click(screen.getByTitle('alex_r reacted with 😂'));
    expect(bridge.calls.find((c) => c.channel === 'msg:react')?.args).toEqual(['t1', 'r1', '😂']);
  });
});
