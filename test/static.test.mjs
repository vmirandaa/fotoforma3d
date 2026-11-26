// Prueba de qué archivos entrega el servidor y cuáles no. Se corre con: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

// Una carpeta de reservas dentro de una carpeta pública (data/), como si ORDERS_DIR apuntara ahí. Se borra al terminar.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ordersDir = fs.mkdtempSync(path.join(root, 'data', 'Reservas-'));
fs.writeFileSync(path.join(ordersDir, 'pedidos.jsonl'), '{"code":"F-00000000"}\n');
after(() => fs.rmSync(ordersDir, { recursive: true, force: true }));
process.env.ORDERS_DIR = ordersDir;
const { serveStatic } = await import('../lib/static.mjs');

// Pide una dirección como lo haría el servidor y devuelve el código de respuesta.
function status(url) {
  const response = new PassThrough();
  response.writeHead = (code) => (response.statusCode = code);
  response.resume();
  return new Promise((resolve) => {
    response.on('finish', () => resolve(response.statusCode));
    serveStatic(url, response);
  });
}

test('entrega las páginas y los archivos del sitio', async () => {
  assert.equal(await status('/'), 200);
  assert.equal(await status('/js/rules.js'), 200);
});

test('nunca entrega las reservas, la configuración ni el código del servidor', async () => {
  const orders = '/data/' + path.basename(ordersDir) + '/pedidos.jsonl';
  assert.equal(await status(orders), 404);
  // En Windows y macOS la misma carpeta se abre con otras mayúsculas.
  assert.equal(await status(orders.toLowerCase()), 404);
  assert.equal(await status('/README.md'), 404);
  assert.equal(await status('/lib/config.mjs'), 404);
  assert.equal(await status('/scss/main.scss'), 404);
  assert.equal(await status('/.env'), 404);
  assert.equal(await status('/server.mjs'), 404);
  assert.equal(await status('/server.mjs::$DATA'), 404);
  assert.equal(await status('/package.json'), 404);
  assert.equal(await status('/../server.mjs'), 403);
});
