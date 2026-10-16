<script lang="ts" module>
  /** Counts person-opens across instances (the switcher closes itself before the open finishes). */
  let personSeq = 0;
</script>

<script lang="ts">
  import type { User } from '../../../shared/types';
  import { openThread } from '../lib/actions';
  import { call } from '../lib/api';
  import { searchThreads } from '../lib/fuzzy';
  import { inbox } from '../stores/inbox.svelte';
  import { ui } from '../stores/ui.svelte';
  import Avatar from './Avatar.svelte';

  let query = $state('');
  let index = $state(0);
  let input: HTMLInputElement | undefined = $state();

  const results = $derived(searchThreads(inbox.threads, query, 12));
  let people = $state<User[]>([]);
  let searchError = $state(false);
  let searchSeq = 0;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  const knownDmUserIds = $derived(new Set(inbox.threads.filter((t) => !t.isGroup).map((t) => t.participants[0]?.id)));
  const newPeople = $derived(people.filter((p) => !knownDmUserIds.has(p.id)));

  function scheduleSearch(): void {
    if (searchTimer) clearTimeout(searchTimer);
    const q = query.trim();
    const seq = ++searchSeq;
    // A new query never shows the previous query's people or error.
    people = [];
    searchError = false;
    if (q.length < 2) return;
    searchTimer = setTimeout(() => {
      void call('search:people', q)
        .then((found) => {
          if (seq === searchSeq) people = found;
        })
        .catch(() => {
          if (seq !== searchSeq) return;
          people = [];
          searchError = true;
        });
    }, 300);
  }

  async function choosePerson(userId: string): Promise<void> {
    close();
    const mine = ++personSeq;
    const startedOn = inbox.activeId;
    try {
      const thread = await call('thread:openWithUser', userId);
      inbox.applyUpdates([thread]);
      // A later choice (another person, or any conversation picked meanwhile) wins over a slow open.
      if (mine === personSeq && inbox.activeId === startedOn) openThread(thread.id);
    } catch {
      ui.toast("Couldn't open that chat");
    }
  }

  const total = $derived(results.length + newPeople.length);
  const sel = $derived(total ? Math.min(Math.max(index, 0), total - 1) : 0);
  const activeOption = $derived(sel < results.length ? (results[sel] ? `sw-${results[sel].id}` : undefined) : newPeople[sel - results.length] ? `sw-p-${newPeople[sel - results.length]!.id}` : undefined);

  $effect(() => {
    input?.focus();
  });

  $effect(() => () => {
    searchSeq++;
    if (searchTimer) clearTimeout(searchTimer);
  });

  function close(): void {
    ui.switcherOpen = false;
  }

  function choose(id: string): void {
    personSeq++;
    close();
    openThread(id);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      index = Math.min(total - 1, sel + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      index = Math.max(0, sel - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[sel];
      if (target) choose(target.id);
      else {
        const person = newPeople[sel - results.length];
        if (person) void choosePerson(person.id);
      }
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={close}>
  <div class="switcher" role="dialog" aria-modal="true" aria-label="Quick switcher" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <input
      bind:this={input}
      bind:value={query}
      oninput={() => {
        index = 0;
        scheduleSearch();
      }}
      onkeydown={onKeydown}
      placeholder="Where would you like to go?"
      aria-label="Search conversations"
      aria-controls="switcher-results switcher-people"
      aria-activedescendant={activeOption}
    />
    {#if results.length}
      <div class="section">{query.trim() ? 'Conversations' : 'Recent conversations'}</div>
      <ul id="switcher-results" role="listbox">
        {#each results as t, i (t.id)}
          <li id="sw-{t.id}" role="option" aria-selected={i === sel}>
            <button class:selected={i === sel} tabindex="-1" onmouseenter={() => (index = i)} onclick={() => choose(t.id)}>
              <Avatar urls={t.avatarUrls} name={t.title} size={24} />
              <span class="title">{t.title}</span>
              <span class="sub">{t.isGroup ? t.participants.map((p) => p.username).join(', ') : `@${t.participants[0]?.username ?? ''}`}</span>
              {#if t.unread}<span class="dot" aria-label="Unread"></span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else if !newPeople.length}
      <p class="none">No conversations match “{query}”.</p>
    {/if}
    {#if newPeople.length || searchError}
      <div class="section">People</div>
    {/if}
    {#if searchError}
      <p class="none" role="status">People search unavailable</p>
    {/if}
    {#if newPeople.length}
      <ul id="switcher-people" role="listbox" aria-label="People">
        {#each newPeople as p, j (p.id)}
          <li id="sw-p-{p.id}" role="option" aria-selected={results.length + j === sel}>
            <button class="person" class:selected={results.length + j === sel} tabindex="-1" onmouseenter={() => (index = results.length + j)} onclick={() => void choosePerson(p.id)}>
              <Avatar urls={p.avatarUrl ? [p.avatarUrl] : []} name={p.fullName || p.username} size={24} />
              <span class="title">{p.fullName || p.username}</span>
              <span class="sub">@{p.username}</span>
            </button>
          </li>
        {/each}
      </ul>
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
  li button,
  .person {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 4px;
    text-align: left;
  }
  li button.selected,
  .person.selected {
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
