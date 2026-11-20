// Tripo (API v3, https://developers.tripo3d.ai). No acepta texto junto a las fotos: las indicaciones de la mascota
// (cola, orejas…) no llegan al modelo, pero quedan guardadas en la reserva para el taller.
//
// Cómo elige qué generar:
// - Si hay foto de frente y al menos otra de costado izquierdo, costado derecho o espalda: multivista (mejor volumen).
// - Si no: una sola foto (la de frente, o la primera).
//
// .env: TRIPO_API_KEY (obligatoria). Opcionales: TRIPO_MODEL (versión del modelo), TRIPO_TEXTURE=false para generar
// sin colores (más barato; el visor solo podrá mostrarla en blanco) y TRIPO_API_BASE (solo para pruebas).
import { ProviderError, readJson, retryDelay, wait } from './shared.mjs';

const apiBase = () => (process.env.TRIPO_API_BASE || 'https://openapi.tripo3d.ai/v3').replace(/\/+$/, '');
const apiKey = () => process.env.TRIPO_API_KEY?.trim();
const model = () => process.env.TRIPO_MODEL?.trim() || 'v3.1-20260211';
const withTexture = () => process.env.TRIPO_TEXTURE?.trim() !== 'false';
// Ángulos del creador → vistas de la multivista de Tripo.
const VIEWS = { Front: 'front', Left: 'left', Back: 'back', Right: 'right' };

// Mensajes para el cliente según el código de error de Tripo. Los detalles técnicos van a la consola.
const BUSY = 'El servicio 3D está ocupado. Inténtalo de nuevo en unos minutos.';
const UNAVAILABLE = 'La vista previa no está disponible en este momento. Escríbenos y te ayudamos.';
function userMessageFor(code) {
  if (code === 2010) return UNAVAILABLE; // sin créditos
  if ([2, 1002].includes(code)) return UNAVAILABLE; // clave inválida
  if ([1007, 2000].includes(code)) return BUSY; // límite de solicitudes o de tareas simultáneas
  if (code === 2008) return 'El servicio 3D no aceptó estas fotos. Prueba con otras de tu mascota.';
  if ([2003, 2004].includes(code)) return 'Una de las fotos no se pudo leer. Prueba con otra en JPG o PNG.';
  return 'No se pudo crear la vista previa. Inténtalo de nuevo en unos minutos.';
}
function technicalNote(code) {
  if (code === 2010) return ' (SIN CRÉDITOS en la cuenta de Tripo)';
  if ([2, 1002].includes(code)) return ' (revisa TRIPO_API_KEY)';
  if (code === 2015) return ' (la versión TRIPO_MODEL ya no se acepta)';
  return '';
}

// Llama a la API con reintentos ante 429 y errores del servicio, como recomienda Tripo.
async function call(path, { method = 'GET', json, form } = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(apiBase() + path, {
      method,
      headers: { authorization: 'Bearer ' + apiKey(), ...(json ? { 'content-type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : form,
      signal: AbortSignal.timeout(90_000)
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 4) { await wait(retryDelay(response, attempt)); continue; }
    const result = await readJson(response);
    if (!response.ok || result.code !== 0) {
      const code = Number(result.code);
      throw new ProviderError('Tripo ' + method + ' ' + path + ': código ' + result.code + ' · ' + (result.message || 'HTTP ' + response.status) + technicalNote(code), {
        status: response.status >= 400 ? response.status : 502,
        userMessage: userMessageFor(code)
      });
    }
    return result.data;
  }
  throw new ProviderError('Tripo ocupado tras varios reintentos', { status: 429, userMessage: BUSY });
}

async function upload(photo, index) {
  const form = new FormData();
  const extension = photo.type === 'image/png' ? 'png' : 'jpg';
  form.append('file', new Blob([photo.bytes], { type: photo.type }), photo.filename || ('foto-' + (index + 1) + '.' + extension));
  const data = await call('/files', { method: 'POST', form });
  if (!data?.file_token) throw new ProviderError('Tripo /files no devolvió file_token');
  return data.file_token;
}

export const tripo = {
  id: 'tripo',
  name: 'Tripo',
  keyName: 'TRIPO_API_KEY',
  configured: () => Boolean(apiKey()),

  async start({ photos }) {
    const options = { model: model(), texture: withTexture(), pbr: false };
    // Una foto por vista: la primera que tenga ese ángulo.
    const byView = {};
    photos.forEach((photo) => {
      const view = VIEWS[photo.label];
      if (view && !byView[view]) byView[view] = photo;
    });
    if (byView.front && Object.keys(byView).length >= 2) {
      const inputs = [];
      for (const [view, photo] of Object.entries(byView)) inputs.push({ [view]: await upload(photo, inputs.length) });
      const data = await call('/generation/multiview-to-model', { method: 'POST', json: { inputs, ...options } });
      return { taskId: data.task_id, mode: 'multivista', views: Object.keys(byView) };
    }
    const main = byView.front || photos[0];
    const data = await call('/generation/image-to-model', { method: 'POST', json: { input: await upload(main, 0), ...options } });
    return { taskId: data.task_id, mode: 'una foto' };
  },

  async status(ref) {
    const data = await call('/tasks/' + encodeURIComponent(ref.taskId));
    const progress = Number(data.progress) || 0;
    switch (data.status) {
      case 'queued': return { state: 'waiting', progress };
      case 'running': return { state: 'generating', progress };
      case 'success':
        if (!data.output?.model_url) return { state: 'failed', error: 'El servicio terminó, pero no entregó el modelo.' };
        return { state: 'done', modelUrl: data.output.model_url };
      case 'failed': case 'cancelled': case 'banned': case 'expired':
        console.error('Tripo: la tarea ' + ref.taskId + ' terminó en "' + data.status + '"' + (data.error_code ? ' (código ' + data.error_code + ')' : '') + (data.error_message ? ': ' + data.error_message : ''));
        return { state: 'failed', error: 'No pudimos crear la figura con estas fotos. Prueba con otras, con buena luz y la mascota completa.' };
      default: return { state: 'generating', progress }; // "unknown": se sigue esperando
    }
  }
};
