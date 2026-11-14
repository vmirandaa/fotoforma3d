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
const generateButton = document.querySelector('#generate-model');
const stateBox = document.querySelector('#generation-state');
const progressBox = document.querySelector('#generation-progress');
const progressFill = document.querySelector('#progress-fill');
const progressText = document.querySelector('#progress-text');
const progressPercent = document.querySelector('#progress-percent');
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
function syncButtons() {
  generateButton.disabled = generationBusy || selectedFiles.length === 0 || !consentInput.checked || !serviceReady;
  orderSubmit.disabled = generationBusy || orderBusy || orderSent || !hasGeneratedModel || !selectedSize();
  finishWhite.disabled = finishColor.disabled = !hasGeneratedModel;
}
consentInput.addEventListener('change', syncButtons);

// --- Fotos ---
function filesReadyMessage() {
  return selectedFiles.length === 1 ? 'Foto lista.' : selectedFiles.length + ' fotos listas.';
}
function addFiles(files) {
  for (const file of Array.from(files || [])) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      showState('Solo se aceptan fotos JPG, PNG o WEBP.');
      continue;
    }
    if (file.size > 25 * 1024 * 1024) {
      showState('Cada foto debe pesar 25 MB o menos.');
      continue;
    }
    if (selectedFiles.some((entry) => entry.file.name === file.name && entry.file.size === file.size)) continue;
    if (selectedFiles.length >= 5) {
      showState('Puedes subir hasta cinco fotos de la misma mascota.');
      break;
    }
    selectedFiles.push({ file, label: selectedFiles.length === 0 ? 'Front' : '?' });
  }
  renderFiles();
  if (selectedFiles.length) showState(filesReadyMessage(), 'success');
  syncButtons();
}
function renderFiles() {
  selectedFiles.forEach((entry) => { if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl); });
  fileList.replaceChildren();
  fileList.classList.toggle('single', selectedFiles.length < 2);
  moreAngles.hidden = selectedFiles.length === 0;
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
  addFiles(imageInput.files);
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
async function pollTask(id) {
  const deadline = Date.now() + 20 * 60 * 1000;
  let delay = 5000;
  let elapsed = 0;
  while (Date.now() < deadline) {
    await wait(delay);
    elapsed += delay;
    const approx = Math.min(92, Math.round(10 + (elapsed / (20 * 60 * 1000)) * 80));
    progressFill.style.width = approx + '%';
    progressPercent.textContent = approx + '%';
    progressText.textContent = elapsed < 30000 ? 'Modelando su forma…' : 'Afinando orejas, patas y cola…';
    const response = await fetch('/api/status/' + encodeURIComponent(id));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo consultar el avance.');
    if (result.status === 'failed') throw new Error(result.error || 'No pudimos crear la figura con esta foto.');
    if (result.status === 'done') return result;
    delay = Math.min(delay + 5000, 30000);
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
  progressBox.hidden = false;
  progressFill.style.width = '3%';
  progressPercent.textContent = '';
  progressText.textContent = 'Enviando la foto…';
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
    const response = await fetch('/api/generate', { method: 'POST', body: payload });
    const started = await response.json();
    if (!response.ok) throw new Error(started.error || 'No se pudo iniciar la vista previa.');
    setModelState('MODELANDO', false);
    progressText.textContent = 'Mirando su foto…';
    const completed = await pollTask(started.id);
    if (!completed.modelReady) throw new Error('La figura se generó, pero no se pudo preparar la vista previa.');
    await waitForViewerLoad('/api/model/' + encodeURIComponent(started.id) + '?v=' + Date.now());
    taskId = started.id;
    hasGeneratedModel = true;
    orderSent = false;
    captureMaterials();
    applyFinish('white');
    modelStage.classList.add('ready');
    viewerHint.hidden = false;
    figureTitle.textContent = petName ? 'La figura de ' + petName : 'Su figura';
    setModelState('VISTA PREVIA LISTA', true);
    progressFill.style.width = '100%';
    progressPercent.textContent = '100%';
    progressText.textContent = 'La vista previa está lista.';
    showState('Listo. Revisa la figura y, si te gusta, elige el tamaño.', 'success');
    setOrderStatus('Elige un tamaño para reservar tu figura.');
    generateButton.innerHTML = 'Probar con otra foto <span>↗</span>';
    setActiveTab('view');
  } catch (error) {
    setModelState(hasGeneratedModel ? 'VISTA PREVIA ANTERIOR' : 'SIN FIGURA TODAVÍA', hasGeneratedModel);
    progressText.textContent = 'No se pudo completar.';
    showState(error.message || 'Ocurrió un error al crear la vista previa.');
    generateButton.innerHTML = 'Intentar de nuevo <span>↗</span>';
  } finally {
    generationBusy = false;
    syncButtons();
  }
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!selectedFiles.length || !consentInput.checked) return;
  runGeneration();
});

// --- Pedido ---
catalogPromise.then((catalog) => {
  catalog.tallas.forEach((size) => {
    const option = document.createElement('label');
    option.className = 'size-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'size';
    input.value = size.id;
    input.checked = Boolean(size.destacada);
    input.addEventListener('change', syncButtons);
    const measure = document.createElement('strong');
    measure.textContent = size.medida;
    const detail = document.createElement('small');
    detail.textContent = size.nombre + ' · ' + formatPrice(size.precio);
    option.append(input, measure, detail);
    sizeOptions.append(option);
  });
  syncButtons();
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
      body: JSON.stringify({ taskId, size: selectedSize(), name, email, notes: orderNotes.value.trim() })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo registrar la reserva.');
    orderSent = true;
    orderSubmit.innerHTML = 'Reserva enviada <span>✓</span>';
    setOrderStatus('Reserva ' + result.code + ' recibida. Te escribiremos a ' + email + ' para confirmar el pago y el envío.', 'success');
  } catch (error) {
    setOrderStatus(error.message || 'No se pudo registrar la reserva.', 'error');
  } finally {
    orderBusy = false;
    syncButtons();
  }
});
