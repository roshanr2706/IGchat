<script lang="ts">
  import { messagePreview } from '../../../shared/preview';
  import { messages } from '../stores/messages.svelte';
  import { ui } from '../stores/ui.svelte';

  const target = $derived(ui.confirmUnsend ? messages.find(ui.confirmUnsend.threadId, ui.confirmUnsend.messageId) : undefined);
  let confirmButton: HTMLButtonElement | undefined = $state();

  $effect(() => {
    confirmButton?.focus();
  });

  function cancel(): void {
    ui.confirmUnsend = null;
  }

  function confirm(): void {
    const ref = ui.confirmUnsend;
    ui.confirmUnsend = null;
    if (ref) void messages.unsend(ref.threadId, ref.messageId);
  }
</script>

{#if ui.confirmUnsend}
  <div class="backdrop" role="presentation" onclick={cancel}>
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="unsend-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={() => {}}
    >
      <h2 id="unsend-title">Unsend message</h2>
      <p>Are you sure you want to unsend this message? It will be removed for everyone in the conversation.</p>
      {#if target}<blockquote>{messagePreview(target)}</blockquote>{/if}
      <div class="buttons">
        <button class="cancel" onclick={cancel}>Cancel</button>
        <button class="danger" bind:this={confirmButton} onclick={confirm}>Unsend</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.6);
  }
  .dialog {
    width: min(440px, 90vw);
    padding: 20px;
    border-radius: 8px;
    background: var(--bg-base);
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.4);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1.15rem;
    color: var(--text-header);
  }
  p {
    margin: 0 0 12px;
    color: var(--text-muted);
  }
  blockquote {
    margin: 0 0 16px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--bg-sidebar);
    overflow-wrap: anywhere;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .buttons button {
    padding: 8px 16px;
    border-radius: 4px;
    font-weight: 600;
  }
  .cancel:hover {
    text-decoration: underline;
  }
  .danger {
    background: var(--danger);
    color: var(--bg-base);
  }
</style>
