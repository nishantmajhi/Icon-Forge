<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    onDismiss: () => void;
  }

  let { onDismiss }: Props = $props();
</script>

<p class="file-error">
  <Icon name="warning" size={15} strokeWidth={1.8} />
  <span>
    That file isn't a PNG. Icon Forge only casts from PNG source images right now &mdash; convert
    it and drop it back in. <button onclick={onDismiss}>dismiss</button>
  </span>
</p>
