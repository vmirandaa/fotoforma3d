// Servicios de generación 3D intercambiables.
//
// Cada servicio vive en su propio archivo de esta carpeta y cumple el mismo contrato:
//   id, name, keyName           identificación y nombre de la clave en .env
//   configured()                true si su clave está definida
//   start({ photos, prompt })   envía las fotos y devuelve una referencia (un objeto simple) de la tarea
//   status(ref)                 { state: 'waiting' | 'generating' | 'done' | 'failed', progress?, error?, modelUrl? }
//
// photos: [{ bytes: Uint8Array, type: 'image/jpeg', filename, label }] con label = Front, Left, Right, Back, '?'…
// El servidor descarga el modelo apenas está listo (modelUrl), así no depende de cuánto dure ese enlace.
//
// Para cambiar de servicio basta con PROVIDER en .env (tripo o rodin). Para sumar uno nuevo (por ejemplo Hunyuan),
// crea su archivo con el mismo contrato y agrégalo a PROVIDERS.
import { tripo } from './tripo.mjs';
import { rodin } from './rodin.mjs';

const PROVIDERS = { tripo, rodin };

export function activeProvider() {
  const wanted = String(process.env.PROVIDER || 'tripo').trim().toLowerCase();
  const provider = PROVIDERS[wanted];
  if (!provider) {
    console.warn('PROVIDER="' + wanted + '" no existe. Opciones: ' + Object.keys(PROVIDERS).join(', ') + '. Se usa tripo.');
    return tripo;
  }
  return provider;
}
