# Repository working model

By Rook and Crook is a prototype with no production system. Existing code, schemas, migrations, interfaces, tests, assets, and docs may be replaced when that better serves the prototype.

Prefer locally defined agents.

## Codebase navigation

Activate this repository with Serena and read its initial instructions before codebase navigation. Prefer its symbol/reference tools for cross-file investigation; use repository-standard tools to edit and verify changes.

## Ticket workflow

Scale coordination to the ticket's complexity:

- Small, localized changes: use one agent and focused verification.
- Bounded work with independent subtasks: delegate where useful; the primary agent handles coordination and efficiency checks.
- Complex, cross-module, or long-running work: start with the agent-organizer, assign bounded, non-overlapping responsibilities, and keep a dedicated workflow overseer active until completion.

Give sub-agents sufficient ticket/repository context and incorporate their findings. Reassess coordination if scope grows.

The overseer owns no implementation files. It checks workflow efficiency at kickoff, after each work batch or handoff, before integration and final verification, and at least every 10 minutes during sustained work. It reports concrete corrections for redundant investigation, stalled agents, inefficient sequencing, excessive test scope, overlapping writes, integration risk, or stale context. The primary agent applies useful corrections promptly.
