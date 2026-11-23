// Servidor de FORMA: npm start. Atiende las páginas del sitio y la API; cada tema está en lib/:
//   config.mjs          .env, carpetas, puerto y servicio 3D
//   previews.mjs        fotos → servicio 3D → modelo
//   orders.mjs          reservas y seguimiento para clientes
//   admin.mjs           ingreso y panel de reservas
//   static.mjs          páginas, estilos e imágenes
import http from 'node:http';
import { HOST, PORT, provider } from './lib/config.mjs';
import { mailConfig } from './mailer.mjs';
import { ProviderError } from './providers/shared.mjs';
import { sendJson } from './lib/http.mjs';
import { issuePass } from './lib/pass.mjs';
import { handleGenerate, handleStatus, handleModel } from './lib/previews.mjs';
import { handleOrder, handleTracking, handleTrackingModel } from './lib/orders.mjs';
import { handleAdminLogin, handleAdminLogout, handleAdmin } from './lib/admin.mjs';
import { serveStatic } from './lib/static.mjs';

// Rutas fijas de la API: "MÉTODO /ruta" → función que la atiende.
const ROUTES = {
  'GET /api/pass': (request, response) => sendJson(response, 200, { pass: issuePass() }),
  'GET /api/health': (request, response) => sendJson(response, 200, { ready: provider.configured() }),
  'POST /api/generate': handleGenerate,
  'POST /api/order': handleOrder,
  'POST /api/tracking': handleTracking,
  'POST /api/tracking/model': handleTrackingModel,
  'POST /api/admin/login': handleAdminLogin,
  'POST /api/admin/logout': handleAdminLogout
};

async function route(request, response) {
  const { pathname } = new URL(request.url, 'http://' + HOST + ':' + PORT);
  const fixed = ROUTES[request.method + ' ' + pathname];
  if (fixed) return await fixed(request, response);
  if (pathname.startsWith('/api/admin/')) return await handleAdmin(request, response, pathname);
  const statusMatch = pathname.match(/^\/api\/status\/([0-9a-f-]{36})$/i);
  if (request.method === 'GET' && statusMatch) return await handleStatus(statusMatch[1], response);
  const modelMatch = pathname.match(/^\/api\/model\/([0-9a-f-]{36})$/i);
  if (request.method === 'GET' && modelMatch) return await handleModel(modelMatch[1], response);
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return sendJson(response, 405, { error: 'Método no permitido.' });
  const wantsHtml = String(request.headers.accept || '').includes('text/html') && !pathname.startsWith('/api/');
  return await serveStatic(pathname, response, wantsHtml);
}

const server = http.createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    // Un error del servicio 3D trae un mensaje apto para el cliente; el detalle técnico queda en la consola.
    if (error instanceof ProviderError) console.error(provider.name + ': ' + error.message);
    const message = error instanceof ProviderError ? error.userMessage : error.message;
    if (!response.headersSent)
      sendJson(response, error.status || 502, { error: message || 'Error al procesar la solicitud.' });
    else response.destroy();
  }
});
server.listen(PORT, HOST, () => {
  console.log('FORMA disponible en http://' + HOST + ':' + PORT);
  console.log(
    'Servicio 3D: ' +
      provider.name +
      (provider.configured()
        ? ' (configurado).'
        : ' (falta ' + provider.keyName + ' en .env: las vistas previas están desactivadas).')
  );
  console.log(
    mailConfig()
      ? 'Avisos por correo activados.'
      : 'Avisos por correo desactivados: faltan SMTP_HOST, SMTP_USER o SMTP_PASS.'
  );
});
