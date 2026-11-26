// Prueba del tope diario de vistas previas, que protege los créditos del servicio 3D. Se corre con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

// Un servicio 3D "configurado" que apunta a una dirección donde no hay nada: nunca gasta créditos reales.
process.env.TRIPO_API_KEY = 'prueba';
process.env.TRIPO_API_BASE = 'http://127.0.0.1:9';
process.env.PREVIEW_DAILY_BUDGET = '1';
process.env.PORT = '0';
const { handleGenerate } = await import('../lib/previews.mjs');
const { issuePass } = await import('../lib/pass.mjs');

// Una solicitud de vista previa con una foto, como la que envía el creador.
async function generate() {
  const form = new FormData();
  form.append('images', new Blob(['foto'], { type: 'image/jpeg' }), 'foto.jpg');
  form.append('image_label', 'Front');
  form.append('tail', 'visible');
  const encoded = new Request('http://prueba/', { method: 'POST', body: form });
  const request = Readable.from([Buffer.from(await encoded.arrayBuffer())]);
  request.headers = {
    'content-type': encoded.headers.get('content-type'),
    'x-forma-pass': issuePass(Date.now() - 10_000)
  };
  request.socket = { remoteAddress: '203.0.113.' + Math.floor(Math.random() * 200) };
  const response = { writeHead: (status) => (response.status = status), end() {} };
  // Sin servicio 3D real, la que pasa los límites termina en error: lo que importa es cuántas pasan.
  await handleGenerate(request, response).catch(() => {});
  return response.status;
}

test('con el tope en 1, de dos solicitudes simultáneas solo una pasa', async () => {
  const statuses = await Promise.all([generate(), generate()]);
  assert.equal(statuses.filter((status) => status === 429).length, 1);
});
