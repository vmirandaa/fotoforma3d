// Cuenta de administrador: usuario y clave en .env (ADMIN_USER y ADMIN_PASSWORD).
// Al ingresar se crea una sesión guardada en una cookie HttpOnly; el panel no envía la clave en cada pedido.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ORDERS_DIR } from './config.mjs';
import { sendJson, sendFile, readSmallJson, clientIp, readCookie, tooManyFailures, noteFailure } from './http.mjs';
import { safeEqual } from './pass.mjs';
import { ORDER_STATES, readOrders, saveOrderState } from './orders.mjs';

const SESSION_COOKIE = 'forma_admin';
const SESSION_TTL = 12 * 60 * 60 * 1000;
const adminSessions = new Map();
const adminFailures = new Map();
const PHOTO_TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const ADMIN_OFF =
  'El acceso de administrador está desactivado. Define ADMIN_USER y ADMIN_PASSWORD en el archivo .env y reinicia el servidor.';

function adminConfigured() {
  return Boolean(process.env.ADMIN_USER?.trim() && process.env.ADMIN_PASSWORD?.trim());
}
function adminSession(request) {
  const token = readCookie(request, SESSION_COOKIE);
  const session = token && adminSessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  return token;
}
// Con COOKIE_SECURE=true la cookie solo viaja por HTTPS: actívalo al publicar el sitio.
function sessionCookie(token, maxAgeSeconds) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  return SESSION_COOKIE + '=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAgeSeconds + secure;
}

export async function handleAdminLogin(request, response) {
  const ip = clientIp(request);
  if (!adminConfigured()) return sendJson(response, 503, { error: ADMIN_OFF });
  if (tooManyFailures(adminFailures, ip, 10))
    return sendJson(response, 429, { error: 'Demasiados intentos. Espera unos minutos.' });
  const body = await readSmallJson(request);
  const userOk = safeEqual(String(body?.user ?? '').trim(), process.env.ADMIN_USER.trim());
  const passwordOk = safeEqual(String(body?.password ?? ''), process.env.ADMIN_PASSWORD.trim());
  if (!userOk || !passwordOk) {
    noteFailure(adminFailures, ip);
    return sendJson(response, 401, { error: 'Usuario o clave incorrectos.' });
  }
  for (const [token, session] of adminSessions) if (session.expires < Date.now()) adminSessions.delete(token);
  const token = randomBytes(32).toString('hex');
  adminSessions.set(token, { expires: Date.now() + SESSION_TTL });
  response.setHeader('set-cookie', sessionCookie(token, SESSION_TTL / 1000));
  sendJson(response, 200, { ok: true });
}
export function handleAdminLogout(request, response) {
  const token = adminSession(request);
  if (token) adminSessions.delete(token);
  response.setHeader('set-cookie', sessionCookie('', 0));
  sendJson(response, 200, { ok: true });
}

// Todo lo que está bajo /api/admin/ (salvo ingresar y salir) exige una sesión activa.
export async function handleAdmin(request, response, pathname) {
  if (!adminConfigured()) return sendJson(response, 503, { error: ADMIN_OFF });
  if (!adminSession(request))
    return sendJson(response, 401, { error: 'Tu sesión de administrador no está activa. Ingresa de nuevo.' });
  if (request.method === 'GET' && pathname === '/api/admin/session') return sendJson(response, 200, { ok: true });

  if (request.method === 'GET' && pathname === '/api/admin/orders') {
    return sendJson(response, 200, { orders: await readOrders(), states: ORDER_STATES });
  }
  const modelMatch = pathname.match(/^\/api\/admin\/model\/(F-[0-9A-F]{8})$/);
  if (request.method === 'GET' && modelMatch) {
    const download = { 'content-disposition': 'attachment; filename="' + modelMatch[1] + '.glb"' };
    if (await sendFile(response, path.join(ORDERS_DIR, modelMatch[1] + '.glb'), 'model/gltf-binary', download)) return;
    return sendJson(response, 404, { error: 'Esta reserva no tiene copia del modelo.' });
  }
  const photoMatch = pathname.match(/^\/api\/admin\/photo\/(F-[0-9A-F]{8}-foto-[1-5]\.(jpg|png|webp))$/);
  if (request.method === 'GET' && photoMatch) {
    if (await sendFile(response, path.join(ORDERS_DIR, photoMatch[1]), PHOTO_TYPE[photoMatch[2]])) return;
    return sendJson(response, 404, { error: 'No se encontró la foto.' });
  }
  const statusMatch = pathname.match(/^\/api\/admin\/orders\/(F-[0-9A-F]{8})\/status$/);
  if (request.method === 'POST' && statusMatch) {
    const body = await readSmallJson(request);
    if (!body) return sendJson(response, 400, { error: 'Solicitud no válida.' });
    if (!ORDER_STATES.includes(body?.status)) return sendJson(response, 400, { error: 'Estado no válido.' });
    if (!(await readOrders()).some((order) => order.code === statusMatch[1]))
      return sendJson(response, 404, { error: 'No existe esa reserva.' });
    await saveOrderState(statusMatch[1], body.status);
    return sendJson(response, 200, { code: statusMatch[1], status: body.status });
  }
  return sendJson(response, 404, { error: 'No encontrado.' });
}
