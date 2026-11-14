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
    const download = el('button', order.hasModel ? 'Descargar modelo ↓' : 'Sin copia del modelo');
    download.type = 'button';
    download.disabled = !order.hasModel;
    download.addEventListener('click', async () => {
      download.disabled = true;
      try {
        const response = await adminFetch('/api/admin/model/' + order.code);
        if (!response.ok) throw new Error((await response.json()).error || 'No se pudo descargar el modelo.');
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = order.code + '.glb';
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      } catch (error) {
        setMessage(boardMessage, error.message, true);
      } finally {
        download.disabled = false;
      }
    });
    actions.append(select, download);
    card.append(actions);
    if (order.notes) {
      const notes = field('Comentarios', document.createTextNode(order.notes));
      notes.className = 'order-notes';
      card.append(notes);
    }
    ordersBox.append(card);
  });
}

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
