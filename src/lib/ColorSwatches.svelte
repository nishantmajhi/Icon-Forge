<script lang="ts">
  interface Props {
    colors: string[];
  }

  let { colors }: Props = $props();
  let copied = $state<string | null>(null);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  function copy(hex: string) {
    navigator.clipboard.writeText(hex);
    copied = hex;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      if (copied === hex) copied = null;
    }, 1200);
  }
</script>

{#if colors.length > 0}
  <div class="colors">
    <p class="sidebar-heading">extracted palette</p>
    <div class="colors__row">
      {#each colors as hex}
        <button class="swatch" onclick={() => copy(hex)} title="copy hex">
          <span class="swatch__chip" style="background: {hex}"></span>
          <span class="swatch__hex {copied === hex ? 'swatch__hex--copied' : ''}">
            {copied === hex ? 'copied' : hex}
          </span>
        </button>
      {/each}
    </div>
  </div>
{/if}
