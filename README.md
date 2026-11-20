# FORMA · Figuras 3D de mascotas

La portada (`index.html`) presenta el servicio: una figura 3D de tu mascota hecha desde su foto. El creador (`crear.html`) sigue tres pasos: subir la foto, revisar la vista previa en 3D y reservar la figura en el tamaño elegido.

## Ponerlo en marcha

1. Instala Node.js 20.6 o posterior.
2. Crea una clave API en el panel de Hyper3D.
3. Copia `.env.example` como `.env` y reemplaza el valor de `RODIN_API_KEY` por tu clave privada.
4. Abre PowerShell en esta carpeta y ejecuta `npm start`.
5. Abre [http://127.0.0.1:4173](http://127.0.0.1:4173).

No pongas la clave dentro de los archivos HTML o JavaScript del navegador ni la compartas públicamente.

## Estructura del proyecto

- `index.html`, `crear.html`, `ingresar.html` (Mi pedido), `admin.html` y `404.html`: las páginas. Sus nombres quedan en español porque son las direcciones que ven los clientes.
- `css/main.css`: la hoja de estilos que usan las páginas. Se genera desde `scss/`.
- `scss/`: los estilos por tema; `main.scss` los une y `_mixins.scss` trae atajos.
- `js/`: `main.js` (común a todas las páginas: tema, menú, catálogo), `creator.js` (creador), `account.js` (Mi pedido e ingreso) y `admin.js` (panel).
- `data/catalog.json`: tallas, precios y extras.
- `assets/`: imágenes (`images/`) y el modelo de muestra de la portada (`models/`).
- `server.mjs`: el servidor (vista previa, reservas, seguimiento y panel); `mailer.mjs`: los correos.
- `pedidos/`: las reservas guardadas. No entra a git.

## Vista previa

La vista previa usa Rodin / Hyper3D (Gen-2.5), un servicio externo con cobro por créditos. Como es gratis para el visitante, cada una la pagas tú:

- `PREVIEW_TIER` define el nivel de detalle (`Gen-2.5-Low`, `Gen-2.5-Medium` o `Gen-2.5-High`).
- `PREVIEW_LIMIT_PER_HOUR` limita cuántas puede pedir una misma IP por hora.

El servidor arma el prompt para mascotas en `buildPetPrompt` (`server.mjs`); el visitante solo indica el animal y, si quiere, algún detalle. Las fotos se guardan en una carpeta temporal del sistema y se borran a las 24 horas, o al reiniciar el servidor, si nadie reserva. El visor muestra la figura en blanco, como se imprime, o con los colores de la foto.

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

## Estilos (Sass)

Los estilos se escriben en la carpeta `scss/`, separados por tema (`_base.scss`, `_creator.scss`, `_admin.scss`, `_mobile.scss`…). `scss/main.scss` los une en el orden en que se aplican: cada parte puede ajustar a las anteriores. Con Sass se genera `css/main.css`, la hoja que leen todas las páginas y GitHub Pages.

- Ejecuta `npm install` una vez (instala Sass, además de lo del servidor).
- Después de cambiar algo en `scss/`, ejecuta `npm run build:css` para regenerar `css/main.css`.
- Mientras trabajas, `npm run watch:css` lo regenera solo cada vez que guardas un archivo.
- No edites `css/main.css` a mano: se reemplaza al regenerarlo.
- Antes de subir a GitHub, regenera `css/main.css` y súbelo junto con los cambios de `scss/`: GitHub Pages publica el `.css`, no compila el `.scss`.

`scss/_mixins.scss` trae atajos para escribir estilos nuevos: `@include celular { … }`, `@include computador { … }`, `@include oscuro { … }` y `@include con-movimiento { … }`. Para usarlos, agrega `@use 'mixins' as *;` al principio del archivo. Los colores siguen siendo variables de CSS (`var(--green)`, `var(--soft)`…), porque cambian solas en modo oscuro.

Las vistas previas en curso se mantienen en memoria, así que se pierden al reiniciar el servidor; las reservas ya registradas no.
