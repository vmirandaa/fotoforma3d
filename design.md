# Design: FORMA

El sistema fijo del sitio. Toda página nueva o cambio de diseño lo lee primero y lo comparte. Se cambia a propósito; este archivo es la regla.

## Sistema
- Género: editorial
- Forma de la portada: Narrative Workflow (sus fotos, su figura, su tamaño). Creador, Mi pedido y panel: pantallas de trabajo.
- Tema: la marca de FORMA (logo F + FORMA., verde bosque, Fraunces y DM Sans)
- Ejes: papel claro / serif romana / verde · postura: restringida · modos: claro y oscuro (`:root[data-mode="dark"]`)

## Tokens
`scss/_tokens.scss` es la fuente de verdad. Los roles:
```css
:root {
  --color-paper: oklch(96.7% 0.008 91);  --color-paper-2: oklch(94.4% 0.012 110);  --color-paper-3: oklch(92.4% 0.018 124);
  --color-surface: oklch(99.1% 0.005 95);  --color-ink: oklch(27.3% 0.015 137);  --color-ink-2: oklch(38% 0.016 140);
  --color-muted: oklch(49.5% 0.016 140);  --color-rule: oklch(88.5% 0.012 110);  --color-edge: oklch(62% 0.016 140);
  --color-accent: oklch(49.9% 0.044 148);  --color-accent-ink: oklch(99.1% 0.005 95);  --color-focus: oklch(50% 0.13 148);
  --color-field: oklch(36.7% 0.039 150);  --color-stage: oklch(74% 0.036 132);
  --font-display: "Fraunces", Georgia, serif;  --font-body: "DM Sans", system-ui, sans-serif;  --font-outlier: "Manrope" (solo el logo);
  --radius-card: 16px;  --radius-field: 12px;  --radius-pill: 999px;  --rule-hair: 1px;
}
```
La escala de espacios (4 px), la de tipos (1,25 desde 16 px), las curvas y duraciones de movimiento y las capas están en `scss/_tokens.scss`.

## Reglas que se mantienen
- Ningún color ni familia tipográfica fuera de los tokens.
- Títulos en Fraunces 500, enteros en un solo estilo: sin una palabra en cursiva o en otro color.
- Etiquetas, notas y enlaces de navegación en DM Sans, en minúsculas normales; nunca en mayúsculas espaciadas ni como etiqueta sobre un título.
- Sin flechas pegadas a los botones ni textos unidos con "·".
- `--color-stage` (verde medio) es el fondo donde se muestran las figuras: visor 3D, diagrama a escala.
- La portada muestra cosas reales: la foto y la figura que salió de ella. Nada dibujado, nada inventado (cifras, opiniones, logos).

## Controles
- Principal: relleno verde de la marca · píldora · 48 px de alto (44 en la barra)
- Secundario: contorno (`--color-edge`) · misma forma y alto
- Campos: borde constante, foco con contorno de 2 px (`--color-focus`), 48 px de alto, 16 px de letra en celular

## Movimiento
- Carácter: tranquilo. Una sola entrada suave al bajar por la portada; con "reducir movimiento", todo aparece de inmediato.

## Archivos
- `scss/main.scss` une las partes; `npm run build:css` genera `css/main.css`.
- `scss/_tokens.scss`, `_base.scss`, `_components.scss`, `_forms.scss`, `_mixins.scss` y una parte por página en `scss/pages/`.

## Registro de Hallmark
Decisiones que dejó el rediseño con Hallmark (estaban al principio de `scss/main.scss`). Sirven de referencia si se vuelve a pasar por Hallmark.
- shape: Narrative Workflow (portada) · app screen (creador, Mi pedido, panel) · genre: editorial · theme: brand · redesign: full · job: buy paper: oklch(96.7% 0.008 91) · accent: oklch(49.9% 0.044 148) · display: Fraunces · body: DM Sans · hero: Stage (/) · nav: edge-aligned, the wordmark and the job's action · footer: mast · signature: the real corgi photo beside the 3D figure made from it axes: light/roman-serif/chromatic-green · posture: restrained · modes: light+dark · imagery: the user's sample figure (GLB) and one CC0 photo from Wikimedia Commons · contrast: pass · fold: pass · v2.0.0
- pre-emit critique: P4 H4 E4 S5 R4 V4 · weakest: P, a shop page argues little; led with the honest proof (the real photo and the figure made from it) instead of a drawing
- dropped .ticker, .topline · gate 66 names the caps strip under the hero; its facts already sit in the hero, the steps and the footer line
- answered F4 · the sticky bar repeats the hero action on phones only, and the size picker fill marks the selected size, not a second action
- dropped "VISTA PREVIA GRATIS" sticker and hero 01 02 03 meta row · gates 54 and 66; the free preview is in the lead, the three stages in the steps section
- dropped "La vista previa no tiene costo." beside the price action · 69 names it; the free preview is already in the hero lead and the FAQ
- dismissed 25 · .faq-intro p and .model-placeholder p are one-sentence captions beside a list or a stage, not prose
- dismissed F7 · inputs share one field recipe on purpose (one form language across the site); pills mark segmented controls and the size picker, which are controls
- answered F15 · below the hero every grid uses --gap-columns; the 96px is the hero itself and the 24px and 64px are flex rows (price foot, view layout), not columns
- dropped pet-shape · gate 80 names the drawn pet; the size comparator now shows the real figure's silhouette
- 404 verified by hand: its dynamic base cannot be linted from disk and the server answers it with HTTP 404
- finish-review: subagent · verdict fix · 8 findings, 8 resolved (poster fallback, accent fill on selected segments, one counter on phones, real figure silhouette, echo cut, price box stretched, account card full width, light mode and admin at 375 checked)
