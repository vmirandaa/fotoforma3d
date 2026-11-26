// Pruebas de las reglas de la reserva. Se corren con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanText, tailSummary, readOrderExtras } from '../lib/order-rules.mjs';

// Se usa el catálogo real del sitio: si alguien cambia precios u opciones, las pruebas lo leen tal cual.
const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const extras = catalog.extras;
const byId = (list, id) => list.find((item) => item.id === id);

test('cleanText quita caracteres de control, junta espacios y recorta', () => {
  assert.equal(cleanText('  Luna\n\tla   corgi\u0000 ', 100), 'Luna la corgi');
  assert.equal(cleanText('abcdef', 3), 'abc');
  assert.equal(cleanText(undefined, 10), '');
  assert.equal(cleanText(null, 10), '');
});

test('sin opciones elegidas se usa la primera de cada grupo y una unidad', () => {
  const result = readOrderExtras(catalog, {});
  assert.equal(result.format, extras.formatos[0].id);
  assert.equal(result.style, extras.estilos[0].id);
  assert.equal(result.base, extras.bases[0].id);
  assert.equal(result.quantity, 1);
  assert.equal(result.extraPrice, 0);
  assert.equal(result.extrasText, '');
});

test('el recargo suma formato, estilo y base, y el resumen nombra solo lo que se aparta de lo básico', () => {
  const result = readOrderExtras(catalog, { format: 'alcancia', style: 'animado', base: 'base' });
  const expected =
    byId(extras.formatos, 'alcancia').precio +
    byId(extras.estilos, 'animado').precio +
    byId(extras.bases, 'base').precio;
  assert.equal(result.extraPrice, expected);
  assert.equal(result.extrasText, 'alcancía · estilo animado · base sin nombre');
});

test('la base con nombre exige el nombre y lo muestra en el resumen', () => {
  assert.deepEqual(readOrderExtras(catalog, { base: 'base-nombre' }), {
    error: 'Escribe el nombre que va en la base.'
  });
  const result = readOrderExtras(catalog, { base: 'base-nombre', baseName: '  Luna  ' });
  assert.equal(result.baseName, 'Luna');
  assert.equal(result.extrasText, 'base con nombre «Luna»');
});

test('el nombre de la base solo se guarda si la base lo lleva', () => {
  assert.equal(readOrderExtras(catalog, { base: 'base', baseName: 'Luna' }).baseName, '');
});

test('una opción que no existe se rechaza', () => {
  assert.ok(readOrderExtras(catalog, { format: 'nave-espacial' }).error);
  assert.ok(readOrderExtras(catalog, { style: 'cubista' }).error);
  assert.ok(readOrderExtras(catalog, { base: 'marmol' }).error);
});

test('la cantidad debe ser un entero entre 1 y el máximo del catálogo', () => {
  const max = extras.cantidadMaxima;
  assert.equal(readOrderExtras(catalog, { quantity: max }).quantity, max);
  for (const quantity of [0, -1, max + 1, 1.5, 'dos']) {
    assert.ok(readOrderExtras(catalog, { quantity }).error, 'debería rechazar ' + quantity);
  }
});

test('el resumen de la cola para el panel', () => {
  assert.equal(tailSummary('not-visible', 'corta'), 'Cola (no se ve en las fotos): corta');
  assert.equal(tailSummary('not-visible', ''), 'Cola (no se ve en las fotos): sin descripción');
  assert.equal(tailSummary('no-tail', ''), 'No tiene cola o es muy corta');
  assert.equal(tailSummary('visible', ''), '');
});
