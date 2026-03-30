// ============================================================
//  GTA V Zone Tracker v2 — app.js
// ============================================================

const db   = firebase.firestore();
const auth = firebase.auth();

// ---- State ----
let ME = null;          // { uid, pseudo, role, roleData, perms, zoneColor }
let ROLES = {};         // { roleId: { name, color, perms } }
let USERS = {};         // { uid: userData }
let ZONES = {};         // { zoneId: { claimedBy:[uid], todos:[uid] } }
let POINTS = [];
let MY_NOTES = {};      // personal map notes { zoneId: note }
let unsubs = [];
let currentFilter = 'all';

// Map pan/zoom
let mapScale = 1, mapX = 0, mapY = 0;
let myMapScale = 1, myMapX = 0, myMapY = 0;
let isDragging = false, dragStart = {x:0,y:0}, panStart = {x:0,y:0};
let activeMap = null;

// Emojis available
const EMOJIS = ['📍','⭐','🔴','🟡','🟢','🔵','💎','🗡️','🏆','🔑','💣','🎯','👁️','🧩','🎁','❓','⚡','🔥','💀','🐉'];

// GTA V zone layout (matching real map proportions approx)
// Each zone: [id, name, x%, y%, w%, h%] — percentages of 900px image
const GTA_ZONES = [
  // North
  ['paleto_bay',    'Paleto Bay',        28, 2,  20, 10],
  ['paleto_forest', 'Paleto Forest',     10, 8,  22, 14],
  ['mount_chiliad', 'Mount Chiliad',     28, 12, 20, 18],
  ['alamo_sea',     'Alamo Sea',         48, 22, 22, 14],
  ['grapeseed',     'Grapeseed',         64, 18, 18, 14],
  ['sandy_shores',  'Sandy Shores',      68, 32, 20, 12],
  ['mount_gordo',   'Mount Gordo',       82, 8,  16, 18],
  // West
  ['north_chumash', 'North Chumash',     2,  18, 12, 20],
  ['lago_zancudo',  'Lago Zancudo',      4,  34, 16, 14],
  ['raton_canyon',  'Raton Canyon',      14, 24, 16, 12],
  ['mount_josiah',  'Mount Josiah',      24, 30, 20, 14],
  // Center
  ['grand_senora',  'Grand Senora',      44, 38, 26, 14],
  ['harmony',       'Harmony',           40, 44, 18, 12],
  ['great_chaparral','Great Chaparral',  30, 46, 18, 14],
  ['tataviam_mts',  'Tataviam Mts',      66, 48, 16, 16],
  ['palomino',      'Palomino High.',    76, 56, 16, 14],
  // Hills/Suburbs
  ['tongva_hills',  'Tongva Hills',      10, 52, 16, 12],
  ['tongva_valley', 'Tongva Valley',     16, 60, 14, 12],
  ['banham_canyon', 'Banham Canyon',     4,  58, 14, 12],
  ['vinewood_hills','Vinewood Hills',    32, 56, 22, 12],
  ['east_vinewood', 'East Vinewood',     54, 56, 14, 10],
  // City
  ['pacific_bluffs','Pacific Bluffs',    6,  68, 16, 12],
  ['richman',       'Richman',           22, 68, 14, 10],
  ['rockford_hills','Rockford Hills',    28, 72, 12, 10],
  ['vinewood',      'Vinewood',          40, 68, 14, 10],
  ['downtown',      'Downtown LS',       38, 76, 18, 12],
  ['little_seoul',  'Little Seoul',      24, 78, 14, 10],
  ['del_perro',     'Del Perro',         10, 76, 16, 10],
  ['vespucci',      'Vespucci Beach',    12, 82, 14, 10],
  ['south_ls',      'South Los Santos',  34, 84, 20, 10],
  ['east_ls',       'East Los Santos',   54, 78, 14, 12],
  // South / Airport
  ['lsia',          'LS Int. Airport',   8,  88, 22, 10],
  ['la_puerta',     'La Puerta',         30, 90, 16, 8],
  ['port_ls',       'Port of LS',        46, 90, 20, 10],
  ['elysian',       'Elysian Island',    62, 88, 14, 10],
];

// ============================================================
//  AUTH
// ============================================================
auth.onAuthStateChanged(async user => {
  if (!user) { showScreen('auth-screen'); return; }
  await loadMe(user.uid);
  initApp();
});

async function loadMe(uid) {
  const doc = await db.collection('users').doc(uid).get();
  if (!doc.exists) { auth.signOut(); return; }
  const d = doc.data();
  // Load role perms
  let roleData = { name: d.role, color: '#4ade80', perms: d.perms || {} };
  if (d.roleId && d.roleId !== 'superadmin' && d.roleId !== 'admin') {
    const rdoc = await db.collection('roles').doc(d.roleId).get();
    if (rdoc.exists) roleData = { id: d.roleId, ...rdoc.data() };
  }
  ME = { uid, pseudo: d.pseudo, role: d.role, roleId: d.roleId, roleData, perms: roleData.perms || d.perms || {}, zoneColor: d.zoneColor || '#4ade80' };
}

// Pseudo-based auth (no email needed)
async function doLogin() {
  const pseudo = document.getElementById('l-pseudo').value.trim();
  const pass   = document.getElementById('l-pass').value;
  setErr('l-err','');
  if (!pseudo || !pass) return setErr('l-err','Remplis tous les champs');
  // Find user by pseudo
  try {
    const snap = await db.collection('users').where('pseudo','==',pseudo).limit(1).get();
    if (snap.empty) return setErr('l-err','Pseudo introuvable');
    const email = snap.docs[0].data().email;
    await auth.signInWithEmailAndPassword(email, pass);
  } catch(e) { setErr('l-err', authErr(e.code)); }
}

async function doRegister() {
  const pseudo = document.getElementById('r-pseudo').value.trim();
  const pass   = document.getElementById('r-pass').value;
  const code   = document.getElementById('r-code').value.trim().toUpperCase();
  setErr('r-err','');
  if (!pseudo||!pass||!code) return setErr('r-err','Remplis tous les champs');

  const codeDoc = await db.collection('invite_codes').doc(code).get();
  if (!codeDoc.exists || codeDoc.data().used) return setErr('r-err','Code invalide ou déjà utilisé');

  try {
    const cd = codeDoc.data();
    const email = `${pseudo.toLowerCase().replace(/\s+/g,'_')}__${code}@gtatracker.local`;
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
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

function doLogout() {
  unsubs.forEach(u=>u()); unsubs=[];
  auth.signOut();
}

function switchAuthTab(t) {
  document.querySelectorAll('.atab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
  document.getElementById('atab-'+t).classList.add('active');
  document.getElementById('auth-'+t).classList.add('active');
}

// ============================================================
//  INIT APP
// ============================================================
function initApp() {
  showScreen('app-screen');
  // User chip
  document.getElementById('user-name').textContent = ME.pseudo;
  document.getElementById('user-avatar').textContent = ME.pseudo[0].toUpperCase();
  document.getElementById('user-role').textContent = ME.roleData.name || ME.role;
  // Nav visibility
  const isAdmin = ME.role === 'admin' || ME.role === 'superadmin';
  if (ME.perms.seePoints || ME.perms.signal) {
    document.getElementById('nav-points').style.display='';
    document.getElementById('mnav-points') && (document.getElementById('mnav-points').style.display='');
  }
  if (ME.perms.signal) document.getElementById('btn-add-pt') && (document.getElementById('btn-add-pt').style.display='');
  if (isAdmin) {
    document.getElementById('nav-admin').style.display='';
    document.getElementById('mnav-admin') && (document.getElementById('mnav-admin').style.display='');
  }
  if (ME.role === 'superadmin') document.getElementById('nav-sa').style.display='';
  // Layer toggles
  buildLayerToggles();
  // Subscribe data
  subscribeAll();
  // Build emoji picker
  buildEmojiPicker();
  showPage('map');
}

function buildLayerToggles() {
  const c = document.getElementById('layer-toggles');
  if (!c) return;
  const layers = [
    { id:'my-zones',    label:'Mes zones',    def:true },
    { id:'other-zones', label:'Autres',       def: ME.perms.seeOthers !== false },
    { id:'todo-zones',  label:'À faire',      def:true },
    { id:'points',      label:'Points',       def: !!ME.perms.seePoints },
  ];
  c.innerHTML = layers.map(l=>`<button class="layer-btn ${l.def?'active':''}" id="layer-${l.id}" onclick="toggleLayer('${l.id}',this)">${l.label}</button>`).join('');
}

function toggleLayer(id, btn) {
  btn.classList.toggle('active');
  renderZones();
  renderPoints();
}

function isLayerOn(id) {
  const el = document.getElementById('layer-'+id);
  return el ? el.classList.contains('active') : false;
}

// ============================================================
//  SUBSCRIPTIONS
// ============================================================
function subscribeAll() {
  unsubs.push(db.collection('zones').onSnapshot(snap => {
    ZONES = {};
    snap.forEach(d => ZONES[d.id] = d.data());
    renderZones();
    updateStats();
  }));
  unsubs.push(db.collection('users').onSnapshot(snap => {
    USERS = {};
    snap.forEach(d => USERS[d.id] = d.data());
  }));
  unsubs.push(db.collection('roles').onSnapshot(snap => {
    ROLES = {};
    snap.forEach(d => ROLES[d.id] = d.data());
  }));
  if (ME.perms.seePoints) {
    unsubs.push(db.collection('points').onSnapshot(snap => {
      POINTS = snap.docs.map(d=>({id:d.id,...d.data()}));
      renderPoints();
      renderPointsList();
    }));
  }
  // Personal notes
  unsubs.push(db.collection('personal_maps').doc(ME.uid).onSnapshot(doc => {
    MY_NOTES = doc.exists ? (doc.data().zones || {}) : {};
    renderMyMap();
  }));
}

// ============================================================
//  MAP RENDERING
// ============================================================
const IMG_W = 900;

function initMapPan() {
  setupPan('map-area', 'map-inner');
  setupPan('mymap-area', 'mymap-inner');
}

function setupPan(areaId, innerId) {
  const area = document.getElementById(areaId);
  const inner = document.getElementById(innerId);
  if (!area||!inner) return;
  let scale=1, x=0, y=0, drag=false, sx=0, sy=0;

  area.addEventListener('wheel', e=>{
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    scale = Math.min(3, Math.max(0.4, scale*delta));
    applyTransform();
  }, {passive:false});

  inner.addEventListener('mousedown', e=>{
    if (e.target.closest('.zone-cell, .pt-marker')) return;
    drag=true; sx=e.clientX-x; sy=e.clientY-y; inner.style.cursor='grabbing';
  });
  window.addEventListener('mousemove', e=>{
    if (!drag) return; x=e.clientX-sx; y=e.clientY-sy; applyTransform();
  });
  window.addEventListener('mouseup', ()=>{ drag=false; inner.style.cursor='grab'; });

  // Touch
  let lastDist=0;
  area.addEventListener('touchstart', e=>{
    if (e.touches.length===1) { drag=true; sx=e.touches[0].clientX-x; sy=e.touches[0].clientY-y; }
    else { lastDist = dist(e.touches); }
  });
  area.addEventListener('touchmove', e=>{
    e.preventDefault();
    if (e.touches.length===1 && drag) { x=e.touches[0].clientX-sx; y=e.touches[0].clientY-sy; applyTransform(); }
    else if (e.touches.length===2) {
      const d=dist(e.touches); const delta=d/lastDist;
      scale=Math.min(3,Math.max(0.4,scale*delta)); lastDist=d; applyTransform();
    }
  }, {passive:false});
  area.addEventListener('touchend', ()=>drag=false);

  function applyTransform() { inner.style.transform=`translate(${x}px,${y}px) scale(${scale})`; }
  function dist(t) { return Math.hypot(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY); }
}

function buildZoneSVG(svgId, clickFn) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  // Get map image size
  const img = svg.previousElementSibling;
  const H = img ? img.naturalHeight * (IMG_W / (img.naturalWidth||IMG_W)) : IMG_W*1.4;
  svg.setAttribute('viewBox', `0 0 ${IMG_W} ${H}`);
  svg.innerHTML = '';
  GTA_ZONES.forEach(([id, name, xp, yp, wp, hp]) => {
    const x = xp/100*IMG_W, y = yp/100*H, w = wp/100*IMG_W, h = hp/100*H;
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('class','zone-cell');
    g.dataset.zid = id; g.dataset.name = name;
    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x',x); rect.setAttribute('y',y);
    rect.setAttribute('width',w); rect.setAttribute('height',h);
    rect.setAttribute('rx','4');
    rect.setAttribute('fill','rgba(255,255,255,0.03)');
    rect.setAttribute('stroke','rgba(255,255,255,0.08)');
    rect.setAttribute('stroke-width','1');
    const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
    txt.setAttribute('x',x+w/2); txt.setAttribute('y',y+h/2);
    txt.setAttribute('text-anchor','middle'); txt.setAttribute('dominant-baseline','central');
    txt.setAttribute('font-family','Barlow Condensed,sans-serif');
    txt.setAttribute('font-size','9'); txt.setAttribute('font-weight','600');
    txt.setAttribute('fill','rgba(255,255,255,0.3)');
    txt.setAttribute('pointer-events','none');
    txt.textContent = name;
    g.appendChild(rect); g.appendChild(txt);
    g.addEventListener('click', ()=>clickFn(id, name, x, y, w, h));
    svg.appendChild(g);
  });
}

function renderZones() {
  const svg = document.getElementById('zone-svg');
  if (!svg) return;
  const img = document.getElementById('map-bg');
  if (!img.complete) { img.onload = renderZones; return; }
  if (!svg.children.length) buildZoneSVG('zone-svg', onZoneClick);

  const H = img.naturalHeight * (IMG_W/img.naturalWidth);

  GTA_ZONES.forEach(([id, name, xp, yp, wp, hp]) => {
    const g = svg.querySelector(`[data-zid="${id}"]`);
    if (!g) return;
    const rect = g.querySelector('rect');
    const zdata = ZONES[id];
    const isMine = zdata?.claimedBy?.includes(ME.uid);
    const isTodo = zdata?.todos?.includes(ME.uid);
    const others = zdata?.claimedBy?.filter(u=>u!==ME.uid) || [];
    const hasOthers = others.length > 0 && isLayerOn('other-zones');

    let fill = 'rgba(255,255,255,0.03)';
    let stroke = 'rgba(255,255,255,0.08)';
    let sw = '1';

    if (isMine && isLayerOn('my-zones')) {
      const c = ME.zoneColor || '#4ade80';
      fill = hexAlpha(c, 0.35);
      stroke = c;
      sw = '2';
    }
    if (hasOthers && !isMine) {
      fill = 'rgba(56,189,248,0.25)';
      stroke = '#38bdf8'; sw = '1.5';
    }
    if (isMine && hasOthers && isLayerOn('my-zones')) {
      fill = 'rgba(245,197,24,0.25)';
      stroke = '#f5c518'; sw = '2';
    }
    if (isTodo && isLayerOn('todo-zones')) {
      fill = 'rgba(251,146,60,0.3)';
      stroke = '#fb923c'; sw = '2';
    }

    rect.setAttribute('fill', fill);
    rect.setAttribute('stroke', stroke);
    rect.setAttribute('stroke-width', sw);
  });
}

function renderMyMap() {
  const svg = document.getElementById('myzone-svg');
  if (!svg) return;
  const img = document.querySelector('#mymap-inner img');
  if (!img || !img.complete) { if(img) img.onload = renderMyMap; return; }
  if (!svg.children.length) buildZoneSVG('myzone-svg', onMyZoneClick);

  GTA_ZONES.forEach(([id]) => {
    const g = svg.querySelector(`[data-zid="${id}"]`);
    if (!g) return;
    const rect = g.querySelector('rect');
    const note = MY_NOTES[id];
    if (note) {
      rect.setAttribute('fill', hexAlpha(note.color || ME.zoneColor, 0.4));
      rect.setAttribute('stroke', note.color || ME.zoneColor);
      rect.setAttribute('stroke-width','2');
    } else {
      rect.setAttribute('fill','rgba(255,255,255,0.03)');
      rect.setAttribute('stroke','rgba(255,255,255,0.08)');
      rect.setAttribute('stroke-width','1');
    }
  });

  // Personal points
  const layer = document.getElementById('mypoints-layer');
  if (!layer) return;
  layer.innerHTML = '';
  const H = img.naturalHeight*(IMG_W/img.naturalWidth);
  Object.entries(MY_NOTES).forEach(([zid, note]) => {
    if (!note.markers) return;
    note.markers.forEach(m => {
      const el = document.createElement('div');
      el.className = 'pt-marker';
      el.textContent = m.emoji || '📌';
      el.style.left = m.x + 'px';
      el.style.top  = m.y + 'px';
      el.title = m.label || '';
      layer.appendChild(el);
    });
  });
}

function renderPoints() {
  const layer = document.getElementById('points-layer');
  if (!layer) return;
  layer.innerHTML = '';
  if (!isLayerOn('points')) return;
  const img = document.getElementById('map-bg');
  if (!img || !img.complete) return;
  const H = img.naturalHeight*(IMG_W/img.naturalWidth);

  POINTS.forEach(pt => {
    const zone = GTA_ZONES.find(z=>z[1]===pt.zone || z[0]===pt.zoneId);
    if (!zone) return;
    const [,, xp, yp, wp, hp] = zone;
    const cx = (xp + wp/2)/100*IMG_W;
    const cy = (yp + hp/2)/100*H;
    const el = document.createElement('div');
    el.className = 'pt-marker';
    el.textContent = pt.emoji || '📍';
    el.style.left = cx + 'px';
    el.style.top  = cy + 'px';
    el.title = pt.name;
    el.addEventListener('click', e=>{ e.stopPropagation(); openPointDetail(pt); });
    layer.appendChild(el);
  });
}

function updateStats() {
  const el = document.getElementById('map-stats');
  if (!el) return;
  const mine = Object.values(ZONES).filter(z=>z.claimedBy?.includes(ME.uid)).length;
  el.textContent = `${mine} / ${GTA_ZONES.length} zones explorées`;
}

// ============================================================
//  ZONE CLICK
// ============================================================
function onZoneClick(id, name) {
  const zdata = ZONES[id] || {};
  const isMine = zdata.claimedBy?.includes(ME.uid);
  const isTodo = zdata.todos?.includes(ME.uid);
  const others = (zdata.claimedBy||[]).filter(u=>u!==ME.uid);

  let body = `<div class="zone-modal-info">Zone : <strong>${name}</strong></div>`;

  // Other players
  if (others.length && ME.perms.seeOthers !== false) {
    body += `<div class="zone-players">`;
    others.forEach(uid => {
      const u = USERS[uid];
      if (!u) return;
      const c = u.zoneColor || '#4ade80';
      body += `<div class="zp-row"><span class="zp-swatch" style="background:${c}"></span>${escH(u.pseudo)}</div>`;
    });
    body += `</div>`;
  }

  body += `<div class="zone-actions">`;
  if (ME.perms.zones !== false) {
    body += `<button class="btn-zone ${isMine?'active':''}" onclick="toggleZone('${id}',${isMine})">${isMine?'✓ Retirer de mes zones':'+ Marquer comme explorée'}</button>`;
  }
  // Admin can mark as todo
  if (ME.role==='admin'||ME.role==='superadmin') {
    body += `<button class="btn-zone todo" onclick="toggleTodo('${id}',${isTodo})">${isTodo?'✓ Retirer "à faire"':'📌 Marquer "à rechercher"'}</button>`;
  }
  body += `</div>`;

  document.getElementById('mz-title').textContent = name;
  document.getElementById('mz-body').innerHTML = body;
  openModal('modal-zone');
}

async function toggleZone(id, isMine) {
  closeModal('modal-zone');
  const ref = db.collection('zones').doc(id);
  if (isMine) {
    await ref.update({ claimedBy: firebase.firestore.FieldValue.arrayRemove(ME.uid) });
    toast('Zone retirée');
  } else {
    await ref.set({ claimedBy: firebase.firestore.FieldValue.arrayUnion(ME.uid) }, {merge:true});
    toast('Zone marquée ✓');
  }
}

async function toggleTodo(id, isTodo) {
  closeModal('modal-zone');
  const ref = db.collection('zones').doc(id);
  if (isTodo) {
    await ref.update({ todos: firebase.firestore.FieldValue.arrayRemove(ME.uid) });
    toast('Retiré de "à faire"');
  } else {
    await ref.set({ todos: firebase.firestore.FieldValue.arrayUnion(ME.uid) }, {merge:true});
    toast('Zone assignée "à faire" 📌');
  }
}

// My map zone click
function onMyZoneClick(id, name) {
  const note = MY_NOTES[id] || {};
  let body = `
    <div class="field"><label>Note personnelle</label>
      <textarea id="my-note-text" placeholder="Notes, indices, coordonnées...">${escH(note.text||'')}</textarea>
    </div>
    <div class="field"><label>Couleur</label>
      <input type="color" id="my-note-color" value="${note.color||ME.zoneColor||'#4ade80'}">
    </div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="btn-gold" style="flex:1" onclick="saveMyNote('${id}')">Sauvegarder</button>
      <button class="btn-ghost" style="width:auto" onclick="clearMyNote('${id}')">Effacer</button>
    </div>`;
  document.getElementById('mz-title').textContent = name + ' — Ma carte';
  document.getElementById('mz-body').innerHTML = body;
  openModal('modal-zone');
}

async function saveMyNote(zid) {
  const text  = document.getElementById('my-note-text').value;
  const color = document.getElementById('my-note-color').value;
  const ref = db.collection('personal_maps').doc(ME.uid);
  await ref.set({ zones: { [zid]: { text, color } } }, {merge:true});
  closeModal('modal-zone');
  toast('Note sauvegardée');
}

async function clearMyNote(zid) {
  const ref = db.collection('personal_maps').doc(ME.uid);
  await ref.update({ [`zones.${zid}`]: firebase.firestore.FieldValue.delete() });
  closeModal('modal-zone');
  toast('Note effacée');
}

// ============================================================
//  POINTS
// ============================================================
function buildEmojiPicker() {
  const c = document.getElementById('emoji-picker');
  if (!c) return;
  c.innerHTML = EMOJIS.map((e,i)=>
    `<button class="ep-btn ${i===0?'selected':''}" onclick="selectEmoji('${e}',this)">${e}</button>`
  ).join('');
}

function selectEmoji(e, btn) {
  document.querySelectorAll('.ep-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('pt-emoji').value = e;
}

function openAddPoint() { openModal('modal-add-point'); }

async function submitPoint() {
  const name  = document.getElementById('pt-name').value.trim();
  const zone  = document.getElementById('pt-zone').value.trim();
  const desc  = document.getElementById('pt-desc').value.trim();
  const type  = document.getElementById('pt-type').value;
  const emoji = document.getElementById('pt-emoji').value;
  const img   = document.getElementById('pt-img').value.trim();
  if (!name||!zone) return toast('Nom et zone requis');
  await db.collection('points').add({ name, zone, description:desc, type, emoji, imageUrl:img, reportedBy:ME.uid, reportedByName:ME.pseudo, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
  closeModal('modal-add-point');
  toast('Point signalé ! ' + emoji);
  ['pt-name','pt-zone','pt-desc','pt-img'].forEach(id=>document.getElementById(id).value='');
}

function openPointDetail(pt) {
  let body = '';
  if (pt.imageUrl) body += `<img src="${escH(pt.imageUrl)}" class="modal-img" alt="">`;
  body += `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <span style="font-size:28px">${pt.emoji||'📍'}</span>
      <div><div class="pt-card-name">${escH(pt.name)}</div><div class="pt-card-zone">Zone : ${escH(pt.zone)}</div></div>
    </div>
    ${pt.description?`<p style="font-size:14px;color:var(--text-dim);line-height:1.6">${escH(pt.description)}</p>`:''}
    <div style="font-size:12px;color:var(--text-muted);margin-top:10px">Signalé par ${escH(pt.reportedByName||'?')}</div>`;
  document.getElementById('mpd-title').textContent = pt.name;
  document.getElementById('mpd-body').innerHTML = body;
  openModal('modal-point-detail');
}

function filterPoints(type, btn) {
  currentFilter = type;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderPointsList();
}

function renderPointsList() {
  const grid = document.getElementById('points-grid');
  if (!grid) return;
  const list = currentFilter==='all' ? POINTS : POINTS.filter(p=>p.type===currentFilter);
  if (!list.length) { grid.innerHTML = '<div class="empty">Aucun point signalé</div>'; return; }
  grid.innerHTML = list.map(pt=>`
    <div class="pt-card" onclick="openPointDetail(${JSON.stringify(pt).replace(/"/g,'&quot;')})">
      <div class="pt-card-top">
        <span class="pt-card-emoji">${pt.emoji||'📍'}</span>
        <span class="pt-card-type type-${pt.type}">${pt.type.replace('_',' ')}</span>
      </div>
      <div class="pt-card-name">${escH(pt.name)}</div>
      <div class="pt-card-zone">📍 ${escH(pt.zone)}</div>
      ${pt.description?`<div class="pt-card-desc">${escH(pt.description)}</div>`:''}
    </div>`).join('');
}

// ============================================================
//  ADMIN
// ============================================================
async function loadAdminData() {
  // Load roles for select
  const rsnap = await db.collection('roles').get();
  ROLES = {};
  rsnap.forEach(d=>ROLES[d.id]=d.data());
  const sel = document.getElementById('a-role-select');
  if (sel) {
    sel.innerHTML = '<option value="user">Utilisateur (défaut)</option>' +
      Object.entries(ROLES).map(([id,r])=>`<option value="${id}">${escH(r.name)}</option>`).join('');
  }
  // Load users
  const usnap = await db.collection('users').get();
  USERS={};
  usnap.forEach(d=>USERS[d.id]=d.data());
  renderUsersList('users-list', Object.values(USERS).filter(u=>u.role==='user'));
  renderRolesList();
  // Admin zone user select
  const azSel = document.getElementById('admin-zone-user');
  if (azSel) {
    azSel.innerHTML = Object.values(USERS).filter(u=>u.role==='user').map(u=>`<option value="${u.uid}">${escH(u.pseudo)}</option>`).join('');
    azSel.onchange = () => {
      const u = USERS[azSel.value];
      if (u) document.getElementById('admin-zone-color').value = u.zoneColor||'#4ade80';
    };
  }
}

async function updateUserZoneColor(color) {
  const sel = document.getElementById('admin-zone-user');
  if (!sel||!sel.value) return;
  await db.collection('users').doc(sel.value).update({ zoneColor: color });
  toast('Couleur mise à jour');
}

async function adminCreateUser() {
  const pseudo = document.getElementById('a-pseudo').value.trim();
  const pass   = document.getElementById('a-pass').value;
  const roleId = document.getElementById('a-role-select').value;
  const color  = document.getElementById('a-color').value;
  setErr('a-err','');
  if (!pseudo||!pass) return setErr('a-err','Pseudo et mot de passe requis');

  let perms = {};
  if (roleId==='user') perms = {zones:true,seeOthers:true,signal:true,seePoints:true};
  else if (ROLES[roleId]) perms = ROLES[roleId].perms||{};

  const code = genCode();
  await db.collection('invite_codes').doc(code).set({
    pseudo, perms, role:'user', roleId, zoneColor:color,
    createdBy:ME.uid, used:false,
    createdAt:firebase.firestore.FieldValue.serverTimestamp()
  });
  const res = document.getElementById('a-code-result');
  res.classList.remove('hidden');
  res.innerHTML = `Code d'invitation pour <strong>${escH(pseudo)}</strong> :<div class="code-value">${code}</div>Donnez ce code à ${escH(pseudo)} pour s'inscrire.`;
}

async function createRole() {
  const name  = document.getElementById('role-name').value.trim();
  const color = document.getElementById('role-color').value;
  if (!name) return toast('Nom du rôle requis');
  const perms = {
    zones:     document.getElementById('rp-zones').checked,
    seeOthers: document.getElementById('rp-see-others').checked,
    signal:    document.getElementById('rp-signal').checked,
    seePoints: document.getElementById('rp-see-points').checked,
    mymap:     document.getElementById('rp-mymap').checked,
  };
  await db.collection('roles').add({ name, color, perms, createdBy:ME.uid });
  toast('Rôle créé : ' + name);
  loadAdminData();
}

function renderUsersList(containerId, users) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!users.length) { el.innerHTML='<div class="empty">Aucun utilisateur</div>'; return; }
  el.innerHTML = `<div class="users-list">${users.map(u=>{
    const rc = u.zoneColor||'#4ade80';
    return `<div class="user-row">
      <div class="user-avatar" style="border-color:${rc};color:${rc}">${(u.pseudo||'?')[0].toUpperCase()}</div>
      <div class="user-row-info">
        <div class="user-row-name">${escH(u.pseudo)}</div>
        <div class="user-row-sub">${escH(u.roleId||u.role||'user')}</div>
      </div>
      <div class="perm-dots">
        <div class="pdot ${u.perms?.zones?'on':''}" title="Zones"></div>
        <div class="pdot ${u.perms?.seeOthers?'on':''}" title="Voir autres"></div>
        <div class="pdot ${u.perms?.signal?'on':''}" title="Signaler"></div>
        <div class="pdot ${u.perms?.seePoints?'on':''}" title="Voir points"></div>
      </div>
      ${ME.role==='superadmin'?`<button class="btn-sm" onclick="deleteUser('${u.uid}')">Suppr.</button>`:''}
    </div>`;
  }).join('')}</div>`;
}

function renderRolesList() {
  const el = document.getElementById('roles-list');
  if (!el) return;
  const entries = Object.entries(ROLES);
  if (!entries.length) { el.innerHTML='<div class="empty">Aucun rôle créé</div>'; return; }
  el.innerHTML = `<div class="roles-list">${entries.map(([id,r])=>`
    <div class="role-row">
      <div class="role-swatch" style="background:${r.color}"></div>
      <div class="role-row-name">${escH(r.name)}</div>
      <div class="role-perms-list">${Object.entries(r.perms||{}).filter(([,v])=>v).map(([k])=>k).join(' · ')}</div>
      <button class="btn-sm" onclick="deleteRole('${id}')">✕</button>
    </div>`).join('')}</div>`;
}

async function deleteRole(id) {
  if (!confirm('Supprimer ce rôle ?')) return;
  await db.collection('roles').doc(id).delete();
  toast('Rôle supprimé');
  loadAdminData();
}

async function deleteUser(uid) {
  if (!confirm('Supprimer cet utilisateur ?')) return;
  await db.collection('users').doc(uid).delete();
  toast('Utilisateur supprimé');
  loadAdminData();
}

function showAdminTab(t) {
  document.querySelectorAll('.ptab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.atab-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('atab-'+t).classList.add('active');
  event.target.classList.add('active');
}

// ============================================================
//  SUPER ADMIN
// ============================================================
async function saCreateAdmin() {
  const pseudo = document.getElementById('sa-pseudo').value.trim();
  const pass   = document.getElementById('sa-pass').value;
  setErr('sa-err','');
  if (!pseudo||!pass) return setErr('sa-err','Pseudo et mot de passe requis');
  const code = genCode();
  await db.collection('invite_codes').doc(code).set({
    pseudo, perms:{zones:true,seeOthers:true,signal:true,seePoints:true,mymap:true},
    role:'admin', roleId:'admin', zoneColor:'#f5c518',
    createdBy:ME.uid, used:false,
    createdAt:firebase.firestore.FieldValue.serverTimestamp()
  });
  const res = document.getElementById('sa-code-result');
  res.classList.remove('hidden');
  res.innerHTML = `Code admin pour <strong>${escH(pseudo)}</strong> :<div class="code-value">${code}</div>`;
}

async function loadSuperAdmin() {
  const usnap = await db.collection('users').get();
  USERS={};
  usnap.forEach(d=>USERS[d.id]=d.data());
  renderUsersList('all-users-list', Object.values(USERS));
}

// ============================================================
//  NAVIGATION
// ============================================================
function showPage(page) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.snav').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.mnav').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  document.querySelector(`.snav[data-page="${page}"]`)?.classList.add('active');
  document.querySelector(`.mnav[data-page="${page}"]`)?.classList.add('active');

  if (page==='map'||page==='mymap') {
    setTimeout(()=>{
      initMapPan();
      const img = document.getElementById('map-bg');
      if (img?.complete) { renderZones(); renderPoints(); }
      else if (img) img.onload=()=>{ renderZones(); renderPoints(); buildZoneSVG('zone-svg',onZoneClick); };
      renderMyMap();
    },50);
  }
  if (page==='admin') loadAdminData();
  if (page==='superadmin') loadSuperAdmin();
  if (page==='points') renderPointsList();
}

function toggleLegend() { document.getElementById('map-legend').classList.toggle('hidden'); }
function toggleMyLegend() { document.getElementById('map-legend')?.classList.toggle('hidden'); }

// ============================================================
//  MODALS
// ============================================================
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
// Click outside to close
document.querySelectorAll('.modal-overlay').forEach(el=>{
  el.addEventListener('click', e=>{ if(e.target===el) el.classList.add('hidden'); });
});

// ============================================================
//  UTILS
// ============================================================
function showScreen(id) { document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function toast(msg) { const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000); }
function setErr(id,msg) { const el=document.getElementById(id); if(el) el.textContent=msg; }
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function genCode() { const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<8;i++) s+=c[Math.floor(Math.random()*c.length)]; return s; }
function hexAlpha(hex, a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
function authErr(code) {
  return ({
    'auth/user-not-found':'Pseudo introuvable','auth/wrong-password':'Mot de passe incorrect',
    'auth/email-already-in-use':'Pseudo déjà utilisé','auth/weak-password':'Mot de passe trop court',
  })[code]||'Erreur : '+code;
}

// Init map on load
window.addEventListener('load', ()=>{
  const img = document.getElementById('map-bg');
  if (img) img.onload = ()=>{ renderZones(); renderPoints(); };
});
