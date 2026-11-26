// Prueba de punta a punta por el servidor real (node server.mjs) contra el simulador de Tripo: vista previa,
// reserva, seguimiento y panel. Nunca usa la clave real ni envía correos. Se corre con: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFakeTripo, siteEnv } from '../tools/fake-tripo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ordersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-e2e-'));
const ADMIN = { user: 'admin-prueba', password: 'clave-prueba-' + Date.now() };

// Un puerto libre: se abre en 0, se lee cuál asignó el sistema y se cierra.
function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
function portIsClosed(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(true));
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let fake;
let site;
let sitePort;
async function stopAll() {
  // Terminado por señal, exitCode queda en null: se mira también signalCode.
  if (site && site.exitCode === null && site.signalCode === null) {
    const exited = new Promise((resolve) => site.once('exit', resolve));
    site.kill();
    await exited;
  }
  if (fake?.server.listening) await fake.close();
}
// Por si la prueba falla a mitad de camino: nada queda escuchando.
after(async () => {
  await stopAll();
  fs.rmSync(ordersDir, { recursive: true, force: true });
  // Fotos temporales de la vista previa (lib/config.mjs PHOTO_TMP).
  if (sitePort) fs.rmSync(path.join(os.tmpdir(), 'forma-photos-' + sitePort), { recursive: true, force: true });
});

test('flujo completo: vista previa, reserva, seguimiento y panel', { timeout: 60_000 }, async () => {
  fake = await startFakeTripo({ delayMs: 600 });
  sitePort = await freePort();
  // Un espacio deja vacía la variable y evita que .env la llene (lib/config.mjs no pisa las ya definidas).
  const env = siteEnv(fake, {
    PORT: String(sitePort),
    HOST: '127.0.0.1',
    ORDERS_DIR: ordersDir,
    ADMIN_USER: ADMIN.user,
    ADMIN_PASSWORD: ADMIN.password,
    SMTP_HOST: ' ',
    SMTP_USER: ' ',
    TRUST_PROXY: ' ',
    COOKIE_SECURE: ' ',
    PREVIEW_LIMIT_PER_HOUR: '0',
    PREVIEW_LIMIT_PER_DAY: '0',
    PREVIEW_DAILY_BUDGET: '0'
  });
  site = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  site.stdout.on('data', (chunk) => (log += chunk));
  site.stderr.on('data', (chunk) => (log += chunk));
  const base = 'http://127.0.0.1:' + sitePort;
  try {
    for (let i = 0; i < 50 && !log.includes('FORMA disponible'); i += 1) await sleep(100);
    assert.match(log, /FORMA disponible/, 'el servidor no arrancó:\n' + log);

    const json = (url, body, headers = {}) =>
      fetch(base + url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body)
      });
    const photo = fs.readFileSync(path.join(root, 'assets', 'images', 'corgi-photo.jpg'));
    const generate = (pass) => {
      const form = new FormData();
      form.append('images', new Blob([photo], { type: 'image/jpeg' }), 'corgi.jpg');
      form.append('image_label', 'Front');
      form.append('species', 'perro');
      form.append('petName', 'Toby');
      form.append('tail', 'visible');
      return fetch(base + '/api/generate', {
        method: 'POST',
        headers: pass ? { 'x-forma-pass': pass } : {},
        body: form
      });
    };

    assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ready: true });
    // Dos pases: uno para la vista previa y otro para el caso sin créditos. No valen en sus primeros 4 segundos.
    const passes = [];
    for (let i = 0; i < 2; i += 1) passes.push((await (await fetch(base + '/api/pass')).json()).pass);
    const passIssued = Date.now();

    // Casos negativos que no necesitan pase, mientras se cumplen los 4 segundos.
    assert.equal((await generate()).status, 403, 'sin pase');
    assert.equal((await fetch(base + '/api/admin/orders')).status, 401, 'panel sin sesión');
    assert.equal((await json('/api/tracking', { code: 'F-00000000', email: 'x@example.test' })).status, 404);
    await sleep(Math.max(0, 4300 - (Date.now() - passIssued)));

    // Vista previa: 202 → avanza hasta done → el GLB se entrega.
    const started = await generate(passes[0]);
    assert.equal(started.status, 202);
    const { id } = await started.json();
    const seen = new Set();
    let status;
    for (let i = 0; i < 100; i += 1) {
      status = await (await fetch(base + '/api/status/' + id)).json();
      seen.add(status.status);
      if (status.status === 'done' || status.status === 'failed') break;
      await sleep(100);
    }
    assert.equal(status.status, 'done', JSON.stringify(status));
    assert.ok(seen.has('generating'), 'pasó por "generando": ' + [...seen]);
    const model = await fetch(base + '/api/model/' + id);
    assert.equal(model.status, 200);
    assert.equal(model.headers.get('content-type'), 'model/gltf-binary');
    assert.equal(
      Buffer.from(await model.arrayBuffer())
        .subarray(0, 4)
        .toString(),
      'glTF'
    );

    // Reserva: cantidad 11 se rechaza; la válida da un código.
    const order = {
      taskId: id,
      size: 'M',
      finish: 'pintada',
      format: 'alcancia',
      style: 'realista',
      base: 'base-nombre',
      baseName: 'Toby',
      quantity: 2,
      name: 'Cliente Prueba',
      email: 'cliente@example.test'
    };
    assert.equal((await json('/api/order', { ...order, quantity: 11 })).status, 400, 'cantidad 11');
    const reserved = await json('/api/order', order);
    assert.equal(reserved.status, 201);
    const { code } = await reserved.json();
    assert.match(code, /^F-[0-9A-F]{8}$/);

    // Seguimiento: talla, extras y precio calculados en el servidor. (22.990 + 14.990 + 7.990 + 5.990) × 2.
    const tracking = await json('/api/tracking', { code, email: 'cliente@example.test' });
    assert.equal(tracking.status, 200);
    const tracked = await tracking.json();
    assert.equal(tracked.measure, '10 cm');
    assert.equal(tracked.finish, 'pintada');
    assert.equal(tracked.quantity, 2);
    assert.equal(tracked.price, 103_920);
    assert.equal(tracked.extrasText, 'alcancía · base con nombre «Toby»');
    assert.equal(tracked.status, 'nueva');
    assert.equal((await json('/api/tracking', { code, email: 'otro@example.test' })).status, 404, 'correo equivocado');

    // Panel: ingreso, la reserva aparece, cambio de estado y se refleja en el seguimiento.
    assert.equal((await json('/api/admin/login', { ...ADMIN, password: 'mala' })).status, 401);
    const login = await json('/api/admin/login', ADMIN);
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const board = await (await fetch(base + '/api/admin/orders', { headers: { cookie } })).json();
    assert.ok(board.orders.some((item) => item.code === code && item.hasModel && item.photos.length === 1));
    const changed = await json('/api/admin/orders/' + code + '/status', { status: 'pagada' }, { cookie });
    assert.equal(changed.status, 200);
    const after = await (await json('/api/tracking', { code, email: 'cliente@example.test' })).json();
    assert.equal(after.status, 'pagada');
    assert.ok(after.statusUpdatedAt);

    // Sin créditos en Tripo: 502 con un mensaje para el cliente, sin códigos ni nombres técnicos.
    fake.forceKey = 'sin-creditos';
    const noCredits = await generate(passes[1]);
    fake.forceKey = '';
    assert.equal(noCredits.status, 502);
    const { error } = await noCredits.json();
    assert.equal(error, 'La vista previa no está disponible en este momento. Escríbenos y te ayudamos.');
    assert.doesNotMatch(error, /tripo|2010|credit|crédito/i);
    assert.match(log, /SIN CRÉDITOS/, 'el motivo técnico queda en la consola');
  } finally {
    await stopAll();
  }
  assert.ok(await portIsClosed(sitePort), 'el sitio sigue escuchando');
  assert.ok(await portIsClosed(Number(new URL(fake.url).port)), 'el simulador sigue escuchando');
});
