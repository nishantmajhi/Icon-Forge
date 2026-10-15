<script lang="ts">
  import { PRESETS, PRESETS_BY_CATEGORY, CATEGORY_LABELS, type Preset } from '../presets';
  import Icon from './Icon.svelte';

  interface Props {
    selected: Set<string>;
    onToggle: (id: string) => void;
    onToggleCategory: (category: string, on: boolean) => void;
    onSelectAll: (on: boolean) => void;
  }

  let { selected, onToggle, onToggleCategory, onSelectAll }: Props = $props();

  let query = $state('');
  let collapsed = $state(new Set<string>());

  const filtered = $derived.by(() => {
    if (!query.trim()) return PRESETS_BY_CATEGORY;
    const q = query.toLowerCase();
    const out: Record<string, Preset[]> = {};
    for (const [cat, presets] of Object.entries(PRESETS_BY_CATEGORY)) {
      const matches = presets.filter((p) => p.label.toLowerCase().includes(q));
      if (matches.length) out[cat] = matches;
    }
    return out;
  });

  function toggleCollapsed(category: string) {
    const next = new Set(collapsed);
    next.has(category) ? next.delete(category) : next.add(category);
    collapsed = next;
  }
</script>

<div class="preset-panel">
  <p class="sidebar-heading">platforms</p>

  <div class="preset-search-row">
    <Icon name="search" size={13} strokeWidth={1.8} />
    <input class="preset-search" placeholder="search platforms…" bind:value={query} />
  </div>

  <div class="preset-quick-actions">
    <button onclick={() => onSelectAll(true)}>select all</button>
    <button onclick={() => onSelectAll(false)}>clear</button>
  </div>

  {#each Object.entries(filtered) as [category, presets]}
    {@const isCollapsed = collapsed.has(category)}
    {@const allOn = presets.every((p) => selected.has(p.id))}
    <div class="preset-group">
      <div class="preset-group__header">
        <button class="preset-group__toggle" onclick={() => toggleCollapsed(category)}>
          <span class="chevron {isCollapsed ? '' : 'chevron--open'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </span>
          <span class="cat-dot"></span>
          {CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]}
        </button>
        <label class="preset-group__all">
          <input
            type="checkbox"
            checked={allOn}
            onchange={(e) => onToggleCategory(category, (e.target as HTMLInputElement).checked)}
          />
          all
        </label>
      </div>

      {#if !isCollapsed}
        <div class="preset-group__list">
          {#each presets as p}
            <label class="preset-row">
              <input type="checkbox" checked={selected.has(p.id)} onchange={() => onToggle(p.id)} />
              {p.label}
            </label>
          {/each}
        </div>
      {/if}
    </div>
  {/each}

  {#if Object.keys(filtered).length === 0}
    <p class="preset-empty">no presets match &ldquo;{query}&rdquo;</p>
  {/if}

  <p class="preset-count"><strong>{selected.size}</strong> of {PRESETS.length} presets selected</p>
</div>
