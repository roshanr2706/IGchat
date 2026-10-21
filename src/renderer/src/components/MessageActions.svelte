<script lang="ts">
  import type { Message } from '../../../shared/types';
  import { canEdit, canUnsend } from '../lib/editWindow';
  import { messages } from '../stores/messages.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import EmojiPicker from './EmojiPicker.svelte';

  type Props = {
    message: Message;
    threadId: string;
    myId: string;
    variant: 'toolbar' | 'menu';
    ondone?: () => void;
    onpin?: (open: boolean) => void;
  };
  let { message, threadId, myId, variant, ondone, onpin }: Props = $props();

  // Your quick reactions (Settings > Appearance); the hover bar shows the first three.
  const QUICK = $derived(settings.value.quickReactions);
  let pickerOpen = $state(false);

  const editable = $derived(canEdit(message, myId, Date.now()));
  const unsendable = $derived(canUnsend(message, myId));
  const copyText = $derived(message.kind === 'text' || message.kind === 'link' ? message.text : null);

  function setPicker(open: boolean): void {
    pickerOpen = open;
    onpin?.(open);
  }

  function react(emoji: string): void {
    const mine = message.reactions.some((r) => r.emoji === emoji && r.userIds.includes(myId));
    if (mine) void messages.unreact(threadId, message.id);
    else void messages.react(threadId, message.id, emoji);
    setPicker(false);
    ondone?.();
  }

  function reply(): void {
    ui.replyTo = message;
    ondone?.();
  }

  function copy(): void {
    if (copyText !== null) void navigator.clipboard.writeText(copyText);
    ondone?.();
  }

  function edit(): void {
    ui.editingId = message.id;
    ondone?.();
  }

  function unsend(e: MouseEvent): void {
    if (e.shiftKey) void messages.unsend(threadId, message.id);
    else ui.confirmUnsend = { threadId, messageId: message.id };
    ondone?.();
  }
</script>

{#if variant === 'toolbar'}
  <div class="toolbar" role="toolbar" aria-label="Message actions">
    {#each QUICK.slice(0, 3) as emoji (emoji)}
      <button aria-label="React with {emoji}" title="React with {emoji}" onclick={() => react(emoji)}>{emoji}</button>
    {/each}
    <button data-picker-toggle aria-label="Add reaction" title="Add reaction" onclick={() => setPicker(!pickerOpen)}>😊</button>
    <button aria-label="Reply" title="Reply" onclick={reply}>↩</button>
    {#if copyText !== null}
      <button aria-label="Copy text" title="Copy text" onclick={copy}>⧉</button>
    {/if}
    {#if editable}
      <button aria-label="Edit" title="Edit" onclick={edit}>✎</button>
    {/if}
    {#if unsendable}
      <button class="danger" aria-label="Unsend" title="Unsend (Shift+click skips confirmation)" onclick={unsend}>🗑</button>
    {/if}
    {#if pickerOpen}
      <div class="picker-pop"><EmojiPicker onpick={react} onclose={() => setPicker(false)} /></div>
    {/if}
  </div>
{:else}
  <div class="menu" role="menu">
    <div class="quick">
      {#each QUICK as emoji (emoji)}
        <button role="menuitem" aria-label="React with {emoji}" onclick={() => react(emoji)}>{emoji}</button>
      {/each}
    </div>
    <button role="menuitem" onclick={reply}>Reply</button>
    {#if copyText !== null}
      <button role="menuitem" onclick={copy}>Copy text</button>
    {/if}
    {#if editable}
      <button role="menuitem" onclick={edit}>Edit message</button>
    {/if}
    {#if unsendable}
      <button role="menuitem" class="danger" onclick={unsend}>Unsend message</button>
    {/if}
  </div>
{/if}

<style>
  .toolbar {
    position: relative;
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-elevated);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
  }
  .toolbar button {
    width: 32px;
    height: 28px;
    border-radius: 4px;
    font-size: 1rem;
    color: var(--text-muted);
  }
  .toolbar button:hover {
    background: var(--bg-hover);
    color: var(--text-header);
  }
  .toolbar button.danger {
    color: var(--danger);
  }
  .picker-pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 10;
  }
  .menu {
    display: flex;
    flex-direction: column;
    min-width: 200px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-elevated);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
  }
  .quick {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
    padding: 2px 2px 6px;
    border-bottom: 1px solid var(--bg-active);
  }
  .quick button {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--bg-hover);
    font-size: 1.1rem;
  }
  .menu > button {
    padding: 8px 10px;
    border-radius: 4px;
    text-align: left;
    font-size: 0.9rem;
  }
  .menu > button:hover {
    background: var(--accent);
    color: var(--accent-text);
  }
  .menu > button.danger {
    color: var(--danger);
  }
  .menu > button.danger:hover {
    background: var(--danger);
    color: var(--bg-base);
  }
</style>
