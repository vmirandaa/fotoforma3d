import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { sendOrderEmails, mailConfig } from './correo.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadLocalEnv();
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
// RODIN_API_BASE permite apuntar a un proveedor simulado para pruebas.
const API_BASE = (process.env.RODIN_API_BASE || 'https://api.hyper3d.com/api/v2').replace(/\/+$/, '');
const MAX_BODY = 130 * 1024 * 1024;
// Carpeta de reservas. ORDERS_DIR permite apuntar a otra (por ejemplo, datos de demostración).
const ORDERS_DIR = process.env.ORDERS_DIR ? path.resolve(process.env.ORDERS_DIR) : path.join(ROOT, 'pedidos');
const TIERS = ['Gen-2.5-Low', 'Gen-2.5-Medium', 'Gen-2.5-High'];
const SPECIES = { perro: 'dog', gato: 'cat', otro: 'pet animal' };
const tasks = new Map();
const previewLog = new Map();
const ORDERS_FILE = path.join(ORDERS_DIR, 'pedidos.jsonl');
const STATES_FILE = path.join(ORDERS_DIR, 'estados.json');
const ORDER_STATES = ['nueva', 'contactada', 'pagada', 'enviada', 'cancelada'];
const ORDER_CODE = /^F-[0-9A-F]{8}$/;
const adminFailures = new Map();
// Las fotos de una vista previa se guardan aquí de forma temporal; solo pasan a la carpeta de reservas si el cliente reserva.
const PHOTO_TMP = path.join(os.tmpdir(), 'forma-fotos-' + PORT);
const PHOTO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PHOTO_TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const PHOTO_FILE = /^F-[0-9A-F]{8}-foto-[1-5]\.(jpg|png|webp)$/;
const PHOTO_LABELS = ['?', 'Front', 'Front-Left', 'Front-Right', 'Back', 'Back-Left', 'Back-Right', 'Left', 'Right', 'Up', 'Down'];
const PREVIEW_TTL = 24 * 60 * 60 * 1000;
fs.rmSync(PHOTO_TMP, { recursive: true, force: true });
// Las vistas previas que nadie reservó se olvidan, junto con sus fotos, después de 24 horas.
setInterval(() => {
  for (const [id, task] of tasks) {
    if (Date.now() - task.createdAt < PREVIEW_TTL) continue;
    fs.rmSync(path.join(PHOTO_TMP, id), { recursive: true, force: true });
    tasks.delete(id);
  }
}, 60 * 60 * 1000).unref();

function loadLocalEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(body);
}
function getApiKey() { return process.env.RODIN_API_KEY?.trim(); }
// Nivel de detalle de la vista previa gratuita. Bájalo a Gen-2.5-Low para gastar menos créditos por visitante.
function previewTier() {
  const tier = process.env.PREVIEW_TIER?.trim();
  return TIERS.includes(tier) ? tier : 'Gen-2.5-Medium';
}
// Cada vista previa consume créditos: se limita cuántas puede pedir una misma IP por hora (0 = sin límite).
function previewAllowed(ip) {
  const configured = Number(process.env.PREVIEW_LIMIT_PER_HOUR ?? 6);
  const limit = Number.isFinite(configured) ? configured : 6;
  if (limit <= 0) return true;
  const since = Date.now() - 60 * 60 * 1000;
  const recent = (previewLog.get(ip) || []).filter((time) => time > since);
  if (recent.length >= limit) { previewLog.set(ip, recent); return false; }
  recent.push(Date.now());
  previewLog.set(ip, recent);
  return true;
}
function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const TAIL_OPTIONS = ['visible', 'oculta', 'sin-cola'];
function buildPetPrompt(species, notes, tail, tailNotes) {
  const animal = SPECIES[species] || SPECIES.otro;
  const parts = [
    'A single ' + animal + ', full body, faithful to the reference photos: same pose, ears, tail, snout and body proportions.',
    'Solid collectible figurine suitable for 3D printing, sturdy shapes, fur simplified into clean sculpted volumes, no thin fragile parts.',
    'Keep ears, tongue and tail thick and attached to the body; whiskers only as shallow relief, never as separate strands.',
    'Only the animal: no background, no floor, no people, no leash or other objects.'
  ];
  // La cola es lo que más falla cuando no aparece en las fotos.
  if (tail === 'oculta') {
    parts.push(tailNotes
      ? 'The tail is not visible in the photos. Owner description of the tail: ' + tailNotes
      : 'The tail is not visible in the photos: give it a natural tail for this animal, resting against the body.');
  }
  if (tail === 'sin-cola') parts.push('The animal has no tail or only a very short docked tail.');
  if (notes) parts.push('Owner notes: ' + notes);
  return parts.join(' ').slice(0, 900);
}
// Resumen en español de la cola para el panel de reservas.
function tailSummary(tail, tailNotes) {
  if (tail === 'oculta') return 'Cola (no se ve en las fotos): ' + (tailNotes || 'sin descripción');
  if (tail === 'sin-cola') return 'No tiene cola o es muy corta';
  return '';
}
function loadCatalog() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'catalogo.json'), 'utf8'));
}
async function readRequestBody(request, limit = MAX_BODY) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw Object.assign(new Error('La solicitud supera el tamaño permitido.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function parseJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error('El servicio 3D respondió con un mensaje inesperado.'); }
}
async function postRodin(endpoint, payload) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(API_BASE + endpoint, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + getApiKey(), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000)
    });
    if (response.status === 429 && attempt < 4) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : (attempt + 1) * 5000));
      continue;
    }
    const result = await parseJson(response);
    if (!response.ok || result.error) {
      throw Object.assign(new Error(result.message || result.error || 'El servicio 3D rechazó la solicitud.'), { status: response.status || 502 });
    }
    return result;
  }
  throw Object.assign(new Error('El servicio 3D está ocupado. Espera un momento e inténtalo nuevamente.'), { status: 429 });
}

async function handleGenerate(request, response) {
  if (!getApiKey()) return sendJson(response, 503, { error: 'El estudio todavía no está conectado al servicio de generación 3D.' });
  if (!previewAllowed(request.socket.remoteAddress || 'desconocida')) {
    request.resume();
    return sendJson(response, 429, { error: 'Ya generaste varias vistas previas hace poco. Vuelve a intentarlo en un rato.' });
  }
  const rawBody = await readRequestBody(request);
  const contentType = request.headers['content-type'] || '';
  const formRequest = new Request('http://127.0.0.1/api/generate', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: rawBody,
    duplex: 'half'
  });
  const incoming = await formRequest.formData();
  const images = incoming.getAll('images').filter((item) => typeof item.arrayBuffer === 'function');
  if (images.length < 1 || images.length > 5) return sendJson(response, 400, { error: 'Selecciona entre una y cinco imágenes.' });
  for (const image of images) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) return sendJson(response, 400, { error: 'Las imágenes deben ser JPG, PNG o WEBP.' });
    if (image.size > 25 * 1024 * 1024) return sendJson(response, 413, { error: 'Cada imagen puede pesar hasta 25 MB.' });
  }
  const tier = previewTier();
  const species = Object.hasOwn(SPECIES, String(incoming.get('species'))) ? String(incoming.get('species')) : 'otro';
  const petName = cleanText(incoming.get('petName'), 40);
  const petNotes = cleanText(incoming.get('notes'), 300);
  const tail = TAIL_OPTIONS.includes(String(incoming.get('tail'))) ? String(incoming.get('tail')) : '';
  const tailNotes = tail === 'oculta' ? cleanText(incoming.get('tailNotes'), 120) : '';
  const prompt = buildPetPrompt(species, petNotes, tail, tailNotes);
  const petDetails = [tailSummary(tail, tailNotes), petNotes].filter(Boolean).join('. ');
  const labels = incoming.getAll('image_label').map((value) => String(value));
  const id = randomUUID();
  const photoDir = path.join(PHOTO_TMP, id);
  await fs.promises.mkdir(photoDir, { recursive: true });
  const photos = [];
  const upstream = new FormData();
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const bytes = new Uint8Array(await image.arrayBuffer());
    const photoName = 'foto-' + (index + 1) + '.' + PHOTO_EXT[image.type];
    await fs.promises.writeFile(path.join(photoDir, photoName), bytes);
    photos.push({ file: photoName, label: PHOTO_LABELS.includes(labels[index]) ? labels[index] : '?' });
    upstream.append('images', new Blob([bytes], { type: image.type }), image.name || ('reference-' + (index + 1)));
    if (labels[index]) upstream.append('image_label', labels[index]);
  }
  upstream.append('tier', tier);
  upstream.append('mesh_mode', 'Quad');
  upstream.append('quality', 'high');
  upstream.append('geometry_file_format', 'glb');
  upstream.append('material', 'PBR');
  upstream.append('prompt', prompt);

  let upstreamResponse;
  let result;
  try {
    upstreamResponse = await fetch(API_BASE + '/rodin', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + getApiKey() },
      body: upstream,
      signal: AbortSignal.timeout(120_000)
    });
    result = await parseJson(upstreamResponse);
  } catch (error) {
    fs.rmSync(photoDir, { recursive: true, force: true });
    throw error;
  }
  if (!upstreamResponse.ok || result.error || !result.uuid || !result.jobs?.subscription_key) {
    fs.rmSync(photoDir, { recursive: true, force: true });
    return sendJson(response, upstreamResponse.status || 502, { error: result.message || result.error || 'No se pudo iniciar la generación.' });
  }
  tasks.set(id, {
    providerUuid: result.uuid,
    subscriptionKey: result.jobs.subscription_key,
    state: 'waiting',
    files: [],
    species,
    petName,
    petNotes: petDetails,
    photos,
    photoDir,
    createdAt: Date.now()
  });
  sendJson(response, 202, { id });
}

// Registra la reserva en pedidos/pedidos.jsonl y guarda una copia del modelo y de las fotos para fabricarla.
async function handleOrder(request, response) {
  let body;
  try { body = JSON.parse((await readRequestBody(request, 20 * 1024)).toString('utf8')); } catch (error) {
    return sendJson(response, error.status || 400, { error: 'No se pudo leer la reserva.' });
  }
  const task = tasks.get(String(body?.taskId || ''));
  if (!task || task.state !== 'done' || !task.glb) return sendJson(response, 409, { error: 'La vista previa ya no está disponible. Genérala de nuevo para reservar.' });
  const size = loadCatalog().tallas.find((item) => item.id === body.size);
  if (!size) return sendJson(response, 400, { error: 'Elige un tamaño para tu figura.' });
  const name = cleanText(body.name, 80);
  const email = cleanText(body.email, 120);
  if (!name) return sendJson(response, 400, { error: 'Escribe tu nombre para reservar.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(response, 400, { error: 'Revisa tu correo: lo usaremos para confirmar el pedido.' });
  if (task.orderCode) return sendJson(response, 200, { code: task.orderCode });

  const code = 'F-' + randomUUID().slice(0, 8).toUpperCase();
  await fs.promises.mkdir(ORDERS_DIR, { recursive: true });
  let modelFile = null;
  try {
    const modelResponse = await fetch(task.glb, { signal: AbortSignal.timeout(90_000) });
    if (modelResponse.ok) {
      modelFile = code + '.glb';
      await fs.promises.writeFile(path.join(ORDERS_DIR, modelFile), Buffer.from(await modelResponse.arrayBuffer()));
    }
  } catch { modelFile = null; }
  const photos = [];
  for (const photo of task.photos || []) {
    const file = code + '-' + photo.file;
    try {
      await fs.promises.copyFile(path.join(task.photoDir, photo.file), path.join(ORDERS_DIR, file));
      photos.push({ file, label: photo.label });
    } catch { /* la foto temporal ya no está: la reserva sigue sin ella */ }
  }
  const order = {
    code,
    createdAt: new Date().toISOString(),
    size: size.id,
    measure: size.medida,
    price: size.precio,
    name,
    email,
    petName: task.petName,
    species: task.species,
    petNotes: task.petNotes || '',
    notes: cleanText(body.notes, 400),
    modelFile,
    photos,
    providerUuid: task.providerUuid
  };
  await fs.promises.appendFile(ORDERS_FILE,JSON.stringify(order) + '\n', 'utf8');
  task.orderCode = code;
  console.log('Nueva reserva ' + code + ' · ' + size.medida + ' · ' + photos.length + ' foto(s)' + (modelFile ? '' : ' · SIN COPIA DEL MODELO'));
  sendJson(response, 201, { code });
  // El aviso por correo va después de responder: si falla, la reserva ya quedó guardada.
  sendOrderEmails(order).then((mail) => {
    if (!mail.configured) return;
    if (mail.shop && mail.customer) console.log('Correos de la reserva ' + code + ' enviados.');
    else console.error('Reserva ' + code + ': aviso al taller ' + (mail.shop ? 'enviado' : 'FALLÓ') + ', confirmación al cliente ' + (mail.customer ? 'enviada' : 'FALLÓ') + '. ' + (mail.error || ''));
  });
}

async function handleStatus(id, response) {
  const task = tasks.get(id);
  if (!task) return sendJson(response, 404, { error: 'No se encontró esta generación en el estudio.' });
  if (task.state === 'failed') return sendJson(response, 200, { status: 'failed', error: task.error || 'La generación falló.' });
  if (task.state === 'done') return sendJson(response, 200, { status: 'done', modelReady: Boolean(task.glb) });
  if (!getApiKey()) return sendJson(response, 503, { error: 'No hay una clave de generación configurada en el servidor.' });

  const status = await postRodin('/status', { subscription_key: task.subscriptionKey });
  const jobs = Array.isArray(status.jobs) ? status.jobs : [];
  if (!jobs.length) return sendJson(response, 200, { status: task.state, message: status.message || 'Esperando información del servicio.' });
  if (jobs.some((job) => job.status === 'Failed')) {
    task.state = 'failed';
    task.error = status.message || 'El servicio no pudo completar el modelo.';
    return sendJson(response, 200, { status: 'failed', error: task.error });
  }
  const done = jobs.every((job) => job.status === 'Done');
  task.state = done ? 'downloading' : (jobs.some((job) => job.status === 'Generating') ? 'generating' : 'waiting');
  if (!done) return sendJson(response, 200, { status: task.state });
  const download = await postRodin('/download', { task_uuid: task.providerUuid });
  task.files = Array.isArray(download.list) ? download.list : [];
  const glbFile = task.files.find((file) => /\.glb(?:$|[?#])/i.test(file.name || ''));
  if (!glbFile?.url) {
    task.state = 'failed';
    task.error = 'El servicio terminó, pero no incluyó el archivo GLB.';
    return sendJson(response, 200, { status: 'failed', error: task.error });
  }
  task.glb = glbFile.url;
  task.state = 'done';
  sendJson(response, 200, { status: 'done', modelReady: true });
}

async function handleModel(id, response) {
  const task = tasks.get(id);
  if (!task || task.state !== 'done' || !task.glb) return sendJson(response, 404, { error: 'El modelo todavía no está disponible.' });
  const modelResponse = await fetch(task.glb, { signal: AbortSignal.timeout(90_000) });
  if (!modelResponse.ok) return sendJson(response, 502, { error: 'No se pudo recuperar el modelo generado.' });
  const headers = {
    'content-type': 'model/gltf-binary',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff'
  };
  response.writeHead(200, headers);
  if (!modelResponse.body) return response.end();
  for await (const chunk of modelResponse.body) response.write(Buffer.from(chunk));
  response.end();
}

// --- Panel privado de reservas (admin.html). Se activa definiendo ADMIN_PASSWORD en .env. ---
function adminKeyMatches(request) {
  const expected = process.env.ADMIN_PASSWORD?.trim();
  if (!expected) return null;
  let given = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try { given = decodeURIComponent(given); } catch { return false; }
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
async function readJsonFile(filePath, fallback) {
  try { return JSON.parse(await fs.promises.readFile(filePath, 'utf8')); } catch { return fallback; }
}
async function readOrders() {
  let text = '';
  try { text = await fs.promises.readFile(ORDERS_FILE, 'utf8'); } catch { return []; }
  const states = await readJsonFile(STATES_FILE, {});
  const orders = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const order = JSON.parse(line);
      if (!ORDER_CODE.test(order.code)) continue;
      const hasModel = Boolean(order.modelFile) && fs.existsSync(path.join(ORDERS_DIR, order.code + '.glb'));
      const state = states[order.code];
      const photos = (Array.isArray(order.photos) ? order.photos : [])
        .filter((photo) => PHOTO_FILE.test(photo?.file) && photo.file.startsWith(order.code + '-'))
        .map((photo) => ({ file: photo.file, label: PHOTO_LABELS.includes(photo.label) ? photo.label : '?' }));
      orders.push({ ...order, photos, hasModel, status: ORDER_STATES.includes(state?.status) ? state.status : 'nueva' });
    } catch { /* línea dañada: se omite */ }
  }
  return orders.reverse();
}
async function handleAdmin(request, response, pathname) {
  const ip = request.socket.remoteAddress || 'desconocida';
  const since = Date.now() - 15 * 60 * 1000;
  const failures = (adminFailures.get(ip) || []).filter((time) => time > since);
  if (failures.length >= 10) return sendJson(response, 429, { error: 'Demasiados intentos. Espera unos minutos.' });
  const authorized = adminKeyMatches(request);
  if (authorized === null) return sendJson(response, 503, { error: 'El panel está desactivado. Define ADMIN_PASSWORD en el archivo .env y reinicia el servidor.' });
  if (!authorized) {
    failures.push(Date.now());
    adminFailures.set(ip, failures);
    return sendJson(response, 401, { error: 'Clave incorrecta.' });
  }

  if (request.method === 'GET' && pathname === '/api/admin/orders') {
    return sendJson(response, 200, { orders: await readOrders(), states: ORDER_STATES });
  }
  const modelMatch = pathname.match(/^\/api\/admin\/model\/(F-[0-9A-F]{8})$/);
  if (request.method === 'GET' && modelMatch) {
    const filePath = path.join(ORDERS_DIR, modelMatch[1] + '.glb');
    let stat;
    try { stat = await fs.promises.stat(filePath); } catch { return sendJson(response, 404, { error: 'Esta reserva no tiene copia del modelo.' }); }
    response.writeHead(200, {
      'content-type': 'model/gltf-binary',
      'content-length': stat.size,
      'content-disposition': 'attachment; filename="' + modelMatch[1] + '.glb"',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff'
    });
    return fs.createReadStream(filePath).pipe(response);
  }
  const photoMatch = pathname.match(/^\/api\/admin\/photo\/(F-[0-9A-F]{8}-foto-[1-5]\.(jpg|png|webp))$/);
  if (request.method === 'GET' && photoMatch) {
    const filePath = path.join(ORDERS_DIR, photoMatch[1]);
    let stat;
    try { stat = await fs.promises.stat(filePath); } catch { return sendJson(response, 404, { error: 'No se encontró la foto.' }); }
    response.writeHead(200, {
      'content-type': PHOTO_TYPE[photoMatch[2]],
      'content-length': stat.size,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff'
    });
    return fs.createReadStream(filePath).pipe(response);
  }
  const statusMatch = pathname.match(/^\/api\/admin\/orders\/(F-[0-9A-F]{8})\/status$/);
  if (request.method === 'POST' && statusMatch) {
    let body;
    try { body = JSON.parse((await readRequestBody(request, 2 * 1024)).toString('utf8')); } catch { return sendJson(response, 400, { error: 'Solicitud no válida.' }); }
    if (!ORDER_STATES.includes(body?.status)) return sendJson(response, 400, { error: 'Estado no válido.' });
    if (!(await readOrders()).some((order) => order.code === statusMatch[1])) return sendJson(response, 404, { error: 'No existe esa reserva.' });
    const states = await readJsonFile(STATES_FILE, {});
    states[statusMatch[1]] = { status: body.status, updatedAt: new Date().toISOString() };
    await fs.promises.writeFile(STATES_FILE, JSON.stringify(states, null, 2), 'utf8');
    return sendJson(response, 200, { code: statusMatch[1], status: body.status });
  }
  return sendJson(response, 404, { error: 'No encontrado.' });
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp'
  })[extension] || 'application/octet-stream';
}
async function serveStatic(urlPath, response) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split('?')[0]); } catch { return sendJson(response, 400, { error: 'Ruta no válida.' }); }
  if (decoded === '/') decoded = '/index.html';
  const filePath = path.resolve(ROOT, '.' + decoded);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return sendJson(response, 403, { error: 'Ruta no permitida.' });
  const relativePath = path.relative(ROOT, filePath).toLowerCase();
  const topFolder = relativePath.split(path.sep)[0];
  if (['.env', '.env.example', 'package.json', 'package-lock.json', 'readme.md', '.gitignore'].includes(relativePath) || relativePath.endsWith('.mjs') || ['pedidos', 'node_modules'].includes(topFolder) || topFolder.startsWith('.') || topFolder.startsWith('_')) {
    return sendJson(response, 404, { error: 'No encontrado.' });
  }
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return sendJson(response, 404, { error: 'No encontrado.' });
    response.writeHead(200, { 'content-type': contentType(filePath), 'content-length': stat.size, 'x-content-type-options': 'nosniff' });
    fs.createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: 'No encontrado.' });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const parsed = new URL(request.url, 'http://' + HOST + ':' + PORT);
    if (request.method === 'GET' && parsed.pathname === '/api/health') {
      return sendJson(response, 200, { ready: Boolean(getApiKey()) });
    }
    if (request.method === 'POST' && parsed.pathname === '/api/generate') return await handleGenerate(request, response);
    if (request.method === 'POST' && parsed.pathname === '/api/order') return await handleOrder(request, response);
    if (parsed.pathname.startsWith('/api/admin/')) return await handleAdmin(request, response, parsed.pathname);
    const statusMatch = parsed.pathname.match(/^\/api\/status\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && statusMatch) return await handleStatus(statusMatch[1], response);
    const modelMatch = parsed.pathname.match(/^\/api\/model\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && modelMatch) return await handleModel(modelMatch[1], response);
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Método no permitido.' });
    return await serveStatic(parsed.pathname, response);
  } catch (error) {
    if (!response.headersSent) sendJson(response, error.status || 502, { error: error.message || 'Error al procesar la solicitud.' });
    else response.destroy();
  }
});
server.listen(PORT, HOST, () => {
  console.log('FORMA disponible en http://' + HOST + ':' + PORT);
  console.log(getApiKey() ? 'Servicio de generación configurado.' : 'Configura RODIN_API_KEY para activar modelos 3D.');
  console.log(mailConfig() ? 'Avisos por correo activados.' : 'Avisos por correo desactivados: faltan SMTP_HOST, SMTP_USER o SMTP_PASS.');
});
