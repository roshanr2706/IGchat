<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { EMOJI_GROUPS, emojiIndex, findEmoji, loadEmoji, type EmojiEntry, type EmojiIndex } from '../lib/emoji';

  type Props = {
    onpick: (emoji: string) => void;
    onclose: () => void;
    /** Label for the dialog and its buttons ("React with" vs "Insert"). */
    purpose?: 'react' | 'insert';
  };
  let { onpick, onclose, purpose = 'react' }: Props = $props();

  let el: HTMLDivElement | undefined = $state();
  let search: HTMLInputElement | undefined = $state();
  let grid: HTMLDivElement | undefined = $state();
  let index = $state<EmojiIndex | null>(emojiIndex());
  let query = $state('');
  let hovered = $state<EmojiEntry | null>(null);

  const verb = $derived(purpose === 'react' ? 'React with' : 'Insert');
  const results = $derived(index && query.trim() ? findEmoji(index, query, 120) : null);

  onMount(() => {
    if (!index) void loadEmoji().then((i) => (index = i));
    void tick().then(() => search?.focus());
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Element | null;
      if (el && target && !el.contains(target) && !target.closest('[data-picker-toggle]')) onclose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    } else if (e.key === 'Enter' && results?.[0]) {
      e.preventDefault();
      onpick(results[0].emoji);
    }
  }

  function jump(group: number): void {
    query = '';
    void tick().then(() => grid?.querySelector(`[data-group="${group}"]`)?.scrollIntoView({ block: 'start' }));
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="picker" bind:this={el} role="dialog" aria-label={purpose === 'react' ? 'Pick a reaction' : 'Pick an emoji'} tabindex="-1" onkeydown={onKeydown}>
  <input class="search" bind:this={search} bind:value={query} placeholder="Search emoji" aria-label="Search emoji" spellcheck="false" />
  <div class="tabs" role="tablist" aria-label="Emoji categories">
    {#each EMOJI_GROUPS as g (g.id)}
      <button role="tab" aria-selected="false" title={g.label} aria-label={g.label} onclick={() => jump(g.id)}>{g.icon}</button>
    {/each}
  </div>
  <div class="grid-wrap" bind:this={grid}>
    {#if !index}
      <p class="none">Loading…</p>
    {:else if results}
      {#if results.length}
        <div class="grid">
          {#each results as e (e.emoji)}
            <button aria-label="{verb} {e.emoji}" title=":{e.codes[0]}:" onmouseenter={() => (hovered = e)} onclick={() => onpick(e.emoji)}>{e.emoji}</button>
          {/each}
        </div>
      {:else}
        <p class="none">No emoji match “{query}”</p>
      {/if}
    {:else}
      {#each EMOJI_GROUPS as g (g.id)}
        <section data-group={g.id}>
          <h4>{g.label}</h4>
          <div class="grid">
            {#each index.byGroup.get(g.id) ?? [] as e (e.emoji)}
              <button aria-label="{verb} {e.emoji}" title=":{e.codes[0]}:" onmouseenter={() => (hovered = e)} onclick={() => onpick(e.emoji)}>{e.emoji}</button>
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
  <div class="footer" aria-live="polite">
    {#if hovered}<span class="big">{hovered.emoji}</span><span class="code">:{hovered.codes[0]}:</span>{/if}
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    width: 352px;
    height: 400px;
    max-height: 60vh;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
    overflow: hidden;
  }
  .search {
    margin: 8px 8px 4px;
    padding: 6px 8px;
    border: none;
    border-radius: 4px;
    background: var(--bg-input, var(--bg-active));
    color: var(--text-normal);
    font: inherit;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 0 6px 4px;
    border-bottom: 1px solid var(--bg-active);
  }
  .tabs button {
    flex: 1;
    height: 28px;
    border-radius: 4px;
    font-size: 1rem;
    filter: grayscale(0.6);
  }
  .tabs button:hover {
    background: var(--bg-hover);
    filter: none;
  }
  .grid-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px;
  }
  h4 {
    margin: 8px 0 4px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  section {
    content-visibility: auto;
    contain-intrinsic-size: auto 400px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(9, 1fr);
    gap: 2px;
  }
  .grid button {
    height: 34px;
    border-radius: 4px;
    font-size: 1.35rem;
    line-height: 1;
  }
  .grid button:hover,
  .grid button:focus-visible {
    background: var(--bg-hover);
  }
  .none {
    padding: 16px 4px;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 10px;
    border-top: 1px solid var(--bg-active);
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .big {
    font-size: 1.3rem;
  }
</style>
