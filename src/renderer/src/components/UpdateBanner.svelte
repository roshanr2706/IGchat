<script lang="ts">
  import { update } from '../stores/update.svelte';
</script>

{#if update.bannerVersion}
  <div class="banner" role="status">
    <span>IGchat {update.bannerVersion} is ready to install.</span>
    <button class="primary" onclick={() => update.install()}>Restart now</button>
    <button class="later" onclick={() => (update.dismissed = update.bannerVersion)}>Later</button>
  </div>
{/if}

<style>
  .banner {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 6px 12px;
    background: var(--accent);
    color: #fff;
    font-size: 0.85rem;
  }
  button {
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 0.8rem;
    color: inherit;
  }
  .primary {
    background: rgb(255 255 255 / 0.2);
    font-weight: 600;
  }
  .primary:hover {
    background: rgb(255 255 255 / 0.3);
  }
  .later:hover {
    text-decoration: underline;
  }
</style>
