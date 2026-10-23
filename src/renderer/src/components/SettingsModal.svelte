<script lang="ts">
  import { DEFAULT_SETTINGS, FONT_SCALES, MAX_QUICK_REACTIONS, SOUND_IDS, type SoundId } from '../../../shared/settings';
  import type { ThemeDef } from '../../../shared/theme';
  import { call } from '../lib/api';
  import { canDecode, playSound, resetCustomSound, SOUND_LABELS } from '../lib/sound';
  import { settings } from '../stores/settings.svelte';
  import { themes } from '../stores/themes.svelte';
  import { ui } from '../stores/ui.svelte';
  import { SYSTEM_THEME_ID } from '../themes/apply';
  import { BUILTIN_THEMES } from '../themes/builtin';
  import EmojiPicker from './EmojiPicker.svelte';

  const FONT_LABELS: Record<number, string> = { 0.875: 'Small', 1: 'Default', 1.125: 'Large', 1.25: 'Extra large' };

  const lightBase = BUILTIN_THEMES.find((t) => t.id === 'light')!.tokens['bg-base'];
  const darkBase = BUILTIN_THEMES.find((t) => t.id === 'dark')!.tokens['bg-base'];

  function close(): void {
    ui.settingsOpen = false;
  }

  /** Which quick-reaction slot the picker is choosing for: an index to replace, 'add', or closed. */
  let choosing = $state<number | 'add' | null>(null);

  function chooseQuick(emoji: string): void {
    const list = [...settings.value.quickReactions];
    const slot = choosing;
    choosing = null;
    if (slot === 'add') {
      if (!list.includes(emoji)) list.push(emoji);
    } else if (slot !== null) {
      const existing = list.indexOf(emoji);
      // Picking one that's already there swaps the two.
      if (existing >= 0) list[existing] = list[slot]!;
      list[slot] = emoji;
    }
    void settings.update({ quickReactions: list });
  }

  function removeQuick(i: number): void {
    const list = settings.value.quickReactions.filter((_, j) => j !== i);
    if (list.length) void settings.update({ quickReactions: list });
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

  const MAX_SOUND_BYTES = 5 * 1024 * 1024;
  let soundInput = $state<HTMLInputElement | null>(null);

  function preview(id: SoundId = settings.value.notificationSound): void {
    void playSound(id, settings.value.soundVolume).catch(() => {});
  }

  function chooseSound(id: SoundId): void {
    // Picking "Custom file" with none saved yet goes straight to the file picker.
    if (id === 'custom' && !settings.value.customSoundName) {
      soundInput?.click();
      return;
    }
    void settings.update({ notificationSound: id });
    preview(id);
  }

  async function onSoundFile(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (file.size > MAX_SOUND_BYTES) return ui.toast('That sound file is too big (5 MB max)');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!(await canDecode(bytes))) return ui.toast("Couldn't play that file. Try an MP3, WAV or OGG.");
    try {
      await call('sound:setCustom', bytes);
    } catch {
      return ui.toast("Couldn't save the sound");
    }
    resetCustomSound();
    await settings.update({ notificationSound: 'custom', customSoundName: file.name });
    preview('custom');
  }

  async function removeCustomSound(): Promise<void> {
    await call('sound:setCustom', null).catch(() => {});
    resetCustomSound();
    void settings.update({
      customSoundName: null,
      ...(settings.value.notificationSound === 'custom' ? { notificationSound: DEFAULT_SETTINGS.notificationSound } : {})
    });
  }

  async function logOut(): Promise<void> {
    if (!window.confirm('Log out of Instagram in IGchat?')) return;
    close();
    await call('auth:logout').catch(() => ui.toast("Couldn't log out"));
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
      <h3>Quick reactions</h3>
      <p class="hint">One click on a message's hover bar (the first three) and its right-click menu. Type <code>+:emoji:</code> in the message box to react to the latest message.</p>
      <div class="quick-row">
        {#each settings.value.quickReactions as emoji, i (emoji)}
          <span class="quick-slot">
            <button class="quick-emoji" data-picker-toggle aria-label="Change quick reaction {emoji}" title="Change" onclick={() => (choosing = choosing === i ? null : i)}>{emoji}</button>
            {#if settings.value.quickReactions.length > 1}
              <button class="quick-remove" aria-label="Remove quick reaction {emoji}" title="Remove" onclick={() => removeQuick(i)}>✕</button>
            {/if}
          </span>
        {/each}
        {#if settings.value.quickReactions.length < MAX_QUICK_REACTIONS}
          <button class="quick-add" data-picker-toggle aria-label="Add a quick reaction" title="Add" onclick={() => (choosing = choosing === 'add' ? null : 'add')}>+</button>
        {/if}
        <button class="secondary" aria-label="Reset quick reactions" onclick={() => void settings.update({ quickReactions: [...DEFAULT_SETTINGS.quickReactions] })}>Reset</button>
      </div>
      {#if choosing !== null}
        <div class="quick-picker"><EmojiPicker onpick={chooseQuick} onclose={() => (choosing = null)} /></div>
      {/if}
    </section>

    <section>
      <h3>Notifications</h3>
      <div class="row">
        <span>Message sound</span>
        <select aria-label="Message sound" value={settings.value.notificationSound} onchange={(e) => chooseSound(e.currentTarget.value as SoundId)}>
          {#each SOUND_IDS as id (id)}
            <option value={id}>{SOUND_LABELS[id]}</option>
          {/each}
        </select>
        <button class="secondary" disabled={settings.value.notificationSound === 'none'} onclick={() => preview()}>Play</button>
      </div>
      <label class="row">
        <span>Volume</span>
        <input
          type="range"
          aria-label="Sound volume"
          min="0"
          max="1"
          step="0.05"
          value={settings.value.soundVolume}
          onchange={(e) => {
            void settings.update({ soundVolume: Number(e.currentTarget.value) });
            preview();
          }}
        />
      </label>
      <div class="row">
        <span class="hint inline">Custom: {settings.value.customSoundName ?? 'none'}</span>
        <button class="secondary" onclick={() => soundInput?.click()}>{settings.value.customSoundName ? 'Change file' : 'Choose file'}</button>
        {#if settings.value.customSoundName}
          <button class="secondary" onclick={() => void removeCustomSound()}>Remove</button>
        {/if}
        <input bind:this={soundInput} type="file" accept="audio/*" hidden onchange={(e) => void onSoundFile(e)} />
      </div>
      <p class="hint">Plays when someone messages you, unless the chat is muted or you're already looking at it.</p>
    </section>

    <section>
      <h3>Window</h3>
      <label class="row">
        <input type="checkbox" checked={settings.value.closeToTray} onchange={(e) => void settings.update({ closeToTray: e.currentTarget.checked })} />
        Close to tray
      </label>
      <p class="hint">Closing the window keeps IGchat running in the system tray. Quit from the tray icon's menu.</p>
    </section>

    <section>
      <h3>Account</h3>
      <button class="secondary" onclick={() => void call('auth:login').catch(() => ui.toast("Couldn't open Instagram"))}>Open the Instagram window</button>
      <button class="secondary" onclick={() => void logOut()}>Log out of Instagram</button>
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
  .hint {
    margin: 0 0 10px;
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .quick-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .quick-slot {
    position: relative;
  }
  .quick-emoji,
  .quick-add {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: var(--bg-sidebar);
    font-size: 1.3rem;
  }
  .quick-add {
    color: var(--text-muted);
  }
  .quick-emoji:hover,
  .quick-add:hover {
    background: var(--bg-hover);
  }
  .quick-remove {
    position: absolute;
    top: -6px;
    right: -6px;
    display: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--bg-elevated);
    color: var(--text-muted);
    font-size: 0.65rem;
  }
  .quick-slot:hover .quick-remove,
  .quick-remove:focus-visible {
    display: block;
  }
  .quick-picker {
    margin-top: 10px;
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
  .hint.inline {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .secondary:disabled {
    opacity: 0.5;
  }
  .color {
    width: 64px;
    height: 32px;
    border: none;
    background: none;
  }
</style>
