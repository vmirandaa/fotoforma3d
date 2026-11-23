// Rodin / Hyper3D (API v2). Es el único de los servicios que acepta texto junto a las fotos.
// Envía exactamente lo mismo que enviaba el servidor antes de separar los servicios.
//
// .env: RODIN_API_KEY (obligatoria), PREVIEW_TIER (Gen-2.5-Low, -Medium o -High) y RODIN_API_BASE (solo para pruebas).
import { ProviderError, readJson, retryDelay, wait } from './shared.mjs';

const TIERS = ['Gen-2.5-Low', 'Gen-2.5-Medium', 'Gen-2.5-High'];
const apiBase = () => (process.env.RODIN_API_BASE || 'https://api.hyper3d.com/api/v2').replace(/\/+$/, '');
const apiKey = () => process.env.RODIN_API_KEY?.trim();
// Nivel de detalle de la vista previa gratuita. Bájalo a Gen-2.5-Low para gastar menos créditos por visitante.
function previewTier() {
  const tier = process.env.PREVIEW_TIER?.trim();
  return TIERS.includes(tier) ? tier : 'Gen-2.5-Medium';
}

async function postJson(endpoint, payload) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(apiBase() + endpoint, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + apiKey(), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000)
    });
    if (response.status === 429 && attempt < 4) {
      await wait(retryDelay(response, attempt));
      continue;
    }
    const result = await readJson(response);
    if (!response.ok || result.error) {
      throw new ProviderError(
        'Rodin ' + endpoint + ': ' + (result.message || result.error || 'HTTP ' + response.status),
        { status: response.status || 502 }
      );
    }
    return result;
  }
  throw new ProviderError('Rodin ocupado (429)', {
    status: 429,
    userMessage: 'El servicio 3D está ocupado. Espera un momento e inténtalo nuevamente.'
  });
}

export const rodin = {
  id: 'rodin',
  name: 'Rodin (Hyper3D)',
  keyName: 'RODIN_API_KEY',
  configured: () => Boolean(apiKey()),

  async start({ photos, prompt }) {
    const upstream = new FormData();
    photos.forEach((photo, index) => {
      upstream.append(
        'images',
        new Blob([photo.bytes], { type: photo.type }),
        photo.filename || 'reference-' + (index + 1)
      );
      if (photo.label) upstream.append('image_label', photo.label);
    });
    upstream.append('tier', previewTier());
    upstream.append('mesh_mode', 'Quad');
    upstream.append('quality', 'high');
    upstream.append('geometry_file_format', 'glb');
    upstream.append('material', 'PBR');
    upstream.append('prompt', prompt);
    const response = await fetch(apiBase() + '/rodin', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + apiKey() },
      body: upstream,
      signal: AbortSignal.timeout(120_000)
    });
    const result = await readJson(response);
    if (!response.ok || result.error || !result.uuid || !result.jobs?.subscription_key) {
      throw new ProviderError('Rodin /rodin: ' + (result.message || result.error || 'HTTP ' + response.status), {
        status: response.status || 502,
        userMessage: result.message || result.error || 'No se pudo iniciar la generación.'
      });
    }
    return { uuid: result.uuid, subscriptionKey: result.jobs.subscription_key };
  },

  async status(ref) {
    const status = await postJson('/status', { subscription_key: ref.subscriptionKey });
    const jobs = Array.isArray(status.jobs) ? status.jobs : [];
    if (!jobs.length) return { state: 'waiting' };
    if (jobs.some((job) => job.status === 'Failed'))
      return { state: 'failed', error: status.message || 'El servicio no pudo completar el modelo.' };
    if (!jobs.every((job) => job.status === 'Done')) {
      return { state: jobs.some((job) => job.status === 'Generating') ? 'generating' : 'waiting' };
    }
    const download = await postJson('/download', { task_uuid: ref.uuid });
    const files = Array.isArray(download.list) ? download.list : [];
    const glb = files.find((file) => /\.glb(?:$|[?#])/i.test(file.name || ''));
    if (!glb?.url) return { state: 'failed', error: 'El servicio terminó, pero no incluyó el archivo GLB.' };
    return { state: 'done', modelUrl: glb.url };
  }
};
