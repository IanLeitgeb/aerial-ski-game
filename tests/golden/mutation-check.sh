#!/usr/bin/env bash
# ── Mutation test for the golden gate ────────────────────────────────────────
#
#   ./tests/golden/mutation-check.sh
#
# A gate that passes everything is worse than no gate: it manufactures
# confidence. An adversarial review demonstrated three mutations that left the
# suite reporting 30/30 — an unconditional per-frame throw, disabling the whole
# athlete, and destroying its orientation on 4 of every 5 frames.
#
# This injects each mutation into a scratch copy, runs verify.js, and asserts the
# gate FAILS. Any mutation that passes is a hole.
#
# The repo is never modified — everything happens under a temp copy.

set -uo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp -r game.js index.html engine tests "$WORK"/ 2>/dev/null
cd "$WORK"

fails=0

# Anchor: the frame-loop line the review used. Inside the try/catch, after the
# physics update, so a throw there is swallowed by game.js.
ANCHOR="        if (poolVisible && waterMesh) {"

run_mutation() {
    local name="$1" code="$2"
    cp "$ROOT/game.js" game.js
    python3 - "$code" <<'PY'
import sys
code = sys.argv[1]
anchor = "        if (poolVisible && waterMesh) {"
s = open('game.js').read()
assert anchor in s, 'anchor not found — update mutation-check.sh'
s = s.replace(anchor, code + "\n" + anchor, 1)
open('game.js','w').write(s)
PY
    if node tests/golden/verify.js >/dev/null 2>&1; then
        echo "  HOLE   $name — gate still reported PASS"
        fails=$((fails+1))
    else
        echo "  caught $name"
    fi
}

echo "Mutation testing the golden gate:"

run_mutation "unconditional throw in frame loop" \
    '        throw new Error("mutation: refactor blew up in the frame loop");'

run_mutation "athlete disabled every frame" \
    '        character.root.setEnabled(false);'

run_mutation "orientation destroyed on 4 of every 5 frames" \
    '        if (!crashActive && ((globalThis.__mf = (globalThis.__mf||0)+1) % 5) !== 1) { character.root.rotationQuaternion = BABYLON.Quaternion.Identity(); }'

run_mutation "head reparented onto the right shin" \
    '        if (character.meshes["head"] && character.meshes["lowerLegR"]) character.meshes["head"].parent = character.meshes["lowerLegR"];'

run_mutation "silent per-frame state corruption in pool world" \
    '        if (_poolDiveMode) { state.spinAngle += 1.0; }'

echo
if [ "$fails" -eq 0 ]; then
    echo "All mutations caught — the gate has teeth."
else
    echo "$fails mutation(s) NOT caught — the gate has holes."
fi
exit "$fails"
