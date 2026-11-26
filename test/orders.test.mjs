// Prueba de una reserva completa: precio, archivos copiados y línea guardada. Se corre con: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

// Todo en una carpeta temporal, sin tocar pedidos/ ni las fotos de un servidor que esté corriendo.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-prueba-'));
process.env.ORDERS_DIR = path.join(dir, 'pedidos');
process.env.PORT = '0';
// Correos apagados: el .env local no pisa una variable ya definida, y mailConfig lee " " como vacía.
process.env.SMTP_HOST = ' ';
const { handleOrder, readOrders, saveOrderState } = await import('../lib/orders.mjs');
const { tasks } = await import('../lib/previews.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));

const photoDir = path.join(dir, 'vista-previa');
fs.mkdirSync(photoDir);
fs.writeFileSync(path.join(photoDir, 'modelo.glb'), 'modelo');
fs.writeFileSync(path.join(photoDir, 'foto-1.jpg'), 'foto');
tasks.set('tarea', {
  state: 'done',
  modelPath: path.join(photoDir, 'modelo.glb'),
  photoDir,
  photos: [{ file: 'foto-1.jpg', label: 'Front' }],
  petName: 'Luna',
  species: 'perro',
  petNotes: '',
  provider: 'tripo',
  ref: {}
});

// Llama a handleOrder como lo haría el servidor y devuelve { status, body }.
function order(body) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.headers = {};
  return new Promise((resolve) => {
    const response = {
      writeHead(status) {
        this.status = status;
      },
      end(text) {
        resolve({ status: this.status, body: JSON.parse(text) });
      }
    };
    handleOrder(request, response);
  });
}
const valid = {
  taskId: 'tarea',
  size: 'L',
  finish: 'pintada',
  format: 'alcancia',
  base: 'base-nombre',
  baseName: 'Luna',
  quantity: 2,
  name: 'Ana',
  email: 'ana@prueba.test'
};

test('una reserva guarda el precio que calcula el servidor, el modelo y las fotos', async () => {
  const { status, body } = await order(valid);
  assert.equal(status, 201);
  const [saved] = await readOrders();
  assert.equal(saved.code, body.code);
  const size = catalog.tallas.find((item) => item.id === 'L');
  const alcancia = catalog.extras.formatos.find((item) => item.id === 'alcancia');
  const base = catalog.extras.bases.find((item) => item.id === 'base-nombre');
  assert.equal(saved.unitPrice, size.precio + size.pintada + alcancia.precio + base.precio);
  assert.equal(saved.price, saved.unitPrice * 2);
  assert.equal(saved.extrasText, 'alcancía · base con nombre «Luna»');
  assert.equal(saved.hasModel, true);
  assert.deepEqual(saved.photos, [{ file: body.code + '-foto-1.jpg', label: 'Front' }]);
  assert.ok(fs.existsSync(path.join(dir, 'pedidos', body.code + '-foto-1.jpg')));

  // La misma vista previa no se reserva dos veces: devuelve el mismo código.
  const again = await order(valid);
  assert.equal(again.body.code, body.code);
  assert.equal((await readOrders()).length, 1);
});

test('una reserva sin vista previa lista o con datos inválidos se rechaza', async () => {
  assert.equal((await order({ ...valid, taskId: 'no-existe' })).status, 409);
  assert.equal((await order({ ...valid, size: 'XXL' })).status, 400);
  assert.equal((await order({ ...valid, email: 'sin-arroba' })).status, 400);
  assert.equal((await order({ ...valid, quantity: 99 })).status, 400);
});

test('el estado se guarda sin dejar archivos a medio escribir', async () => {
  const [saved] = await readOrders();
  await saveOrderState(saved.code, 'pagada');
  assert.equal((await readOrders())[0].status, 'pagada');
  assert.deepEqual(
    fs.readdirSync(path.join(dir, 'pedidos')).filter((file) => file.endsWith('.tmp')),
    []
  );
});
