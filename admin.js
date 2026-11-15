const loginForm = document.querySelector('#admin-login');
const keyInput = document.querySelector('#admin-key');
const loginMessage = document.querySelector('#login-message');
const board = document.querySelector('#admin-board');
const boardMessage = document.querySelector('#board-message');
const summary = document.querySelector('#admin-summary');
const ordersBox = document.querySelector('#admin-orders');
const logoutButton = document.querySelector('#admin-logout');
const refreshButton = document.querySelector('#admin-refresh');
const STATE_LABELS = { nueva: 'Nueva', contactada: 'Contactada', pagada: 'Pagada', enviada: 'Enviada', cancelada: 'Cancelada' };
const SPECIES_LABELS = { perro: 'Perro', gato: 'Gato', otro: 'Otro animal' };
const modelDialog = document.querySelector('#model-dialog');
const modelTitle = document.querySelector('#model-dialog-title');
const modelStatus = document.querySelector('#model-dialog-status');
const adminViewer = document.querySelector('#admin-viewer');
const viewWhite = document.querySelector('#view-white');
const viewColor = document.querySelector('#view-color');
const viewDownload = document.querySelector('#view-download');
const modelBlobs = new Map();
const WHITE_FINISH = [0.93, 0.92, 0.89, 1];
let openCode = '';
let openUrl = '';
let openMaterials = [];
let adminKey = '';
try { adminKey = sessionStorage.getItem('forma-admin-key') || ''; } catch {}

function setMessage(box, text, isError) {
  box.textContent = text || '';
  box.className = 'admin-message' + (isError ? ' error' : '');
}
async function adminFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), authorization: 'Bearer ' + encodeURIComponent(adminKey) }
  });
  if (response.status === 401) {
    logout();
    throw new Error('Clave incorrecta.');
  }
  return response;
}
function showBoard(visible) {
  board.hidden = !visible;
  loginForm.hidden = visible;
  logoutButton.hidden = !visible;
}
function logout() {
  adminKey = '';
  try { sessionStorage.removeItem('forma-admin-key'); } catch {}
  ordersBox.replaceChildren();
  modelBlobs.clear();
  if (modelDialog.open) modelDialog.close();
  showBoard(false);
}

function field(label, ...content) {
  const wrapper = document.createElement('div');
  const term = document.createElement('dt');
  term.textContent = label;
  const value = document.createElement('dd');
  value.append(...content);
  wrapper.append(term, value);
  return wrapper;
}
function el(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
function renderOrders(orders, states) {
  summary.replaceChildren();
  const total = el('span', orders.length === 1 ? 'reserva' : 'reservas');
  total.prepend(el('b', String(orders.length)));
  summary.append(total);
  states.forEach((state) => {
    const count = orders.filter((order) => order.status === state).length;
    if (!count) return;
    const chip = el('span', STATE_LABELS[state] || state);
    chip.prepend(el('b', String(count)));
    summary.append(chip);
  });

  ordersBox.replaceChildren();
  if (!orders.length) {
    ordersBox.append(Object.assign(el('p', 'Todavía no hay reservas. Aparecerán aquí cuando alguien reserve su figura.'), { className: 'admin-empty' }));
    return;
  }
  orders.forEach((order) => {
    const card = document.createElement('dl');
    card.className = 'order-card';
    card.dataset.status = order.status;
    const date = new Date(order.createdAt);
    const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
    const mail = el('a', order.email);
    mail.href = 'mailto:' + order.email + '?subject=' + encodeURIComponent('Tu figura FORMA · reserva ' + order.code);
    card.append(
      field('Reserva', el('strong', order.code), el('small', when)),
      field('Figura', el('strong', order.measure + ' · ' + formatPrice(order.price)), el('small', (order.petName || 'Sin nombre') + ' · ' + (SPECIES_LABELS[order.species] || order.species || ''))),
      field('Cliente', document.createTextNode(order.name), document.createElement('br'), mail)
    );

    const actions = document.createElement('div');
    actions.className = 'order-actions';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Estado de la reserva ' + order.code);
    states.forEach((state) => {
      const option = el('option', STATE_LABELS[state] || state);
      option.value = state;
      option.selected = state === order.status;
      select.append(option);
    });
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        const response = await adminFetch('/api/admin/orders/' + order.code + '/status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: select.value })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo guardar el estado.');
        order.status = result.status;
        renderOrders(orders, states);
        setMessage(boardMessage, 'Reserva ' + order.code + ' marcada como ' + (STATE_LABELS[result.status] || result.status).toLowerCase() + '.');
      } catch (error) {
        select.value = order.status;
        select.disabled = false;
        setMessage(boardMessage, error.message, true);
      }
    });
    const view = el('button', order.hasModel ? 'Ver en 3D ◈' : 'Sin copia del modelo');
    view.type = 'button';
    view.disabled = !order.hasModel;
    view.addEventListener('click', () => openModel(order));
    const download = el('button', 'Descargar modelo ↓');
    download.type = 'button';
    download.hidden = !order.hasModel;
    download.addEventListener('click', async () => {
      download.disabled = true;
      try {
        await downloadModel(order.code);
      } catch (error) {
        setMessage(boardMessage, error.message, true);
      } finally {
        download.disabled = false;
      }
    });
    actions.append(select, view, download);
    card.append(actions);
    if (order.notes) {
      const notes = field('Comentarios', document.createTextNode(order.notes));
      notes.className = 'order-notes';
      card.append(notes);
    }
    ordersBox.append(card);
  });
}

// --- Modelos: se piden con la clave del panel y quedan en memoria mientras la sesión siga abierta ---
async function fetchModel(code) {
  if (modelBlobs.has(code)) return modelBlobs.get(code);
  const response = await adminFetch('/api/admin/model/' + code);
  if (!response.ok) throw new Error((await response.json()).error || 'No se pudo obtener el modelo.');
  const blob = await response.blob();
  modelBlobs.set(code, blob);
  return blob;
}
async function downloadModel(code) {
  const url = URL.createObjectURL(await fetchModel(code));
  const link = document.createElement('a');
  link.href = url;
  link.download = code + '.glb';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function setModelStatus(text, isError) {
  modelStatus.textContent = text || '';
  modelStatus.className = 'model-dialog-status' + (isError ? ' error' : '');
}
// En blanco (como se imprime) o con los colores del modelo generado.
function applyModelFinish(white) {
  openMaterials.forEach((entry) => {
    const { pbr } = entry;
    if (pbr.baseColorTexture) pbr.baseColorTexture.setTexture(white ? null : entry.colorTexture);
    if (pbr.metallicRoughnessTexture) pbr.metallicRoughnessTexture.setTexture(white ? null : entry.surfaceTexture);
    pbr.setBaseColorFactor(white ? WHITE_FINISH : entry.color);
    pbr.setMetallicFactor(white ? 0 : entry.metallic);
    pbr.setRoughnessFactor(white ? 0.82 : entry.roughness);
  });
  viewWhite.setAttribute('aria-pressed', String(white));
  viewColor.setAttribute('aria-pressed', String(!white));
}
// El visor conserva el último modelo aunque el siguiente falle: se oculta hasta que cargue el de esta reserva.
function showViewer(visible) { adminViewer.style.visibility = visible ? 'visible' : 'hidden'; }
adminViewer.addEventListener('load', () => {
  if (!openUrl || adminViewer.src !== openUrl) return;
  showViewer(true);
  const materials = (adminViewer.model && adminViewer.model.materials) || [];
  openMaterials = materials.map((material) => {
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
  applyModelFinish(true);
  viewWhite.disabled = viewColor.disabled = false;
  setModelStatus('Arrastra para girar · rueda para acercar');
});
adminViewer.addEventListener('error', () => {
  showViewer(false);
  setModelStatus('El archivo del modelo no se pudo abrir.', true);
});

async function openModel(order) {
  openCode = order.code;
  openMaterials = [];
  modelTitle.textContent = (order.petName || 'Sin nombre') + ' · ' + order.measure + ' · ' + order.code;
  viewWhite.disabled = viewColor.disabled = true;
  showViewer(false);
  setModelStatus('Cargando el modelo…');
  modelDialog.showModal();
  try {
    const blob = await fetchModel(order.code);
    if (openCode !== order.code) return;
    openUrl = URL.createObjectURL(blob);
    adminViewer.src = openUrl;
  } catch (error) {
    setModelStatus(error.message, true);
  }
}
modelDialog.addEventListener('close', () => {
  showViewer(false);
  adminViewer.removeAttribute('src');
  if (openUrl) URL.revokeObjectURL(openUrl);
  openUrl = '';
  openCode = '';
  openMaterials = [];
});
document.querySelector('#model-close').addEventListener('click', () => modelDialog.close());
modelDialog.addEventListener('click', (event) => { if (event.target === modelDialog) modelDialog.close(); });
viewWhite.addEventListener('click', () => applyModelFinish(true));
viewColor.addEventListener('click', () => applyModelFinish(false));
viewDownload.addEventListener('click', () => {
  if (openCode) downloadModel(openCode).catch((error) => setModelStatus(error.message, true));
});

async function loadOrders() {
  setMessage(boardMessage, 'Cargando reservas…');
  const response = await adminFetch('/api/admin/orders');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudieron cargar las reservas.');
  showBoard(true);
  renderOrders(result.orders, result.states);
  setMessage(boardMessage, '');
}
async function enter() {
  try {
    await loadOrders();
    try { sessionStorage.setItem('forma-admin-key', adminKey); } catch {}
    setMessage(loginMessage, '');
  } catch (error) {
    showBoard(false);
    setMessage(loginMessage, error.message, true);
  }
}
loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  adminKey = keyInput.value;
  keyInput.value = '';
  enter();
});
logoutButton.addEventListener('click', logout);
refreshButton.addEventListener('click', () => loadOrders().catch((error) => setMessage(boardMessage, error.message, true)));
if (adminKey) enter();
