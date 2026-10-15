<script lang="ts">
  import { RAIL_WIDTH, SIDEBAR_MAX, SIDEBAR_MIN } from '../../../shared/settings';
  import { openThread } from '../lib/actions';
  import { inbox } from '../stores/inbox.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import Avatar from './Avatar.svelte';
  import ResizeHandle from './ResizeHandle.svelte';
  import ThreadRow from './ThreadRow.svelte';

  const rail = $derived(ui.sidebarMode === 'rail');
  const width = $derived(rail ? RAIL_WIDTH : (ui.dragSidebarWidth ?? settings.value.sidebarWidth));

  function onScroll(e: Event): void {
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) void inbox.loadMore();
  }
</script>

<nav class="sidebar" class:rail style:width="{width}px" aria-label="Conversations">
  {#if !rail}
    <button class="find" onclick={() => (ui.switcherOpen = true)}>Find a conversation</button>
    <div class="heading">Direct Messages</div>
  {/if}
  <div class="list" onscroll={onScroll}>
    {#each inbox.threads as thread (thread.id)}
      <ThreadRow {thread} active={thread.id === inbox.activeId} {rail} onselect={openThread} />
    {/each}
    {#if inbox.loading}<div class="loading">Loading…</div>{/if}
  </div>
  <footer class="me">
    {#if inbox.me}
      <Avatar urls={inbox.me.avatarUrl ? [inbox.me.avatarUrl] : []} name={inbox.me.username} size={32} />
      {#if !rail}<span class="me-name">{inbox.me.username}</span>{/if}
    {/if}
    {#if !rail}
      <button class="gear" title="Settings (Ctrl+,)" aria-label="Settings" onclick={() => (ui.settingsOpen = true)}>⚙</button>
    {/if}
  </footer>
  {#if !rail}
    <ResizeHandle
      side="left"
      width={settings.value.sidebarWidth}
      min={SIDEBAR_MIN}
      max={SIDEBAR_MAX}
      onlive={(w) => (ui.dragSidebarWidth = w)}
      oncommit={(w) => {
        ui.dragSidebarWidth = null;
        void settings.update({ sidebarWidth: w });
      }}
    />
  {/if}
</nav>

<style>
  .sidebar {
    position: relative;
    flex: none;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-sidebar);
  }
  .find {
    margin: 10px;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--bg-titlebar);
    color: var(--text-muted);
    text-align: left;
    font-size: 0.85rem;
  }
  .heading {
    padding: 8px 16px 4px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 8px;
  }
  .rail .list {
    padding: 8px 0;
  }
  .loading {
    padding: 8px;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .me {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 52px;
    padding: 8px 10px;
    background: var(--bg-titlebar);
  }
  .rail .me {
    justify-content: center;
  }
  .me-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-header);
  }
  .gear {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    font-size: 1.1rem;
    color: var(--text-muted);
  }
  .gear:hover {
    background: var(--bg-hover);
    color: var(--text-header);
  }
</style>
