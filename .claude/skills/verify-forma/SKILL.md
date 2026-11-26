---
name: verify-forma
description: Launch an isolated copy of the FORMA website (pet 3D figures; Node server.mjs + static pages) and drive it in the built-in browser to prove a change works for a visitor, a customer tracking an order ("Mi pedido") or the admin panel. Use whenever a change to the pages, js/, scss/css, lib/ or server.mjs needs proof in the real app, not just `npm test`.
---

# Verify FORMA

FORMA is a web app: static pages (`index.html`, `crear.html`, `ingresar.html`, `admin.html`, `404.html`) served by `node server.mjs`, plus a JSON API under `/api/`. The user touches it only through a browser. There is no CLI and no Playwright; drive it with the built-in browser tools (`mcp__Claude_Browser__*`) and check the API with `curl`.

The user's own dev server is `npm start` on port **4173** (`.claude/launch.json` → `forma`). Never drive or stop that one. This skill starts its own instance on port **4180** with its own data folder, so both can run side by side; for a second parallel run pass another port (4181, …).

All commands below run from the repo root in the Bash tool (Git Bash). The helper is `bash .claude/skills/verify-forma/scripts/forma.sh <start|doctor|creds|stop> [port]`.

## Launch

```bash
bash .claude/skills/verify-forma/scripts/forma.sh start        # port 4180
```

Ready when it prints `Ready: http://127.0.0.1:4180 (pid N)`. It waits for the log line `FORMA disponible en http://127.0.0.1:4180` **and** a JSON answer from `/api/health`. It returns on its own; the server keeps running in the background.

What `start` sets up (from an empty `.verify/run-4180/`):

- `ORDERS_DIR=.verify/run-4180/pedidos` with one seed order `F-0000C0DE` (email `prueba@example.test`, size M, perro "Toby", status nueva), its model (a copy of `assets/models/sample-figure.glb`) and, if `fotos-prueba/corgi-800.jpg` exists, one photo. Source: `fixtures/order.json`.
- Test admin account `verify-admin` with a random password written to `.verify/run-4180/admin.txt`. Read it with `forma.sh creds`; never paste it into chat.
- `TRIPO_API_KEY` and `SMTP_PASS` forced empty, so `.env` cannot turn them on: **no paid 3D previews and no real emails** from this instance. `/api/health` answers `{"ready":false}` by design.
- Records `git rev-parse --short HEAD` so doctor can tell a stale build.

### With the fake Tripo (free previews)

```bash
bash .claude/skills/verify-forma/scripts/forma.sh start --fake-tripo        # port 4180, simulator on 5180
```

Same seed data, but it also starts `tools/fake-tripo.mjs` on port+1000 and gives the server `TRIPO_API_KEY=simulada` and `TRIPO_API_BASE` pointing at the simulator, so `/api/health` answers `{"ready":true}` and the creator can generate a preview and reserve end to end. The real Tripo is never called and no credits are spent. Each preview takes `DEMORA_MS` (default 6000 ms here) and returns `assets/models/sample-figure.glb`. Its log is `.verify/run-<port>/fake-tripo.log`. `stop` kills it too.

Teardown is `forma.sh stop` (see Cleanup). Static files are read from disk on each request, so edits to HTML/JS/CSS show up on reload; edits to `server.mjs`, `lib/`, `providers/` or `mailer.mjs` need `stop` + `start`. Edits to `scss/` need `npm run build:css` first (pages load `css/main.css`).

## Doctor

```bash
bash .claude/skills/verify-forma/scripts/forma.sh doctor
```

Read-only. Every line must be `ok`: process alive, log says ready on this port, `/api/health` is `{"ready":false}` (proves it is our keyless instance, not one that can spend Tripo credits; with `--fake-tripo` it checks instead that the simulator is alive and health is `{"ready":true}`), home page serves, build matches git HEAD, test admin login answers 200, seed order present. Last line `Instance at http://127.0.0.1:4180 is worth driving.` Run it first whenever anything looks off; on any `FAIL`, `stop` then `start`.

## Drive

Open pages with `mcp__Claude_Browser__navigate` at `http://127.0.0.1:4180/<page>`. Find controls with `mcp__Claude_Browser__find` by accessible name, then `computer` with `ref`. Read the resulting state with `javascript_tool` reading the element ids below (inspection only, never to click or set values for the user), and `read_console_messages` with `onlyErrors: true` for script errors.

Stable handles (ids and accessible names in the HTML):

- Mi pedido (`ingresar.html`): textboxes `F-0A1B2C3D` (`#tracking-code`) and `nombre@correo.cl` (`#tracking-email`), button `Ver mi pedido`; result `#tracking-result`, `#tracking-title`, `#tracking-steps`, `#tracking-details`, `#tracking-message`, button `Ver su figura en 3D`.
- Admin login (`ingresar.html#admin`): tab `Administrador`, textboxes `Usuario` / `Clave`, button `Ingresar al panel`.
- Panel (`admin.html`): `#admin-board`, `#admin-orders` (cards `.order-card[data-status]`), combobox `Estado de la reserva F-0000C0DE`, search `Buscar reservas`, button `Actualizar`, `#board-message`.
- Creator (`crear.html`): `#generation-form`, `#generate-model`, `#generation-state`, `#order-form`, `#order-submit`, `#order-status`.

API checks (side effects and second views):

```bash
curl -s -H 'content-type: application/json' -d '{"code":"F-0000C0DE","email":"prueba@example.test"}' http://127.0.0.1:4180/api/tracking
```

Per-feature recipes are in `features/` (start at `features/README.md`).

## Evidence

Put each run's proof in `.verify/evidence/<YYYYMMDD-HHMMSS>-<feature>/` (gitignored; `stop` never touches it):

- `resultado.jpg`: copy the screenshot file the browser tool reports in its `[Image: source: …]` line.
- `ui-state.json`: the `javascript_tool` read of the result elements.
- `api-*.txt`: curl responses with `-w '\nHTTP %{http_code}\n'`.
- `server.log`: `cp .verify/run-<port>/server.log` before stopping.

Proof standards:

- Exercise the real user path in the browser (type, click, submit). Do not call the API in place of the form; curl is for the second view and side effects.
- Capture the action and the resulting state, not just the final screen.
- For mutations (status changes) confirm the stored effect from another view: `/api/tracking` or reloading the panel, and the file `.verify/run-<port>/pedidos/estados.json`.
- Include one negative case where the feature has one (wrong email → HTTP 404 and `#tracking-message` text).
- Previews are off in the default instance. For anything that needs a finished preview (generate, reserve), restart with `start --fake-tripo` and drive the creator in the browser; say in the evidence that the 3D service was the simulator. Never set a real key, fake a task in memory or point at a test-only path.
- The upload control opens the OS file dialog, which the browser tools cannot drive. Hand the photo to `#reference-images` with `javascript_tool` (fetch `assets/images/corgi-photo.jpg`, build a `File`, set `input.files` through a `DataTransfer` and dispatch `change`) and say so in the evidence; everything after that goes through the real UI.

## Cleanup

```bash
bash .claude/skills/verify-forma/scripts/forma.sh stop
```

Kills only the pid this skill recorded, deletes `.verify/run-<port>/` (seed data, password, log) and the server's temp photo folder for that port, and keeps `.verify/evidence/`. Then confirm `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4180/` prints `000`. Run `stop` after failed attempts too. Never kill `node` by name: the user's own server on 4173 is also `node`.

## Helpers

- `scripts/forma.sh start [--fake-tripo] [port]`: launch + seed + wait until ready. Refuses port 4173 and any port already answering. `--fake-tripo` also runs the free Tripo simulator (`tools/fake-tripo.mjs`) on port+1000.
- `scripts/forma.sh doctor [port]`: read-only health check.
- `scripts/forma.sh creds [port]`: prints the test admin user and password.
- `scripts/forma.sh stop [port]`: teardown, evidence kept.
- `fixtures/order.json`: the seed order (one JSON line in `pedidos.jsonl`).
