// Pruebas de la dirección del visitante y de los intentos fallidos. Se corren con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { clientIp, tooManyFailures, noteFailure, contentSecurityPolicy } from '../lib/http.mjs';

test('con TRUST_PROXY se usa la última dirección de X-Forwarded-For, que no puede inventar el visitante', () => {
  const request = { headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }, socket: { remoteAddress: '10.0.0.1' } };
  process.env.TRUST_PROXY = 'true';
  assert.equal(clientIp(request), '1.2.3.4');
  delete process.env.TRUST_PROXY;
  assert.equal(clientIp(request), '10.0.0.1');
});

test('los intentos fallidos cuentan por dirección y los viejos se olvidan', () => {
  const failures = new Map([['vieja', [Date.now() - 20 * 60 * 1000]]]);
  noteFailure(failures, 'nueva');
  assert.equal(tooManyFailures(failures, 'nueva', 1), true);
  assert.equal(tooManyFailures(failures, 'otra', 1), false);
  assert.equal(failures.has('vieja'), false);
});

test('la política autoriza los scripts en línea por su hash (con saltos de Windows) y no los que tienen src', () => {
  const html = '<script>\r\n  uno();\r\n</script><script type="module" src="js/main.js"></script>';
  const expected = createHash('sha256').update('\n  uno();\n').digest('base64');
  const policy = contentSecurityPolicy(html);
  assert.ok(policy.includes("'sha256-" + expected + "'"));
  assert.equal(policy.match(/sha256-/g).length, 1);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
});
