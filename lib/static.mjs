// Archivos del sitio (páginas, estilos, scripts, imágenes). Nunca entrega los del servidor ni las reservas.
import path from 'node:path';
import fs from 'node:fs';
import { ROOT } from './config.mjs';
import { sendJson } from './http.mjs';

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp'
    }[extension] || 'application/octet-stream'
  );
}
// Página no encontrada: a un navegador se le muestra 404.html (la misma que usa GitHub Pages); al resto, JSON.
async function notFound(response, wantsHtml) {
  if (wantsHtml) {
    try {
      const page = await fs.promises.readFile(path.join(ROOT, '404.html'));
      response.writeHead(404, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': page.length,
        'x-content-type-options': 'nosniff'
      });
      return response.end(page);
    } catch {
      /* sin 404.html: se responde en JSON */
    }
  }
  return sendJson(response, 404, { error: 'No encontrado.' });
}
export async function serveStatic(urlPath, response, wantsHtml = false) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return sendJson(response, 400, { error: 'Ruta no válida.' });
  }
  if (decoded === '/') decoded = '/index.html';
  // En Windows, "archivo::$DATA" abre el archivo y se saltaría la lista de abajo; ninguna dirección del sitio lleva ":".
  if (decoded.includes(':')) return notFound(response, wantsHtml);
  const filePath = path.resolve(ROOT, '.' + decoded);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep))
    return sendJson(response, 403, { error: 'Ruta no permitida.' });
  const relativePath = path.relative(ROOT, filePath).toLowerCase();
  const topFolder = relativePath.split(path.sep)[0];
  // Lo que empieza con punto (.env, .git, .claude…) o guion bajo queda fuera por las dos últimas condiciones.
  if (
    ['package.json', 'package-lock.json', 'readme.md'].includes(relativePath) ||
    relativePath.endsWith('.mjs') ||
    ['pedidos', 'node_modules'].includes(topFolder) ||
    topFolder.startsWith('.') ||
    topFolder.startsWith('_')
  ) {
    return notFound(response, wantsHtml);
  }
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return notFound(response, wantsHtml);
    response.writeHead(200, {
      'content-type': contentType(filePath),
      'content-length': stat.size,
      'x-content-type-options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(response);
  } catch {
    notFound(response, wantsHtml);
  }
}
