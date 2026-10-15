<script lang="ts">
  import type { PreviewItem } from './pipeline';
  import { PRESETS } from '../presets';
  import Icon from './Icon.svelte';

  interface Props {
    items: PreviewItem[];
    loading: boolean;
    hasImage: boolean;
  }

  let { items, loading, hasImage }: Props = $props();

  const groups = $derived.by(() => {
    const byPreset = new Map<string, PreviewItem[]>();
    for (const item of items) {
      const arr = byPreset.get(item.presetId) ?? [];
      arr.push(item);
      byPreset.set(item.presetId, arr);
    }
    return [...byPreset.entries()];
  });
</script>

{#if loading}
  <div class="output-empty">
    <Icon name="empty" size={26} strokeWidth={1.5} />
    <strong>forging previews…</strong>
  </div>
{:else if items.length === 0}
  <div class="output-empty">
    <Icon name="empty" size={26} strokeWidth={1.5} />
    <strong>{hasImage ? 'no platforms selected' : 'nothing cast yet'}</strong>
    <span>
      {hasImage
        ? 'pick a platform from the sidebar to see icons here'
        : 'drop a source image above, then pick platforms to generate icons'}
    </span>
  </div>
{:else}
  <div class="output-groups">
    {#each groups as [presetId, previews]}
      {@const preset = PRESETS.find((p) => p.id === presetId)}
      <div class="output-group">
        <p class="output-group__label">
          <span class="tag"></span>
          {preset?.label ?? presetId}
          <span class="output-group__count"
            >&middot; {previews.length} file{previews.length === 1 ? '' : 's'}</span
          >
        </p>
        <div class="output-grid">
          {#each previews as item}
            <div class="medallion">
              <div class="medallion__face">
                <img src={item.blobUrl} alt="" />
              </div>
              <p class="medallion__name">{item.filename.split('/').pop()}</p>
              <span class="medallion__size">{item.size}px</span>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}
