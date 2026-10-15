<script lang="ts">
  import { untrack } from 'svelte';
  import type { Thread, User } from '../../../shared/types';
  import { buildRows } from '../lib/grouping';
  import { formatDayLabel } from '../lib/time';
  import { inbox } from '../stores/inbox.svelte';
  import { messages } from '../stores/messages.svelte';
  import MessageItem from './MessageItem.svelte';

  type Props = { thread: Thread };
  let { thread }: Props = $props();

  const st = $derived(messages.get(thread.id));
  const myId = $derived(inbox.me?.id ?? 'me');
  const users = $derived(new Map<string, User>([...thread.participants, ...(inbox.me ? [inbox.me] : [])].map((u) => [u.id, u])));
  const rows = $derived(
    st ? buildRows(st.messages, { firstUnreadId: st.firstUnreadId, dayLabel: (ts) => formatDayLabel(ts, Date.now()) }) : []
  );
  // The scroller is column-reverse (pins to the bottom for free), so the newest row comes first in the DOM.
  const reversed = $derived([...rows].reverse());

  let scroller: HTMLDivElement | undefined = $state();
  let atBottom = $state(true);

  function maybeLoadOlder(): void {
    if (!scroller || !st?.loaded || !st.hasOlder || st.loadingOlder) return;
    // In a column-reverse scroller scrollTop is 0 at the bottom and negative when scrolled up.
    const fromTop = scroller.scrollHeight - scroller.clientHeight + scroller.scrollTop;
    if (fromTop < 600) void messages.loadOlder(thread.id);
  }

  function onScroll(): void {
    if (!scroller) return;
    atBottom = scroller.scrollTop > -40;
    maybeLoadOlder();
  }

  // If the loaded history doesn't fill the view yet, keep loading older pages.
  $effect(() => {
    void rows.length;
    void scroller;
    untrack(() => maybeLoadOlder());
  });

  function jumpToPresent(): void {
    scroller?.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

<div class="wrap">
  <div class="scroller" bind:this={scroller} onscroll={onScroll} role="log" aria-label="Messages">
    <div class="spacer"></div>
    {#each reversed as row (row.key)}
      {#if row.type === 'day'}
        <div class="day"><span>{row.label}</span></div>
      {:else if row.type === 'unread'}
        <div class="unread-marker"><span>NEW</span></div>
      {:else}
        <MessageItem message={row.message} showHeader={row.showHeader} {thread} {users} {myId} />
      {/if}
    {/each}
    {#if st?.loadingOlder}<div class="status">Loading older messages…</div>{/if}
    {#if st?.loaded && !st.hasOlder}
      <div class="beginning">
        <h2>{thread.title}</h2>
        <p>This is the beginning of your conversation{thread.isGroup ? ' in this group' : ` with ${thread.title}`}.</p>
      </div>
    {/if}
    {#if !st?.loaded}<div class="status">Loading messages…</div>{/if}
  </div>
  {#if !atBottom}
    <button class="jump" onclick={jumpToPresent}>Jump to present ↓</button>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .scroller {
    flex: 1;
    display: flex;
    flex-direction: column-reverse;
    overflow-y: auto;
  }
  .scroller > :global(*) {
    flex-shrink: 0;
  }
  .spacer {
    flex: none;
    height: 16px;
  }
  .day {
    display: flex;
    align-items: center;
    margin: 16px 16px 4px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .day::before,
  .day::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--bg-active);
  }
  .day span {
    padding: 0 8px;
  }
  .unread-marker {
    display: flex;
    align-items: center;
    margin: 8px 16px 0;
  }
  .unread-marker::before {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--danger);
  }
  .unread-marker span {
    padding: 0 6px;
    border-radius: 4px;
    background: var(--danger);
    color: var(--bg-base);
    font-size: 0.65rem;
    font-weight: 700;
  }
  .status {
    padding: 16px;
    text-align: center;
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .beginning {
    padding: 16px 16px 8px;
  }
  .beginning h2 {
    margin: 0 0 4px;
    font-size: 1.6rem;
    color: var(--text-header);
  }
  .beginning p {
    margin: 0;
    color: var(--text-muted);
  }
  .jump {
    position: absolute;
    right: 24px;
    bottom: 12px;
    padding: 6px 12px;
    border-radius: 16px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 0.8rem;
    font-weight: 600;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
  }
</style>
