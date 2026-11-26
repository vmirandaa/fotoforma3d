// Simulador de la API v3 de Tripo para probar la vista previa y la reserva sin gastar créditos.
// Imita lo que usa providers/tripo.mjs: POST /v3/files, POST /v3/generation/{image,multiview}-to-model y
// GET /v3/tasks/{id}; el modelo "listo" es assets/models/sample-figure.glb.
// Claves especiales: "clave-mala" → 401 (código 1002); "sin-creditos" → 403 al crear la tarea (código 2010).
//
// Por línea de comandos:
//   node tools/fake-tripo.mjs [puerto]          solo el simulador (por defecto 4399)
//   node tools/fake-tripo.mjs --site [puerto]   el simulador y el sitio (npm run dev:fake), con clave simulada
// DEMORA_MS fija cuánto tarda cada tarea en quedar lista (por defecto 8000).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_GLB = path.join(ROOT, 'assets', 'models', 'sample-figure.glb');

// Arranca el simulador. Devuelve { url, apiBase, server, close, forceKey }: `forceKey` permite a una prueba
// simular otra clave (por ejemplo "sin-creditos") sin reiniciar el sitio, que lee su clave al arrancar.
export function startFakeTripo({ port = 0, delayMs = Number(process.env.DEMORA_MS || 8000), log = () => {} } = {}) {
  const tasks = new Map();
  let files = 0;
  const fake = { forceKey: '' };
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, code, message) =>
    send(res, status, { code, status: 'error', message, request_id: 'req_simulado' });

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    if (req.method === 'GET' && req.url === '/modelo.glb') {
      res.writeHead(200, { 'content-type': 'model/gltf-binary' });
      return fs.createReadStream(SAMPLE_GLB).pipe(res);
    }
    const key = fake.forceKey || String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!key || key === 'clave-mala') return fail(res, 401, 1002, 'Authentication failed');

    if (req.method === 'POST' && req.url === '/v3/files') {
      const type = (raw.toString('latin1').match(/name="file"[^\r\n]*\r\nContent-Type: ([^\r\n]+)/i) || [])[1];
      if (!type) return fail(res, 400, 2003, 'Empty input file');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(type))
        return fail(res, 400, 2004, 'Unsupported file type ' + type);
      files += 1;
      log('subida file_' + files + ' ' + type + ' ' + raw.length + ' bytes');
      return send(res, 200, { code: 0, data: { file_token: 'file_' + files } });
    }
    const generation = req.url.match(/^\/v3\/generation\/(image|multiview)-to-model$/);
    if (req.method === 'POST' && generation) {
      let body;
      try {
        body = JSON.parse(raw.toString('utf8') || '{}');
      } catch {
        return fail(res, 400, 1004, 'Invalid JSON');
      }
      log('tarea ' + req.url + ' ' + JSON.stringify(body));
      if (key === 'sin-creditos') return fail(res, 403, 2010, 'Insufficient credits');
      if (!body.model) return fail(res, 400, 1004, 'model is required');
      if (generation[1] === 'image' && typeof body.input !== 'string')
        return fail(res, 400, 1004, 'input must be a string');
      if (generation[1] === 'multiview') {
        const views = (body.inputs || []).map((item) => Object.keys(item)[0]);
        if (!views.includes('front') || views.length < 2)
          return fail(res, 400, 1004, 'front is required and at least 2 views');
      }
      const id = 'tarea-' + (tasks.size + 1);
      tasks.set(id, { started: Date.now(), type: generation[1] + '_to_model' });
      return send(res, 200, { code: 0, data: { task_id: id } });
    }
    const match = req.url.match(/^\/v3\/tasks\/(.+)$/);
    if (req.method === 'GET' && match) {
      const id = decodeURIComponent(match[1]);
      const task = tasks.get(id);
      if (!task) return fail(res, 404, 2001, 'Task not found');
      const elapsed = Date.now() - task.started;
      // El primer 20 % del tiempo en cola, luego "running" hasta cumplir la demora.
      const status = elapsed < delayMs * 0.2 ? 'queued' : elapsed < delayMs ? 'running' : 'success';
      const progress = status === 'success' ? 100 : Math.min(99, Math.round((elapsed / delayMs) * 100));
      const data = { task_id: id, type: task.type, status, progress };
      if (status === 'success') data.output = { model_url: fake.url + '/modelo.glb' };
      return send(res, 200, { code: 0, data });
    }
    fail(res, 404, 4001, 'Endpoint not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      fake.url = 'http://127.0.0.1:' + server.address().port;
      fake.apiBase = fake.url + '/v3';
      fake.server = server;
      fake.close = () => new Promise((done) => server.close(() => done()));
      resolve(fake);
    });
  });
}

// Variables para que el sitio use el simulador: clave simulada (pisa la de .env, que nunca se lee) y sin correos.
// Un espacio en SMTP_PASS evita que .env lo llene (lib/config.mjs no pisa variables ya definidas) y queda vacío al recortarlo.
export function siteEnv(fake, extra = {}) {
  return { ...process.env, TRIPO_API_KEY: 'simulada', TRIPO_API_BASE: fake.apiBase, SMTP_PASS: ' ', ...extra };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const withSite = args.includes('--site');
  const port = Number(args.find((arg) => /^\d+$/.test(arg)) ?? (withSite ? 0 : 4399));
  const fake = await startFakeTripo({ port, log: (line) => console.log('[tripo simulado] ' + line) });
  console.log('Tripo simulado en ' + fake.apiBase);
  if (withSite) {
    // Puerto 4174 y reservas en una carpeta temporal: no choca con npm start (4173) ni con las reservas reales.
    const env = siteEnv(fake, {
      PORT: process.env.PORT || '4174',
      ORDERS_DIR: process.env.ORDERS_DIR || path.join(os.tmpdir(), 'forma-fake-pedidos')
    });
    console.log('Reservas de prueba en ' + env.ORDERS_DIR);
    const site = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { cwd: ROOT, env, stdio: 'inherit' });
    const stop = () => {
      site.kill();
      fake.close().then(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    site.on('exit', (code) => fake.close().then(() => process.exit(code ?? 0)));
  }
}
