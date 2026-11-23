// Reglas de una vista previa y de una reserva: textos, opciones y precios. No tocan el disco ni la red.
import { BASE_NAME_MAX, maxQuantity, extrasPrice } from '../js/rules.js';

export const SPECIES = { perro: 'dog', gato: 'cat', otro: 'pet animal' };
// eslint-disable-next-line no-control-regex -- buscar caracteres de control es justamente la idea
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;
// Quita caracteres de control y espacios de más, y recorta al largo máximo.
export function cleanText(value, max) {
  return String(value ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
export const TAIL_OPTIONS = ['visible', 'not-visible', 'no-tail'];
export function buildPetPrompt(species, notes, tail, tailNotes) {
  const animal = SPECIES[species] || SPECIES.otro;
  const parts = [
    'A single ' +
      animal +
      ', full body, faithful to the reference photos: same pose, ears, tail, snout and body proportions.',
    'Solid collectible figurine suitable for 3D printing, sturdy shapes, fur simplified into clean sculpted volumes, no thin fragile parts.',
    'Keep ears, tongue and tail thick and attached to the body; whiskers only as shallow relief, never as separate strands.',
    'Only the animal: no background, no floor, no people, no leash or other objects.'
  ];
  // La cola es lo que más falla cuando no aparece en las fotos.
  if (tail === 'not-visible') {
    parts.push(
      tailNotes
        ? 'The tail is not visible in the photos. Owner description of the tail: ' + tailNotes
        : 'The tail is not visible in the photos: give it a natural tail for this animal, resting against the body.'
    );
  }
  if (tail === 'no-tail') parts.push('The animal has no tail or only a very short docked tail.');
  if (notes) parts.push('Owner notes: ' + notes);
  return parts.join(' ').slice(0, 900);
}
// Resumen en español de la cola para el panel de reservas.
export function tailSummary(tail, tailNotes) {
  if (tail === 'not-visible') return 'Cola (no se ve en las fotos): ' + (tailNotes || 'sin descripción');
  if (tail === 'no-tail') return 'No tiene cola o es muy corta';
  return '';
}
// Extras del pedido (formato, estilo, base y cantidad): se validan contra data/catalog.json y el precio se calcula aquí,
// nunca con lo que mande el navegador. Devuelve { error } si algo no corresponde.
export function readOrderExtras(catalog, body) {
  const extras = catalog.extras || {};
  const pick = (list, id) => {
    if (!Array.isArray(list) || !list.length) return null;
    return id ? list.find((item) => item.id === id) : list[0];
  };
  const formato = pick(extras.formatos, body.format);
  const estilo = pick(extras.estilos, body.style);
  const base = pick(extras.bases, body.base);
  if ((body.format && !formato) || (body.style && !estilo) || (body.base && !base))
    return { error: 'Alguna de las opciones elegidas ya no está disponible. Recarga la página.' };
  const max = maxQuantity(extras);
  const quantity = Number(body.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > max)
    return { error: 'La cantidad debe ser entre 1 y ' + max + '.' };
  const baseName = base?.conNombre ? cleanText(body.baseName, BASE_NAME_MAX) : '';
  if (base?.conNombre && !baseName) return { error: 'Escribe el nombre que va en la base.' };
  const extraPrice = extrasPrice([formato, estilo, base]);
  // Resumen legible para el panel, Mi pedido y los correos. Solo nombra lo que se aparta de lo básico.
  const parts = [];
  if (formato && Number(formato.precio) > 0)
    parts.push(formato.nombre.charAt(0).toLowerCase() + formato.nombre.slice(1));
  if (estilo && Number(estilo.precio) > 0) parts.push('estilo ' + estilo.nombre.toLowerCase());
  if (base && Number(base.precio) > 0)
    parts.push(base.conNombre ? base.nombre.toLowerCase() + ' «' + baseName + '»' : base.nombre.toLowerCase());
  return {
    format: formato?.id || '',
    style: estilo?.id || '',
    base: base?.id || '',
    baseName,
    quantity,
    extraPrice,
    extrasText: parts.join(' · ')
  };
}
