<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    onFile: (file: File) => void;
    onInvalidFile: () => void;
    onClear: () => void;
    previewUrl: string | null;
    fileName: string | null;
    dims: { width: number; height: number } | null;
  }

  let { onFile, onInvalidFile, onClear, previewUrl, fileName, dims }: Props = $props();

  let inputEl: HTMLInputElement;
  let dragOver = $state(false);
  let fileSize = $state<number | null>(null);

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (file.type !== 'image/png') {
      onInvalidFile();
      return;
    }
    fileSize = file.size;
    onFile(file);
  }
</script>

<div
  class="crucible {dragOver ? 'crucible--active' : ''}"
  onclick={() => inputEl?.click()}
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={(e) => {
    e.preventDefault();
    dragOver = false;
    handleFiles(e.dataTransfer?.files ?? null);
  }}
  role="button"
  tabindex={0}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') inputEl?.click();
  }}
>
  <input
    bind:this={inputEl}
    type="file"
    accept="image/png"
    hidden
    onchange={(e) => handleFiles((e.target as HTMLInputElement).files)}
  />
  {#if previewUrl}
    <div class="crucible__preview">
      <div class="crucible__thumb">
        <img src={previewUrl} alt="" />
        <span class="crucible__thumb-check" title="source loaded">
          <Icon name="upload" size={11} strokeWidth={2.2} />
        </span>
      </div>
      <div class="crucible__info">
        <p class="crucible__filename">{fileName}</p>
        <div class="crucible__chips">
          {#if dims}
            <span class="chip">{dims.width}&times;{dims.height}px</span>
          {/if}
          {#if fileSize != null}
            <span class="chip">{formatBytes(fileSize)}</span>
          {/if}
          <span class="chip chip--accent">PNG</span>
        </div>
      </div>
      <div class="crucible__actions">
        <button
          class="crucible__replace"
          title="replace image"
          onclick={(e) => {
            e.stopPropagation();
            inputEl?.click();
          }}
        >
          <Icon name="upload" size={13} strokeWidth={2} />
          replace
        </button>
        <button
          class="crucible__clear"
          title="remove image"
          onclick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        >
          <Icon name="x" size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  {:else}
    <div class="crucible__glyph">
      <Icon name="upload" size={18} strokeWidth={1.6} />
    </div>
    <p class="crucible__title">Drop a PNG to cast</p>
    <p class="crucible__hint">or <span class="crucible__browse">click to browse</span></p>
    <p class="crucible__hint crucible__hint--sub">
      square, <code>1024&times;1024px</code> or larger works best
    </p>
  {/if}
</div>
