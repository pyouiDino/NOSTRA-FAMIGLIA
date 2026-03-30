// ============================================================
//  GTA V Zone Tracker v3
// ============================================================

const db   = firebase.firestore();
const auth = firebase.auth();

let ME = null;
let ROLES = {}, USERS = {}, ZONES = {}, POINTS = [], MY_NOTES = {};
let unsubs = [];
let ptFilter = 'all';

const IMG_W = 900;
const EMOJIS = ['📍','⭐','🔴','🟡','🟢','🔵','💎','🗡️','🏆','🔑','💣','🎯','👁️','🧩','🎁','❓','⚡','🔥','💀','🐉'];

// GTA 5 zones [id, label, x%, y%, w%, h%]
const ZONES_DEF = [
  ['paleto_bay',     'Paleto Bay',         28,  2, 20, 10],
  ['paleto_forest',  'Paleto Forest',      10,  8, 22, 14],
  ['mount_chiliad',  'Mount Chiliad',      28, 12, 20, 18],
  ['alamo_sea',      'Alamo Sea',          48, 22, 22, 14],
  ['grapeseed',      'Grapeseed',          64, 18, 18, 14],
  ['sandy_shores',   'Sandy Shores',       68, 32, 20, 12],
  ['mount_gordo',    'Mount Gordo',        82,  8, 16, 18],
  ['north_chumash',  'North Chumash',       2, 18, 12, 20],
  ['lago_zancudo',   'Lago Zancudo',        4, 34, 16, 14],
  ['raton_canyon',   'Raton Canyon',       14, 24, 16, 12],
  ['mount_josiah',   'Mount Josiah',       24, 30, 20, 14],
  ['grand_senora',   'Grand Senora',       44, 38, 26, 14],
  ['harmony',        'Harmony',            40, 44, 18, 12],
  ['great_chaparral','Great Chaparral',    30, 46, 18, 14],
  ['tataviam_mts',   'Tataviam Mts',       66, 48, 16, 16],
  ['palomino',       'Palomino High.',     76, 56, 16, 14],
  ['tongva_hills',   'Tongva Hills',       10, 52, 16, 12],
  ['tongva_valley',  'Tongva Valley',      16, 60, 14, 12],
  ['banham_canyon',  'Banham Canyon',       4, 58, 14, 12],
  ['vinewood_hills', 'Vinewood Hills',     32, 56, 22, 12],
  ['east_vinewood',  'East Vinewood',      54, 56, 14, 10],
  ['pacific_bluffs', 'Pacific Bluffs',      6, 68, 16, 12],
  ['richman',        'Richman',            22, 68, 14, 10],
  ['rockford_hills', 'Rockford Hills',     28, 72, 12, 10],
  ['vinewood',       'Vinewood',           40, 68, 14, 10],
  ['downtown',       'Downtown LS',        38, 76, 18, 12],
  ['little_seoul',   'Little Seoul',       24, 78, 14, 10],
  ['del_perro',      'Del Perro',          10, 76, 16, 10],
  ['vespucci',       'Vespucci Beach',     12, 82, 14, 10],
  ['south_ls',       'South Los Santos',   34, 84, 20, 10],
  ['east_ls',        'East Los Santos',    54, 78, 14, 12],
  ['lsia',           'LS Int. Airport',     8, 88, 22, 10],
  ['la_puerta',      'La Puerta',          30, 90, 16,  8],
  ['port_ls',        'Port of LS',         46, 90, 20, 10],
  ['elysian',        'Elysian Island',     62, 88, 14, 10],
];

// ============================================================
//  AUTH STATE
// ============================================================
auth.onAuthStateChanged(async user => {
  if (!user) { showScreen('auth-screen'); return; }
  const doc = await db.collection('users').doc(user.uid).get();
  if (!doc.exists) { auth.signOut(); return; }
  const d = doc.data();
  let rolePerms = d.perms || {};
  let roleData  = { name: d.role, color: '#4ade80' };
  if (d.roleId && d.roleId !== 'admin' && d.roleId !== 'superadmin') {
    const rd = await db.collection('roles').doc(d.roleId).get();
    if (rd.exists) { roleData = rd.data(); rolePerms = rd.data().perms || {}; }
  }
  ME = { uid: user.uid, pseudo: d.pseudo, role: d.role, roleId: d.roleId, perms: rolePerms, roleData, zoneColor: d.zoneColor || '#4ade80' };
  initApp();
});

// ============================================================
//  LOGIN — pseudo OR email + password
// ============================================================
async function doLogin() {
  const id   = document.getElementById('l-id').value.trim();
  const pass = document.getElementById('l-pass').value;
  setErr('l-err', '');
  if (!id || !pass) return setErr('l-err', 'Remplis tous les champs');
  try {
    // Try as email first
    if (id.includes('@')) {
      await auth.signInWithEmailAndPassword(id, pass);
    } else {
      // Find by pseudo
      const snap = await db.collection('users').where('pseudo', '==', id).limit(1).get();
      if (snap.empty) return setErr('l-err', 'Pseudo introuvable');
      await auth.signInWithEmailAndPassword(snap.docs[0].data().email, pass);
    }
  } catch(e) { setErr('l-err', authErr(e.code)); }
}

async function doRegister() {
  const pseudo = document.getElementById('r-pseudo').value.trim();
  const pass   = document.getElementById('r-pass').value;
  const code   = document.getElementById('r-code').value.trim().toUpperCase();
  setErr('r-err', '');
  if (!pseudo || !pass || !code) return setErr('r-err', 'Remplis tous les champs');
  if (pass.length < 6) return setErr('r-err', 'Mot de passe trop court (6 min.)');

  const codeDoc = await db.collection('invite_codes').doc(code).get();
  if (!codeDoc.exists || codeDoc.data().used) return setErr('r-err', 'Code invalide ou déjà utilisé');

  try {
    const cd = codeDoc.data();
    const email = `${pseudo.toLowerCase().replace(/[^a-z0-9]/g, '_')}__${code}@tracker.local`;
    const cred  = await auth.createUserWithEmailAndPassword(email, pass);
    await db.collection('users').doc(cred.user.uid).set({
      uid: cred.user.uid, pseudo, email,
      role: cd.role || 'user',
      roleId: cd.roleId || 'user',
      perms: cd.perms || {},
      zoneColor: cd.zoneColor || '#4ade80',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('invite_codes').doc(code).update({ used: true, usedBy: cred.user.uid });
  } catch(e) { setErr('r-err', authErr(e.code)); }
}

function doLogout() { unsubs.forEach(u => u()); unsubs = []; auth.signOut(); }
function showLogin()    { showScreen('auth-screen'); }
function showRegister() { showScreen('register-screen'); }

// ============================================================
//  INIT APP
// ============================================================
function initApp() {
  showScreen('app-screen');
  document.getElementById('u-name').textContent   = ME.pseudo;
  document.getElementById('u-avatar').textContent = ME.pseudo[0].toUpperCase();
  document.getElementById('u-role').textContent   = ME.roleData.name || ME.role;

  const isAdmin = ME.role === 'admin' || ME.role === 'superadmin';
  if (ME.perms.seePoints || ME.perms.signal) {
    ['nav-points','mob-pts'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
  }
  if (ME.perms.signal) { const el = document.getElementById('btn-add-pt'); if (el) el.style.display = ''; }
  if (isAdmin) {
    ['nav-admin','mob-admin'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
  }
  if (ME.role === 'superadmin') { const el = document.getElementById('nav-sa'); if (el) el.style.display = ''; }

  buildLayerToggles();
  buildEmojiPicker();
  subscribeAll();
  showPage('map');
}

// ============================================================
//  SUBSCRIPTIONS
// ============================================================
function subscribeAll() {
  unsubs.push(db.collection('zones').onSnapshot(snap => {
    ZONES = {}; snap.forEach(d => ZONES[d.id] = d.data());
    renderZones(); updateStats();
  }));
  unsubs.push(db.collection('users').onSnapshot(snap => {
    USERS = {}; snap.forEach(d => USERS[d.id] = d.data());
  }));
  unsubs.push(db.collection('roles').onSnapshot(snap => {
    ROLES = {}; snap.forEach(d => ROLES[d.id] = d.data());
  }));
  if (ME.perms.seePoints) {
    unsubs.push(db.collection('points').onSnapshot(snap => {
      POINTS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderPtMarkers(); renderPtsList();
    }));
  }
  unsubs.push(db.collection('personal_maps').doc(ME.uid).onSnapshot(doc => {
    MY_NOTES = doc.exists ? (doc.data().zones || {}) : {};
    renderMyMap();
  }));
}

// ============================================================
//  MAP — pan/zoom setup
// ============================================================
function setupPan(vpId, worldId) {
  const vp = document.getElementById(vpId);
  const w  = document.getElementById(worldId);
  if (!vp || !w) return;
  let s = 1, x = 0, y = 0, drag = false, sx = 0, sy = 0;
  const apply = () => { w.style.transform = `translate(${x}px,${y}px) scale(${s})`; };
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    s = Math.min(4, Math.max(0.35, s * (e.deltaY > 0 ? 0.9 : 1.1)));
    apply();
  }, { passive: false });
  w.addEventListener('mousedown', e => {
    if (e.target.closest('.zone-cell,.pt-pin')) return;
    drag = true; sx = e.clientX - x; sy = e.clientY - y;
  });
  window.addEventListener('mousemove', e => { if (!drag) return; x = e.clientX - sx; y = e.clientY - sy; apply(); });
  window.addEventListener('mouseup',   () => drag = false);
  let ld = 0;
  vp.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { drag = true; sx = e.touches[0].clientX - x; sy = e.touches[0].clientY - y; }
    else ld = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  });
  vp.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && drag) { x = e.touches[0].clientX - sx; y = e.touches[0].clientY - sy; apply(); }
    else if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      s = Math.min(4, Math.max(0.35, s * d / ld)); ld = d; apply();
    }
  }, { passive: false });
  vp.addEventListener('touchend', () => drag = false);
}

function buildZoneSVG(svgId, clickFn) {
  const svg = document.getElementById(svgId);
  if (!svg || svg.children.length) return;
  const img = svg.previousElementSibling;
  const H   = img ? img.naturalHeight * (IMG_W / (img.naturalWidth || IMG_W)) : 1260;
  svg.setAttribute('viewBox', `0 0 ${IMG_W} ${H}`);
  svg.setAttribute('height', H);
  ZONES_DEF.forEach(([id, label, xp, yp, wp, hp]) => {
    const x = xp / 100 * IMG_W, y = yp / 100 * H, w = wp / 100 * IMG_W, h = hp / 100 * H;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'zone-cell'); g.dataset.zid = id; g.dataset.name = label;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x); rect.setAttribute('y', y); rect.setAttribute('width', w); rect.setAttribute('height', h);
    rect.setAttribute('rx', '3'); rect.setAttribute('fill', 'rgba(255,255,255,0.02)'); rect.setAttribute('stroke', 'rgba(255,255,255,0.07)'); rect.setAttribute('stroke-width', '1');
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', x + w / 2); txt.setAttribute('y', y + h / 2);
    txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('dominant-baseline', 'central');
    txt.setAttribute('font-family', 'Inter,sans-serif'); txt.setAttribute('font-size', '8.5');
    txt.setAttribute('font-weight', '500'); txt.setAttribute('fill', 'rgba(255,255,255,0.25)');
    txt.setAttribute('pointer-events', 'none'); txt.textContent = label;
    g.appendChild(rect); g.appendChild(txt);
    g.addEventListener('click', () => clickFn(id, label));
    svg.appendChild(g);
  });
}

function renderZones() {
  const svg = document.getElementById('zone-svg');
  if (!svg) return;
  const img = document.getElementById('map-img');
  if (!img.complete) { img.onload = () => { buildZoneSVG('zone-svg', onZoneClick); renderZones(); }; return; }
  buildZoneSVG('zone-svg', onZoneClick);

  ZONES_DEF.forEach(([id]) => {
    const g = svg.querySelector(`[data-zid="${id}"]`);
    if (!g) return;
    const rect = g.querySelector('rect');
    const zd   = ZONES[id];
    const isMine   = zd?.claimedBy?.includes(ME.uid);
    const isTodo   = zd?.todos?.includes(ME.uid);
    const others   = (zd?.claimedBy || []).filter(u => u !== ME.uid);
    const hasOther = others.length > 0 && layerOn('others');

    let fill = 'rgba(255,255,255,0.02)', stroke = 'rgba(255,255,255,0.07)', sw = '1';
    const mc = ME.zoneColor || '#4ade80';

    if (isMine && layerOn('mine'))   { fill = hexA(mc, .35); stroke = mc; sw = '2'; }
    if (hasOther && !isMine)         { fill = 'rgba(96,165,250,.22)'; stroke = '#60a5fa'; sw = '1.5'; }
    if (isMine && hasOther && layerOn('mine')) { fill = 'rgba(245,197,24,.25)'; stroke = '#f5c518'; sw = '2'; }
    if (isTodo && layerOn('todo'))   { fill = 'rgba(251,146,60,.28)'; stroke = '#fb923c'; sw = '2'; }

    rect.setAttribute('fill', fill); rect.setAttribute('stroke', stroke); rect.setAttribute('stroke-width', sw);
  });
}

function renderPtMarkers() {
  const layer = document.getElementById('pts-layer');
  if (!layer) return;
  layer.innerHTML = '';
  if (!layerOn('pts')) return;
  const img = document.getElementById('map-img');
  if (!img || !img.complete) return;
  const H = img.naturalHeight * (IMG_W / img.naturalWidth);
  POINTS.forEach(pt => {
    const zd = ZONES_DEF.find(z => z[1] === pt.zone || z[0] === pt.zoneId);
    if (!zd) return;
    const [,, xp, yp, wp, hp] = zd;
    const el = document.createElement('div');
    el.className = 'pt-pin';
    el.textContent = pt.emoji || '📍';
    el.style.left = ((xp + wp / 2) / 100 * IMG_W) + 'px';
    el.style.top  = ((yp + hp / 2) / 100 * H) + 'px';
    el.title = pt.name;
    el.addEventListener('click', e => { e.stopPropagation(); openPtDetail(pt); });
    layer.appendChild(el);
  });
}

function renderMyMap() {
  const svg = document.getElementById('myzone-svg');
  if (!svg) return;
  const img = document.querySelector('#mymap-world img');
  if (!img || !img.complete) { if (img) img.onload = renderMyMap; return; }
  buildZoneSVG('myzone-svg', onMyZoneClick);
  ZONES_DEF.forEach(([id]) => {
    const g = svg.querySelector(`[data-zid="${id}"]`);
    if (!g) return;
    const rect = g.querySelector('rect');
    const n = MY_NOTES[id];
    if (n) { rect.setAttribute('fill', hexA(n.color || ME.zoneColor, .4)); rect.setAttribute('stroke', n.color || ME.zoneColor); rect.setAttribute('stroke-width', '2'); }
    else   { rect.setAttribute('fill', 'rgba(255,255,255,0.02)'); rect.setAttribute('stroke', 'rgba(255,255,255,0.07)'); rect.setAttribute('stroke-width', '1'); }
  });
}

function updateStats() {
  const mine = Object.values(ZONES).filter(z => z.claimedBy?.includes(ME.uid)).length;
  const el = document.getElementById('map-stats');
  if (el) el.textContent = `${mine} / ${ZONES_DEF.length} zones`;
}

// Layer toggles
function buildLayerToggles() {
  const c = document.getElementById('layer-toggles');
  if (!c) return;
  const layers = [
    { id: 'mine',   label: 'Mes zones', on: true },
    { id: 'others', label: 'Autres',    on: ME.perms.seeOthers !== false },
    { id: 'todo',   label: 'À faire',   on: true },
    { id: 'pts',    label: 'Points',    on: !!ME.perms.seePoints },
  ];
  c.innerHTML = layers.map(l =>
    `<button id="lay-${l.id}" class="layer-btn ${l.on ? 'on' : ''}" onclick="toggleLayer('${l.id}',this)">${l.label}</button>`
  ).join('');
}

function toggleLayer(id, btn) { btn.classList.toggle('on'); renderZones(); renderPtMarkers(); }
function layerOn(id) { const el = document.getElementById('lay-' + id); return el ? el.classList.contains('on') : false; }

// ============================================================
//  ZONE CLICK — shared map
// ============================================================
function onZoneClick(id, name) {
  const zd = ZONES[id] || {};
  const isMine = zd.claimedBy?.includes(ME.uid);
  const isTodo = zd.todos?.includes(ME.uid);
  const others = (zd.claimedBy || []).filter(u => u !== ME.uid);

  let body = `<div class="zm-info">Zone : <strong>${name}</strong></div>`;

  if (others.length && ME.perms.seeOthers !== false) {
    body += `<div class="zm-players">`;
    others.forEach(uid => {
      const u = USERS[uid];
      if (!u) return;
      body += `<div class="zm-prow"><span class="zm-dot" style="background:${u.zoneColor||'#60a5fa'}"></span>${esc(u.pseudo)}</div>`;
    });
    body += `</div>`;
  }

  body += `<div class="zm-actions">`;
  if (ME.perms.zones !== false) {
    body += `<button class="zone-btn ${isMine ? 'done' : ''}" onclick="toggleZone('${id}',${isMine})">${isMine ? '✓ Retirer de mes zones' : '+ Marquer comme explorée'}</button>`;
  }
  if (ME.role === 'admin' || ME.role === 'superadmin') {
    body += `<button class="zone-btn ${isTodo ? 'todo' : ''}" onclick="toggleTodo('${id}',${isTodo})">${isTodo ? '✓ Retirer "à faire"' : '📌 Marquer "à rechercher"'}</button>`;
  }
  body += `</div>`;

  document.getElementById('mz-name').textContent = name;
  document.getElementById('mz-body').innerHTML = body;
  openModal('modal-zone');
}

async function toggleZone(id, isMine) {
  closeModal('modal-zone');
  const ref = db.collection('zones').doc(id);
  if (isMine) { await ref.update({ claimedBy: firebase.firestore.FieldValue.arrayRemove(ME.uid) }); toast('Zone retirée'); }
  else        { await ref.set({ claimedBy: firebase.firestore.FieldValue.arrayUnion(ME.uid) }, { merge: true }); toast('Zone marquée ✓'); }
}

async function toggleTodo(id, isTodo) {
  closeModal('modal-zone');
  const ref = db.collection('zones').doc(id);
  if (isTodo) { await ref.update({ todos: firebase.firestore.FieldValue.arrayRemove(ME.uid) }); toast('Retiré'); }
  else        { await ref.set({ todos: firebase.firestore.FieldValue.arrayUnion(ME.uid) }, { merge: true }); toast('Zone "à faire" assignée 📌'); }
}

// ============================================================
//  ZONE CLICK — personal map
// ============================================================
function onMyZoneClick(id, name) {
  const n = MY_NOTES[id] || {};
  document.getElementById('mz-name').textContent = name + ' — Ma carte';
  document.getElementById('mz-body').innerHTML = `
    <div class="field"><label>Note</label><textarea id="mn-text" placeholder="Notes, indices...">${esc(n.text || '')}</textarea></div>
    <div class="field"><label>Couleur</label><input type="color" id="mn-color" value="${n.color || ME.zoneColor || '#4ade80'}"></div>
    <div style="display:flex;gap:8px">
      <button class="btn-primary" style="flex:1" onclick="saveMyNote('${id}')">Sauvegarder</button>
      <button class="btn-ghost" onclick="clearMyNote('${id}')">Effacer</button>
    </div>`;
  openModal('modal-zone');
}

async function saveMyNote(zid) {
  const text = document.getElementById('mn-text').value;
  const color = document.getElementById('mn-color').value;
  await db.collection('personal_maps').doc(ME.uid).set({ zones: { [zid]: { text, color } } }, { merge: true });
  closeModal('modal-zone'); toast('Note sauvegardée');
}

async function clearMyNote(zid) {
  await db.collection('personal_maps').doc(ME.uid).update({ [`zones.${zid}`]: firebase.firestore.FieldValue.delete() });
  closeModal('modal-zone'); toast('Note effacée');
}

// ============================================================
//  POINTS
// ============================================================
function buildEmojiPicker() {
  const c = document.getElementById('emoji-picker');
  if (!c) return;
  c.innerHTML = EMOJIS.map((e, i) =>
    `<button class="ep ${i === 0 ? 'sel' : ''}" onclick="pickEmoji('${e}',this)">${e}</button>`
  ).join('');
}

function pickEmoji(e, btn) {
  document.querySelectorAll('.ep').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
  document.getElementById('pt-emoji').value = e;
}

async function submitPoint() {
  const name  = document.getElementById('pt-name').value.trim();
  const zone  = document.getElementById('pt-zone').value.trim();
  const desc  = document.getElementById('pt-desc').value.trim();
  const type  = document.getElementById('pt-type').value;
  const emoji = document.getElementById('pt-emoji').value;
  const img   = document.getElementById('pt-img').value.trim();
  if (!name || !zone) return toast('Nom et zone requis');
  await db.collection('points').add({ name, zone, description: desc, type, emoji, imageUrl: img, reportedBy: ME.uid, reportedByName: ME.pseudo, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  closeModal('modal-add-point');
  toast('Point signalé ' + emoji);
  ['pt-name','pt-zone','pt-desc','pt-img'].forEach(id => { document.getElementById(id).value = ''; });
}

function openPtDetail(pt) {
  let body = '';
  if (pt.imageUrl) body += `<img src="${esc(pt.imageUrl)}" class="modal-img" alt="">`;
  body += `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-size:26px">${pt.emoji || '📍'}</span>
      <div><div class="pt-name">${esc(pt.name)}</div><div class="pt-zone">📍 ${esc(pt.zone)}</div></div>
    </div>
    ${pt.description ? `<p style="font-size:13px;color:var(--text2);line-height:1.6">${esc(pt.description)}</p>` : ''}
    <div style="font-size:11px;color:var(--text3);margin-top:8px">Signalé par ${esc(pt.reportedByName || '?')}</div>`;
  document.getElementById('mpd-name').textContent = pt.name;
  document.getElementById('mpd-body').innerHTML = body;
  openModal('modal-pt-detail');
}

function filterPts(type, btn) {
  ptFilter = type;
  document.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPtsList();
}

function renderPtsList() {
  const grid = document.getElementById('pts-grid');
  if (!grid) return;
  const list = ptFilter === 'all' ? POINTS : POINTS.filter(p => p.type === ptFilter);
  if (!list.length) { grid.innerHTML = '<div class="empty">Aucun point signalé</div>'; return; }
  const typeClass = { collectible:'tc', easter_egg:'te', secret:'ts', autre:'ta' };
  grid.innerHTML = list.map(pt => `
    <div class="pt-card" onclick='openPtDetail(${JSON.stringify(pt)})'>
      <div class="pt-card-top">
        <span class="pt-emoji">${pt.emoji || '📍'}</span>
        <span class="pt-type ${typeClass[pt.type] || 'ta'}">${pt.type.replace('_',' ')}</span>
      </div>
      <div class="pt-name">${esc(pt.name)}</div>
      <div class="pt-zone">${esc(pt.zone)}</div>
      ${pt.description ? `<div class="pt-desc">${esc(pt.description)}</div>` : ''}
    </div>`).join('');
}

// ============================================================
//  ADMIN
// ============================================================
async function loadAdmin() {
  const rsnap = await db.collection('roles').get();
  ROLES = {}; rsnap.forEach(d => ROLES[d.id] = d.data());
  const usnap = await db.collection('users').get();
  USERS = {}; usnap.forEach(d => USERS[d.id] = d.data());

  // Role select
  const sel = document.getElementById('a-role-sel');
  if (sel) sel.innerHTML = '<option value="user">Utilisateur (défaut)</option>' +
    Object.entries(ROLES).map(([id, r]) => `<option value="${id}">${esc(r.name)}</option>`).join('');

  renderUList('users-list', Object.values(USERS).filter(u => u.role === 'user'));
  renderRList();

  // Zone color admin
  const azSel = document.getElementById('az-user');
  if (azSel) {
    azSel.innerHTML = Object.values(USERS).filter(u => u.role === 'user').map(u =>
      `<option value="${u.uid}">${esc(u.pseudo)}</option>`).join('');
    azSel.onchange = () => {
      const u = USERS[azSel.value];
      if (u) document.getElementById('az-color').value = u.zoneColor || '#4ade80';
    };
    const first = azSel.value && USERS[azSel.value];
    if (first) document.getElementById('az-color').value = first.zoneColor || '#4ade80';
  }
}

async function updateZoneColor(color) {
  const sel = document.getElementById('az-user');
  if (!sel || !sel.value) return;
  await db.collection('users').doc(sel.value).update({ zoneColor: color });
  toast('Couleur mise à jour');
}

async function adminCreateUser() {
  const pseudo = document.getElementById('a-pseudo').value.trim();
  const roleId = document.getElementById('a-role-sel').value;
  const color  = document.getElementById('a-color').value;
  setErr('a-err', '');
  if (!pseudo) return setErr('a-err', 'Pseudo requis');
  let perms = { zones: true, seeOthers: true, signal: true, seePoints: true };
  if (roleId !== 'user' && ROLES[roleId]) perms = ROLES[roleId].perms || {};
  const code = genCode();
  await db.collection('invite_codes').doc(code).set({ pseudo, perms, role: 'user', roleId, zoneColor: color, createdBy: ME.uid, used: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  const out = document.getElementById('a-code-out');
  out.classList.remove('hidden');
  out.innerHTML = `Code pour <strong>${esc(pseudo)}</strong> :<div class="code-val">${code}</div>`;
  document.getElementById('a-pseudo').value = '';
}

async function createRole() {
  const name  = document.getElementById('rn-name').value.trim();
  const color = document.getElementById('rn-color').value;
  if (!name) return toast('Nom du rôle requis');
  const perms = { zones: document.getElementById('rp-zones').checked, seeOthers: document.getElementById('rp-others').checked, signal: document.getElementById('rp-signal').checked, seePoints: document.getElementById('rp-seepoints').checked, mymap: document.getElementById('rp-mymap').checked };
  await db.collection('roles').add({ name, color, perms, createdBy: ME.uid });
  toast('Rôle créé'); loadAdmin();
  document.getElementById('rn-name').value = '';
}

function renderUList(id, users) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!users.length) { el.innerHTML = '<div class="empty">Aucun utilisateur</div>'; return; }
  el.innerHTML = `<div class="u-list">${users.map(u => `
    <div class="u-item">
      <div class="u-avatar" style="border-color:${u.zoneColor||'#4ade80'};color:${u.zoneColor||'#4ade80'}">${(u.pseudo||'?')[0].toUpperCase()}</div>
      <div class="u-item-info"><div class="u-item-name">${esc(u.pseudo)}</div><div class="u-item-sub">${esc(u.roleId||u.role)}</div></div>
      <div class="perm-dots">
        <div class="pdot ${u.perms?.zones?'on':''}" title="Zones"></div>
        <div class="pdot ${u.perms?.seeOthers?'on':''}" title="Voir autres"></div>
        <div class="pdot ${u.perms?.signal?'on':''}" title="Signaler"></div>
        <div class="pdot ${u.perms?.seePoints?'on':''}" title="Points"></div>
      </div>
      ${ME.role==='superadmin'?`<button class="btn-ghost danger" onclick="delUser('${u.uid}')">Suppr.</button>`:''}
    </div>`).join('')}</div>`;
}

function renderRList() {
  const el = document.getElementById('roles-list');
  if (!el) return;
  const entries = Object.entries(ROLES);
  if (!entries.length) { el.innerHTML = '<div class="empty">Aucun rôle</div>'; return; }
  el.innerHTML = `<div class="r-list">${entries.map(([id, r]) => `
    <div class="r-item">
      <div class="r-dot" style="background:${r.color}"></div>
      <div class="r-name">${esc(r.name)}</div>
      <div class="r-perms">${Object.entries(r.perms||{}).filter(([,v])=>v).map(([k])=>k).join(' · ')}</div>
      <button class="btn-ghost danger" onclick="delRole('${id}')">✕</button>
    </div>`).join('')}</div>`;
}

async function delUser(uid) { if (!confirm('Supprimer ?')) return; await db.collection('users').doc(uid).delete(); toast('Supprimé'); loadAdmin(); }
async function delRole(id)  { if (!confirm('Supprimer ce rôle ?')) return; await db.collection('roles').doc(id).delete(); toast('Supprimé'); loadAdmin(); }

function adminTab(t, btn) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.at-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('at-' + t).classList.add('active');
}

// Super admin
async function saCreateAdmin() {
  const pseudo = document.getElementById('sa-pseudo').value.trim();
  setErr('sa-err', '');
  if (!pseudo) return setErr('sa-err', 'Pseudo requis');
  const code = genCode();
  await db.collection('invite_codes').doc(code).set({ pseudo, perms: { zones:true,seeOthers:true,signal:true,seePoints:true,mymap:true }, role: 'admin', roleId: 'admin', zoneColor: '#f5c518', createdBy: ME.uid, used: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  const out = document.getElementById('sa-code-out');
  out.classList.remove('hidden');
  out.innerHTML = `Code admin pour <strong>${esc(pseudo)}</strong> :<div class="code-val">${code}</div>`;
  document.getElementById('sa-pseudo').value = '';
}

async function loadSuperAdmin() {
  const snap = await db.collection('users').get();
  USERS = {}; snap.forEach(d => USERS[d.id] = d.data());
  renderUList('all-users', Object.values(USERS));
}

// ============================================================
//  NAVIGATION
// ============================================================
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item,.mob-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll(`[data-page="${page}"]`).forEach(b => b.classList.add('active'));

  if (page === 'map' || page === 'mymap') {
    setTimeout(() => {
      setupPan('map-viewport', 'map-world');
      setupPan('mymap-viewport', 'mymap-world');
      const img = document.getElementById('map-img');
      if (img?.complete) { renderZones(); renderPtMarkers(); renderMyMap(); }
      else if (img) img.onload = () => { renderZones(); renderPtMarkers(); renderMyMap(); };
    }, 30);
  }
  if (page === 'admin')      loadAdmin();
  if (page === 'superadmin') loadSuperAdmin();
  if (page === 'points')     renderPtsList();
}

function toggleLegend() { document.getElementById('map-legend').classList.toggle('hidden'); }

// ============================================================
//  MODALS
// ============================================================
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.addEventListener('click', e => { if (e.target.classList.contains('modal-bg')) e.target.classList.add('hidden'); });

// ============================================================
//  UTILS
// ============================================================
function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2800); }
function setErr(id, msg) { const el = document.getElementById(id); if (el) el.textContent = msg; }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function genCode() { const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<8;i++) s+=c[Math.floor(Math.random()*c.length)]; return s; }
function hexA(hex, a) { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `rgba(${r},${g},${b},${a})`; }
function authErr(code) { return ({
  'auth/user-not-found':'Pseudo/email introuvable',
  'auth/wrong-password':'Mot de passe incorrect',
  'auth/email-already-in-use':'Pseudo déjà utilisé',
  'auth/weak-password':'Mot de passe trop court (6 min.)',
  'auth/invalid-email':'Identifiant invalide',
  'auth/too-many-requests':'Trop de tentatives, réessaie plus tard',
})[code] || 'Erreur : ' + code; }
