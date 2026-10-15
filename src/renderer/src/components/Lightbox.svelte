<script lang="ts">
  import { messages } from '../stores/messages.svelte';
  import { ui } from '../stores/ui.svelte';

  const media = $derived(ui.lightbox ? messages.mediaOf(ui.lightbox.threadId) : []);
  const index = $derived(ui.lightbox ? media.findIndex((m) => m.id === ui.lightbox!.messageId) : -1);
  const current = $derived(index >= 0 ? media[index] : undefined);

  function go(delta: number): void {
    const next = media[index + delta];
    if (next && ui.lightbox) ui.lightbox = { threadId: ui.lightbox.threadId, messageId: next.id };
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!ui.lightbox || e.altKey || e.ctrlKey) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if ui.lightbox && current}
  <div class="lightbox" role="dialog" aria-modal="true" aria-label="Media viewer" tabindex="-1" onclick={() => (ui.lightbox = null)} onkeydown={() => {}}>
    <div class="stage" role="presentation" onclick={(e) => e.stopPropagation()}>
      {#if current.kind === 'image'}
        <img src={current.url} alt="" />
      {:else}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={current.url} poster={current.thumbUrl} controls autoplay></video>
      {/if}
    </div>
    <button class="nav prev" aria-label="Previous" disabled={index <= 0} onclick={(e) => { e.stopPropagation(); go(-1); }}>‹</button>
    <button class="nav next" aria-label="Next" disabled={index >= media.length - 1} onclick={(e) => { e.stopPropagation(); go(1); }}>›</button>
    <button class="close" aria-label="Close" onclick={() => (ui.lightbox = null)}>✕</button>
    <div class="counter">{index + 1} / {media.length}</div>
  </div>
{/if}

<style>
  .lightbox {
    position: fixed;
    inset: 32px 0 0;
    z-index: 70;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.85);
  }
  .stage img,
  .stage video {
    display: block;
    max-width: 90vw;
    max-height: 80vh;
    border-radius: 4px;
  }
  .nav {
    position: absolute;
    top: 50%;
    width: 48px;
    height: 64px;
    transform: translateY(-50%);
    border-radius: 8px;
    color: #fff;
    font-size: 2.5rem;
  }
  .nav:disabled {
    opacity: 0.2;
    cursor: default;
  }
  .prev {
    left: 16px;
  }
  .next {
    right: 16px;
  }
  .close {
    position: absolute;
    top: 12px;
    right: 16px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.5);
    color: #fff;
  }
  .counter {
    position: absolute;
    bottom: 16px;
    color: #fff;
    font-size: 0.85rem;
    opacity: 0.8;
  }
</style>
