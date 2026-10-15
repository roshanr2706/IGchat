<script lang="ts">
  import { DETAILS_MAX, DETAILS_MIN } from '../../../shared/settings';
  import type { Thread, User } from '../../../shared/types';
  import { call } from '../lib/api';
  import { openExternal } from '../lib/external';
  import { inbox } from '../stores/inbox.svelte';
  import { messages } from '../stores/messages.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui } from '../stores/ui.svelte';
  import Avatar from './Avatar.svelte';
  import ResizeHandle from './ResizeHandle.svelte';

  type Props = { thread: Thread };
  let { thread }: Props = $props();

  // A derived primitive so the fetch below only re-runs when the conversation changes, not on every inbox update.
  const threadId = $derived(thread.id);
  let details = $state<Thread | null>(null);

  $effect(() => {
    const id = threadId;
    let cancelled = false;
    details = null;
    call('thread:details', id)
      .then((d) => {
        if (!cancelled) details = d;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  const participants = $derived(details?.participants ?? thread.participants);
  const person = $derived<User | undefined>(thread.isGroup ? undefined : participants[0]);
  const members = $derived<User[]>([...(inbox.me ? [inbox.me] : []), ...participants]);
  const media = $derived(messages.mediaOf(thread.id).slice(-24).reverse());
  const width = $derived(ui.dragDetailsWidth ?? settings.value.detailsWidth);
</script>

<aside class="details" style:width="{width}px" aria-label="Conversation details">
  <ResizeHandle
    side="right"
    width={settings.value.detailsWidth}
    min={DETAILS_MIN}
    max={DETAILS_MAX}
    onlive={(w) => (ui.dragDetailsWidth = w)}
    oncommit={(w) => {
      ui.dragDetailsWidth = null;
      void settings.update({ detailsWidth: w });
    }}
  />
  <div class="scroll">
    {#if person}
      {@const p = person}
      <div class="banner"></div>
      <div class="profile">
        <div class="big-avatar"><Avatar urls={p.avatarUrl ? [p.avatarUrl] : []} name={p.fullName || p.username} size={80} /></div>
        <h2>
          {p.fullName || p.username}
          {#if p.verified}<span class="verified" title="Verified">✔</span>{/if}
        </h2>
        <div class="username">@{p.username}</div>
        {#if thread.muted}<div class="muted-note">🔕 Muted</div>{/if}
        {#if p.bio}
          <section class="card">
            <h3>About</h3>
            <p class="bio">{p.bio}</p>
          </section>
        {/if}
        <button class="open-profile" onclick={() => openExternal(`https://www.instagram.com/${encodeURIComponent(p.username)}/`)}>
          Open profile on Instagram
        </button>
      </div>
    {:else}
      <div class="group-head">
        <Avatar urls={thread.avatarUrls} name={thread.title} size={64} />
        <h2>{thread.title}</h2>
        <div class="username">{members.length} members{thread.muted ? ' · 🔕 Muted' : ''}</div>
      </div>
      <section class="card">
        <h3>Members — {members.length}</h3>
        <ul class="members">
          {#each members as m (m.id)}
            <li>
              <Avatar urls={m.avatarUrl ? [m.avatarUrl] : []} name={m.fullName || m.username} size={32} />
              <span class="member-text">
                <span class="member-name">{m.fullName || m.username}{m.id === inbox.me?.id ? ' (you)' : ''}</span>
                <span class="member-user">@{m.username}</span>
              </span>
              {#if thread.adminIds.includes(m.id)}<span class="badge">Admin</span>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    <section class="card">
      <h3>Shared media</h3>
      {#if media.length}
        <div class="grid">
          {#each media as m (m.id)}
            <button aria-label="Open media" onclick={() => (ui.lightbox = { threadId: thread.id, messageId: m.id })}>
              <img src={m.kind === 'image' ? m.url : m.thumbUrl} alt="" loading="lazy" />
            </button>
          {/each}
        </div>
      {:else}
        <p class="empty">No photos or videos loaded yet.</p>
      {/if}
    </section>
  </div>
</aside>

<style>
  .details {
    position: relative;
    flex: none;
    display: flex;
    background: var(--bg-sidebar);
  }
  .scroll {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
  }
  .banner {
    height: 60px;
    background: var(--accent);
  }
  .profile {
    padding: 0 16px 16px;
  }
  .big-avatar {
    display: inline-flex;
    margin-top: -40px;
    border: 6px solid var(--bg-sidebar);
    border-radius: 50%;
  }
  h2 {
    margin: 8px 0 0;
    font-size: 1.2rem;
    color: var(--text-header);
    overflow-wrap: anywhere;
  }
  .verified {
    margin-left: 6px;
    font-size: 0.85rem;
    color: var(--accent);
  }
  .username {
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .muted-note {
    margin-top: 4px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .group-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px 16px 8px;
    text-align: center;
  }
  .card {
    margin: 12px 16px 0;
    padding: 12px;
    border-radius: 8px;
    background: var(--bg-base);
  }
  .profile .card {
    margin: 12px 0 0;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .bio {
    margin: 0;
    white-space: pre-wrap;
    font-size: 0.9rem;
  }
  .open-profile {
    width: 100%;
    margin-top: 12px;
    padding: 8px;
    border-radius: 4px;
    background: var(--bg-active);
    font-size: 0.85rem;
    font-weight: 600;
  }
  .open-profile:hover {
    background: var(--accent);
    color: var(--accent-text);
  }
  .members {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .members li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
  }
  .member-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .member-name,
  .member-user {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .member-name {
    font-size: 0.9rem;
    color: var(--text-header);
  }
  .member-user {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .badge {
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 0.65rem;
    font-weight: 700;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }
  .grid button {
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 4px;
  }
  .grid img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .empty {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .card:last-child {
    margin-bottom: 16px;
  }
</style>
