# Gotchas

Running log of mistakes and the rules that prevent repeating them.

## firebase predeploy hooks: don't use `npm run` when `firebase` is the standalone (firepit) binary

**Date:** 2026-06-26

**What happened:** Phase 6b set the functions predeploy hook to the firebase-init
default `npm --prefix "$RESOURCE_DIR" run lint`. `npm run lint` passed in a normal
shell (node 22, real npm), so it looked verified — but `firebase deploy` failed:

    npm ERR! Cannot read properties of undefined (reading 'stdin')
      at promiseSpawnUid (.../@npmcli/promise-spawn/lib/index.js:70)
      at RunScript.run (.../npm/lib/commands/run-script.js:126)

**Root cause:** `firebase` here is the mise-installed standalone binary ("firepit",
v15.x), which bundles its OWN node@20 + npm@8.19.4 and hijacks `npm` when running
predeploy hooks. That ancient bundled npm crashes in `@npmcli/promise-spawn` while
setting up the `npm run` child process — before the script (eslint) ever runs. The
user's real npm is never used, so verifying with `npm run lint` in a normal shell
cannot catch it.

**Fix:** invoke the tool binary directly, bypassing `npm run`:
`cd "$RESOURCE_DIR" && ./node_modules/.bin/eslint .`

**Rules:**
- In firebase predeploy/postdeploy hooks, prefer direct binaries
  (`./node_modules/.bin/<tool>`) over `npm run <script>` whenever `firebase` may be
  the standalone firepit binary. firepit's bundled npm is broken for `npm run`.
- Verify deploy-tooling in its ACTUAL execution context, not a convenient proxy. A
  hook that runs inside firepit must be reasoned about (or tested) under firepit,
  not just in an interactive shell.
