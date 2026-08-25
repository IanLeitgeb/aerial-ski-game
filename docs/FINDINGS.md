# Findings from golden-trace harness construction

## BUG-001 — Crash ragdoll is completely broken (live, user-visible)

**Severity:** high — the crash animation never plays, and the HUD shows an error string.

**Discovered:** 2026-08-24, while building the golden-trace harness. Not a harness
artifact — reproduced structurally and behaviourally against unmodified `game.js`
at `0e05f72`.

### The defect

`game.js:375` deliberately stores gloves as wrapper objects, not meshes:

```js
meshes[n === 'lowerArmL' ? 'gloveL' : 'gloveR'] = { mesh: hand, halfH: seg.h * 0.5 };
```

That shape is correct for its intended consumer at `game.js:600-604`, which uses
`meshes.gloveL.mesh` and `.halfH`.

But the crash ragdoll at `game.js:4062` iterates **every** value in
`character.meshes` and treats each as a mesh:

```js
for (const name of Object.keys(character.meshes)) {
    const mesh = character.meshes[name];
    mesh.computeWorldMatrix(true);                    // ← throws on gloveL/gloveR
    worldPositions[name] = mesh.getAbsolutePosition().clone();
}
```

### Why it is invisible

The whole per-frame update is wrapped in one `try` spanning `game.js:3199-4401`:

```js
} catch(e) { hud.text = 'ERR: ' + e.message; console.error(e); } });
```

So on any crash the player sees `ERR: mesh.computeWorldMatrix is not a function`
in the HUD instead of a ragdoll. Worse, `crashActive = true` is set at
`game.js:4050` *before* the throwing loop, so the ragdoll is never retried on
subsequent frames — it fails permanently, silently, for that crash.

### Evidence

```
character.meshes.gloveL: keys=[mesh,halfH] | computeWorldMatrix=undefined
character.meshes.gloveR: keys=[mesh,halfH] | computeWorldMatrix=undefined
TypeError: mesh.computeWorldMatrix is not a function
    at game.js:4064:22
```

Reproduce: `node tests/golden/bug-ragdoll.js`

### Candidate fix (NOT applied)

Unwrap, or skip non-mesh entries, in both ragdoll passes:

```js
const entry = character.meshes[name];
const mesh  = entry && entry.mesh ? entry.mesh : entry;
if (!mesh || typeof mesh.computeWorldMatrix !== 'function') continue;
```

Note there is a **second** identical loop at `game.js:4069` ("Pass 2: detach and
launch each piece") which has the same defect and needs the same treatment.

### STATUS: FIXED (2026-08-24)

Fixed in this worktree at `game.js:4061`. Both passes now resolve a shared
`ragdollParts` list that unwraps `{ mesh, halfH }` entries and filters
non-meshes, so they cannot disagree. Gloves now ragdoll like every other part —
previously *nothing* did. Locked down by the `aerial-crash-ragdoll` trace.

### Why it was not fixed immediately

ADR-0005 requires golden traces to be captured **before** any behaviour change.
Fixing this first would change the very behaviour the traces are meant to lock
down; capturing traces first would enshrine the bug. This needs an explicit
decision — see "Open question" below.

**Open question for the author:** fix BUG-001 first and capture traces against
the fixed behaviour, or capture traces now (documenting that crash scenarios
record the broken path) and fix afterwards as a deliberate, separately-traced
change? Recommended: **fix first** — traces exist to preserve intended behaviour,
and no one intends this.

---

## NOTE-001 — `_getGameState()` is too narrow for trace capture

It exposes 12 fields and omits `flipAngle`, `vy`, `L_flip`, `pikeAmount` and all
per-joint pose data. The harness therefore captures **node transforms** as the
golden signal instead (430 nodes/frame): those are the true observable output,
they need no change to `game.js`, and preserving them is precisely the refactor
contract.

## NOTE-002 — Determinism confirmed

`babylon-stub.js` fixes `getDeltaTime()` at 16.667 ms. Two independent 60-frame
runs produced byte-identical snapshots, so traces are reproducible.
`performance.now()` and `Date` are pinned to 0 in the harness to keep it that way.

---

## NOTE-003 — Stub math was placeholder; traces would have tested nothing

`babylon-stub.js` ships `Quaternion.multiply()` and `Quaternion.RotationAxis()`
that both return a fresh identity. `game.js` calls `RotationAxis` 11× and
`multiply` 9× to compose the skier's flip/twist/spin orientation.

Captured against the unpatched stub, **every** `rotationQuaternion` would have
been `(0,0,0,1)` — traces that look stable while asserting nothing about the most
important physics path. `tests/golden/stub-extend.js` now implements real
vector/quaternion math following Babylon's exact conventions (including that
`Vector3.normalize()` mutates in place).

Guard: `node tests/golden/check-math.js` fails if quaternions collapse to
identity. Currently reports 138 distinct orientations across 138 airborne frames.

Note the base-class trap: the stub builds `node.position` from `Vec3`, not
`Vector3`, so prototype patches must target `Object.getPrototypeOf(Vector3.prototype)`.

## NOTE-004 — Trace determinism required seeding Math.random

The ragdoll calls `Math.random()` ~9× per body part for tumble velocities. The
harness replaces `Math.random` inside the vm context with a seeded mulberry32
(per-scenario `seed`), leaving the rest of `Math` untouched. `performance.now()`
and `Date` are pinned to 0 for the same reason.

## NOTE-005 — Delta encoding cut traces 35×

The scene holds ~430 nodes but only the athlete and a few props move. Full
capture cost 5,390 KB per scenario (~95 MB total). Storing frame 0 in full and
thereafter only nodes whose serialisation changed gives 152 KB per scenario,
2.6 MB total, with no loss of fidelity.

## OPEN-001 — CLOSED (2026-08-24)

`check-distinct.js` now reports **27 distinct behaviours across 30 scenarios**
(was 15/21). Root cause: the first scenario set guessed the input map. Reading it
out of `game.js` corrected four mistakes, each of which silently produced
identical traces:

| Assumed | Actual | Reference |
|---|---|---|
| ArrowDown = tuck | **Space** = tuck; ArrowDown airborne sets `powerWrapDown` | `:2679`, `:2692` |
| KeyX = pike | **ShiftLeft** = pike; KeyX is **trampoline-only** | `:2683`, `:2767` |
| KeyF = frontflip | KeyF is **pool-dive-only** — a no-op in aerial | `:2770` |
| Single arrow = twist | A single arrow is only a wind-up. The twist fires on the **second** arrow while the first is held | `:2775`, `:2788` |

Two harness gaps also had to be fixed:

- **`localStorage` was never seeded.** `pollGamepad()` only runs when
  `_lsGet('setting_gamepad') === '1'` (`:3247`), so *every* gamepad scenario was
  silently a no-input run. This is why the actively-tuned spin code had no
  coverage at all.
- **Timers were no-ops.** The twist arms
  `secondKeyTimer = setTimeout(enterDoubleMode, DOUBLE_HOLD_MS)` (`:2785`), so
  double-twist mode could never fire. Replaced with a virtual timer queue on a
  clock advanced 16.667 ms per rendered frame — deterministic, and the
  timer-driven path now executes (`aerial-twist-double-mode`).
- **Scenario `seed` was not being passed through** `createSim`, so every
  scenario silently used seed 1.

Now covered and differentiating: power 25/75/full + floor, tuck (3 durations),
pike, off-axis KeyA vs KeyD, twist left/right/double-mode, crash ragdoll,
gamepad arm-drop left/right/counter-spin, trampoline basic/tuck/pike/KeyX,
pool-dive basic/tuck/KeyF.

## OPEN-002 — Three remaining duplicates look like genuine behaviour, not scenario bugs

| Pair | Assessment |
|---|---|
| `gamepad-both-arms` ≡ `gamepad-power-floor` | **Probably correct.** A symmetric drop leaves `armAsym` under the 0.04 deadband (`:4190`), so no spin is induced; the gamepad branch at `:4268` appears to affect spin rather than arm pose, so with no keyboard input the pose is unchanged too. Worth a design look — dropping both arms having *zero* observable effect may be unintended. |
| `twist-left` ≡ `twist-rightspin-setting` | **Probably correct.** `setting_rightspin` is consulted only in the `downHalfTwistFired` branch (`:2780`) and at `:3297`; this input sequence reaches neither. A different scenario is needed to cover the setting. |
| `pool-dive-basic` ≡ `pool-dive-pike` | **Likely a scenario timing bug.** Pike requires `!state.grounded` (`:2683`); the dive window is short, so frame 250 may fall outside it. Needs the airborne window measured rather than guessed. |

These are recorded rather than fixed: the traces are valid, and the first two may
be documenting real design questions worth raising separately.

---

## BUG-002 — `tests/test.html` D4 has never passed, in any environment

**Severity:** medium — a regression test that silently tests nothing, and would
fail identically if opened in a browser.

`tests/test.html:422` "flipAngle advances while skier is airborne" reads:

```js
const flipBefore = s.flipAngle;                       // undefined
const flipAfter  = window._getGameState().flipAngle;  // undefined
const delta      = Math.abs(flipAfter - flipBefore);  // NaN
assert(delta > 0.01, `... ${flipBefore.toFixed(4)} ...`);
```

But `window._getGameState()` (game.js:1280) returns exactly:

```
grounded, crashed, stopped, posZ, airTime, tuckAmount, spinAngle,
trickName, readyState, KICKER_END_Z, FLAT_Z, flipPower
```

There is **no `flipAngle`**. So `delta` is `NaN`, `NaN > 0.01` is false, the
assertion fails — and the failure message then calls `.toFixed()` on `undefined`,
masking the real cause with a `TypeError`.

This is not a headless artefact. The same code path runs in a browser and fails
the same way. It was invisible only because nobody could easily run the suite.

### Discovered by
`node tests/browser-suite.js` — the headless runner for `test.html`. Finding a
real pre-existing defect on its first full run is a reasonable argument that the
runner is faithful.

### Options (NOT yet actioned — needs a decision)

1. **Add `flipAngle` to `_getGameState()`.** Makes the test meaningful and fixes
   the gap noted in NOTE-001: the state accessor omits the single most important
   physics value. **Cost:** the golden traces capture `_getGameState()` output, so
   adding a field changes every trace and all 30 must be re-captured.
2. **Rewrite D4** to measure rotation via the `skierRoot` quaternion instead,
   leaving `game.js` and the traces untouched.
3. **Leave it** and mark the test skipped with a pointer to this entry.

Recommendation: **option 2**. It restores the test's intent without touching
production code or invalidating the traces, and rotation is observable through
the node transforms the traces already record.

---

## REVIEW-001 — Adversarial review findings (Opus, 2026-08-24)

An adversarial correctness review was run against the claim *"lerp was extracted
and wired in with zero behaviour change; proof: 30/30 traces."* It produced four
findings. All were verified independently before acting.

### R1 — The 30/30 proof does not cover BUG-001 (CONFIRMED, by design, now measured)

`game.js` carries **two** changes, not one: the lerp wiring and the BUG-001
ragdoll fix. The traces were captured *after* the ragdoll fix (with the author's
explicit approval), so they encode post-fix behaviour as the baseline and
**cannot validate the fix itself**. The reasoning is circular for that change.

Measured blast radius — reverting ONLY the ragdoll hunk, keeping the lerp wiring:

```
17/30 scenarios match the golden traces      (13 scenarios change)
```

Reverting only the lerp wiring instead gives **30/30**, confirming the extraction
itself is behaviour-neutral and the 13-scenario delta belongs entirely to BUG-001.

**What the BUG-001 fix actually rests on** — stated plainly, since the traces do
not support it:
- the structural proof that `meshes.gloveL` is `{ mesh, halfH }` (`game.js:375`)
  and cannot answer `computeWorldMatrix`,
- the reproducer `tests/golden/bug-ragdoll.js`, which showed the `TypeError`
  before the fix and no error after,
- the fact that the pre-fix behaviour was *an exception swallowed by a
  frame-level try/catch*, i.e. the ragdoll never ran at all.

Those 13 scenarios changing is the fix **working** — the ragdoll now executes
where previously it aborted. But that is an argument from reading, not from the
trace gate, and it should not be presented as the latter.

### R2 — Two scripts broke and nothing caught it (CONFIRMED, FIXED)

`tests/golden/bug-ragdoll.js` and `tests/golden/debug-mesh.js` boot `game.js`
directly and were not updated when it gained a parse-time dependency on
`AerialEngine.math`. Both threw `ReferenceError: AerialEngine is not defined`.

Worst part: `bug-ragdoll.js` is the reproducer this very document tells readers
to run, and `run-all.sh` executed neither, so the gate stayed green.

Fixed by centralising the boot sequence in `harness.loadGameInto()` — four call
sites previously duplicated it — and adding `tests/unit/scripts.test.js`, which
*executes* every diagnostic script and asserts it runs clean. Behavioural, so it
catches any breakage rather than only this class.

### R3 — Cache-buster not bumped (CONFIRMED, FIXED)

`index.html` still requested `game.js?v=3` after a user-visible behaviour change,
so returning browsers would keep the cached pre-fix file. The new engine entry
also had no `?v=` at all. Both now `?v=4`.

### R4 — Sibling engine modules are not browser-safe (CONFIRMED, GUARDED)

Only `math.js` has the dual-mode wrapper. `inertia.js` calls bare `require()` and
`pose.js` ends in `module.exports`; adding either to `ENGINE_MODULES` would throw
`require is not defined` in a browser while every headless test still passed.

Added a test asserting every browser-loaded module is free of bare `require` and
attaches to `AerialEngine`. Verified it has teeth: temporarily listing
`inertia.js` fails on two independent axes.

**Standing rule for the remaining extraction:** a module gets the dual-mode
wrapper at the moment it is wired, not before, and never enters `ENGINE_MODULES`
without it.

---

## REVIEW-002 — Adversarial TEST-QUALITY review (Opus, 2026-08-24)

A second adversarial review attacked the test suite itself, hunting for tests
that pass while proving nothing. It found the golden gate — the thing the whole
extraction safety argument rested on — to be substantially hollow. Every finding
below was reproduced before acting.

### The core problem

`game.js:3204-4417` wraps the ENTIRE per-frame update in one
`try { … } catch(e) { hud.text = 'ERR: ' + e.message; console.error(e); }`.
Exceptions never escape, so `BABYLON._lastError` never gets set, so every error
check downstream in the harness was **dead code**.

Demonstrated consequences, all verified:

| Mutation | Old gate | New gate |
|---|---|---|
| Unconditional `throw` in the frame loop, every frame | 30/30 PASS | caught |
| `character.root.setEnabled(false)` every frame (athlete invisible) | 30/30 PASS | caught |
| Root orientation slammed to identity on 4 of every 5 frames | 30/30 PASS | caught |
| Head reparented onto the right shin | 17/30 | caught |
| Per-frame state corruption in the pool world | 30/30 PASS | caught |

Worse, the gate was **already green while four pool-dive scenarios threw on every
single frame** — 3,600 stack traces per run — because the stub lacked
`getVerticesData` (`game.js:4382`) and game.js swallowed it. Those traces had
enshrined the broken path as correct.

### Fixes applied

1. **Swallowed-error capture** (`browser-env.js`). `console.error` is intercepted;
   `run-scenario.js` aborts the scenario if anything lands there. This alone
   closes the throw-invisibility class and immediately surfaced the pool failures.
2. **`getVerticesData`/`setVerticesData` on the stub** — on the *prototype*, since
   `waterMesh` is `new BABYLON.Mesh(...)` (`game.js:1809`), not a MeshBuilder
   product, so the decorate() wrapper never saw it.
3. **World positions + parent identity in traces** (`harness.js`). Local
   transforms alone do not describe what the player sees; the reparenting
   mutation proved it.
4. **`_enabled` captured** — previously a comment claimed it was, and it was not.
5. **Full-rate integrity digest** (`harness.frameDigest`). Traces sample every 5th
   frame; the digest folds athlete state on EVERY frame and is recorded at each
   keyframe, so transients between samples are constrained.
6. **`eulerToQuat` corrected** (`stub-extend.js`). It did not match Babylon
   despite a comment claiming it did — z and w cross-terms had flipped signs.
   Latent while only `[skierRoot(quaternion) → limb]` chains were read, but now
   that traces capture world positions it is load-bearing.
7. **`run-all.sh` no longer lies.** `check-distinct.js` was run with
   `| head -2 || true` and its exit code discarded — it exits 1, and the script
   still printed ALL GREEN. Coverage is now a hard gate.
8. **`mutation-check.sh`** — the gate is now itself tested. It injects the five
   mutations above into a scratch copy and asserts the gate rejects each one.
   Wired into `run-all.sh`. A gate that passes everything manufactures
   confidence; this asserts it still has teeth.
9. **`check-distinct` widened** to compare full frames rather than only
   `skierRoot`. The narrow signature was under-reporting: 27/30 → 28/30, with
   the gamepad pair resolving once limb pose was included.

### Known duplicates, now suppressed WITH REASONS (not ignored)

- `aerial-twist-left` ≡ `aerial-twist-rightspin-setting` — `setting_rightspin` is
  only read in the `downHalfTwistFired` branch (`game.js:2780`), which this input
  never reaches. **The setting remains untested.**
- `pool-dive-basic` ≡ `pool-dive-pike` — pike requires `!state.grounded`
  (`game.js:2683`) and the dive's airborne window misses the scripted frame.
  **Pike in the pool world remains untested.**

An unexplained duplicate still fails the gate.

### Still open from this review

- **`tests/test.html` Section B (5 of 36 assertions) is tautological.** Every test
  writes the formula out as a literal and asserts about its own literal;
  `game.js` is never called. `test.html:274` is literally
  `assertClose(1.0, 1.0, 1e-9, …)`. Re-introducing the exact bug the section is
  named after leaves all five reporting `ok`. **Not yet fixed.**
- **`aerial-idle` records zero node deltas** across 240 frames — it asserts only
  boot state, which every other trace's frame-0 baseline already covers.
- **`fidelity.test.js` load-order guard is one-directional** — it asserts
  `ENGINE_MODULES ⊆ index.html` but never the reverse, and uses substring
  matching, so a mention in a comment satisfies it.
- **`EPSILON = 1e-6` vs 6-dp rounding** — a one-quantum difference is accepted
  ~41% of the time and rejected ~59%. Arbitrary rather than slack. Consider exact
  comparison on rounded values, or `5e-7`.
- **Three of four engine modules are not loaded by the game.** `pose.js`,
  `inertia.js` and `body-model.js` are reachable only from `node --test`, so the
  tests around them currently guard duplicates the shipped game never executes.
  They become live as each is wired.

### Judged sound — do not "fix"

`Quaternion.multiply`, `RotationYawPitchRoll`, `Vector3.normalize` (mutates in
place, as Babylon does), `RotationAxis`, targeting the `Vec3` base prototype,
delta encoding (reconstruction is inductively complete and absent/present is
reported both ways), and determinism (seeded PRNG, virtual timers).

---

## NOTE-006 — DD_TABLE: `1,1,1 = 4.425` is the only 3-decimal value (pre-existing)

Scanning the 164 difficulty entries for transcription artefacts:

```
0 decimal places : 21 entries
1 decimal place  : 79 entries
2 decimal places : 63 entries
3 decimal places :  1 entry   ->  1,1,1 = 4.425
```

`1,1,1` (a full-full-full) is the sole three-decimal value in the table. Every
other entry stops at two.

**This is NOT a refactor defect.** All 164 entries were verified equal to
game.js's original, entry for entry, before that copy was removed — so the value
came across faithfully. Whatever it is, it was already there.

It may still be worth a look as a game-design question: `4.425` could be a
deliberate hand-computed value, or a slip for `4.45` / `4.25`. Only the author
can say. Raised here rather than silently "corrected", because changing a
difficulty value alters scoring and is not a refactor's business.

The rest of the table scans clean:
- difficulty is monotonic in twist count at every flip count (1, 2, 3 and 4 flips)
- 15 groups share flips+twists but differ in difficulty, which is expected —
  twist PLACEMENT across flips is part of the difficulty, not just the total.
