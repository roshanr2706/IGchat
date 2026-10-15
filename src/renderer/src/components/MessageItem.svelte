<script lang="ts">
  import type { Message, Thread, User } from '../../../shared/types';
  import { scrollToMessage } from '../lib/dom';
  import { formatHeaderTimestamp, formatTime } from '../lib/time';
  import { messages } from '../stores/messages.svelte';
  import { ui } from '../stores/ui.svelte';
  import Avatar from './Avatar.svelte';
  import EditBox from './EditBox.svelte';
  import MessageActions from './MessageActions.svelte';
  import MessageContent from './MessageContent.svelte';
  import Reactions from './Reactions.svelte';

  type Props = { message: Message; showHeader: boolean; thread: Thread; users: Map<string, User>; myId: string };
  let { message, showHeader, thread, users, myId }: Props = $props();

  // The toolbar only mounts while hovered (or while its emoji picker is open) to keep long lists cheap.
  let hovered = $state(false);
  let pinned = $state(false);

  const sender = $derived(users.get(message.senderId));
  const senderName = $derived(sender?.fullName || sender?.username || 'Unknown');
  const isoTime = $derived(new Date(message.timestamp).toISOString());
  const editing = $derived(ui.editingId === message.id && message.kind === 'text');
  const interactive = $derived(message.status === 'sent');

  function nameOf(id: string): string {
    const u = users.get(id);
    return u?.fullName || u?.username || 'Unknown';
  }

  function toggleReaction(emoji: string, mine: boolean): void {
    if (mine) void messages.unreact(thread.id, message.id);
    else void messages.react(thread.id, message.id, emoji);
  }

  function saveEdit(text: string): void {
    ui.editingId = null;
    if (message.kind !== 'text') return;
    const trimmed = text.trim();
    if (!trimmed) {
      ui.confirmUnsend = { threadId: thread.id, messageId: message.id };
      return;
    }
    if (trimmed !== message.text) void messages.edit(thread.id, message.id, trimmed);
  }

  function onContextMenu(e: MouseEvent): void {
    if (!interactive) return;
    e.preventDefault();
    ui.contextMenu = { threadId: thread.id, messageId: message.id, x: e.clientX, y: e.clientY };
  }
</script>

{#if message.kind === 'actionLog'}
  <div class="action-log">{message.text}</div>
{:else}
  <article
    class="message"
    class:with-header={showHeader}
    class:pending={message.status === 'pending'}
    class:failed={message.status === 'failed'}
    class:editing
    class:replying={ui.replyTo?.id === message.id}
    data-message-id={message.id}
    onmouseenter={() => (hovered = true)}
    onmouseleave={() => (hovered = false)}
    oncontextmenu={onContextMenu}
  >
    {#if message.replyTo}
      <button class="reply-ref" onclick={() => scrollToMessage(message.replyTo!.messageId)}>
        <span class="reply-name">{nameOf(message.replyTo.senderId)}</span>
        <span class="reply-preview">{message.replyTo.preview}</span>
      </button>
    {/if}
    {#if showHeader}
      <div class="avatar"><Avatar urls={sender?.avatarUrl ? [sender.avatarUrl] : []} name={senderName} size={40} /></div>
      <div class="header">
        <span class="name">{senderName}</span>
        <time datetime={isoTime}>{formatHeaderTimestamp(message.timestamp, Date.now())}</time>
      </div>
    {:else}
      <time class="hover-time" datetime={isoTime}>{formatTime(message.timestamp)}</time>
    {/if}
    <div class="body">
      {#if editing && message.kind === 'text'}
        <EditBox initial={message.text} onsave={saveEdit} oncancel={() => (ui.editingId = null)} />
      {:else}
        <MessageContent {message} threadId={thread.id} />
        {#if message.editedAt}
          <span class="edited" title="Edited {formatHeaderTimestamp(message.editedAt, Date.now())}">(edited)</span>
        {/if}
      {/if}
    </div>
    {#if message.reactions.length}
      <Reactions reactions={message.reactions} {myId} {users} ontoggle={toggleReaction} />
    {/if}
    {#if message.status === 'failed'}
      <div class="failed-actions">
        Message failed to send.
        <button onclick={() => void messages.retry(thread.id, message.id)}>Retry</button>
        ·
        <button onclick={() => messages.discard(thread.id, message.id)}>Delete</button>
      </div>
    {/if}
    {#if interactive && !editing && (hovered || pinned)}
      <div class="actions-anchor">
        <MessageActions {message} threadId={thread.id} {myId} variant="toolbar" onpin={(open) => (pinned = open)} />
      </div>
    {/if}
  </article>
{/if}

<style>
  .message {
    position: relative;
    min-height: 1.5rem;
    padding: 2px 48px 2px 72px;
    content-visibility: auto;
    contain-intrinsic-size: auto 24px;
  }
  .message.with-header {
    margin-top: 1rem;
    contain-intrinsic-size: auto 48px;
  }
  .message:hover,
  .message.editing {
    background: color-mix(in srgb, var(--bg-hover) 45%, transparent);
  }
  .message.replying {
    background: var(--mention-bg);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .message.pending {
    opacity: 0.55;
  }
  .message.failed .body {
    color: var(--danger);
  }
  .message:global(.flash) {
    animation: flash 1.2s ease-out;
  }
  @keyframes flash {
    from {
      background: var(--mention-bg);
    }
    to {
      background: transparent;
    }
  }
  .avatar {
    position: absolute;
    top: 4px;
    left: 16px;
  }
  .message:has(.reply-ref) .avatar {
    top: calc(1.3rem + 4px);
  }
  .header {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .name {
    font-weight: 600;
    color: var(--text-header);
  }
  .header time {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .hover-time {
    position: absolute;
    left: 0;
    width: 62px;
    visibility: hidden;
    text-align: right;
    font-size: 0.68rem;
    line-height: 1.6rem;
    color: var(--text-muted);
  }
  .message:hover .hover-time {
    visibility: visible;
  }
  .body {
    line-height: 1.4;
    color: var(--text-normal);
    overflow-wrap: anywhere;
  }
  .edited {
    margin-left: 4px;
    font-size: 0.7rem;
    color: var(--text-muted);
  }
  .reply-ref {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    margin-bottom: 2px;
    font-size: 0.82rem;
    color: var(--text-muted);
  }
  .reply-ref::before {
    content: '';
    position: absolute;
    top: 50%;
    left: -38px;
    width: 32px;
    height: 10px;
    border-top: 2px solid var(--text-muted);
    border-left: 2px solid var(--text-muted);
    border-top-left-radius: 6px;
    opacity: 0.5;
  }
  .reply-name {
    flex: none;
    font-weight: 600;
    color: var(--text-header);
  }
  .reply-preview {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .action-log {
    padding: 4px 72px;
    font-size: 0.8rem;
    font-style: italic;
    color: var(--text-muted);
  }
  .failed-actions {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .failed-actions button {
    color: var(--text-link);
  }
  .actions-anchor {
    position: absolute;
    top: -16px;
    right: 16px;
    z-index: 2;
  }
  :global(.app.compact) .message {
    padding-left: 16px;
  }
  :global(.app.compact) .message.with-header {
    margin-top: 0.35rem;
  }
  :global(.app.compact) .avatar,
  :global(.app.compact) .hover-time,
  :global(.app.compact) .reply-ref::before {
    display: none;
  }
</style>
