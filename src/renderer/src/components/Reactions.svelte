<script lang="ts">
  import type { Reaction, User } from '../../../shared/types';

  type Props = { reactions: Reaction[]; myId: string; users: Map<string, User>; ontoggle: (emoji: string, mine: boolean) => void };
  let { reactions, myId, users, ontoggle }: Props = $props();

  const who = (r: Reaction): string => r.userIds.map((id) => (id === myId ? 'You' : (users.get(id)?.username ?? 'someone'))).join(', ');
</script>

<div class="reactions">
  {#each reactions as r (r.emoji)}
    {@const mine = r.userIds.includes(myId)}
    <button class="pill" class:mine aria-pressed={mine} title="{who(r)} reacted with {r.emoji}" onclick={() => ontoggle(r.emoji, mine)}>
      <span>{r.emoji}</span>
      <span class="count">{r.userIds.length}</span>
    </button>
  {/each}
</div>

<style>
  .reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--bg-sidebar);
    font-size: 0.9rem;
  }
  .pill:hover {
    border-color: var(--text-muted);
  }
  .pill.mine {
    background: var(--mention-bg);
    border-color: var(--accent);
  }
  .count {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
  }
</style>
