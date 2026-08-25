You are adversarially reviewing the WIRING of a refactor. Try to REFUTE the claim that it is correct.

Files to read (only these):
- index.html   — look at the SRCS array near the bottom (~line 2660)
- tests/test.html — the <script> tags near the top (~line 53)
- tests/golden/harness.js — the ENGINE_MODULES array
- engine/core/inertia.js, engine/core/pose.js, engine/disciplines/aerial-ski.js

Each engine module is loaded as a plain <script> and resolves its dependencies AT
LOAD TIME via `global.AerialEngine.<namespace>`. If a module loads before a
namespace it reads, it gets `undefined` and throws, and the whole game fails to
boot.

AXIS 1 — Dependency order. For each module, find every `global.AerialEngine.<ns>`
it reads at load time. Confirm that namespace is registered by a module listed
EARLIER in the load order. Name any that is not.

AXIS 2 — List agreement. The three files each list the modules independently.
Compare them element by element INCLUDING ORDER. Report any difference.

AXIS 3 — Namespace names. Confirm the namespace each module REGISTERS matches the
name other modules READ (e.g. a module registering `bodyModel` but read as
`body-model` would be undefined at runtime).

RULES — read carefully, you have a limited turn:
- Read ONLY the files listed. Do not explore beyond them.
- Do NOT run node or write scripts. Reading is enough.
- Produce your findings as PLAIN TEXT as your FINAL message. Do not spend the
  whole turn on tool calls — read the listed files once, then answer.
- For each finding: file:line, what breaks, and the exact trigger condition.
- If an axis yields nothing, write "axis N: nothing found". That is a useful
  result, not a failure.
- Report ONLY defects you verified by reading. No style opinions.
