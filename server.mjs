import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { sendOrderEmails, mailConfig } from './mailer.mjs';
import { activeProvider } from './providers/index.mjs';
import { ProviderError } from './providers/shared.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadLocalEnv();
// Servicio de generación 3D en uso (PROVIDER en .env: tripo o rodin). Cada uno está en la carpeta providers/.
const provider = activeProvider();
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 130 * 1024 * 1024;
// Carpeta de reservas. ORDERS_DIR permite apuntar a otra (por ejemplo, datos de demostración).
const ORDERS_DIR = process.env.ORDERS_DIR ? path.resolve(process.env.ORDERS_DIR) : path.join(ROOT, 'pedidos');
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
// Dirección del visitante. Detrás de un servicio de hosting (Render, Railway…) todas las visitas llegan desde
// el mismo intermediario: con TRUST_PROXY=true se usa la dirección real que ese intermediario informa.
function clientIp(request) {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return request.socket.remoteAddress || 'desconocida';
}
function envLimit(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
// Cada vista previa consume créditos. Límites (0 = sin límite):
// - PREVIEW_LIMIT_PER_HOUR y PREVIEW_LIMIT_PER_DAY: por conexión.
// - PREVIEW_DAILY_BUDGET: total del sitio en 24 horas, para acotar el gasto aunque lleguen muchas visitas.
// Los conteos viven en memoria: se reinician si se reinicia el servidor.
const previewTotal = [];
function previewLimitReached(ip) {
  const now = Date.now();
  const recent = (previewLog.get(ip) || []).filter((time) => time > now - 24 * 60 * 60 * 1000);
  previewLog.set(ip, recent);
  while (previewTotal.length && previewTotal[0] <= now - 24 * 60 * 60 * 1000) previewTotal.shift();
  const perHour = envLimit('PREVIEW_LIMIT_PER_HOUR', 6);
  const perDay = envLimit('PREVIEW_LIMIT_PER_DAY', 15);
  const budget = envLimit('PREVIEW_DAILY_BUDGET', 100);
  if (budget > 0 && previewTotal.length >= budget) return 'Hoy ya se generaron muchas vistas previas. Vuelve a intentarlo mañana o escríbenos y te ayudamos.';
  if (perDay > 0 && recent.length >= perDay) return 'Ya generaste varias vistas previas hoy. Vuelve a intentarlo mañana.';
  if (perHour > 0 && recent.filter((time) => time > now - 60 * 60 * 1000).length >= perHour) return 'Ya generaste varias vistas previas hace poco. Vuelve a intentarlo en un rato.';
  return '';
}
function notePreview(ip) {
  const times = previewLog.get(ip) || [];
  times.push(Date.now());
  previewLog.set(ip, times);
  previewTotal.push(Date.now());
}

// --- Pase del creador: una firma que el servidor entrega al abrir la página y que se exige para generar.
// Un programa que llame directo a /api/generate sin pasar por la página no lo tiene. Cada pase sirve una vez,
// vale 6 horas y no se acepta antes de unos segundos: una persona tarda más que eso en subir fotos y responder.
const PASS_SECRET = randomBytes(32);
const PASS_MIN_AGE = 4000;
const PASS_MAX_AGE = 6 * 60 * 60 * 1000;
const usedPasses = new Map();
function signPass(issued, nonce) {
  return createHmac('sha256', PASS_SECRET).update(issued + '.' + nonce).digest('base64url');
}
function issuePass() {
  const issued = Date.now();
  const nonce = randomBytes(12).toString('base64url');
  return issued + '.' + nonce + '.' + signPass(issued, nonce);
}
function checkPass(value) {
  const [issued, nonce, signature] = String(value || '').split('.');
  if (!issued || !nonce || !signature) return 'missing';
  if (!safeEqual(signature, signPass(issued, nonce))) return 'invalid';
  const age = Date.now() - Number(issued);
  if (!(age >= 0) || age > PASS_MAX_AGE) return 'expired';
  if (age < PASS_MIN_AGE) return 'too-fast';
  for (const [key, until] of usedPasses) if (until < Date.now()) usedPasses.delete(key);
  if (usedPasses.has(nonce)) return 'used';
  usedPasses.set(nonce, Number(issued) + PASS_MAX_AGE);
  return '';
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
// Extras del pedido (formato, estilo, base y cantidad): se validan contra data/catalog.json y el precio se calcula aquí,
// nunca con lo que mande el navegador. Devuelve { error } si algo no corresponde.
function readOrderExtras(catalog, body) {
  const extras = catalog.extras || {};
  const pick = (list, id) => {
    if (!Array.isArray(list) || !list.length) return null;
    return id ? list.find((item) => item.id === id) : list[0];
  };
  const formato = pick(extras.formatos, body.format);
  const estilo = pick(extras.estilos, body.style);
  const base = pick(extras.bases, body.base);
  if ((body.format && !formato) || (body.style && !estilo) || (body.base && !base)) return { error: 'Alguna de las opciones elegidas ya no está disponible. Recarga la página.' };
  const max = Number(extras.cantidadMaxima) || 10;
  const quantity = Number(body.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) return { error: 'La cantidad debe ser entre 1 y ' + max + '.' };
  const baseName = base?.conNombre ? cleanText(body.baseName, 24) : '';
  if (base?.conNombre && !baseName) return { error: 'Escribe el nombre que va en la base.' };
  const extraPrice = [formato, estilo, base].reduce((total, item) => total + (Number(item?.precio) || 0), 0);
  // Resumen legible para el panel, Mi pedido y los correos. Solo nombra lo que se aparta de lo básico.
  const parts = [];
  if (formato && Number(formato.precio) > 0) parts.push(formato.nombre.charAt(0).toLowerCase() + formato.nombre.slice(1));
  if (estilo && Number(estilo.precio) > 0) parts.push('estilo ' + estilo.nombre.toLowerCase());
  if (base && Number(base.precio) > 0) parts.push(base.conNombre ? base.nombre.toLowerCase() + ' «' + baseName + '»' : base.nombre.toLowerCase());
  return {
    format: formato?.id || '',
    style: estilo?.id || '',
    base: base?.id || '',
    baseName,
    quantity,
    extraPrice,
    extrasText: parts.join(' · ')
  };
}
function loadCatalog() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog.json'), 'utf8'));
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
async function handleGenerate(request, response) {
  if (!provider.configured()) return sendJson(response, 503, { error: 'El estudio todavía no está conectado al servicio de generación 3D.' });
  const ip = clientIp(request);
  // El pase va en un encabezado: se revisa antes de leer las fotos, así un envío automático no consume nada.
  const passProblem = checkPass(request.headers['x-forma-pase']);
  if (passProblem) {
    request.resume();
    if (passProblem !== 'too-fast') console.warn('Vista previa rechazada (' + passProblem + ') desde ' + ip);
    return sendJson(response, 403, { error: 'No pudimos validar la página. Recárgala e inténtalo de nuevo.', code: 'pase', reason: passProblem });
  }
  const limitMessage = previewLimitReached(ip);
  if (limitMessage) {
    request.resume();
    return sendJson(response, 429, { error: limitMessage });
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
  // Campo trampa: está oculto para las personas, así que solo un programa lo llena.
  if (String(incoming.get('website') || '').trim()) {
    console.warn('Vista previa rechazada (campo trampa) desde ' + ip);
    return sendJson(response, 400, { error: 'No se pudo iniciar la vista previa.' });
  }
  const images = incoming.getAll('images').filter((item) => typeof item.arrayBuffer === 'function');
  if (images.length < 1 || images.length > 5) return sendJson(response, 400, { error: 'Selecciona entre una y cinco imágenes.' });
  for (const image of images) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) return sendJson(response, 400, { error: 'Las imágenes deben ser JPG, PNG o WEBP.' });
    if (image.size > 25 * 1024 * 1024) return sendJson(response, 413, { error: 'Cada imagen puede pesar hasta 25 MB.' });
  }
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
  const providerPhotos = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const bytes = new Uint8Array(await image.arrayBuffer());
    const photoName = 'foto-' + (index + 1) + '.' + PHOTO_EXT[image.type];
    const label = PHOTO_LABELS.includes(labels[index]) ? labels[index] : '?';
    await fs.promises.writeFile(path.join(photoDir, photoName), bytes);
    photos.push({ file: photoName, label });
    providerPhotos.push({ bytes, type: image.type, filename: image.name || photoName, label: labels[index] ? label : '' });
  }

  // Se cuenta antes de pedirla al servicio 3D: es el momento en que hay costo.
  notePreview(ip);
  let ref;
  try {
    ref = await provider.start({ photos: providerPhotos, prompt });
  } catch (error) {
    fs.rmSync(photoDir, { recursive: true, force: true });
    if (!(error instanceof ProviderError)) throw error;
    console.error(provider.name + ': no se pudo iniciar una vista previa. ' + error.message);
    return sendJson(response, error.status === 429 ? 429 : 502, { error: error.userMessage });
  }
  if (ref.mode) console.log(provider.name + ': vista previa iniciada (' + ref.mode + (ref.views ? ': ' + ref.views.join(', ') : '') + ').');
  tasks.set(id, {
    provider: provider.id,
    ref,
    state: 'waiting',
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
  if (!task || task.state !== 'done' || !task.modelPath) return sendJson(response, 409, { error: 'La vista previa ya no está disponible. Genérala de nuevo para reservar.' });
  const catalog = loadCatalog();
  const size = catalog.tallas.find((item) => item.id === body.size);
  if (!size) return sendJson(response, 400, { error: 'Elige un tamaño para tu figura.' });
  // Acabado: en blanco (incluido) o pintada por el taller, con el recargo que indica data/catalog.json para esa talla.
  const finish = body.finish === 'pintada' ? 'pintada' : 'blanco';
  const paintPrice = finish === 'pintada' ? Number(size.pintada) : 0;
  if (finish === 'pintada' && !(paintPrice > 0)) return sendJson(response, 400, { error: 'Esta talla no se ofrece pintada.' });
  const extras = readOrderExtras(catalog, body);
  if (extras.error) return sendJson(response, 400, { error: extras.error });
  const name = cleanText(body.name, 80);
  const email = cleanText(body.email, 120);
  if (!name) return sendJson(response, 400, { error: 'Escribe tu nombre para reservar.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(response, 400, { error: 'Revisa tu correo: lo usaremos para confirmar el pedido.' });
  if (task.orderCode) return sendJson(response, 200, { code: task.orderCode });

  const code = 'F-' + randomUUID().slice(0, 8).toUpperCase();
  await fs.promises.mkdir(ORDERS_DIR, { recursive: true });
  let modelFile = null;
  try {
    await fs.promises.copyFile(task.modelPath, path.join(ORDERS_DIR, code + '.glb'));
    modelFile = code + '.glb';
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
    finish,
    basePrice: size.precio,
    paintPrice,
    format: extras.format,
    style: extras.style,
    base: extras.base,
    baseName: extras.baseName,
    extraPrice: extras.extraPrice,
    extrasText: extras.extrasText,
    quantity: extras.quantity,
    unitPrice: size.precio + paintPrice + extras.extraPrice,
    price: (size.precio + paintPrice + extras.extraPrice) * extras.quantity,
    name,
    email,
    petName: task.petName,
    species: task.species,
    petNotes: task.petNotes || '',
    notes: cleanText(body.notes, 400),
    modelFile,
    photos,
    provider: task.provider,
    providerTask: task.ref
  };
  await fs.promises.appendFile(ORDERS_FILE,JSON.stringify(order) + '\n', 'utf8');
  task.orderCode = code;
  console.log('Nueva reserva ' + code + ' · ' + size.medida + (finish === 'pintada' ? ' pintada' : '') + (extras.extrasText ? ' · ' + extras.extrasText : '') + (extras.quantity > 1 ? ' · ' + extras.quantity + ' unidades' : '') + ' · ' + photos.length + ' foto(s)' + (modelFile ? '' : ' · SIN COPIA DEL MODELO'));
  sendJson(response, 201, { code });
  // El aviso por correo va después de responder: si falla, la reserva ya quedó guardada.
  sendOrderEmails(order).then((mail) => {
    if (!mail.configured) return;
    if (mail.shop && mail.customer) console.log('Correos de la reserva ' + code + ' enviados.');
    else console.error('Reserva ' + code + ': aviso al taller ' + (mail.shop ? 'enviado' : 'FALLÓ') + ', confirmación al cliente ' + (mail.customer ? 'enviada' : 'FALLÓ') + '. ' + (mail.error || ''));
  });
}

// Pregunta al servicio 3D cómo va la vista previa. Cuando está lista, descarga el modelo y lo guarda junto a las fotos:
// así el visor y la reserva no dependen de cuánto dure el enlace del servicio.
async function handleStatus(id, response) {
  const task = tasks.get(id);
  if (!task) return sendJson(response, 404, { error: 'No se encontró esta generación en el estudio.' });
  if (task.state === 'failed') return sendJson(response, 200, { status: 'failed', error: task.error || 'La generación falló.' });
  if (task.state === 'done') return sendJson(response, 200, { status: 'done', modelReady: true });
  if (task.downloading) return sendJson(response, 200, { status: 'downloading' });
  if (!provider.configured()) return sendJson(response, 503, { error: 'No hay una clave de generación configurada en el servidor.' });

  const result = await provider.status(task.ref);
  if (result.state === 'failed') {
    task.state = 'failed';
    task.error = result.error || 'El servicio no pudo completar el modelo.';
    return sendJson(response, 200, { status: 'failed', error: task.error });
  }
  if (result.state !== 'done') {
    task.state = result.state;
    return sendJson(response, 200, { status: task.state, progress: result.progress });
  }
  task.downloading = true;
  try {
    const modelResponse = await fetch(result.modelUrl, { signal: AbortSignal.timeout(120_000) });
    if (!modelResponse.ok) throw new Error('HTTP ' + modelResponse.status);
    task.modelPath = path.join(task.photoDir, 'modelo.glb');
    await fs.promises.writeFile(task.modelPath, Buffer.from(await modelResponse.arrayBuffer()));
    task.state = 'done';
  } catch (error) {
    console.error(provider.name + ': no se pudo descargar el modelo listo. ' + error.message);
    task.state = 'failed';
    task.error = 'La figura se generó, pero no se pudo descargar. Inténtalo de nuevo.';
    return sendJson(response, 200, { status: 'failed', error: task.error });
  } finally {
    task.downloading = false;
  }
  sendJson(response, 200, { status: 'done', modelReady: true });
}

async function handleModel(id, response) {
  const task = tasks.get(id);
  if (!task || task.state !== 'done' || !task.modelPath) return sendJson(response, 404, { error: 'El modelo todavía no está disponible.' });
  let stat;
  try { stat = await fs.promises.stat(task.modelPath); } catch { return sendJson(response, 404, { error: 'El modelo ya no está disponible.' }); }
  response.writeHead(200, {
    'content-type': 'model/gltf-binary',
    'content-length': stat.size,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff'
  });
  fs.createReadStream(task.modelPath).pipe(response);
}

// --- Cuenta de administrador: usuario y clave en .env (ADMIN_USER y ADMIN_PASSWORD).
// Al ingresar se crea una sesión guardada en una cookie HttpOnly; el panel ya no envía la clave en cada pedido.
const SESSION_COOKIE = 'forma_admin';
const SESSION_TTL = 12 * 60 * 60 * 1000;
const adminSessions = new Map();
const trackFailures = new Map();
function adminConfigured() {
  return Boolean(process.env.ADMIN_USER?.trim() && process.env.ADMIN_PASSWORD?.trim());
}
function safeEqual(given, expected) {
  const digest = (value) => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
function readCookie(request, name) {
  for (const part of String(request.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
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
function tooManyFailures(map, ip, limit) {
  const since = Date.now() - 15 * 60 * 1000;
  const recent = (map.get(ip) || []).filter((time) => time > since);
  map.set(ip, recent);
  return recent.length >= limit;
}
function noteFailure(map, ip) {
  const list = map.get(ip) || [];
  list.push(Date.now());
  map.set(ip, list);
}
async function readSmallJson(request) {
  try { return JSON.parse((await readRequestBody(request, 2 * 1024)).toString('utf8')); } catch { return null; }
}
async function handleAdminLogin(request, response) {
  const ip = clientIp(request);
  if (!adminConfigured()) return sendJson(response, 503, { error: 'El acceso de administrador está desactivado. Define ADMIN_USER y ADMIN_PASSWORD en el archivo .env y reinicia el servidor.' });
  if (tooManyFailures(adminFailures, ip, 10)) return sendJson(response, 429, { error: 'Demasiados intentos. Espera unos minutos.' });
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
function handleAdminLogout(request, response) {
  const token = adminSession(request);
  if (token) adminSessions.delete(token);
  response.setHeader('set-cookie', sessionCookie('', 0));
  sendJson(response, 200, { ok: true });
}

// --- Seguimiento para clientes: con el código de la reserva y el correo con que se hizo ---
async function findTrackedOrder(request, response) {
  const ip = clientIp(request);
  if (tooManyFailures(trackFailures, ip, 20)) {
    sendJson(response, 429, { error: 'Demasiados intentos. Espera unos minutos.' });
    return null;
  }
  const body = await readSmallJson(request);
  let code = String(body?.code ?? '').trim().toUpperCase();
  if (/^[0-9A-F]{8}$/.test(code)) code = 'F-' + code;
  const email = String(body?.email ?? '').trim().toLowerCase();
  const order = ORDER_CODE.test(code) && email ? (await readOrders()).find((item) => item.code === code) : null;
  if (!order || String(order.email).trim().toLowerCase() !== email) {
    noteFailure(trackFailures, ip);
    sendJson(response, 404, { error: 'No encontramos una reserva con ese código y correo. Revisa que estén escritos igual que en el correo de confirmación.' });
    return null;
  }
  return order;
}
async function handleTracking(request, response) {
  const order = await findTrackedOrder(request, response);
  if (!order) return;
  const states = await readJsonFile(STATES_FILE, {});
  sendJson(response, 200, {
    code: order.code,
    createdAt: order.createdAt,
    status: order.status,
    statusUpdatedAt: states[order.code]?.updatedAt || null,
    measure: order.measure,
    finish: order.finish || 'blanco',
    extrasText: order.extrasText || '',
    quantity: order.quantity || 1,
    price: order.price,
    petName: order.petName || '',
    species: order.species || '',
    hasModel: order.hasModel
  });
}
async function handleTrackingModel(request, response) {
  const order = await findTrackedOrder(request, response);
  if (!order) return;
  if (!order.hasModel) return sendJson(response, 404, { error: 'Esta reserva no tiene una copia del modelo.' });
  const filePath = path.join(ORDERS_DIR, order.code + '.glb');
  const stat = await fs.promises.stat(filePath);
  response.writeHead(200, { 'content-type': 'model/gltf-binary', 'content-length': stat.size, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(filePath).pipe(response);
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
  if (!adminConfigured()) return sendJson(response, 503, { error: 'El acceso de administrador está desactivado. Define ADMIN_USER y ADMIN_PASSWORD en el archivo .env y reinicia el servidor.' });
  if (!adminSession(request)) return sendJson(response, 401, { error: 'Tu sesión de administrador no está activa. Ingresa de nuevo.' });
  if (request.method === 'GET' && pathname === '/api/admin/session') return sendJson(response, 200, { ok: true });

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
// Página no encontrada: a un navegador se le muestra 404.html (la misma que usa GitHub Pages); al resto, JSON.
async function notFound(response, wantsHtml) {
  if (wantsHtml) {
    try {
      const page = await fs.promises.readFile(path.join(ROOT, '404.html'));
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'content-length': page.length, 'x-content-type-options': 'nosniff' });
      return response.end(page);
    } catch { /* sin 404.html: se responde en JSON */ }
  }
  return sendJson(response, 404, { error: 'No encontrado.' });
}
async function serveStatic(urlPath, response, wantsHtml = false) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split('?')[0]); } catch { return sendJson(response, 400, { error: 'Ruta no válida.' }); }
  if (decoded === '/') decoded = '/index.html';
  const filePath = path.resolve(ROOT, '.' + decoded);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return sendJson(response, 403, { error: 'Ruta no permitida.' });
  const relativePath = path.relative(ROOT, filePath).toLowerCase();
  const topFolder = relativePath.split(path.sep)[0];
  if (['.env', '.env.example', 'package.json', 'package-lock.json', 'readme.md', '.gitignore'].includes(relativePath) || relativePath.endsWith('.mjs') || ['pedidos', 'node_modules'].includes(topFolder) || topFolder.startsWith('.') || topFolder.startsWith('_')) {
    return notFound(response, wantsHtml);
  }
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return notFound(response, wantsHtml);
    response.writeHead(200, { 'content-type': contentType(filePath), 'content-length': stat.size, 'x-content-type-options': 'nosniff' });
    fs.createReadStream(filePath).pipe(response);
  } catch {
    notFound(response, wantsHtml);
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const parsed = new URL(request.url, 'http://' + HOST + ':' + PORT);
    if (request.method === 'GET' && parsed.pathname === '/api/pase') {
      response.setHeader('cache-control', 'no-store');
      return sendJson(response, 200, { pase: issuePass() });
    }
    if (request.method === 'GET' && parsed.pathname === '/api/health') {
      return sendJson(response, 200, { ready: provider.configured() });
    }
    if (request.method === 'POST' && parsed.pathname === '/api/generate') return await handleGenerate(request, response);
    if (request.method === 'POST' && parsed.pathname === '/api/order') return await handleOrder(request, response);
    if (request.method === 'POST' && parsed.pathname === '/api/seguimiento') return await handleTracking(request, response);
    if (request.method === 'POST' && parsed.pathname === '/api/seguimiento/modelo') return await handleTrackingModel(request, response);
    if (request.method === 'POST' && parsed.pathname === '/api/admin/login') return await handleAdminLogin(request, response);
    if (request.method === 'POST' && parsed.pathname === '/api/admin/logout') return handleAdminLogout(request, response);
    if (parsed.pathname.startsWith('/api/admin/')) return await handleAdmin(request, response, parsed.pathname);
    const statusMatch = parsed.pathname.match(/^\/api\/status\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && statusMatch) return await handleStatus(statusMatch[1], response);
    const modelMatch = parsed.pathname.match(/^\/api\/model\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && modelMatch) return await handleModel(modelMatch[1], response);
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Método no permitido.' });
    const wantsHtml = String(request.headers.accept || '').includes('text/html') && !parsed.pathname.startsWith('/api/');
    return await serveStatic(parsed.pathname, response, wantsHtml);
  } catch (error) {
    // Un error del servicio 3D trae un mensaje apto para el cliente; el detalle técnico queda en la consola.
    if (error instanceof ProviderError) console.error(provider.name + ': ' + error.message);
    const message = error instanceof ProviderError ? error.userMessage : error.message;
    if (!response.headersSent) sendJson(response, error.status || 502, { error: message || 'Error al procesar la solicitud.' });
    else response.destroy();
  }
});
server.listen(PORT, HOST, () => {
  console.log('FORMA disponible en http://' + HOST + ':' + PORT);
  console.log('Servicio 3D: ' + provider.name + (provider.configured() ? ' (configurado).' : ' (falta ' + provider.keyName + ' en .env: las vistas previas están desactivadas).'));
  console.log(mailConfig() ? 'Avisos por correo activados.' : 'Avisos por correo desactivados: faltan SMTP_HOST, SMTP_USER o SMTP_PASS.');
});
