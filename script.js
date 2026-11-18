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

// Sin una elección guardada, el tema sigue al del dispositivo (y cambia con él); el botón fija una preferencia.
const deviceTheme = window.matchMedia('(prefers-color-scheme: dark)');
function savedTheme() {
  try {
    const saved = localStorage.getItem('forma-theme');
    return saved === 'dark' || saved === 'light' ? saved : null;
  } catch { return null; }
}
setTheme(savedTheme() ? savedTheme() === 'dark' : deviceTheme.matches);
deviceTheme.addEventListener('change', (event) => {
  if (!savedTheme()) setTheme(event.matches);
});
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

// Figura 3D de muestra en la portada. Si existe figura-muestra.glb se carga el visor y la figura
// reemplaza a la ilustración; si no existe, la portada queda con la ilustración tal como está.
const heroModelSlot = document.querySelector('#hero-model');
if (heroModelSlot) {
  const HERO_MODEL = 'figura-muestra.glb';
  const VIEWER_SCRIPT = 'https://ajax.googleapis.com/ajax/libs/model-viewer/4.4.0/model-viewer.min.js';
  const whiteFinish = (viewer) => {
    ((viewer.model && viewer.model.materials) || []).forEach((material) => {
      const pbr = material.pbrMetallicRoughness;
      if (pbr.baseColorTexture) pbr.baseColorTexture.setTexture(null);
      if (pbr.metallicRoughnessTexture) pbr.metallicRoughnessTexture.setTexture(null);
      pbr.setBaseColorFactor([0.88, 0.87, 0.83, 1]);
      pbr.setMetallicFactor(0);
      pbr.setRoughnessFactor(0.82);
    });
  };
  fetch(HERO_MODEL, { method: 'HEAD' }).then((response) => {
    if (!response.ok) return;
    const script = document.createElement('script');
    script.type = 'module';
    script.src = VIEWER_SCRIPT;
    document.head.append(script);
    const viewer = document.createElement('model-viewer');
    viewer.setAttribute('src', HERO_MODEL);
    viewer.setAttribute('alt', 'Figura 3D de muestra, en blanco como se imprime');
    viewer.setAttribute('loading', 'eager');
    viewer.setAttribute('camera-controls', '');
    viewer.setAttribute('disable-zoom', '');
    viewer.setAttribute('disable-pan', '');
    viewer.setAttribute('touch-action', 'pan-y');
    viewer.setAttribute('interaction-prompt', 'none');
    viewer.setAttribute('shadow-intensity', '1');
    viewer.setAttribute('environment-image', 'neutral');
    viewer.setAttribute('exposure', '0.9');
    viewer.setAttribute('shadow-softness', '0.6');
    viewer.setAttribute('field-of-view', '24deg');
    viewer.setAttribute('camera-orbit', '25deg 78deg auto');
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      viewer.setAttribute('auto-rotate', '');
      viewer.setAttribute('rotation-per-second', '18deg');
    }
    viewer.addEventListener('load', () => {
      whiteFinish(viewer);
      document.querySelector('.hero-visual').classList.add('con-figura');
      const caption = document.querySelector('#hero-caption');
      if (caption) caption.innerHTML = 'Figura de muestra hecha con IA,<br>en blanco como llega. Arrástrala para girarla.';
    }, { once: true });
    heroModelSlot.append(viewer);
  }).catch(() => {});
}
