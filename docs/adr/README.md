# Architecture Decision Records

Decisions are numbered, immutable once **Accepted**, and superseded rather than edited.
To change a decision, add a new ADR and set the old one's status to
`Superseded by ADR-XXXX`.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-separate-game-logic-from-display.md) | Separate game logic from display logic | Accepted |
| [0003](0003-shared-physics-core-across-disciplines.md) | Shared physics core across all disciplines | Accepted |
| [0004](0004-all-work-in-git-worktrees.md) | All project work happens in git worktrees | Accepted |
| [0005](0005-golden-master-traces-before-refactor.md) | Golden-master traces captured before refactoring | Accepted |
| [0006](0006-node-test-runner-and-green-gate.md) | `node --test` runner; green suite gates merge to main | Accepted |
| [0007](0007-defer-unreal-port.md) | Defer the Unreal Engine port trial | Accepted |
| [0008](0008-blender-official-build-optix.md) | Blender official build with OptiX for GPU baking | Accepted |
| [0009](0009-subagent-delegation-model.md) | Delegate to opencode subagents; Opus holds review authority | Proposed |

## Template

```markdown
# ADR-XXXX: Title
## Status
Accepted | Proposed | Superseded by ADR-YYYY
## Context
What forces are at play? What did we measure?
## Decision
What we will do.
## Consequences
What becomes easier, what becomes harder, what we accept.
```
