// Pruebas del pase contra envíos automáticos. Se corren con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issuePass, checkPass, safeEqual } from '../lib/pass.mjs';

const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;

test('un pase válido se acepta una sola vez', () => {
  const start = Date.now();
  const pass = issuePass(start);
  assert.equal(checkPass(pass, start + 10 * SECOND), '');
  assert.equal(checkPass(pass, start + 11 * SECOND), 'used');
});

test('un pase usado demasiado rápido se rechaza, y sigue sirviendo después', () => {
  const start = Date.now();
  const pass = issuePass(start);
  assert.equal(checkPass(pass, start + 1 * SECOND), 'too-fast');
  assert.equal(checkPass(pass, start + 5 * SECOND), '');
});

test('un pase de más de 6 horas está vencido', () => {
  const start = Date.now();
  assert.equal(checkPass(issuePass(start), start + 6 * HOUR + SECOND), 'expired');
});

test('un pase con fecha futura se rechaza', () => {
  const start = Date.now();
  assert.equal(checkPass(issuePass(start + HOUR), start), 'expired');
});

test('un pase que falta, está incompleto o fue alterado se rechaza', () => {
  const start = Date.now();
  assert.equal(checkPass('', start), 'missing');
  assert.equal(checkPass(undefined, start), 'missing');
  assert.equal(checkPass('123.abc', start), 'missing');
  const [issued, nonce, signature] = issuePass(start).split('.');
  // Cambiar la fecha invalida la firma: no se puede "rejuvenecer" un pase.
  assert.equal(checkPass([Number(issued) + 1, nonce, signature].join('.'), start + 10 * SECOND), 'invalid');
  assert.equal(checkPass([issued, nonce, 'firma-falsa'].join('.'), start + 10 * SECOND), 'invalid');
});

test('safeEqual compara textos', () => {
  assert.equal(safeEqual('clave', 'clave'), true);
  assert.equal(safeEqual('clave', 'Clave'), false);
  assert.equal(safeEqual('', 'clave'), false);
});
