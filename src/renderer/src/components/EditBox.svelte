<script lang="ts">
  type Props = { initial: string; onsave: (text: string) => void; oncancel: () => void };
  let { initial, onsave, oncancel }: Props = $props();

  // Intentionally captures the initial value; the box owns its text after mounting.
  let text = $state(initial);
  let el: HTMLTextAreaElement | undefined = $state();

  function autosize(): void {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
  }

  $effect(() => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    autosize();
  });

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      onsave(text);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      oncancel();
    }
  }
</script>

<div class="edit-box">
  <textarea bind:this={el} bind:value={text} rows="1" aria-label="Edit message" oninput={autosize} onkeydown={onKeydown}></textarea>
  <div class="hint">
    escape to <button onclick={oncancel}>cancel</button> • enter to <button onclick={() => onsave(text)}>save</button>
  </div>
</div>

<style>
  .edit-box {
    padding: 4px 0;
  }
  textarea {
    width: 100%;
    max-height: 300px;
    padding: 8px 12px;
    border: none;
    border-radius: 8px;
    outline: none;
    background: var(--bg-input);
    resize: none;
    line-height: 1.375;
  }
  .hint {
    margin-top: 4px;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .hint button {
    color: var(--text-link);
  }
</style>
