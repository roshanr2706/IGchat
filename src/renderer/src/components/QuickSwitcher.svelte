<script lang="ts">
  import { openThread } from '../lib/actions';
  import { searchThreads } from '../lib/fuzzy';
  import { inbox } from '../stores/inbox.svelte';
  import { ui } from '../stores/ui.svelte';
  import Avatar from './Avatar.svelte';

  let query = $state('');
  let index = $state(0);
  let input: HTMLInputElement | undefined = $state();

  const results = $derived(searchThreads(inbox.threads, query, 12));
  const activeOption = $derived(results[index] ? `sw-${results[index].id}` : undefined);

  $effect(() => {
    input?.focus();
  });

  function close(): void {
    ui.switcherOpen = false;
  }

  function choose(id: string): void {
    close();
    openThread(id);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      index = Math.min(results.length - 1, index + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      index = Math.max(0, index - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[index];
      if (target) choose(target.id);
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={close}>
  <div class="switcher" role="dialog" aria-modal="true" aria-label="Quick switcher" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <input
      bind:this={input}
      bind:value={query}
      oninput={() => (index = 0)}
      onkeydown={onKeydown}
      placeholder="Where would you like to go?"
      aria-label="Search conversations"
      aria-controls="switcher-results"
      aria-activedescendant={activeOption}
    />
    {#if results.length}
      <div class="section">{query.trim() ? 'Conversations' : 'Recent conversations'}</div>
      <ul id="switcher-results" role="listbox">
        {#each results as t, i (t.id)}
          <li id="sw-{t.id}" role="option" aria-selected={i === index}>
            <button class:selected={i === index} tabindex="-1" onmouseenter={() => (index = i)} onclick={() => choose(t.id)}>
              <Avatar urls={t.avatarUrls} name={t.title} size={24} />
              <span class="title">{t.title}</span>
              <span class="sub">{t.isGroup ? t.participants.map((p) => p.username).join(', ') : `@${t.participants[0]?.username ?? ''}`}</span>
              {#if t.unread}<span class="dot" aria-label="Unread"></span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="none">No conversations match “{query}”.</p>
    {/if}
    <footer>
      <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
      <span><kbd>Enter</kbd> open</span>
      <span><kbd>Esc</kbd> close</span>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 15vh;
    background: rgb(0 0 0 / 0.6);
  }
  .switcher {
    width: min(560px, 92vw);
    padding: 16px;
    border-radius: 8px;
    background: var(--bg-elevated);
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.4);
  }
  input {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 4px;
    outline: none;
    background: var(--bg-titlebar);
    font-size: 1.1rem;
  }
  .section {
    margin: 12px 4px 4px;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  ul {
    max-height: 50vh;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  li button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 4px;
    text-align: left;
  }
  li button.selected {
    background: var(--bg-active);
  }
  .title {
    flex: none;
    max-width: 50%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: 600;
    color: var(--text-header);
  }
  .sub {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .none {
    margin: 16px 4px;
    color: var(--text-muted);
  }
  footer {
    display: flex;
    gap: 16px;
    margin-top: 12px;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
