import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/*
 * Present so that `npm run check` works.
 *
 * `svelte-check` needs to find the Svelte configuration in order to know how to
 * preprocess a component before type-checking it. With no `svelte.config.js` it
 * falls back to reading `vite.config.ts`, fails to find the plugin's options
 * there, and reports one error per component reading "No Svelte configuration
 * found in vite config" -- which looks like a broken build config and is
 * actually a missing file. The script therefore type-checked nothing at all and
 * exited non-zero, from the first commit.
 *
 * `vitePreprocess` is the same preprocessor the Vite plugin applies during a
 * build, so what is checked here matches what is compiled.
 */
export default {
  preprocess: vitePreprocess(),
};
