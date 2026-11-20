const tabs = [
  { button: document.querySelector('#tab-prepare'), panel: document.querySelector('#panel-prepare'), name: 'prepare' },
  { button: document.querySelector('#tab-view'), panel: document.querySelector('#panel-view'), name: 'view' }
];
const form = document.querySelector('#generation-form');
const imageInput = document.querySelector('#reference-images');
const uploadZone = document.querySelector('#upload-zone');
const fileList = document.querySelector('#file-list');
const moreAngles = document.querySelector('#more-angles');
const petNameInput = document.querySelector('#pet-name');
const consentInput = document.querySelector('#consent');
const tailDescribe = document.querySelector('#tail-describe');
const tailNotesInput = document.querySelector('#tail-notes');
const generateHint = document.querySelector('#generate-hint');
const generateButton = document.querySelector('#generate-model');
const stateBox = document.querySelector('#generation-state');
const progressBox = document.querySelector('#generation-progress');
const progressFill = document.querySelector('#progress-fill');
const progressText = document.querySelector('#progress-text');
const progressTime = document.querySelector('#progress-time');
const waitSteps = document.querySelector('#wait-steps');
const waitTip = document.querySelector('#wait-tip');
const viewer = document.querySelector('#model-viewer');
const modelState = document.querySelector('#model-state');
const modelStage = document.querySelector('#model-stage');
const viewerHint = document.querySelector('#viewer-hint');
const figureTitle = document.querySelector('#figure-title');
const finishWhite = document.querySelector('#finish-white');
const finishColor = document.querySelector('#finish-color');
const orderForm = document.querySelector('#order-form');
const sizeOptions = document.querySelector('#size-options');
const orderName = document.querySelector('#order-name');
const orderEmail = document.querySelector('#order-email');
const orderNotes = document.querySelector('#order-notes');
const orderSubmit = document.querySelector('#order-submit');
const orderStatus = document.querySelector('#order-status');
const selectedFiles = [];
const WHITE_FINISH = [0.93, 0.92, 0.89, 1];
let serviceReady = false;
let generationBusy = false;
let orderBusy = false;
let orderSent = false;
let taskId = null;
let hasGeneratedModel = false;
let originalMaterials = [];

function setActiveTab(name, focusButton = false) {
  tabs.forEach((tab) => {
    const active = tab.name === name;
    tab.button.classList.toggle('active', active);
    tab.button.setAttribute('aria-selected', String(active));
    tab.button.tabIndex = active ? 0 : -1;
    tab.panel.hidden = !active;
    if (active && focusButton) tab.button.focus();
  });
  if (name === 'view') requestAnimationFrame(() => {
    if (viewer.updateFraming) viewer.updateFraming();
  });
}
tabs.forEach((tab, index) => {
  tab.button.addEventListener('click', () => setActiveTab(tab.name));
  tab.button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    setActiveTab(tabs[next].name, true);
  });
});

const directionOptions = [
  ['?', 'Vista sin indicar'], ['Front', 'Frente'], ['Front-Left', 'Frente izquierda'],
  ['Front-Right', 'Frente derecha'], ['Back', 'Espalda'], ['Back-Left', 'Espalda izquierda'],
  ['Back-Right', 'Espalda derecha'], ['Left', 'Costado izquierdo'], ['Right', 'Costado derecho'],
  ['Up', 'Desde arriba'], ['Down', 'Desde abajo']
];
function showState(message, kind) {
  stateBox.textContent = message || '';
  stateBox.className = 'generation-state' + (kind ? ' ' + kind : '');
}
function setModelState(message, ready) {
  modelState.replaceChildren(document.createElement('i'), ' ' + message);
  modelState.classList.toggle('ready', Boolean(ready));
}
function setOrderStatus(message, kind) {
  orderStatus.textContent = message || '';
  orderStatus.className = 'order-status' + (kind ? ' ' + kind : '');
}
function selectedSize() {
  const checked = sizeOptions.querySelector('input:checked');
  return checked ? checked.value : '';
}
// La cola es lo que más falla cuando no aparece en las fotos, así que se pregunta siempre.
function tailChoice() {
  const checked = form.querySelector('input[name="tail"]:checked');
  return checked ? checked.value : '';
}
function tailReady() {
  return tailChoice() !== '' && (tailChoice() !== 'oculta' || tailNotesInput.value.trim().length >= 3);
}
function missingSteps() {
  const missing = [];
  if (preparingPhotos) missing.push('esperar a que se preparen las fotos');
  else if (!selectedFiles.length) missing.push('subir al menos una foto');
  if (!tailChoice()) missing.push('contarnos si se ve su cola');
  else if (!tailReady()) missing.push('describir su cola');
  if (!consentInput.checked) missing.push('aceptar el envío de las fotos');
  return missing;
}
function syncButtons() {
  const missing = missingSteps();
  generateButton.disabled = generationBusy || missing.length > 0 || !serviceReady;
  const list = missing.length > 1 ? missing.slice(0, -1).join(', ') + ' y ' + missing[missing.length - 1] : missing[0];
  generateHint.textContent = serviceReady && !generationBusy && missing.length ? 'Falta ' + list + '.' : '';
  orderSubmit.disabled = generationBusy || orderBusy || orderSent || !hasGeneratedModel || !selectedSize();
  finishWhite.disabled = finishColor.disabled = !hasGeneratedModel;
}
consentInput.addEventListener('change', syncButtons);
form.querySelectorAll('input[name="tail"]').forEach((radio) => radio.addEventListener('change', () => {
  tailDescribe.hidden = tailChoice() !== 'oculta';
  if (!tailDescribe.hidden) tailNotesInput.focus();
  syncButtons();
}));
tailNotesInput.addEventListener('input', syncButtons);

// --- Fotos ---
function filesReadyMessage() {
  return selectedFiles.length === 1 ? 'Foto lista.' : selectedFiles.length + ' fotos listas.';
}
// Las fotos se achican en el navegador antes de enviarlas: suben más rápido con datos móviles
// y quedan dentro de los límites de cualquier proveedor 3D (Hunyuan, por ejemplo, pide unos 6 MB por foto).
const PHOTO_MAX_SIDE = 2048;
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const PHOTO_MIN_SIDE = 600;
let preparingPhotos = 0;
async function preparePhoto(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { file, small: false };
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  const small = longest < PHOTO_MIN_SIDE;
  if (file.type !== 'image/webp' && longest <= PHOTO_MAX_SIDE && file.size <= PHOTO_MAX_BYTES) {
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
async function addFiles(files) {
  const accepted = [];
  for (const file of Array.from(files || [])) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      showState('Solo se aceptan fotos JPG, PNG o WEBP.');
      continue;
    }
    if (file.size > 25 * 1024 * 1024) {
      showState('Cada foto debe pesar 25 MB o menos.');
      continue;
    }
    const key = file.name + ':' + file.size;
    if (selectedFiles.some((entry) => entry.sourceKey === key) || accepted.some((item) => item.key === key)) continue;
    if (selectedFiles.length + preparingPhotos + accepted.length >= 5) {
      showState('Puedes subir hasta cinco fotos de la misma mascota.');
      break;
    }
    accepted.push({ file, key });
  }
  if (!accepted.length) {
    syncButtons();
    return;
  }
  preparingPhotos += accepted.length;
  showState(accepted.length === 1 ? 'Preparando la foto…' : 'Preparando ' + accepted.length + ' fotos…');
  syncButtons();
  const smallPhotos = [];
  for (const item of accepted) {
    const prepared = await preparePhoto(item.file);
    preparingPhotos -= 1;
    selectedFiles.push({ file: prepared.file, sourceKey: item.key, label: selectedFiles.length === 0 ? 'Front' : '?' });
    if (prepared.small) smallPhotos.push(item.file.name);
    renderFiles();
    syncButtons();
  }
  if (preparingPhotos) return;
  if (smallPhotos.length) {
    showState((smallPhotos.length === 1 ? 'Una foto es muy pequeña' : smallPhotos.length + ' fotos son muy pequeñas') + ' (menos de ' + PHOTO_MIN_SIDE + ' px): la figura puede salir con menos detalle.');
  } else {
    showState(filesReadyMessage(), 'success');
  }
}
function renderFiles() {
  selectedFiles.forEach((entry) => { if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl); });
  fileList.replaceChildren();
  fileList.classList.toggle('single', selectedFiles.length < 2);
  moreAngles.hidden = selectedFiles.length === 0;
  moreAngles.classList.toggle('nudge', selectedFiles.length === 1);
  if (selectedFiles.length === 1) moreAngles.textContent = 'Con una sola foto, el modelo inventa lo que no se ve. Si puedes, suma una de costado o donde se vea la cola.';
  else if (selectedFiles.length >= 5) moreAngles.textContent = 'Llegaste al máximo de cinco fotos. Indica desde dónde está tomada cada una.';
  else moreAngles.textContent = 'Indica desde dónde está tomada cada foto: ayuda a armar bien el volumen.';
  selectedFiles.forEach((entry, index) => {
    const card = document.createElement('div');
    card.className = 'file-thumb';
    const image = document.createElement('img');
    entry.previewUrl = URL.createObjectURL(entry.file);
    image.src = entry.previewUrl;
    image.alt = 'Foto seleccionada ' + (index + 1);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Quitar foto ' + (index + 1));
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      selectedFiles.splice(index, 1);
      renderFiles();
      syncButtons();
      showState(selectedFiles.length ? filesReadyMessage() : 'Sube al menos una foto.', selectedFiles.length ? 'success' : '');
    });
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Ángulo de la foto ' + (index + 1));
    directionOptions.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      if (entry.label === value) option.selected = true;
      select.append(option);
    });
    select.addEventListener('change', () => { entry.label = select.value; });
    card.append(image, remove, select);
    fileList.append(card);
  });
}
imageInput.addEventListener('change', () => {
  addFiles(Array.from(imageInput.files));
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
  addFiles(event.dataTransfer.files);
});

async function checkServer() {
  try {
    const response = await fetch('/api/health');
    const result = await response.json();
    serviceReady = Boolean(result.ready);
    if (!serviceReady) showState('La vista previa no está disponible en este momento. Vuelve a intentarlo más tarde.');
  } catch {
    serviceReady = false;
    showState('No pudimos conectar con el estudio. Recarga la página para intentarlo de nuevo.');
  }
  syncButtons();
}
checkServer();

// --- Acabado de la vista previa: en blanco (como se imprime) o con los colores de la foto ---
function captureMaterials() {
  const materials = (viewer.model && viewer.model.materials) || [];
  originalMaterials = materials.map((material) => {
    const pbr = material.pbrMetallicRoughness;
    return {
      pbr,
      color: Array.from(pbr.baseColorFactor),
      metallic: pbr.metallicFactor,
      roughness: pbr.roughnessFactor,
      colorTexture: pbr.baseColorTexture ? pbr.baseColorTexture.texture : null,
      surfaceTexture: pbr.metallicRoughnessTexture ? pbr.metallicRoughnessTexture.texture : null
    };
  });
}
function applyFinish(kind) {
  const white = kind !== 'color';
  originalMaterials.forEach((entry) => {
    const { pbr } = entry;
    if (pbr.baseColorTexture) pbr.baseColorTexture.setTexture(white ? null : entry.colorTexture);
    if (pbr.metallicRoughnessTexture) pbr.metallicRoughnessTexture.setTexture(white ? null : entry.surfaceTexture);
    pbr.setBaseColorFactor(white ? WHITE_FINISH : entry.color);
    pbr.setMetallicFactor(white ? 0 : entry.metallic);
    pbr.setRoughnessFactor(white ? 0.82 : entry.roughness);
  });
  finishWhite.setAttribute('aria-pressed', String(white));
  finishColor.setAttribute('aria-pressed', String(!white));
}
finishWhite.addEventListener('click', () => applyFinish('white'));
finishColor.addEventListener('click', () => applyFinish('color'));

// --- Generación de la vista previa ---
function wait(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }

// --- Pantalla de espera: etapas, tiempo transcurrido y consejos mientras se genera ---
const WAIT_STEPS = {
  send: 'Enviando las fotos…',
  queue: 'Revisando sus fotos…',
  shape: 'Armando su forma…',
  detail: 'Afinando orejas, patas y cola…',
  viewer: 'Abriendo la figura en 3D…'
};
const WAIT_TIPS = [
  'La medida de cada talla es el lado más largo de la figura. En la portada puedes compararlas con una taza.',
  'La figura llega en blanco, lista para pintar o para dejarla así. Si prefieres, al reservar puedes pedirla pintada por el taller.',
  'Reservar no te cobra nada todavía: te escribimos para confirmar el pago y el envío.',
  'Con el código de tu reserva y tu correo puedes ver en qué etapa va en «Mi pedido».',
  'Si la figura no te convence, puedes probar con otras fotos: un ángulo de costado suele mejorar mucho el resultado.',
  'Los detalles muy finos, como bigotes o pelos sueltos, se simplifican para que la figura se pueda imprimir.'
];
const PAGE_TITLE = document.title;
const waitState = { started: 0, step: '', clock: null, tipIndex: 0 };
function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
function setWaitStep(step) {
  waitState.step = step;
  const order = Object.keys(WAIT_STEPS);
  const current = order.indexOf(step);
  waitSteps.querySelectorAll('li').forEach((item) => {
    const index = order.indexOf(item.dataset.step);
    item.classList.toggle('hecho', index < current);
    item.classList.toggle('actual', index === current);
  });
  progressText.textContent = WAIT_STEPS[step];
}
function tickWait() {
  const elapsed = Date.now() - waitState.started;
  progressTime.textContent = formatElapsed(elapsed);
  // Avance estimado: se acerca al 95 % sin llegar, porque el servicio no informa un porcentaje real.
  const estimate = 4 + 91 * (1 - Math.exp(-elapsed / 150000));
  progressFill.style.width = estimate.toFixed(1) + '%';
  const seconds = Math.floor(elapsed / 1000);
  if (seconds > 0 && seconds % 10 === 0) showWaitTip(waitState.tipIndex + 1);
}
function showWaitTip(index) {
  waitState.tipIndex = index % WAIT_TIPS.length;
  waitTip.textContent = WAIT_TIPS[waitState.tipIndex];
}
function startWaiting() {
  waitState.started = Date.now();
  progressBox.hidden = false;
  progressBox.classList.remove('terminado', 'fallido');
  progressFill.style.width = '4%';
  progressTime.textContent = '0:00';
  showWaitTip(Math.floor(Math.random() * WAIT_TIPS.length));
  setWaitStep('send');
  window.clearInterval(waitState.clock);
  waitState.clock = window.setInterval(tickWait, 1000);
  progressBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function stopWaiting(ok) {
  window.clearInterval(waitState.clock);
  progressBox.classList.add(ok ? 'terminado' : 'fallido');
  if (ok) {
    waitSteps.querySelectorAll('li').forEach((item) => { item.classList.add('hecho'); item.classList.remove('actual'); });
    progressFill.style.width = '100%';
    progressText.textContent = 'La vista previa está lista.';
    // Si el cliente se fue a otra pestaña, el título le avisa que ya puede volver.
    if (document.hidden) document.title = '✓ Su figura está lista · FORMA';
  } else {
    progressText.textContent = 'No se pudo completar.';
    if (document.hidden) document.title = 'No se pudo crear la figura · FORMA';
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) document.title = PAGE_TITLE;
});

async function pollTask(id) {
  const deadline = Date.now() + 20 * 60 * 1000;
  let delay = 4000;
  while (Date.now() < deadline) {
    await wait(delay);
    const response = await fetch('/api/status/' + encodeURIComponent(id));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo consultar el avance.');
    if (result.status === 'failed') throw new Error(result.error || 'No pudimos crear la figura con esta foto.');
    if (result.status === 'done') return result;
    if (result.status === 'generating' || result.status === 'downloading') {
      setWaitStep(Date.now() - waitState.started > 100000 || result.status === 'downloading' ? 'detail' : 'shape');
    }
    delay = Math.min(delay + 2000, 15000);
  }
  throw new Error('La vista previa está tardando más de lo esperado. Inténtalo nuevamente más tarde.');
}
function waitForViewerLoad(source) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('La figura no se pudo abrir en el visor.')), 90000);
    viewer.addEventListener('load', () => { window.clearTimeout(timeout); resolve(); }, { once: true });
    viewer.addEventListener('error', () => { window.clearTimeout(timeout); reject(new Error('La figura generada no se pudo abrir.')); }, { once: true });
    viewer.src = source;
  });
}

async function runGeneration() {
  if (generationBusy || !selectedFiles.length) return;
  generationBusy = true;
  syncButtons();
  startWaiting();
  showState('');
  setModelState('PREPARANDO LA FIGURA', false);
  generateButton.innerHTML = 'Creando la vista previa… <span>◌</span>';
  const petName = petNameInput.value.trim();
  try {
    const payload = new FormData();
    selectedFiles.forEach((entry) => {
      payload.append('images', entry.file, entry.file.name);
      payload.append('image_label', entry.label);
    });
    payload.append('species', document.querySelector('#pet-species').value);
    payload.append('petName', petName);
    payload.append('notes', document.querySelector('#pet-notes').value.trim());
    payload.append('tail', tailChoice());
    payload.append('tailNotes', tailChoice() === 'oculta' ? tailNotesInput.value.trim() : '');
    const response = await fetch('/api/generate', { method: 'POST', body: payload });
    const started = await response.json();
    if (!response.ok) throw new Error(started.error || 'No se pudo iniciar la vista previa.');
    setModelState('MODELANDO', false);
    setWaitStep('queue');
    const completed = await pollTask(started.id);
    if (!completed.modelReady) throw new Error('La figura se generó, pero no se pudo preparar la vista previa.');
    setWaitStep('viewer');
    await waitForViewerLoad('/api/model/' + encodeURIComponent(started.id) + '?v=' + Date.now());
    taskId = started.id;
    hasGeneratedModel = true;
    orderSent = false;
    captureMaterials();
    applyFinish(selectedFinish() === 'pintada' ? 'color' : 'white');
    modelStage.classList.add('ready');
    viewerHint.hidden = false;
    figureTitle.textContent = petName ? 'La figura de ' + petName : 'Su figura';
    setModelState('VISTA PREVIA LISTA', true);
    stopWaiting(true);
    showState('Listo. Revisa la figura y, si te gusta, elige el tamaño.', 'success');
    setOrderStatus('Revisa el tamaño y completa tus datos para reservar.');
    generateButton.innerHTML = 'Probar con otras fotos <span>↗</span>';
    setActiveTab('view');
  } catch (error) {
    setModelState(hasGeneratedModel ? 'VISTA PREVIA ANTERIOR' : 'SIN FIGURA TODAVÍA', hasGeneratedModel);
    stopWaiting(false);
    showState(error.message || 'Ocurrió un error al crear la vista previa.');
    generateButton.innerHTML = 'Intentar de nuevo <span>↗</span>';
  } finally {
    generationBusy = false;
    syncButtons();
  }
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (missingSteps().length) return;
  runGeneration();
});

// --- Pedido ---
const paintOption = document.querySelector('#paint-option');
const paintPrice = document.querySelector('#paint-price');
const finishNote = document.querySelector('#finish-note');
const orderTotal = document.querySelector('#order-total');
let catalogSizes = [];
function selectedFinish() {
  const checked = orderForm.querySelector('input[name="finish"]:checked');
  return checked ? checked.value : 'blanco';
}
// Muestra el recargo de pintarla según la talla elegida y el total de la reserva.
function updateOrderTotal() {
  const size = catalogSizes.find((item) => item.id === selectedSize());
  const canPaint = Boolean(size && Number(size.pintada) > 0);
  paintOption.hidden = !canPaint;
  if (!canPaint && selectedFinish() === 'pintada') orderForm.querySelector('input[name="finish"][value="blanco"]').checked = true;
  paintPrice.textContent = canPaint ? '+' + formatPrice(size.pintada) + ' · por el taller' : 'por el taller';
  const painted = canPaint && selectedFinish() === 'pintada';
  finishNote.hidden = !painted;
  orderTotal.hidden = !size;
  if (size) {
    orderTotal.replaceChildren('Total ', Object.assign(document.createElement('strong'), { textContent: formatPrice(size.precio + (painted ? Number(size.pintada) : 0)) }), ' más envío');
  }
}
orderForm.querySelectorAll('input[name="finish"]').forEach((radio) => radio.addEventListener('change', () => {
  updateOrderTotal();
  // Al elegir pintada se muestra la vista previa con sus colores, que es la guía del taller.
  if (hasGeneratedModel) applyFinish(selectedFinish() === 'pintada' ? 'color' : 'white');
}));

catalogPromise.then((catalog) => {
  catalogSizes = catalog.tallas;
  catalog.tallas.forEach((size) => {
    const option = document.createElement('label');
    option.className = 'size-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'size';
    input.value = size.id;
    input.checked = Boolean(size.destacada);
    input.addEventListener('change', () => { syncButtons(); updateOrderTotal(); });
    const measure = document.createElement('strong');
    measure.textContent = size.medida;
    const detail = document.createElement('small');
    detail.textContent = size.nombre + ' · ' + formatPrice(size.precio);
    option.append(input, measure, detail);
    sizeOptions.append(option);
  });
  syncButtons();
  updateOrderTotal();
}).catch(() => {
  setOrderStatus('No pudimos cargar los tamaños. Recarga la página para intentarlo de nuevo.', 'error');
});

orderForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!hasGeneratedModel || orderBusy || orderSent) return;
  const name = orderName.value.trim();
  const email = orderEmail.value.trim();
  if (!name) { setOrderStatus('Escribe tu nombre para reservar.', 'error'); orderName.focus(); return; }
  if (!orderEmail.checkValidity() || !email) { setOrderStatus('Revisa tu correo: lo usaremos para confirmar el pedido.', 'error'); orderEmail.focus(); return; }
  orderBusy = true;
  syncButtons();
  setOrderStatus('Enviando tu reserva…');
  try {
    const response = await fetch('/api/order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId, size: selectedSize(), finish: selectedFinish(), name, email, notes: orderNotes.value.trim() })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo registrar la reserva.');
    orderSent = true;
    orderSubmit.innerHTML = 'Reserva enviada <span>✓</span>';
    setOrderStatus('Reserva ' + result.code + ' recibida. Te escribiremos a ' + email + ' para confirmar el pago y el envío.', 'success');
    const trackLink = document.createElement('a');
    trackLink.href = 'ingresar.html?codigo=' + encodeURIComponent(result.code);
    trackLink.textContent = 'Sigue tu pedido aquí';
    orderStatus.append(' ', trackLink, '.');
  } catch (error) {
    setOrderStatus(error.message || 'No se pudo registrar la reserva.', 'error');
  } finally {
    orderBusy = false;
    syncButtons();
  }
});
