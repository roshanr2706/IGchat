<script lang="ts">
  import type { Bridge } from '../../shared/ipc';

  const bridge = (window as unknown as { ig: Bridge }).ig;
  let status = $state('loading…');

  bridge.invoke('inbox:get').then((res) => {
    status = res.ok ? `${res.value.items.length} threads loaded · theme "${bridge.initialSettings.themeId}"` : `error: ${res.message}`;
  });
</script>

<p>{status}</p>
