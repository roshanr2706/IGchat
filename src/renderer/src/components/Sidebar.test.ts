import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../../shared/settings';
import { makeThread, makeUser } from '../../../shared/test/factories';
import { setBridge } from '../lib/api';
import { createFakeBridge, type FakeBridge } from '../lib/fakeBridge';
import { inbox } from '../stores/inbox.svelte';
import { messages } from '../stores/messages.svelte';
import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';
import Sidebar from './Sidebar.svelte';

let bridge: FakeBridge;
const alex = makeThread({ id: 'ta', title: 'Alex Rivera', lastMessagePreview: 'You: lol', lastActivityAt: Date.now() - 60_000 });
const group = makeThread({ id: 'tg', title: 'weekend plans', unread: true, lastActivityAt: Date.now() - 120_000 });

beforeEach(() => {
  bridge = createFakeBridge({
    'thread:open': () => ({ messages: [], hasOlder: false }),
    'thread:markSeen': () => undefined,
    'settings:set': (patch) => sanitizeSettings({ ...DEFAULT_SETTINGS, ...patch })
  });
  setBridge(bridge);
  settings.init(DEFAULT_SETTINGS);
  ui.windowWidth = 1000;
  messages.byThread = {};
  inbox.threads = [alex, group];
  inbox.activeId = null;
  inbox.me = makeUser({ id: 'me', username: 'me_user' });
});

describe('Sidebar', () => {
  it('lists conversations with previews and unread state', () => {
    const { container } = render(Sidebar);
    expect(screen.getByText('Alex Rivera')).toBeTruthy();
    expect(screen.getByText('You: lol')).toBeTruthy();
    expect(container.querySelectorAll('.row.unread')).toHaveLength(1);
    expect(screen.getByText('me_user')).toBeTruthy();
  });

  it('opens a conversation on click', async () => {
    render(Sidebar);
    await fireEvent.click(screen.getByText('weekend plans'));
    expect(inbox.activeId).toBe('tg');
    expect(bridge.calls.some((c) => c.channel === 'thread:open' && c.args[0] === 'tg')).toBe(true);
  });

  it('collapses to an avatar rail on narrow windows', () => {
    ui.windowWidth = 600;
    render(Sidebar);
    expect(screen.queryByText('Alex Rivera')).toBeNull();
    expect(screen.getByTitle('Alex Rivera')).toBeTruthy();
  });
});
