/*
 * Lets `node --test` load this project's `src/**` TypeScript directly.
 *
 * Node strips types from a `.ts` file without help, but it resolves relative
 * specifiers the way ESM does -- the extension is mandatory. The source here
 * is written for Vite, which does not require one, so
 * `import { packIco } from './icoWriter'` is unresolvable to Node as written.
 *
 * Rather than rewrite every import in `src/` to suit the test runner, this
 * hook retries a failed relative resolution with `.ts` appended. It is
 * registered with `--import`, so it applies to the test process and to
 * nothing else; the production build never sees it.
 *
 * The alternative was a build step emitting JavaScript into a temp directory,
 * which would mean the tests assert against a transformed copy rather than
 * the file the reviewer reads. This way the thing under test is the file in
 * `src/`.
 *
 * `registerHooks` rather than the older `register`: the latter is deprecated
 * as of Node 26 and warns on every run.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.(ts|mts|js|mjs|cjs|json|svelte|css)$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        /* fall through, so the caller sees the error for the specifier it wrote */
      }
    }
    return nextResolve(specifier, context);
  },
});
