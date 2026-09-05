# Agent loops — cheap-model protocol for visual fixes

Three self-contained tasks live beside this file. Each is written so a small or local model
(Hermes goal-mode worker, Codex, anything) can run it **without you watching and without
burning frontier-model credits**. The protocol is the same for every task:

## The loop

```
repeat (max N = 8 iterations, hard stop):
  1. READ  the task file top to bottom. Do not read other docs unless the task names them.
  2. DIAG  (first iteration only) run `node tools/visual-check.mjs --tag before` and look at
           /tmp/visual-check/before-*.png. Write 3 lines in NOTES.md: what you see, what you
           think the cause is, which single file you will change first.
  3. EDIT  the smallest change that could satisfy ONE unmet acceptance criterion.
           Never touch a file the task doesn't list. Never add a dependency. Never rewrite a
           file — patch it.
  4. GATE  `npx tsc -b && npx vitest run --reporter=dot` must pass. If it fails, fix or revert
           your last edit before doing anything else.
  5. CHECK `node tools/visual-check.mjs --tag iterN` then compare iterN-*.png against the
           acceptance criteria. Record PASS/FAIL per criterion in NOTES.md.
  6. STOP  when every criterion is PASS, or when N is exhausted, or when the same criterion
           has failed 3 iterations in a row (you are stuck — stop and write why).
finish:   `git diff --stat`, then append a "## Result" section to NOTES.md with the criteria
           table, the before/after PNG paths, and anything you could not fix.
```

Rules that keep the loop cheap:

- One criterion per iteration. Do not "also tidy up".
- No speculative refactors. If a fix needs more than ~80 changed lines, stop and write a plan
  in NOTES.md instead — a human decides.
- Screenshots are evidence, not vibes. A criterion is PASS only if the PNG shows it.
- Every iteration must end with a green gate. A red gate at iteration end is a failed run.

## Judge (optional, for Hermes goal-mode)

If the runner supports a judge model, give it `JUDGE.md` from the task folder plus the latest
PNGs. The judge answers only `DONE` / `CONTINUE: <one unmet criterion>`. Cap judge turns at
the same N.

## Files

- `tools/visual-check.mjs` — builds, serves the client, captures the public camp hub at
  1440×900 (standard and `?render=degraded`) and 390×844, writes PNGs to /tmp/visual-check.
  Run with `--no-build` to reuse the last build.
- `01-shadows.md`, `02-building-scale.md`, `03-horizon-backdrop.md` — the tasks.
- Each task's NOTES.md is created by the worker in the same folder.

## Order

Run 02 (scale) before 03 (backdrop): the horizon treeline is sized relative to buildings.
01 (shadows) is independent.

## GPU note

Run the harness on a machine with a real GPU (the M3 Max: `npm i --no-save playwright &&
npx playwright install chromium`, then run without `CHROMIUM_PATH`). Headless SwiftShader in a
cloud sandbox renders geometry fine but drops shadow maps, so task 01 can only be graded
locally. Tasks 02 and 03 grade fine anywhere.
