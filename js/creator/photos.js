// Fotos de la mascota: una sola en "Foto suelta" o una por recuadro en "Por ángulos", y su preparación.
import { el } from '../dom.js';
import { MAX_PHOTO_MB, MAX_PHOTO_BYTES, PHOTO_TYPES } from '../rules.js';
import { selectedFiles, state, showState, notifyChange } from './shared.js';

const imageInput = document.querySelector('#reference-images');
const uploadZone = document.querySelector('#upload-zone');
const fileList = document.querySelector('#file-list');
const moreAngles = document.querySelector('#more-angles');
const uploadModeBox = document.querySelector('#upload-mode');
const angleSlots = document.querySelector('#angle-slots');

// Subida por ángulos: cuatro recuadros (frente, costados y espalda), una foto en cada uno.
const ANGLE_SLOTS = [
  { label: 'Front', name: 'Frente', icon: '◉' },
  { label: 'Left', name: 'Costado izquierdo', icon: '◐' },
  { label: 'Right', name: 'Costado derecho', icon: '◑' },
  { label: 'Back', name: 'Espalda', icon: '○' }
];
let uploadMode = 'free';

// Las fotos se achican en el navegador antes de enviarlas: suben más rápido con datos móviles
// y quedan dentro de los límites de cualquier proveedor 3D (Hunyuan, por ejemplo, pide unos 6 MB por foto).
const PHOTO_MAX_SIDE = 2048;
const PHOTO_SEND_BYTES = 4 * 1024 * 1024;
const PHOTO_MIN_SIDE = 600;
// Peso máximo de la foto original, antes de achicarla.
const ORIGINAL_MAX_MB = 25;

// Fotos en el orden en que se envían: por ángulos, en el orden de los recuadros (frente, costados, espalda).
export function photosToSend() {
  if (uploadMode !== 'angles') return selectedFiles;
  const slotOrder = ANGLE_SLOTS.map((slot) => slot.label);
  return [...selectedFiles].sort((a, b) => slotOrder.indexOf(a.label) - slotOrder.indexOf(b.label));
}

function filesReadyMessage() {
  return selectedFiles.length === 1 ? 'Foto lista.' : selectedFiles.length + ' fotos listas.';
}
function removeFile(entry) {
  if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  selectedFiles.splice(selectedFiles.indexOf(entry), 1);
  renderFiles();
  notifyChange();
  showState(
    selectedFiles.length ? filesReadyMessage() : 'Sube al menos una foto.',
    selectedFiles.length ? 'success' : ''
  );
}
async function preparePhoto(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { file, small: false };
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  const small = longest < PHOTO_MIN_SIDE;
  if (file.type !== 'image/webp' && longest <= PHOTO_MAX_SIDE && file.size <= PHOTO_SEND_BYTES) {
    bitmap.close();
    return { file, small };
  }
  const scale = Math.min(1, PHOTO_MAX_SIDE / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; // fondo blanco para fotos recortadas con transparencia
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) return { file, small };
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return { file: new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified }), small };
}
// La foto va al recuadro `label` (Front, Left, Right o Back) y reemplaza la que hubiera.
// En "Foto suelta" siempre es Front: una foto nueva reemplaza a la anterior.
async function addPhoto(file, label) {
  if (!file) return;
  if (!PHOTO_TYPES.includes(file.type)) return showState('Solo se aceptan fotos JPG, PNG o WEBP.');
  if (file.size > ORIGINAL_MAX_MB * 1024 * 1024)
    return showState('Cada foto debe pesar ' + ORIGINAL_MAX_MB + ' MB o menos.');
  const key = file.name + ':' + file.size;
  if (selectedFiles.some((entry) => entry.sourceKey === key && entry.label !== label))
    return showState('Esa foto ya está en otro ángulo.');
  state.preparingPhotos += 1;
  showState('Preparando la foto…');
  notifyChange();
  const prepared = await preparePhoto(file);
  state.preparingPhotos -= 1;
  // El servidor no acepta fotos más pesadas; pasa si el navegador no pudo achicarla.
  if (prepared.file.size > MAX_PHOTO_BYTES) {
    notifyChange();
    return showState('No pudimos achicar esa foto a menos de ' + MAX_PHOTO_MB + ' MB. Prueba con otra.');
  }
  const previous = selectedFiles.findIndex((entry) => entry.label === label);
  if (previous >= 0) {
    if (selectedFiles[previous].previewUrl) URL.revokeObjectURL(selectedFiles[previous].previewUrl);
    selectedFiles.splice(previous, 1);
  }
  selectedFiles.push({ file: prepared.file, sourceKey: key, label });
  renderFiles();
  notifyChange();
  if (state.preparingPhotos) return;
  if (prepared.small)
    showState('La foto es muy pequeña (menos de ' + PHOTO_MIN_SIDE + ' px): la figura puede salir con menos detalle.');
  else showState(filesReadyMessage(), 'success');
}
// Vista previa de la foto (el enlace temporal se libera al volver a dibujar la lista).
function thumbnail(entry, alt) {
  entry.previewUrl = URL.createObjectURL(entry.file);
  return el('img', { src: entry.previewUrl, alt });
}
function renderFiles() {
  selectedFiles.forEach((entry) => {
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  });
  if (uploadMode === 'angles') {
    renderAngleSlots();
    return;
  }
  // "Foto suelta": una sola foto.
  fileList.replaceChildren();
  moreAngles.hidden = selectedFiles.length === 0;
  moreAngles.classList.toggle('nudge', selectedFiles.length === 1);
  moreAngles.textContent =
    'Con una sola foto, el modelo inventa lo que no se ve. Si tienes fotos de costado o de espalda, súbelas en "Por ángulos".';
  selectedFiles.forEach((entry) => {
    const remove = el('button', { type: 'button', 'aria-label': 'Quitar la foto' }, '×');
    remove.addEventListener('click', () => removeFile(entry));
    fileList.append(el('div', { className: 'file-thumb' }, thumbnail(entry, 'Foto seleccionada'), remove));
  });
}
function renderAngleSlots() {
  angleSlots.replaceChildren();
  ANGLE_SLOTS.forEach((slot) => {
    const entry = selectedFiles.find((item) => item.label === slot.label);
    const box = el('label', {
      className: 'angle-slot' + (entry ? ' has-photo' : '') + (slot.label === 'Front' ? ' primary' : '')
    });
    const input = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp',
      'aria-label': (entry ? 'Cambiar' : 'Subir') + ' la foto: ' + slot.name
    });
    input.addEventListener('change', () => {
      addPhoto(input.files[0], slot.label);
      input.value = '';
    });
    box.append(input);
    if (entry) {
      const remove = el('button', { type: 'button', 'aria-label': 'Quitar la foto: ' + slot.name }, '×');
      remove.addEventListener('click', (event) => {
        event.preventDefault();
        removeFile(entry);
      });
      box.append(thumbnail(entry, 'Foto: ' + slot.name), remove, el('span', { className: 'angle-name' }, slot.name));
    } else {
      box.append(
        el('span', { className: 'angle-icon', 'aria-hidden': 'true' }, slot.icon),
        el('strong', slot.name),
        el('small', slot.label === 'Front' ? 'La más importante' : 'Opcional')
      );
    }
    box.addEventListener('dragover', (event) => {
      event.preventDefault();
      box.classList.add('dragover');
    });
    box.addEventListener('dragleave', () => box.classList.remove('dragover'));
    box.addEventListener('drop', (event) => {
      event.preventDefault();
      box.classList.remove('dragover');
      addPhoto(event.dataTransfer.files[0], slot.label);
    });
    angleSlots.append(box);
  });
  const count = selectedFiles.length;
  moreAngles.hidden = false;
  moreAngles.classList.toggle('nudge', count === 1);
  moreAngles.textContent =
    count === 0
      ? 'Toca cada recuadro para subir la foto de ese ángulo. Con la de frente basta para empezar.'
      : count < 4
        ? 'Cada ángulo que sumes ayuda a que la figura salga más parecida, sobre todo la espalda si se ve la cola.'
        : 'Tienes los cuatro ángulos: es la mejor base para la figura.';
}
// Al pasar a ángulos, la foto suelta queda en el recuadro del frente.
// Al volver a "Foto suelta" queda solo una: la del frente, o la primera si no hay de frente.
function setUploadMode(mode) {
  if (mode === uploadMode || state.preparingPhotos) return;
  uploadMode = mode;
  if (mode === 'free' && selectedFiles.length) {
    const keep = selectedFiles.find((entry) => entry.label === 'Front') || selectedFiles[0];
    const removed = selectedFiles.filter((entry) => entry !== keep);
    removed.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    });
    if (removed.length)
      showState('En "Foto suelta" va una sola foto: dejamos ' + (keep.label === 'Front' ? 'la de frente.' : 'una.'));
    selectedFiles.splice(0, selectedFiles.length, keep);
    keep.label = 'Front';
  }
  uploadModeBox
    .querySelectorAll('button')
    .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  angleSlots.hidden = mode !== 'angles';
  uploadZone.hidden = mode === 'angles';
  fileList.hidden = mode === 'angles';
  renderFiles();
  notifyChange();
}

imageInput.addEventListener('change', () => {
  addPhoto(imageInput.files[0], 'Front');
  imageInput.value = '';
});
uploadZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', (event) => {
  event.preventDefault();
  uploadZone.classList.remove('dragover');
  addPhoto(event.dataTransfer.files[0], 'Front');
});
uploadModeBox
  .querySelectorAll('button')
  .forEach((button) => button.addEventListener('click', () => setUploadMode(button.dataset.mode)));
