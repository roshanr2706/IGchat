<script lang="ts">
  import type { Thread } from '../../../shared/types';
  import { formatRelativeShort } from '../lib/time';
  import { ui } from '../stores/ui.svelte';
  import Avatar from './Avatar.svelte';

  type Props = { thread: Thread; active: boolean; rail: boolean; onselect: (id: string) => void };
  let { thread, active, rail, onselect }: Props = $props();
</script>

<button
  class="row"
  class:active
  class:unread={thread.unread}
  class:rail
  title={rail ? thread.title : undefined}
  aria-current={active ? 'page' : undefined}
  aria-label={thread.unread ? `${thread.title} (unread)` : undefined}
  onclick={() => onselect(thread.id)}
>
  {#if thread.unread}<span class="pill" aria-hidden="true"></span>{/if}
  <span class="av">
    <Avatar urls={thread.avatarUrls} name={thread.title} size={rail ? 44 : 32} />
    {#if thread.unread && rail}<span class="dot" aria-hidden="true"></span>{/if}
  </span>
  {#if !rail}
    <span class="title">
      {thread.title}
      {#if thread.muted}<span class="muted" title="Muted">🔕</span>{/if}
    </span>
    <span class="time">{formatRelativeShort(thread.lastActivityAt, Math.max(ui.now, thread.lastActivityAt))}</span>
    {#if thread.unread}<span class="badge" aria-hidden="true"></span>{/if}
  {/if}
</button>

<style>
  .row {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 1px 0;
    padding: 6px 8px;
    border-radius: 6px;
    color: var(--text-muted);
    text-align: left;
    content-visibility: auto;
    contain-intrinsic-size: auto 44px;
  }
  .row:hover {
    background: var(--bg-hover);
    color: var(--text-normal);
  }
  .row.active {
    background: var(--bg-active);
    color: var(--text-header);
  }
  .row.unread {
    color: var(--text-header);
  }
  .row.unread .title {
    font-weight: 700;
  }
  .row.unread .time {
    font-weight: 700;
    color: var(--accent);
  }
  /* Discord-style marker on the row's left edge (inside it: content-visibility clips anything outside). */
  .pill {
    position: absolute;
    left: 0;
    top: 50%;
    width: 4px;
    height: 10px;
    border-radius: 0 4px 4px 0;
    background: var(--text-header);
    transform: translateY(-50%);
  }
  .row.unread:hover .pill {
    height: 20px;
  }
  .row.rail {
    justify-content: center;
    padding: 4px 0;
    border-radius: 0;
  }
  .row.rail .pill {
    height: 12px;
  }
  .row.rail:hover,
  .row.rail.active {
    background: none;
  }
  .row.rail.active .av {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 50%;
  }
  .av {
    position: relative;
    flex: none;
    display: flex;
  }
  .dot {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    border: 3px solid var(--bg-sidebar);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.95rem;
  }
  .muted {
    font-size: 0.7rem;
  }
  .time {
    flex: none;
    font-size: 0.7rem;
  }
  .badge {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
  }
</style>
