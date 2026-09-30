# By Rook & Crook

A cozy tavern simulator built with SvelteKit and Supabase.

The connected MVP supports renewable gardening, a managed apiary, brewing, baking, serving, intent cards, and persistent free-text conversations with Lira Nightwind and Torvin Ashbeard. NPCs investigate relevant knowledge, make decisions, remember significant exchanges and follow their intentions overnight. Quest failure can be permanent; authored risks can lead to death or departure. SvelteKit owns the web and model flow; Supabase Auth and transactional RPCs own identity, simulation, inventory and durable consequences.

See the [development runbook](docs/development.md) for setup, secrets and tests, the [Garden and Apiary specification](docs/garden-apiary.md) for the versioned ecosystem rules, the [NPC technical specification](docs/npc-dialogue.md) for dialogue architecture, and the [evaluation cases](docs/evaluations/npc-dialogue.md) for fixture and live acceptance. First-party NPC releases are authored as one JSON catalog per identity in [`supabase/content/first-party-npcs/`](supabase/content/first-party-npcs/).

For ordinary local human testing, configure the required `OPENAI_API_KEY` in the ignored root `.env`, then run:

```sh
npm run brac-app:dev
```

It runs unit and isolated SQL tests before preparing this repository's persistent Supabase stack and migrations, provisions pilot users, runs RPC integration tests against that populated database, then serves the app at `http://127.0.0.1:3000/login`. The isolated SQL project has automatic cleanup, with a recovery command if cleanup fails. Ctrl+C stops the app and the managed local stack while preserving saves. The [development runbook](docs/development.md) covers prerequisites, credentials, and recovery.

Implementation records: [Garden and Apiary](docs/plans/issue-16-garden-apiary-implementation.md), [brewery](docs/plans/brewery-vertical-slice.md), [bakery](docs/plans/bakery-vertical-slice.md), [serving](docs/plans/patron-serving-vertical-slice.md), and [NPC dialogue](docs/plans/npc-dialogue-mvp.md). The local-model dialogue adapter is explicitly unimplemented.
