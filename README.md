# FORMA · Figuras 3D de mascotas

La portada (`index.html`) presenta el servicio: una figura 3D de tu mascota hecha desde su foto. El creador (`crear.html`) sigue tres pasos: subir la foto, revisar la vista previa en 3D y reservar la figura en el tamaño elegido.

## Ponerlo en marcha

1. Instala Node.js 20.6 o posterior.
2. Crea una clave API en el servicio 3D que vas a usar, Tripo, en [developers.tripo3d.ai](https://developers.tripo3d.ai).
3. Copia `.env.example` como `.env` y pega tu clave en `TRIPO_API_KEY`.
4. Abre PowerShell en esta carpeta y ejecuta `npm start`.
5. Abre [http://127.0.0.1:4173](http://127.0.0.1:4173).

No pongas la clave dentro de los archivos HTML o JavaScript del navegador ni la compartas públicamente.

## Estructura del proyecto

- `index.html`, `crear.html`, `ingresar.html` (Mi pedido), `admin.html` y `404.html`: las páginas. Sus nombres quedan en español porque son las direcciones que ven los clientes.
- `css/main.css`: la hoja de estilos que usan las páginas. Se genera desde `scss/`.
- `scss/`: los estilos. `_tokens.scss` (colores, tipos y espacios), `_base.scss`, `_components.scss` (barra, botones, pie), `_forms.scss` y una parte por página en `scss/pages/`; `main.scss` los une y `_mixins.scss` trae atajos.
- `design.md`: el sistema de diseño fijo (colores, tipos, controles y reglas). Léelo antes de cambiar el diseño.
- `js/`: módulos del navegador (cada archivo dice con `import` qué usa de los otros). Por ser módulos, las páginas deben abrirse desde el servidor (`npm start`) o GitHub Pages, no con doble clic en el archivo.
  - `main.js` va en todas las páginas (tema, menú y la portada); `creator.js` (creador), `account.js` (Mi pedido e ingreso) y `admin.js` (panel) van en la suya.
  - `creator/`: las partes del creador. `photos.js` (subida libre o por ángulos), `wizard.js` (el formulario en tres pantallas en celular), `waiting.js` (pantalla de espera), `order.js` (tamaño, extras, total y reserva) y `shared.js` (el estado que comparten). `creator.js` las coordina y genera la vista previa.
  - Compartido: `catalog.js` (catálogo y precios), `viewer.js` (visor 3D), `dom.js` (el ayudante `el` para armar elementos) y `rules.js`.
  - `rules.js` lo usa también el servidor: límites de fotos, código de reserva, cantidad máxima, nombre de la base y el cálculo del precio. Si cambias una regla, cambia en los dos lados.
- `data/catalog.json`: tallas, precios y extras.
- `assets/`: imágenes (`images/`) y el modelo de muestra de la portada (`models/`).
- `server.mjs`: el servidor. Solo decide qué atiende cada dirección; el trabajo está en `lib/`.
- `lib/`: el servidor por tema.
  - `config.mjs` (lee `.env`; carpetas, puerto y servicio 3D), `http.mjs` (responder y leer solicitudes).
  - `previews.mjs` (fotos → servicio 3D → modelo, con los límites por visitante), `orders.mjs` (reservas y seguimiento), `admin.mjs` (ingreso y panel), `static.mjs` (páginas e imágenes).
  - `order-rules.mjs` (extras y textos de la reserva) y `pass.mjs` (protección contra envíos automáticos): reglas sin disco ni red, con pruebas.
- `mailer.mjs`: los correos.
- `test/`: pruebas automáticas de las reglas, el pase, los correos y el recorrido completo (`e2e.test.mjs`).
- `tools/fake-tripo.mjs`: un Tripo de mentira para probar sin gastar créditos (ver "Probar sin gastar créditos"). No se publica.
- `providers/`: el servicio de generación 3D (`tripo.mjs`) y sus utilidades (`shared.mjs`).
- `pedidos/`: las reservas guardadas. No entra a git.

## Vista previa

La vista previa la genera un servicio externo con cobro por créditos. Como es gratis para el visitante, cada una la pagas tú. El servicio es **Tripo**. Cuesta 30 créditos (US$0,30) por vista previa con colores, o 20 sin colores (`TRIPO_TEXTURE=false`). Si el cliente sube foto de frente y al menos otra de costado o espalda (con la subida por ángulos; en "Foto suelta" va una sola foto, que cuenta como frente), usa la multivista de Tripo; si no, genera desde una sola foto. Tripo no acepta texto junto a las fotos: las indicaciones de cola, orejas o detalles no llegan al modelo, pero quedan en la reserva para el taller. `TRIPO_MODEL` permite fijar otra versión del modelo.
Cuando una vista previa está lista, el servidor descarga el modelo y lo guarda junto a las fotos, así no depende de cuánto dure el enlace del servicio. Si el servicio falla (por ejemplo, sin créditos o con la clave equivocada), el cliente ve un mensaje simple y el motivo exacto queda en la consola del servidor.

Límites de gasto y protección contra spam:

- `PREVIEW_LIMIT_PER_HOUR` y `PREVIEW_LIMIT_PER_DAY` limitan cuántas puede pedir una misma conexión por hora y por día (por defecto, 6 y 15).
- `PREVIEW_DAILY_BUDGET` es el tope del sitio completo en 24 horas (por defecto, 100): acota el gasto diario aunque lleguen muchas visitas.
- Al publicar el servidor detrás de un servicio como Render o Railway, define `TRUST_PROXY=true` para que los límites usen la dirección real de cada visitante.

Además, el creador tiene protecciones invisibles contra envíos automáticos:

- **Pase de la página:** al abrir el creador, el servidor entrega un pase firmado que se exige para generar. Cada pase sirve una sola vez y vence en 6 horas.
- **Tiempo mínimo:** el pase no se acepta en los primeros 4 segundos; una persona siempre tarda más en subir fotos y responder.
- **Campo trampa:** un campo oculto que las personas no ven. Si llega lleno, la vista previa se rechaza.

Los rechazos quedan anotados en la consola del servidor. Los conteos viven en memoria y se reinician si se reinicia el servidor.

El visitante indica el animal y, si quiere, algún detalle; eso queda en la reserva para el taller. Las fotos se guardan en una carpeta temporal del sistema y se borran a las 24 horas, o al reiniciar el servidor, si nadie reserva. El visor muestra la figura en blanco, como se imprime, o con los colores de la foto.

### Probar sin gastar créditos

`tools/fake-tripo.mjs` imita la API de Tripo en tu computador: recibe las fotos, "genera" en unos segundos y entrega como resultado la figura de muestra de la portada. Así se puede probar el creador completo (vista previa y reserva) sin clave ni créditos.

- `npm run dev:fake`: levanta el simulador y el sitio en [http://127.0.0.1:4174](http://127.0.0.1:4174), con una clave de mentira (`simulada`) que reemplaza a la de `.env`, sin correos y con las reservas en una carpeta temporal del sistema (no en `pedidos/`). Se cierra con Ctrl+C.
- `node tools/fake-tripo.mjs [puerto]`: solo el simulador (por defecto en el puerto 4399). Para apuntar el sitio a él: `TRIPO_API_KEY=simulada` y `TRIPO_API_BASE=http://127.0.0.1:4399/v3`.
- `DEMORA_MS` fija cuánto tarda cada vista previa (por defecto, 8 segundos).
- Con la clave `clave-mala` responde como una clave inválida, y con `sin-creditos`, como una cuenta sin créditos: sirve para ver los mensajes de error que recibe el cliente.

## Figura de muestra en la portada

Si existe el archivo `assets/models/sample-figure.glb`, la portada lo muestra girando en blanco, como se imprime, en lugar de la ilustración. Si no existe, se ve la ilustración. Conviene un modelo liviano (idealmente menos de 5 MB) y con derecho a usarlo comercialmente.

## Tamaños y precios

`data/catalog.json` es la única fuente de tallas, medidas y precios: la leen la portada, el creador y el servidor. Cámbialos ahí.

Cada talla tiene además el campo `pintada`: lo que se suma al precio si el cliente la pide pintada por el taller. Los valores actuales son de ejemplo. Si borras ese campo de una talla, esa talla solo se ofrece en blanco. La reserva guarda el acabado (`finish`), el precio base, el recargo y el total.

En `extras` están las opciones que el cliente elige al reservar, cada una con su recargo (`precio`, 0 = incluido):

- `formatos`: figura, alcancía, ánfora o cuadro 3D (se elige uno).
- `estilos`: realista o animado.
- `bases`: sin base, base sin nombre o base con nombre (`conNombre: true` pide escribir el nombre, hasta 24 letras).
- `cantidadMaxima`: cuántas figuras iguales se pueden pedir en una reserva.

Los valores actuales son de ejemplo. Puedes cambiar textos y precios, o agregar y quitar opciones, y el formulario se arma solo. El servidor vuelve a calcular el precio con el catálogo: total = (talla + pintada + extras) × cantidad. La reserva guarda lo elegido, el nombre de la base, la cantidad, el precio unitario y el total.

La portada dibuja las tallas a escala junto a una taza, a partir de la medida de cada una (`"8 cm"` → 8).

## Reservas

Al reservar, el servidor agrega una línea a `pedidos/pedidos.jsonl` (código, talla, precio, nombre, correo, mascota y comentarios), guarda el modelo como `pedidos/<código>.glb` y copia las fotos del cliente como `pedidos/<código>-foto-N.jpg`. Esa carpeta no se sirve por la web ni entra a git. Todavía no hay pago en línea.

Para revisarlas, define `ADMIN_USER` y `ADMIN_PASSWORD` en `.env`, reinicia el servidor y entra en [http://127.0.0.1:4173/ingresar.html#admin](http://127.0.0.1:4173/ingresar.html#admin). Al ingresar se abre una sesión de 12 horas, guardada en una cookie que el navegador no deja leer a la página, y se pasa al panel (`admin.html`). El panel lista las reservas, permite marcar su estado (nueva, contactada, pagada, enviada o cancelada; se guarda en `pedidos/estados.json`), ver las fotos del cliente, y ver en 3D o descargar el modelo de cada una. Al publicar el sitio con HTTPS, define `COOKIE_SECURE=true` para que la sesión solo viaje cifrada.

## Mi pedido

En `ingresar.html` el cliente escribe el código de su reserva y el correo con que la hizo, y ve en qué etapa está (recibida, contactada, pagada o enviada), los datos de su figura y, si la pide, la figura en 3D. Tras 20 intentos fallidos en 15 minutos desde una misma conexión, la búsqueda se bloquea un rato.

## Avisos por correo

Cada reserva envía dos correos: un aviso al taller (al responderlo le escribes al cliente) y una confirmación al cliente con su código. Los textos están en `mailer.mjs`. Se activan definiendo `SMTP_HOST`, `SMTP_USER` y `SMTP_PASS` en `.env`; con Gmail, usa `smtp.gmail.com` y una contraseña de aplicación. Si el envío falla, la reserva igual queda guardada y el error aparece en la consola del servidor.

El envío usa el paquete `nodemailer`: ejecuta `npm install` una vez antes de `npm start`.

## Página no encontrada

`404.html` aparece cuando alguien entra a una dirección que no existe. GitHub Pages la usa sola; el servidor la entrega a los navegadores y responde en JSON a todo lo demás.

## Cabeceras de seguridad

El servidor (`lib/http.mjs`) agrega a todas sus respuestas cabeceras que piden al navegador más cuidado: no adivinar tipos de archivo, no mandar la dirección completa a otros sitios, no dejar que otro sitio muestre FORMA dentro de un marco y no usar cámara, micrófono, ubicación ni pagos. A las páginas les agrega además una política de contenido (`Content-Security-Policy`) que solo deja cargar scripts del propio sitio, de model-viewer (ajax.googleapis.com) y los pequeños scripts escritos dentro de cada página. Estos últimos se autorizan por su huella (hash), que el servidor calcula solo al entregar la página: si cambias uno, no hay que tocar nada más. Si agregas un servicio externo nuevo (otra fuente, un script de estadísticas…), hay que sumarlo en `contentSecurityPolicy`; si no, el navegador lo bloquea y lo avisa en la consola. GitHub Pages no envía estas cabeceras: rigen solo con `npm start` o al publicar el servidor.

## Estilos (Sass)

Los estilos se escriben en la carpeta `scss/`, separados por tema: los tokens (`_tokens.scss`), la base, los componentes y formularios compartidos, y una parte por página en `scss/pages/` (`_home.scss`, `_creator.scss`, `_account.scss`, `_admin.scss`, `_error.scss`). `scss/main.scss` los une en el orden en que se aplican: cada parte puede ajustar a las anteriores. Con Sass se genera `css/main.css`, la hoja que leen todas las páginas y GitHub Pages.

- Ejecuta `npm install` una vez (instala Sass, además de lo del servidor).
- Después de cambiar algo en `scss/`, ejecuta `npm run build:css` para regenerar `css/main.css`.
- Mientras trabajas, `npm run watch:css` lo regenera solo cada vez que guardas un archivo.
- No edites `css/main.css` a mano: se reemplaza al regenerarlo.
- Antes de subir a GitHub, regenera `css/main.css` y súbelo junto con los cambios de `scss/`: GitHub Pages publica el `.css`, no compila el `.scss`.

`scss/_mixins.scss` trae atajos para escribir estilos nuevos: `@include phone { … }` para reglas solo en celular. Para usarlos, agrega `@use 'mixins' as *;` al principio del archivo. Los colores son variables de CSS definidas en `_tokens.scss` (`var(--color-accent)`, `var(--color-paper-2)`…), porque cambian solas en modo oscuro; no escribas colores sueltos fuera de ese archivo.

Las vistas previas en curso se mantienen en memoria, así que se pierden al reiniciar el servidor; las reservas ya registradas no.

## Revisar el código

Con `npm install` hecho, estos comandos revisan el JavaScript (no cambian nada del sitio):

- `npm test`: corre las pruebas de `test/` (precios y extras, pase contra spam, correos). `test/e2e.test.mjs` levanta el servidor de verdad contra el simulador de Tripo y recorre vista previa, reserva, Mi pedido y el panel, con sus casos de error; tarda unos 6 segundos y no usa la clave real ni envía correos.
- `npm run lint`: ESLint avisa de variables sin uso, nombres mal escritos y errores comunes.
- `npm run format`: Prettier deja el formato parejo en todos los `.js` y `.mjs` (comillas, sangría, largo de línea).
- `npm run check`: los tres a la vez, sin modificar archivos. Conviene correrlo antes de cada commit.

Para que VS Code formatee al guardar, instala la extensión Prettier: toma la configuración de `.prettierrc.json`.
