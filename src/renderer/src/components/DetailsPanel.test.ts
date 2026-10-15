import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import { makeImage, makeThread, makeUser } from '../../../shared/test/factories';
import type { Thread } from '../../../shared/types';
import { setBridge } from '../lib/api';
import { createFakeBridge, type FakeBridge } from '../lib/fakeBridge';
import { inbox } from '../stores/inbox.svelte';
import { messages } from '../stores/messages.svelte';
import { settings } from '../stores/settings.svelte';
import { ui } from '../stores/ui.svelte';
import DetailsPanel from './DetailsPanel.svelte';

const alex = makeUser({ id: 'ua', username: 'alex_r', fullName: 'Alex Rivera' });
const sam = makeUser({ id: 'us', username: 'sam.kim', fullName: 'Sam Kim' });
let bridge: FakeBridge;

function setup(details: Thread): void {
  bridge = createFakeBridge({ 'thread:details': () => details, 'shell:openExternal': () => undefined });
  setBridge(bridge);
}

beforeEach(() => {
  settings.init(DEFAULT_SETTINGS);
  inbox.me = makeUser({ id: 'me', username: 'me', fullName: 'Me' });
  messages.byThread = {};
  ui.lightbox = null;
});

describe('DetailsPanel', () => {
  it('shows a DM profile with bio from thread details', async () => {
    const thread = makeThread({ id: 't1', title: 'Alex Rivera', participants: [alex] });
    setup({ ...thread, participants: [{ ...alex, bio: 'coffee, cameras' }] });
    render(DetailsPanel, { props: { thread } });
    expect(await screen.findByText('coffee, cameras')).toBeTruthy();
    expect(screen.getByText('@alex_r')).toBeTruthy();
  });

  it('opens the Instagram profile externally', async () => {
    const user = userEvent.setup();
    const thread = makeThread({ id: 't1', title: 'Alex Rivera', participants: [alex] });
    setup(thread);
    render(DetailsPanel, { props: { thread } });
    await user.click(screen.getByRole('button', { name: 'Open profile on Instagram' }));
    await vi.waitFor(() => expect(bridge.calls.find((c) => c.channel === 'shell:openExternal')?.args).toEqual(['https://www.instagram.com/alex_r/']));
  });

  it('lists group members including you, with admin badges', () => {
    const thread = makeThread({ id: 'tg', title: 'weekend plans', isGroup: true, participants: [alex, sam], adminIds: ['me'] });
    setup(thread);
    render(DetailsPanel, { props: { thread } });
    expect(screen.getByText('Members — 3')).toBeTruthy();
    expect(screen.getByText('Sam Kim')).toBeTruthy();
    expect(screen.getAllByText('Admin')).toHaveLength(1);
    expect(screen.getByText(/\(you\)/)).toBeTruthy();
  });

  it('shows shared media that opens in the lightbox', async () => {
    const user = userEvent.setup();
    const thread = makeThread({ id: 't1', participants: [alex] });
    setup(thread);
    messages.byThread = { t1: { messages: [makeImage({ id: 'img1', threadId: 't1' })], hasOlder: false, loadingOlder: false, loaded: true, firstUnreadId: null } };
    render(DetailsPanel, { props: { thread } });
    await user.click(screen.getByRole('button', { name: 'Open media' }));
    expect(ui.lightbox).toEqual({ threadId: 't1', messageId: 'img1' });
  });

  it('says when there is no media', () => {
    const thread = makeThread({ id: 't1', participants: [alex] });
    setup(thread);
    render(DetailsPanel, { props: { thread } });
    expect(screen.getByText('No photos or videos loaded yet.')).toBeTruthy();
  });
});
