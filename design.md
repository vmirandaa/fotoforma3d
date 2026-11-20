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
