# ADR-0001: Record architecture decisions

## Status
Accepted — 2026-08-24

## Context
The project is entering a multi-phase restructuring (engine extraction, shared
discipline core, asset pipeline) with several decisions already taken verbally
across a long working session. Without a durable record, the *reasoning* is lost
and decisions get silently relitigated — particularly costly here because several
were made against measured evidence (line counts, RAM limits, licensing terms)
that nobody will remember six weeks on.

## Decision
Use Architecture Decision Records in `docs/adr/`, numbered sequentially, in the
Nygard format. ADRs are immutable once Accepted; a decision changes by adding a
new ADR that supersedes the old one.

Every non-trivial structural or tooling decision gets an ADR, including ones that
*reject* an option — the rejected alternatives are usually the most valuable part.

## Consequences
- Decisions carry their evidence, so revisiting is cheap and honest.
- Small overhead per decision; acceptable.
- The ADR index in `README.md` must be updated whenever an ADR is added.
