// Llamadas al servidor desde el navegador, con un mensaje que la persona entiende si algo falla en el camino.
export const CONNECTION_ERROR = 'No pudimos conectar con el sitio. Inténtalo de nuevo.';

// Como fetch, pero sin conexión lanza CONNECTION_ERROR en vez de "Failed to fetch" (que cada navegador escribe distinto).
export function api(url, options) {
  return fetch(url, options).catch(() => {
    throw new Error(CONNECTION_ERROR);
  });
}
// La respuesta como JSON. Si llega otra cosa (la página de error del hosting mientras se reinicia, o no hay servidor),
// lanza CONNECTION_ERROR en vez de "Unexpected token '<'…".
export async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error(CONNECTION_ERROR);
  }
}
