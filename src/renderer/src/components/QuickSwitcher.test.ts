import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeThread, makeUser } from '../../../shared/test/factories';
import { setBridge } from '../lib/api';
import { createFakeBridge } from '../lib/fakeBridge';
import { inbox } from '../stores/inbox.svelte';
import { messages } from '../stores/messages.svelte';
import { ui } from '../stores/ui.svelte';
import QuickSwitcher from './QuickSwitcher.svelte';

const alex = makeUser({ username: 'alex_r', fullName: 'Alex Rivera' });
const sam = makeUser({ username: 'sam.kim', fullName: 'Sam Kim' });
const dmAlex = makeThread({ id: 'ta', title: 'Alex Rivera', participants: [alex], lastActivityAt: 30 });
const dmSam = makeThread({ id: 'ts', title: 'Sam Kim', participants: [sam], lastActivityAt: 20 });
const group = makeThread({ id: 'tg', title: 'weekend plans', participants: [alex, sam], lastActivityAt: 10 });

beforeEach(() => {
  setBridge(createFakeBridge({ 'thread:open': () => ({ messages: [], hasOlder: false }), 'thread:markSeen': () => undefined }));
  inbox.threads = [dmAlex, dmSam, group];
  inbox.activeId = null;
  messages.byThread = {};
  ui.switcherOpen = true;
});

describe('QuickSwitcher', () => {
  it('focuses the search box and lists recent conversations', () => {
    render(QuickSwitcher);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search conversations' }));
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByText('Recent conversations')).toBeTruthy();
  });

  it('fuzzy-filters and opens the top match with Enter', async () => {
    const user = userEvent.setup();
    render(QuickSwitcher);
    await user.keyboard('sam.k');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.keyboard('{Enter}');
    expect(inbox.activeId).toBe('ts');
    expect(ui.switcherOpen).toBe(false);
  });

  it('moves the selection with the arrow keys', async () => {
    const user = userEvent.setup();
    render(QuickSwitcher);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}');
    expect(inbox.activeId).toBe('ts');
  });

  it('opens a conversation on click', async () => {
    const user = userEvent.setup();
    render(QuickSwitcher);
    await user.click(screen.getByText('weekend plans'));
    expect(inbox.activeId).toBe('tg');
  });

  it('explains when nothing matches', async () => {
    const user = userEvent.setup();
    render(QuickSwitcher);
    await user.keyboard('zzzz');
    expect(screen.getByText(/No conversations match/)).toBeTruthy();
  });
});
