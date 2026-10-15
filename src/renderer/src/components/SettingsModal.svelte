<script lang="ts">
  import { DEFAULT_SETTINGS, FONT_SCALES } from '../../../shared/settings';
  import type { ThemeDef } from '../../../shared/theme';
  import { call } from '../lib/api';
  import { settings } from '../stores/settings.svelte';
  import { themes } from '../stores/themes.svelte';
  import { ui } from '../stores/ui.svelte';
  import { SYSTEM_THEME_ID } from '../themes/apply';
  import { BUILTIN_THEMES } from '../themes/builtin';

  const FONT_LABELS: Record<number, string> = { 0.875: 'Small', 1: 'Default', 1.125: 'Large', 1.25: 'Extra large' };

  const lightBase = BUILTIN_THEMES.find((t) => t.id === 'light')!.tokens['bg-base'];
  const darkBase = BUILTIN_THEMES.find((t) => t.id === 'dark')!.tokens['bg-base'];

  function close(): void {
    ui.settingsOpen = false;
  }

  function setAccentEnabled(on: boolean): void {
    void settings.update({ accent: on ? themes.active.tokens.accent : null });
  }

  function resetLayout(): void {
    void settings.update({
      sidebarWidth: DEFAULT_SETTINGS.sidebarWidth,
      detailsWidth: DEFAULT_SETTINGS.detailsWidth,
      sidebarCollapsed: false,
      detailsPref: 'auto'
    });
  }
</script>

{#snippet swatch(theme: ThemeDef)}
  <span class="swatch" style:background={theme.tokens['bg-base']}>
    <span class="swatch-side" style:background={theme.tokens['bg-sidebar']}></span>
    <span class="swatch-accent" style:background={theme.tokens.accent}></span>
  </span>
{/snippet}

<div class="backdrop" role="presentation" onclick={close}>
  <div class="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <header>
      <h2 id="settings-title">Settings</h2>
      <button class="close" aria-label="Close settings" title="Close (Esc)" onclick={close}>✕</button>
    </header>

    <section>
      <h3>Theme</h3>
      <div class="themes">
        <button class="theme" class:selected={settings.value.themeId === SYSTEM_THEME_ID} onclick={() => themes.select(SYSTEM_THEME_ID)}>
          <span class="swatch system" style:background="linear-gradient(135deg, {lightBase} 0 50%, {darkBase} 50% 100%)"></span>
          <span>System</span>
        </button>
        {#each themes.all as theme (theme.id)}
          <button class="theme" class:selected={settings.value.themeId === theme.id} onclick={() => themes.select(theme.id)}>
            {@render swatch(theme)}
            <span>{theme.name}</span>
          </button>
        {/each}
      </div>
      <p class="hint">Custom themes are <code>.json</code> files in your themes folder (format in the README). <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> cycles themes.</p>
      {#if themes.customErrors.length}
        <ul class="errors">
          {#each themes.customErrors as error (error)}<li>{error}</li>{/each}
        </ul>
      {/if}
      <div class="row">
        <button class="secondary" onclick={() => void call('themes:openFolder').catch(() => {})}>Open themes folder</button>
        <button class="secondary" onclick={() => void themes.loadCustom()}>Reload custom themes</button>
      </div>
    </section>

    <section>
      <h3>Accent color</h3>
      <label class="row">
        <input type="checkbox" checked={settings.value.accent !== null} onchange={(e) => setAccentEnabled(e.currentTarget.checked)} />
        Use a custom accent color
      </label>
      {#if settings.value.accent}
        <input class="color" type="color" aria-label="Accent color" value={settings.value.accent} oninput={(e) => void settings.update({ accent: e.currentTarget.value })} />
      {/if}
    </section>

    <section>
      <h3>Text &amp; density</h3>
      <div class="row">
        <span>Font size</span>
        <select aria-label="Font size" value={settings.value.fontScale} onchange={(e) => void settings.update({ fontScale: Number(e.currentTarget.value) })}>
          {#each FONT_SCALES as scale (scale)}
            <option value={scale}>{FONT_LABELS[scale]}</option>
          {/each}
        </select>
      </div>
      <label class="row">
        <input type="checkbox" checked={settings.value.compact} onchange={(e) => void settings.update({ compact: e.currentTarget.checked })} />
        Compact mode
      </label>
    </section>

    <section>
      <h3>Layout</h3>
      <p class="hint">Restores default panel widths, expands the sidebar and lets the details panel show automatically on wide windows.</p>
      <button class="secondary" onclick={resetLayout}>Reset panel layout</button>
    </section>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 45;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.6);
  }
  .settings {
    width: min(640px, 94vw);
    max-height: 85vh;
    overflow-y: auto;
    padding: 20px 24px;
    border-radius: 8px;
    background: var(--bg-base);
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.4);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--text-header);
  }
  .close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: var(--text-muted);
  }
  .close:hover {
    background: var(--bg-hover);
  }
  section {
    padding: 16px 0;
    border-bottom: 1px solid var(--bg-active);
  }
  section:last-child {
    border-bottom: none;
  }
  h3 {
    margin: 0 0 10px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .themes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
  }
  .theme {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 2px solid transparent;
    border-radius: 8px;
    background: var(--bg-sidebar);
    font-size: 0.8rem;
    text-align: left;
  }
  .theme.selected {
    border-color: var(--accent);
  }
  .swatch {
    position: relative;
    display: block;
    height: 48px;
    overflow: hidden;
    border-radius: 4px;
  }
  .swatch-side {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 30%;
  }
  .swatch-accent {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: 40%;
    height: 10px;
    border-radius: 5px;
  }
  .hint {
    margin: 10px 0;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .errors {
    margin: 0 0 10px;
    padding-left: 18px;
    font-size: 0.8rem;
    color: var(--danger);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 6px 0;
  }
  .secondary {
    padding: 6px 12px;
    border-radius: 4px;
    background: var(--bg-active);
    font-size: 0.85rem;
  }
  .secondary:hover {
    background: var(--bg-hover);
  }
  select {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-input);
  }
  .color {
    width: 64px;
    height: 32px;
    border: none;
    background: none;
  }
</style>
