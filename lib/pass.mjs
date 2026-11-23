import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Pase del creador: una firma que el servidor entrega al abrir la página y que se exige para generar.
// Un programa que llame directo a /api/generate sin pasar por la página no lo tiene. Cada pase sirve una vez,
// vale 6 horas y no se acepta antes de unos segundos: una persona tarda más que eso en subir fotos y responder.
const PASS_SECRET = randomBytes(32);
const PASS_MIN_AGE = 4000;
const PASS_MAX_AGE = 6 * 60 * 60 * 1000;
const usedPasses = new Map();
function signPass(issued, nonce) {
  return createHmac('sha256', PASS_SECRET)
    .update(issued + '.' + nonce)
    .digest('base64url');
}
// `now` permite fijar la hora en las pruebas; el servidor no lo usa.
export function issuePass(now = Date.now()) {
  const issued = now;
  const nonce = randomBytes(12).toString('base64url');
  return issued + '.' + nonce + '.' + signPass(issued, nonce);
}
export function checkPass(value, now = Date.now()) {
  const [issued, nonce, signature] = String(value || '').split('.');
  if (!issued || !nonce || !signature) return 'missing';
  if (!safeEqual(signature, signPass(issued, nonce))) return 'invalid';
  const age = now - Number(issued);
  if (!(age >= 0) || age > PASS_MAX_AGE) return 'expired';
  if (age < PASS_MIN_AGE) return 'too-fast';
  for (const [key, until] of usedPasses) if (until < now) usedPasses.delete(key);
  if (usedPasses.has(nonce)) return 'used';
  usedPasses.set(nonce, Number(issued) + PASS_MAX_AGE);
  return '';
}
// Compara dos textos sin revelar por el tiempo de respuesta cuántos caracteres coinciden.
export function safeEqual(given, expected) {
  const digest = (value) => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
