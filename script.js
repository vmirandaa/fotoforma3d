const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');
const themeButton = document.querySelector('#theme-toggle');
const themeLabel = document.querySelector('#theme-label');

function setTheme(isDark, savePreference = false) {
  document.body.classList.toggle('theme-dark', isDark);
  themeButton.setAttribute('aria-pressed', String(isDark));
  themeLabel.textContent = isDark ? 'Modo claro' : 'Modo oscuro';
  if (savePreference) {
    try { localStorage.setItem('forma-theme', isDark ? 'dark' : 'light'); } catch {}
  }
}

try { setTheme(localStorage.getItem('forma-theme') === 'dark'); } catch { setTheme(false); }
themeButton.addEventListener('click', () => {
  const nextIsDark = !document.body.classList.contains('theme-dark');
  if (document.startViewTransition) document.startViewTransition(() => setTheme(nextIsDark, true));
  else setTheme(nextIsDark, true);
});

// Catálogo de tallas y precios: una sola fuente (catalogo.json) para la portada, el estudio y el servidor.
function formatPrice(value) { return '$' + Number(value).toLocaleString('es-CL'); }
const catalogPromise = fetch('catalogo.json').then((response) => {
  if (!response.ok) throw new Error('catálogo no disponible');
  return response.json();
});
catalogPromise.catch(() => {});

const sizeGrid = document.querySelector('#size-grid');
if (sizeGrid) {
  catalogPromise.then((catalog) => {
    sizeGrid.replaceChildren();
    catalog.tallas.forEach((size) => {
      const card = document.createElement('article');
      card.className = 'size-card' + (size.destacada ? ' featured' : '');
      const name = document.createElement('span');
      name.className = 'size-name';
      name.textContent = size.nombre.toUpperCase();
      const measure = document.createElement('div');
      measure.className = 'size-measure';
      measure.textContent = size.medida;
      const text = document.createElement('p');
      text.textContent = size.descripcion;
      const price = document.createElement('div');
      price.className = 'size-price';
      price.textContent = formatPrice(size.precio);
      card.append(name, measure, text, price);
      if (size.destacada) {
        const tag = document.createElement('span');
        tag.className = 'size-tag';
        tag.textContent = 'RECOMENDADA';
        card.append(tag);
      }
      sizeGrid.append(card);
    });
    const shipping = document.querySelector('#shipping-note');
    if (shipping) shipping.textContent = catalog.envio || '';
  }).catch(() => {
    sizeGrid.innerHTML = '<p class="size-fallback">No pudimos cargar los precios. <a href="mailto:hola@forma3d.cl">Escríbenos</a> y te los enviamos.</p>';
  });
}

menuButton.addEventListener('click', () => {
  const expanded = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(expanded));
  menuButton.setAttribute('aria-label', expanded ? 'Cerrar menú' : 'Abrir menú');
});
nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  nav.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
}));
