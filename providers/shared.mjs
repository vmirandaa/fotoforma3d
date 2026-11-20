// Utilidades comunes a los servicios 3D.

// Error con un mensaje apto para mostrarle al cliente (userMessage) y otro técnico para la consola (message).
export class ProviderError extends Error {
  constructor(message, { status = 502, userMessage } = {}) {
    super(message);
    this.status = status;
    this.userMessage = userMessage || 'No se pudo crear la vista previa. Inténtalo de nuevo en unos minutos.';
  }
}

export async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch {
    throw new ProviderError('Respuesta inesperada del servicio 3D (HTTP ' + response.status + '): ' + text.slice(0, 200));
  }
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Espera sugerida antes de reintentar: respeta Retry-After si el servicio lo envía.
export function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get('retry-after'));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : (attempt + 1) * 4000;
}
