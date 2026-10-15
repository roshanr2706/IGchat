<script lang="ts">
  import { onMount } from 'svelte';
  import { windowColorsFor } from '../../shared/theme';
  import TitleBar from './components/TitleBar.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import ChatPane from './components/ChatPane.svelte';
  import ConfirmUnsend from './components/ConfirmUnsend.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import Lightbox from './components/Lightbox.svelte';
  import Toasts from './components/Toasts.svelte';
  import { stepThread } from './lib/actions';
  import { matchShortcut } from './lib/shortcuts';
  import { inbox } from './stores/inbox.svelte';
  import { messages } from './stores/messages.svelte';
  import { settings } from './stores/settings.svelte';
  import { themes } from './stores/themes.svelte';
  import { ui } from './stores/ui.svelte';
  import { applyTheme } from './themes/apply';

  onMount(() => {
    const offs = [inbox.subscribe(), messages.subscribe()];
    void inbox.load().catch(() => ui.toast("Couldn't load your inbox"));
    void themes.loadCustom();

    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = (): void => {
      themes.prefersDark = scheme.matches;
    };
    const onResize = (): void => {
      ui.windowWidth = window.innerWidth;
    };
    onScheme();
    onResize();
    scheme.addEventListener('change', onScheme);
    window.addEventListener('resize', onResize);
    return () => {
      offs.forEach((off) => off());
      scheme.removeEventListener('change', onScheme);
      window.removeEventListener('resize', onResize);
    };
  });

  $effect(() => {
    const root = document.documentElement;
    applyTheme(root, themes.active, settings.value.accent);
    root.style.setProperty('--font-scale', String(settings.value.fontScale));
  });

  // Keep the native window background / title-bar buttons in sync with the theme.
  $effect(() => {
    const wanted = windowColorsFor(themes.active);
    const current = settings.value.windowColors;
    if (wanted.base !== current.base || wanted.titlebar !== current.titlebar || wanted.symbol !== current.symbol) {
      void settings.update({ windowColors: wanted });
    }
  });

  function onKeydown(e: KeyboardEvent): void {
    const action = matchShortcut(e);
    if (!action) return;
    if (action === 'escape') {
      if (ui.closeTopModal()) e.preventDefault();
      return;
    }
    e.preventDefault();
    if (action === 'switcher') ui.switcherOpen = !ui.switcherOpen;
    else if (action === 'prevThread') stepThread(-1);
    else if (action === 'nextThread') stepThread(1);
    else if (action === 'toggleSidebar') ui.toggleSidebar();
    else if (action === 'toggleDetails') ui.toggleDetails();
    else if (action === 'settings') ui.settingsOpen = !ui.settingsOpen;
    else if (action === 'cycleTheme') themes.cycle();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app" class:compact={settings.value.compact}>
  <TitleBar />
  <div class="body">
    <Sidebar />
    <main class="main">
      {#if inbox.active}
        {#key inbox.active.id}
          <ChatPane thread={inbox.active} />
        {/key}
      {:else}
        <div class="empty">
          <p>Pick a conversation, or press <kbd>Ctrl</kbd> + <kbd>K</kbd> to jump to one.</p>
        </div>
      {/if}
    </main>
    <!-- details -->
  </div>
  <!-- overlays -->
  <ContextMenu />
  <ConfirmUnsend />
  <Lightbox />
  <Toasts />
</div>

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-base);
  }
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 24px;
    color: var(--text-muted);
    text-align: center;
  }
</style>
