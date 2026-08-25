#!/usr/bin/env bash
# Delegate one extraction unit to an opencode subagent.
#   ./run.sh <unit-name>
# Reads .delegate/tasks/<unit>.md, writes .delegate/out/<unit>.md
#
# Per ADR-0009: subagents PROPOSE. Nothing here writes into engine/ directly —
# output lands in .delegate/out/ for review before anything is accepted.

set -uo pipefail
cd "$(dirname "$0")/.."

UNIT="${1:?usage: run.sh <unit-name>}"
MODEL="${OPENCODE_MODEL:-opencode-go/ox-alpha-free}"
FALLBACK="${OPENCODE_FALLBACK:-opencode-go/kimi-k2.7-code}"
BIN="$HOME/.opencode/bin/opencode"

TASK=".delegate/tasks/${UNIT}.md"
OUT=".delegate/out/${UNIT}.md"
mkdir -p .delegate/out

[ -f "$TASK" ] || { echo "no such task: $TASK" >&2; exit 1; }

# The stealth models are capacity-limited and fail intermittently, so retry
# before falling back to the verified-stable model.
for attempt in 1 2 3; do
    if timeout 300 "$BIN" run -m "$MODEL" "$(cat "$TASK")" > "$OUT" 2>"$OUT.err"; then
        if [ -s "$OUT" ] && ! grep -qE "Unexpected server error|Endpoint is unavailable|^Error:" "$OUT"; then
            echo "[$UNIT] ok via $MODEL (attempt $attempt)"
            exit 0
        fi
    fi
    sleep 3
done

echo "[$UNIT] $MODEL failed 3x, falling back to $FALLBACK" >&2
if timeout 300 "$BIN" run -m "$FALLBACK" "$(cat "$TASK")" > "$OUT" 2>"$OUT.err"; then
    echo "[$UNIT] ok via $FALLBACK"
    exit 0
fi

echo "[$UNIT] FAILED on both models" >&2
exit 1
