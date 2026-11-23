// Pruebas de las reglas que comparten el navegador y el servidor (js/rules.js). Se corren con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ORDER_CODE, maxQuantity, canPaint, extrasPrice, unitPrice } from '../js/rules.js';

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const sizeM = catalog.tallas.find((size) => size.id === 'M');

test('el código de reserva es F- y ocho caracteres hexadecimales en mayúscula', () => {
  assert.ok(ORDER_CODE.test('F-ABCDEF12'));
  assert.ok(!ORDER_CODE.test('F-abcdef12'));
  assert.ok(!ORDER_CODE.test('ABCDEF12'));
  assert.ok(!ORDER_CODE.test('F-ABCDEF123'));
});

test('la cantidad máxima sale del catálogo, o 10 si no la indica', () => {
  assert.equal(maxQuantity(catalog.extras), catalog.extras.cantidadMaxima);
  assert.equal(maxQuantity({}), 10);
  assert.equal(maxQuantity(undefined), 10);
});

test('una talla se puede pintar solo si tiene recargo de pintura', () => {
  assert.equal(canPaint(sizeM), true);
  assert.equal(canPaint({ precio: 1000 }), false);
  assert.equal(canPaint({ precio: 1000, pintada: 0 }), false);
  assert.equal(canPaint(undefined), false);
});

test('los recargos de los extras se suman, y los que faltan no suman', () => {
  assert.equal(extrasPrice([{ precio: 1000 }, { precio: 500 }, null]), 1500);
  assert.equal(extrasPrice([{ precio: 0 }, undefined, {}]), 0);
});

test('el precio de una figura suma la talla, la pintura si corresponde y los extras', () => {
  const extras = [{ precio: 7990 }, { precio: 0 }, { precio: 3990 }];
  assert.equal(unitPrice(sizeM, false, extras), sizeM.precio + 7990 + 3990);
  assert.equal(unitPrice(sizeM, true, extras), sizeM.precio + sizeM.pintada + 7990 + 3990);
  assert.equal(unitPrice(sizeM, false, []), sizeM.precio);
});
