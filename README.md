# By Rook & Crook

A cozy tavern simulator built with SvelteKit and Supabase.

The connected MVP supports harvesting, brewing, social cards, serving and persistent free-text conversations with Lira Nightwind and Torvin Ashbeard. NPCs investigate relevant knowledge, make decisions, remember significant exchanges and follow their intentions overnight. Quest failure can be permanent; authored risks can lead to death or departure. SvelteKit owns the web and model flow; Supabase Auth and transactional RPCs own identity, inventory and durable consequences.

See the [development runbook](docs/development.md) for setup, secrets and tests, the [NPC technical specification](docs/npc-dialogue.md) for architecture, and the [evaluation cases](docs/evaluations/npc-dialogue.md) for fixture and live acceptance. Editable character sheets are in [npcs.json](supabase/content/npcs.json).

Implementation records: [garden](docs/plans/garden-harvest-vertical-slice.md), [brewery](docs/plans/brewery-vertical-slice.md), [serving](docs/plans/patron-serving-vertical-slice.md), [NPC dialogue](docs/plans/npc-dialogue-mvp.md). Cooking and renewable gardening remain future slices; the local-model adapter is explicitly unimplemented.
