// Configuración del servidor: lee .env (antes que nada) y define carpetas, puerto y el servicio 3D en uso.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { tripo } from '../providers/tripo.mjs';

// Carpeta del proyecto (este archivo está en lib/).
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Lee .env sin pisar las variables que ya vengan definidas desde afuera.
function loadLocalEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadLocalEnv();

export const PORT = Number(process.env.PORT || 4173);
export const HOST = process.env.HOST || '127.0.0.1';
// Carpeta de reservas. ORDERS_DIR permite apuntar a otra (por ejemplo, datos de demostración).
export const ORDERS_DIR = process.env.ORDERS_DIR ? path.resolve(process.env.ORDERS_DIR) : path.join(ROOT, 'pedidos');
export const ORDERS_FILE = path.join(ORDERS_DIR, 'pedidos.jsonl');
export const STATES_FILE = path.join(ORDERS_DIR, 'estados.json');
// Las fotos de una vista previa se guardan aquí de forma temporal; solo pasan a la carpeta de reservas si el cliente reserva.
export const PHOTO_TMP = path.join(os.tmpdir(), 'forma-photos-' + PORT);

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

// Servicio de generación 3D (providers/tripo.mjs).
export const provider = tripo;
