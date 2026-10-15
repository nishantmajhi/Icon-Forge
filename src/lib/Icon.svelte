<script lang="ts">
  import { ICONS, type IconName } from './icons';

  interface Props {
    name: IconName;
    size?: number;
    strokeWidth?: number;
    class?: string;
  }

  let { name, size = 16, strokeWidth = 1.8, class: className = '' }: Props = $props();

  const def = $derived(ICONS[name]);
</script>

<svg
  viewBox={def.viewBox}
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  aria-hidden="true"
>
  {#each def.paths ?? [] as d}
    <path {d} />
  {/each}
  {#each def.circles ?? [] as c}
    {#if c.filled}
      <circle cx={c.cx} cy={c.cy} r={c.r} fill="currentColor" stroke="none" />
    {:else}
      <circle cx={c.cx} cy={c.cy} r={c.r} />
    {/if}
  {/each}
  {#each def.rects ?? [] as r}
    <rect x={r.x} y={r.y} width={r.width} height={r.height} rx={r.rx ?? 0} />
  {/each}
</svg>
