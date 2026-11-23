// Pruebas de los correos de cada reserva (sin enviar nada). Se corren con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mailConfig, buildOrderEmails } from '../mailer.mjs';

const config = mailConfig({ SMTP_HOST: 'smtp.prueba.test', SMTP_USER: 'taller@prueba.test', SMTP_PASS: 'x' });
const order = {
  code: 'F-ABCDEF12',
  measure: '10 cm',
  finish: 'blanco',
  price: 22990,
  quantity: 1,
  name: 'Ana',
  email: 'ana@prueba.test',
  petName: 'Luna',
  species: 'perro',
  modelFile: 'F-ABCDEF12.glb'
};

test('sin SMTP_HOST, SMTP_USER o SMTP_PASS los correos quedan desactivados', () => {
  assert.equal(mailConfig({}), null);
  assert.equal(mailConfig({ SMTP_HOST: 'h', SMTP_USER: 'u' }), null);
});

test('la configuración usa el puerto 465 seguro y el usuario como remitente por defecto', () => {
  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
  assert.equal(config.from, 'taller@prueba.test');
  assert.equal(config.notifyTo, 'taller@prueba.test');
  assert.equal(mailConfig({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_PORT: '587' }).secure, false);
});

test('el aviso va al taller y responde al cliente; la confirmación va al cliente', () => {
  const [shop, customer] = buildOrderEmails(order, config);
  assert.equal(shop.to, 'taller@prueba.test');
  assert.deepEqual(shop.replyTo, { name: 'Ana', address: 'ana@prueba.test' });
  assert.equal(shop.subject, 'Nueva reserva F-ABCDEF12 · 10 cm · Luna');
  assert.deepEqual(customer.to, { name: 'Ana', address: 'ana@prueba.test' });
  assert.equal(customer.subject, 'Recibimos tu reserva F-ABCDEF12 · FORMA');
  assert.match(customer.text, /\$22\.990/);
});

test('la figura pintada, los extras y la cantidad aparecen en el aviso al taller', () => {
  const [shop] = buildOrderEmails(
    { ...order, finish: 'pintada', extrasText: 'alcancía', quantity: 3, baseName: 'Luna' },
    config
  );
  assert.match(shop.subject, /10 cm pintada/);
  assert.match(shop.text, /pintada por el taller, alcancía/);
  assert.match(shop.text, /Cantidad: 3 figuras iguales/);
  assert.match(shop.text, /Nombre en la base: Luna/);
});

test('los datos del cliente se escapan en la versión HTML', () => {
  const [shop] = buildOrderEmails({ ...order, name: '<script>x</script>' }, config);
  assert.doesNotMatch(shop.html, /<script>/);
  assert.match(shop.html, /&lt;script&gt;/);
});
