<script lang="ts">
  import DropZone from './lib/DropZone.svelte';
  import FileTypeError from './lib/FileTypeError.svelte';
  import PresetPanel from './lib/PresetPanel.svelte';
  import OutputGrid from './lib/OutputGrid.svelte';
  import ColorSwatches from './lib/ColorSwatches.svelte';
  import Icon from './lib/Icon.svelte';
  import { PRESETS, PRESETS_BY_CATEGORY } from './presets';
  import { loadImage, sourceToCanvas, resizeToCanvas } from './lib/resize';
  import { checkResolutionWarning, checkSourceLimits, largestRequestedSize } from './lib/sourceChecks';
  import { extractPalette } from './lib/colorExtract';
  import { generatePreviews, exportZip, revokePreviews, type PreviewItem } from './lib/pipeline';

  let file = $state<File | null>(null);
  let image = $state<HTMLImageElement | null>(null);
  let previewUrl = $state<string | null>(null);
  let dims = $state<{ width: number; height: number } | null>(null);
  let selected = $state(new Set<string>(['browser-extension', 'vscode-extension']));
  let items = $state<PreviewItem[]>([]);
  let colors = $state<string[]>([]);
  let loading = $state(false);
  let exporting = $state(false);
  let warning = $state<string | null>(null);
  let fileError = $state(false);
  let drawerOpen = $state(false);

  const selectedPresets = $derived(PRESETS.filter((p) => selected.has(p.id)));

  /*
   * The previews currently on screen, held outside `$state` on purpose.
   *
   * Every preview is an object URL, and an object URL keeps its blob alive until
   * something revokes it. Replacing `items` is therefore not enough -- the
   * previous run's blobs stay in memory, and previews are regenerated on every
   * change of selection, so toggling platforms leaks a PNG per distinct size
   * each time.
   *
   * It is a plain variable rather than `$state` because the effect below needs
   * to read it, and a tracked read inside that effect would make the effect
   * depend on something it also writes.
   */
  let onScreen: PreviewItem[] = [];

  function showPreviews(next: PreviewItem[]) {
    revokePreviews(onScreen);
    onScreen = next;
    items = next;
  }

  async function handleFile(f: File) {
    fileError = false;
    warning = null;

    /*
     * The drop zone filters on the browser's reported MIME type, which on
     * Windows comes from the file extension -- so anything renamed to `.png`
     * gets through it and fails here instead. The original did not catch that:
     * `loadImage` rejected, the rejection went unhandled, and the page was left
     * showing a broken thumbnail for a file it had already accepted, with no way
     * back but a reload.
     */
    let img: HTMLImageElement;
    try {
      img = await loadImage(f);
    } catch {
      fileError = true;
      return;
    }

    const dimensions = { width: img.naturalWidth, height: img.naturalHeight };

    // Refuse anything large enough to take the tab down with it, before a
    // single canvas is allocated.
    const refusal = checkSourceLimits(dimensions);
    if (refusal) {
      warning = refusal;
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(f);
    file = f;
    image = img;
    dims = dimensions;
  }

  function handleClear() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    showPreviews([]);
    file = null;
    image = null;
    previewUrl = null;
    dims = null;
    colors = [];
    warning = null;
  }

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    selected = next;
  }

  function toggleCategory(category: string, on: boolean) {
    const next = new Set(selected);
    for (const p of PRESETS_BY_CATEGORY[category] ?? []) {
      on ? next.add(p.id) : next.delete(p.id);
    }
    selected = next;
  }

  function selectAll(on: boolean) {
    selected = on ? new Set(PRESETS.map((p) => p.id)) : new Set();
  }

  // regenerate previews whenever the source image or preset selection changes
  let regenToken = 0;
  $effect(() => {
    const currentImage = image;
    const currentPresets = selectedPresets;
    const token = ++regenToken;

    if (!currentImage || currentPresets.length === 0) {
      showPreviews([]);
      return;
    }
    loading = true;

    const dimensions = { width: currentImage.naturalWidth, height: currentImage.naturalHeight };
    warning = checkResolutionWarning(dimensions, largestRequestedSize(currentPresets));

    generatePreviews(currentImage, currentPresets).then((result) => {
      if (token === regenToken) {
        showPreviews(result);
        loading = false;
      } else {
        // A newer run has already landed, so this one's URLs are orphaned.
        revokePreviews(result);
      }
    });

    resizeToCanvas(sourceToCanvas(currentImage), 128).then((canvas) => {
      if (token === regenToken) colors = extractPalette(canvas, 5);
    });
  });

  async function handleExport() {
    if (!image) return;
    exporting = true;
    try {
      await exportZip(
        image,
        selectedPresets,
        colors,
        `${file?.name.replace(/\.png$/i, '') || 'icons'}.zip`,
      );
    } finally {
      exporting = false;
    }
  }
</script>

{#snippet sidebarContent()}
  <PresetPanel {selected} onToggle={toggle} onToggleCategory={toggleCategory} onSelectAll={selectAll} />
  <ColorSwatches {colors} />
{/snippet}

<div class="app">
  <header class="topbar">
    <div class="topbar__brand">
      <span class="topbar__mark">
        <Icon name="brand" size={15} strokeWidth={2} />
      </span>
      <span class="topbar__title">Icon Forge</span>
      <span class="topbar__tagline">cast one image into every icon size you need</span>
    </div>
    <button class="topbar__controls" onclick={() => (drawerOpen = true)}>
      platforms
      {#if selected.size > 0}
        <span class="topbar__badge">{selected.size}</span>
      {/if}
    </button>
  </header>

  <div class="layout">
    <main class="workspace">
      <div class="step-track">
        <span class="step-track__label {!image ? 'is-active' : ''}">
          <span class="step-track__dot"></span>source
        </span>
        <span class="step-track__pour {items.length > 0 ? 'step-track__pour--full' : ''}"></span>
        <span class="step-track__label {image ? 'is-active' : ''}">
          <span class="step-track__dot"></span>output
        </span>
      </div>

      <DropZone
        onFile={handleFile}
        onInvalidFile={() => (fileError = true)}
        onClear={handleClear}
        {previewUrl}
        fileName={file?.name ?? null}
        {dims}
      />

      {#if fileError}
        <FileTypeError onDismiss={() => (fileError = false)} />
      {/if}
      {#if warning}
        <p class="warning">
          <Icon name="warning" size={15} strokeWidth={1.8} />
          <span>{warning}</span>
        </p>
      {/if}

      <OutputGrid {items} {loading} hasImage={!!image} />

      {#if items.length > 0}
        <div class="export-summary">
          <span>
            <strong>{items.length}</strong> file{items.length === 1 ? '' : 's'} across
            <strong>{selectedPresets.length}</strong> platform{selectedPresets.length === 1 ? '' : 's'}
          </span>
          <span>packaged as .zip</span>
        </div>
      {/if}
    </main>

    <button
      class="export-fab {exporting ? 'export-fab--loading' : ''}"
      disabled={!image || items.length === 0 || exporting}
      title={!image
        ? 'drop a source image to enable export'
        : items.length === 0
          ? 'select at least one platform'
          : exporting
            ? 'building zip…'
            : 'Download ZIP'}
      onclick={handleExport}
    >
      <Icon name={exporting ? 'loader' : 'download'} size={20} strokeWidth={2} />
    </button>

    <aside class="sidebar sidebar--desktop">
      {@render sidebarContent()}
    </aside>
  </div>

  {#if drawerOpen}
    <div
      class="drawer-backdrop"
      role="button"
      tabindex={-1}
      onclick={() => (drawerOpen = false)}
      onkeydown={(e) => {
        if (e.key === 'Escape') drawerOpen = false;
      }}
    >
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <aside
        class="sidebar sidebar--drawer"
        aria-label="platforms and palette"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <div class="drawer-header">
          <span>platforms &amp; palette</span>
          <button onclick={() => (drawerOpen = false)}>
            <Icon name="x" size={12} strokeWidth={2} />
          </button>
        </div>
        {@render sidebarContent()}
      </aside>
    </div>
  {/if}
</div>
