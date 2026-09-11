# Repository working model

By Rook and Crook is in rapid prototyping. There is no production system. Treat every existing implementation, schema, migration, interface, test, asset, and document as disposable or mutable when changing it better serves the current prototype.

Always prefer using locally-defined agent definitions

## Ticket workflow

For every ticket, start with the agent-organizer to break down a ticket and delegate work to a team of sub-agents with bounded, non-overlapping responsibilities. Give each sub-agent enough ticket and repository context to complete its assignment, and use their findings to prevent long-running implementation context from becoming stale or incomplete.

Dedicate one sub-agent as the ticket's workflow overseer. The overseer does not own implementation files. It periodically reviews the active work for inefficient sequencing, redundant investigation, excessive test scope, stalled agents, integration risk, and context rot, then reports concrete corrections to the primary agent. Keep this role active until the ticket is complete.
