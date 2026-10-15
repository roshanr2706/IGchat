<script lang="ts">
  type Props = { onpick: (emoji: string) => void; onclose: () => void };
  let { onpick, onclose }: Props = $props();

  const EMOJI = [
    '❤️', '😂', '😮', '😢', '😡', '👍', '👎', '🔥',
    '🎉', '😍', '🥺', '💀', '😭', '🙏', '👀', '💯',
    '😅', '🤔', '😎', '🥰', '😤', '🤣', '😳', '🙄',
    '👏', '🤝', '✨', '💔', '😴', '🤯', '😬', '🫶'
  ];

  let el: HTMLDivElement | undefined = $state();

  $effect(() => {
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Element | null;
      if (el && target && !el.contains(target) && !target.closest('[data-picker-toggle]')) onclose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });
</script>

<div class="picker" bind:this={el} role="dialog" aria-label="Pick a reaction">
  {#each EMOJI as emoji (emoji)}
    <button aria-label="React with {emoji}" onclick={() => onpick(emoji)}>{emoji}</button>
  {/each}
</div>

<style>
  .picker {
    display: grid;
    grid-template-columns: repeat(8, 32px);
    gap: 2px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
  }
  button {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    font-size: 1.2rem;
  }
  button:hover {
    background: var(--bg-hover);
  }
</style>
