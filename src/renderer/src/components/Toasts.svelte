<script lang="ts">
  import { ui } from '../stores/ui.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each ui.toasts as toast (toast.id)}
    <div class="toast">{toast.text}</div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: 96px;
    z-index: 80;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transform: translateX(-50%);
    pointer-events: none;
  }
  .toast {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-elevated);
    color: var(--text-normal);
    font-size: 0.85rem;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.3);
  }
</style>
