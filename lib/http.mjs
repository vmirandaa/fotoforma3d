// Utilidades para responder y leer solicitudes, y para frenar intentos repetidos.
import fs from 'node:fs';

export function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(body);
}
// Envía un archivo del disco (modelo o foto). Devuelve false si el archivo no existe, para que quien llama responda.
export async function sendFile(response, filePath, type, extraHeaders = {}) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return false;
  }
  response.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    ...extraHeaders,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff'
  });
  fs.createReadStream(filePath).pipe(response);
  return true;
}

export async function readRequestBody(request, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw Object.assign(new Error('La solicitud supera el tamaño permitido.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
// JSON pequeño (ingreso, seguimiento, cambio de estado). Devuelve null si no se puede leer.
export async function readSmallJson(request) {
  try {
    return JSON.parse((await readRequestBody(request, 2 * 1024)).toString('utf8'));
  } catch {
    return null;
  }
}
export async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

// Dirección del visitante. Detrás de un servicio de hosting (Render, Railway…) todas las visitas llegan desde
// el mismo intermediario: con TRUST_PROXY=true se usa la dirección real que ese intermediario informa.
// Es la última de X-Forwarded-For: la agrega el intermediario; las anteriores las puede inventar el visitante.
export function clientIp(request) {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = String(request.headers['x-forwarded-for'] || '')
      .split(',')
      .pop()
      .trim();
    if (forwarded) return forwarded;
  }
  return request.socket.remoteAddress || 'desconocida';
}
export function readCookie(request, name) {
  for (const part of String(request.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

// Intentos fallidos por dirección en los últimos 15 minutos (ingreso al panel, seguimiento).
// Olvida los intentos viejos de todas las direcciones, para que la lista no crezca sin fin.
export function tooManyFailures(map, ip, limit) {
  forgetOlderThan(map, Date.now() - 15 * 60 * 1000);
  return (map.get(ip)?.length || 0) >= limit;
}
// Deja en cada lista solo los momentos posteriores a `since`; borra las listas que quedan vacías.
export function forgetOlderThan(map, since) {
  for (const [key, times] of map) {
    const recent = times.filter((time) => time > since);
    if (recent.length) map.set(key, recent);
    else map.delete(key);
  }
}
export function noteFailure(map, ip) {
  const list = map.get(ip) || [];
  list.push(Date.now());
  map.set(ip, list);
}
