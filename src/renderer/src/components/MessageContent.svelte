<script lang="ts">
  import type { Message } from '../../../shared/types';
  import { openExternal } from '../lib/external';
  import { ui } from '../stores/ui.svelte';

  type Props = { message: Message; threadId: string };
  let { message, threadId }: Props = $props();

  const MAX_W = 400;
  const MAX_H = 300;

  function fit(w: number, h: number): { width: number; height: number } | null {
    if (!w || !h) return null;
    const scale = Math.min(1, MAX_W / w, MAX_H / h);
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
  }

  function openMedia(): void {
    ui.lightbox = { threadId, messageId: message.id };
  }
</script>

{#if message.kind === 'text' || message.kind === 'actionLog'}
  <span class="text">{message.text}</span>
{:else if message.kind === 'image'}
  {@const size = fit(message.width, message.height)}
  <button class="media" onclick={openMedia} aria-label="Open image">
    <img src={message.url} alt="" loading="lazy" width={size?.width} height={size?.height} />
  </button>
{:else if message.kind === 'video'}
  {@const size = fit(message.width, message.height)}
  <div class="media">
    <video src={message.url} poster={message.thumbUrl} controls preload="none" width={size?.width} height={size?.height}></video>
  </div>
{:else if message.kind === 'sharedPost' || message.kind === 'reel'}
  {@const post = message}
  <button class="card" class:reel={post.kind === 'reel'} onclick={() => openExternal(post.postUrl)}>
    <img src={post.thumbUrl} alt="" loading="lazy" />
    <span class="card-text">
      <span class="card-kind">{post.kind === 'reel' ? 'Reel' : 'Post'}{post.author ? ` · @${post.author}` : ''}</span>
      {#if post.caption}<span class="caption">{post.caption}</span>{/if}
    </span>
  </button>
{:else if message.kind === 'link'}
  {@const link = message}
  <span class="text">{link.text}</span>
  <button class="link-card" onclick={() => openExternal(link.url)}>
    {#if link.thumbUrl}<img src={link.thumbUrl} alt="" loading="lazy" />{/if}
    <span class="link-title">{link.title ?? link.url}</span>
    <span class="link-url">{link.url}</span>
  </button>
{:else if message.kind === 'like'}
  <span class="like" aria-label="Liked">❤️</span>
{:else}
  <span class="unsupported">
    This message type ({message.rawType}) isn't supported yet.
    <button onclick={() => openExternal('https://www.instagram.com/direct/inbox/')}>Open in Instagram</button>
  </span>
{/if}

<style>
  .text {
    white-space: pre-wrap;
  }
  .media {
    display: block;
    max-width: min(400px, 100%);
    margin-top: 4px;
    border-radius: 8px;
    overflow: hidden;
  }
  .media img,
  .media video {
    display: block;
    max-width: 100%;
    max-height: 300px;
    height: auto;
    object-fit: contain;
    background: var(--bg-hover);
  }
  .card {
    display: flex;
    gap: 10px;
    max-width: 360px;
    margin-top: 4px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-sidebar);
    text-align: left;
  }
  .card img {
    flex: none;
    width: 72px;
    height: 72px;
    border-radius: 6px;
    object-fit: cover;
  }
  .card.reel img {
    width: 54px;
    height: 96px;
  }
  .card-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .card-kind {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .caption {
    display: -webkit-box;
    overflow: hidden;
    font-size: 0.85rem;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }
  .link-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 420px;
    margin-top: 4px;
    padding: 8px 12px;
    border-left: 4px solid var(--accent);
    border-radius: 4px;
    background: var(--bg-sidebar);
    text-align: left;
  }
  .link-card img {
    max-width: 100%;
    margin-bottom: 4px;
    border-radius: 4px;
  }
  .link-title {
    font-weight: 600;
    color: var(--text-link);
  }
  .link-url {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .like {
    font-size: 2rem;
    line-height: 1.2;
  }
  .unsupported {
    font-style: italic;
    color: var(--text-muted);
  }
  .unsupported button {
    font-style: normal;
    color: var(--text-link);
  }
</style>
