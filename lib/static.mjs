// Archivos del sitio (páginas, estilos, scripts, imágenes). Nunca entrega los del servidor ni las reservas.
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, ORDERS_DIR } from './config.mjs';
import { sendJson, SECURITY_HEADERS, contentSecurityPolicy } from './http.mjs';

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
        ...SECURITY_HEADERS,
        'content-security-policy': contentSecurityPolicy(page)
      });
      return response.end(page);
    } catch {
      /* sin 404.html: se responde en JSON */
    }
  }
  return sendJson(response, 404, { error: 'No encontrado.' });
}
// Solo se publica lo que usa el sitio: las páginas y el favicon de la raíz, y estas carpetas. Todo lo demás
// (servidor, .env, pedidos, scss, node_modules…) queda fuera sin tener que nombrarlo.
// En minúsculas porque Windows y macOS abren "Pedidos" aunque se pida "pedidos".
const PUBLIC_FOLDERS = ['assets', 'css', 'data', 'js'];
const ORDERS_PATH = path.relative(ROOT, ORDERS_DIR).toLowerCase();
function isPublic(relativePath) {
  // Las reservas nunca se entregan, aunque ORDERS_DIR apunte dentro de una carpeta pública.
  if (relativePath === ORDERS_PATH || relativePath.startsWith(ORDERS_PATH + path.sep)) return false;
  const [top, ...rest] = relativePath.split(path.sep);
  return rest.length ? PUBLIC_FOLDERS.includes(top) : top.endsWith('.html') || top === 'favicon.svg';
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
  if (!isPublic(path.relative(ROOT, filePath).toLowerCase())) return notFound(response, wantsHtml);
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return notFound(response, wantsHtml);
    const headers = { 'content-type': contentType(filePath), 'content-length': stat.size, ...SECURITY_HEADERS };
    // Las páginas se leen enteras para calcular la política con los hashes de sus scripts en línea.
    if (filePath.endsWith('.html')) {
      const page = await fs.promises.readFile(filePath);
      response.writeHead(200, { ...headers, 'content-security-policy': contentSecurityPolicy(page) });
      return response.end(page);
    }
    response.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(response);
  } catch {
    notFound(response, wantsHtml);
  }
}
