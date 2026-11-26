# FORMA verification map

This directory is the maintained source for verifying what visitors, customers and the admin see in FORMA. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Start the instance with `bash .claude/skills/verify-forma/scripts/forma.sh start` (port 4180, data in `.verify/run-4180/`).
- `forma.sh doctor` prints only `ok` lines.
- Seed order `F-0000C0DE` / `prueba@example.test` exists with status `nueva` and a model.
- 3D previews and emails are off (`/api/health` → `{"ready":false}`), unless started with `--fake-tripo` (free simulated previews, `{"ready":true}`; emails stay off).
- Never drive the user's server on port 4173.

## Driving conventions

- Use the built-in browser tools on `http://127.0.0.1:4180`.
- Find controls by accessible name with `mcp__Claude_Browser__find`; click and type with `computer` and the returned `ref`.
- Read results with `javascript_tool` on the ids named in each file; do not use it to act.
- Start each recipe from the baseline. After a mutation, put the seed back (status `nueva`) or restart the instance.

## Proof and skip reporting

- Save evidence in `.verify/evidence/<timestamp>-<feature-id>/` as described in `SKILL.md`.
- Capture the action and the resulting state, plus an API or file second view for mutations.
- Name the feature ID and the entry point with each artifact.
- A path that needs a paid preview is reported as not verified, with the unmet precondition. Do not count another entry point in its place.

## Feature entry contract

Each feature file has an H1, one paragraph, then four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with the built-in browser`, `Gotchas`.

## Features

- [Mi pedido](./mi-pedido.md) covers looking up an order by code and email, its stage, details, 3D figure and the not-found case. Proven end to end on 2026-11-26.
- [Panel de reservas](./panel-admin.md) covers admin login, listing, search, filters, status changes, photos and the model viewer.
- [Creador y reserva](./creador.md) covers uploading photos, generating the preview and reserving. Generation runs against the free Tripo simulator (`forma.sh start --fake-tripo`).
- [Portada](./portada.md) covers the home page: sample figure, sizes and prices from the catalog, theme toggle and links to the creator.
