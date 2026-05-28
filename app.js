const SUPABASE_URL = 'https://uuonayxdlmdkrznghivz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1b25heXhkbG1ka3J6bmdoaXZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDUwMzAsImV4cCI6MjA5NDMyMTAzMH0.p9xhXP0_EcL6gqKOESmjfcPA3qYzdE9iIQTXnSAUeqI';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const BUILTIN_CATS = {
  'Concierto':  { emoji: '🎵', color: 'var(--c-concert)', builtin: true },
  'Cine':       { emoji: '🎬', color: 'var(--c-cinema)',  builtin: true },
  'Teatro':     { emoji: '🎭', color: 'var(--c-teatro)',  builtin: true },
  'Exposición': { emoji: '🖼️', color: 'var(--c-expo)',    builtin: true },
  'Otro':       { emoji: '✨', color: 'var(--c-otro)',    builtin: true },
};
let CATS = { ...BUILTIN_CATS };

// Hex colours for canvas rendering (CSS vars don't work on canvas)
const BUILTIN_HEX = { Concierto:'#a87fd4', Cine:'#5e9fd8', Teatro:'#d4776a', Exposición:'#72b87c', Otro:'#c9943a' };
function catHexColor(name) { return BUILTIN_HEX[name] || CATS[name]?.color || '#c9943a'; }

// ── Custom categories ───────────────────────────────────────────────────────
const CUSTOM_COLORS = ['#e8a87c','#7ce8c4','#e87ca8','#7cb4e8','#c4e87c',
                       '#e8c47c','#7cdce8','#d47ce8','#e8d47c','#7ce8a8',
                       '#f0a0b8','#a0c8f0','#b8f0a0','#f0d0a0','#c0a0f0'];

function getCustomCats() {
  try { return JSON.parse(localStorage.getItem('dc-custom-cats') || '[]'); } catch(_) { return []; }
}

// Persist to Supabase so all devices stay in sync
async function saveCustomCatsToDB(list) {
  // Get current session (uses local cache — no network call)
  const { data: { session } } = await db.auth.getSession();
  if (!session?.user) return;

  const { error } = await db
    .from('user_settings')
    .upsert(
      { user_id: session.user.id, custom_cats: list, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('saveCustomCatsToDB:', error);
    toast('Error al sincronizar categorías (' + error.message + ')', true);
  }
}

// Load from Supabase, fall back to localStorage cache
async function loadCustomCatsFromDB() {
  // maybeSingle() returns null (no error) when row doesn't exist yet
  const { data, error } = await db
    .from('user_settings')
    .select('custom_cats')
    .maybeSingle();

  if (error) {
    console.error('loadCustomCatsFromDB:', error);
  }

  if (!error && Array.isArray(data?.custom_cats)) {
    localStorage.setItem('dc-custom-cats', JSON.stringify(data.custom_cats));
  }
  // Always call loadCats() so CATS reflects current state
  loadCats();
}

function saveCustomCats(list) {
  localStorage.setItem('dc-custom-cats', JSON.stringify(list)); // instant local cache
  loadCats();
  saveCustomCatsToDB(list);                                      // async sync to DB
}
function loadCats() {
  CATS = { ...BUILTIN_CATS };
  getCustomCats().forEach(c => { CATS[c.name] = { emoji: c.emoji, color: c.color }; });
}
function addCustomCat(name, emoji) {
  if (!name.trim() || CATS[name]) return false;
  const list  = getCustomCats();
  const color = CUSTOM_COLORS[list.length % CUSTOM_COLORS.length];
  list.push({ name: name.trim(), emoji: emoji || '⭐', color });
  saveCustomCats(list);
  return true;
}
function deleteCustomCat(name) {
  saveCustomCats(getCustomCats().filter(c => c.name !== name));
}
function rebuildCatSelect(keepVal) {
  const sel = document.getElementById('f-cat');
  if (!sel) return;
  const val = keepVal ?? sel.value;
  sel.innerHTML = Object.entries(CATS)
    .map(([n, c]) => `<option value="${n}"${n === val ? ' selected' : ''}>${c.emoji} ${n}</option>`)
    .join('');
}

let events = [], filterCat = 'Todos', filterYear = 'Todos', filterCompanion = [], sortBy = 'newest', filterUpcoming = false, hideUpcoming = false;
let searchQuery = '', formRating = 0, hoverRating = 0, saving = false, editingId = null;
let viewMode = localStorage.getItem('viewMode') || 'grid';
let pendingImageFile = null, existingImageUrl = null, removeExistingImage = false;
let focusX = 50, focusY = 50, tempFocusX = 50, tempFocusY = 50;

// Offline & calendar state
let isOnline = navigator.onLine;
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();

// ── Utils ──
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d - today) / 86400000);
}

function countdownLabel(days) {
  if (days < 0)    return null;
  if (days === 0)  return { text: '¡Hoy! 🎉',               cls: 'today' };
  if (days === 1)  return { text: 'Mañana',                  cls: 'tomorrow' };
  if (days <= 7)   return { text: `En ${days} días`,         cls: 'soon' };
  if (days <= 30)  return { text: `En ${days} días`,         cls: '' };
  if (days <= 90)  return { text: `En ${Math.ceil(days/7)} semanas`, cls: '' };
  const months = Math.round(days / 30.5);
  return { text: `En ${months} ${months === 1 ? 'mes' : 'meses'}`, cls: '' };
}


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


// ── IndexedDB / Offline ────────────────────────────────────────────────────────
const IDB_NAME = 'diario-cultural';
const IDB_VER  = 2;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('events'))
        d.createObjectStore('events', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('queue'))
        d.createObjectStore('queue', { autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function idbSaveAll(evts) {
  try {
    const d = await idbOpen();
    const tx = d.transaction('events', 'readwrite');
    const st = tx.objectStore('events');
    await new Promise((res,rej) => { const r = st.clear(); r.onsuccess = res; r.onerror = rej; });
    evts.forEach(ev => st.put(ev));
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch(_) {}
}

async function idbUpsert(ev) {
  try {
    const d = await idbOpen();
    const tx = d.transaction('events', 'readwrite');
    tx.objectStore('events').put(ev);
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch(_) {}
}

async function idbRemove(id) {
  try {
    const d = await idbOpen();
    const tx = d.transaction('events', 'readwrite');
    tx.objectStore('events').delete(id);
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch(_) {}
}

async function idbLoadAll() {
  try {
    const d = await idbOpen();
    return new Promise((resolve, reject) => {
      const req = d.transaction('events', 'readonly').objectStore('events').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  } catch(_) { return []; }
}

async function idbQueueOp(op) {
  try {
    const d = await idbOpen();
    const tx = d.transaction('queue', 'readwrite');
    tx.objectStore('queue').add(op);
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch(_) {}
}

async function idbGetQueue() {
  try {
    const d = await idbOpen();
    return new Promise((resolve, reject) => {
      const req = d.transaction('queue', 'readonly').objectStore('queue').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  } catch(_) { return []; }
}

async function idbClearQueue() {
  try {
    const d = await idbOpen();
    const tx = d.transaction('queue', 'readwrite');
    tx.objectStore('queue').clear();
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch(_) {}
}

function updateOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  if (!isOnline) {
    banner.classList.add('visible');
  } else {
    banner.classList.remove('visible');
  }
}

async function processSyncQueue() {
  if (!isOnline) return;
  const queue = await idbGetQueue();
  if (!queue.length) return;
  let synced = 0;
  const failed = [];
  for (const op of queue) {
    try {
      if (op.type === 'insert') {
        const { data, error } = await db.from('events').insert([op.payload]).select().single();
        if (!error && data) {
          events = events.map(e => e.id === op.tempId ? data : e);
          await idbRemove(op.tempId);
          await idbUpsert(data);
          synced++;
        } else { failed.push(op); }
      } else if (op.type === 'update') {
        const { data, error } = await db.from('events').update(op.payload).eq('id', op.id).select().single();
        if (!error && data) {
          events = events.map(e => e.id === op.id ? data : e);
          await idbUpsert(data);
          synced++;
        } else { failed.push(op); }
      } else if (op.type === 'delete') {
        const { error } = await db.from('events').delete().eq('id', op.id);
        if (!error) {
          if (op.imageUrl) deleteImageFromUrl(op.imageUrl).catch(() => {});
          synced++;
        } else { failed.push(op); }
      }
    } catch(_) { failed.push(op); }
  }
  await idbClearQueue();
  // Re-queue failed ops
  for (const op of failed) await idbQueueOp(op);
  if (synced > 0) {
    render();
    toast(`✓ ${synced} cambio${synced > 1 ? 's' : ''} sincronizado${synced > 1 ? 's' : ''}`);
  }
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
  // 1. Render instantly from IDB cache (avoids blank screen)
  let renderedFromCache = false;
  try {
    const cached = await idbLoadAll();
    if (cached.length) {
      events = cached.sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));
      render();
      renderedFromCache = true;
    }
  } catch(_) {}

  if (!navigator.onLine) {
    isOnline = false;
    updateOfflineBanner();
    if (!events.length) toast('Sin conexión. No hay datos guardados localmente.', true);
    return;
  }

  // 2. Fetch fresh data from Supabase
  const { data, error } = await db.from('events').select('*').order('created_at', { ascending: false });
  if (error) { toast('Error al conectar. Mostrando datos guardados.', true); return; }

  const fresh = data || [];

  // 3. Load custom categories from DB (syncs across devices)
  await loadCustomCatsFromDB();

  // 4. Collect any unknown cats from events (from other devices) and add them to CATS
  fresh.forEach(ev => {
    if (ev.cat && !CATS[ev.cat]) {
      // Unknown cat: recover it with a neutral style
      CATS[ev.cat] = { emoji: '✦', color: CUSTOM_COLORS[Object.keys(CATS).length % CUSTOM_COLORS.length] };
    }
  });

  // 5. Only re-render if data actually changed (avoids the visible double-load)
  const changed =
    !renderedFromCache ||
    fresh.length !== events.length ||
    fresh.some((ev, i) => ev.id !== events[i]?.id || ev.updated_at !== events[i]?.updated_at);

  events = fresh;
  await idbSaveAll(events);
  if (changed) render();
  checkAndNotify();
}

// ── Half-star helpers ──
function starsHtml(rating) {
  if (!rating) return '';
  let out = '';
  for (let i = 1; i <= 5; i++) {
    if (rating >= i)
      out += '<span class="s-star s-full">★</span>';
    else if (rating >= i - 0.5)
      out += '<span class="s-star s-half"><span class="s-b">★</span><span class="s-f">★</span></span>';
    else
      out += '<span class="s-star s-empty">★</span>';
  }
  return out;
}

function starsCanvasText(rating) {
  // Returns a plain string for canvas rendering (uses ½ for half steps)
  let s = '';
  for (let i = 1; i <= 5; i++) {
    if (rating >= i)      s += '★';
    else if (rating >= i - 0.5) s += '⯨';
    else s += '☆';
  }
  return s;
}

// ── View toggle ──
function setView(mode) {
  viewMode = mode;
  localStorage.setItem('viewMode', mode);
  document.getElementById('btn-grid').classList.toggle('active', mode === 'grid');
  document.getElementById('btn-list').classList.toggle('active', mode === 'list');
  document.getElementById('btn-cal')?.classList.toggle('active', mode === 'calendar');
  const grid = document.getElementById('events-grid');
  grid.classList.toggle('list-view', mode === 'list');
  grid.classList.toggle('cal-mode', mode === 'calendar');
  if (mode === 'calendar') renderCalendar();
  else renderGrid();
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
  rebuildCatSelect(ev?.cat || 'Concierto');
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
  const ratingInp = document.getElementById('f-rating');
  if (ratingInp) ratingInp.value = formRating;
  // Force fresh star buttons on each form open to guarantee clean event listeners
  const starCont = document.getElementById('star-input');
  if (starCont) starCont.innerHTML = '';
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

// Builds star buttons once; subsequent calls only update classes (no innerHTML on click)
function initStarInput() {
  const container = document.getElementById('star-input');
  if (!container) return;

  container.innerHTML = [1,2,3,4,5].map(i =>
    `<span class="sip" data-star="${i}">` +
    `<button type="button" class="sip-l" data-val="${i - 0.5}" title="${i - 0.5} ★"><span>★</span></button>` +
    `<button type="button" class="sip-r" data-val="${i}"       title="${i} ★"><span>★</span></button>` +
    `</span>`
  ).join('');

  // Per-init flag: if touchend fired, skip the synthetic click that follows on mobile/tablet
  let touchFired = false;

  container.querySelectorAll('button[data-val]').forEach(btn => {
    const val = parseFloat(btn.dataset.val);

    btn.addEventListener('touchend', e => {
      e.preventDefault();          // block synthetic click
      touchFired = true;
      setTimeout(() => { touchFired = false; }, 600);
      setStarRating(formRating === val ? 0 : val);
    }, { passive: false });

    btn.addEventListener('click', () => {
      if (touchFired) return;      // already handled by touchend
      setStarRating(formRating === val ? 0 : val);
    });
  });

  // Hover on .sip wrapper → no flicker when cursor moves between left and right halves
  container.querySelectorAll('.sip').forEach(sip => {
    const starIdx = parseInt(sip.dataset.star);
    sip.addEventListener('mouseenter', () => { hoverRating = starIdx; updateStarClasses(); });
    sip.addEventListener('mouseleave', () => { hoverRating = 0;       updateStarClasses(); });
  });
}

function setStarRating(val) {
  formRating  = val;
  hoverRating = 0;
  const inp = document.getElementById('f-rating');
  if (inp) inp.value = val;
  updateStarClasses();
}

function updateStarClasses() {
  const display = hoverRating || formRating;
  document.querySelectorAll('#star-input button[data-val]').forEach(btn => {
    btn.classList.toggle('on', display >= parseFloat(btn.dataset.val));
  });
}

// Called from openForm and anywhere that needs to reset the display
function renderStars() {
  const container = document.getElementById('star-input');
  if (!container) return;
  // Re-init if buttons were wiped (e.g. first open)
  if (!container.querySelector('button[data-val]')) initStarInput();
  updateStarClasses();
}

function setRating(n) { setStarRating(n); }  // kept for compatibility

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
    rating:         (() => { const r = parseFloat(document.getElementById('f-rating')?.value ?? formRating); return r > 0 ? r : null; })(),
    image_url:      imageUrl,
    image_position: imagePosition,
  };

  if (editingId) {
    const { data, error } = await db.from('events').update(payload).eq('id', editingId).select().single();
    saving = false; btn.disabled = false; btn.textContent = 'Guardar cambios';
    if (error) { toast('Error al actualizar', true); return; }
    events = events.map(e => e.id === editingId ? data : e);
    await idbUpsert(data);
    if (formRating === 5) launchConfetti();
    toast('✓ Evento actualizado');
  } else {
    const { data, error } = await db.from('events').insert([payload]).select().single();
    saving = false; btn.disabled = false; btn.textContent = 'Guardar evento';
    if (error) { toast('Error al guardar', true); return; }
    events.unshift(data);
    await idbUpsert(data);
    if (formRating === 5) launchConfetti();
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
  await idbRemove(id);
  render();
  toast('Evento eliminado');
}

// ── Filters ──
function setFilter(c)           { filterCat = c; filterUpcoming = false; render(); if (document.getElementById("filter-panel-overlay")?.classList.contains("open")) renderFilterPanel(); }
function toggleUpcoming()       { filterUpcoming = !filterUpcoming; if (filterUpcoming) { hideUpcoming = false; filterCat = 'Todos'; filterYear = 'Todos'; filterCompanion = []; } render(); if (document.getElementById("filter-panel-overlay")?.classList.contains("open")) renderFilterPanel(); }
function toggleHideUpcoming()   { hideUpcoming = !hideUpcoming; if (hideUpcoming) filterUpcoming = false; render(); if (document.getElementById("filter-panel-overlay")?.classList.contains("open")) renderFilterPanel(); }
function setYear(y)             { filterYear = y; render(); if (document.getElementById("filter-panel-overlay")?.classList.contains("open")) renderFilterPanel(); }
function setCompanionFilter(c)  { const idx = filterCompanion.indexOf(c); if (idx === -1) filterCompanion.push(c); else filterCompanion.splice(idx, 1); render(); if (document.getElementById("filter-panel-overlay")?.classList.contains("open")) renderFilterPanel(); }
function getYears()             { return [...new Set(events.map(e => e.date?.slice(0,4)).filter(Boolean))].sort((a,b) => b-a); }

function getTopCompanions(limit = 6) {
  const map = {};
  events.forEach(e => getCompanions(e).forEach(c => { map[c] = (map[c] || 0) + 1; }));
  return Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0, limit).map(([c]) => c);
}

// ── Render ──
function render() { renderStats(); renderFilters(); renderGrid(); renderTodayWidget(); }

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
  // Count active filters for badge
  const activeFilters = [
    filterCat !== 'Todos',
    filterYear !== 'Todos',
    filterCompanion.length > 0,
    filterUpcoming,
    hideUpcoming,
  ].filter(Boolean);

  // Active chips shown in the bar (each removable with ✕)
  const chips = [];
  if (filterUpcoming)
    chips.push(`<button class="fbar-chip chip-upcoming" onclick="toggleUpcoming()">🗓 Próximos <span class="chip-x">✕</span></button>`);
  if (hideUpcoming)
    chips.push(`<button class="fbar-chip chip-hide" onclick="toggleHideUpcoming()">🙈 Sin futuros <span class="chip-x">✕</span></button>`);
  if (filterCat !== 'Todos')
    chips.push(`<button class="fbar-chip" onclick="setFilter('Todos')">${CATS[filterCat]?.emoji||''} ${escHtml(filterCat)} <span class="chip-x">✕</span></button>`);
  if (filterYear !== 'Todos')
    chips.push(`<button class="fbar-chip" onclick="setYear('Todos')">📅 ${filterYear} <span class="chip-x">✕</span></button>`);
  filterCompanion.forEach(c =>
    chips.push(`<button class="fbar-chip chip-companion" onclick="setCompanionFilter('${c.replace(/'/g,"\'")}')">👥 ${escHtml(c)} <span class="chip-x">✕</span></button>`)
  );

  const badge = activeFilters.length ? `<span class="fbar-badge">${activeFilters.length}</span>` : '';

  document.getElementById('filters').innerHTML = `
    <div class="fbar-chips">${chips.join('')}</div>
    <button class="btn-open-filters${activeFilters.length ? ' fbar-active' : ''}" onclick="openFilterPanel()">
      <span>⊟</span> Filtros${badge}
    </button>
    <div class="fbar-sep"></div>
    <select class="sort-select" onchange="onSort(event)">
      <option value="recent"  ${sortBy==='recent' ?'selected':''}>↓ Añadidos</option>
      <option value="newest"  ${sortBy==='newest' ?'selected':''}>↓ Fecha</option>
      <option value="oldest"  ${sortBy==='oldest' ?'selected':''}>↑ Fecha</option>
      <option value="rating"  ${sortBy==='rating' ?'selected':''}>★ Valoración</option>
      <option value="title"   ${sortBy==='title'  ?'selected':''}>A→Z Título</option>
    </select>`;
}

// ── Filter panel ──────────────────────────────────────────────────────────────
function openFilterPanel() {
  renderFilterPanel();
  document.getElementById('filter-panel-overlay').classList.add('open');
}
function closeFilterPanel() {
  document.getElementById('filter-panel-overlay').classList.remove('open');
}

function renderFilterPanel() {
  const years = getYears();
  const upcomingCount = events.filter(e => e.date && daysUntil(e.date) >= 0).length;
  const companions = getTopCompanions(16);
  const activeCount = [filterCat !== 'Todos', filterYear !== 'Todos',
    filterCompanion.length > 0, filterUpcoming, hideUpcoming].filter(Boolean).length;

  const fp = (label, content) => `
    <div class="fp-section">
      <div class="fp-section-lbl">${label}</div>
      <div class="fp-pills">${content}</div>
    </div>`;

  const pill = (label, active, onclick, extraCls='') =>
    `<button class="fp-pill${active ? ' active' : ''}${extraCls ? ' ' + extraCls : ''}" onclick="${onclick};renderFilterPanel()">${label}</button>`;

  const upcoming = upcomingCount > 0 ? fp('Próximos', [
    pill(`🗓 Solo próximos <span class="fp-count">${upcomingCount}</span>`, filterUpcoming, "toggleUpcoming()", 'fp-upcoming'),
    pill('🙈 Ocultar futuros', hideUpcoming, "toggleHideUpcoming()", 'fp-hide'),
  ].join('')) : '';

  const cats = fp('Categoría',
    ['Todos', ...Object.keys(CATS)].map(c =>
      pill(c === 'Todos' ? 'Todas' : `${CATS[c].emoji} ${c}`, filterCat === c, `setFilter('${c}')`)
    ).join('')
  );

  const yrs = years.length ? fp('Año',
    [pill('Todos los años', filterYear === 'Todos', "setYear('Todos')"),
     ...years.map(y => pill(y, filterYear === y, `setYear('${y}')`))]
    .join('')
  ) : '';

  const comps = companions.length ? fp('Compañeros',
    companions.map(c =>
      pill(`👥 ${escHtml(c)}`, filterCompanion.includes(c), `setCompanionFilter('${c.replace(/'/g,"\'")}')`, 'fp-companion')
    ).join('')
  ) : '';

  const sorts = fp('Ordenar por', [
    { v:'newest', l:'↓ Fecha (reciente)' },
    { v:'oldest', l:'↑ Fecha (antiguo)'  },
    { v:'recent', l:'↓ Añadidos'         },
    { v:'rating', l:'★ Valoración'       },
    { v:'title',  l:'A → Z Título'       },
  ].map(s => pill(s.l, sortBy === s.v, `sortBy='${s.v}';onSort({target:{value:'${s.v}'}})`)).join(''));

  document.getElementById('fp-body').innerHTML = upcoming + cats + yrs + comps + sorts;
  document.getElementById('fp-reset').style.display = activeCount > 0 ? 'flex' : 'none';
}

function resetAllFilters() {
  filterCat = 'Todos'; filterYear = 'Todos';
  filterCompanion = []; filterUpcoming = false; hideUpcoming = false;
  render(); renderFilterPanel();
}

function renderGrid() {
  if (viewMode === 'calendar') { renderCalendar(); return; }
  const el = document.getElementById('events-grid');
  el.classList.toggle('list-view', viewMode === 'list');
  el.classList.remove('cal-mode');
  document.getElementById('btn-grid')?.classList.toggle('active', viewMode === 'grid');
  document.getElementById('btn-list')?.classList.toggle('active', viewMode === 'list');
  document.getElementById('btn-cal')?.classList.toggle('active', false);
  let list = events;
  if (filterUpcoming) {
    list = list.filter(e => e.date && daysUntil(e.date) >= 0 && daysUntil(e.date) <= 365);
    list = list.sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);
  } else {
    if (hideUpcoming) list = list.filter(e => !e.date || daysUntil(e.date) < 0);
    if (filterCat  !== 'Todos') list = list.filter(e => e.cat === filterCat);
    if (filterYear !== 'Todos') list = list.filter(e => e.date?.startsWith(filterYear));
    if (filterCompanion.length) {
      list = list.filter(e => filterCompanion.some(c => getCompanions(e).includes(c)));
    }
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
    const isUpcoming = filterUpcoming;
    el.innerHTML = `<div class="empty">
      <div class="empty-icon">${isEmpty ? '🎭' : isSearch ? '🔍' : isUpcoming ? '🗓' : CATS[filterCat]?.emoji || '📅'}</div>
      <h3>${isEmpty ? 'Tu diario está vacío' : isSearch ? 'Sin resultados' : isUpcoming ? 'Sin eventos futuros' : 'Nada aquí todavía'}</h3>
      <p>${isEmpty
        ? 'Pulsa <strong>Añadir</strong> para registrar<br>tu primer evento cultural.'
        : isSearch
          ? `No hay eventos que coincidan con "<strong>${searchQuery}</strong>".`
          : isUpcoming
            ? 'Añade eventos con fecha futura para verlos aquí.'
            : 'Prueba con otro filtro o añade un nuevo evento.'
      }</p>
    </div>`;
    return;
  }

  el.innerHTML = list.map((ev, i) => {
    const cat   = CATS[ev.cat] || CATS['Otro'];
    const stars = starsHtml(ev.rating);
    const loc   = [ev.venue, ev.city].filter(Boolean).join(' · ');
    const pos   = ev.image_position || '50% 50%';
    const q     = searchQuery;
    const days = daysUntil(ev.date);
    const countdown = countdownLabel(days);
    const countdownHtml = countdown
      ? `<div class="card-countdown ${countdown.cls}">${countdown.text}</div>`
      : '';
    const imgHtml = ev.image_url
      ? `<div class="card-image-wrap">${countdownHtml}<img src="${ev.image_url}" alt="${escHtml(ev.title)}" loading="lazy" style="object-position:${pos}"/></div>`
      : `<div class="card-image-wrap card-img-placeholder" style="--cat-color:${cat.color}">${countdownHtml}<span class="card-img-emoji">${cat.emoji}</span></div>`;
    return `<div class="event-card" style="--cat-color:${cat.color}; animation-delay:${Math.min(i*.05,.3)}s" onclick="openDetail(${ev.id})">
      ${imgHtml}
      <div class="card-body">
        <div class="card-top">
          <span class="cat-label">${cat.emoji}</span>
          <div class="card-actions">
            <button class="card-btn" onclick='event.stopPropagation();openForm(${JSON.stringify(ev).replace(/'/g,"&#39;")})' title="Editar"><span class="btn-icon">✏️</span><span class="btn-lbl">Editar</span></button>
            <button class="card-btn" onclick="event.stopPropagation();duplicateEvent(${ev.id})" title="Duplicar"><span class="btn-icon">📋</span><span class="btn-lbl">Copiar</span></button>
            <button class="card-btn" onclick="event.stopPropagation();shareEvent(${ev.id})" title="Compartir"><span class="btn-icon">📤</span><span class="btn-lbl">Enviar</span></button>
            <button class="card-btn btn-del" onclick="event.stopPropagation();deleteEvent(${ev.id})" title="Eliminar"><span class="btn-icon">✕</span><span class="btn-lbl">Borrar</span></button>
          </div>
        </div>
        <div class="card-title">${highlight(ev.title, q)}</div>
        ${loc ? `<div class="card-meta">${ev.maps_url ? `<a href="${ev.maps_url}" target="_blank" rel="noopener" class="card-pin-link" onclick="event.stopPropagation()">📍</a>` : '📍'} ${highlight(loc, q)}</div>` : ''}
        ${ev.date ? `<div class="card-meta">📅 ${fmtDate(ev.date)}</div>` : ''}
        ${stars ? `<div class="card-stars stars-row">${stars}</div>` : ''}
        ${ev.companions ? `<div class="card-companions">${getCompanions(ev).map(c=>`<span class="companion-tag${filterCompanion.includes(c)?' companion-active':''}" onclick="event.stopPropagation();setCompanionFilter('${c.replace(/'/g, "\\'")}')">${escHtml(c)}</span>`).join('')}</div>` : ''}
        ${ev.notes ? `<div class="card-notes">${highlight(ev.notes, q)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}



// ── Calendar View ──────────────────────────────────────────────────────────────
const CAL_MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const CAL_DAYS   = ['L','M','X','J','V','S','D'];

function prevMonth() {
  if (calMonth === 0) { calMonth = 11; calYear--; } else calMonth--;
  renderCalendar();
}
function nextMonth() {
  if (calMonth === 11) { calMonth = 0; calYear++; } else calMonth++;
  renderCalendar();
}
function goToday() {
  calYear = new Date().getFullYear();
  calMonth = new Date().getMonth();
  renderCalendar();
}

function renderCalendar() {
  const el = document.getElementById('events-grid');
  el.classList.remove('list-view');
  el.classList.add('cal-mode');
  document.getElementById('btn-grid')?.classList.toggle('active', false);
  document.getElementById('btn-list')?.classList.toggle('active', false);
  document.getElementById('btn-cal')?.classList.toggle('active', true);

  let list = events;
  if (filterCat !== 'Todos') list = list.filter(e => e.cat === filterCat);
  if (filterCompanion.length) list = list.filter(e => filterCompanion.some(c => getCompanions(e).includes(c)));
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(e =>
      e.title?.toLowerCase().includes(q) ||
      e.venue?.toLowerCase().includes(q) ||
      e.notes?.toLowerCase().includes(q)
    );
  }
  el.innerHTML = buildCalHTML(list);
}

function buildCalHTML(list) {
  const firstDow  = new Date(calYear, calMonth, 1).getDay();
  const offset    = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMo  = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth, 0).getDate();
  const today     = new Date(); today.setHours(0,0,0,0);
  const totalCells = Math.ceil((offset + daysInMo) / 7) * 7;

  // Build date → events map
  const evtMap = {};
  list.forEach(ev => {
    if (!ev.date) return;
    if (!evtMap[ev.date]) evtMap[ev.date] = [];
    evtMap[ev.date].push(ev);
  });

  // Month-level stats
  const yStr = String(calYear); const mStr = String(calMonth + 1).padStart(2, '0');
  const monthEvts = list.filter(e => e.date?.startsWith(`${yStr}-${mStr}`));
  const monthRated = monthEvts.filter(e => e.rating > 0);
  const monthAvg = monthRated.length ? (monthRated.reduce((s,e) => s+e.rating,0)/monthRated.length).toFixed(1) : null;
  const monthCats = [...new Set(monthEvts.map(e => e.cat))].map(c => CATS[c]?.emoji).filter(Boolean).join(' ');

  let cells = '';
  for (let i = 0; i < totalCells; i++) {
    let day, dateStr;
    if (i < offset) {
      day = daysInPrev - offset + i + 1;
      const pm = calMonth === 0 ? 12 : calMonth;
      const py = calMonth === 0 ? calYear - 1 : calYear;
      dateStr = `${py}-${String(pm).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    } else if (i < offset + daysInMo) {
      day = i - offset + 1;
      dateStr = `${yStr}-${mStr}-${String(day).padStart(2,'0')}`;
    } else {
      day = i - offset - daysInMo + 1;
      const nm = calMonth === 11 ? 1 : calMonth + 2;
      const ny = calMonth === 11 ? calYear + 1 : calYear;
      dateStr = `${ny}-${String(nm).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }

    const inMonth  = i >= offset && i < offset + daysInMo;
    const cellDate = new Date(dateStr + 'T00:00:00');
    const isToday  = inMonth && cellDate.getTime() === today.getTime();
    const isPast   = inMonth && cellDate < today;
    const isFuture = inMonth && cellDate > today;
    const dayEvts  = evtMap[dateStr] || [];

    const dots = dayEvts.slice(0, 6).map(ev => {
      const cat = CATS[ev.cat] || CATS['Otro'];
      return `<span class="cal-dot" style="--dc:${cat.color}"></span>`;
    }).join('') + (dayEvts.length > 6 ? `<span class="cal-dot-more">+${dayEvts.length-6}</span>` : '');

    const preview = dayEvts.slice(0, 3).map(ev =>
      `<div class="cal-ev-pill" style="--cc:${CATS[ev.cat]?.color||'var(--amber)'}"><span class="cal-ev-emoji">${CATS[ev.cat]?.emoji||''}</span><span class="cal-ev-name">${escHtml(ev.title)}</span></div>`
    ).join('') + (dayEvts.length > 3 ? `<div class="cal-ev-more">+${dayEvts.length-3} más</div>` : '');

    const hasFutureEvt = dayEvts.some(e => daysUntil(e.date) >= 0);
    const cls = [
      'cal-cell',
      !inMonth ? 'cal-other' : '',
      isToday  ? 'cal-today' : '',
      isPast && inMonth && !isToday ? 'cal-past' : '',
      isFuture ? 'cal-future' : '',
      dayEvts.length ? 'cal-has-events' : '',
      hasFutureEvt && inMonth ? 'cal-upcoming-day' : '',
    ].filter(Boolean).join(' ');

    cells += `<div class="${cls}" ${dayEvts.length ? `onclick="openDayDetail('${dateStr}')" role="button" tabindex="0"` : ''}>
      <div class="cal-day-num">${day}${isToday ? '<span class="cal-today-ring"></span>' : ''}</div>
      ${dayEvts.length ? `<div class="cal-dots">${dots}</div><div class="cal-preview">${preview}</div>` : ''}
    </div>`;
  }

  const statBadge = monthEvts.length ? `<div class="cal-stat-badge">
    <span class="csb-n">${monthEvts.length}</span><span class="csb-l">evento${monthEvts.length > 1 ? 's' : ''}</span>
    ${monthAvg ? `<span class="csb-sep">·</span><span class="csb-n">★ ${monthAvg}</span>` : ''}
    ${monthCats ? `<span class="csb-sep">·</span><span class="csb-cats">${monthCats}</span>` : ''}
  </div>` : '<div class="cal-stat-badge csb-empty">Sin eventos este mes</div>';

  return `<div class="cal-wrap">
    <div class="cal-header">
      <button class="cal-nav" onclick="prevMonth()" aria-label="Mes anterior">‹</button>
      <div class="cal-title-group">
        <div class="cal-title">
          <span class="cal-month-name">${CAL_MONTHS[calMonth]}</span>
          <span class="cal-year-lbl">${calYear}</span>
        </div>
        ${statBadge}
      </div>
      <button class="cal-nav" onclick="nextMonth()" aria-label="Mes siguiente">›</button>
      <button class="cal-today-btn" onclick="goToday()">Hoy</button>
    </div>
    <div class="cal-dow">${CAL_DAYS.map(d=>`<div class="cal-dow-cell">${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
  </div>`;
}

function openDayDetail(dateStr) {
  const dayEvts = events.filter(e => e.date === dateStr);
  if (!dayEvts.length) return;
  const [y,m,d] = dateStr.split('-');
  const ML = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const label = `${parseInt(d)} de ${ML[parseInt(m)-1]} de ${y}`;
  const items = dayEvts.map(ev => `
    <div class="cal-day-ev" onclick="closeDayDetail();setTimeout(()=>openDetail(${ev.id}),80)">
      <span class="cal-day-ev-emoji">${CATS[ev.cat]?.emoji||'✨'}</span>
      <div class="cal-day-ev-body">
        <div class="cal-day-ev-title">${escHtml(ev.title)}</div>
        ${ev.venue||ev.city ? `<div class="cal-day-ev-meta">${escHtml([ev.venue,ev.city].filter(Boolean).join(' · '))}</div>` : ''}
      </div>
      ${ev.rating ? `<span class="cal-day-ev-stars">${starsHtml(ev.rating)}</span>` : ''}
    </div>`).join('');
  document.getElementById('cal-day-panel').innerHTML = `
    <div class="cal-day-hd">
      <div class="cal-day-title">📅 ${label}</div>
      <button class="cal-day-close" onclick="closeDayDetail()">✕</button>
    </div>
    <div class="cal-day-events">${items}</div>`;
  document.getElementById('cal-day-overlay').classList.add('open');
}

function closeDayDetail() {
  document.getElementById('cal-day-overlay').classList.remove('open');
}


// ── "Hoy en tu diario" widget ──────────────────────────────────────────────────

function getTodayPastEvents() {
  const now = new Date();
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  const dd  = String(now.getDate()).padStart(2, '0');
  const currentYear = now.getFullYear();
  return events
    .filter(e => {
      if (!e.date) return false;
      const parts = e.date.split('-');
      return parts[1] === mm && parts[2] === dd && parseInt(parts[0]) < currentYear;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function renderTodayWidget() {
  const el = document.getElementById('today-widget');
  if (!el) return;

  // Respect dismiss (stored per calendar day so it reappears next day)
  const today = new Date().toISOString().slice(0, 10);
  if (sessionStorage.getItem('tw-dismissed') === today) { el.style.display = 'none'; return; }

  const past = getTodayPastEvents();
  if (!past.length) { el.style.display = 'none'; return; }

  const now   = new Date();
  const dayFmt = now.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

  const cards = past.map(ev => {
    const cat      = CATS[ev.cat] || CATS['Otro'];
    const yearsAgo = now.getFullYear() - parseInt(ev.date);
    const stars    = ev.rating ? starsHtml(ev.rating) : '';
    const loc      = [ev.venue, ev.city].filter(Boolean).join(' · ');
    const imgStyle = ev.image_url
      ? `background-image:url('${ev.image_url}');background-position:${ev.image_position||'50% 50%'};background-size:cover;`
      : `background:linear-gradient(135deg,${cat.color}33 0%,transparent 80%);`;

    return `<div class="tw-card" onclick="openDetail(${ev.id})" style="--cc:${cat.color}">
      <div class="tw-card-img" style="${imgStyle}">
        ${!ev.image_url ? `<span class="tw-card-emoji">${cat.emoji}</span>` : ''}
        <div class="tw-card-year">${ev.date.slice(0,4)}</div>
      </div>
      <div class="tw-card-body">
        <div class="tw-card-ago">${yearsAgo === 1 ? 'Hace 1 año' : `Hace ${yearsAgo} años`}</div>
        <div class="tw-card-title">${escHtml(ev.title)}</div>
        ${loc  ? `<div class="tw-card-loc">📍 ${escHtml(loc)}</div>` : ''}
        ${stars ? `<div class="tw-card-stars stars-row">${stars}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  el.style.display = 'block';
  el.innerHTML = `
    <div class="tw-header">
      <div class="tw-header-left">
        <span class="tw-icon">✨</span>
        <div>
          <div class="tw-eyebrow">tal día como hoy · ${dayFmt}</div>
          <div class="tw-title">En tu diario</div>
        </div>
      </div>
      <button class="tw-close" onclick="dismissTodayWidget()" title="Cerrar">✕</button>
    </div>
    <div class="tw-scroll">${cards}</div>`;
}

function dismissTodayWidget() {
  const today = new Date().toISOString().slice(0, 10);
  sessionStorage.setItem('tw-dismissed', today);
  const el = document.getElementById('today-widget');
  if (el) {
    el.style.animation = 'twCollapse .3s ease forwards';
    setTimeout(() => { el.style.display = 'none'; el.style.animation = ''; }, 300);
  }
}


// ── Web Push / Notificaciones locales ──────────────────────────────────────────

const NOTIF_ENABLED_KEY = 'dc-notif-v1';
const NOTIF_LOG_KEY     = 'dc-notif-log-v1';
const NOTIF_DAYS_KEY    = 'dc-notif-days-v1'; // JSON array e.g. [0,1,3,7]

const DEFAULT_DAYS = [0, 1, 3]; // today, tomorrow, 3 days before

function notifEnabled() {
  return localStorage.getItem(NOTIF_ENABLED_KEY) === '1'
      && 'Notification' in window
      && Notification.permission === 'granted';
}

function getNotifDays() {
  try { return JSON.parse(localStorage.getItem(NOTIF_DAYS_KEY)) || DEFAULT_DAYS; }
  catch(_) { return DEFAULT_DAYS; }
}

function getNotifLog() {
  try { return JSON.parse(localStorage.getItem(NOTIF_LOG_KEY) || '{}'); }
  catch(_) { return {}; }
}

function saveNotifLog(log) {
  // Keep only entries from the last 30 days
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  Object.keys(log).forEach(k => { if (log[k] < cutoff) delete log[k]; });
  localStorage.setItem(NOTIF_LOG_KEY, JSON.stringify(log));
}

// ── Main toggle ──
async function toggleNotifications() {
  if (!('Notification' in window)) {
    toast('Tu navegador no soporta notificaciones', true);
    return;
  }
  if (notifEnabled()) {
    openNotifPanel();
    return;
  }
  // Request permission first
  const perm = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();

  if (perm !== 'granted') {
    toast('Permiso denegado — actívalo en la configuración del navegador', true);
    return;
  }
  localStorage.setItem(NOTIF_ENABLED_KEY, '1');
  updateNotifBtn();
  openNotifPanel();
  // Try periodic background sync (Chrome Android)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      if ('periodicSync' in reg) {
        reg.periodicSync.register('dc-event-reminders', { minInterval: 12 * 3600 * 1000 })
          .catch(() => {});
      }
    });
  }
}

function disableNotifications() {
  localStorage.removeItem(NOTIF_ENABLED_KEY);
  localStorage.removeItem(NOTIF_LOG_KEY);
  updateNotifBtn();
  closeNotifPanel();
  toast('Recordatorios desactivados');
}

// ── Button state ──
function updateNotifBtn() {
  const btn = document.getElementById('notif-btn');
  if (!btn) return;
  const on = notifEnabled();
  btn.innerHTML   = on ? '🔔' : '🔕';
  btn.title       = on ? 'Gestionar recordatorios' : 'Activar recordatorios';
  btn.classList.toggle('notif-active', on);
}

// ── Settings panel ──
function openNotifPanel() {
  updateNotifBtn();
  renderNotifPanel();
  document.getElementById('notif-panel-overlay').classList.add('open');
}

function closeNotifPanel() {
  document.getElementById('notif-panel-overlay').classList.remove('open');
}

function renderNotifPanel() {
  const on   = notifEnabled();
  const days = getNotifDays();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';

  const upcoming = events
    .filter(e => e.date && daysUntil(e.date) !== null && daysUntil(e.date) >= 0 && daysUntil(e.date) <= 365)
    .sort((a, b) => a.date.localeCompare(b.date));

  const permBadge = {
    granted:     '<span class="np-badge np-granted">● Concedido</span>',
    denied:      '<span class="np-badge np-denied">● Denegado</span>',
    default:     '<span class="np-badge np-default">● Sin configurar</span>',
    unsupported: '<span class="np-badge np-denied">● No soportado</span>',
  }[perm] || '';

  const dayOptions = [
    { v: 0, l: 'El mismo día del evento' },
    { v: 1, l: '1 día antes' },
    { v: 3, l: '3 días antes' },
    { v: 7, l: '7 días antes' },
  ];

  const upcomingHtml = upcoming.length ? `
    <div class="np-section">
      <div class="np-section-title">Próximos eventos (${upcoming.length})</div>
      <div class="np-ev-list">
        ${upcoming.slice(0, 6).map(ev => {
          const d = daysUntil(ev.date);
          const cd = countdownLabel(d);
          return `<div class="np-ev-row">
            <span>${CATS[ev.cat]?.emoji || '✨'}</span>
            <div class="np-ev-info">
              <div class="np-ev-title">${escHtml(ev.title)}</div>
              <div class="np-ev-date">${fmtDate(ev.date)}</div>
            </div>
            ${cd ? `<span class="np-ev-cd ${cd.cls}">${cd.text}</span>` : ''}
          </div>`;
        }).join('')}
        ${upcoming.length > 6 ? `<div class="np-ev-more">+ ${upcoming.length - 6} más</div>` : ''}
      </div>
    </div>` : '<p class="np-empty">No tienes eventos futuros en los próximos 30 días.</p>';

  document.getElementById('notif-panel-body').innerHTML = `
    <!-- Status -->
    <div class="np-status">
      <div class="np-status-row">
        <span class="np-status-label">Permiso del navegador</span>
        ${permBadge}
      </div>
      <div class="np-status-row">
        <span class="np-status-label">Recordatorios</span>
        <span class="np-badge ${on ? 'np-granted' : 'np-default'}">${on ? '● Activados' : '● Desactivados'}</span>
      </div>
    </div>

    ${perm === 'denied' ? `
    <div class="np-warn">
      ⚠️ Has denegado los permisos. Debes activarlos manualmente en la configuración de tu navegador (🔒 junto a la URL).
    </div>` : ''}

    <!-- When to notify -->
    ${on && perm === 'granted' ? `
    <div class="np-section">
      <div class="np-section-title">Cuándo notificar</div>
      <div class="np-checks">
        ${dayOptions.map(opt => `
          <label class="np-check">
            <input type="checkbox" value="${opt.v}"
              ${days.includes(opt.v) ? 'checked' : ''}
              onchange="toggleNotifDay(${opt.v}, this.checked)"/>
            <span class="np-check-box"></span>
            <span>${opt.l}</span>
          </label>`).join('')}
      </div>
    </div>

    <!-- Test button -->
    <div class="np-section">
      <div class="np-section-title">Prueba</div>
      <button class="np-test-btn" onclick="sendTestNotification()">
        🔔 Enviar notificación de prueba
      </button>
    </div>

    ${upcomingHtml}

    <!-- Disable -->
    <button class="np-disable-btn" onclick="disableNotifications()">
      🔕 Desactivar recordatorios
    </button>
    ` : !on && perm !== 'denied' ? `
    <p class="np-desc">
      Recibe alertas en tu dispositivo antes de tus eventos culturales, incluso con la app en segundo plano.
      No se envía nada a ningún servidor — todo funciona localmente en tu navegador.
    </p>
    <button class="np-enable-btn" onclick="enableNotifications()">
      🔔 Activar recordatorios
    </button>
    ${upcomingHtml}
    ` : ''}`;
}

async function enableNotifications() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast('Permiso denegado', true);
    renderNotifPanel();
    return;
  }
  localStorage.setItem(NOTIF_ENABLED_KEY, '1');
  updateNotifBtn();
  renderNotifPanel();
  checkAndNotify();
  toast('✓ Recordatorios activados');
}

function toggleNotifDay(day, checked) {
  const days = getNotifDays();
  const idx  = days.indexOf(day);
  if (checked && idx === -1)  days.push(day);
  if (!checked && idx !== -1) days.splice(idx, 1);
  localStorage.setItem(NOTIF_DAYS_KEY, JSON.stringify(days));
}

function sendTestNotification() {
  fireNotification(
    '🎭 Diario Cultural — Prueba',
    'Las notificaciones funcionan correctamente. ¡Hasta pronto!',
    'test'
  );
  toast('Notificación enviada');
}

// ── Core notification logic ──
function checkAndNotify() {
  if (!notifEnabled()) return;
  const notifDays = getNotifDays();
  const log       = getNotifLog();
  const todayStr  = new Date().toISOString().slice(0, 10);

  events.forEach(ev => {
    if (!ev.date) return;
    const d = daysUntil(ev.date);
    if (d === null || d < 0 || d > 30) return;
    if (!notifDays.includes(d > 7 ? null : d)) {
      // Check if d matches any configured threshold
      const threshold = notifDays.find(t => t === d);
      if (threshold === undefined) return;
    }
    // Check exact match to configured thresholds
    if (!notifDays.includes(d)) return;

    const logKey = `${ev.id}-d${d}`;
    if (log[logKey] === todayStr) return; // already fired today

    const { title, body } = buildNotifTexts(ev, d);
    fireNotification(title, body, `ev-${ev.id}-d${d}`);
    log[logKey] = todayStr;
  });

  saveNotifLog(log);
}

function buildNotifTexts(ev, daysAway) {
  const emoji = CATS[ev.cat]?.emoji || '🎭';
  const loc   = [ev.venue, ev.city].filter(Boolean).join(', ');
  let title, body;
  if (daysAway === 0) {
    title = `¡Hoy! ${emoji} ${ev.title}`;
    body  = loc || 'Que lo disfrutes 🎉';
  } else if (daysAway === 1) {
    title = `Mañana: ${emoji} ${ev.title}`;
    body  = loc ? `📍 ${loc}` : 'Recuerda que tienes un evento mañana';
  } else {
    title = `En ${daysAway} días: ${emoji} ${ev.title}`;
    body  = `${fmtDate(ev.date)}${loc ? ' · ' + loc : ''}`;
  }
  return { title, body };
}

function fireNotification(title, body, tag) {
  if (!notifEnabled()) return;
  const opts = {
    body,
    tag,
    icon:     'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="%2309080a" rx="80"/><text y="330" x="256" text-anchor="middle" font-size="280">🎭</text></svg>'),
    badge:    'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="%2309080a" rx="18"/><text y="70" x="48" text-anchor="middle" font-size="62">🎭</text></svg>'),
    vibrate:  [200, 100, 200],
    renotify: false,
  };
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, opts))
      .catch(() => new Notification(title, opts));
  } else {
    try { new Notification(title, opts); } catch(_) {}
  }
}

// Listen for messages from SW (periodic background sync)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'CHECK_NOTIFICATIONS') checkAndNotify();
  });
}


// ── Confetti ★★★★★ ──────────────────────────────────────────────────────────

function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');

  // Resize to viewport
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';

  // Palette inspired by the app's category colours + amber
  const COLORS = ['#e4b96a','#c9943a','#a87fd4','#5e9fd8','#d4776a','#72b87c','#fff'];
  const SHAPES = ['rect', 'circle', 'strip'];

  // Burst from two points near the top
  const bursts = [
    { x: canvas.width * .25, vy: -18 },
    { x: canvas.width * .75, vy: -18 },
  ];

  const particles = [];
  bursts.forEach(b => {
    for (let i = 0; i < 90; i++) {
      const angle = (Math.random() * Math.PI) - Math.PI;   // full circle
      const speed = 6 + Math.random() * 14;
      particles.push({
        x:    b.x + (Math.random() - .5) * 60,
        y:    canvas.height * .12,
        vx:   Math.cos(angle) * speed,
        vy:   Math.sin(angle) * speed + b.vy,
        w:    5 + Math.random() * 9,
        h:    3 + Math.random() * 5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
        rot:   Math.random() * Math.PI * 2,
        rotV:  (Math.random() - .5) * .25,
        gravity: .55 + Math.random() * .2,
        drag:    .985,
        opacity: 1,
        fadeStart: 120,   // frame at which to start fading
        frame: 0,
      });
    }
  });

  let frame = 0;
  const MAX_FRAMES = 180;   // ~3 s at 60 fps

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;

    particles.forEach(p => {
      p.frame++;
      p.vx *= p.drag;
      p.vy  = p.vy * p.drag + p.gravity;
      p.x  += p.vx;
      p.y  += p.vy;
      p.rot += p.rotV;
      if (p.frame > p.fadeStart) p.opacity -= .022;
      if (p.opacity <= 0) return;

      alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;

      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'strip') {
        ctx.fillRect(-p.w / 2, -p.h / 4, p.w, p.h / 2);
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    });

    frame++;
    if (alive && frame < MAX_FRAMES + 60) {
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  }

  requestAnimationFrame(draw);
}


// ── Category manager ────────────────────────────────────────────────────────

function openCatManager() {
  loadCats();
  renderCatManager();
  document.getElementById('cat-manager-overlay').classList.add('open');
}
function closeCatManager() {
  document.getElementById('cat-manager-overlay').classList.remove('open');
  rebuildCatSelect();
  render();
}

function renderCatManager() {
  const custom = getCustomCats();

  const builtinRows = Object.entries(BUILTIN_CATS).map(([name, cat]) => `
    <div class="cm-row">
      <span class="cm-emoji">${cat.emoji}</span>
      <span class="cm-name">${name}</span>
      <span class="cm-badge">Predefinida</span>
    </div>`).join('');

  const customRows = custom.length
    ? custom.map(c => `
    <div class="cm-row">
      <span class="cm-emoji">${escHtml(c.emoji)}</span>
      <span class="cm-name">${escHtml(c.name)}</span>
      <span class="cm-swatch" style="background:${c.color}"></span>
      <button class="cm-del" onclick="confirmDeleteCat('${c.name.replace(/'/g,"\'")}')">✕</button>
    </div>`).join('')
    : '<p class="cm-empty">Aún no tienes categorías personalizadas.</p>';

  document.getElementById('cat-manager-body').innerHTML = `
    <div class="cm-section">
      <div class="cm-section-lbl">Predefinidas</div>
      ${builtinRows}
    </div>
    <div class="cm-section">
      <div class="cm-section-lbl">Personalizadas</div>
      ${customRows}
    </div>
    <div class="cm-section">
      <div class="cm-section-lbl">Añadir categoría</div>
      <div class="cm-add-row">
        <input type="text" id="cm-emoji" placeholder="🎪" class="cm-emoji-inp" autocomplete="off"/>
        <input type="text" id="cm-name"  placeholder="Nombre…" class="cm-name-inp" autocomplete="off"
               onkeydown="if(event.key==='Enter')submitNewCat()"/>
        <button type="button" class="cm-add-btn" onclick="submitNewCat()">Añadir</button>
      </div>
    </div>`;

  // Focus the name input
  setTimeout(() => document.getElementById('cm-name')?.focus(), 200);
}

function submitNewCat() {
  const name  = document.getElementById('cm-name')?.value.trim();
  const emoji = document.getElementById('cm-emoji')?.value.trim() || '⭐';
  if (!name) { document.getElementById('cm-name')?.focus(); return; }
  if (CATS[name]) { toast(`La categoría "${name}" ya existe`, true); return; }
  if (addCustomCat(name, emoji)) {
    toast(`✓ Categoría "${name}" añadida`);
    renderCatManager();    // update manager list
    rebuildCatSelect();    // update form select immediately
    render();              // update filter bar + panel
  }
}

function confirmDeleteCat(name) {
  if (!confirm(`¿Eliminar la categoría "${name}"?
Los eventos existentes con esta categoría no se verán afectados.`)) return;
  if (filterCat === name) filterCat = 'Todos';
  deleteCustomCat(name);
  renderCatManager();
  rebuildCatSelect();
  render();
  toast(`Categoría "${name}" eliminada`);
}

// ── Detail view ──
function openDetail(id) {
  const ev = events.find(e => e.id === id);
  if (!ev) return;
  const cat = CATS[ev.cat] || CATS['Otro'];
  const loc = [ev.venue, ev.city].filter(Boolean).join(' · ');
  document.getElementById('detail-panel').innerHTML = `
    <div class="detail-img-wrap">
      ${ev.image_url
        ? `<img src="${ev.image_url}" alt="${escHtml(ev.title)}" class="detail-img" style="object-position:${ev.image_position||'50% 50%'}"/>`
        : `<div class="detail-img-placeholder" style="--cat-color:${cat.color}">${cat.emoji}</div>`
      }
      <button class="detail-close" onclick="closeDetail()">✕</button>
      <div class="detail-cat-badge" style="--cat-color:${cat.color}">${cat.emoji} ${ev.cat}</div>
    </div>
    <div class="detail-body">
      <h2 class="detail-title">${escHtml(ev.title)}</h2>
      <div class="detail-meta-list">
        ${ev.date    ? `<div class="detail-meta"><span class="dm-icon">📅</span>${fmtDate(ev.date)}</div>` : ''}
        ${loc        ? `<div class="detail-meta"><span class="dm-icon">📍</span>${escHtml(loc)}${ev.maps_url ? ` <a href="${ev.maps_url}" target="_blank" rel="noopener" class="detail-map-link">Ver en mapa →</a>` : ''}</div>` : ''}
        ${ev.companions ? `<div class="detail-meta"><span class="dm-icon">👥</span>${getCompanions(ev).map(c=>`<span class="companion-tag">${escHtml(c)}</span>`).join('')}</div>` : ''}
      </div>
      ${ev.rating    ? `<div class="detail-stars stars-row">${starsHtml(ev.rating)}</div>` : ''}
      ${ev.notes     ? `<div class="detail-notes">${escHtml(ev.notes).replace(/\n/g,'<br>')}</div>` : ''}
      <div class="detail-actions">
        <button class="detail-action-btn" onclick="closeDetail();setTimeout(()=>openForm(events.find(e=>e.id===${ev.id})),120)">✏️ Editar</button>
        <button class="detail-action-btn" onclick="closeDetail();setTimeout(()=>duplicateEvent(${ev.id}),120)">📋 Copiar</button>
        <button class="detail-action-btn" onclick="shareEvent(${ev.id})">📤 Enviar</button>
        <button class="detail-action-btn btn-del" onclick="closeDetail();setTimeout(()=>deleteEvent(${ev.id}),120)">✕ Borrar</button>
      </div>
    </div>`;
  document.getElementById('detail-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function detailOverlayClick(e) {
  if (e.target === document.getElementById('detail-overlay')) closeDetail();
}


// ── Venue Map ──────────────────────────────────────────────────────────────
let venueMap = null, venueMarkers = [], openInfoWindow = null;

// Geocode cache — persisted in localStorage so we don't repeat requests
const GEO_CACHE_KEY = 'dc_geocache_v2';   // v2: now uses Nominatim
let geoCache = {};
try { geoCache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); } catch(_) {}
function saveGeoCache() { try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geoCache)); } catch(_) {} }
function clearGeoCache() { geoCache = {}; localStorage.removeItem(GEO_CACHE_KEY); toast('Caché de mapa borrada — reabriendo…'); setTimeout(refreshVenueMarkers, 400); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DARK_MAP_STYLES = [
  { elementType: 'geometry',                       stylers: [{ color: '#0d0c10' }] },
  { elementType: 'labels.text.stroke',             stylers: [{ color: '#0d0c10' }] },
  { elementType: 'labels.text.fill',               stylers: [{ color: '#4d4850' }] },
  { featureType: 'road',  elementType: 'geometry',        stylers: [{ color: '#1c1a1f' }] },
  { featureType: 'road',  elementType: 'geometry.stroke',  stylers: [{ color: '#100f12' }] },
  { featureType: 'road',  elementType: 'labels.text.fill', stylers: [{ color: '#857e88' }] },
  { featureType: 'water', elementType: 'geometry',        stylers: [{ color: '#060508' }] },
  { featureType: 'poi',   elementType: 'geometry',        stylers: [{ color: '#161419' }] },
  { featureType: 'poi',   elementType: 'labels.text.fill',stylers: [{ color: '#4d4850' }] },
  { featureType: 'poi.park',    elementType: 'geometry',  stylers: [{ color: '#0e0c11' }] },
  { featureType: 'transit',     elementType: 'geometry',  stylers: [{ color: '#1c1a1f' }] },
  { featureType: 'administrative', elementType: 'geometry',        stylers: [{ color: '#161419' }] },
  { featureType: 'administrative', elementType: 'labels.text.fill',stylers: [{ color: '#857e88' }] },
];

function openMap() {
  document.getElementById('map-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  if (!venueMap) setTimeout(initVenueMap, 120);
  else refreshVenueMarkers();
}

function closeMap() {
  document.getElementById('map-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

// Try to extract coords from Google Maps URL (works for URLs with /@lat,lng format)
function coordsFromMapsUrl(url) {
  if (!url) return null;
  const m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
}

// ── Geocoding: tries Google Maps first, falls back to Nominatim (OSM) ──

function tryGoogleGeocode(query) {
  return new Promise(resolve => {
    if (!window.google?.maps?.Geocoder) { resolve(null); return; }
    new google.maps.Geocoder().geocode({ address: query }, (results, status) => {
      resolve(status === 'OK' && results[0]
        ? { lat: results[0].geometry.location.lat(), lng: results[0].geometry.location.lng() }
        : null);
    });
  });
}

async function tryNominatimGeocode(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=es`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch(_) {}
  return null;
}

async function geocodeVenue(venue, city, address) {
  const key = `${venue || ''}||${city || ''}`;
  if (geoCache[key]) return geoCache[key];  // skip null cache → allow retry

  let pos = null;

  // Strategy 1: Google Maps Geocoder (venue + city)
  const gcQuery = [venue, city].filter(Boolean).join(', ');
  if (gcQuery) pos = await tryGoogleGeocode(gcQuery);

  // Strategy 2: Google Maps Geocoder (full address)
  if (!pos && address) pos = await tryGoogleGeocode(address);

  // Strategy 3: Nominatim with full address (rate-limit: 1 req/sec)
  if (!pos && address) {
    await sleep(1100);
    pos = await tryNominatimGeocode(address);
  }

  // Strategy 4: Nominatim with venue + city
  if (!pos && gcQuery) {
    await sleep(1100);
    pos = await tryNominatimGeocode(gcQuery);
  }

  geoCache[key] = pos;
  saveGeoCache();
  return pos;
}

// Build venue list — groups events by venue+city, geocodes those without URL coords
async function buildVenueData() {
  const seen = new Map();
  events.forEach(ev => {
    if (!ev.venue && !ev.city) return;
    const key = (ev.venue || '') + '||' + (ev.city || '');
    if (!seen.has(key)) {
      seen.set(key, {
        name: ev.venue || ev.city || 'Lugar',
        venue:   ev.venue   || '',
        city:    ev.city    || '',
        address: ev.address || '',
        coords:   coordsFromMapsUrl(ev.maps_url),
        maps_url: ev.maps_url,
        events: [],
      });
    }
    const entry = seen.get(key);
    entry.events.push(ev);
    if (!entry.coords) entry.coords = coordsFromMapsUrl(ev.maps_url);
  });

  // Geocode venues whose URL didn't contain coordinates (sequential to respect rate limits)
  const needsGeo = [...seen.values()].filter(v => !v.coords);
  if (needsGeo.length) {
    for (const v of needsGeo) {
      v.coords = await geocodeVenue(v.venue, v.city, v.address);
    }
  }

  return [...seen.values()];
}

function initVenueMap() {
  if (!window.google?.maps) { setTimeout(initVenueMap, 400); return; }
  const el = document.getElementById('map-canvas');
  venueMap = new google.maps.Map(el, {
    zoom: 6,
    center: { lat: 40.4168, lng: -3.7038 },
    styles: DARK_MAP_STYLES,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    gestureHandling: 'greedy',
  });
  refreshVenueMarkers();
}

function markerSvg(emoji, count) {
  const badge = count > 1
    ? `<circle cx="30" cy="8" r="8" fill="#c9943a"/><text x="30" y="12" text-anchor="middle" font-size="9" fill="#1a1000" font-weight="bold" font-family="system-ui">${count > 99 ? '99+' : count}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">
    <filter id="s"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,.6)"/></filter>
    <g filter="url(#s)">
      <circle cx="20" cy="19" r="17" fill="#100f12" stroke="rgba(201,148,58,.85)" stroke-width="2"/>
      <text x="20" y="25" text-anchor="middle" font-size="15">${emoji}</text>
      <path d="M13 33 Q20 48 27 33" fill="#100f12" stroke="rgba(201,148,58,.85)" stroke-width="1.5"/>
    </g>
    ${badge}
  </svg>`;
}

function buildInfoWindowHtml(v) {
  const rows = v.events.slice(0, 5).map(ev =>
    `<div class="iw-row">
      <span class="iw-emoji">${CATS[ev.cat]?.emoji || ''}</span>
      <span class="iw-title">${escHtml(ev.title)}</span>
      ${ev.date   ? `<span class="iw-date">${fmtDate(ev.date)}</span>` : ''}
      ${ev.rating ? `<span class="iw-stars">${'★'.repeat(Math.floor(ev.rating))}</span>` : ''}
    </div>`
  ).join('');
  const more = v.events.length > 5 ? `<div class="iw-more">+ ${v.events.length - 5} más</div>` : '';
  const link = v.maps_url ? `<a class="iw-link" href="${v.maps_url}" target="_blank" rel="noopener">Ver en Google Maps →</a>` : '';
  return `<div class="map-iw">
    <div class="iw-name">${escHtml(v.name)}</div>
    ${v.city ? `<div class="iw-city">📍 ${escHtml(v.city)}</div>` : ''}
    <div class="iw-events">${rows}${more}</div>
    ${link}
  </div>`;
}

async function refreshVenueMarkers() {
  venueMarkers.forEach(m => m.setMap(null));
  venueMarkers = [];
  if (openInfoWindow) { openInfoWindow.close(); openInfoWindow = null; }

  // Show loading while geocoding
  const loadingEl = document.getElementById('map-loading');
  if (loadingEl) {
    loadingEl.style.display = 'flex';
    loadingEl.innerHTML = '<div class="spinner"></div>&nbsp; Localizando venues…';
  }

  const allVenues = await buildVenueData();
  const venues    = allVenues.filter(v => v.coords);
  const noCoords  = allVenues.filter(v => !v.coords);

  if (loadingEl) loadingEl.style.display = 'none';

  renderMapSidebar(venues, noCoords);
  if (!venues.length || !venueMap) return;

  const bounds = new google.maps.LatLngBounds();

  venues.forEach(v => {
    const pos = new google.maps.LatLng(v.coords.lat, v.coords.lng);
    bounds.extend(pos);

    const topCat = Object.entries(
      v.events.reduce((acc, ev) => { acc[ev.cat] = (acc[ev.cat] || 0) + 1; return acc; }, {})
    ).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Otro';

    const marker = new google.maps.Marker({
      position: pos,
      map: venueMap,
      title: v.name,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(markerSvg(CATS[topCat]?.emoji || '✨', v.events.length)),
        scaledSize: new google.maps.Size(40, 48),
        anchor:     new google.maps.Point(20, 48),
      },
    });

    const iw = new google.maps.InfoWindow({ content: buildInfoWindowHtml(v) });
    marker.addListener('click', () => {
      if (openInfoWindow) openInfoWindow.close();
      iw.open(venueMap, marker);
      openInfoWindow = iw;
    });

    venueMarkers.push(marker);
  });

  if (venues.length === 1) {
    venueMap.setCenter(venues[0].coords);
    venueMap.setZoom(14);
  } else {
    venueMap.fitBounds(bounds, { top: 60, right: 20, bottom: 60, left: 20 });
  }
}

function renderMapSidebar(venues, noCoords) {
  const cities      = new Set(venues.map(v => v.city).filter(Boolean)).size;
  const totalEvents = venues.reduce((s, v) => s + v.events.length, 0);

  const noMapHtml = noCoords.length ? `
    <div class="mapsb-missing">
      <div class="mapsb-missing-title">Sin ubicar (${noCoords.length})</div>
      ${noCoords.map(v => `
        <div class="mapsb-row">
          <span class="mapsb-ev-title">${escHtml(v.name)}${v.city ? ` · ${escHtml(v.city)}` : ''}</span>
        </div>`).join('')}
    </div>` : '';

  document.getElementById('map-sidebar').innerHTML = !venues.length ? `
    <div class="mapsb-empty">
      <div style="font-size:32px;margin-bottom:.75rem">📍</div>
      <p>No se pudo localizar ningún venue.<br>
      <small>Asegúrate de que los eventos tienen local y ciudad rellenados.</small></p>
    </div>` : `
    <div class="mapsb-stats">
      <div class="mapsb-stat"><div class="mapsb-n">${venues.length}</div><div class="mapsb-l">Locales</div></div>
      <div class="mapsb-stat"><div class="mapsb-n">${cities}</div><div class="mapsb-l">Ciudades</div></div>
      <div class="mapsb-stat"><div class="mapsb-n">${totalEvents}</div><div class="mapsb-l">Eventos</div></div>
    </div>
    <div class="mapsb-list">
      ${venues.map(v => `
        <div class="mapsb-row" onclick="venueMap && venueMap.panTo({lat:${v.coords.lat},lng:${v.coords.lng}}) && venueMap.setZoom(14)">
          <span class="mapsb-venue">${escHtml(v.name)}</span>
          <span class="mapsb-city">${escHtml(v.city || '')}</span>
          <span class="mapsb-count">${v.events.length}</span>
        </div>`).join('')}
    </div>
    ${noMapHtml}
    <div style="padding:8px;text-align:center">
      <button onclick="clearGeoCache()" style="background:none;border:none;color:var(--text3);font-size:10px;cursor:pointer;font-family:var(--ui);text-decoration:underline">↺ Recalcular ubicaciones</button>
    </div>`;
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
    navigator.serviceWorker.register('sw.js').catch(() => {});
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
    if (btn) { btn.innerHTML = '<span class="btn-icon">📤</span><span class="btn-lbl">Enviar</span>'; btn.disabled = false; }
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
  const accent = catHexColor(ev.cat);
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
    const starSize = 48;
    for (let i = 0; i < 5; i++) {
      const sx = PAD + i * (starSize * 1.05);
      if (ev.rating >= i + 1) {
        ctx.fillStyle = '#e4b96a';
        ctx.fillText('★', sx, y + 8);
      } else if (ev.rating >= i + 0.5) {
        ctx.fillStyle = 'rgba(228,185,106,.2)';
        ctx.fillText('★', sx, y + 8);
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, y + 8 - starSize, starSize * 0.52, starSize * 1.1);
        ctx.clip();
        ctx.fillStyle = '#e4b96a';
        ctx.fillText('★', sx, y + 8);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(228,185,106,.2)';
        ctx.fillText('★', sx, y + 8);
      }
    }
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
const PLURAL_MAP = { Concierto:'conciertos', Cine:'películas', Teatro:'obras de teatro', Exposición:'exposiciones', Otro:'eventos' };
function catPlural(name) { return PLURAL_MAP[name] || name.toLowerCase() + 's'; }
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
    <div class="ws-label">${activeMo === 1 ? 'mes' : 'meses'} con eventos</div>
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
      <div class="ws-label">${catPlural(topCat.c)}</div>
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
              <div class="ws-top-meta ws-top-stars">${starsHtml(ev.rating)} ${ev.date?fmtDate(ev.date):''}</div>
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
    activeMo   ? { n:activeMo, l: activeMo === 1 ? 'mes activo' : 'meses activos' } : null,
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
  const ratings  = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map(r => ({ r, v: evts.filter(e => e.rating === r).length })).filter(d => d.v > 0);
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
          <div class="stat-row-label stars-row" style="gap:1px">${starsHtml(d.r)}</div>
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
  // Comparativa entre años (solo en modo "Todos")
  if (statsYear === 'Todos') {
    const years = getYears();
    if (years.length >= 2) content.innerHTML += renderYearComparison(years);
  }

  // Botón "Año en imágenes"
  const targetYear = statsYear !== 'Todos' ? statsYear : getYears()[0];
  if (targetYear) {
    content.innerHTML += `<button class="btn-wrapped" onclick="closeStats();openWrapped('${targetYear}')">🎞 Ver ${targetYear} en imágenes</button>`;
  }

  // Exportar
  content.innerHTML += `
    <div class="export-section">
      <div class="export-title">Exportar</div>
      <div class="export-btns">
        <button class="export-btn" onclick="exportCSV()">
          <span class="export-icon">📊</span>
          <span class="export-label">CSV</span>
          <span class="export-sub">Excel / Sheets</span>
        </button>
        <button class="export-btn" onclick="exportPDF()">
          <span class="export-icon">📄</span>
          <span class="export-label">PDF</span>
          <span class="export-sub">Imprimir / Guardar</span>
        </button>
      </div>
    </div>`;
}


function renderYearComparison(years) {
  if (years.length < 2) return '';
  const yData = years.slice(0, 5).reverse().map(y => {  // max 5 años, cronológico
    const evts   = events.filter(e => e.date?.startsWith(y));
    const rated  = evts.filter(e => e.rating > 0);
    const avg    = rated.length ? +(rated.reduce((s,e) => s + e.rating, 0) / rated.length).toFixed(1) : 0;
    const months = new Set(evts.map(e => e.date?.slice(0,7)).filter(Boolean)).size;
    const topCat = Object.keys(CATS)
      .map(c => ({ c, n: evts.filter(e => e.cat === c).length }))
      .sort((a,b) => b.n - a.n)[0];
    return { y, total: evts.length, avg, months, emoji: topCat?.n > 0 ? CATS[topCat.c].emoji : '—' };
  });

  const maxTotal = Math.max(...yData.map(d => d.total), 1);
  const maxAvg   = 5;

  const chart = svgYearChart(yData, maxTotal);

  const rows = yData.map(d => `
    <div class="yc-row">
      <div class="yc-year">${d.y}</div>
      <div class="yc-bar-wrap">
        <div class="yc-bar" style="width:${(d.total/maxTotal*100).toFixed(1)}%"></div>
      </div>
      <div class="yc-total">${d.total}</div>
      <div class="yc-avg">${d.avg > 0 ? d.avg + ' ★' : '—'}</div>
      <div class="yc-cat">${d.emoji}</div>
      <div class="yc-months">${d.months}m</div>
    </div>`).join('');

  return `
    <div class="stats-section">
      <div class="stats-section-title">Comparativa entre años</div>
      <div class="chart-wrap" style="margin-bottom:.75rem">${chart}</div>
      <div class="yc-header">
        <div class="yc-year"></div>
        <div class="yc-bar-wrap"></div>
        <div class="yc-total yc-lbl">Eventos</div>
        <div class="yc-avg yc-lbl">Media ★</div>
        <div class="yc-cat yc-lbl">Top</div>
        <div class="yc-months yc-lbl">Meses</div>
      </div>
      ${rows}
    </div>`;
}

function svgYearChart(yData, maxVal) {
  const n = yData.length;
  const slotW = Math.min(72, 320 / n), barW = slotW * .55;
  const topPad = 18, maxBarH = 70, lblH = 18;
  const W = n * slotW + 10, H = topPad + maxBarH + lblH;

  const bars = yData.map((d, i) => {
    const x  = i * slotW + (slotW - barW) / 2;
    const bh = d.total > 0 ? Math.max(Math.round(d.total / maxVal * maxBarH), 4) : 0;
    const by = topPad + maxBarH - bh;
    return [
      `<rect x="${x}" y="${by}" width="${barW}" height="${bh}" fill="var(--amber)" rx="3" opacity=".72"/>`,
      d.total > 0 ? `<text x="${x+barW/2}" y="${by-4}" text-anchor="middle" font-size="9" fill="var(--amber-lt)" font-family="system-ui">${d.total}</text>` : '',
      `<text x="${x+barW/2}" y="${H-2}" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="system-ui">${d.y}</text>`,
    ].join('');
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${W*2}px;height:auto;display:block">${bars}</svg>`;
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


// ── Export ──
function exportCSV() {
  const cols    = ['title','date','cat','venue','city','address','rating','companions','notes','maps_url'];
  const headers = ['Título','Fecha','Categoría','Lugar','Ciudad','Dirección','Valoración','Acompañantes','Notas','Mapa'];
  const esc     = v => `"${(v ?? '').toString().replace(/"/g,'""')}"`;
  const csv     = [headers.map(esc).join(','), ...events.map(ev => cols.map(c => esc(ev[c])).join(','))].join('\n');
  const blob    = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url     = URL.createObjectURL(blob);
  const a       = Object.assign(document.createElement('a'), { href: url, download: `diario-cultural-${new Date().toISOString().slice(0,10)}.csv` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('✓ CSV exportado');
}

function exportPDF() {
  const win = window.open('', '_blank');
  if (!win) { toast('Permite ventanas emergentes para exportar', true); return; }
  const sorted = [...events].sort((a,b) => (b.date||'') < (a.date||'') ? 1 : -1);
  win.document.write(buildPrintHTML(sorted));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

function buildPrintHTML(list) {
  const starsStr = r => {
    if (!r) return '';
    let s = '';
    for (let i = 1; i <= 5; i++) s += r >= i ? '★' : r >= i-.5 ? '½' : '☆';
    return s;
  };
  const rows = list.map(ev => {
    const loc   = [ev.venue, ev.city].filter(Boolean).join(', ');
    const meta  = [ev.date ? fmtDate(ev.date) : '', loc, ev.companions ? '👥 ' + ev.companions : ''].filter(Boolean).join('  ·  ');
    return `<div class="ev">
      <div class="ev-header">
        <span class="ev-cat">${CATS[ev.cat]?.emoji || ''} ${ev.cat || ''}</span>
        ${ev.rating ? `<span class="ev-stars">${starsStr(ev.rating)}</span>` : ''}
      </div>
      <div class="ev-title">${escHtml(ev.title)}</div>
      ${meta ? `<div class="ev-meta">${escHtml(meta)}</div>` : ''}
      ${ev.notes ? `<div class="ev-notes">${escHtml(ev.notes)}</div>` : ''}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Diario Cultural</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; background: #fff; padding: 48px; }
  .page-header { text-align: center; padding-bottom: 28px; border-bottom: 2px solid #1a1a1a; margin-bottom: 36px; }
  .page-header h1 { font-size: 38px; font-weight: 300; font-style: italic; letter-spacing: -1px; }
  .page-header h1 em { color: #c9943a; }
  .page-header p { color: #888; font-size: 13px; margin-top: 6px; font-family: system-ui; }
  .ev { padding: 18px 0; border-bottom: 1px solid #eee; break-inside: avoid; page-break-inside: avoid; }
  .ev-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .ev-cat { font-family: system-ui; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #999; }
  .ev-stars { font-size: 13px; color: #c9943a; letter-spacing: 2px; }
  .ev-title { font-size: 22px; font-weight: 300; font-style: italic; line-height: 1.2; margin-bottom: 5px; }
  .ev-meta { font-family: system-ui; font-size: 12px; color: #777; margin-bottom: 6px; }
  .ev-notes { font-size: 13px; color: #555; line-height: 1.65; font-style: italic; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #eee; }
  @media print { body { padding: 28px; } @page { margin: 1.5cm; } }
</style></head><body>
  <div class="page-header">
    <h1>Diario <em>Cultural</em></h1>
    <p>${list.length} eventos · Exportado el ${new Date().toLocaleDateString('es-ES', {day:'numeric', month:'long', year:'numeric'})}</p>
  </div>
  ${rows}
</body></html>`;
}

// ── Init ──
// Inject decorative background orbs
(function() {
  const wrap = document.createElement('div');
  wrap.className = 'bg-orbs';
  for (let i = 0; i < 4; i++) {
    wrap.appendChild(Object.assign(document.createElement('div'), { className: 'bg-orb' }));
  }
  document.body.insertBefore(wrap, document.body.firstChild);
})();

db.auth.getSession().then(({ data: { session } }) => { if (session) hideLoginScreen(); });
loadEvents();

// Offline / online handlers
window.addEventListener('online', async () => {
  isOnline = true;
  updateOfflineBanner();
  toast('✓ Conexión restaurada — sincronizando…');
  await loadEvents();
  await processSyncQueue();
});
window.addEventListener('offline', () => {
  isOnline = false;
  updateOfflineBanner();
  toast('Sin conexión — modo offline activo', true);
});
updateOfflineBanner();
