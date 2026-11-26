// Llamadas al servidor desde el navegador, con un mensaje que la persona entiende si algo falla en el camino.
export const CONNECTION_ERROR = 'No pudimos conectar con el sitio. Inténtalo de nuevo.';

// La respuesta como JSON. Si llega otra cosa (la página de error del hosting mientras se reinicia, o no hay servidor),
// lanza CONNECTION_ERROR en vez de "Unexpected token '<'…".
async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error(CONNECTION_ERROR);
  }
}

// Como fetch, pero si algo falla lanza un error con mensaje para la persona: sin conexión, CONNECTION_ERROR
// (en vez de "Failed to fetch", que cada navegador escribe distinto); con un error del servidor, el que él mandó
// o `fallback`. El error lleva status y code para los casos que deciden según el motivo.
export async function request(url, options, fallback) {
  const response = await fetch(url, options).catch(() => {
    throw new Error(CONNECTION_ERROR);
  });
  if (!response.ok) {
    const result = await readJson(response);
    throw Object.assign(new Error(result.error || fallback), { status: response.status, code: result.code });
  }
  return response;
}
export async function requestJson(url, options, fallback) {
  return readJson(await request(url, options, fallback));
}
