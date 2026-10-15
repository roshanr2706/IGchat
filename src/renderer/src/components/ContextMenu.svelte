<script lang="ts">
  import { inbox } from '../stores/inbox.svelte';
  import { messages } from '../stores/messages.svelte';
  import { ui } from '../stores/ui.svelte';
  import MessageActions from './MessageActions.svelte';

  const MENU_W = 220;
  const MENU_H = 260;

  const target = $derived(ui.contextMenu ? messages.find(ui.contextMenu.threadId, ui.contextMenu.messageId) : undefined);
  const pos = $derived.by(() => {
    const menu = ui.contextMenu;
    if (!menu) return { x: 0, y: 0 };
    return { x: Math.max(8, Math.min(menu.x, window.innerWidth - MENU_W - 8)), y: Math.max(8, Math.min(menu.y, window.innerHeight - MENU_H - 8)) };
  });

  function close(): void {
    ui.contextMenu = null;
  }
</script>

{#if ui.contextMenu && target}
  <div
    class="backdrop"
    role="presentation"
    onpointerdown={close}
    oncontextmenu={(e) => {
      e.preventDefault();
      close();
    }}
  ></div>
  <div class="ctx" style:left="{pos.x}px" style:top="{pos.y}px">
    <MessageActions message={target} threadId={ui.contextMenu.threadId} myId={inbox.me?.id ?? 'me'} variant="menu" ondone={close} />
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }
  .ctx {
    position: fixed;
    z-index: 51;
  }
</style>
