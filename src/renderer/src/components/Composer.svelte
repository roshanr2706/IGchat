<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { messagePreview } from '../../../shared/preview';
  import type { Thread } from '../../../shared/types';
  import { lastEditable } from '../lib/editWindow';
  import { completedShortcodeAt, emojiIndex, findEmoji, loadEmoji, parseReactCommand, shortcodeAt, type EmojiEntry } from '../lib/emoji';
  import EmojiPicker from './EmojiPicker.svelte';
  import { inbox } from '../stores/inbox.svelte';
  import { messages } from '../stores/messages.svelte';
  import { ui } from '../stores/ui.svelte';

  type Props = { thread: Thread };
  let { thread }: Props = $props();

  type PendingImage = { bytes: Uint8Array; mime: string; previewUrl: string; name: string };

  let text = $state('');
  let image = $state<PendingImage | null>(null);
  let dragOver = $state(false);
  let textarea: HTMLTextAreaElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let pickerOpen = $state(false);
  /** The ":code" being typed and the emoji it could become (Discord-style autocomplete). */
  let suggest = $state<{ start: number; end: number; items: EmojiEntry[]; sel: number } | null>(null);

  // The emoji data loads lazily; fetch it as soon as a conversation is open so ":" completes instantly.
  onMount(() => void loadEmoji());

  const myId = $derived(inbox.me?.id ?? 'me');
  const placeholder = $derived(
    thread.isGroup ? `Message ${thread.title}` : `Message @${thread.participants[0]?.username ?? thread.title}`
  );
  const replyName = $derived.by(() => {
    const r = ui.replyTo;
    if (!r) return '';
    if (r.senderId === myId) return 'yourself';
    const u = thread.participants.find((p) => p.id === r.senderId);
    return u?.fullName || u?.username || 'Unknown';
  });
  const canSend = $derived(text.trim().length > 0 || image !== null);

  // Focus the box when the conversation opens and whenever a reply is started.
  $effect(() => {
    void ui.replyTo;
    textarea?.focus();
  });

  function autosize(): void {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
  }

  function clearImage(): void {
    if (image) URL.revokeObjectURL?.(image.previewUrl);
    image = null;
  }

  /** Replaces text[start, end) with the emoji (plus a space if asked and none follows) and puts the caret after it. */
  function insertAt(start: number, end: number, emoji: string, space = true): void {
    const after = text.slice(end);
    const insert = !space || after.startsWith(' ') || after.startsWith('\n') ? emoji : emoji + ' ';
    text = text.slice(0, start) + insert + after;
    suggest = null;
    const caret = start + insert.length;
    void tick().then(() => {
      textarea?.focus();
      textarea?.setSelectionRange(caret, caret);
      autosize();
    });
  }

  function refreshSuggest(): void {
    const index = emojiIndex();
    const caret = textarea?.selectionStart ?? text.length;
    if (!index || textarea?.selectionEnd !== caret) {
      suggest = null;
      return;
    }
    // A finished ":code:" turns into its emoji right away.
    const done = completedShortcodeAt(text, caret);
    const exact = done ? index.byCode.get(done.code) : undefined;
    if (done && exact) {
      text = text.slice(0, done.start) + exact + text.slice(caret);
      suggest = null;
      const at = done.start + exact.length;
      void tick().then(() => textarea?.setSelectionRange(at, at));
      return;
    }
    const token = shortcodeAt(text, caret);
    const items = token ? findEmoji(index, token.query, 8) : [];
    suggest = token && items.length ? { start: token.start, end: caret, items, sel: suggest && suggest.start === token.start ? Math.min(suggest.sel, items.length - 1) : 0 } : null;
  }

  function onInput(): void {
    autosize();
    refreshSuggest();
  }

  /** "+🥀" (or "+:wilted_flower:") alone reacts to the latest message instead of sending. */
  function reactToLatest(emoji: string): boolean {
    const latest = [...(messages.get(thread.id)?.messages ?? [])].reverse().find((m) => m.status === 'sent');
    if (!latest) {
      ui.toast('Nothing to react to yet');
      return true;
    }
    const mine = latest.reactions.some((r) => r.emoji === emoji && r.userIds.includes(myId));
    if (!mine) void messages.react(thread.id, latest.id, emoji);
    return true;
  }

  function submit(): void {
    const body = text.trim();
    const reaction = !image && body ? parseReactCommand(body, emojiIndex()) : null;
    if (reaction && reactToLatest(reaction)) {
      text = '';
      suggest = null;
      queueMicrotask(autosize);
      return;
    }
    if (image) {
      const { bytes, mime, previewUrl } = image;
      image = null;
      void messages.sendImage(thread.id, { bytes, mime, previewUrl });
    }
    if (body) {
      const reply = ui.replyTo;
      text = '';
      ui.replyTo = null;
      queueMicrotask(autosize);
      void messages.sendText(thread.id, body, reply);
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (suggest && !e.isComposing) {
      const s = suggest;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = s.items.length;
        suggest = { ...s, sel: (s.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n };
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        insertAt(s.start, s.end, s.items[s.sel]!.emoji);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        suggest = null;
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (canSend) submit();
    } else if (e.key === 'ArrowUp' && text === '' && !image) {
      const st = messages.get(thread.id);
      const target = st ? lastEditable(st.messages, myId, Date.now()) : null;
      if (target) {
        e.preventDefault();
        ui.editingId = target.id;
      }
    } else if (e.key === 'Escape' && image) {
      e.stopPropagation();
      clearImage();
    }
  }

  async function takeFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      ui.toast('Only images can be sent for now');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    clearImage();
    image = { bytes, mime: file.type, previewUrl: URL.createObjectURL(file), name: file.name || 'image' };
    textarea?.focus();
  }

  function onPaste(e: ClipboardEvent): void {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      void takeFile(file);
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files[0];
    if (file) void takeFile(file);
  }

  function onPick(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void takeFile(file);
    input.value = '';
  }
</script>

<div
  class="composer-wrap"
  class:drag-over={dragOver}
  role="region"
  aria-label="Message composer"
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={onDrop}
>
  {#if ui.replyTo}
    <div class="reply-banner">
      <span>Replying to <strong>{replyName}</strong></span>
      <span class="reply-preview">{messagePreview(ui.replyTo)}</span>
      <button aria-label="Cancel reply" title="Cancel reply (Esc)" onclick={() => (ui.replyTo = null)}>✕</button>
    </div>
  {/if}
  {#if image}
    <div class="attachment">
      <img src={image.previewUrl} alt={image.name} />
      <button aria-label="Remove image" title="Remove image (Esc)" onclick={clearImage}>✕</button>
    </div>
  {/if}
  {#if suggest}
    <ul id="emoji-suggest" class="suggest" role="listbox" aria-label="Emoji suggestions">
      {#each suggest.items as e, i (e.emoji)}
        <li
          role="option"
          aria-selected={i === suggest.sel}
          class:selected={i === suggest.sel}
          onmousedown={(ev) => {
            ev.preventDefault();
            if (suggest) insertAt(suggest.start, suggest.end, e.emoji);
          }}
          onmouseenter={() => suggest && (suggest = { ...suggest, sel: i })}
        >
          <span class="s-emoji">{e.emoji}</span><span class="s-code">:{e.codes[0]}:</span>
        </li>
      {/each}
    </ul>
  {/if}
  {#if pickerOpen}
    <div class="picker-pop">
      <EmojiPicker
        purpose="insert"
        onclose={() => (pickerOpen = false)}
        onpick={(emoji) => {
          pickerOpen = false;
          const start = textarea?.selectionStart ?? text.length;
          const end = textarea?.selectionEnd ?? start;
          insertAt(start, end, emoji, false);
        }}
      />
    </div>
  {/if}
  <div class="composer" class:joined={ui.replyTo !== null || image !== null}>
    <button class="plus" aria-label="Attach an image" title="Attach an image" onclick={() => fileInput?.click()}>+</button>
    <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={onPick} />
    <textarea
      bind:this={textarea}
      bind:value={text}
      rows="1"
      {placeholder}
      aria-label={placeholder}
      aria-autocomplete="list"
      aria-controls={suggest ? "emoji-suggest" : undefined}
      oninput={onInput}
      onkeydown={onKeydown}
      onkeyup={(e) => (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') && refreshSuggest()}
      onclick={refreshSuggest}
      onblur={() => (suggest = null)}
      onpaste={onPaste}
    ></textarea>
    <button
      class="emoji-btn"
      data-picker-toggle
      aria-label="Emoji"
      title="Emoji (type : to search)"
      aria-expanded={pickerOpen}
      onclick={() => (pickerOpen = !pickerOpen)}>😊</button
    >
    <button class="send" aria-label="Send" title="Send (Enter)" disabled={!canSend} onclick={submit}>➤</button>
  </div>
</div>

<style>
  .composer-wrap {
    position: relative;
    flex: none;
    padding: 0 16px 20px;
  }
  .suggest {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: calc(100% - 12px);
    z-index: 5;
    margin: 0;
    padding: 6px;
    list-style: none;
    border-radius: 8px;
    background: var(--bg-elevated);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
  }
  .suggest li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-normal);
  }
  .suggest li.selected {
    background: var(--bg-hover);
  }
  .s-emoji {
    font-size: 1.25rem;
  }
  .s-code {
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .picker-pop {
    position: absolute;
    right: 16px;
    bottom: calc(100% - 12px);
    z-index: 6;
  }
  .composer-wrap.drag-over .composer {
    outline: 2px dashed var(--accent);
  }
  .reply-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px 8px 0 0;
    background: var(--bg-sidebar);
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .reply-banner strong {
    color: var(--text-header);
  }
  .reply-preview {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .reply-banner button {
    color: var(--text-muted);
  }
  .attachment {
    position: relative;
    display: inline-block;
    padding: 10px;
    border-radius: 8px 8px 0 0;
    background: var(--bg-input);
  }
  .attachment img {
    display: block;
    max-width: 200px;
    max-height: 120px;
    border-radius: 4px;
  }
  .attachment button {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--bg-elevated);
    color: var(--text-muted);
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 0 8px;
    border-radius: 8px;
    background: var(--bg-input);
  }
  .composer.joined {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
  textarea {
    flex: 1;
    max-height: 300px;
    padding: 11px 4px;
    border: none;
    outline: none;
    background: transparent;
    resize: none;
    line-height: 1.375;
  }
  textarea::placeholder {
    color: var(--text-muted);
  }
  .plus,
  .send,
  .emoji-btn {
    flex: none;
    width: 32px;
    height: 44px;
    font-size: 1.2rem;
    color: var(--text-muted);
  }
  .emoji-btn {
    font-size: 1.1rem;
    filter: grayscale(1);
    opacity: 0.8;
  }
  .emoji-btn:hover,
  .emoji-btn[aria-expanded='true'] {
    filter: none;
    opacity: 1;
  }
  .plus:hover,
  .send:not(:disabled):hover {
    color: var(--text-header);
  }
  .send:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
