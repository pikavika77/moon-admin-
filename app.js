import { initializeApp }   from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut }
                           from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getDatabase, ref, onValue, set, remove, update, get }
                           from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";

const FB = {
  apiKey:"AIzaSyACW8aFQmlaoaxNtE55m8Pck6H8BRlfEbs",
  authDomain:"moon-night-x.firebaseapp.com",
  databaseURL:"https://moon-night-x-default-rtdb.firebaseio.com",
  projectId:"moon-night-x",
  storageBucket:"moon-night-x.firebasestorage.app",
  messagingSenderId:"779934381788",
  appId:"1:779934381788:web:1426fa035171015634a619"
};
const OWNER = "aryakaran836@gmail.com";

const fbApp = initializeApp(FB);
const auth  = getAuth(fbApp);
const db    = getDatabase(fbApp);
const gp    = new GoogleAuthProvider();
// All Google accounts can attempt login — email verified after sign-in

// ── STATE ──────────────────────────────────────────────────────────────
let saClients   = [];
let clImages    = [];
let clCats      = [];
let clClientData= null;
let saEditId    = null;
let clEditImgId = null;
let clEditCatId = null;
let currentRoute= '';
let saActLog    = JSON.parse(localStorage.getItem('sa_log') || '[]');
let trafficSortField = 'totalVisits';
let trafficSortAsc   = false;

// ── TOAST ──────────────────────────────────────────────────────────────
function toast(msg, type='ok') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'on ' + type;
  clearTimeout(t._t); t._t = setTimeout(() => t.className = '', 3000);
}

// ── AUTH CHECK ─────────────────────────────────────────────────────────
function checkAuth() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("AUTH_REQUIRED: User is not logged in. Please sign in with Google.");
  }
  const email = (user.email || '').toLowerCase();
  if (email !== OWNER) {
    throw new Error(`UNAUTHORIZED: Access denied. User "${email}" is not authorized as Super Admin.`);
  }
  return user;
}

// ── SAVE CLIENT WITH TIMEOUT ───────────────────────────────────────────
async function saveClient(data) {
  const dbRef = ref(db, 'superAdmin/clients/' + data.id);
  let timeoutId;

  // Create a 6-second timeout promise to catch silent failures
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("TIMEOUT_ERROR: Firebase Realtime Database write timed out. This usually happens when you are offline, have security rule issues, or have a misconfigured database URL/project."));
    }, 6000);
  });

  // Combine write with timeout promise
  try {
    await Promise.race([
      set(dbRef, data).then(res => { clearTimeout(timeoutId); return res; }),
      timeoutPromise
    ]);
    return { success: true };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("saveClient Error details:", error);
    throw error;
  }
}

// ── ROUTER ─────────────────────────────────────────────────────────────
// Routes:
//   #/           → login
//   #/super      → super admin (owner only)
//   #/admin/username → client admin panel
//   #/username   → (future: real site)

function getRoute() {
  // FIX: properly parse hash — remove only the '#' prefix
  const hash = window.location.hash || '#/';
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

function parseRoute(path) {
  // FIX: path like '/super', '/admin/username', '/username' — filter empty parts
  const parts = path.split('/').filter(Boolean);
  if (!parts.length)                             return { type: 'login' };
  if (parts[0] === 'super')                      return { type: 'super' };
  if (parts[0] === 'admin' && parts[1])          return { type: 'client', username: parts[1] };
  // FIX: '#/username' was returning type:'login' causing 404-like behaviour
  // Now correctly identified as a site-viewer route
  if (parts.length === 1 && parts[0] !== 'super' && parts[0] !== 'admin')
                                                 return { type: 'site', username: parts[0] };
  return { type: 'login' };
}

function navigate(path) {
  // FIX: ensure path always starts with '/' so hash is '#/path' not '#path'
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  window.location.hash = '#' + cleanPath;
}

function getBase() {
  const stored = localStorage.getItem('mnx_base_url');
  if (stored) return stored.replace(/\/+$/, '');
  return (window.location.origin + window.location.pathname).replace(/\/+$/, '');
}

// ── AUTH STATE ─────────────────────────────────────────────────────────
const G_SVG = document.getElementById('g-btn').innerHTML;
function resetGBtn() {
  const btn = document.getElementById('g-btn');
  if(btn) { btn.innerHTML = G_SVG; btn.disabled = false; }
}

// Handle redirect result when page loads back after Google sign-in
(async () => {
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      // Successfully signed in via redirect - onAuthStateChanged will handle it
      console.log('Redirect sign-in success:', result.user.email);
    }
  } catch(e) {
    console.error('Redirect result error:', e.code, e.message);
    const msgs = {
      'auth/unauthorized-domain':   `❌ Add "${location.hostname}" to Firebase Console → Authentication → Settings → Authorized domains.`,
      'auth/operation-not-allowed': '❌ Enable Google sign-in in Firebase Console → Authentication → Sign-in method → Google.',
      'auth/account-exists-with-different-credential': '❌ Account exists with different method.',
    };
    const msg = msgs[e.code] || ('❌ Sign-in failed: ' + (e.code || e.message));
    // Show error on login screen
    setTimeout(() => {
      showErr(msg);
      resetGBtn();
    }, 500);
  }
})();

onAuthStateChanged(auth, async user => {
  const route = parseRoute(getRoute());

  if (!user) {
    // Not logged in — show login
    showView('login');
    setupLoginUI(route);
    resetGBtn();
    return;
  }

  const email = user.email.toLowerCase();

  // If user is authenticated and lands on the login page/route, automatically redirect based on identity
  if (route.type === 'login') {
    if (email === OWNER) {
      navigate('super');
      return;
    }

    showView('login');
    document.getElementById('l-sub').textContent   = 'Verifying access...';
    document.getElementById('g-btn').style.display = 'none';

    try {
      const snap = await get(ref(db, 'superAdmin/clients'));
      if (!snap.exists()) {
        await signOut(auth);
        showErr('❌ No clients found.');
        resetGBtn();
        document.getElementById('g-btn').style.display = 'flex';
        setupLoginUI(route);
        return;
      }
      const allClients = Object.values(snap.val());
      const client = allClients.find(c => c.googleEmail.toLowerCase() === email);

      if (!client) {
        await signOut(auth);
        showErr(`❌ Access denied. Account "${email}" is not registered.`);
        resetGBtn();
        document.getElementById('g-btn').style.display = 'flex';
        setupLoginUI(route);
        return;
      }
      if (client.status !== 'active') {
        await signOut(auth);
        showErr('❌ Your account is inactive. Contact admin.');
        resetGBtn();
        document.getElementById('g-btn').style.display = 'flex';
        setupLoginUI(route);
        return;
      }

      // Valid client found - redirect to their admin dashboard
      clClientData = client;
      navigate(`admin/${client.username}`);
      return;
    } catch (err) {
      console.error('Error during automatic login redirect:', err);
      await signOut(auth);
      showErr('❌ Verification failed. Please try again.');
      resetGBtn();
      document.getElementById('g-btn').style.display = 'flex';
      setupLoginUI(route);
      return;
    }
  }

  if (route.type === 'super') {
    // Super admin route
    if (email !== OWNER) {
      await signOut(auth);
      showView('login');
      showErr('❌ Access denied. Only owner can access super admin.');
      return;
    }
    showView('super');
    document.getElementById('sa-email').textContent    = user.email;
    document.getElementById('sa-set-email').textContent= user.email;
    saAddLog('login', `✅ Super Admin signed in: ${user.email}`);
    saInitDB();

  } else if (route.type === 'client') {
    // Client admin route
    const username = route.username;
    showView('login');
    document.getElementById('l-sub').textContent   = 'Verifying access...';
    document.getElementById('g-btn').style.display = 'none';

    // Find client by username
    const snap = await get(ref(db, 'superAdmin/clients'));
    if (!snap.exists()) {
      await signOut(auth); showErr('❌ No clients found.'); resetGBtn(); document.getElementById('g-btn').style.display='flex'; return;
    }
    const allClients = Object.values(snap.val());
    const client = allClients.find(c => c.username === username);

    if (!client) {
      await signOut(auth); showErr(`❌ Username "${username}" not found.`); resetGBtn(); document.getElementById('g-btn').style.display='flex'; return;
    }
    if (client.googleEmail.toLowerCase() !== email) {
      await signOut(auth); showErr(`❌ Access denied. This panel is for ${client.googleEmail}`); resetGBtn(); document.getElementById('g-btn').style.display='flex'; return;
    }
    if (client.status !== 'active') {
      await signOut(auth); showErr('❌ Your account is inactive. Contact admin.'); resetGBtn(); document.getElementById('g-btn').style.display='flex'; return;
    }

    // Valid client
    clClientData = client;
    showView('client');
    document.getElementById('cl-email').textContent    = user.email;
    document.getElementById('cl-site-name').textContent = client.name || 'My Gallery';
    document.title = (client.name || 'My Gallery') + ' — Admin';
    clInitDB(client.id);
  }
});

window.addEventListener('hashchange', () => {
  // On hash change, re-evaluate the route without reloading
  const route = parseRoute(getRoute());
  const user   = auth.currentUser;
  if (!user) {
    showView('login');
    setupLoginUI(route);
    return;
  }
  const email = user.email.toLowerCase();
  if (route.type === 'super' && email === OWNER) {
    showView('super');
  } else if (route.type === 'client' && route.username) {
    // Just show login for client routes - onAuthStateChanged will verify
    showView('login');
    setupLoginUI(route);
  } else if (route.type === 'site' && route.username) {
    // FIX: '#/username' site route — redirect to admin panel for that client
    // (or show a "not found" if not a known client)
    showView('login');
    setupLoginUI({ type: 'site', username: route.username });
  }
});

function showView(name) {
  ['login','super','client'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (v === name) {
      el.style.display     = 'flex';
      el.style.flexDirection = 'column';
      el.style.height      = '100vh';
    } else {
      el.style.display = 'none';
    }
  });
  // Login is centered
  if (name === 'login') {
    const lw = document.getElementById('view-login');
    lw.style.alignItems     = 'center';
    lw.style.justifyContent = 'center';
  }
}

function setupLoginUI(route) {
  const badge = document.getElementById('l-badge');
  const info  = document.getElementById('l-info');
  const sub   = document.getElementById('l-sub');

  if (route.type === 'client' && route.username) {
    badge.className = 'lbadge client';
    badge.textContent = 'CLIENT ACCESS';
    sub.textContent   = 'Client Admin Panel';
    info.innerHTML    = `Sign in with your authorized Google account<br>to access panel for <strong>${route.username}</strong>`;
  } else if (route.type === 'super') {
    badge.className   = 'lbadge owner';
    badge.textContent = 'SUPER ADMIN';
    sub.textContent   = 'Owner Control Panel';
    info.innerHTML    = `Only <strong>${OWNER}</strong> can access this panel`;
  } else if (route.type === 'site' && route.username) {
    // FIX: site route (#/username) — show client login prompt
    badge.className   = 'lbadge client';
    badge.textContent = 'CLIENT ACCESS';
    sub.textContent   = 'Client Panel';
    info.innerHTML    = `Sign in with your authorized Google account<br>to access <strong>${route.username}</strong>'s admin panel`;
  } else {
    badge.className   = 'lbadge owner';
    badge.textContent = 'ADMIN';
    sub.textContent   = 'Platform Admin';
    info.textContent  = 'Sign in with Google to continue';
  }
}

function showErr(msg) {
  const el = document.getElementById('l-err');
  el.innerHTML = msg;
  el.style.display = 'block';
}

// ── GOOGLE LOGIN ────────────────────────────────────────────────────────
document.getElementById('g-btn').addEventListener('click', async () => {
  const btn = document.getElementById('g-btn');
  btn.innerHTML = '⏳ Signing in with Google...';
  btn.disabled  = true;
  document.getElementById('l-err').style.display = 'none';
  try {
    // Attempt popup login first
    await signInWithPopup(auth, gp);
  } catch(e) {
    console.warn('Popup sign-in failed/blocked:', e.code, e.message);
    if (e.code === 'auth/popup-closed-by-user') {
      // User manually closed the popup, do not redirect
      resetGBtn();
      return;
    }

    // Automatic fallback to redirect method
    try {
      btn.innerHTML = '⏳ Redirecting to Google...';
      await signInWithRedirect(auth, gp);
    } catch(err2) {
      const msgs = {
        'auth/unauthorized-domain':   `❌ Add "${location.hostname}" to Firebase → Authentication → Authorized domains.`,
        'auth/operation-not-allowed': '❌ Enable Google sign-in in Firebase Console.',
        'auth/network-request-failed':'❌ Network error. Check connection.',
      };
      showErr(msgs[err2.code] || ('❌ ' + (err2.code || err2.message)));
      resetGBtn();
    }
  }
});

async function doLogout() {
  saAddLog('login', '🚪 Signed out');
  await signOut(auth);
  window.location.hash = '#/';
}
document.getElementById('sa-btn-logout').addEventListener('click', doLogout);
document.getElementById('sa-btn-logout2').addEventListener('click', doLogout);
document.getElementById('cl-btn-logout').addEventListener('click', doLogout);
document.getElementById('cl-btn-logout2').addEventListener('click', doLogout);

// ══════════════════════════════════════════════════════════════════════
// ── SUPER ADMIN ────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

function saShowPage(name) {
  document.querySelectorAll('#view-super .page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('[data-sa-page]').forEach(i => i.classList.remove('on'));
  document.getElementById('sa-page-' + name)?.classList.add('on');
  document.querySelector(`[data-sa-page="${name}"]`)?.classList.add('on');
  if(name === 'activity') saRenderLog();
  if(name === 'revenue')  saRenderRevenue();
  if(name === 'traffic')  saRenderTraffic();
  if(name === 'settings') saLoadSettings();
}
document.querySelectorAll('[data-sa-page]').forEach(el =>
  el.addEventListener('click', () => saShowPage(el.dataset.saPage)));
document.querySelectorAll('[data-sa-goto]').forEach(el =>
  el.addEventListener('click', () => saShowPage(el.dataset.saGoto)));

// LOG
function saAddLog(type, msg) {
  saActLog.unshift({ type, msg, t: new Date().toISOString() });
  if(saActLog.length > 300) saActLog = saActLog.slice(0, 300);
  localStorage.setItem('sa_log', JSON.stringify(saActLog));
  document.getElementById('sa-nb-log').textContent = saActLog.length;
  saRenderLog(); saRenderDashLog();
}
function saLogHTML(e) {
  const d = new Date(e.t);
  const colors = { add:'var(--grn)', edit:'var(--blu)', del:'var(--red)', login:'var(--ylw)' };
  return `<div style="display:flex;gap:11px;padding:11px 18px;border-bottom:1px solid var(--br)">
    <div style="width:7px;height:7px;border-radius:50%;background:${colors[e.type]||'#888'};margin-top:5px;flex-shrink:0"></div>
    <div><div style="font-size:12px;font-weight:600">${e.msg}</div>
    <div style="font-size:10px;color:var(--mu);font-family:monospace;margin-top:2px">${d.toLocaleDateString()} ${d.toLocaleTimeString()}</div></div>
  </div>`;
}
function saRenderLog() {
  const f  = document.getElementById('sa-log-filter')?.value || '';
  const el = document.getElementById('sa-log-list');
  const list = f ? saActLog.filter(e => e.type === f) : saActLog;
  el.innerHTML = list.length ? list.map(saLogHTML).join('')
    : '<div class="empty"><div class="eic">📋</div>No activity</div>';
}
function saRenderDashLog() {
  document.getElementById('sa-dash-log').innerHTML =
    saActLog.slice(0,5).map(saLogHTML).join('') ||
    '<div class="empty"><div class="eic">📋</div>No activity yet</div>';
}

// DB
function saInitDB() {
  onValue(ref(db, 'superAdmin/clients'), snap => {
    saClients = snap.exists() ? Object.values(snap.val()) : [];
    document.getElementById('sa-db-st').textContent   = 'Live';
    document.getElementById('sa-nb-clients').textContent = saClients.length;
    saUpdateDash();
    saRenderClients();
    saPopulateEarnSelect();
  }, () => { document.getElementById('sa-db-st').textContent = 'Error'; });
}

const COLORS = ['#E02424','#3b82f6','#22c55e','#f59e0b','#a855f7','#06b6d4','#ec4899','#f97316'];

function saUpdateDash() {
  const active   = saClients.filter(c => c.status === 'active').length;
  const totalRev = saClients.reduce((a,c) => a+(c.totalEarning||0), 0);
  const payout   = saClients.reduce((a,c) => a+(c.totalEarning||0)*(c.earningPercent||40)/100, 0);
  const visits   = saClients.reduce((a,c) => a+(c.totalVisits||0), 0);
  const today    = saClients.reduce((a,c) => a+(c.todayVisits||0), 0);

  document.getElementById('sa-d-clients').textContent = saClients.length;
  document.getElementById('sa-d-active').textContent  = active;
  document.getElementById('sa-d-rev').textContent     = '₹' + totalRev.toFixed(0);
  document.getElementById('sa-d-mine').textContent    = '₹' + (totalRev-payout).toFixed(0);
  document.getElementById('sa-d-traffic').textContent = visits.toLocaleString();
  document.getElementById('sa-d-today').textContent   = today.toLocaleString();

  const max = Math.max(...saClients.map(c=>c.totalEarning||0), 1);
  document.getElementById('sa-rev-chart').innerHTML = saClients.length
    ? saClients.map((c,i) => `
        <div class="bwrp">
          <div class="bval">₹${(c.totalEarning||0).toFixed(0)}</div>
          <div class="bbar" style="height:${Math.max(((c.totalEarning||0)/max)*80,3)}px;background:${COLORS[i%COLORS.length]}"></div>
          <div class="blbl">${(c.name||'').slice(0,8)}</div>
        </div>`).join('')
    : '<div style="color:var(--mu);font-size:12px;margin:auto">No clients yet</div>';

  const base = getBase();
  document.getElementById('sa-dash-clients').innerHTML = saClients.map(c => {
    const adminUrl = `${base}/#/admin/${c.username}`;
    const siteUrl  = c.siteUrl || `${base}/#/${c.username}`;
    return `
    <tr>
      <td style="font-weight:700">${c.name||'—'}</td>
      <td>
        <div style="font-family:monospace;font-size:11px;color:var(--mu)">${c.username||'—'}</div>
        <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
          <a href="${adminUrl}" target="_blank" class="tag grn" style="text-decoration:none">⚙️ Admin</a>
          <a href="${siteUrl}" target="_blank" class="tag blu" style="text-decoration:none">🌐 Site</a>
        </div>
      </td>
      <td><span class="tag ${c.status==='active'?'grn':'mu'}">${c.status||'inactive'}</span></td>
      <td style="font-size:11px">${(c.totalVisits||0).toLocaleString()}</td>
      <td style="color:var(--grn);font-weight:700">₹${(c.totalEarning||0).toFixed(0)}</td>
      <td>${c.earningPercent||40}%</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6"><div class="empty"><div class="eic">👥</div>No clients</div></td></tr>';

  saRenderDashLog();
}

function saRenderClients() {
  const q    = (document.getElementById('sa-q-client')?.value||'').toLowerCase();
  const list = saClients.filter(c => !q || (c.name||'').toLowerCase().includes(q) || (c.username||'').toLowerCase().includes(q));
  const base = getBase();

  document.getElementById('sa-clients-foot').textContent = `${list.length} of ${saClients.length} clients`;
  document.getElementById('sa-clients-tbody').innerHTML = list.length ? list.map(c => {
    const adminUrl = `${base}/#/admin/${c.username}`;
    const siteUrl  = c.siteUrl || `${base}/#/${c.username}`;
    return `<tr>
      <td><div style="font-weight:700">${c.name||'—'}</div><div style="font-size:10px;color:var(--mu);font-family:monospace">${c.id}</div></td>
      <td>
        <div style="font-size:11px;font-family:monospace;color:var(--mu);font-weight:700">${c.username||'—'}</div>
        <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
          <a href="${adminUrl}" target="_blank" class="tag grn" style="text-decoration:none">⚙️ Admin Panel</a>
          <a href="${siteUrl}" target="_blank" class="tag blu" style="text-decoration:none">🌐 Real Site</a>
        </div>
      </td>
      <td style="font-size:11px">${c.googleEmail||'—'}</td>
      <td><span class="tag ${c.status==='active'?'grn':'mu'}">${c.status||'inactive'}</span></td>
      <td style="color:var(--red);font-weight:700">${c.earningPercent||40}%</td>
      <td style="color:var(--grn);font-weight:700">₹${(c.totalEarning||0).toFixed(0)}</td>
      <td><div class="arow">
        <button class="btn btn-grn btn-xs" data-share="${c.id}">📤 Share</button>
        <button class="btn btn-g btn-xs" data-edit="${c.id}">✏️</button>
        <button class="btn btn-d btn-xs" data-del="${c.id}" data-dname="${c.name||''}">🗑</button>
      </div></td>
    </tr>`;
  }).join('')
  : '<tr><td colspan="7"><div class="empty"><div class="eic">👥</div>No clients</div></td></tr>';

  document.querySelectorAll('[data-share]').forEach(btn => btn.addEventListener('click', () => saShowShareModal(btn.dataset.share)));
  document.querySelectorAll('[data-edit]').forEach(btn  => btn.addEventListener('click', () => saOpenEdit(btn.dataset.edit)));
  document.querySelectorAll('[data-del]').forEach(btn   => btn.addEventListener('click', () => saDeleteClient(btn.dataset.del, btn.dataset.dname)));
}
document.getElementById('sa-q-client').addEventListener('input', saRenderClients);

// SHARE MODAL
function saShowShareModal(clientId) {
  const c    = saClients.find(x => x.id === clientId); if(!c) return;
  const base = getBase();
  const adminUrl = `${base}/#/admin/${c.username}`;
  const siteUrl  = c.siteUrl || `${base}/#/${c.username}`;

  document.getElementById('sm-name').textContent       = c.name;
  document.getElementById('sm-admin-url').textContent  = adminUrl;
  document.getElementById('sm-site-url').textContent   = siteUrl;

  document.getElementById('sm-copy-admin').onclick = () => {
    navigator.clipboard.writeText(adminUrl);
    document.getElementById('sm-copy-admin').textContent = '✅ Copied!';
    setTimeout(() => document.getElementById('sm-copy-admin').textContent = '📋 Copy', 2000);
  };
  document.getElementById('sm-open-admin').onclick = () => window.open(adminUrl, '_blank');
  document.getElementById('sm-copy-site').onclick  = () => {
    navigator.clipboard.writeText(siteUrl);
    document.getElementById('sm-copy-site').textContent = '✅ Copied!';
    setTimeout(() => document.getElementById('sm-copy-site').textContent = '📋 Copy', 2000);
  };
  document.getElementById('sm-open-site').onclick  = () => window.open(siteUrl, '_blank');
  document.getElementById('sm-copy-both').onclick  = () => {
    const msg = `Hi! Ye rahe aapke 2 links:\n\n⚙️ Admin Panel:\n${adminUrl}\n\n🌐 Real Site:\n${siteUrl}\n\nAdmin panel pe apni Gmail se login karo.`;
    navigator.clipboard.writeText(msg);
    document.getElementById('sm-copy-both').textContent = '✅ Copied!';
    setTimeout(() => document.getElementById('sm-copy-both').textContent = '📋 Copy Both Links', 2000);
  };

  // Save URLs to Firebase with robust try/catch and toast error messages
  (async () => {
    try {
      await update(ref(db, `superAdmin/clients/${clientId}`), { adminUrl, generatedAt: new Date().toISOString() });
      saAddLog('add', `Generated URLs for "${c.name}" — admin: ${adminUrl}`);
    } catch (err) {
      console.error('Error saving URLs to Firebase:', err);
      toast('❌ Failed to save URLs to database: ' + err.message, 'err');
    }
  })();

  document.getElementById('share-modal').style.display = 'flex';
}
document.getElementById('sm-close').addEventListener('click', () => document.getElementById('share-modal').style.display = 'none');

// CLIENT MODAL
document.getElementById('sa-cm-pct').addEventListener('input', () => {
  const v = document.getElementById('sa-cm-pct').value;
  document.getElementById('sa-pct-val').textContent  = v;
  document.getElementById('sa-keep-val').textContent = 100 - v;
});
document.getElementById('sa-cm-username').addEventListener('input', () => {
  let u = document.getElementById('sa-cm-username').value.toLowerCase().replace(/[^a-z0-9-]/g,'');
  document.getElementById('sa-cm-username').value = u;
  const base = getBase();
  document.getElementById('sa-username-preview').innerHTML =
    u ? `Admin: <span style="color:var(--grn)">${base}/#/admin/${u}</span> &nbsp;|&nbsp; Site: <span style="color:var(--blu)">${base}/#/${u}</span>`
      : 'Preview: —';
});

function saOpenAdd() {
  saEditId = null;
  document.getElementById('sa-cm-title').textContent = '👥 Add New Client';
  document.getElementById('sa-cm-save').textContent  = '💾 Save & Generate URLs';
  ['sa-cm-name','sa-cm-email','sa-cm-username','sa-cm-adsterra','sa-cm-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('sa-cm-pct').value = 40;
  document.getElementById('sa-pct-val').textContent  = '40';
  document.getElementById('sa-keep-val').textContent = '60';
  document.getElementById('sa-cm-status').value = 'active';
  document.getElementById('sa-username-preview').textContent = 'Preview: —';
  document.getElementById('sa-client-modal').style.display = 'flex';
}
function saOpenEdit(id) {
  const c = saClients.find(x => x.id === id); if(!c) return;
  saEditId = id;
  document.getElementById('sa-cm-title').textContent   = '✏️ Edit Client';
  document.getElementById('sa-cm-save').textContent    = '💾 Update Client';
  document.getElementById('sa-cm-name').value          = c.name||'';
  document.getElementById('sa-cm-email').value         = c.googleEmail||'';
  document.getElementById('sa-cm-username').value      = c.username||'';
  document.getElementById('sa-cm-adsterra').value      = c.adsterraSiteId||'';
  document.getElementById('sa-cm-notes').value         = c.notes||'';
  document.getElementById('sa-cm-status').value        = c.status||'active';
  const pct = c.earningPercent||40;
  document.getElementById('sa-cm-pct').value           = pct;
  document.getElementById('sa-pct-val').textContent    = pct;
  document.getElementById('sa-keep-val').textContent   = 100 - pct;
  // trigger preview
  document.getElementById('sa-cm-username').dispatchEvent(new Event('input'));
  document.getElementById('sa-client-modal').style.display = 'flex';
}

document.getElementById('sa-btn-add').addEventListener('click', saOpenAdd);
document.getElementById('sa-btn-add2').addEventListener('click', saOpenAdd);
document.getElementById('sa-cm-cancel').addEventListener('click', () => document.getElementById('sa-client-modal').style.display = 'none');

document.getElementById('sa-cm-save').addEventListener('click', async () => {
  const name     = document.getElementById('sa-cm-name').value.trim();
  const email    = document.getElementById('sa-cm-email').value.trim().toLowerCase();
  const username = document.getElementById('sa-cm-username').value.trim().toLowerCase().replace(/[^a-z0-9-]/g,'');

  if(!name)     { toast('❌ Name required!','err'); return; }
  if(!email)    { toast('❌ Email required!','err'); return; }
  if(!username) { toast('❌ Username required (only a-z, 0-9, - allowed)!','err'); return; }

  // Check username unique (for new clients only)
  if(!saEditId) {
    const exists = saClients.find(c => c.username === username);
    if(exists) { toast('❌ Username "'+username+'" already taken! Choose another.','err'); return; }
  }

  // 1. Verify User Authentication and Authorization first
  try {
    checkAuth();
  } catch (authError) {
    console.error("Auth check failed:", authError);
    toast("❌ " + authError.message, "err");
    return;
  }

  const id       = saEditId || ('cl_' + username + '_' + Date.now());
  const existing = saEditId ? saClients.find(c => c.id === id) : null;
  const base     = getBase();

  const data = {
    id,
    name,
    username,
    googleEmail:    email,
    earningPercent: parseInt(document.getElementById('sa-cm-pct').value) || 40,
    status:         document.getElementById('sa-cm-status').value || 'active',
    adsterraSiteId: document.getElementById('sa-cm-adsterra').value.trim(),
    notes:          document.getElementById('sa-cm-notes').value.trim(),
    createdAt:      existing ? (existing.createdAt || new Date().toISOString()) : new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
    totalEarning:   existing ? (existing.totalEarning  || 0) : 0,
    totalVisits:    existing ? (existing.totalVisits   || 0) : 0,
    todayVisits:    existing ? (existing.todayVisits   || 0) : 0,
    totalViews:     existing ? (existing.totalViews    || 0) : 0,
    adminUrl:       base + '/#/admin/' + username,
    siteUrl:        existing ? (existing.siteUrl || base+'/#/'+username) : base+'/#/'+username,
  };

  const btn = document.getElementById('sa-cm-save');
  btn.textContent = '⏳ Saving...';
  btn.disabled    = true;

  try {
    console.log('Saving client to Firebase path: superAdmin/clients/' + id);
    console.log('Data:', JSON.stringify(data));

    // 2. Perform write using the timeout wrapper saveClient(data)
    await saveClient(data);

    console.log('✅ Client saved successfully');
    toast('✅ Client "' + name + '" ' + (saEditId ? 'updated' : 'created') + '!');
    document.getElementById('sa-client-modal').style.display = 'none';

    // Log action
    try {
      saAddLog(saEditId ? 'edit' : 'add',
        (saEditId ? 'Updated' : 'Created') + ' client: "' + name + '" (@' + username + ')');
    } catch(logErr) { console.warn('Log failed:', logErr); }

    // Auto show share modal for new clients
    if(!saEditId) {
      setTimeout(() => saShowShareModal(id), 500);
    }

  } catch(e) {
    console.error('Client save error:', e);
    let msg = e.message || 'Unknown error';
    if(e.code === 'PERMISSION_DENIED' || msg.includes('permission') || msg.includes('Permission') || msg.includes('PERMISSION_DENIED')) {
      msg = 'Firebase permission denied! Database Rules mein superAdmin path allow karo.';
    } else if(msg.includes('network') || msg.includes('Network')) {
      msg = 'Network error! Internet connection check karo.';
    }
    toast('❌ ' + msg, 'err');
  } finally {
    btn.textContent = saEditId ? '💾 Update Client' : '💾 Save & Generate URLs';
    btn.disabled    = false;
  }
});

async function saDeleteClient(id, name) {
  if(!confirm(`Delete client "${name}"?`)) return;
  try {
    await remove(ref(db, `superAdmin/clients/${id}`));
    saAddLog('del', `Deleted client: "${name}"`);
    toast('🗑️ Client deleted');
  } catch(e) { toast('❌ '+e.message,'err'); }
}

// REVENUE
function saRenderRevenue() {
  const total  = saClients.reduce((a,c)=>a+(c.totalEarning||0),0);
  const payout = saClients.reduce((a,c)=>a+(c.totalEarning||0)*(c.earningPercent||40)/100,0);
  document.getElementById('sa-r-total').textContent  = '₹'+total.toFixed(0);
  document.getElementById('sa-r-mine').textContent   = '₹'+(total-payout).toFixed(0);
  document.getElementById('sa-r-payout').textContent = '₹'+payout.toFixed(0);
  document.getElementById('sa-rev-tbody').innerHTML  = saClients.map(c => {
    const t=c.totalEarning||0, p=c.earningPercent||40;
    return `<tr>
      <td style="font-weight:700">${c.name}</td>
      <td style="color:var(--grn)">₹${t.toFixed(0)}</td>
      <td>
        <input type="range" min="0" max="100" value="${p}" data-cid="${c.id}" data-tot="${t}" class="pct-sl" style="width:80px;accent-color:var(--red)"/>
        <span id="psl-${c.id}" style="font-size:11px;font-weight:700;color:var(--red);margin-left:4px">${p}%</span>
      </td>
      <td style="color:var(--ylw)" id="cget-${c.id}">₹${(t*p/100).toFixed(0)}</td>
      <td style="color:var(--blu)" id="ykeep-${c.id}">₹${(t*(100-p)/100).toFixed(0)}</td>
      <td><button class="btn btn-grn btn-xs" data-sp="${c.id}">💾</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6"><div class="empty"><div class="eic">💰</div>No clients</div></td></tr>';

  document.querySelectorAll('.pct-sl').forEach(sl => sl.addEventListener('input', () => {
    const cid = sl.dataset.cid;
    const val = parseInt(sl.value) || 0;
    const tot = parseFloat(sl.dataset.tot) || 0;
    document.getElementById('psl-'+cid).textContent = val+'%';
    document.getElementById('cget-'+cid).textContent = '₹' + (tot * val / 100).toFixed(0);
    document.getElementById('ykeep-'+cid).textContent = '₹' + (tot * (100 - val) / 100).toFixed(0);
  }));
  document.querySelectorAll('[data-sp]').forEach(btn => btn.addEventListener('click', async () => {
    const sl = document.querySelector(`.pct-sl[data-cid="${btn.dataset.sp}"]`);
    try { await update(ref(db,`superAdmin/clients/${btn.dataset.sp}`),{earningPercent:parseInt(sl.value)}); toast('✅ % updated'); } catch(e){ toast('❌ '+e.message,'err'); }
  }));
}

function setTrafficSort(field) {
  if (trafficSortField === field) {
    trafficSortAsc = !trafficSortAsc;
  } else {
    trafficSortField = field;
    trafficSortAsc = false;
  }
  saRenderTraffic();
}

function saRenderTraffic() {
  document.getElementById('sa-t-total').textContent = saClients.reduce((a,c)=>a+(c.totalVisits||0),0).toLocaleString();
  document.getElementById('sa-t-today').textContent = saClients.reduce((a,c)=>a+(c.todayVisits||0),0).toLocaleString();
  document.getElementById('sa-t-views').textContent = saClients.reduce((a,c)=>a+(c.totalViews||0),0).toLocaleString();

  // Sort clients
  const sortedClients = [...saClients].sort((a, b) => {
    let valA = a[trafficSortField];
    let valB = b[trafficSortField];
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA === undefined || valA === null) valA = '';
    if (valB === undefined || valB === null) valB = '';

    if (valA < valB) return trafficSortAsc ? -1 : 1;
    if (valA > valB) return trafficSortAsc ? 1 : -1;
    return 0;
  });

  const headers = [
    { label: 'Client', field: 'name' },
    { label: 'Site URL', field: 'siteUrl' },
    { label: 'Today', field: 'todayVisits' },
    { label: 'Total Visits', field: 'totalVisits' },
    { label: 'Views', field: 'totalViews' },
    { label: 'Status', field: 'status' }
  ];

  const theadHTML = `<tr>${headers.map(h => {
    const isSorted = trafficSortField === h.field;
    const arrow = isSorted ? (trafficSortAsc ? ' ▲' : ' ▼') : '';
    return `<th style="cursor:pointer;user-select:none" id="th-traffic-${h.field}">${h.label}${arrow}</th>`;
  }).join('')}</tr>`;

  const tbodyHTML = sortedClients.map(c=>`
    <tr>
      <td style="font-weight:700">${c.name}</td>
      <td><a href="${c.siteUrl||'#'}" target="_blank" style="color:var(--blu);font-size:11px">${c.siteUrl||'—'}</a></td>
      <td style="color:var(--ylw);font-weight:700">${(c.todayVisits||0).toLocaleString()}</td>
      <td style="color:var(--grn);font-weight:700">${(c.totalVisits||0).toLocaleString()}</td>
      <td>${(c.totalViews||0).toLocaleString()}</td>
      <td><span class="tag ${c.status==='active'?'grn':'mu'}">${c.status}</span></td>
    </tr>`).join('') || '<tr><td colspan="6"><div class="empty"><div class="eic">📈</div>No data</div></td></tr>';

  const tableContainer = document.getElementById('sa-traffic-tbody').parentElement;
  tableContainer.querySelector('thead').innerHTML = theadHTML;
  document.getElementById('sa-traffic-tbody').innerHTML = tbodyHTML;

  headers.forEach(h => {
    document.getElementById(`th-traffic-${h.field}`).addEventListener('click', () => setTrafficSort(h.field));
  });
}

// EARN ADD
function saPopulateEarnSelect() {
  const sel = document.getElementById('sa-earn-client');
  sel.innerHTML = '<option value="">Choose client...</option>';
  saClients.forEach(c => { const o=document.createElement('option'); o.value=c.id; o.textContent=c.name; sel.appendChild(o); });
}
document.getElementById('sa-btn-earn').addEventListener('click', async () => {
  const cid    = document.getElementById('sa-earn-client').value;
  const amount = parseFloat(document.getElementById('sa-earn-amount').value);
  const note   = document.getElementById('sa-earn-note').value.trim();
  if(!cid||!amount) { toast('Select client and amount','inf'); return; }
  const c = saClients.find(x=>x.id===cid);
  try {
    await update(ref(db,`superAdmin/clients/${cid}`),{totalEarning:(c?.totalEarning||0)+amount});
    await set(ref(db,`superAdmin/clients/${cid}/earningHistory/earn_${Date.now()}`),{amount,note,t:new Date().toISOString()});
    saAddLog('add',`Added ₹${amount} to "${c?.name}"`);
    toast(`✅ ₹${amount} added`);
    document.getElementById('sa-earn-amount').value='';
    document.getElementById('sa-earn-note').value='';
  } catch(e){ toast('❌ '+e.message,'err'); }
});

// SETTINGS
function saLoadSettings() {
  const base = getBase();
  document.getElementById('sa-base-url').value = localStorage.getItem('mnx_base_url') || window.location.origin;
  document.getElementById('sa-url-preview').textContent  = base + '/#/admin/username';
  document.getElementById('sa-site-preview').textContent = base + '/#/username';
}
document.getElementById('sa-base-url').addEventListener('input', () => {
  const v = document.getElementById('sa-base-url').value.trim();
  document.getElementById('sa-url-preview').textContent  = v + '/#/admin/username';
  document.getElementById('sa-site-preview').textContent = v + '/#/username';
});
document.getElementById('sa-save-base').addEventListener('click', () => {
  const url = document.getElementById('sa-base-url').value.trim().replace(/\/+$/,'');
  localStorage.setItem('mnx_base_url', url);
  toast('✅ Base URL saved!');
  saAddLog('edit','Updated base URL: '+url);
});

// ACTIVITY CONTROLS
document.getElementById('sa-log-filter').addEventListener('change', saRenderLog);
document.getElementById('sa-btn-clr-log').addEventListener('click', () => {
  if(!confirm('Clear all logs?')) return;
  saActLog=[]; localStorage.setItem('sa_log','[]');
  document.getElementById('sa-nb-log').textContent='0';
  saRenderLog(); saRenderDashLog();
  toast('Log cleared');
});

// ══════════════════════════════════════════════════════════════════════
// ── CLIENT ADMIN ───────────────────────────────────════════════════════
// ══════════════════════════════════════════════════════════════════════

function clShowPage(name) {
  document.querySelectorAll('#view-client .page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('[data-cl-page]').forEach(i => i.classList.remove('on'));
  document.getElementById('cl-page-'+name)?.classList.add('on');
  document.querySelector(`[data-cl-page="${name}"]`)?.classList.add('on');
  if(name==='earning') clRenderEarning();
}
document.querySelectorAll('[data-cl-page]').forEach(el => el.addEventListener('click', () => clShowPage(el.dataset.clPage)));
document.querySelectorAll('[data-cl-goto]').forEach(el  => el.addEventListener('click', () => clShowPage(el.dataset.clGoto)));

function clInitDB(clientId) {
  onValue(ref(db,`clients/${clientId}/images`), snap => {
    clImages = snap.exists() ? Object.values(snap.val()) : [];
    document.getElementById('cl-db-st').textContent  = 'Live';
    document.getElementById('cl-nb-img').textContent = clImages.length;
    document.getElementById('cl-d-images').textContent = clImages.length;
    clRenderTable(); clRenderDashImgs(); clPopulateCatFilter();
  });
  onValue(ref(db,`clients/${clientId}/categories`), snap => {
    clCats = snap.exists() ? Object.values(snap.val()) : [];
    document.getElementById('cl-nb-cat').textContent = clCats.length;
    clRenderCatTable(); clPopulateCatDropdowns();
  });
  onValue(ref(db,`superAdmin/clients/${clientId}`), snap => {
    if(!snap.exists()) return;
    clClientData = snap.val();
    const d=clClientData, pct=d.earningPercent||40, earn=(d.totalEarning||0)*pct/100;
    document.getElementById('cl-d-visits').textContent = (d.totalVisits||0).toLocaleString();
    document.getElementById('cl-d-today').textContent  = (d.todayVisits||0).toLocaleString();
    document.getElementById('cl-d-earn').textContent   = '₹'+earn.toFixed(0);
    document.getElementById('cl-d-pct').textContent    = pct+'%';
    document.getElementById('cl-e-total').textContent  = '₹'+earn.toFixed(0);
    document.getElementById('cl-e-pct').textContent    = pct+'%';
    const month = (d.thisMonthEarning||0)*pct/100;
    document.getElementById('cl-d-month').textContent  = '₹'+month.toFixed(0);
    const pctBar = Math.min((earn/1000)*100,100);
    document.getElementById('cl-earn-fill').style.width   = pctBar+'%';
    document.getElementById('cl-earn-pct-lbl').textContent= pctBar.toFixed(0)+'%';
  });
}

function clRenderDashImgs() {
  document.getElementById('cl-dash-imgs').innerHTML = clImages.slice(0,12).map(img=>`
    <div style="cursor:pointer" data-edit-img="${img.id}" title="${img.title||''}">
      <img src="${img.thumbnailUrl||''}" onerror="this.src=''" alt=""
        style="width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:7px;border:1px solid var(--br)"/>
    </div>`).join('') || '<div style="color:var(--mu);font-size:12px">No images yet</div>';
  document.querySelectorAll('[data-edit-img]').forEach(el => el.addEventListener('click', () => clOpenEditImg(el.dataset.editImg)));
}

function clPopulateCatFilter() {
  const sel = document.getElementById('cl-f-cat'), cur = sel.value;
  sel.innerHTML = '<option value="">All Categories</option>';
  [...new Set(clImages.map(i=>i.category).filter(Boolean))].sort().forEach(c => {
    const o=document.createElement('option'); o.value=c; o.textContent=c; if(c===cur) o.selected=true; sel.appendChild(o);
  });
}

function clRenderTable() {
  const q    = (document.getElementById('cl-q-img')?.value||'').toLowerCase();
  const fcat = document.getElementById('cl-f-cat')?.value||'';
  const list = clImages.filter(img => {
    const mq = !q||[img.title,img.id,img.modelName].some(s=>(s||'').toLowerCase().includes(q));
    return mq && (!fcat||img.category===fcat);
  });
  document.getElementById('cl-img-foot').textContent = `${list.length} of ${clImages.length} images`;
  document.getElementById('cl-img-tbody').innerHTML = list.length ? list.map(img=>`
    <tr>
      <td><img class="thumb" src="${img.thumbnailUrl||''}" onerror="this.src=''" alt=""/></td>
      <td><div style="font-weight:700;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${img.title||'—'}</div>
          <div style="font-size:10px;color:var(--mu);font-family:monospace">${img.id}</div></td>
      <td><span class="tag cat">${img.category||'—'}</span></td>
      <td>
        ${img.isFeatured?'<span class="tag ft">⭐</span>':''}
        ${img.isTrending?'<span class="tag grn">🔥</span>':''}
        ${img.isNew?'<span class="tag ylw">✨</span>':''}
      </td>
      <td><div style="font-size:10px;color:var(--mu)">👁 ${(img.views||0).toLocaleString()}</div>
          <div style="font-size:10px;color:var(--mu)">❤️ ${(img.likes||0).toLocaleString()}</div></td>
      <td><div class="arow">
        <button class="btn btn-g btn-xs" data-edit-img="${img.id}">✏️</button>
        <button class="btn btn-d btn-xs" data-del-img="${img.id}" data-dtitle="${(img.title||'').replace(/"/g,'&quot;')}">🗑</button>
      </div></td>
    </tr>`).join('')
  : '<tr><td colspan="6"><div class="empty"><div class="eic">🖼️</div>No images found</div></td></tr>';
  document.querySelectorAll('[data-edit-img]').forEach(btn => btn.addEventListener('click', () => clOpenEditImg(btn.dataset.editImg)));
  document.querySelectorAll('[data-del-img]').forEach(btn  => btn.addEventListener('click', () => clDeleteImg(btn.dataset.delImg, btn.dataset.dtitle)));
}
['cl-q-img','cl-f-cat'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', clRenderTable);
  document.getElementById(id)?.addEventListener('change', clRenderTable);
});

// IMAGE MODAL
function clPopulateCatDropdowns() {
  const sel=document.getElementById('cl-m-cat'), cur=sel.value;
  sel.innerHTML='<option value="general">General</option>';
  clCats.forEach(c => { const o=document.createElement('option'); o.value=c.id; o.textContent=c.name; if(c.id===cur) o.selected=true; sel.appendChild(o); });
}

function clClearImgForm() {
  ['cl-m-id','cl-m-slug','cl-m-title','cl-m-desc','cl-m-thumb','cl-m-hires','cl-m-gallery','cl-m-model','cl-m-res','cl-m-size','cl-m-tags','cl-m-up'].forEach(id=>document.getElementById(id).value='');
  ['cl-m-views','cl-m-likes'].forEach(id=>document.getElementById(id).value='0');
  ['cl-m-ft','cl-m-tr','cl-m-pp','cl-m-nw'].forEach(id=>document.getElementById(id).checked=false);
  document.getElementById('cl-m-aspect').value='portrait';
  document.getElementById('cl-m-fmt').value='WebP';
  document.getElementById('cl-p-thumb').style.display='none';
  document.getElementById('cl-p-hires').style.display='none';
}

function clOpenAddImg() {
  clEditImgId=null;
  document.getElementById('cl-im-title').textContent='➕ Add Image';
  document.getElementById('cl-im-save').textContent='💾 Save Image';
  clClearImgForm();
  clPopulateCatDropdowns();
  document.getElementById('cl-m-id').disabled=false;
  document.getElementById('cl-img-modal').style.display='flex';
}
function clOpenEditImg(id) {
  const img=clImages.find(i=>i.id===id); if(!img) return;
  clEditImgId=id;
  document.getElementById('cl-im-title').textContent='✏️ Edit Image';
  document.getElementById('cl-im-save').textContent='💾 Update';
  clPopulateCatDropdowns();
  document.getElementById('cl-m-id').value=img.id||''; document.getElementById('cl-m-id').disabled=true;
  document.getElementById('cl-m-slug').value=img.slug||'';
  document.getElementById('cl-m-title').value=img.title||'';
  document.getElementById('cl-m-desc').value=img.description||'';
  document.getElementById('cl-m-cat').value=img.category||'general';
  document.getElementById('cl-m-aspect').value=img.aspectRatio||'portrait';
  document.getElementById('cl-m-thumb').value=img.thumbnailUrl||'';
  document.getElementById('cl-m-hires').value=img.highResUrl||'';
  document.getElementById('cl-m-gallery').value=(img.galleryImages||[]).join('\n');
  document.getElementById('cl-m-model').value=img.modelName||'';
  document.getElementById('cl-m-res').value=img.resolution||'';
  document.getElementById('cl-m-fmt').value=img.format||'WebP';
  document.getElementById('cl-m-size').value=img.fileSize||'';
  document.getElementById('cl-m-views').value=img.views||0;
  document.getElementById('cl-m-likes').value=img.likes||0;
  document.getElementById('cl-m-up').value=img.uploadedAt||'';
  document.getElementById('cl-m-tags').value=(img.tags||[]).join(', ');
  document.getElementById('cl-m-ft').checked=!!img.isFeatured;
  document.getElementById('cl-m-tr').checked=!!img.isTrending;
  document.getElementById('cl-m-pp').checked=!!img.isPopular;
  document.getElementById('cl-m-nw').checked=!!img.isNew;
  clPrevImg('cl-m-thumb','cl-p-thumb'); clPrevImg('cl-m-hires','cl-p-hires');
  document.getElementById('cl-img-modal').style.display='flex';
}

document.getElementById('cl-btn-add-img').addEventListener('click', clOpenAddImg);
document.getElementById('cl-btn-add-img-page').addEventListener('click', clOpenAddImg);
document.getElementById('cl-im-cancel').addEventListener('click', ()=>document.getElementById('cl-img-modal').style.display='none');
['cl-m-thumb','cl-m-hires'].forEach(id=>document.getElementById(id).addEventListener('input',()=>{ clPrevImg('cl-m-thumb','cl-p-thumb'); clPrevImg('cl-m-hires','cl-p-hires'); }));

document.getElementById('cl-im-save').addEventListener('click', async ()=>{
  const clientId = clClientData?.id; if(!clientId) return;
  const id=document.getElementById('cl-m-id').value.trim(), title=document.getElementById('cl-m-title').value.trim();
  const thumb=document.getElementById('cl-m-thumb').value.trim(), hires=document.getElementById('cl-m-hires').value.trim();
  const slug=document.getElementById('cl-m-slug').value.trim();
  if(!id||!title||!thumb||!hires||!slug){toast('❌ ID, Slug, Title, Thumb & HiRes required!','err');return;}
  const data={
    id,slug,title,description:document.getElementById('cl-m-desc').value.trim(),
    category:document.getElementById('cl-m-cat').value,aspectRatio:document.getElementById('cl-m-aspect').value,
    thumbnailUrl:thumb,highResUrl:hires,
    galleryImages:document.getElementById('cl-m-gallery').value.trim().split('\n').map(s=>s.trim()).filter(Boolean),
    modelName:document.getElementById('cl-m-model').value.trim(),resolution:document.getElementById('cl-m-res').value.trim(),
    format:document.getElementById('cl-m-fmt').value,fileSize:document.getElementById('cl-m-size').value.trim(),
    views:parseInt(document.getElementById('cl-m-views').value)||0,likes:parseInt(document.getElementById('cl-m-likes').value)||0,
    uploadedAt:document.getElementById('cl-m-up').value.trim()||'Just now',
    tags:document.getElementById('cl-m-tags').value.split(',').map(s=>s.trim()).filter(Boolean),
    isFeatured:document.getElementById('cl-m-ft').checked,isTrending:document.getElementById('cl-m-tr').checked,
    isPopular:document.getElementById('cl-m-pp').checked,isNew:document.getElementById('cl-m-nw').checked,
    width:0,height:0,
  };
  const btn=document.getElementById('cl-im-save'); btn.textContent='⏳...'; btn.disabled=true;
  try{
    await set(ref(db,`clients/${clientId}/images/${id}`),data);
    toast(`✅ Image ${clEditImgId?'updated':'saved'}!`);
    document.getElementById('cl-img-modal').style.display='none';
  }catch(e){toast('❌ '+e.message,'err');}
  finally{btn.textContent='💾 Save Image';btn.disabled=false;}
});

async function clDeleteImg(id,title){
  if(!confirm(`Delete "${title}"?`)) return;
  try{ await remove(ref(db,`clients/${clClientData?.id}/images/${id}`)); toast('🗑️ Deleted'); }
  catch(e){ toast('❌ '+e.message,'err'); }
}

function clPrevImg(inId,prevId){
  const url=document.getElementById(inId)?.value.trim(), img=document.getElementById(prevId);
  if(!img) return;
  if(url){img.src=url;img.style.display='block';img.onerror=()=>img.style.display='none';}
  else img.style.display='none';
}

// CATEGORIES
function clRenderCatTable(){
  document.getElementById('cl-cat-tbody').innerHTML = clCats.length ? clCats.map(cat=>{
    const cnt=clImages.filter(i=>i.category===cat.id).length;
    return `<tr>
      <td><code style="font-size:11px;background:var(--s2);padding:2px 6px;border-radius:4px">${cat.id}</code></td>
      <td style="font-weight:700">${cat.name}</td>
      <td><span class="tag cat">${cnt}</span></td>
      <td><div class="arow">
        <button class="btn btn-g btn-xs" data-ecat="${cat.id}">✏️</button>
        <button class="btn btn-d btn-xs" data-dcat="${cat.id}" data-dcname="${cat.name}">🗑</button>
      </div></td>
    </tr>`;
  }).join('')
  : '<tr><td colspan="4"><div class="empty"><div class="eic">📂</div>No categories</div></td></tr>';
  document.querySelectorAll('[data-ecat]').forEach(btn=>btn.addEventListener('click',()=>clOpenEditCat(btn.dataset.ecat)));
  document.querySelectorAll('[data-dcat]').forEach(btn=>btn.addEventListener('click',()=>clDeleteCat(btn.dataset.dcat,btn.dataset.dcname)));
}

function clOpenAddCat(){
  clEditCatId=null;
  document.getElementById('cl-cm-title').textContent='📂 Add Category';
  document.getElementById('cl-cm-save').textContent='💾 Save';
  ['cl-c-id','cl-c-name','cl-c-desc'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('cl-c-id').disabled=false;
  document.getElementById('cl-cat-modal').style.display='flex';
}
function clOpenEditCat(id){
  const cat=clCats.find(c=>c.id===id); if(!cat) return;
  clEditCatId=id;
  document.getElementById('cl-cm-title').textContent='✏️ Edit Category';
  document.getElementById('cl-cm-save').textContent='💾 Update';
  document.getElementById('cl-c-id').value=cat.id; document.getElementById('cl-c-id').disabled=true;
  document.getElementById('cl-c-name').value=cat.name||'';
  document.getElementById('cl-c-desc').value=cat.description||'';
  document.getElementById('cl-cat-modal').style.display='flex';
}
document.getElementById('cl-btn-add-cat').addEventListener('click',clOpenAddCat);
document.getElementById('cl-cm-cancel').addEventListener('click',()=>document.getElementById('cl-cat-modal').style.display='none');
document.getElementById('cl-cm-save').addEventListener('click',async()=>{
  const clientId=clClientData?.id; if(!clientId) return;
  const id=document.getElementById('cl-c-id').value.trim().toLowerCase().replace(/\s+/g,'-');
  const name=document.getElementById('cl-c-name').value.trim();
  if(!id||!name){toast('❌ ID and Name required!','err');return;}
  const data={id,name,description:document.getElementById('cl-c-desc').value.trim(),iconName:'Grid',slug:id,tags:[],count:0};
  const btn=document.getElementById('cl-cm-save'); btn.textContent='⏳...'; btn.disabled=true;
  try{
    await set(ref(db,`clients/${clientId}/categories/${id}`),data);
    toast(`✅ Category "${name}" saved!`);
    document.getElementById('cl-cat-modal').style.display='none';
  }catch(e){toast('❌ '+e.message,'err');}
  finally{btn.textContent='💾 Save';btn.disabled=false;}
});
async function clDeleteCat(id,name){
  if(!confirm(`Delete "${name}"?`)) return;
  try{ await remove(ref(db,`clients/${clClientData?.id}/categories/${id}`)); toast('🗑️ Category deleted'); }
  catch(e){ toast('❌ '+e.message,'err'); }
}

// EARNING
function clRenderEarning(){
  if(!clClientData) return;
  const pct=clClientData.earningPercent||40;
  const hist=clClientData.earningHistory||{};
  document.getElementById('cl-earn-tbody').innerHTML = Object.values(hist).reverse().map(r=>`
    <tr>
      <td style="font-size:11px;font-family:monospace">${new Date(r.t).toLocaleDateString()}</td>
      <td style="color:var(--grn)">₹${(r.amount||0).toFixed(0)}</td>
      <td style="color:var(--blu);font-weight:700">₹${((r.amount||0)*pct/100).toFixed(0)}</td>
      <td style="font-size:11px;color:var(--mu)">${r.note||'—'}</td>
    </tr>`).join('')
  || '<tr><td colspan="4"><div class="empty"><div class="eic">💰</div>No earning history yet</div></td></tr>';
}

// ── INIT ───────────────────────────────────────────────────────────────
document.getElementById('sa-nb-log').textContent = saActLog.length;
saRenderLog();

// Set base URL default
if (!localStorage.getItem('mnx_base_url')) {
  localStorage.setItem('mnx_base_url', window.location.origin + window.location.pathname);
}
