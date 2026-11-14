# FORMA · Figuras 3D de mascotas

La portada (`index.html`) presenta el servicio: una figura 3D de tu mascota hecha desde su foto. El creador (`crear.html`) sigue tres pasos: subir la foto, revisar la vista previa en 3D y reservar la figura en el tamaño elegido.

## Ponerlo en marcha

1. Instala Node.js 20.6 o posterior.
2. Crea una clave API en el panel de Hyper3D.
3. Copia `.env.example` como `.env` y reemplaza el valor de `RODIN_API_KEY` por tu clave privada.
4. Abre PowerShell en esta carpeta y ejecuta `npm start`.
5. Abre [http://127.0.0.1:4173](http://127.0.0.1:4173).

No pongas la clave dentro de los archivos HTML o JavaScript del navegador ni la compartas públicamente.

## Vista previa

La vista previa usa Rodin / Hyper3D (Gen-2.5), un servicio externo con cobro por créditos. Como es gratis para el visitante, cada una la pagas tú:

- `PREVIEW_TIER` define el nivel de detalle (`Gen-2.5-Low`, `Gen-2.5-Medium` o `Gen-2.5-High`).
- `PREVIEW_LIMIT_PER_HOUR` limita cuántas puede pedir una misma IP por hora.

El servidor arma el prompt para mascotas en `buildPetPrompt` (`server.mjs`); el visitante solo indica el animal y, si quiere, algún detalle. La foto no se guarda en este servidor. El visor muestra la figura en blanco, como se imprime, o con los colores de la foto.

## Tamaños y precios

`catalogo.json` es la única fuente de tallas, medidas y precios: la leen la portada, el creador y el servidor. Cámbialos ahí.

## Reservas

Al reservar, el servidor agrega una línea a `pedidos/pedidos.jsonl` (código, talla, precio, nombre, correo, mascota y comentarios) y guarda el modelo como `pedidos/<código>.glb`. Esa carpeta no se sirve por la web ni entra a git. Todavía no hay pago en línea.

Para revisarlas, define `ADMIN_PASSWORD` en `.env`, reinicia el servidor y abre [http://127.0.0.1:4173/admin.html](http://127.0.0.1:4173/admin.html). El panel lista las reservas, permite marcar su estado (nueva, contactada, pagada, enviada o cancelada; se guarda en `pedidos/estados.json`) y descargar el modelo de cada una. La página no está enlazada desde el sitio y sin la clave no entrega ningún dato. Si publicas el sitio, hazlo con HTTPS para que la clave no viaje en claro.

## Avisos por correo

Cada reserva envía dos correos: un aviso al taller (al responderlo le escribes al cliente) y una confirmación al cliente con su código. Los textos están en `correo.mjs`. Se activan definiendo `SMTP_HOST`, `SMTP_USER` y `SMTP_PASS` en `.env`; con Gmail, usa `smtp.gmail.com` y una contraseña de aplicación. Si el envío falla, la reserva igual queda guardada y el error aparece en la consola del servidor.

El envío usa el paquete `nodemailer`: ejecuta `npm install` una vez antes de `npm start`.

Las vistas previas en curso se mantienen en memoria, así que se pierden al reiniciar el servidor; las reservas ya registradas no.
