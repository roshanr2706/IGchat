<script lang="ts">
  import { inbox } from '../stores/inbox.svelte';
  import { ui } from '../stores/ui.svelte';

  const STATUS_TEXT = { ok: '', reconnecting: 'Reconnecting…', authExpired: 'Session expired', checkpoint: 'Action needed' } as const;
  const status = $derived(STATUS_TEXT[inbox.syncStatus]);
</script>

<header class="titlebar">
  <span class="brand">IGchat</span>
  <button class="search" onclick={() => (ui.switcherOpen = true)}>
    <span>Find a conversation</span>
    <kbd>Ctrl K</kbd>
  </button>
  {#if status}
    <span class="pill" class:bad={inbox.syncStatus !== 'reconnecting'}>{status}</span>
  {/if}
</header>

<style>
  .titlebar {
    flex: none;
    height: 32px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 140px 0 12px;
    background: var(--bg-titlebar);
    user-select: none;
    -webkit-app-region: drag;
  }
  .brand {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--text-muted);
  }
  .search {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: min(360px, 50%);
    margin: 0 auto;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--bg-sidebar);
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .search:hover {
    color: var(--text-normal);
  }
  .pill {
    -webkit-app-region: no-drag;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--bg-active);
    color: var(--text-normal);
    font-size: 0.75rem;
  }
  .pill.bad {
    background: var(--danger);
    color: var(--bg-base);
  }
</style>
