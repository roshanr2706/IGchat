<script lang="ts">
  import type { Thread } from '../../../shared/types';
  import { ui } from '../stores/ui.svelte';
  import MessageList from './MessageList.svelte';
  import Composer from './Composer.svelte';

  type Props = { thread: Thread };
  let { thread }: Props = $props();

  const subtitle = $derived(thread.isGroup ? `${thread.participants.length + 1} members` : `@${thread.participants[0]?.username ?? ''}`);
</script>

<section class="chat" aria-label="Conversation with {thread.title}">
  <header class="chat-header">
    <span class="glyph" aria-hidden="true">{thread.isGroup ? '#' : '@'}</span>
    <h1>{thread.title}</h1>
    <span class="sub">{subtitle}</span>
    <button
      class="info"
      class:on={ui.detailsVisible}
      title="Toggle details (Ctrl+I)"
      aria-label="Toggle details"
      aria-pressed={ui.detailsVisible}
      onclick={() => ui.toggleDetails()}>ⓘ</button
    >
  </header>
  <MessageList {thread} />
  <Composer {thread} />
</section>

<style>
  .chat {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .chat-header {
    flex: none;
    height: 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
  }
  .glyph {
    font-size: 1.3rem;
    color: var(--text-muted);
  }
  h1 {
    margin: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 1rem;
    color: var(--text-header);
  }
  .sub {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .info {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    font-size: 1.2rem;
    color: var(--text-muted);
  }
  .info:hover {
    background: var(--bg-hover);
  }
  .info:hover,
  .info.on {
    color: var(--text-header);
  }
</style>
