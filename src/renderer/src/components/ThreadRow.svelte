<script lang="ts">
  import type { Thread } from '../../../shared/types';
  import { formatRelativeShort } from '../lib/time';
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
  onclick={() => onselect(thread.id)}
>
  <span class="av">
    <Avatar urls={thread.avatarUrls} name={thread.title} size={rail ? 44 : 32} />
    {#if thread.unread}<span class="dot" aria-label="Unread"></span>{/if}
  </span>
  {#if !rail}
    <span class="text">
      <span class="title">
        {thread.title}
        {#if thread.muted}<span class="muted" title="Muted">🔕</span>{/if}
      </span>
      <span class="preview">{thread.lastMessagePreview}</span>
    </span>
    <span class="time">{formatRelativeShort(thread.lastActivityAt, Date.now())}</span>
  {/if}
</button>

<style>
  .row {
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
    contain-intrinsic-size: auto 46px;
  }
  .row:hover {
    background: var(--bg-hover);
    color: var(--text-normal);
  }
  .row.active {
    background: var(--bg-active);
    color: var(--text-header);
  }
  .row.unread .title {
    color: var(--text-header);
    font-weight: 600;
  }
  .row.rail {
    justify-content: center;
    padding: 4px 0;
    border-radius: 0;
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
    right: -2px;
    bottom: -2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--bg-sidebar);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .title,
  .preview {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .title {
    font-size: 0.95rem;
  }
  .preview {
    font-size: 0.8rem;
    opacity: 0.85;
  }
  .muted {
    font-size: 0.7rem;
  }
  .time {
    flex: none;
    align-self: flex-start;
    margin-top: 2px;
    font-size: 0.7rem;
  }
</style>
