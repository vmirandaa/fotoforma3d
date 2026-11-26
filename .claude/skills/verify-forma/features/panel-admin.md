# Panel de reservas

The shop owner signs in on `ingresar.html#admin` and lands on `admin.html`, which lists every order with stats, state filters and search, lets them change an order's state, view the customer's photos, and view or download the 3D model.

## Sub-features

- `admin-login` signs in with the test account and redirects to `admin.html`.
- `admin-login-wrong` rejects a wrong password with a message in `#admin-message`.
- `admin-list` shows the seed order card with code, size, pet and customer.
- `admin-status` changes the state through the card's combobox and saves it.
- `admin-search` filters cards by name, email, code or pet.
- `admin-photos` opens the customer's photo.
- `admin-model` opens the model dialog and downloads the `.glb`.
- `admin-logout` ends the session with `Salir`.

## How to get to it (user POV)

- Open `/ingresar.html#admin`, or `/ingresar.html` and choose the `Administrador` tab.
- With an active session, `/admin.html` directly.

## Driving it with the built-in browser

Preconditions:

- Doctor is all `ok`. Get the password with `bash .claude/skills/verify-forma/scripts/forma.sh creds` and type it into the field; do not echo it into chat or evidence.

- **Sign in.** `navigate` to `http://127.0.0.1:4180/ingresar.html#admin`. Click tab `Administrador` if `Usuario` is hidden. Type `verify-admin` into `Usuario`, the password into `Clave`, click `Ingresar al panel`. The URL becomes `/admin.html` and `#admin-board` is visible.
- **List.** `#admin-orders` contains one `.order-card` with `F-0000C0DE`, `Cliente Prueba` and `data-status="nueva"`.
- **Change state.** Use `form_input` on combobox `Estado de la reserva F-0000C0DE` with `contactada`. `#board-message` reads `Reserva F-0000C0DE marcada como contactada…` and the card's `data-status` is `contactada`.
- **Second view.** `curl /api/tracking` for the seed pair returns `"status":"contactada"`; `.verify/run-4180/pedidos/estados.json` has the code. Then set it back to `nueva`.
- **Search.** Type `Toby` in `Buscar reservas`: one card. Type `zzz`: `No hay reservas que coincidan…`.
- **Photos and model.** `find` "Ver foto 1" and click it: the photo shows. Click the card's view button (accessible name `Ver en 3D la reserva F-0000C0DE`): `#model-dialog` opens and `#model-dialog-status` has no error. The download button (`Descargar el modelo de la reserva F-0000C0DE`) triggers a `GET /api/admin/model/F-0000C0DE` 200.
- **Proof.** Screenshot of the board before and after the state change, the curl second view, `estados.json` copy.

## Gotchas

- Without `ADMIN_USER`/`ADMIN_PASSWORD` the panel answers 503; `forma.sh start` always sets test ones, so a 503 means you are not on this skill's instance.
- The session cookie lives in the browser pane. A run that starts while still signed in sees `Ya tienes una sesión activa` instead of the form; click `Salir` first to prove login.
- The photo exists only if `fotos-prueba/corgi-800.jpg` was present at start (that folder is gitignored). Without it, `admin-photos` is reported as not verified.
- Status changes persist in the run's `estados.json` until `stop`.
