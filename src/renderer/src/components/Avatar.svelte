<script lang="ts">
  type Props = { urls: string[]; name: string; size?: number };
  let { urls, name, size = 32 }: Props = $props();

  const initials = $derived(
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?'
  );
  const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
  const small = $derived(Math.round(size * 0.7));
</script>

{#if urls.length >= 2}
  <span class="stack" style:width="{size}px" style:height="{size}px">
    <img class="a" src={urls[0]} alt="" width={small} height={small} />
    <img class="b" src={urls[1]} alt="" width={small} height={small} />
  </span>
{:else if urls[0]}
  <img class="single" src={urls[0]} alt="" width={size} height={size} />
{:else}
  <span
    class="initials"
    style:width="{size}px"
    style:height="{size}px"
    style:font-size="{Math.round(size * 0.4)}px"
    style:background="hsl({hue} 45% 45%)">{initials}</span
  >
{/if}

<style>
  .single,
  .initials {
    flex: none;
    border-radius: 50%;
    object-fit: cover;
  }
  .initials {
    display: inline-grid;
    place-items: center;
    color: #fff;
    font-weight: 600;
    user-select: none;
  }
  .stack {
    position: relative;
    display: inline-block;
    flex: none;
  }
  .stack img {
    position: absolute;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid var(--bg-sidebar);
  }
  .stack .a {
    top: 0;
    left: 0;
  }
  .stack .b {
    right: 0;
    bottom: 0;
  }
</style>
