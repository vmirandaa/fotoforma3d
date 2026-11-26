# Creador y reserva

On `crear.html` a visitor uploads one photo ("Foto suelta") or photos by angle, names the pet and species, generates a 3D preview (Tripo), checks it in the viewer, then picks size, finish, extras and quantity and reserves with name and email. The reservation gets an `F-XXXXXXXX` code.

## Sub-features

- `creator-unavailable` shows `La vista previa no está disponible en este momento…` when the 3D service is not configured.
- `creator-upload` accepts photos in free mode and by angle, with the per-photo size and count limits.
- `creator-generate` runs the preview with the waiting screen and shows the model.
- `creator-order-total` recalculates the total as size, finish, extras and quantity change.
- `creator-reserve` saves the order and shows its code.

## How to get to it (user POV)

- `Crear mi figura` in the nav or the home page, or `/crear.html` directly.

## Driving it with the built-in browser

Preconditions:

- Doctor is all `ok`. The default instance has no Tripo key on purpose (unavailable state); `start --fake-tripo` gives the free simulator (generate and reserve).

- **Unavailable state.** `navigate` to `http://127.0.0.1:4180/crear.html`. `#generation-state` shows the "no está disponible" text and `#generate-model` stays disabled after filling the form.
- **Upload.** Use the upload control in `#generation-form` with `fotos-prueba/corgi-800.jpg` (if present). The file appears in `#file-list`.
- **Generate and reserve.** Needs the instance started with `forma.sh start --fake-tripo` (free simulator; the default instance has no key on purpose). Hand the photo to `#reference-images` as `SKILL.md` describes, then use the real UI: on desktop tick the tail answer and `Acepto que las fotos…`, wait at least 4 s after load and click `Ver su figura en 3D`. On a phone-sized viewport (≤ 700 px) the form is a three-part wizard: `Siguiente: su mascota`, the tail answer, `Siguiente: confirmar`, consent, then generate. With the default 6 s delay the preview is ready in about 10–15 s: `#model-state` reads `Vista previa lista`, `#panel-view` is shown and focus is on the `Su figura` tab. Then pick size/finish/extras (the total in `#order-total` updates), fill `Tu nombre` / `Tu correo` and click `Reservar mi figura`: `#order-status` shows `Reserva F-XXXXXXXX recibida…` and focus moves to its `Sigue tu pedido aquí` link. Second view: `/api/tracking` with that code and email, and the line in `.verify/run-<port>/pedidos/pedidos.jsonl`.
- Without `--fake-tripo`, report `creator-generate`, `creator-order-total` and `creator-reserve` as not verified, reason "needs a preview (start with --fake-tripo)".

## Gotchas

- Do not set a real key to make this pass. A paid run needs the user's explicit OK in chat for that run, a key they provide, and `stop`/`start` with `TRIPO_API_KEY` exported; `forma.sh start` would still force it empty, so that run is a manual variant to agree with the user first.
- A reservation from a paid run would also send real emails if SMTP were on; this instance forces `SMTP_PASS` empty.
- The page asks the server for a one-use pass on load and refuses to generate in the first 4 seconds; a scripted submit that is too fast fails on purpose.
- Hidden field `#website` is a bot trap. Never fill it.
