const SUPABASE_URL = 'https://uuonayxdlmdkrznghivz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1b25heXhkbG1ka3J6bmdoaXZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDUwMzAsImV4cCI6MjA5NDMyMTAzMH0.p9xhXP0_EcL6gqKOESmjfcPA3qYzdE9iIQTXnSAUeqI';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CATS = {
  'Concierto':  { emoji: '🎵', color: 'var(--c-concert)' },
  'Cine':       { emoji: '🎬', color: 'var(--c-cinema)'  },
  'Teatro':     { emoji: '🎭', color: 'var(--c-teatro)'  },
  'Exposición': { emoji: '🖼️', color: 'var(--c-expo)'    },
  'Otro':       { emoji: '✨', color: 'var(--c-otro)'    },
};

let events = [], filterCat = 'Todos', filterYear = 'Todos', sortBy = 'recent';
let searchQuery = '', formRating = 0, saving = false, editingId = null;
let viewMode = localStorage.getItem('viewMode') || 'grid';
let pendingImageFile = null, existingImageUrl = null, removeExistingImage = false;
let focusX = 50, focusY = 50, tempFocusX = 50, tempFocusY = 50;

// ── Utils ──
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  setTimeout(() => el.className = '', 2500);
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const M = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${parseInt(day)} ${M[parseInt(m)-1]} ${y}`;
}

function setProgress(pct) {
  const wrap = document.getElementById('img-progress');
  const bar  = document.getElementById('img-progress-bar');
  wrap.style.display = pct > 0 && pct < 100 ? 'block' : 'none';
  bar.style.width = pct + '%';
}

function highlight(text, query) {
  if (!query || !text) return text || '';
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="highlight">$1</mark>');
}

// ── Auth ──
async function doLogin() {
  const email = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-pass').value;
  if (!email || !pass) { showLoginError('Introduce tu email y contraseña.'); return; }
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Entrando…';
  const { error } = await db.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false;
  btn.textContent = 'Entrar';
  if (error) { showLoginError('Email o contraseña incorrectos.'); return; }
  hideLoginScreen();
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

async function doLogout() {
  await db.auth.signOut();
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('l-pass').value = '';
  document.getElementById('login-error').style.display = 'none';
}

function hideLoginScreen() {
  document.getElementById('login-screen').style.display = 'none';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') doLogin();
});

// ── Data ──
async function loadEvents() {
  const { data, error } = await db.from('events').select('*').order('created_at', { ascending: false });
  if (error) { toast('Error al conectar con la base de datos', true); return; }
  events = data || [];
  render();
}

// ── View toggle ──
function setView(mode) {
  viewMode = mode;
  localStorage.setItem('viewMode', mode);
  document.getElementById('btn-grid').classList.toggle('active', mode === 'grid');
  document.getElementById('btn-list').classList.toggle('active', mode === 'list');
  const grid = document.getElementById('events-grid');
  grid.classList.toggle('list-view', mode === 'list');
}

// ── Search ──
function onSearch(e) {
  searchQuery = e.target.value.trim();
  document.getElementById('search-clear').style.display = searchQuery ? 'block' : 'none';
  renderGrid();
}

function clearSearch() {
  searchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  renderGrid();
}

// ── Sort ──
function onSort(e) {
  sortBy = e.target.value;
  renderGrid();
}

function sortedEvents(list) {
  const copy = [...list];
  if (sortBy === 'recent')   return copy.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  if (sortBy === 'oldest')   return copy.sort((a,b) => (a.date||'') > (b.date||'') ? 1 : -1);
  if (sortBy === 'newest')   return copy.sort((a,b) => (a.date||'') > (b.date||'') ? -1 : 1);
  if (sortBy === 'rating')   return copy.sort((a,b) => (b.rating||0) - (a.rating||0));
  if (sortBy === 'title')    return copy.sort((a,b) => a.title.localeCompare(b.title, 'es'));
  return copy;
}

// ── Image ──
function onImageSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  pendingImageFile = file;
  focusX = 50; focusY = 50;
  const url = URL.createObjectURL(file);
  showThumb(url, 50, 50);
  document.getElementById('img-label-text').textContent = 'Imagen seleccionada ✓';
  openFocusPickerWithUrl(url);
}

function showThumb(url, x, y) {
  const wrap = document.getElementById('img-thumb-wrap');
  const img  = document.getElementById('img-thumb');
  img.src = url;
  wrap.style.setProperty('--thumb-pos', `${x}% ${y}%`);
  wrap.style.display = 'block';
}

function removeImage(e) {
  e.stopPropagation();
  pendingImageFile = null;
  removeExistingImage = true;
  focusX = 50; focusY = 50;
  document.getElementById('img-thumb-wrap').style.display = 'none';
  document.getElementById('img-thumb').src = '';
  document.getElementById('img-label-text').textContent = 'Seleccionar imagen…';
  document.getElementById('f-image').value = '';
  setProgress(0);
}

// ── Focus picker ──
function openFocusPicker() {
  const src = document.getElementById('img-thumb').src;
  if (!src) return;
  openFocusPickerWithUrl(src);
}

function openFocusPickerWithUrl(url) {
  tempFocusX = focusX;
  tempFocusY = focusY;
  const img = document.getElementById('focus-img');
  img.src = url;
  updateFocusUI(tempFocusX, tempFocusY);
  document.getElementById('focus-overlay').classList.add('open');
  const wrap = document.getElementById('focus-img-wrap');
  wrap.addEventListener('mousedown', onFocusDrag);
  wrap.addEventListener('touchstart', onFocusTouchDrag, { passive: false });
}

function closeFocusPicker() {
  document.getElementById('focus-overlay').classList.remove('open');
  removeFocusListeners();
}

function confirmFocus() {
  focusX = tempFocusX;
  focusY = tempFocusY;
  document.getElementById('img-thumb-wrap').style.setProperty('--thumb-pos', `${focusX}% ${focusY}%`);
  closeFocusPicker();
}

function removeFocusListeners() {
  const wrap = document.getElementById('focus-img-wrap');
  wrap.removeEventListener('mousedown', onFocusDrag);
  wrap.removeEventListener('touchstart', onFocusTouchDrag);
}

function getPctFromEvent(e, el) {
  const rect = el.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const x = Math.max(0, Math.min(100, Math.round((clientX - rect.left) / rect.width  * 100)));
  const y = Math.max(0, Math.min(100, Math.round((clientY - rect.top)  / rect.height * 100)));
  return { x, y };
}

function updateFocusUI(x, y) {
  const wrap = document.getElementById('focus-img-wrap');
  const ch   = document.getElementById('focus-crosshair');
  wrap.style.setProperty('--focus-pos', `${x}% ${y}%`);
  ch.style.left = x + '%';
  ch.style.top  = y + '%';
}

function onFocusDrag(e) {
  e.preventDefault();
  const wrap = document.getElementById('focus-img-wrap');
  const move = ev => { const {x,y} = getPctFromEvent(ev, wrap); tempFocusX=x; tempFocusY=y; updateFocusUI(x,y); };
  const up   = ()  => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
  const {x,y} = getPctFromEvent(e, wrap); tempFocusX=x; tempFocusY=y; updateFocusUI(x,y);
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup',   up);
}

function onFocusTouchDrag(e) {
  e.preventDefault();
  const wrap = document.getElementById('focus-img-wrap');
  const move = ev => { const {x,y} = getPctFromEvent(ev, wrap); tempFocusX=x; tempFocusY=y; updateFocusUI(x,y); };
  const end  = ()  => { document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); };
  const {x,y} = getPctFromEvent(e, wrap); tempFocusX=x; tempFocusY=y; updateFocusUI(x,y);
  document.addEventListener('touchmove', move, { passive: false });
  document.addEventListener('touchend',  end);
}

async function compressImage(file, maxW = 1400, quality = 0.85) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(resolve, 'image/jpeg', quality);
    };
    img.src = url;
  });
}

async function uploadImage(file) {
  setProgress(10);
  const blob = await compressImage(file);
  setProgress(40);
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await db.storage.from('event-images').upload(name, blob, { contentType: 'image/jpeg' });
  setProgress(90);
  if (error) { setProgress(0); throw error; }
  const { data: { publicUrl } } = db.storage.from('event-images').getPublicUrl(name);
  setProgress(0);
  return publicUrl;
}

async function deleteImageFromUrl(url) {
  if (!url) return;
  const parts = url.split('/event-images/');
  if (parts.length < 2) return;
  await db.storage.from('event-images').remove([parts[1]]);
}

// ── Form ──
function openForm(ev = null) {
  editingId = ev ? ev.id : null;
  pendingImageFile = null;
  removeExistingImage = false;
  existingImageUrl = ev?.image_url || null;
  focusX = parseInt((ev?.image_position || '50% 50%').split(' ')[0]) || 50;
  focusY = parseInt((ev?.image_position || '50% 50%').split(' ')[1]) || 50;

  document.getElementById('sheet-title').textContent = ev ? 'Editar evento' : 'Nuevo evento';
  document.getElementById('save-btn').textContent    = ev ? 'Guardar cambios' : 'Guardar evento';
  document.getElementById('f-title').value    = ev?.title   || '';
  document.getElementById('f-date').value     = ev?.date    || new Date().toISOString().split('T')[0];
  document.getElementById('f-cat').value      = ev?.cat     || 'Concierto';
  document.getElementById('f-venue').value    = ev?.venue   || '';
  document.getElementById('f-city').value     = ev?.city    || '';
  document.getElementById('f-address').value  = ev?.address || '';
  document.getElementById('f-maps-url').value = ev?.maps_url|| '';
  document.getElementById('f-notes').value    = ev?.notes   || '';
  document.getElementById('f-image').value    = '';
  setProgress(0);

  const wrap = document.getElementById('img-thumb-wrap');
  if (ev?.image_url) {
    showThumb(ev.image_url, focusX, focusY);
    document.getElementById('img-label-text').textContent = 'Cambiar imagen…';
  } else {
    wrap.style.display = 'none';
    document.getElementById('img-thumb').src = '';
    document.getElementById('img-label-text').textContent = 'Seleccionar imagen…';
  }

  formRating = ev?.rating || 0;
  renderStars();
  document.getElementById('overlay').classList.add('open');
  setTimeout(() => document.getElementById('f-title').focus(), 300);
}

function closeForm() {
  document.getElementById('overlay').classList.remove('open');
  editingId = null;
}

function overlayClick(e) {
  if (e.target === document.getElementById('overlay')) closeForm();
}

function renderStars() {
  document.getElementById('star-input').innerHTML = [1,2,3,4,5].map(n =>
    `<button class="star-btn${n <= formRating ? ' filled' : ''}" onclick="setRating(${n})">${n <= formRating ? '★' : '☆'}</button>`
  ).join('');
}

function setRating(n) { formRating = n; renderStars(); }

async function saveEvent() {
  if (saving) return;
  const title = document.getElementById('f-title').value.trim();
  if (!title) { document.getElementById('f-title').focus(); return; }
  saving = true;
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Guardando…';

  let imageUrl = existingImageUrl;
  let imagePosition = `${focusX}% ${focusY}%`;

  try {
    if (pendingImageFile) {
      if (existingImageUrl) await deleteImageFromUrl(existingImageUrl);
      imageUrl = await uploadImage(pendingImageFile);
    } else if (removeExistingImage && existingImageUrl) {
      await deleteImageFromUrl(existingImageUrl);
      imageUrl = null;
      imagePosition = '50% 50%';
    }
  } catch(e) {
    saving = false;
    btn.disabled = false;
    btn.textContent = editingId ? 'Guardar cambios' : 'Guardar evento';
    toast('Error al subir la imagen', true);
    return;
  }

  const payload = {
    title,
    date:           document.getElementById('f-date').value,
    cat:            document.getElementById('f-cat').value,
    venue:          document.getElementById('f-venue').value.trim(),
    city:           document.getElementById('f-city').value.trim(),
    address:        document.getElementById('f-address').value.trim(),
    maps_url:       document.getElementById('f-maps-url').value.trim(),
    notes:          document.getElementById('f-notes').value.trim(),
    rating:         formRating,
    image_url:      imageUrl,
    image_position: imagePosition,
  };

  if (editingId) {
    const { data, error } = await db.from('events').update(payload).eq('id', editingId).select().single();
    saving = false; btn.disabled = false; btn.textContent = 'Guardar cambios';
    if (error) { toast('Error al actualizar', true); return; }
    events = events.map(e => e.id === editingId ? data : e);
    toast('✓ Evento actualizado');
  } else {
    const { data, error } = await db.from('events').insert([payload]).select().single();
    saving = false; btn.disabled = false; btn.textContent = 'Guardar evento';
    if (error) { toast('Error al guardar', true); return; }
    events.unshift(data);
    toast('✓ Evento guardado');
  }
  closeForm();
  render();
}

async function deleteEvent(id) {
  if (!confirm('¿Eliminar este evento?')) return;
  const ev = events.find(e => e.id === id);
  if (ev?.image_url) await deleteImageFromUrl(ev.image_url);
  const { error } = await db.from('events').delete().eq('id', id);
  if (error) { toast('Error al eliminar', true); return; }
  events = events.filter(e => e.id !== id);
  render();
  toast('Evento eliminado');
}

// ── Filters ──
function setFilter(c) { filterCat = c; render(); }
function setYear(y)   { filterYear = y; render(); }
function getYears()   { return [...new Set(events.map(e => e.date?.slice(0,4)).filter(Boolean))].sort((a,b) => b-a); }

// ── Render ──
function render() { renderStats(); renderFilters(); renderGrid(); }

function renderStats() {
  const total = events.length;
  const year  = new Date().getFullYear();
  const yearCount = events.filter(e => e.date?.startsWith(year)).length;
  const counts = Object.keys(CATS).map(c => ({ c, n: events.filter(e => e.cat === c).length }));
  const top = counts.reduce((a,b) => b.n > a.n ? b : a, { c:'—', n:0 });
  const rated = events.filter(e => e.rating > 0);
  const avg = rated.length ? (rated.reduce((s,e) => s+e.rating, 0) / rated.length).toFixed(1) : '—';
  document.getElementById('stats-bar').innerHTML = `
    <div class="stat"><div class="stat-n">${total}</div><div class="stat-l">Total</div></div>
    <div class="stat"><div class="stat-n">${yearCount}</div><div class="stat-l">Este año</div></div>
    <div class="stat"><div class="stat-n" style="font-size:18px;padding-top:4px">${top.n > 0 ? CATS[top.c].emoji : '—'}</div><div class="stat-l">Categoría top</div></div>
    <div class="stat"><div class="stat-n">${avg}</div><div class="stat-l">Valoración</div></div>`;
}

function renderFilters() {
  const years = getYears();
  const catPills = ['Todos', ...Object.keys(CATS)].map(c =>
    `<button class="pill${filterCat===c?' active':''}" onclick="setFilter('${c}')">${c==='Todos'?'Todos':CATS[c].emoji+' '+c}</button>`
  ).join('');
  const yearPills = years.length
    ? '<div class="filter-divider"></div>' + years.map(y =>
        `<button class="pill year${filterYear===y?' active':''}" onclick="setYear('${y}')">${y}</button>`
      ).join('')
    : '';
  const sortControl = `
    <div class="filter-spacer"></div>
    <select class="sort-select" onchange="onSort(event)" title="Ordenar">
      <option value="recent"  ${sortBy==='recent' ?'selected':''}>↓ Recientes</option>
      <option value="newest"  ${sortBy==='newest' ?'selected':''}>↓ Fecha</option>
      <option value="oldest"  ${sortBy==='oldest' ?'selected':''}>↑ Fecha</option>
      <option value="rating"  ${sortBy==='rating' ?'selected':''}>★ Valoración</option>
      <option value="title"   ${sortBy==='title'  ?'selected':''}>A→Z Título</option>
    </select>`;
  document.getElementById('filters').innerHTML = catPills + yearPills + sortControl;
}

function renderGrid() {
  const el = document.getElementById('events-grid');
  el.classList.toggle('list-view', viewMode === 'list');
  document.getElementById('btn-grid')?.classList.toggle('active', viewMode === 'grid');
  document.getElementById('btn-list')?.classList.toggle('active', viewMode === 'list');
  let list = events;
  if (filterCat  !== 'Todos') list = list.filter(e => e.cat === filterCat);
  if (filterYear !== 'Todos') list = list.filter(e => e.date?.startsWith(filterYear));
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(e =>
      e.title?.toLowerCase().includes(q) ||
      e.venue?.toLowerCase().includes(q) ||
      e.city?.toLowerCase().includes(q)  ||
      e.notes?.toLowerCase().includes(q)
    );
  }
  list = sortedEvents(list);

  if (!list.length) {
    const isEmpty = events.length === 0;
    const isSearch = !!searchQuery;
    el.innerHTML = `<div class="empty">
      <div class="empty-icon">${isEmpty ? '🎭' : isSearch ? '🔍' : CATS[filterCat]?.emoji || '📅'}</div>
      <h3>${isEmpty ? 'Tu diario está vacío' : isSearch ? 'Sin resultados' : 'Nada aquí todavía'}</h3>
      <p>${isEmpty
        ? 'Pulsa <strong>Añadir</strong> para registrar<br>tu primer evento cultural.'
        : isSearch
          ? `No hay eventos que coincidan con "<strong>${searchQuery}</strong>".`
          : 'Prueba con otro filtro o añade un nuevo evento.'
      }</p>
    </div>`;
    return;
  }

  el.innerHTML = list.map((ev, i) => {
    const cat   = CATS[ev.cat] || CATS['Otro'];
    const stars = ev.rating > 0 ? '★'.repeat(ev.rating) + '☆'.repeat(5 - ev.rating) : '';
    const loc   = [ev.venue, ev.city].filter(Boolean).join(' · ');
    const pos   = ev.image_position || '50% 50%';
    const q     = searchQuery;
    const imgHtml = ev.image_url
      ? `<div class="card-image-wrap"><img src="${ev.image_url}" alt="${ev.title}" loading="lazy" style="object-position:${pos}"/></div>`
      : '';
    return `<div class="event-card" style="--cat-color:${cat.color}; animation-delay:${Math.min(i*.05,.3)}s">
      ${imgHtml}
      <div class="card-body">
        <div class="card-top">
          <span class="cat-label">${cat.emoji} ${ev.cat}</span>
          <div class="card-actions">
            <button class="card-btn" onclick='openForm(${JSON.stringify(ev).replace(/'/g,"&#39;")})' title="Editar">✏️</button>
            <button class="card-btn" onclick="deleteEvent(${ev.id})" title="Eliminar">✕</button>
          </div>
        </div>
        <div class="card-title">${highlight(ev.title, q)}</div>
        ${loc ? `<div class="card-meta">📍 ${highlight(loc, q)}${ev.maps_url ? ` <a href="${ev.maps_url}" target="_blank" rel="noopener">🗺</a>` : ''}</div>` : ''}
        ${ev.date ? `<div class="card-meta">📅 ${fmtDate(ev.date)}</div>` : ''}
        ${stars ? `<div class="card-stars">${stars}</div>` : ''}
        ${ev.notes ? `<div class="card-notes">${highlight(ev.notes, q)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Google Places ──
function initAutocomplete() {
  const input = document.getElementById('f-venue');
  if (!input || !window.google?.maps?.places) return;
  const ac = new google.maps.places.Autocomplete(input, {
    fields: ['name', 'formatted_address', 'url', 'address_components']
  });
  ac.addListener('place_changed', () => {
    const place = ac.getPlace();
    if (!place.name) return;
    document.getElementById('f-venue').value    = place.name;
    document.getElementById('f-address').value  = place.formatted_address || '';
    document.getElementById('f-maps-url').value = place.url || '';
    const cityComp = (place.address_components || []).find(c =>
      c.types.includes('locality') || c.types.includes('administrative_area_level_2')
    );
    if (cityComp) document.getElementById('f-city').value = cityComp.long_name;
  });
}

// ── PWA ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ══════════════════════════════════════════════
// ARTISTAS & CONCIERTOS
// ══════════════════════════════════════════════

let artists  = JSON.parse(localStorage.getItem('dc_artists') || '[]');
let userCity = localStorage.getItem('dc_city') || '';

// ── Tab switching ──
function switchTab(tab) {
  const diarioEls = ['stats-bar', 'filters', 'view-toggle-bar', 'main-container'];
  const artistasSection = document.getElementById('artistas-section');
  const tabDiario   = document.getElementById('tab-diario');
  const tabArtistas = document.getElementById('tab-artistas');
  const headerSearch = document.getElementById('header-search');
  const addBtn = document.getElementById('add-btn');

  if (tab === 'artistas') {
    diarioEls.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    artistasSection.style.display = 'block';
    headerSearch.style.display = 'none';
    addBtn.style.display = 'none';
    tabDiario.classList.remove('active');
    tabArtistas.classList.add('active');
  } else {
    diarioEls.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.removeProperty('display');
    });
    artistasSection.style.display = 'none';
    headerSearch.style.removeProperty('display');
    addBtn.style.removeProperty('display');
    tabDiario.classList.add('active');
    tabArtistas.classList.remove('active');
  }
}

// ── Artists CRUD ──
function saveArtists() {
  localStorage.setItem('dc_artists', JSON.stringify(artists));
}

function addArtist() {
  const input = document.getElementById('a-artist-input');
  const name  = input.value.trim();
  if (!name) return;
  if (artists.some(a => a.toLowerCase() === name.toLowerCase())) {
    toast('Ese artista ya está en tu lista', true);
    return;
  }
  artists.push(name);
  saveArtists();
  input.value = '';
  renderArtistChips();
}

function removeArtist(name) {
  artists = artists.filter(a => a !== name);
  saveArtists();
  renderArtistChips();
}

function renderArtistChips() {
  const el = document.getElementById('artist-chips');
  if (!el) return;
  if (!artists.length) {
    el.innerHTML = '<span class="no-artists">Añade tus artistas para empezar…</span>';
    return;
  }
  el.innerHTML = artists.map(a =>
    `<span class="artist-chip">${escHtml(a)}<button onclick="removeArtist(${JSON.stringify(a)})" title="Eliminar">✕</button></span>`
  ).join('');
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Concerts search ──
function normalizeStr(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}

async function fetchConcerts() {
  const cityInput = document.getElementById('a-city-input');
  const city = cityInput.value.trim();

  if (!city) {
    toast('Indica tu ciudad primero', true);
    cityInput.focus();
    return;
  }
  if (!artists.length) {
    toast('Añade artistas primero', true);
    return;
  }

  // Persist city
  userCity = city;
  localStorage.setItem('dc_city', city);

  const btn = document.getElementById('concerts-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Buscando…';

  const resultsEl = document.getElementById('concerts-results');
  resultsEl.innerHTML = '';

  const normCity = normalizeStr(city);

  // Fetch all artists in parallel
  const fetches = artists.map(async artist => {
    try {
      const url = `https://rest.bandsintown.com/artists/${encodeURIComponent(artist)}/events?app_id=diario_cultural&date=upcoming`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      return data
        .filter(ev => {
          const evCity = normalizeStr(ev.venue?.city || '');
          // loose bilateral match: "madrid" matches "comunidad de madrid" etc.
          return evCity.includes(normCity) || normCity.includes(evCity);
        })
        .map(ev => ({ ...ev, _artistName: artist }));
    } catch {
      return [];
    }
  });

  const settled = await Promise.allSettled(fetches);

  // Flatten, deduplicate by event id, sort by date
  const seen = new Set();
  const allEvents = settled
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(ev => {
      if (seen.has(ev.id)) return false;
      seen.add(ev.id);
      return true;
    })
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

  btn.disabled = false;
  btn.textContent = '🔍 Buscar conciertos';

  renderConcerts(allEvents, city);
}

function renderConcerts(events, city) {
  const el = document.getElementById('concerts-results');

  if (!events.length) {
    el.innerHTML = `<div class="concerts-empty">
      <div style="font-size:42px;margin-bottom:.85rem">🎵</div>
      <h3>Sin conciertos próximos</h3>
      <p>No hemos encontrado eventos en <strong>${escHtml(city)}</strong><br>para los artistas que sigues.</p>
    </div>`;
    return;
  }

  const plural = events.length === 1 ? 'concierto encontrado' : 'conciertos encontrados';
  const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  const cards = events.map((ev, i) => {
    const dt     = new Date(ev.datetime);
    const day    = dt.getDate();
    const month  = MONTHS[dt.getMonth()];
    const year   = dt.getFullYear();
    const hh     = dt.getHours().toString().padStart(2, '0');
    const mm     = dt.getMinutes().toString().padStart(2, '0');
    const showTime = dt.getHours() !== 0 || dt.getMinutes() !== 0;
    const venue  = [ev.venue?.name, ev.venue?.city].filter(Boolean).join(' · ');

    // Serialize concert data for the prefill button
    const concertData = JSON.stringify({
      title:    ev._artistName,
      datetime: ev.datetime,
      venue:    ev.venue || {},
      url:      ev.url || '',
    });

    const extBtn = ev.url
      ? `<button class="concert-ext-btn" onclick="event.stopPropagation();window.open(${JSON.stringify(ev.url)},'_blank')" title="Ver entradas">🎟</button>`
      : '';

    return `<div class="concert-card" style="animation-delay:${Math.min(i * .04, .3)}s">
      <div class="concert-date">
        <div class="concert-day">${day}</div>
        <div class="concert-month">${month} ${year}</div>
      </div>
      <div class="concert-info">
        <div class="concert-artist">${escHtml(ev._artistName)}</div>
        ${venue  ? `<div class="concert-venue">📍 ${escHtml(venue)}</div>` : ''}
        ${showTime ? `<div class="concert-time">🕐 ${hh}:${mm}</div>` : ''}
      </div>
      <div class="concert-actions">
        <button class="concert-add-btn"
          onclick="event.stopPropagation();prefillFromConcert(${escHtml(concertData)})"
          title="Añadir al diario">＋ Diario</button>
        ${extBtn}
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="concerts-count">${events.length} ${plural} en ${escHtml(city)}</div>${cards}`;
}

// ── Pre-fill diary form from a concert ──
function prefillFromConcert(concertJson) {
  let concert;
  try { concert = typeof concertJson === 'string' ? JSON.parse(concertJson) : concertJson; }
  catch { return; }

  const date = concert.datetime ? concert.datetime.split('T')[0] : new Date().toISOString().split('T')[0];

  // Switch to diary tab first, then open the form
  switchTab('diario');
  setTimeout(() => {
    openForm(); // opens a blank new-event form
    // Override the fields we know from the concert
    document.getElementById('sheet-title').textContent = 'Nuevo evento';
    document.getElementById('f-title').value = concert.title  || '';
    document.getElementById('f-date').value  = date;
    document.getElementById('f-cat').value   = 'Concierto';
    document.getElementById('f-venue').value = concert.venue?.name || '';
    document.getElementById('f-city').value  = concert.venue?.city || '';
    // Focus notes so user can add their impression
    document.getElementById('f-notes').focus();
  }, 120);
}

// ── Init artistas section ──
function initArtistasSection() {
  const cityInput = document.getElementById('a-city-input');
  if (cityInput && userCity) cityInput.value = userCity;
  renderArtistChips();
}

// ── Init ──
db.auth.getSession().then(({ data: { session } }) => { if (session) hideLoginScreen(); });
loadEvents();
initArtistasSection();
