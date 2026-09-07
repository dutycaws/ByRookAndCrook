# By Rook & Crook

A cozy tavern simulator built with SvelteKit and Supabase.

The first connected MVP loop is implemented: a provisioned player can sign in, create a tavern, harvest a mature crop, brew one quality-scored beverage per tavern day, earn a matching social card, and retain the full result through navigation, reload, sign-out, and another browser session. SvelteKit owns the web flow; Supabase Auth, row-level security, and transactional RPCs own identity and durable game state.

See [the development runbook](docs/development.md) for local setup, fixture accounts, the demo path, tests, and deployment notes. The implementation contracts live in the [garden harvest plan](docs/plans/garden-harvest-vertical-slice.md) and [brewery slice record](docs/plans/brewery-vertical-slice.md).
