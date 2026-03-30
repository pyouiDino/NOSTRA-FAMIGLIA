// ============================================================
//  GTA V Zone Tracker — app.js
// ============================================================

const db   = firebase.firestore();
const auth = firebase.auth();

// ---- State ----
let currentUser   = null;
let currentRole   = 'user'; // 'superadmin' | 'admin' | 'user'
let currentPerms  = {};
let allZones      = {};    // { zoneId: { mine, others: [uid], hasPoint } }
let allUsers      = [];
let allPoints     = [];
let selectedZone  = null;
let mapUnsubscribers = [];

// ---- Zone grid definition (GTA 5 zones 10x10) ----
const ZONE_NAMES = [
  // Row 0 (Nord)
  "Paleto Bay N","Paleto Forest N","Paleto Forest NE","Raton Canyon","Grapeseed N","Mount Chiliad","Alamo Sea N","Sandy Shores N","Sandy Shores NE","Grand Senora Desert N",
  // Row 1
  "Paleto Bay","Paleto Bay E","Paleto Forest","Alamo Sea NO","Grapeseed","Alamo Sea NE","Sandy Shores O","Sandy Shores","Sandy Shores E","Grand Senora Desert",
  // Row 2
  "Banham Canyon N","Great Chaparral N","Tongva Hills N","Vinewood Hills N","East Vinewood Hills","Tataviam Mts N","Tataviam Mts","Tataviam Mts E","El Burro Heights","Elysian Island N",
  // Row 3
  "Banham Canyon","Great Chaparral","Tongva Valley","Vinewood Hills","Rockford Hills","Tataviam Mts S","La Mesa N","La Mesa","El Burro Heights S","Terminal",
  // Row 4
  "Chumash","Pacific Bluffs N","Pacific Bluffs","Richman","Vinewood","Downtown Vinewood","LSIA N","La Mesa S","LSIA","Port of LS N",
  // Row 5
  "Pacific Bluffs S","West Vinewood","Morningwood","Little Seoul","Chamberlain Hills","Strawberry","Chamberlain N","Rancho","LSIA S","Port of LS",
  // Row 6
  "Vespucci Beach N","Vespucci Canals","Vespucci","Textile City","Davis","Forum Drive","Rancho S","Cypress Flats","LSIA Far","Port of LS S",
  // Row 7
  "Del Perro Beach","Del Perro","LSIA O","La Puerta","Banning","La Puerta S","Cypress Flats S","Elysian Island","Elysian Isl E","Elysian Isl SE",
  // Row 8
  "Del Perro Pier","Vespucci Pier","Maze Bank Arena","Burton","Pillbox Hill","Pillbox E","Alta","Mirror Park","Murrieta Heights","East Los Santos",
  // Row 9 (Sud)
  "Ocean O","Ocean S","La Mesa Far","Downtown LS","LSCM","Little Seoul S","Textile Far","East LS S","Harmony","Grand Senora Desert S"
];

// ============================================================
//  AUTH
// ============================================================

auth.onAuthStateChanged(async user => {
  if (user) {
    currentUser = user;
    await loadUserProfile(user.uid);
    initApp();
  } else {
    currentUser = null;
    showScreen('auth-screen');
  }
});

async function loadUserProfile(uid) {
  const doc = await db.collection('users').doc(uid).get();
  if (doc.exists) {
    const data = doc.data();
    currentRole  = data.role  || 'user';
    currentPerms = data.perms || defaultPerms();
  } else {
    // Super admin check
    if (currentUser.email === SUPER_ADMIN_EMAIL) {
      currentRole  = 'superadmin';
      currentPerms = { zones: true, seeOthers: true, signal: true, seePoints: true };
      await db.collection('users').doc(uid).set({
        uid, email: currentUser.email,
        name: 'Super Admin',
        role: 'superadmin',
        perms: currentPerms,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }
}

function defaultPerms() {
  return { zones: false, seeOthers: false, signal: false, seePoints: false };
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;
  clearError('login-error');
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch(e) {
    showError('login-error', translateAuthError(e.code));
  }
}

async function doRegister() {
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-password').value;
  const code  = document.getElementById('reg-code').value.trim();
  clearError('reg-error');

  if (!name || !email || !pass || !code) {
    return showError('reg-error', 'Tous les champs sont obligatoires');
  }

  // Check invite code
  const codeDoc = await db.collection('invite_codes').doc(code).get();
  if (!codeDoc.exists || codeDoc.data().used) {
    return showError('reg-error', 'Code d\'invitation invalide ou déjà utilisé');
  }

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    const codeData = codeDoc.data();
    await db.collection('users').doc(cred.user.uid).set({
      uid: cred.user.uid,
      email, name,
      role: 'user',
      perms: codeData.perms || defaultPerms(),
      createdBy: codeData.createdBy || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Mark code used
    await db.collection('invite_codes').doc(code).update({ used: true, usedBy: cred.user.uid });
  } catch(e) {
    showError('reg-error', translateAuthError(e.code));
  }
}

function doLogout() {
  mapUnsubscribers.forEach(u => u());
  mapUnsubscribers = [];
  auth.signOut();
}

// ============================================================
//  APP INIT
// ============================================================

function initApp() {
  showScreen('app-screen');

  // User badge
  const name = getUserName();
  document.getElementById('user-badge').textContent = currentRole.toUpperCase() + ' — ' + name;

  // Nav visibility
  if (currentRole === 'admin' || currentRole === 'superadmin') {
    document.getElementById('nav-admin').style.display = '';
  }
  if (currentRole === 'superadmin') {
    document.getElementById('nav-superadmin').style.display = '';
  }
  if (currentPerms.seePoints || currentPerms.signal) {
    document.getElementById('nav-points').style.display = '';
  }
  if (currentPerms.signal) {
    document.getElementById('btn-add-point').style.display = '';
  }

  // Register tab visible to nobody (admin creates users)
  // Only show it if we want open registration (disabled by default)

  buildMap();
  showPage('map');
}

function getUserName() {
  return currentUser.displayName || currentUser.email.split('@')[0];
}

// ============================================================
//  MAP
// ============================================================

const COLS = 10, ROWS = 10;
const CELL_W = 95, CELL_H = 95, PADDING = 2.5;

function buildMap() {
  const svg = document.getElementById('gta-map');
  // Clear previous zone elements (keep defs and bg)
  svg.querySelectorAll('.zone-cell').forEach(e => e.remove());

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx  = r * COLS + c;
      const zid  = `z_${r}_${c}`;
      const name = ZONE_NAMES[idx] || `Zone ${idx}`;

      const x = c * CELL_W + PADDING;
      const y = r * CELL_H + PADDING;
      const w = CELL_W - PADDING * 2;
      const h = CELL_H - PADDING * 2;

      const g = document.createElementNS('http://www.w3.org/2000/svg','g');
      g.setAttribute('class','zone-cell');
      g.setAttribute('id','zone-'+zid);
      g.dataset.zid = zid;
      g.dataset.name = name;

      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x', x); rect.setAttribute('y', y);
      rect.setAttribute('width', w); rect.setAttribute('height', h);
      rect.setAttribute('rx','3');
      rect.setAttribute('fill','rgba(255,255,255,0.02)');
      rect.setAttribute('stroke','rgba(245,197,24,0.08)');
      rect.setAttribute('stroke-width','0.5');

      const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
      txt.setAttribute('x', x + w/2); txt.setAttribute('y', y + h/2);
      txt.setAttribute('text-anchor','middle'); txt.setAttribute('dominant-baseline','central');
      txt.setAttribute('font-family','Rajdhani,sans-serif');
      txt.setAttribute('font-size','8'); txt.setAttribute('font-weight','500');
      txt.setAttribute('fill','rgba(212,224,212,0.5)');
      txt.setAttribute('pointer-events','none');
      txt.textContent = name;

      // Point indicator dot
      const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
      dot.setAttribute('cx', x + w - 8); dot.setAttribute('cy', y + 8);
      dot.setAttribute('r','4');
      dot.setAttribute('fill','#e63946');
      dot.setAttribute('opacity','0');
      dot.setAttribute('pointer-events','none');
      dot.classList.add('point-dot');

      g.appendChild(rect); g.appendChild(txt); g.appendChild(dot);

      if (currentPerms.zones) {
        g.addEventListener('click', () => onZoneClick(zid, name));
        g.style.cursor = 'pointer';
      } else {
        g.style.cursor = 'default';
      }

      svg.appendChild(g);
    }
  }

  subscribeZones();
}

function subscribeZones() {
  // Unsubscribe previous
  mapUnsubscribers.forEach(u => u()); mapUnsubscribers = [];

  // Listen to zones collection
  const unsub = db.collection('zones').onSnapshot(snap => {
    allZones = {};
    snap.forEach(doc => { allZones[doc.id] = doc.data(); });
    renderZones();
  });
  mapUnsubscribers.push(unsub);

  // Listen to points to show dots
  if (currentPerms.seePoints) {
    const unsub2 = db.collection('points').onSnapshot(snap => {
      allPoints = snap.docs.map(d => ({id: d.id, ...d.data()}));
      renderPointDots();
      renderPointsList();
    });
    mapUnsubscribers.push(unsub2);
  }
}

function renderZones() {
  const uid = currentUser.uid;
  let myCount = 0, totalZones = 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const zid = `z_${r}_${c}`;
      const g = document.getElementById('zone-'+zid);
      if (!g) continue;
      const rect = g.querySelector('rect');
      const zdata = allZones[zid];

      g.classList.remove('mine','others','both');

      if (zdata) {
        const isMine   = zdata.claimedBy && zdata.claimedBy.includes(uid);
        const hasOthers = currentPerms.seeOthers && zdata.claimedBy && zdata.claimedBy.some(u => u !== uid);

        if (isMine && hasOthers) { g.classList.add('both'); totalZones++; if(isMine) myCount++; }
        else if (isMine)         { g.classList.add('mine'); totalZones++; myCount++; }
        else if (hasOthers)      { g.classList.add('others'); totalZones++; }
      }
    }
  }

  document.getElementById('zone-count').textContent =
    `${myCount} zones explorées par moi · ${totalZones} au total`;
}

function renderPointDots() {
  // Reset all
  document.querySelectorAll('.point-dot').forEach(d => d.setAttribute('opacity','0'));
  allPoints.forEach(pt => {
    // Find zone cell by name
    const idx = ZONE_NAMES.indexOf(pt.zone);
    if (idx < 0) return;
    const r = Math.floor(idx / COLS), c = idx % COLS;
    const zid = `z_${r}_${c}`;
    const g = document.getElementById('zone-'+zid);
    if (g) { const dot = g.querySelector('.point-dot'); if(dot) dot.setAttribute('opacity','1'); }
  });
}

function onZoneClick(zid, name) {
  selectedZone = { zid, name };
  const panel = document.getElementById('zone-panel');
  document.getElementById('zp-name').textContent = name;

  const zdata = allZones[zid];
  const uid = currentUser.uid;
  const isMine = zdata && zdata.claimedBy && zdata.claimedBy.includes(uid);

  // Status
  const st = document.getElementById('zp-status');
  st.textContent = isMine ? '✓ EXPLORÉE PAR VOUS' : '○ NON EXPLORÉE';
  st.style.color = isMine ? '#4ade80' : '#7a8f7a';

  // Other players
  if (currentPerms.seeOthers && zdata && zdata.claimedBy) {
    const others = zdata.claimedBy.filter(u => u !== uid);
    document.getElementById('zp-players').textContent =
      others.length > 0
        ? `Aussi explorée par ${others.length} autre(s) joueur(s)`
        : 'Personne d\'autre n\'a exploré cette zone';
  } else {
    document.getElementById('zp-players').textContent = '';
  }

  // Actions
  const actions = document.getElementById('zp-actions');
  actions.innerHTML = '';
  if (currentPerms.zones) {
    const btn = document.createElement('button');
    btn.className = 'btn-zone' + (isMine ? ' active-btn' : '');
    btn.textContent = isMine ? '✓ RETIRER DE MES ZONES' : '+ MARQUER COMME EXPLORÉE';
    btn.onclick = () => toggleZone(zid, isMine);
    actions.appendChild(btn);
  }

  panel.classList.remove('hidden');
}

async function toggleZone(zid, isMine) {
  const uid = currentUser.uid;
  const ref = db.collection('zones').doc(zid);
  if (isMine) {
    await ref.update({ claimedBy: firebase.firestore.FieldValue.arrayRemove(uid) });
    showToast('Zone retirée');
  } else {
    await ref.set({ claimedBy: firebase.firestore.FieldValue.arrayUnion(uid) }, { merge: true });
    showToast('Zone marquée comme explorée !');
  }
  // Re-open panel to refresh
  if (selectedZone) onZoneClick(selectedZone.zid, selectedZone.name);
}

function closeZonePanel() {
  document.getElementById('zone-panel').classList.add('hidden');
  selectedZone = null;
}

// ============================================================
//  POINTS
// ============================================================

function renderPointsList() {
  const list = document.getElementById('points-list');
  if (!list) return;
  if (allPoints.length === 0) {
    list.innerHTML = '<div class="empty-state">AUCUN POINT SIGNALÉ POUR L\'INSTANT</div>';
    return;
  }
  list.innerHTML = allPoints.map(pt => `
    <div class="point-card">
      <div class="point-card-left">
        <div class="point-card-name">${escHtml(pt.name)}</div>
        <div class="point-card-meta">Zone : ${escHtml(pt.zone)} · Signalé par ${escHtml(pt.reportedByName || '?')}</div>
        ${pt.description ? `<div class="point-card-desc">${escHtml(pt.description)}</div>` : ''}
      </div>
      <span class="point-type-badge type-${pt.type}">${escHtml(pt.type)}</span>
    </div>
  `).join('');
}

function openAddPoint() {
  document.getElementById('modal-point').classList.remove('hidden');
}

function closeAddPoint() {
  document.getElementById('modal-point').classList.add('hidden');
}

async function submitPoint() {
  const name = document.getElementById('pt-name').value.trim();
  const zone = document.getElementById('pt-zone').value.trim();
  const desc = document.getElementById('pt-desc').value.trim();
  const type = document.getElementById('pt-type').value;
  if (!name || !zone) return showToast('Nom et zone requis');

  await db.collection('points').add({
    name, zone, description: desc, type,
    reportedBy: currentUser.uid,
    reportedByName: getUserName(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  showToast('Point signalé avec succès !');
  closeAddPoint();
  document.getElementById('pt-name').value = '';
  document.getElementById('pt-zone').value = '';
  document.getElementById('pt-desc').value = '';
}

// ============================================================
//  ADMIN — CREATE USER
// ============================================================

async function adminCreateUser() {
  const name  = document.getElementById('a-name').value.trim();
  const email = document.getElementById('a-email').value.trim();
  const pass  = document.getElementById('a-pass').value;
  clearError('admin-create-error');

  if (!name || !email || !pass) return showError('admin-create-error', 'Tous les champs sont obligatoires');

  const perms = {
    zones:      document.getElementById('p-zones').checked,
    seeOthers:  document.getElementById('p-see-others').checked,
    signal:     document.getElementById('p-signal').checked,
    seePoints:  document.getElementById('p-see-points').checked
  };

  // Generate invite code
  const code = generateCode();
  await db.collection('invite_codes').doc(code).set({
    perms,
    createdBy: currentUser.uid,
    used: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  showToast(`Code d'invitation généré : ${code}`);
  showError('admin-create-error', `✓ Code créé : ${code}  — donnez-le à "${name}" pour qu'il s'inscrive`);
  document.getElementById('a-name').value = '';
  document.getElementById('a-email').value = '';
  document.getElementById('a-pass').value = '';
  loadAllUsers();
}

// ============================================================
//  SUPER ADMIN — CREATE ADMIN
// ============================================================

async function superAdminCreateAdmin() {
  const name  = document.getElementById('sa-name').value.trim();
  const email = document.getElementById('sa-email').value.trim();
  const pass  = document.getElementById('sa-pass').value;
  clearError('sa-create-error');

  if (!name || !email || !pass) return showError('sa-create-error', 'Tous les champs obligatoires');

  const code = generateCode();
  await db.collection('invite_codes').doc(code).set({
    perms: { zones: true, seeOthers: true, signal: true, seePoints: true },
    role: 'admin',
    createdBy: currentUser.uid,
    used: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  showToast(`Code admin généré : ${code}`);
  showError('sa-create-error', `✓ Code admin créé : ${code}  — donnez-le à "${name}"`);
  document.getElementById('sa-name').value = '';
  document.getElementById('sa-email').value = '';
  document.getElementById('sa-pass').value = '';
  loadAllUsers();
}

// ============================================================
//  LOAD USERS
// ============================================================

async function loadAllUsers() {
  const snap = await db.collection('users').get();
  allUsers = snap.docs.map(d => d.data());
  renderUsersList('users-list',    allUsers.filter(u => u.role === 'user'));
  renderUsersList('all-users-list', allUsers);
}

function renderUsersList(containerId, users) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!users.length) { el.innerHTML = '<div class="empty-state">AUCUN UTILISATEUR</div>'; return; }

  el.innerHTML = users.map(u => `
    <div class="user-row">
      <div class="user-row-info">
        <div class="user-row-name">${escHtml(u.name || '?')}</div>
        <div class="user-row-email">${escHtml(u.email || '')}</div>
      </div>
      <div class="user-perms">
        <span class="perm-badge ${u.perms?.zones     ?'on':''}">zones</span>
        <span class="perm-badge ${u.perms?.seeOthers ?'on':''}">voir autres</span>
        <span class="perm-badge ${u.perms?.signal    ?'on':''}">signaler</span>
        <span class="perm-badge ${u.perms?.seePoints ?'on':''}">voir points</span>
      </div>
      <span class="role-badge role-${u.role}">${u.role.toUpperCase()}</span>
      ${(currentRole === 'superadmin' && u.role !== 'superadmin') ? `<button class="btn-delete" onclick="deleteUser('${u.uid}')">SUPPRIMER</button>` : ''}
    </div>
  `).join('');
}

async function deleteUser(uid) {
  if (!confirm('Supprimer cet utilisateur ?')) return;
  await db.collection('users').doc(uid).delete();
  showToast('Utilisateur supprimé');
  loadAllUsers();
}

// ============================================================
//  NAVIGATION
// ============================================================

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  document.querySelector(`[onclick="showPage('${page}')"]`)?.classList.add('active');

  if (page === 'admin' || page === 'superadmin') loadAllUsers();
  if (page === 'points') renderPointsList();
}

function showTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  document.querySelector(`[onclick="showTab('${tab}')"]`)?.classList.add('active');
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ============================================================
//  UTILS
// ============================================================

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function clearError(id) {
  const el = document.getElementById(id);
  if (el) el.textContent = '';
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function translateAuthError(code) {
  const map = {
    'auth/user-not-found':     'Compte introuvable',
    'auth/wrong-password':     'Mot de passe incorrect',
    'auth/email-already-in-use': 'Email déjà utilisé',
    'auth/weak-password':      'Mot de passe trop court (min. 6 caractères)',
    'auth/invalid-email':      'Email invalide',
    'auth/too-many-requests':  'Trop de tentatives, réessayez plus tard',
  };
  return map[code] || 'Erreur : ' + code;
}
