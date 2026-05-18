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

let events = [], filterCat = 'Todos', filterYear = 'Todos', filterCompanion = '', sortBy = 'recent';
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

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getCompanions(ev) {
  if (!ev.companions) return [];
  return ev.companions.split(',').map(c => c.trim()).filter(Boolean);
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

  const isEdit = !!(ev?.id);
  document.getElementById('sheet-title').textContent = isEdit ? 'Editar evento' : (ev ? 'Duplicar evento' : 'Nuevo evento');
  document.getElementById('save-btn').textContent    = isEdit ? 'Guardar cambios' : (ev ? 'Guardar copia' : 'Guardar evento');
  document.getElementById('f-title').value    = ev?.title   || '';
  document.getElementById('f-date').value     = ev?.date    || new Date().toISOString().split('T')[0];
  document.getElementById('f-cat').value      = ev?.cat     || 'Concierto';
  document.getElementById('f-venue').value    = ev?.venue   || '';
  document.getElementById('f-city').value     = ev?.city    || '';
  document.getElementById('f-address').value  = ev?.address || '';
  document.getElementById('f-maps-url').value = ev?.maps_url|| '';
  document.getElementById('f-notes').value    = ev?.notes   || '';
  document.getElementById('f-companions').value = ev?.companions || '';
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
    companions:     document.getElementById('f-companions').value.trim(),
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
function setFilter(c)           { filterCat = c; render(); }
function setYear(y)             { filterYear = y; render(); }
function setCompanionFilter(c)  { filterCompanion = filterCompanion === c ? '' : c; render(); }
function getYears()             { return [...new Set(events.map(e => e.date?.slice(0,4)).filter(Boolean))].sort((a,b) => b-a); }

function getTopCompanions(limit = 6) {
  const map = {};
  events.forEach(e => getCompanions(e).forEach(c => { map[c] = (map[c] || 0) + 1; }));
  return Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0, limit).map(([c]) => c);
}

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
  const companionPills = getTopCompanions().length
    ? '<div class="filter-divider"></div>' + getTopCompanions().map(c =>
        `<button class="pill${filterCompanion===c?' active':''}" onclick="setCompanionFilter('${c.replace(/'/g, "\\'")}')">👥 ${escHtml(c)}</button>`
      ).join('')
    : '';
  document.getElementById('filters').innerHTML = catPills + yearPills + companionPills + sortControl;
}

function renderGrid() {
  const el = document.getElementById('events-grid');
  el.classList.toggle('list-view', viewMode === 'list');
  document.getElementById('btn-grid')?.classList.toggle('active', viewMode === 'grid');
  document.getElementById('btn-list')?.classList.toggle('active', viewMode === 'list');
  let list = events;
  if (filterCat  !== 'Todos') list = list.filter(e => e.cat === filterCat);
  if (filterYear !== 'Todos') list = list.filter(e => e.date?.startsWith(filterYear));
  if (filterCompanion) {
    list = list.filter(e => getCompanions(e).includes(filterCompanion));
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(e =>
      e.title?.toLowerCase().includes(q) ||
      e.venue?.toLowerCase().includes(q) ||
      e.city?.toLowerCase().includes(q)  ||
      e.notes?.toLowerCase().includes(q) ||
      e.companions?.toLowerCase().includes(q)
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
            <button class="card-btn" onclick="duplicateEvent(${ev.id})" title="Duplicar">⊕</button>
            <button class="card-btn" onclick="shareEvent(${ev.id})" title="Compartir">↗</button>
            <button class="card-btn" onclick="deleteEvent(${ev.id})" title="Eliminar">✕</button>
          </div>
        </div>
        <div class="card-title">${highlight(ev.title, q)}</div>
        ${loc ? `<div class="card-meta">📍 ${highlight(loc, q)}${ev.maps_url ? ` <a href="${ev.maps_url}" target="_blank" rel="noopener">🗺</a>` : ''}</div>` : ''}
        ${ev.date ? `<div class="card-meta">📅 ${fmtDate(ev.date)}</div>` : ''}
        ${stars ? `<div class="card-stars">${stars}</div>` : ''}
        ${ev.companions ? `<div class="card-companions">${getCompanions(ev).map(c=>`<span class="companion-tag" onclick="event.stopPropagation();setCompanionFilter('${c.replace(/'/g, "\\'")}')">${escHtml(c)}</span>`).join('')}</div>` : ''}
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

// ── Duplicar ──
function duplicateEvent(id) {
  const ev = events.find(e => e.id === id);
  if (!ev) return;
  openForm({ ...ev, id: null });   // id:null → openForm lo trata como nuevo
}

// ── Compartir ──
async function shareEvent(id) {
  const ev = events.find(e => e.id === id);
  if (!ev) return;

  const btn = document.querySelector(`[onclick="shareEvent(${id})"]`);
  if (btn) { btn.textContent = '…'; btn.disabled = true; }

  try {
    const blob = await buildShareImage(ev);
    const filename = `${(ev.title || 'evento').slice(0, 40).replace(/[^\w\s-]/g,'')}.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: ev.title });
    } else {
      downloadBlob(blob, filename);
    }
  } catch(err) {
    if (err?.name !== 'AbortError') {
      // Fallback: try sharing just text
      const text = [ev.title, ev.date ? fmtDate(ev.date) : '', ev.venue, ev.city].filter(Boolean).join(' · ');
      if (navigator.share) {
        navigator.share({ title: ev.title, text }).catch(() => {});
      } else {
        navigator.clipboard?.writeText(text).then(() => toast('Texto copiado al portapapeles'));
      }
    }
  } finally {
    if (btn) { btn.textContent = '↗'; btn.disabled = false; }
  }
}

async function buildShareImage(ev) {
  const S = 1080, PAD = 88;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');

  // Fondo
  ctx.fillStyle = '#09080a';
  ctx.fillRect(0, 0, S, S);

  // Imagen de fondo si existe
  if (ev.image_url) {
    try {
      const img = await loadImg(ev.image_url);
      const scale = Math.max(S / img.width, S / img.height);
      const w = img.width * scale, h = img.height * scale;
      const [fx, fy] = (ev.image_position || '50% 50%').split(' ').map(p => parseFloat(p) / 100);
      ctx.drawImage(img, -(w - S) * fx, -(h - S) * fy, w, h);
      // Overlay degradado
      const grad = ctx.createLinearGradient(0, 0, 0, S);
      grad.addColorStop(0,   'rgba(9,8,10,.55)');
      grad.addColorStop(.45, 'rgba(9,8,10,.40)');
      grad.addColorStop(1,   'rgba(9,8,10,.90)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, S, S);
    } catch(_) { /* imagen no disponible */ }
  }

  // Barra de acento (izquierda)
  const CAT_COLORS = { Concierto:'#a87fd4', Cine:'#5e9fd8', Teatro:'#d4776a', Exposición:'#72b87c', Otro:'#c9943a' };
  const accent = CAT_COLORS[ev.cat] || '#c9943a';
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 7, S);

  // Categoría
  const cat = CATS[ev.cat] || CATS['Otro'];
  ctx.font = '500 32px system-ui, sans-serif';
  ctx.fillStyle = accent;
  ctx.fillText((cat.emoji + '  ' + (ev.cat || '')).toUpperCase(), PAD, 196);

  // Título (máx 3 líneas)
  ctx.fillStyle = '#eee8df';
  ctx.font = '300 74px Georgia, "Times New Roman", serif';
  const titleLines = canvasWrap(ctx, ev.title || '', S - PAD * 2, 3);
  titleLines.forEach((line, i) => ctx.fillText(line, PAD, 300 + i * 88));

  let y = 300 + titleLines.length * 88 + 48;

  // Fecha + lugar
  const meta = [ev.date ? fmtDate(ev.date) : '', [ev.venue, ev.city].filter(Boolean).join(', ')].filter(Boolean).join('   ·   ');
  if (meta) {
    ctx.font = '300 34px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(133,126,136,.9)';
    ctx.fillText(meta, PAD, y);
    y += 56;
  }

  // Valoración
  if (ev.rating > 0) {
    ctx.font = '44px serif';
    ctx.fillStyle = '#e4b96a';
    ctx.fillText('★'.repeat(ev.rating) + '☆'.repeat(5 - ev.rating), PAD, y + 8);
  }

  // Divider + branding
  ctx.strokeStyle = 'rgba(133,126,136,.18)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, S - 96); ctx.lineTo(S - PAD, S - 96); ctx.stroke();
  ctx.font = '300 28px Georgia, serif';
  ctx.fillStyle = 'rgba(133,126,136,.45)';
  ctx.fillText('Diario Cultural', PAD, S - 60);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function canvasWrap(ctx, text, maxW, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      if (lines.length >= maxLines) break;
      cur = w;
    } else { cur = test; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // Truncar última línea si no cabe
  const last = lines[lines.length - 1];
  if (last && ctx.measureText(last).width > maxW) {
    let t = last;
    while (ctx.measureText(t + '…').width > maxW && t.length > 0) t = t.slice(0, -1);
    lines[lines.length - 1] = t + '…';
  }
  return lines;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Imagen guardada');
}


// ── Año en imágenes ──
const PLURAL = { Concierto:'conciertos', Cine:'películas', Teatro:'obras de teatro', Exposición:'exposiciones', Otro:'eventos' };
const MEDALS = ['🥇','🥈','🥉'];
let wSlides = [], wIdx = 0;

function openWrapped(year) {
  const evts = events.filter(e => e.date?.startsWith(year));
  if (!evts.length) { toast(`Sin eventos en ${year}`, true); return; }
  wSlides = buildWrappedSlides(evts, year);
  wIdx = 0;
  document.getElementById('wrapped-overlay').classList.add('open');
  showSlide(0);
  setTimeout(() => {
    const h = document.getElementById('wrapped-hint');
    if (h) h.style.opacity = '0';
  }, 3000);
}

function closeWrapped() {
  document.getElementById('wrapped-overlay').classList.remove('open');
}

function onWrappedTap(e) {
  const mid = window.innerWidth / 2;
  e.clientX < mid ? prevSlide() : nextSlide();
}

function nextSlide() { if (wIdx < wSlides.length - 1) showSlide(wIdx + 1); else closeWrapped(); }
function prevSlide() { if (wIdx > 0) showSlide(wIdx - 1); }

function showSlide(idx) {
  wIdx = idx;
  const slide = wSlides[idx];
  document.getElementById('wrapped-progress').innerHTML =
    wSlides.map((_,i) => `<div class="wp-seg ${i<idx?'done':i===idx?'active':''}"></div>`).join('');
  const el = document.getElementById('wrapped-slide');
  el.style.background = slide.bg + ', #09080a';
  el.innerHTML = `<div class="ws-inner">${slide.html}</div>`;
}

function buildWrappedSlides(evts, year) {
  const slides = [];
  const MNAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const CAT_C  = { Concierto:'#a87fd4', Cine:'#5e9fd8', Teatro:'#d4776a', Exposición:'#72b87c', Otro:'#c9943a' };

  const rated    = evts.filter(e=>e.rating>0).sort((a,b)=>b.rating-a.rating);
  const avgRat   = rated.length ? (rated.reduce((s,e)=>s+e.rating,0)/rated.length).toFixed(1) : null;
  const months   = MNAMES.map((m,i) => ({ m, v: evts.filter(e=>e.date && +e.date.split('-')[1]-1===i).length }));
  const activeMo = months.filter(m=>m.v>0).length;
  const catCts   = Object.entries(CATS).map(([c,meta]) => ({ c, meta, v: evts.filter(e=>e.cat===c).length }))
                     .filter(d=>d.v>0).sort((a,b)=>b.v-a.v);
  const topCat   = catCts[0];
  const compMap  = {};
  evts.forEach(e => getCompanions(e).forEach(c => { compMap[c]=(compMap[c]||0)+1; }));
  const comps    = Object.entries(compMap).sort((a,b)=>b[1]-a[1]).slice(0,3);
  const withImg  = evts.filter(e=>e.image_url);

  // Slide 1 — Portada
  slides.push({ bg:'radial-gradient(ellipse at 30% 40%, rgba(201,148,58,.22) 0%, transparent 55%), radial-gradient(ellipse at 75% 65%, rgba(168,127,212,.14) 0%, transparent 55%)', html:`
    <div class="ws-eyebrow">tu año en cultura</div>
    <div class="ws-year-bg">${year}</div>
    <div class="ws-big">${evts.length}</div>
    <div class="ws-label">evento${evts.length!==1?'s':''} vivido${evts.length!==1?'s':''}</div>
    ${avgRat?`<div class="ws-sub">valoración media <span class="ws-accent">${avgRat} ★</span></div>`:''}
  `});

  // Slide 2 — Actividad mensual
  slides.push({ bg:'radial-gradient(ellipse at 50% 25%, rgba(94,159,216,.18) 0%, transparent 55%)', html:`
    <div class="ws-eyebrow">tu actividad</div>
    <div class="ws-big">${activeMo}</div>
    <div class="ws-label">mese${activeMo!==1?'s':''} con eventos</div>
    <div class="ws-months">
      ${months.map(m=>`
        <div class="ws-mitem ${m.v>0?'on':''}">
          <div class="ws-mdot">${m.v>0?m.v:''}</div>
          <div class="ws-mlbl">${m.m}</div>
        </div>`).join('')}
    </div>
  `});

  // Slide 3 — Categoría favorita
  if (topCat) {
    const col = CAT_C[topCat.c]||'#c9943a';
    slides.push({ bg:`radial-gradient(ellipse at 40% 40%, ${col}2e 0%, transparent 60%)`, html:`
      <div class="ws-eyebrow">tu pasión</div>
      <div class="ws-emoji">${topCat.meta.emoji}</div>
      <div class="ws-big" style="color:${col}">${topCat.v}</div>
      <div class="ws-label">${PLURAL[topCat.c]||topCat.c.toLowerCase()}</div>
      ${catCts.length>1?`<div class="ws-sub">seguido de ${catCts[1].meta.emoji} ${catCts[1].c} (${catCts[1].v})</div>`:''}
    `});
  }

  // Slide 4 — Lo mejor
  if (rated.length) {
    slides.push({ bg:'radial-gradient(ellipse at 50% 25%, rgba(228,185,106,.15) 0%, transparent 55%)', html:`
      <div class="ws-eyebrow">tus favoritos</div>
      <div class="ws-title-sm">Lo que más te gustó</div>
      <div class="ws-top-list">
        ${rated.slice(0,3).map((ev,i)=>`
          <div class="ws-top-item">
            <div class="ws-top-rank">${i+1}</div>
            <div>
              <div class="ws-top-name">${escHtml(ev.title)}</div>
              <div class="ws-top-meta">${'★'.repeat(ev.rating)}${'☆'.repeat(5-ev.rating)} ${ev.date?fmtDate(ev.date):''}</div>
            </div>
          </div>`).join('')}
      </div>
    `});
  }

  // Slide 5 — Compañeros
  if (comps.length) {
    slides.push({ bg:'radial-gradient(ellipse at 55% 35%, rgba(114,184,124,.15) 0%, transparent 55%)', html:`
      <div class="ws-eyebrow">tus compañeros</div>
      <div class="ws-big">${Object.keys(compMap).length}</div>
      <div class="ws-label">persona${Object.keys(compMap).length!==1?'s':''} contigo</div>
      <div class="ws-comp-list">
        ${comps.map(([name,v],i)=>`
          <div class="ws-comp-row">
            <span class="ws-comp-medal">${MEDALS[i]||'·'}</span>
            <span class="ws-comp-name">${escHtml(name)}</span>
            <span class="ws-comp-n">${v} vez${v!==1?'es':''}</span>
          </div>`).join('')}
      </div>
    `});
  }

  // Slide 6 — Galería
  if (withImg.length >= 4) {
    slides.push({ bg:'#000', html:`
      <div class="ws-eyebrow">tu galería</div>
      <div class="ws-title-sm">${withImg.length} momentos con imagen</div>
      <div class="ws-gallery">
        ${withImg.slice(0,9).map(ev=>
          `<div class="ws-gitem" style="background-image:url('${ev.image_url}');background-position:${ev.image_position||'50% 50%'}"></div>`
        ).join('')}
      </div>
    `});
  }

  // Slide 7 — Cierre
  const finalItems = [
    { n:evts.length, l:'eventos' },
    activeMo   ? { n:activeMo, l:'meses activo' } : null,
    avgRat     ? { n:avgRat,   l:'valoración media' } : null,
    Object.keys(compMap).length ? { n:Object.keys(compMap).length, l:'compañeros' } : null,
  ].filter(Boolean).slice(0,4);

  slides.push({ bg:'radial-gradient(ellipse at 50% 50%, rgba(201,148,58,.18) 0%, rgba(168,127,212,.1) 50%, transparent 70%)', html:`
    <div class="ws-eyebrow">${year} en números</div>
    <div class="ws-final-grid">
      ${finalItems.map(f=>`<div class="ws-fitem"><div class="ws-fn">${f.n}</div><div class="ws-fl">${f.l}</div></div>`).join('')}
    </div>
    <div class="ws-brand">Diario <em>Cultural</em></div>
    <div class="ws-cta">¿Y el próximo año?</div>
  `});

  return slides;
}

let _wTouchX = 0;
document.addEventListener('touchstart', e => {
  if (document.getElementById('wrapped-overlay').classList.contains('open'))
    _wTouchX = e.touches[0].clientX;
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!document.getElementById('wrapped-overlay').classList.contains('open')) return;
  const dx = e.changedTouches[0].clientX - _wTouchX;
  if (Math.abs(dx) > 45) dx < 0 ? nextSlide() : prevSlide();
}, { passive: true });
document.addEventListener('keydown', e => {
  if (!document.getElementById('wrapped-overlay').classList.contains('open')) return;
  if (e.key==='ArrowRight'||e.key===' ') nextSlide();
  if (e.key==='ArrowLeft') prevSlide();
  if (e.key==='Escape') closeWrapped();
});


let statsYear = 'Todos';

function openStats() {
  // Primero abrir el overlay, luego renderizar (así el panel siempre se muestra)
  document.getElementById('stats-overlay').classList.add('open');
  const sel = document.getElementById('stats-year-sel');
  const years = getYears();
  sel.innerHTML = '<option value="Todos">Todos los años</option>' +
    years.map(y => `<option value="${y}" ${y === statsYear ? 'selected' : ''}>${y}</option>`).join('');
  try {
    renderStatsPanel();
  } catch(err) {
    document.getElementById('stats-content').innerHTML =
      `<p style="padding:2rem;text-align:center;color:var(--text3)">Error al cargar estadísticas.<br><small>${err.message}</small></p>`;
    console.error('renderStatsPanel error:', err);
  }
}

function closeStats() {
  document.getElementById('stats-overlay').classList.remove('open');
}

function statsOverlayClick(e) {
  if (e.target === document.getElementById('stats-overlay')) closeStats();
}

function setStatsYear(y) {
  statsYear = y;
  renderStatsPanel();
}

function renderStatsPanel() {
  const content = document.getElementById('stats-content');
  const evts = statsYear === 'Todos' ? events : events.filter(e => e.date?.startsWith(statsYear));

  if (!evts.length) {
    content.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--text3)">
      <div style="font-size:36px;margin-bottom:.75rem">📊</div>
      <p>No hay eventos${statsYear !== 'Todos' ? ' en ' + statsYear : ''}.<br>Añade eventos para ver estadísticas.</p>
    </div>`;
    return;
  }

  // ── Cálculos ──
  const rated    = evts.filter(e => e.rating > 0);
  const avgRat   = rated.length ? (rated.reduce((s,e) => s+e.rating, 0) / rated.length).toFixed(1) : '—';
  const compSet  = new Set(evts.flatMap(e => getCompanions(e)));

  // Actividad mensual
  const MONTHS_S = ['E','F','M','A','M','J','J','A','S','O','N','D'];
  const monthly  = MONTHS_S.map((m, i) => ({ m, v: evts.filter(e => e.date && parseInt(e.date.split('-')[1])-1 === i).length }));
  const maxMonth = Math.max(...monthly.map(d => d.v), 1);

  // Categorías
  const cats = Object.entries(CATS).map(([c, meta]) => ({
    label: meta.emoji + ' ' + c, color: meta.color, v: evts.filter(e => e.cat === c).length
  })).filter(d => d.v > 0).sort((a,b) => b.v - a.v);
  const maxCat = cats[0]?.v || 1;

  // Valoraciones
  const ratings  = [5,4,3,2,1].map(r => ({ r, v: evts.filter(e => e.rating === r).length }));
  const maxRat   = Math.max(...ratings.map(d => d.v), 1);

  // Compañeros
  const compMap  = {};
  evts.forEach(e => getCompanions(e).forEach(c => { compMap[c] = (compMap[c] || 0) + 1; }));
  const comps    = Object.entries(compMap).sort((a,b) => b[1]-a[1]).slice(0,8).map(([n,v]) => ({n,v}));
  const maxComp  = comps[0]?.v || 1;

  content.innerHTML = `
    <!-- Resumen -->
    <div class="stats-summary">
      <div class="stats-summary-item">
        <div class="stats-summary-n">${evts.length}</div>
        <div class="stats-summary-l">Eventos</div>
      </div>
      <div class="stats-summary-item">
        <div class="stats-summary-n">${avgRat}</div>
        <div class="stats-summary-l">Valoración media</div>
      </div>
      <div class="stats-summary-item">
        <div class="stats-summary-n">${compSet.size || '—'}</div>
        <div class="stats-summary-l">Compañeros</div>
      </div>
    </div>

    <!-- Actividad mensual -->
    <div class="stats-section">
      <div class="stats-section-title">Actividad mensual</div>
      <div class="chart-wrap">${svgBarChart(monthly, maxMonth)}</div>
    </div>

    <!-- Categorías -->
    ${cats.length > 1 ? `
    <div class="stats-section">
      <div class="stats-section-title">Por categoría</div>
      <div class="stat-rows">
        ${cats.map(d => `<div class="stat-row">
          <div class="stat-row-label">${d.label}</div>
          <div class="stat-row-track"><div class="stat-row-fill" style="width:${(d.v/maxCat*100).toFixed(1)}%;background:${d.color};opacity:.8"></div></div>
          <div class="stat-row-n">${d.v}</div>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- Valoraciones -->
    ${rated.length ? `
    <div class="stats-section">
      <div class="stats-section-title">Distribución de valoraciones</div>
      <div class="stat-rows">
        ${ratings.map(d => `<div class="stat-row">
          <div class="stat-row-label" style="color:var(--amber);letter-spacing:1px">${'★'.repeat(d.r)}${'☆'.repeat(5-d.r)}</div>
          <div class="stat-row-track"><div class="stat-row-fill" style="width:${(d.v/maxRat*100).toFixed(1)}%;background:var(--amber);opacity:.75"></div></div>
          <div class="stat-row-n">${d.v}</div>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- Compañeros -->
    ${comps.length ? `
    <div class="stats-section">
      <div class="stats-section-title">Tus compañeros</div>
      <div class="stat-rows">
        ${comps.map(c => `<div class="stat-row">
          <div class="stat-row-label">${escHtml(c.n)}</div>
          <div class="stat-row-track"><div class="stat-row-fill" style="width:${(c.v/maxComp*100).toFixed(1)}%;background:var(--c-concert);opacity:.75"></div></div>
          <div class="stat-row-n">${c.v}</div>
        </div>`).join('')}
      </div>
    </div>` : ''}
  `;
  // Botón "Año en imágenes"
  const targetYear = statsYear !== 'Todos' ? statsYear : getYears()[0];
  if (targetYear) {
    content.innerHTML += `<button class="btn-wrapped" onclick="closeStats();openWrapped('${targetYear}')">🎞 Ver ${targetYear} en imágenes</button>`;
  }
}

function svgBarChart(months, maxVal) {
  const slotW = 28, barW = 18, topPad = 14, maxBarH = 60, lblH = 16;
  const W = 12 * slotW, H = topPad + maxBarH + lblH;

  const bars = months.map((m, i) => {
    const x  = i * slotW + 5;
    const bh = m.v > 0 ? Math.max(Math.round((m.v / maxVal) * maxBarH), 4) : 0;
    const by = topPad + maxBarH - bh;
    return [
      `<rect x="${x}" y="${m.v > 0 ? by : topPad+maxBarH-2}" width="${barW}" height="${m.v > 0 ? bh : 2}" fill="var(--amber)" rx="3" opacity="${m.v > 0 ? '.75' : '.07'}"/>`,
      m.v > 0 ? `<text x="${x+barW/2}" y="${by-4}" text-anchor="middle" font-size="8" fill="var(--amber-lt)" font-family="system-ui">${m.v}</text>` : '',
      `<text x="${x+barW/2}" y="${H-2}" text-anchor="middle" font-size="8" fill="var(--text3)" font-family="system-ui">${m.m}</text>`,
    ].join('');
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">${bars}</svg>`;
}

// ── Init ──
db.auth.getSession().then(({ data: { session } }) => { if (session) hideLoginScreen(); });
loadEvents();
