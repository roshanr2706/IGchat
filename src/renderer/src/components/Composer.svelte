<script lang="ts">
  import { messagePreview } from '../../../shared/preview';
  import type { Thread } from '../../../shared/types';
  import { lastEditable } from '../lib/editWindow';
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

  function submit(): void {
    const body = text.trim();
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
  <div class="composer" class:joined={ui.replyTo !== null || image !== null}>
    <button class="plus" aria-label="Attach an image" title="Attach an image" onclick={() => fileInput?.click()}>+</button>
    <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={onPick} />
    <textarea
      bind:this={textarea}
      bind:value={text}
      rows="1"
      {placeholder}
      aria-label={placeholder}
      oninput={autosize}
      onkeydown={onKeydown}
      onpaste={onPaste}
    ></textarea>
    <button class="send" aria-label="Send" title="Send (Enter)" disabled={!canSend} onclick={submit}>➤</button>
  </div>
</div>

<style>
  .composer-wrap {
    flex: none;
    padding: 0 16px 20px;
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
  .send {
    flex: none;
    width: 32px;
    height: 44px;
    font-size: 1.2rem;
    color: var(--text-muted);
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
