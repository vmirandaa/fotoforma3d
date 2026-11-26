// Vistas previas: recibe las fotos, las envía al servicio 3D, informa el avance y entrega el modelo listo.
// Las vistas previas viven en memoria (se pierden al reiniciar el servidor); las reservas no.
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ProviderError } from '../providers/shared.mjs';
import { MAX_PHOTOS, MAX_PHOTO_MB, MAX_PHOTO_BYTES, PHOTO_TYPES } from '../js/rules.js';
import { PHOTO_TMP, HOUR, DAY, provider } from './config.mjs';
import { sendJson, sendFile, readRequestBody, clientIp, forgetOlderThan } from './http.mjs';
import { checkPass } from './pass.mjs';
import { SPECIES, TAIL_OPTIONS, cleanText, buildPetPrompt, tailSummary } from './order-rules.mjs';

// Vistas previas en curso o listas, por id. orders.mjs las lee para registrar la reserva.
export const tasks = new Map();
const PHOTO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// Ángulos que puede traer cada foto ('?' si no se sabe).
export const PHOTO_LABELS = [
  '?',
  'Front',
  'Front-Left',
  'Front-Right',
  'Back',
  'Back-Left',
  'Back-Right',
  'Left',
  'Right',
  'Up',
  'Down'
];

// Las vistas previas que nadie reservó se olvidan, junto con sus fotos, después de 24 horas.
const PREVIEW_TTL = DAY;
fs.rmSync(PHOTO_TMP, { recursive: true, force: true });
setInterval(() => {
  for (const [id, task] of tasks) {
    if (Date.now() - task.createdAt < PREVIEW_TTL) continue;
    fs.rmSync(path.join(PHOTO_TMP, id), { recursive: true, force: true });
    tasks.delete(id);
  }
}, HOUR).unref();

function envLimit(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
// Cada vista previa consume créditos. Límites (0 = sin límite):
// - PREVIEW_LIMIT_PER_HOUR y PREVIEW_LIMIT_PER_DAY: por conexión.
// - PREVIEW_DAILY_BUDGET: total del sitio en 24 horas, para acotar el gasto aunque lleguen muchas visitas.
// Los conteos viven en memoria: se reinician si se reinicia el servidor.
const previewLog = new Map();
const previewTotal = [];
function previewLimitReached(ip) {
  const now = Date.now();
  forgetOlderThan(previewLog, now - DAY);
  const recent = previewLog.get(ip) || [];
  while (previewTotal.length && previewTotal[0] <= now - DAY) previewTotal.shift();
  const perHour = envLimit('PREVIEW_LIMIT_PER_HOUR', 6);
  const perDay = envLimit('PREVIEW_LIMIT_PER_DAY', 15);
  const budget = envLimit('PREVIEW_DAILY_BUDGET', 100);
  if (budget > 0 && previewTotal.length >= budget)
    return 'Hoy ya se generaron muchas vistas previas. Vuelve a intentarlo mañana o escríbenos y te ayudamos.';
  if (perDay > 0 && recent.length >= perDay)
    return 'Ya generaste varias vistas previas hoy. Vuelve a intentarlo mañana.';
  if (perHour > 0 && recent.filter((time) => time > now - HOUR).length >= perHour)
    return 'Ya generaste varias vistas previas hace poco. Vuelve a intentarlo en un rato.';
  return '';
}
function notePreview(ip) {
  const times = previewLog.get(ip) || [];
  times.push(Date.now());
  previewLog.set(ip, times);
  previewTotal.push(Date.now());
}

export async function handleGenerate(request, response) {
  if (!provider.configured())
    return sendJson(response, 503, { error: 'El estudio todavía no está conectado al servicio de generación 3D.' });
  const ip = clientIp(request);
  // El pase va en un encabezado: se revisa antes de leer las fotos, así un envío automático no consume nada.
  const passProblem = checkPass(request.headers['x-forma-pass']);
  if (passProblem) {
    request.resume();
    if (passProblem !== 'too-fast') console.warn('Vista previa rechazada (' + passProblem + ') desde ' + ip);
    return sendJson(response, 403, {
      error: 'No pudimos validar la página. Recárgala e inténtalo de nuevo.',
      code: 'pass',
      reason: passProblem
    });
  }
  const limitMessage = previewLimitReached(ip);
  if (limitMessage) {
    request.resume();
    return sendJson(response, 429, { error: limitMessage });
  }
  // Se cuenta apenas pasa los límites: si se contara después de leer las fotos, muchas solicitudes al mismo
  // tiempo pasarían todas la revisión antes de que se cuente la primera y superarían el tope diario.
  notePreview(ip);
  // Las fotos llegan ya achicadas por el navegador; el margen cubre el resto del formulario.
  const rawBody = await readRequestBody(request, MAX_PHOTOS * MAX_PHOTO_BYTES + 1024 * 1024);
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
  if (images.length < 1 || images.length > MAX_PHOTOS)
    return sendJson(response, 400, { error: 'Selecciona entre una y ' + MAX_PHOTOS + ' imágenes.' });
  for (const image of images) {
    if (!PHOTO_TYPES.includes(image.type))
      return sendJson(response, 400, { error: 'Las imágenes deben ser JPG, PNG o WEBP.' });
    if (image.size > MAX_PHOTO_BYTES)
      return sendJson(response, 413, { error: 'Cada imagen puede pesar hasta ' + MAX_PHOTO_MB + ' MB.' });
  }
  const species = Object.hasOwn(SPECIES, String(incoming.get('species'))) ? String(incoming.get('species')) : 'otro';
  const petName = cleanText(incoming.get('petName'), 40);
  const petNotes = cleanText(incoming.get('notes'), 300);
  const tail = TAIL_OPTIONS.includes(String(incoming.get('tail'))) ? String(incoming.get('tail')) : '';
  const tailNotes = tail === 'not-visible' ? cleanText(incoming.get('tailNotes'), 120) : '';
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
    providerPhotos.push({
      bytes,
      type: image.type,
      filename: image.name || photoName,
      label: labels[index] ? label : ''
    });
  }

  let ref;
  try {
    ref = await provider.start({ photos: providerPhotos, prompt });
  } catch (error) {
    fs.rmSync(photoDir, { recursive: true, force: true });
    if (!(error instanceof ProviderError)) throw error;
    console.error(provider.name + ': no se pudo iniciar una vista previa. ' + error.message);
    return sendJson(response, error.status === 429 ? 429 : 502, { error: error.userMessage });
  }
  if (ref.mode)
    console.log(
      provider.name + ': vista previa iniciada (' + ref.mode + (ref.views ? ': ' + ref.views.join(', ') : '') + ').'
    );
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

// Pregunta al servicio 3D cómo va la vista previa. Cuando está lista, descarga el modelo y lo guarda junto a las fotos:
// así el visor y la reserva no dependen de cuánto dure el enlace del servicio.
export async function handleStatus(id, response) {
  const task = tasks.get(id);
  if (!task) return sendJson(response, 404, { error: 'No se encontró esta generación en el estudio.' });
  if (task.state === 'failed')
    return sendJson(response, 200, { status: 'failed', error: task.error || 'La generación falló.' });
  if (task.state === 'done') return sendJson(response, 200, { status: 'done', modelReady: true });
  if (task.downloading) return sendJson(response, 200, { status: 'downloading' });
  if (!provider.configured())
    return sendJson(response, 503, { error: 'No hay una clave de generación configurada en el servidor.' });

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

export async function handleModel(id, response) {
  const task = tasks.get(id);
  if (!task || task.state !== 'done' || !task.modelPath)
    return sendJson(response, 404, { error: 'El modelo todavía no está disponible.' });
  if (!(await sendFile(response, task.modelPath, 'model/gltf-binary')))
    sendJson(response, 404, { error: 'El modelo ya no está disponible.' });
}
