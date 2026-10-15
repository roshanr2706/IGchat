<script lang="ts">
  type Props = {
    side: 'left' | 'right';
    width: number;
    min: number;
    max: number;
    onlive: (width: number) => void;
    oncommit: (width: number) => void;
  };
  let { side, width, min, max, onlive, oncommit }: Props = $props();

  let dragging = $state(false);
  let startX = 0;
  let startWidth = 0;

  function compute(e: PointerEvent): number {
    const dx = e.clientX - startX;
    const next = side === 'left' ? startWidth + dx : startWidth - dx;
    return Math.min(max, Math.max(min, Math.round(next)));
  }

  function down(e: PointerEvent): void {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startWidth = width;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent): void {
    if (dragging) onlive(compute(e));
  }

  function up(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    oncommit(compute(e));
  }
</script>

<div
  class="handle {side}"
  class:dragging
  role="separator"
  aria-orientation="vertical"
  aria-valuenow={width}
  aria-valuemin={min}
  aria-valuemax={max}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
></div>

<style>
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    z-index: 5;
    cursor: col-resize;
    transition: background-color 0.15s;
  }
  .handle.left {
    right: -3px;
  }
  .handle.right {
    left: -3px;
  }
  .handle:hover,
  .handle.dragging {
    background: var(--accent);
  }
</style>
