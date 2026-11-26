// Reservas: se registran en pedidos/pedidos.jsonl (una por línea) con una copia del modelo y de las fotos.
// Su estado (nueva, contactada, pagada…) se guarda aparte, en pedidos/estados.json, y lo cambia el panel.
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sendOrderEmails } from '../mailer.mjs';
import { ORDER_CODE, canPaint, unitPrice } from '../js/rules.js';
import { ROOT, ORDERS_DIR, ORDERS_FILE, STATES_FILE } from './config.mjs';
import {
  sendJson,
  sendFile,
  readRequestBody,
  readSmallJson,
  readJsonFile,
  clientIp,
  tooManyFailures,
  noteFailure
} from './http.mjs';
import { cleanText, readOrderExtras } from './order-rules.mjs';
import { tasks, PHOTO_LABELS } from './previews.mjs';

export const ORDER_STATES = ['nueva', 'contactada', 'pagada', 'enviada', 'cancelada'];
// Hasta foto-5: las reservas anteriores al límite de 4 fotos pueden tener cinco.
const PHOTO_FILE = /^F-[0-9A-F]{8}-foto-[1-5]\.(jpg|png|webp)$/;
const trackFailures = new Map();

function loadCatalog() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog.json'), 'utf8'));
}

// Registra la reserva en pedidos/pedidos.jsonl y guarda una copia del modelo y de las fotos para fabricarla.
export async function handleOrder(request, response) {
  let body;
  try {
    body = JSON.parse((await readRequestBody(request, 20 * 1024)).toString('utf8'));
  } catch (error) {
    return sendJson(response, error.status || 400, { error: 'No se pudo leer la reserva.' });
  }
  const task = tasks.get(String(body?.taskId || ''));
  if (!task || task.state !== 'done' || !task.modelPath)
    return sendJson(response, 409, {
      error: 'La vista previa ya no está disponible. Genérala de nuevo para reservar.'
    });
  const catalog = loadCatalog();
  const size = catalog.tallas.find((item) => item.id === body.size);
  if (!size) return sendJson(response, 400, { error: 'Elige un tamaño para tu figura.' });
  // Acabado: en blanco (incluido) o pintada por el taller, con el recargo que indica data/catalog.json para esa talla.
  const finish = body.finish === 'pintada' ? 'pintada' : 'blanco';
  if (finish === 'pintada' && !canPaint(size))
    return sendJson(response, 400, { error: 'Esta talla no se ofrece pintada.' });
  const paintPrice = finish === 'pintada' ? Number(size.pintada) : 0;
  const extras = readOrderExtras(catalog, body);
  if (extras.error) return sendJson(response, 400, { error: extras.error });
  const name = cleanText(body.name, 80);
  const email = cleanText(body.email, 120);
  if (!name) return sendJson(response, 400, { error: 'Escribe tu nombre para reservar.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return sendJson(response, 400, { error: 'Revisa tu correo: lo usaremos para confirmar el pedido.' });
  if (task.orderCode) return sendJson(response, 200, { code: task.orderCode });

  // Un código nuevo que ninguna reserva use: si se repitiera, se pisarían el modelo y las fotos de la otra.
  const taken = new Set((await readOrders()).map((order) => order.code));
  let code;
  do code = 'F-' + randomUUID().slice(0, 8).toUpperCase();
  while (taken.has(code));
  await fs.promises.mkdir(ORDERS_DIR, { recursive: true });
  let modelFile = null;
  try {
    await fs.promises.copyFile(task.modelPath, path.join(ORDERS_DIR, code + '.glb'));
    modelFile = code + '.glb';
  } catch {
    /* sin copia del modelo: la reserva se guarda igual y el panel lo indica */
  }
  const photos = [];
  for (const photo of task.photos || []) {
    const file = code + '-' + photo.file;
    try {
      await fs.promises.copyFile(path.join(task.photoDir, photo.file), path.join(ORDERS_DIR, file));
      photos.push({ file, label: photo.label });
    } catch {
      /* la foto temporal ya no está: la reserva sigue sin ella */
    }
  }
  const unit = unitPrice(size, finish === 'pintada', extras.items);
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
    unitPrice: unit,
    price: unit * extras.quantity,
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
  await fs.promises.appendFile(ORDERS_FILE, JSON.stringify(order) + '\n', 'utf8');
  task.orderCode = code;
  console.log(
    'Nueva reserva ' +
      code +
      ' · ' +
      size.medida +
      (finish === 'pintada' ? ' pintada' : '') +
      (extras.extrasText ? ' · ' + extras.extrasText : '') +
      (extras.quantity > 1 ? ' · ' + extras.quantity + ' unidades' : '') +
      ' · ' +
      photos.length +
      ' foto(s)' +
      (modelFile ? '' : ' · SIN COPIA DEL MODELO')
  );
  sendJson(response, 201, { code });
  // El aviso por correo va después de responder: si falla, la reserva ya quedó guardada.
  sendOrderEmails(order).then((mail) => {
    if (!mail.configured) return;
    if (mail.shop && mail.customer) console.log('Correos de la reserva ' + code + ' enviados.');
    else
      console.error(
        'Reserva ' +
          code +
          ': aviso al taller ' +
          (mail.shop ? 'enviado' : 'FALLÓ') +
          ', confirmación al cliente ' +
          (mail.customer ? 'enviada' : 'FALLÓ') +
          '. ' +
          (mail.error || '')
      );
  });
}

// Todas las reservas, de la más nueva a la más antigua, con su estado, sus fotos válidas y si hay copia del modelo.
export async function readOrders() {
  let text = '';
  try {
    text = await fs.promises.readFile(ORDERS_FILE, 'utf8');
  } catch {
    return [];
  }
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
      orders.push({
        ...order,
        photos,
        hasModel,
        status: ORDER_STATES.includes(state?.status) ? state.status : 'nueva'
      });
    } catch {
      /* línea dañada: se omite */
    }
  }
  return orders.reverse();
}
export async function saveOrderState(code, status) {
  const states = await readJsonFile(STATES_FILE, {});
  states[code] = { status, updatedAt: new Date().toISOString() };
  // Se escribe aparte y se reemplaza de una vez: un corte a mitad de camino no deja el archivo incompleto.
  await fs.promises.writeFile(STATES_FILE + '.tmp', JSON.stringify(states, null, 2), 'utf8');
  await fs.promises.rename(STATES_FILE + '.tmp', STATES_FILE);
}

// --- Seguimiento para clientes: con el código de la reserva y el correo con que se hizo ---
async function findTrackedOrder(request, response) {
  const ip = clientIp(request);
  if (tooManyFailures(trackFailures, ip, 20)) {
    sendJson(response, 429, { error: 'Demasiados intentos. Espera unos minutos.' });
    return null;
  }
  const body = await readSmallJson(request);
  let code = String(body?.code ?? '')
    .trim()
    .toUpperCase();
  if (/^[0-9A-F]{8}$/.test(code)) code = 'F-' + code;
  const email = String(body?.email ?? '')
    .trim()
    .toLowerCase();
  const order = ORDER_CODE.test(code) && email ? (await readOrders()).find((item) => item.code === code) : null;
  if (!order || String(order.email).trim().toLowerCase() !== email) {
    noteFailure(trackFailures, ip);
    sendJson(response, 404, {
      error:
        'No encontramos una reserva con ese código y correo. Revisa que estén escritos igual que en el correo de confirmación.'
    });
    return null;
  }
  return order;
}
export async function handleTracking(request, response) {
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
export async function handleTrackingModel(request, response) {
  const order = await findTrackedOrder(request, response);
  if (!order) return;
  const sent =
    order.hasModel && (await sendFile(response, path.join(ORDERS_DIR, order.code + '.glb'), 'model/gltf-binary'));
  if (!sent) sendJson(response, 404, { error: 'Esta reserva no tiene una copia del modelo.' });
}
