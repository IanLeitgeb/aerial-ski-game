#!/usr/bin/env bash
# Full test suite. Must be green before anything merges to main.
#
#   ./tests/run-all.sh
#
# Covers:
#   1. Unit tests for the extracted pure core (node --test)
#   2. Live differential tests vs the running game.js
#   3. Golden-master trace verification (ADR-0005 refactor gate)
#
# NOT covered here: tests/test.html, the browser integration suite, which still
# needs a browser. Run it separately before merging.

set -uo pipefail
cd "$(dirname "$0")/.."

fail=0

echo "── Unit + live differential ─────────────────────────────────"
if node --test tests/unit/*.test.js; then
    echo "unit: PASS"
else
    echo "unit: FAIL"; fail=1
fi

echo
echo "── Golden-master traces ─────────────────────────────────────"
if node tests/golden/verify.js; then
    echo "golden: PASS"
else
    echo "golden: FAIL"; fail=1
fi

echo
echo "── Browser integration suite (headless) ─────────────────────"
if node tests/browser-suite.js | tail -3; then
    echo "browser: PASS"
else
    echo "browser: FAIL"; fail=1
fi

echo
echo "── Gate mutation test ───────────────────────────────────────"
# A gate that passes everything manufactures confidence. Assert it still
# rejects known-bad mutations.
if ./tests/golden/mutation-check.sh; then
    echo "mutation: PASS"
else
    echo "mutation: FAIL — the golden gate has holes"; fail=1
fi

echo
echo "── Scenario coverage ────────────────────────────────────────"
# NOT informational, and no `|| true`: this previously exited 1 while run-all.sh
# still printed ALL GREEN, hiding that scenarios constrain nothing.
if node tests/golden/check-distinct.js; then
    echo "coverage: PASS"
else
    echo "coverage: FAIL — some scenarios produce identical behaviour (see OPEN-002)"
    fail=1
fi

echo
if [ "$fail" -eq 0 ]; then
    echo "ALL GREEN — unit + live-diff + golden traces + browser suite"
else
    echo "SUITE RED — do not merge"
fi
exit "$fail"
