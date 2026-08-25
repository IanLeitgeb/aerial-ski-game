You are adversarially reviewing extracted engine modules for correctness. Try to REFUTE the claim that they preserve the original behaviour.

Files to read (only these):
- engine/core/tricks.js
- engine/core/landing.js
- engine/core/power.js
- engine/core/rotation.js

AXIS 1 — Shared mutable state. Does any module EXPORT a reference to internal
mutable state that a caller could modify, affecting every other caller? Look at
what `api` contains. Returning the DD_TABLE object itself, rather than a copy, is
the specific thing to check — and say whether it is actually a problem given how
it is used.

AXIS 2 — Argument mutation. Does any exported function mutate an argument it was
passed (an array, an options object)? Pure functions must not.

AXIS 3 — Lost defaults and guards. These were extracted from inline game code.
Check each function for a missing default (`x || 0`), a missing clamp, or a
missing early return. Specifically:
  - landing.isFeetDown: the original used STRICT < and > comparisons. Confirm.
  - rotation.angularVelocity: `maxOmega: undefined` must mean NO CAP, not a cap
    of zero. Confirm which it does.
  - tricks.calcDD: when given a table that LACKS the key, must it fall through to
    the formula, or to the default table? Say which it does.

AXIS 4 — Division and edge cases. Any place a divisor could be zero or an input
could be undefined, producing NaN that would propagate silently.

RULES — read carefully, you have a limited turn:
- Read ONLY the files listed. Do not explore beyond them.
- Do NOT run node or write scripts. Reading is enough.
- Produce your findings as PLAIN TEXT as your FINAL message. Do not spend the
  whole turn on tool calls — read the listed files once, then answer.
- For each finding: file:line, what breaks, and the exact trigger condition.
- If an axis yields nothing, write "axis N: nothing found". That is a useful
  result, not a failure.
- Report ONLY defects you verified by reading. No style opinions.
