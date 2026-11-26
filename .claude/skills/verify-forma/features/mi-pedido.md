# Mi pedido

A customer types their order code and email on `ingresar.html` and sees the order's stage (recibida, contactada, pagada, enviada, or a cancelled notice), its details and, on request, the figure in 3D. A wrong pair shows a not-found message.

## Sub-features

- `track-found` shows code, date, four stage steps and details for a valid code + email.
- `track-code-short` accepts the code without `F-` (`0000C0DE`) and in lowercase.
- `track-not-found` shows the not-found message for a wrong email or code.
- `track-figure` loads the 3D model with `Ver su figura en 3D`.
- `track-another` returns to the empty form with `Buscar otra reserva`.
- `track-lockout` blocks lookups after 20 failures in 15 minutes from one connection.

## How to get to it (user POV)

- Open `/ingresar.html` (nav link `Mi pedido` on every page). The `Soy cliente` tab is selected by default.

## Driving it with the built-in browser

Preconditions:

- Doctor is all `ok`; seed order `F-0000C0DE` / `prueba@example.test` is untouched.

- **Open.** `navigate` to `http://127.0.0.1:4180/ingresar.html`. `find` "textbox" returns `F-0A1B2C3D` and `nombre@correo.cl`.
- **Look up.** Click `F-0A1B2C3D`, type `F-0000C0DE`; click `nombre@correo.cl`, type `prueba@example.test`; press `Return`. After ~1 s, `#tracking-result` is not hidden, `#tracking-title` is `F-0000C0DE`, `#tracking-details` contains `10 cm, en blanco`, `Toby, Perro`, `$22.990 más envío`, and `#tracking-figure` is visible.
- **Second view.** `curl` `/api/tracking` with the same pair returns HTTP 200 with `"status":"nueva"` and `"hasModel":true`.
- **Figure.** Click `Ver su figura en 3D`. `#tracking-viewer` becomes visible and `read_network_requests` shows `POST /api/tracking/model` 200.
- **Not found.** Click `Buscar otra reserva`, submit `F-0000C0DE` with `otro@example.test`. `#tracking-message` reads `No encontramos una reserva con ese código y correo…`; curl of the same pair returns HTTP 404.
- **Proof.** Screenshot after the lookup, `ui-state.json`, `api-ok.txt`, `api-wrong-email.txt`, `server.log`.

## Gotchas

- The form is `novalidate`; an empty submit shows the page's own message, not a browser tooltip.
- Every not-found counts toward the 20-failure lockout for 127.0.0.1. Many negative runs on one instance will lock it; restart the instance to reset.
- The stage reflects `estados.json`, not the order line. To check another stage, change it through the panel (see `panel-admin.md`), not by editing the seed.
