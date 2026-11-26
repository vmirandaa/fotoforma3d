# Portada

The home page (`index.html`) presents the service: a turning sample figure, how it works, the photo tips, sizes and prices read from `data/catalog.json` with a to-scale comparison, a light/dark theme toggle and links to the creator.

## Sub-features

- `home-hero` shows the sample figure from `assets/models/sample-figure.glb` in `#hero-model` (falls back to the illustration without it).
- `home-sizes` renders one card per size in `#size-grid` (S, M, L, XL) with prices from the catalog.
- `home-compare` draws sizes to scale next to a mug in `#size-compare`.
- `home-theme` switches theme with `#theme-toggle` (label `Modo oscuro` / `Modo claro`).
- `home-cta` links `Crear mi figura` to `crear.html`.
- `home-404` an unknown page shows `404.html`.

## How to get to it (user POV)

- Open `http://127.0.0.1:4180/`. Anchors `#como-funciona`, `#la-foto`, `#precios` from the nav.

## Driving it with the built-in browser

Preconditions:

- Doctor is all `ok`.

- **Sizes.** `navigate` to `/`, then `/#precios`. `#size-grid` text contains `8 cm`, `10 cm`, `12 cm`, `15 cm` and `$17.990`.
- **Theme.** Click `#theme-toggle` (`find` "Modo"). `#theme-label` switches between `Modo oscuro` and `Modo claro`, the button's `aria-pressed` flips and `localStorage['forma-theme']` changes; reload and it stays.
- **CTA.** Click `Crear mi figura`. The URL becomes `/crear.html`.
- **404.** `navigate` to `/no-existe`. The page is `404.html`; `curl -s -o /dev/null -w '%{http_code}' -H 'accept: text/html' http://127.0.0.1:4180/no-existe` prints `404`.
- **Proof.** Screenshots of hero and prices in both themes, plus `read_console_messages` with `onlyErrors: true` empty.

## Gotchas

- Prices come from `data/catalog.json`; if they changed, assert against that file, not this list.
- The hero model loads `model-viewer` from a CDN; offline, the hero stays on the illustration. That is a network limit, not a bug.
