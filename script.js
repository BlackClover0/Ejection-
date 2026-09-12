/* ══════════════════════════════════════════════════════════════════
   LOCK SCREEN LOGIC — merged in from site-lock.html.
   This is a front-door gate only: it hides #lockScreen once the right
   PIN is entered. It does NOT encrypt photos/files — encryptBlob /
   decryptBlob (called elsewhere for cloud sync) are separate and are
   not implemented here. sessionPin is still set on unlock so any code
   that reads it keeps working the same as before.
   ══════════════════════════════════════════════════════════════════ */
const PIN_KEY = 'pv_pin_hash';
const PIN_SALT = 'hope-vault-salt-v1';

let pinBuffer    = '';
let sessionPin   = '';
let settingPin   = false;
let tempPin      = '';
let changingPin  = false;
let changePinStep = 0;
let newPinTemp   = '';
let _pinSubmitting = false;

function _getPinHash() { return localStorage.getItem(PIN_KEY) || null; }
function _setPinHash(hash) { try { localStorage.setItem(PIN_KEY, hash); } catch(e) {} }

async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin + PIN_SALT));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
async function checkPin(pin) {
  const stored = _getPinHash();
  if (!stored) return null;
  return (await hashPin(pin)) === stored;
}
async function storePin(pin) { _setPinHash(await hashPin(pin)); }

function resetPin() {
  if (!confirm('Reset PIN? You\'ll set a new one on this device.')) return;
  localStorage.removeItem(PIN_KEY);
  pinBuffer = ''; settingPin = false; tempPin = ''; changingPin = false; changePinStep = 0; newPinTemp = '';
  updateDots();
  document.getElementById('lockSub').textContent = 'Create your 4-digit PIN';
  document.getElementById('setupMsg').textContent = '👆 Enter any 4 digits to create your PIN';
}

function pressKey(k) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += k; updateDots();
  if (pinBuffer.length === 4) setTimeout(submitPin, 120);
}
function delKey() { pinBuffer = pinBuffer.slice(0, -1); updateDots(); clearPinError(); }

function updateDots() {
  for (let i = 0; i < 4; i++) {
    const d = document.getElementById('d' + i);
    if (!d) continue;
    d.classList.toggle('filled', i < pinBuffer.length);
    d.classList.remove('error');
  }
}
function showPinError(msg) {
  for (let i = 0; i < 4; i++) {
    const d = document.getElementById('d' + i);
    if (!d) continue;
    d.classList.remove('filled'); d.classList.add('error');
  }
  const el = document.getElementById('pinError');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); pinBuffer = ''; updateDots(); }, 1600);
}
function clearPinError() { const el = document.getElementById('pinError'); if (el) el.classList.remove('show'); }

async function submitPin() {
  if (_pinSubmitting) return;
  _pinSubmitting = true;
  document.querySelectorAll('#lockScreen .key').forEach(k => { k.style.opacity = '0.5'; k.style.pointerEvents = 'none'; });
  try {
    if (changingPin) { await handleChangePinFlow(); return; }
    const stored = _getPinHash();
    if (!stored) {
      if (!settingPin) {
        tempPin = pinBuffer; settingPin = true; pinBuffer = ''; updateDots();
        document.getElementById('lockSub').textContent = 'Confirm your PIN';
        document.getElementById('setupMsg').textContent = '🔁 Enter the same PIN again to confirm';
      } else {
        const h1 = await hashPin(tempPin);
        const h2 = await hashPin(pinBuffer);
        if (h1 === h2) {
          await storePin(pinBuffer);
          sessionPin = pinBuffer;
          settingPin = false; tempPin = ''; pinBuffer = ''; updateDots();
          unlockVault();
        } else {
          showPinError("PINs don't match! Try again 😅");
          settingPin = false; tempPin = '';
          document.getElementById('lockSub').textContent = 'Create your 4-digit PIN';
          document.getElementById('setupMsg').textContent = '👆 Enter any 4 digits to create your PIN';
        }
      }
      return;
    }
    const ok = await checkPin(pinBuffer);
    if (ok === true) { sessionPin = pinBuffer; pinBuffer = ''; updateDots(); unlockVault(); }
    else if (ok === false) { showPinError('Wrong PIN! Try again 🙈'); }
  } catch(err) {
    showPinError('Error — try again');
  } finally {
    _pinSubmitting = false;
    document.querySelectorAll('#lockScreen .key').forEach(k => { k.style.opacity = ''; k.style.pointerEvents = ''; });
  }
}

function unlockVault() {
  document.getElementById('lockScreen').style.display = 'none';
}

function lockVault() {
  if (typeof closeSidebar === 'function') closeSidebar();
  sessionPin = '';
  pinBuffer = ''; settingPin = false; changingPin = false; tempPin = '';
  changePinStep = 0; newPinTemp = '';
  updateDots();
  document.getElementById('lockScreen').style.display = 'flex';
  document.getElementById('lockSub').textContent = 'Enter your PIN to unlock';
  document.getElementById('setupMsg').textContent = '';
}

function startChangePin() {
  if (typeof closeSidebar === 'function') closeSidebar();
  changingPin = true; changePinStep = 0;
  pinBuffer = ''; updateDots();
  setTimeout(() => {
    document.getElementById('lockScreen').style.display = 'flex';
    document.getElementById('lockSub').textContent = 'Enter your CURRENT PIN';
    document.getElementById('setupMsg').textContent = '🔑 Changing PIN — enter current PIN first';
  }, 60);
}

async function handleChangePinFlow() {
  if (changePinStep === 0) {
    const ok = await checkPin(pinBuffer);
    if (!ok) { showPinError('Wrong current PIN! 🙈'); return; }
    changePinStep = 1; pinBuffer = ''; updateDots();
    document.getElementById('lockSub').textContent = 'Enter your NEW PIN';
    document.getElementById('setupMsg').textContent = '✨ Choose a new 4-digit PIN';
  } else if (changePinStep === 1) {
    newPinTemp = pinBuffer; changePinStep = 2; pinBuffer = ''; updateDots();
    document.getElementById('lockSub').textContent = 'Confirm your NEW PIN';
    document.getElementById('setupMsg').textContent = '🔁 Enter the new PIN again to confirm';
  } else if (changePinStep === 2) {
    const h1 = await hashPin(pinBuffer);
    const h2 = await hashPin(newPinTemp);
    if (h1 !== h2) {
      showPinError("PINs don't match! 😅");
      changePinStep = 2; pinBuffer = ''; updateDots();
      document.getElementById('lockSub').textContent = 'Confirm your NEW PIN';
      document.getElementById('setupMsg').textContent = '🔁 Enter the new PIN again to confirm';
      return;
    }
    await storePin(newPinTemp);
    sessionPin = newPinTemp;
    changingPin = false; changePinStep = 0; newPinTemp = '';
    unlockVault();
    showToast('🔑 PIN changed!');
  }
}

/* Physical keyboard support while locked */
document.addEventListener('keydown', function(e) {
  const ls = document.getElementById('lockScreen');
  if (!ls || ls.style.display === 'none') return;
  if (e.key >= '0' && e.key <= '9') { e.preventDefault(); pressKey(e.key); }
  else if (e.key === 'Backspace')   { e.preventDefault(); delKey(); }
  else if (e.key === 'Enter')       { e.preventDefault(); submitPin(); }
});

document.addEventListener('DOMContentLoaded', () => {
  /* First time opening this file: no PIN stored yet → walk the user
     through creating one (enter 4 digits, then confirm the same 4
     digits again). submitPin() already handles this create+confirm
     flow whenever _getPinHash() comes back empty. */
  if (!_getPinHash()) {
    document.getElementById('lockSub').textContent = 'Create your 4-digit PIN';
    document.getElementById('setupMsg').textContent = '👆 Enter any 4 digits to create your PIN';
  }
});

/* ══ SHARED STATE ══ */
let photos        = [];
let folders       = [];
let activeFolder  = 'home';
let selectMode    = false;
let selected      = new Set();
let cardMap       = {};
let _galPage      = 0; // default: page 1 (Photos/homepage) — matches what's actually shown on load

/* ── Stub helpers ── */
function showToast(msg) {
  let t = document.getElementById('_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_toast';
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(30,30,30,0.95);color:white;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:700;z-index:99999;pointer-events:none;transition:opacity 0.3s;white-space:nowrap;max-width:90vw;';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.style.opacity = '0', 2400);
}
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function save() { try { localStorage.setItem('pv_folders', JSON.stringify(folders)); } catch(e) {} }
function load() { try { const f = localStorage.getItem('pv_folders'); if (f) folders = JSON.parse(f); } catch(e) {} }
function render() { showToast('📸 Gallery render (requires full app)'); }
function renderFolders() {}
function exitSelectMode() { selectMode = false; selected.clear(); document.getElementById('selectBanner').style.display = 'none'; }
function updateCardSelection() {}
function updateSelectBanner() { const e = document.getElementById('selCount'); if (e) e.textContent = selected.size + ' selected'; }
function openLightbox() { showToast('🔍 Lightbox (requires full app)'); }
function openCloudModal() { showToast('☁️ Telegram Cloud (requires full app)'); }
function openDisplayModal() { showToast('🎨 Display Settings (requires full app)'); }
function openBinModal() { showToast('🗑️ Bin (requires full app)'); }
function getRootFolderId(id) { const f = folders.find(x => x.id === id); return f?.parentId ? f.parentId : id; }
function openFolderActionSheet(f) { showToast('📁 Options for: ' + f.name); }
function installPWA() { showToast('📲 PWA install prompt'); }
function _goToPg2() { showToast('📂 Switching to Albums page'); }
function switchToPage(n) {}
function openAllFoldersSheet() { showToast('📁 All Folders (requires full app)'); }
function makeFolder() {
  showFolderNameModal({
    title: 'New Folder', subtitle: 'Give your folder a name',
    placeholder: 'e.g. Memories, Travel…', confirmLabel: 'Create',
    onConfirm: (n) => {
      if (!n) return;
      if (folders.some(f => f.name.toLowerCase() === n.toLowerCase() && !f.parentId)) { showToast('Folder already exists!'); return; }
      folders.push({ id: 'f_' + Date.now(), name: n });
      save(); renderFolders(); showToast('📁 Folder "' + n + '" created!');
      _buildFolderNav('');
    }
  });
}
function showFolderNameModal({ title, subtitle, placeholder, initialValue, confirmLabel, onConfirm }) {
  const modal = document.getElementById('folderNameModal');
  document.getElementById('fnm-title').textContent = title || '';
  document.getElementById('fnm-subtitle').textContent = subtitle || '';
  const inp = document.getElementById('fnm-input');
  inp.placeholder = placeholder || ''; inp.value = initialValue || '';
  modal.style.display = 'flex';
  setTimeout(() => inp.focus(), 80);
  document.getElementById('fnm-cancel').onclick = () => modal.style.display = 'none';
  document.getElementById('folderNameModal-bg').onclick = () => modal.style.display = 'none';
  document.getElementById('fnm-confirm').textContent = confirmLabel || 'OK';
  document.getElementById('fnm-confirm').onclick = () => { const v = inp.value.trim(); modal.style.display = 'none'; if (onConfirm) onConfirm(v); };
  inp.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('fnm-confirm').click(); };
}

function toggleSidebar() {
  // Header hamburger (pg1/homepage only) = select all.
  // The sidebar is no longer opened from here on page 2 — swipe right
  // on the homepage is the only way to open it now.
  if (typeof _galPage !== 'undefined' && _galPage === 0) {
    _selectAllAndOpenBanner();
    return;
  }
}

function _selectAllAndOpenBanner() {
  // Enter select mode if not already
  if (!selectMode) {
    selectMode = true;
    selected.clear();
    Object.values(cardMap).forEach(c => c.classList.remove('selected'));
    document.getElementById('selectBanner').style.display = 'flex';
  }
  // Select all currently visible photos
  const allIds = photos.map(p => p.id);
  allIds.forEach(id => {
    selected.add(id);
    updateCardSelection(id);
  });
  updateSelectBanner();
}

const SIDEBAR_TRANSITION = 'transform 0.52s cubic-bezier(0.16, 1, 0.3, 1)';

function _sidebarApplyProgress(progress) {
  // progress: 0 = fully closed, 1 = fully open
  const sb = document.getElementById('sidebar');
  const aw = document.getElementById('appWrap');
  const p  = Math.max(0, Math.min(1, progress));
  // Sidebar slides in from the left edge, full-page
  if (sb) sb.style.transform = `translateX(${(p - 1) * 100}%)`;
  // Homepage is pushed out fully to the right — true side-by-side slide,
  // same feel as the Photos ↔ Albums page transition (no scale/dim).
  if (aw) {
    aw.style.transform = `translateX(${(p * 100).toFixed(2)}%)`;
  }
}

/* Settle a drag that's already at some live in-between progress (0..1)
   into its final open/closed state, animating from wherever it currently
   sits instead of snapping back to 0 first. openSidebar()/closeSidebar()
   below are for the *click* paths, which always start from a fully known
   baseline (fully closed or fully open) and use a "reset then animate"
   double-rAF trick to guarantee the transition plays from that baseline.
   Reusing them at the end of a drag reintroduced that reset — the sidebar
   would snap instantly back to fully closed for a frame, then swing back
   open, which is the flicker/"moving left and right" glitch. This settles
   straight from the current drag position instead, exactly like the
   homepage↔page2 track just keeps animating from wherever the finger
   left it. */
let _sidebarSettleTimer = null;
function _sidebarSettle(open) {
  const sb = document.getElementById('sidebar');
  const aw = document.getElementById('appWrap');
  clearTimeout(_sidebarSettleTimer);
  window._sidebarIsOpen = open;
  if (sb) { sb.style.willChange = 'transform'; sb.style.transition = SIDEBAR_TRANSITION; }
  if (aw) aw.style.transition = SIDEBAR_TRANSITION;
  _sidebarApplyProgress(open ? 1 : 0);
  if (aw) aw.classList.toggle('sidebar-pushed', open);
  _sidebarSettleTimer = setTimeout(() => {
    if (sb) {
      sb.classList.toggle('sidebar-closed', !open);
      sb.style.willChange = 'auto';
    }
    if (aw && !open) {
      aw.style.transform    = '';
      aw.style.transition   = '';
      aw.style.pointerEvents = '';
    }
  }, 520);
}

/* Global sidebar open state — set immediately so swipe checks don't lag behind CSS class */
window._sidebarIsOpen = false;

/* Fix sidebar height on Android Chrome where 100vh/dvh doesn't fill screen reliably */
(function() {
  function _fixSidebarHeight() {
    var sb = document.getElementById('sidebar');
    if (sb) sb.style.setProperty('height', window.innerHeight + 'px', 'important');
  }
  window.addEventListener('resize', _fixSidebarHeight);
  window.addEventListener('orientationchange', function() {
    // Orientation change fires before innerHeight updates — wait one frame
    setTimeout(_fixSidebarHeight, 100);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', _fixSidebarHeight);
  }
  _fixSidebarHeight();
})();

function openSidebar() {
  const sb = document.getElementById('sidebar');
  const aw = document.getElementById('appWrap');
  if (!sb) return;

  // Highlight correct sidebar tab
  const tg = document.getElementById('sidebarTabGallery');
  const tc = document.getElementById('sidebarTabCollections');
  if (tg && tc) {
    const onPg2 = (typeof _galPage !== 'undefined' && _galPage === 1);
    tg.style.background = '#1c1c1e';
    tg.style.color       = onPg2 ? 'rgba(255,255,255,0.55)' : '#c8ad7a';
    tc.style.background  = '#1c1c1e';
    tc.style.color        = onPg2 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)';
  }

  window._sidebarIsOpen = true;

  // Step 1: position sidebar at closed state with NO transition
  sb.style.willChange = 'transform';
  sb.style.transition = 'none';
  sb.classList.remove('sidebar-closed');
  _sidebarApplyProgress(0);
  // Reset appWrap transitions so step 2 drives them cleanly
  if (aw) {
    aw.style.transition = 'none';
    // Force to initial (closed=0) position synchronously
    aw.style.transform = 'translateX(0%)';
  }

  // Step 2: next frame, apply transition and animate to open
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sb.style.transition = SIDEBAR_TRANSITION;
    if (aw) {
      aw.style.transition = SIDEBAR_TRANSITION;
    }
    _sidebarApplyProgress(1);
    if (aw) aw.classList.add('sidebar-pushed');
    // Remove will-change after animation ends
    setTimeout(() => { sb.style.willChange = 'auto'; }, 520);
  }));
}

function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const aw = document.getElementById('appWrap');
  if (!sb) return;

  // Mark closed immediately so swipe gestures unblock right away
  window._sidebarIsOpen = false;

  sb.style.willChange = 'transform';
  sb.style.transition = SIDEBAR_TRANSITION;
  // Also transition the appWrap slide back smoothly
  if (aw) {
    aw.style.transition = SIDEBAR_TRANSITION;
  }

  _sidebarApplyProgress(0);
  if (aw) aw.classList.remove('sidebar-pushed');

  setTimeout(() => {
    sb.classList.add('sidebar-closed');
    sb.style.willChange = 'auto';
    if (aw) {
      aw.style.transform    = '';
      aw.style.transition   = '';
      aw.style.pointerEvents = '';
    }
  }, 520);
}

function filterFolderNav(rawQuery) { _buildFolderNav(rawQuery.toLowerCase().trim()); }

function _buildFolderNav(query) {
  const nav = document.getElementById('navContainer');
  nav.innerHTML = '';

  // Home
  if (!query || 'home folders'.includes(query)) {
    const homeEl = document.createElement('div');
    homeEl.className = 'cursor-pointer p-2 rounded-xl mb-1 flex items-center gap-2 text-sm';
    homeEl.style.cssText = activeFolder === 'home'
      ? 'background:transparent;color:white;font-weight:700;'
      : 'color:rgba(255,255,255,0.5);font-weight:600;';
    homeEl.innerHTML = '<i class="fas fa-home" style="width:16px"></i> Home';
    homeEl.onclick = () => { activeFolder = 'home'; exitSelectMode(); render(); _buildFolderNav(query); closeSidebar(); };
    nav.appendChild(homeEl);
  }

  // Divider
  const div = document.createElement('div');
  div.style.cssText = 'height:1px;background:rgba(255,255,255,0.07);margin:6px 4px;';
  nav.appendChild(div);

  const topFolders = folders.filter(f => !f.parentId);

  if (query) {
    // ── SEARCH MODE: show matching folders, subfolders, and media ──
    let anyResult = false;

    // Matching top-level folders
    topFolders.filter(f => f.name.toLowerCase().includes(query)).forEach(f => {
      anyResult = true;
      const isActive = activeFolder === f.id || getRootFolderId(activeFolder) === f.id;
      const row = document.createElement('div');
      row.className = 'folder-row sa-purple';
      row.style.cssText = isActive
        ? 'background:rgba(255,255,255,0.09);color:white;font-weight:700;'
        : 'color:rgba(255,255,255,0.5);font-weight:600;';
      row.innerHTML = `<i class="fas fa-folder" style="color:rgba(255,255,255,0.6);width:16px"></i> ${escapeHtml(f.name)}`;
      row.onclick = () => { activeFolder = f.id; exitSelectMode(); render(); _buildFolderNav(query); closeSidebar(); };
      nav.appendChild(row);
    });

    // Matching subfolders
    folders.filter(sf => sf.parentId && sf.name.toLowerCase().includes(query)).forEach(sf => {
      anyResult = true;
      const parent = folders.find(f => f.id === sf.parentId);
      const row = document.createElement('div');
      row.className = 'folder-row sa-purple';
      row.style.cssText = activeFolder === sf.id
        ? 'background:rgba(255,255,255,0.09);color:white;font-weight:700;'
        : 'color:rgba(255,255,255,0.5);font-weight:600;';
      row.innerHTML = `<i class="fas fa-folder-open" style="color:rgba(255,255,255,0.6);width:16px"></i> <span style="opacity:0.55;font-size:11px;">${escapeHtml(parent?.name||'')} /</span> ${escapeHtml(sf.name)}`;
      row.onclick = () => { activeFolder = sf.id; exitSelectMode(); render(); _buildFolderNav(query); closeSidebar(); };
      nav.appendChild(row);
    });

    // Matching media files (images, GIFs, videos)
    const matchingPhotos = photos.filter(p => p.name.toLowerCase().includes(query));
    if (matchingPhotos.length > 0) {
      anyResult = true;
      const hdr = document.createElement('div');
      hdr.style.cssText = 'font-size:10px;font-weight:800;color:rgba(255,255,255,0.3);letter-spacing:0.07em;text-transform:uppercase;padding:6px 8px 2px;';
      hdr.textContent = `Files (${matchingPhotos.length})`;
      nav.appendChild(hdr);

      matchingPhotos.slice(0, 20).forEach(p => {
        const isVideo = p.mediaType === 'video';
        const isGif   = p.mediaType === 'gif' || p.name.toLowerCase().endsWith('.gif');
        const icon = isVideo ? '🎬' : (isGif ? '🎞️' : '🖼️');
        const row = document.createElement('div');
        row.className = 'folder-row sa-purple';
        row.style.cssText = 'color:rgba(255,255,255,0.5);font-weight:600;cursor:pointer;';
        const folderName = (() => {
          if (!p.folder || p.folder === 'home') return 'Home';
          const f = folders.find(x => x.id === p.folder);
          return f ? f.name : 'Home';
        })();
        row.innerHTML = `<span style="width:16px;text-align:center;">${icon}</span> <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.name)}</span><span style="font-size:9px;opacity:0.4;flex-shrink:0;">${escapeHtml(folderName)}</span>`;
        row.onclick = () => {
          // Navigate to the folder containing this photo and open lightbox
          const targetFolder = p.folder || 'home';
          activeFolder = targetFolder;
          exitSelectMode(); render(); _buildFolderNav(query); closeSidebar();
          // Open lightbox after render
          setTimeout(() => {
            let list;
            if (targetFolder === 'home') list = photos.slice();
            else list = photos.filter(x => x.folder === targetFolder);
            const idx = list.findIndex(x => x.id === p.id);
            if (idx >= 0) openLightbox(idx, list);
          }, 80);
        };
        nav.appendChild(row);
      });
      if (matchingPhotos.length > 20) {
        const more = document.createElement('div');
        more.className = 'nav-no-results';
        more.textContent = `+${matchingPhotos.length - 20} more results`;
        nav.appendChild(more);
      }
    }

    if (!anyResult) {
      const msg = document.createElement('div');
      msg.className = 'nav-no-results';
      msg.textContent = 'No results for "' + query + '"';
      nav.appendChild(msg);
    }
    return;
  }

  // ── DEFAULT MODE: show top-level folders ──
  topFolders.forEach(f => {
    const isActive = activeFolder === f.id || getRootFolderId(activeFolder) === f.id;
    const row = document.createElement('div');
    row.className = 'folder-row sa-purple';
    row.style.cssText = isActive
      ? 'background:rgba(255,255,255,0.09);color:white;font-weight:700;'
      : 'color:rgba(255,255,255,0.5);font-weight:600;';

    const subCount = folders.filter(sf => sf.parentId === f.id).length;
    const label = document.createElement('span');
    label.className = 'flex items-center gap-2 flex-1 cursor-pointer truncate';
    label.innerHTML = `<i class="fas fa-folder" style="color:rgba(255,255,255,0.6);width:16px"></i> ${escapeHtml(f.name)}${subCount ? `<span style="font-size:10px;opacity:0.5;margin-left:2px">(${subCount})</span>` : ''}`;
    label.onclick = () => { activeFolder = f.id; exitSelectMode(); render(); _buildFolderNav(query); closeSidebar(); };

    const optBtn = document.createElement('button');
    optBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
    optBtn.title = 'Folder options';
    optBtn.className = 'rename-btn ml-auto px-2';
    optBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;opacity:0.55;transition:opacity 0.15s;color:rgba(255,255,255,0.5);flex-shrink:0;';
    optBtn.onclick = (e) => { e.stopPropagation(); openFolderActionSheet(f); };

    row.appendChild(label); row.appendChild(optBtn);
    nav.appendChild(row);
  });
}

/* ══ INIT ══ */
document.addEventListener('DOMContentLoaded', () => {
  load();

  /* Add a demo "Create Folder" row at top of sidebar nav area for preview */
  const nav = document.getElementById('navContainer');
  if (nav) {
    const createBtn = document.createElement('div');
    createBtn.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;cursor:pointer;color:rgba(200,173,122,0.9);font-size:14px;font-weight:700;margin-bottom:4px;border:1px dashed rgba(200,173,122,0.3);';
    createBtn.innerHTML = '<i class="fas fa-folder-plus" style="width:16px;text-align:center;"></i> New Folder';
    createBtn.onclick = makeFolder;
    nav.appendChild(createBtn);
  }

  /* Render folder nav */
  _buildFolderNav('');

  /* Search input wiring (if present) */
  const searchEl = document.getElementById('folderSearch');
  if (searchEl) searchEl.addEventListener('input', e => filterFolderNav(e.target.value));

  /* Sidebar swipe-to-close (right→left drag) — mirrors the homepage's
     swipe-to-open feel: same low commit threshold, same fling detection,
     and both the sidebar AND appWrap frozen (no CSS transition) while
     the finger is actively dragging, so they track 1:1 instead of the
     appWrap chasing a moving target through its own 0.52s animation. */
  let startX = 0, lastX = 0, lastT = 0, velocity = 0, dragging = false;
  const CLOSE_COMMIT = 0.10;  // match SIDEBAR_COMMIT on the homepage — gentle, small swipe
  const FLING_SPEED  = 0.5;   // px/ms — same fling threshold as the homepage handler
  const sb = document.getElementById('sidebar');
  const aw = document.getElementById('appWrap');
  if (sb) {
    sb.addEventListener('touchstart', e => {
      startX = lastX = e.touches[0].clientX;
      lastT = Date.now();
      velocity = 0;
      dragging = false;
    }, { passive: true });
    sb.addEventListener('touchmove', e => {
      const x = e.touches[0].clientX;
      const dx = startX - x;
      if (!dragging && dx > 10) {
        dragging = true;
        // Freeze BOTH layers the instant the drag is recognized — this is
        // the fix: previously only sb was frozen here, so aw kept animating
        // toward whatever target it last had queued.
        sb.style.willChange = 'transform';
        sb.style.transition = 'none';
        if (aw) aw.style.transition = 'none';
      }
      if (dragging && window._sidebarIsOpen) {
        const now = Date.now();
        const dt = Math.max(1, now - lastT);
        velocity = (x - lastX) / dt;
        lastX = x; lastT = now;
        const progress = Math.max(0, Math.min(1, 1 - (dx / window.innerWidth)));
        _sidebarApplyProgress(progress);
      }
    }, { passive: true });
    sb.addEventListener('touchend', e => {
      if (!dragging) { dragging = false; return; }
      const dx = startX - e.changedTouches[0].clientX;
      const flinging = Math.abs(velocity) > FLING_SPEED;
      _sidebarSettle(!(dx > window.innerWidth * CLOSE_COMMIT || (flinging && dx > 0)));
      dragging = false;
    }, { passive: true });
    sb.addEventListener('touchcancel', () => {
      if (dragging) _sidebarSettle(true);
      dragging = false;
    }, { passive: true });
  }
});

(function () {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function greetingForHour(hrs) {
    if (hrs >= 5 && hrs < 12)  return 'Good morning';
    if (hrs >= 12 && hrs < 17) return 'Good afternoon';
    if (hrs >= 17 && hrs < 21) return 'Good evening';
    return 'Good night';
  }

  function updateDateTime() {
    var now = new Date();
    var weekdayEl = document.getElementById('dcWeekday');
    var fullDateEl = document.getElementById('dcFullDate');
    var timeEl = document.getElementById('dcTime');
    var topTimeEl = document.getElementById('gbTime');
    var gbWeekdayEl = document.getElementById('gbWeekday');
    var gbGreetingEl = document.getElementById('gbGreeting');
    var gbDateEl = document.getElementById('gbDate');

    var weekdayName = WEEKDAYS[now.getDay()];
    var fullDate = MONTHS_FULL[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
    var shortDate = now.getDate() + ' ' + MONTHS_FULL[now.getMonth()].slice(0, 3) + ', ' + now.getFullYear();

    if (weekdayEl) weekdayEl.textContent = weekdayName;
    if (fullDateEl) fullDateEl.textContent = fullDate;

    var hrs = now.getHours();
    var ampm = hrs >= 12 ? 'pm' : 'am';
    var h12 = hrs % 12; if (h12 === 0) h12 = 12;
    var timeStr = h12 + ':' + pad(now.getMinutes()) + ' ' + ampm;
    if (timeEl) timeEl.textContent = timeStr;
    if (topTimeEl) topTimeEl.textContent = timeStr;

    if (gbWeekdayEl) gbWeekdayEl.textContent = weekdayName;
    if (gbGreetingEl) gbGreetingEl.textContent = greetingForHour(hrs);
    if (gbDateEl) gbDateEl.textContent = shortDate;
  }

  // Tracks whether the storage card is currently showing item count instead of usage
  window._storageCardShowingItems = false;

  function syncStats() {
    var headerCount = document.getElementById('statCount');
    var headerStorage = document.getElementById('storageUsageLabel');
    var storageValEl = document.getElementById('dcStorageValue');
    var storageLabelEl = document.getElementById('dcStorageLabel');
    var storageFillEl = document.getElementById('dcStorageFill');
    var progressWrap = document.getElementById('dcStorageProgressWrap');

    // Cache the raw numbers on the window so the click-toggle can use them anytime
    var topFileCountEl = document.getElementById('topFileCount');
    if (headerCount) {
      var countMatch = headerCount.textContent.match(/[\d,]+/);
      window._itemsCount = countMatch ? countMatch[0] : '0';
      if (topFileCountEl) topFileCountEl.textContent = headerCount.textContent;
    }

    if (headerStorage) {
      var parts = headerStorage.textContent.split('/');
      if (parts.length === 2) {
        window._storageUsedText = parts[0].trim();
        var used = parseFloat(parts[0]);
        var total = parseFloat(parts[1]);
        var usedIsGB = /gb/i.test(parts[0]);
        var totalIsGB = /gb/i.test(parts[1]);
        var usedMB = usedIsGB ? used * 1024 : used;
        var totalMB = totalIsGB ? total * 1024 : total;
        window._storagePct = totalMB > 0 ? Math.min(100, (usedMB / totalMB) * 100) : 0;
        window._storageTotalText = parts[1].trim();
      }
    }

    // Only repaint the visible face if we're not currently showing the flipped (items) view
    if (!window._storageCardShowingItems) {
      if (storageValEl && window._storageUsedText) storageValEl.textContent = window._storageUsedText;
      if (storageLabelEl && window._storageTotalText) storageLabelEl.textContent = 'of ' + window._storageTotalText + ' used';
      if (storageFillEl && window._storagePct !== undefined) storageFillEl.style.width = window._storagePct + '%';
      if (progressWrap) progressWrap.style.display = '';
    }
  }

  // Clicking the storage card flips it to show item count, click again to flip back
  window._toggleStorageView = function () {
    var storageValEl = document.getElementById('dcStorageValue');
    var storageLabelEl = document.getElementById('dcStorageLabel');
    var progressWrap = document.getElementById('dcStorageProgressWrap');
    window._storageCardShowingItems = !window._storageCardShowingItems;

    if (window._storageCardShowingItems) {
      if (storageValEl) storageValEl.textContent = (window._itemsCount || '0');
      if (storageLabelEl) storageLabelEl.textContent = 'items in vault';
      if (progressWrap) progressWrap.style.display = 'none';
    } else {
      if (storageValEl) storageValEl.textContent = window._storageUsedText || '0 MB';
      if (storageLabelEl) storageLabelEl.textContent = 'of ' + (window._storageTotalText || '25 GB') + ' used';
      if (progressWrap) progressWrap.style.display = '';
    }
  };

  // ── Placeholder navigation for cards that depend on parts of the app being joined later ──
  // Each function looks for the real handler first (by any of a few likely names),
  // and falls back to a quiet console note so nothing breaks in the meantime.
  // Once the rest of the file is merged in, wire the actual function name here if it differs.
  function _callFirstAvailable(candidateNames, cardLabel) {
    for (var i = 0; i < candidateNames.length; i++) {
      var fn = window[candidateNames[i]];
      if (typeof fn === 'function') { fn(); return; }
    }
    console.log('[dashboard card] "' + cardLabel + '" tapped — waiting to be wired up to the ' + cardLabel + ' page once that part of the app is joined in.');
  }

  window._goToPinned = function () {
    _callFirstAvailable(['openPinnedFolder', 'showPinned', 'goToPinned', 'openPinned'], 'Pinned');
  };
  window._goToBin = function () {
    _callFirstAvailable(['openBinFolder', 'showBin', 'goToBin', 'openBin', 'openTrash'], 'Bin');
  };
  window._goToAllFolders = function () {
    _callFirstAvailable(['openAllFoldersPage', 'showAllFolders', 'goToFolders', 'openFolders', 'renderFoldersPage'], 'My Folders');
  };

  updateDateTime();
  syncStats();
  setInterval(updateDateTime, 1000);
  setInterval(syncStats, 2000);
})();

document.addEventListener('click', function(e) {
  const menu = document.getElementById('afsDotMenu');
  const btn  = document.getElementById('afsDotBtn');
  if (menu && menu.style.display === 'block') {
    if (btn && btn.contains(e.target)) return;
    if (menu.contains(e.target)) return;
    menu.style.display = 'none';
  }
});

/* ── Page 2 JS: sort/grid menus, tab switching, collections nav,
     bin modal opener, All-Folders sheet + its folder/subfolder menus ── */

function _pg2StarredSetSort(s) {
  _pg2StarredSort = s;
  localStorage.setItem('pv_starredSort', s);
  document.getElementById('pg2StarredMenu').style.display = 'none';
  _pg2StarredUpdateMenu();
}


function _pg2StarredUpdateMenu() {
  ['name','date'].forEach(s => {
    const el = document.getElementById('pg2StarredSort' + (s === 'name' ? 'Name' : 'Date'));
    if (!el) return;
    const active = _pg2StarredSort === s;
    el.dataset.active   = active ? '1' : '';
    el.style.background = active ? '#3a3a3c' : '';
    el.style.color      = active ? 'white' : 'rgba(255,255,255,0.7)';
    el.style.fontWeight = active ? '700' : '600';
  });
}


function _pg2MediaSetSort(s) {
  _pg2MediaSort = s;
  localStorage.setItem('pv_mediaSort', s);
  document.getElementById('pg2MediaMenu').style.display = 'none';
  _pg2MediaUpdateMenu();
}


function _pg2MediaUpdateMenu() {
  ['name','date'].forEach(s => {
    const el = document.getElementById('pg2MediaSort' + (s === 'name' ? 'Name' : 'Date'));
    if (!el) return;
    const active = _pg2MediaSort === s;
    el.dataset.active   = active ? '1' : '';
    el.style.background = active ? '#3a3a3c' : '';
    el.style.color      = active ? 'white' : 'rgba(255,255,255,0.7)';
    el.style.fontWeight = active ? '700' : '600';
  });
}


function openBinModal() {
  closeSidebar();
  // Pre-fill API credentials
  const keyEl = document.getElementById('binApiKey');
  const secEl = document.getElementById('binApiSecret');
  if (keyEl) keyEl.value = API_KEY || '';
  if (secEl) secEl.value = API_SECRET || '';
  _renderBinItems();
  document.getElementById('binModal').classList.add('open');
  // Restore saved background
  try {
    var savedBg = localStorage.getItem('pv_bin_bg');
    if (savedBg === 'image') _setBinBg('image'); else if (savedBg === 'teal') _setBinBg('teal'); else _setBinBg('black');
  } catch(e) {}
  // Restore saved logo
  try {
    const saved = localStorage.getItem('pv_bin_logo');
    if (saved) { const img = document.getElementById('binHeaderLogo'); if (img) img.src = saved; }
  } catch(e) {}
}


function _switchTab(n) {
  if (n === 0 && _galPage !== 0) {
    switchToPage(0);
  } else if (n === 1 && _galPage !== 1) {
    switchToPage(1);
  }
}


function openAllFoldersSheet() {
  const sheet = document.getElementById('allFoldersSheet');
  if (!sheet) return;

  // Restore saved grid/sort prefs
  _afsGridCols = parseInt(localStorage.getItem('pv_afsGrid') || '3');
  _afsSortMode = localStorage.getItem('pv_afsSort') || 'name';

  // Reset search
  const searchEl = document.getElementById('allFoldersSearch');
  if (searchEl) searchEl.value = '';

  _allFoldersRender('');
  sheet.style.display = 'block';

  // Reset panel animation
  const panel = document.getElementById('allFoldersPanel');
  if (panel) { panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = 'afsSlideUp 0.58s cubic-bezier(0.22,1,0.36,1) both'; }

  // Sync menu button states
  setTimeout(_afsUpdateMenu, 50);

  // Push history so back button can close this sheet
  history.pushState({ nav: 'allFolders' }, '');
}


function _allFoldersRender(query) {
  const grid    = document.getElementById('allFoldersGrid');
  const emptyEl = document.getElementById('allFoldersEmpty');
  const label   = document.getElementById('allFoldersTotalLabel');
  if (!grid) return;

  // Apply saved grid cols
  const savedCols = typeof _afsGridCols !== 'undefined' ? _afsGridCols : parseInt(localStorage.getItem('pv_afsGrid') || '3');
  grid.style.gridTemplateColumns = 'repeat(' + savedCols + ',1fr)';

  const allFolders = (typeof folders !== 'undefined') ? folders : [];
  const allPhotos  = (typeof photos  !== 'undefined') ? photos  : [];
  const q = (query || '').toLowerCase().trim();

  const sortMode = typeof _afsSortMode !== 'undefined' ? _afsSortMode : (localStorage.getItem('pv_afsSort') || 'name');
  let baseFolders = allFolders.filter(f => !f.parentId);
  if (sortMode === 'date') {
    baseFolders = baseFolders.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  } else {
    baseFolders = baseFolders.sort((a,b) => a.name.localeCompare(b.name));
  }

  const topFolders = baseFolders.filter(f => !q || f.name.toLowerCase().includes(q));

  if (label) label.textContent = topFolders.length + (topFolders.length === 1 ? ' folder' : ' folders');

  grid.innerHTML = '';
  if (emptyEl) emptyEl.style.display = topFolders.length === 0 ? 'block' : 'none';
  if (topFolders.length === 0) return;

  topFolders.forEach((f, i) => {
    const subIds   = allFolders.filter(sf => sf.parentId === f.id).map(sf => sf.id);
    const allIds   = new Set([f.id, ...subIds]);
    const count    = allPhotos.filter(p => allIds.has(p.folder)).length;
    const subCount = subIds.length;

    const wrap = _buildFolderTile(f, count, subCount, {
      showPinBadge: true,
      onTap:        () => openFolderDetailPage(f.id),
      onLongPress:  (x, y) => _afsOpenFolderMenu(f, x, y),
    });
    wrap.style.animation = `popIn ${0.28 + i*0.04}s cubic-bezier(.34,1.56,.64,1) both`;
    wrap.style.animationDelay = `${i*0.03}s`;
    grid.appendChild(wrap);
  });
}


function _allFoldersFilter(val) { _allFoldersRender(val); }


function _afsOpenFolderMenu(f, tx, ty) {
  _afsFolderMenuTarget = f;
  const menuId = f.parentId ? 'afsSubMenu' : 'afsFolderMenu';
  const menu = document.getElementById(menuId);
  const bd   = document.getElementById('afsFolderMenuBackdrop');
  if (!menu) return;
  const titleEl = document.getElementById(f.parentId ? 'afsSubMenuTitle' : 'afsFolderMenuTitle');
  const starLbl = document.getElementById(f.parentId ? 'afsSubMenuStarLabel' : 'afsFolderMenuStarLabel');
  if (titleEl) titleEl.textContent = f.name;
  if (starLbl) starLbl.textContent = f.starred ? 'Unpin Folder' : 'Pin Folder';
  const mW = 228, mH = 268;
  let left = Math.min(tx, window.innerWidth  - mW - 10);
  let top  = Math.min(ty, window.innerHeight - mH - 10);
  left = Math.max(10, left); top = Math.max(60, top);
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  menu.style.opacity = '0'; menu.style.transform = 'scale(0.90)'; menu.style.display = 'block';
  bd.style.display = 'block';
  requestAnimationFrame(() => {
    menu.style.transition = 'opacity 0.15s, transform 0.15s cubic-bezier(.34,1.56,.64,1)';
    menu.style.opacity = '1'; menu.style.transform = 'scale(1)';
  });
}


function _afsCloseFolderMenu() {
  const m1 = document.getElementById('afsFolderMenu');
  const m2 = document.getElementById('afsSubMenu');
  const b  = document.getElementById('afsFolderMenuBackdrop');
  if (m1) { m1.style.display = 'none'; m1.style.transition = ''; }
  if (m2) { m2.style.display = 'none'; m2.style.transition = ''; }
  if (b) b.style.display = 'none';
  _afsFolderMenuTarget = null;
}


function _afsFolderMenuAction(action) {
  const f = _afsFolderMenuTarget;
  _afsCloseFolderMenu();
  if (!f) return;
  const _rerender = () => _allFoldersRender(document.getElementById('allFoldersSearch')?.value || '');

  if (action === 'rename') {
    setTimeout(() => { renameFolder(f.id, f.name); setTimeout(_rerender, 200); }, 120);

  } else if (action === 'createSub') {
    setTimeout(() => {
      showFolderNameModal({
        title: 'New Subfolder',
        subtitle: 'Inside: ' + f.name,
        placeholder: 'Subfolder name…',
        confirmLabel: 'Create',
        onConfirm: (name) => {
          if (!name) return;
          const newSub = { id: 'sf_' + Date.now(), name, parentId: f.id, createdAt: Date.now() };
          if (typeof folders !== 'undefined') { folders.push(newSub); save(); renderFolders(); }
          _rerender();
          showToast('📂 Subfolder "' + name + '" created!');
        }
      });
    }, 120);

  } else if (action === 'star') {
    f.starred = !f.starred; save(); renderFavStrip(); renderFolders();
    try { if (navigator.vibrate) navigator.vibrate(f.starred ? [30, 20, 30] : [25]); } catch(e) {}
    // Targeted pin badge update — no full re-render, no flicker
    const grid = document.getElementById('allFoldersGrid');
    if (grid) {
      const tileWrap = grid.querySelector('[data-folder-id="' + f.id + '"]');
      if (tileWrap) {
        const tile = tileWrap.querySelector('div'); // first child = the square tile
        if (tile) {
          // Remove existing pin badge if any
          const existing = tile.querySelector('.afs-pin-badge');
          if (existing) existing.remove();
          // Add badge if now starred
          if (f.starred) {
            const badge = document.createElement('div');
            badge.className = 'afs-pin-badge';
            badge.style.cssText = 'position:absolute;top:7px;right:7px;z-index:4;width:18px;height:18px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 1px 5px rgba(0,0,0,0.8));';
            badge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
            tile.appendChild(badge);
          }
        }
      } else {
        // Tile not visible (filtered out) — safe to re-render
        _rerender();
      }
    }
    // Update star label in menus
    const starLabel = document.getElementById('afsFolderMenuStarLabel');
    if (starLabel) starLabel.textContent = f.starred ? 'Unpin Folder' : 'Pin Folder';
    const subStarLabel = document.getElementById('afsSubMenuStarLabel');
    if (subStarLabel) subStarLabel.textContent = f.starred ? 'Unpin Folder' : 'Pin Folder';
    showToast(f.starred ? '📌 Folder pinned!' : '✖ Removed from pinned');

  } else if (action === 'download') {
    const subIds = (typeof folders !== 'undefined') ? folders.filter(sf => sf.parentId === f.id).map(sf => sf.id) : [];
    const allIds = new Set([f.id, ...subIds]);
    const targets = (typeof photos !== 'undefined') ? photos.filter(p => allIds.has(p.folder)) : [];
    if (targets.length === 0) { showToast('📂 Folder is empty'); return; }
    showToast('⬇️ Preparing ' + targets.length + ' file(s)…');
    (async () => {
      let done = 0;
      for (const img of targets) {
        try {
          let blob;
          if (img.storage === 'cloud' && img.encUrl) {
            blob = await decryptBlob(await fetchCloudBlob(img.encUrl), sessionPin);
          } else if (img.storage === 'idb' && img.encId) {
            const eb = await idbGet(img.encId); if (!eb) continue;
            blob = await decryptBlob(eb, sessionPin);
          } else if (img.encData) {
            const raw = atob(img.encData.split(',')[1] || img.encData);
            const arr = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
            blob = await decryptBlob(new Blob([arr]), sessionPin);
          } else continue;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = img.name || ('file_' + img.id);
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          done++;
          await new Promise(r => setTimeout(r, 300));
        } catch (e) { /* skip */ }
      }
      showToast('✅ Downloaded ' + done + '/' + targets.length + ' file(s)');
    })();

  } else if (action === 'delete') {
    showConfirmModal(
      'Delete "' + f.name + '"?',
      'Photos inside will be moved to Bin.',
      'Delete', '#ff4444',
      () => { deleteFolder(f.id); _rerender(); }
    );
  }
}


function closeAllFoldersSheet() {
  const sheet = document.getElementById('allFoldersSheet');
  const panel = document.getElementById('allFoldersPanel');
  if (!sheet || !panel) return;
  // Close dot menu if open
  const dm = document.getElementById('afsDotMenu');
  if (dm) dm.style.display = 'none';
  const dmb = document.getElementById('afsDotBackdrop');
  if (dmb) dmb.style.display = 'none';
  panel.style.animation = 'afsSlideOut 0.28s cubic-bezier(0.22,1,0.36,1) forwards';
  setTimeout(() => {
    sheet.style.display = 'none';
    panel.style.animation = '';
  }, 280);
}


function _collectGo(type) {
  _openCollectionPage(type);
}

/* ════════════════════════════════════════════════════════════════
   MISSING PIECE — added back in: this is what actually opens the
   Pinned / Picked / Images / Videos / GIFs / WebP overlays, plus the
   folder-detail page you land on when tapping into a Pinned folder.
   ════════════════════════════════════════════════════════════════ */
/* ── Media type helper ── */
function _getMediaType(fileOrPhoto) {
  const mimeType = (fileOrPhoto.type || '').toLowerCase();
  const name     = (fileOrPhoto.name || '').toLowerCase();
  if (mimeType.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv|m4v)$/.test(name)) return 'video';
  if (mimeType === 'image/gif'      || name.endsWith('.gif'))                         return 'gif';
  if (mimeType === 'image/webp'     || name.endsWith('.webp'))                        return 'webp';
  return 'image';
}

/* ── Folder tile builder (used by pg2 folder grids, All-Folders sheet, Pinned collection) ── */
function _buildFolderTile(f, count, subCount, opts) {
  opts = opts || {};
  const c = _folderColor(f.id);

  // Outer wrap — flex column: tile on top, name label below
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;align-self:start;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;';
  wrap.dataset.folderId = f.id;

  const tileBaseShadow = `0 2px 20px rgba(0,0,0,0.60)`;
  const tileHoverShadow = `0 4px 28px ${c.glow},0 2px 10px rgba(0,0,0,0.70)`;

  const tile = document.createElement('div');
  tile.style.cssText = `width:100%;aspect-ratio:1/1;border-radius:22px;overflow:hidden;background:${c.bg};border:1.5px solid ${c.border};box-shadow:${tileBaseShadow};display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;position:relative;transition:transform 0.2s cubic-bezier(.34,1.56,.64,1),box-shadow 0.22s;`;

  // Very subtle inner shine
  const shine = document.createElement('div');
  shine.style.cssText = 'position:absolute;top:0;left:0;right:0;height:38%;background:linear-gradient(180deg,rgba(255,255,255,0.04) 0%,transparent 100%);border-radius:20px 20px 0 0;pointer-events:none;z-index:1;';
  tile.appendChild(shine);

  // Pin badge (top-right inside tile)
  if (opts.showPinBadge && f.starred) {
    const badge = document.createElement('div');
    badge.className = 'afs-pin-badge';
    badge.style.cssText = 'position:absolute;top:7px;right:7px;z-index:4;width:18px;height:18px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 1px 5px rgba(0,0,0,0.8));';
    badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
    tile.appendChild(badge);
  }

  // Custom geometric SVG icon
  const iconWrap = document.createElement('div');
  iconWrap.style.cssText = `width:30px;height:30px;position:relative;z-index:2;flex-shrink:0;filter:drop-shadow(0 0 10px ${c.iconColor}) drop-shadow(0 0 5px ${c.iconColor}99);`;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox','0 0 32 32');
  svg.setAttribute('width','30'); svg.setAttribute('height','30');
  svg.setAttribute('fill', c.iconColor);
  const sid = c.svgId || 'icon_stripes3';

  if (sid === 'icon_stripes3') {
    // 3 horizontal chevron arrows pointing right — bold, dynamic
    // top chevron
    const mkChevron = (cy, op) => {
      const p = document.createElementNS(svgNS,'path');
      const h = 3.5;
      p.setAttribute('d', `M4,${cy-h} L20,${cy-h} L27,${cy} L20,${cy+h} L4,${cy+h} L10,${cy} Z`);
      p.setAttribute('fill-opacity', String(op));
      svg.appendChild(p);
    };
    mkChevron(8,  0.40);
    mkChevron(16, 0.70);
    mkChevron(24, 1.00);

  } else if (sid === 'icon_layers3') {
    // 3 stacked horizontal pills — clean stack layers
    [5, 13, 21].forEach((y, i) => {
      const r = document.createElementNS(svgNS,'rect');
      const w = 26 - i * 4;
      const x = (32 - w) / 2;
      r.setAttribute('x', String(x)); r.setAttribute('y', String(y));
      r.setAttribute('width', String(w)); r.setAttribute('height', '6');
      r.setAttribute('rx', '3');
      r.setAttribute('fill-opacity', i === 0 ? '0.40' : i === 1 ? '0.70' : '1.00');
      svg.appendChild(r);
    });

  } else if (sid === 'icon_bars3') {
    // 3 rounded ascending bars — signal style (the good one, keep it)
    [[3,22,7,8],[13,16,7,14],[23,10,7,20]].forEach(([x,y,w,h]) => {
      const r = document.createElementNS(svgNS,'rect');
      r.setAttribute('x',String(x)); r.setAttribute('y',String(y));
      r.setAttribute('width',String(w)); r.setAttribute('height',String(h));
      r.setAttribute('rx','3.5');
      svg.appendChild(r);
    });

  } else if (sid === 'icon_slabs') {
    // 4 small squares in 2x2 grid — clean tile/grid icon
    [[4,4],[18,4],[4,18],[18,18]].forEach(([x,y], i) => {
      const r = document.createElementNS(svgNS,'rect');
      r.setAttribute('x',String(x)); r.setAttribute('y',String(y));
      r.setAttribute('width','10'); r.setAttribute('height','10');
      r.setAttribute('rx','2.5');
      r.setAttribute('fill-opacity', [0.35, 0.55, 0.75, 1.00][i]);
      svg.appendChild(r);
    });

  } else if (sid === 'icon_steps') {
    // Radial burst — 6 rounded lines from center
    for (let i = 0; i < 6; i++) {
      const angle = (i * 60) * Math.PI / 180;
      const cx = 16, cy = 16;
      const r1 = 5, r2 = 13;
      const x1 = cx + r1 * Math.cos(angle);
      const y1 = cy + r1 * Math.sin(angle);
      const x2 = cx + r2 * Math.cos(angle);
      const y2 = cy + r2 * Math.sin(angle);
      const line = document.createElementNS(svgNS,'line');
      line.setAttribute('x1', x1.toFixed(1)); line.setAttribute('y1', y1.toFixed(1));
      line.setAttribute('x2', x2.toFixed(1)); line.setAttribute('y2', y2.toFixed(1));
      line.setAttribute('stroke', c.iconColor);
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
    }
    // center dot
    const dot = document.createElementNS(svgNS,'circle');
    dot.setAttribute('cx','16'); dot.setAttribute('cy','16'); dot.setAttribute('r','3');
    svg.appendChild(dot);
  }

  iconWrap.appendChild(svg);
  tile.appendChild(iconWrap);

  // Folder name INSIDE tile — dim/muted like Image 4
  const nameInside = document.createElement('div');
  nameInside.style.cssText = `font-size:11px;font-weight:700;text-align:center;line-height:1.2;word-break:break-word;max-width:90%;color:${c.nameColor};overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;padding:0 4px;position:relative;z-index:2;letter-spacing:0.01em;`;
  nameInside.textContent = f.name;
  tile.appendChild(nameInside);

  // Photo/sub count inside tile
  const countWrap = document.createElement('div');
  countWrap.style.cssText = 'position:relative;z-index:2;display:flex;align-items:center;gap:4px;';
  const countEl = document.createElement('div');
  countEl.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.28);font-weight:600;';
  countEl.textContent = count + (count === 1 ? ' photo' : ' photos');
  countWrap.appendChild(countEl);
  if (subCount > 0) {
    const subEl = document.createElement('div');
    subEl.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.25);font-weight:700;';
    subEl.textContent = '· ' + subCount + ' sub';
    countWrap.appendChild(subEl);
  }
  tile.appendChild(countWrap);

  wrap.appendChild(tile);

  // Name label BELOW tile (white, like Image 2)
  const nameBelow = document.createElement('div');
  nameBelow.style.cssText = 'font-size:11px;font-weight:600;text-align:center;color:rgba(255,255,255,0.55);line-height:1.25;word-break:break-word;max-width:100%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;padding:0 2px;letter-spacing:0.01em;';
  nameBelow.textContent = f.name;
  wrap.appendChild(nameBelow);

  // Hover/press interactions
  wrap.onmouseenter = () => { tile.style.transform = 'scale(1.05)'; tile.style.boxShadow = tileHoverShadow; };
  wrap.onmouseleave = () => { tile.style.transform = ''; tile.style.boxShadow = tileBaseShadow; };

  // Touch long-press + tap
  let _lpt, _lpX = 0, _lpY = 0, _lpFired = false;
  wrap.addEventListener('touchstart', e => {
    tile.style.transform = 'scale(0.93)';
    _lpFired = false;
    _lpX = e.touches[0].clientX; _lpY = e.touches[0].clientY;
    _lpt = setTimeout(() => {
      _lpFired = true;
      tile.style.transform = '';
      if (navigator.vibrate) navigator.vibrate(30);
      if (opts.onLongPress) opts.onLongPress(e.touches[0].clientX, e.touches[0].clientY);
    }, 500);
  }, { passive: true });
  wrap.addEventListener('touchend', () => { clearTimeout(_lpt); tile.style.transform = ''; }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    const dx = Math.abs(e.touches[0].clientX - _lpX), dy = Math.abs(e.touches[0].clientY - _lpY);
    if (dx > 10 || dy > 10) { clearTimeout(_lpt); tile.style.transform = ''; }
  }, { passive: true });
  wrap.oncontextmenu = e => { e.preventDefault(); if (opts.onLongPress) opts.onLongPress(e.clientX, e.clientY); };
  wrap.onclick = () => { if (_lpFired) { _lpFired = false; return; } if (opts.onTap) opts.onTap(); };

  return wrap;
}

/* ── Folder Detail Page + Collection Pages (Pinned/Picked/Images/Videos/GIFs/WebP overlays) ── */
function openFolderDetailPage(folderId) {
  const allFolders = (typeof folders !== 'undefined') ? folders : [];
  const allPhotos  = (typeof photos  !== 'undefined') ? photos  : [];
  const f = allFolders.find(x => x.id === folderId);
  if (!f) return;
  activeFolder = folderId; // so makeSubfolder() knows which folder we are in

  // Inject styles once
  if (!document.getElementById('_fdpKf')) {
    const s = document.createElement('style');
    s.id = '_fdpKf';
    s.textContent = `
      @keyframes fdpSlideUp    { from{transform:translateY(5%) scale(0.95);opacity:0} to{transform:translateY(0) scale(1);opacity:1} }
      @keyframes fdpSlideOut   { from{transform:translateY(0) scale(1);opacity:1} to{transform:translateY(5%) scale(0.97);opacity:0} }
      @keyframes fdpSlideRight { from{transform:translateX(100%);opacity:0.5} to{transform:translateX(0);opacity:1} }
      @keyframes fdpSlideLeft  { from{transform:translateX(-30%);opacity:0} to{transform:translateX(0);opacity:1} }
      #folderDetailOverlay .fdp-card { position:relative;border-radius:16px;overflow:hidden;cursor:pointer;aspect-ratio:1/1;transition:transform 0.18s cubic-bezier(.34,1.56,.64,1);-webkit-tap-highlight-color:transparent;background:#111; }
      #folderDetailOverlay .fdp-card:active { transform:scale(0.91); }
      #folderDetailOverlay .fdp-shimmer { position:absolute;inset:0;background:linear-gradient(110deg,rgba(255,255,255,0.05) 30%,rgba(255,255,255,0.12) 50%,rgba(255,255,255,0.05) 70%);background-size:200% 100%;animation:fdpShim 1.4s linear infinite; }
      @keyframes fdpShim { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      #fdpMenuDropdown { display:none;position:fixed;background:#2c2c2e;border:1px solid rgba(255,255,255,0.12);border-radius:14px;overflow:hidden;min-width:220px;box-shadow:0 8px 32px rgba(0,0,0,0.90);z-index:99999;animation:menuPop 0.15s ease; }
    `;
    document.head.appendChild(s);
  }

  // Build or reuse overlay
  let overlay = document.getElementById('folderDetailOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'folderDetailOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9650;display:flex;flex-direction:column;background:#000000;overflow:hidden;';
    document.body.appendChild(overlay);
  }

  // Animate in — slide from right if already inside a folder detail page (drilling into subfolder)
  const alreadyOpen = !!(overlay.style.display === 'flex' || overlay.style.display === '');
  overlay.style.animation = 'none';
  void overlay.offsetWidth;
  overlay.style.animation = alreadyOpen
    ? 'fdpSlideRight 0.32s cubic-bezier(0.25,0.46,0.45,0.94) both'
    : 'fdpSlideUp 0.52s cubic-bezier(0.22,1,0.36,1) both';
  overlay.style.display = 'flex';
  // Track where we came from so back goes to the right place
  const afsSheet = document.getElementById('allFoldersSheet');
  window._fdpOpenedFromAfs = !!(afsSheet && afsSheet.style.display === 'block');
  history.pushState({ nav: 'folderDetail', folderId }, '');

  // Collect photos (folder + subfolders)
  const subIds = allFolders.filter(sf => sf.parentId === f.id).map(sf => sf.id);
  const allIds = new Set([f.id, ...subIds]);
  let folderPhotos = allPhotos.filter(p => allIds.has(p.folder));

  // Saved grid cols + sort
  const savedCols = parseInt(localStorage.getItem('pv_fdpGrid_' + f.id) || '4');
  const savedSort = localStorage.getItem('pv_fdpSort_' + f.id) || 'newest';
  _fdpCurrentSort = savedSort;
  if (savedSort === 'oldest') folderPhotos = folderPhotos.slice().sort((a,b) => (a.addedAt||0)-(b.addedAt||0));
  else if (savedSort === 'name') folderPhotos = folderPhotos.slice().sort((a,b) => (a.name||'').localeCompare(b.name||''));
  else folderPhotos = folderPhotos.slice().sort((a,b) => (b.addedAt||0)-(a.addedAt||0));

  // Build or reuse the dropdown OUTSIDE the animated overlay (appended to body)
  let fdpDrop = document.getElementById('fdpMenuDropdown');
  if (!fdpDrop) {
    fdpDrop = document.createElement('div');
    fdpDrop.id = 'fdpMenuDropdown';
    fdpDrop.onclick = e => e.stopPropagation();
    document.body.appendChild(fdpDrop);
  }
  fdpDrop.innerHTML = `
    <div onclick="_fdpUpload();_fdpCloseMenu();" style="display:flex;align-items:center;gap:13px;padding:9px 16px;cursor:pointer;font-size:14px;font-weight:600;color:rgba(255,255,255,0.85);transition:background 0.1s;border-bottom:1px solid rgba(255,255,255,0.07);" onmouseenter="this.style.background='#242424'" onmouseleave="this.style.background=''"><i class="fas fa-plus" style="font-size:13px;width:18px;text-align:center;color:rgba(255,255,255,0.5);"></i>Add Files</div>
    ${f.parentId ? '' : `<div onclick="_fdpCreateSubfolder();_fdpCloseMenu();" style="display:flex;align-items:center;gap:13px;padding:9px 16px;cursor:pointer;font-size:14px;font-weight:600;color:rgba(255,255,255,0.85);transition:background 0.1s;border-bottom:1px solid rgba(255,255,255,0.07);" onmouseenter="this.style.background='#242424'" onmouseleave="this.style.background=''"><i class="fas fa-folder-plus" style="font-size:13px;width:18px;text-align:center;color:rgba(255,255,255,0.5);"></i>Create Subfolder</div>`}
    <div style="padding:8px 16px 3px;font-size:10px;font-weight:800;color:rgba(255,255,255,0.28);letter-spacing:0.08em;text-transform:uppercase;">Grid</div>
    <div id="fdpGrid2Btn" onclick="_fdpSetGrid(2)" style="display:flex;align-items:center;gap:13px;padding:9px 16px;cursor:pointer;font-size:14px;font-weight:600;color:rgba(255,255,255,0.7);transition:background 0.1s;" onmouseenter="if(!this.dataset.active)this.style.background='#242424'" onmouseleave="if(!this.dataset.active)this.style.background=''"><i class="fas fa-grip-lines" style="font-size:13px;width:18px;text-align:center;"></i>2 Columns</div>
    <div id="fdpGrid3Btn" onclick="_fdpSetGrid(3)" style="display:flex;align-items:center;gap:13px;padding:9px 16px;cursor:pointer;font-size:14px;font-weight:600;color:rgba(255,255,255,0.7);transition:background 0.1s;" onmouseenter="if(!this.dataset.active)this.style.background='#242424'" onmouseleave="if(!this.dataset.active)this.style.background=''"><i class="fas fa-grip" style="font-size:13px;width:18px;text-align:center;"></i>3 Columns</div>
    <div id="fdpGrid4Btn" onclick="_fdpSetGrid(4)" style="display:flex;align-items:center;gap:13px;padding:9px 16px;cursor:pointer;font-size:14px;font-weight:600;color:rgba(255,255,255,0.7);transition:background 0.1s;" onmouseenter="if(!this.dataset.active)this.style.background='#242424'" onmouseleave="if(!this.dataset.active)this.style.background=''"><i class="fas fa-th" style="font-size:13px;width:18px;text-align:center;"></i>4 Columns</div>
    <div style="height:1px;background:rgba(255,255,255,0.07);margin:0 14px;"></div>
    <div style="padding:8px 16px 3px;font-size:10px;font-weight:800;color:rgba(255,255,255,0.28);letter-spacing:0.08em;text-transform:uppercase;">Sort</div>
    <div id="fdpSortNewest" onclick="_fdpSetSort('newest')" style="display:flex;align-items:center;gap:13px;padding:9px 16px;cursor:pointer;font-size:14px;font-weight:600;color:rgba(255,255,255,0.7);transition:background 0.1s;" onmouseenter="if(!this.dataset.active)this.style.background='#242424'" onmouseleave="if(!this.dataset.active)this.style.background=''"><i class="fas fa-arrow-down-wide-short" style="font-size:13px;width:18px;text-align:center;"></i>Newest first</div>
    <div id="fdpSortOldest" onclick="_fdpSetSort('oldest')" style="display:flex;align-items:center;gap:13px;padding:9px 16px;cursor:pointer;font-size:14px;font-weight:600;color:rgba(255,255,255,0.7);transition:background 0.1s;" onmouseenter="if(!this.dataset.active)this.style.background='#242424'" onmouseleave="if(!this.dataset.active)this.style.background=''"><i class="fas fa-arrow-up-wide-short" style="font-size:13px;width:18px;text-align:center;"></i>Oldest first</div>
    <div id="fdpSortName" onclick="_fdpSetSort('name')" style="display:flex;align-items:center;gap:13px;padding:9px 16px 12px;cursor:pointer;font-size:14px;font-weight:600;color:rgba(255,255,255,0.7);transition:background 0.1s;" onmouseenter="if(!this.dataset.active)this.style.background='#242424'" onmouseleave="if(!this.dataset.active)this.style.background=''"><i class="fas fa-arrow-down-a-z" style="font-size:13px;width:18px;text-align:center;"></i>Name A–Z</div>
  `;
  fdpDrop.style.display = 'none';

  // Render full layout — three-dot button only, dropdown is outside
  overlay.innerHTML = `
    <!-- header -->
    <div style="flex-shrink:0;padding:18px 18px 0;background:#000000;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <button onclick="closeFolderDetailPage()"
          style="background:none;border:none;color:white;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.7));">
          <i class="fas fa-arrow-left"></i>
        </button>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;font-family:'Fredoka One',cursive;font-size:26px;line-height:1.2;overflow:visible;">
            <i class="fas fa-folder-open" style="color:rgba(255,255,255,0.45);font-size:20px;flex-shrink:0;display:flex;align-items:center;"></i>
            <span style="color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>
          </div>
          <div id="fdpCountLabel" style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.35);margin-top:2px;letter-spacing:0.03em;">${folderPhotos.length} ${folderPhotos.length===1?'photo':'photos'}</div>
        </div>
        <!-- three-dot button only — dropdown is appended to body to avoid animation clipping -->
        <button id="fdpMenuBtn" onclick="_fdpToggleMenu()"
          style="background:none;border:none;color:white;font-size:22px;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:50%;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.7));">
          <i class="fas fa-ellipsis-vertical"></i>
        </button>
      </div>
      <div style="height:1px;background:rgba(255,255,255,0.07);"></div>
    </div>
    <!-- scrollable grid wrapper — same padding/style as collection page -->
    <div style="padding:0 18px;flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;box-sizing:border-box;">
      <div id="fdpGrid" style="display:grid;grid-template-columns:repeat(${savedCols},1fr);gap:4px;align-content:start;padding-top:14px;padding-bottom:calc(env(safe-area-inset-bottom,0px)+80px);width:100%;box-sizing:border-box;"></div>
    </div>
    <!-- empty state -->
    <div id="fdpEmpty" style="display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);flex-direction:column;align-items:center;gap:8px;text-align:center;padding:24px;">
      <i class="fas fa-folder-open" style="font-size:44px;color:rgba(255,255,255,0.12);"></i>
      <div style="font-size:15px;font-weight:700;color:rgba(255,255,255,0.3);margin-top:8px;">This folder is empty</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.18);">Upload files to see them here</div>
    </div>
  `;

  // Store folderId on overlay for menu helpers
  overlay._fdpFolderId = f.id;
  _fdpUpdateGridBtns(savedCols);

  // Close menu on outside tap
  document.addEventListener('click', _fdpOutsideClick);

  // Render subfolder cards first
  const grid = document.getElementById('fdpGrid');
  const subFolders = allFolders.filter(sf => sf.parentId === f.id);

  const sfColorMap = [
    { bg:'linear-gradient(135deg,rgba(255,60,120,0.55),rgba(180,20,80,0.45))',  border:'rgba(255,100,160,0.70)', nameColor:'#ffb3d4', glow:'rgba(255,60,120,0.55)',  iconColor:'#ff80c0' },
    { bg:'linear-gradient(135deg,rgba(130,60,255,0.55),rgba(80,20,200,0.45))',  border:'rgba(160,100,255,0.70)', nameColor:'#c9a0ff', glow:'rgba(130,60,255,0.55)',  iconColor:'#c084fc' },
    { bg:'linear-gradient(135deg,rgba(20,180,160,0.55),rgba(10,120,110,0.45))', border:'rgba(40,220,200,0.70)',  nameColor:'#7dfff2', glow:'rgba(20,180,160,0.55)',  iconColor:'#3de8d8' },
    { bg:'linear-gradient(135deg,rgba(255,180,20,0.55),rgba(200,120,10,0.45))', border:'rgba(255,210,60,0.70)',  nameColor:'#ffe47a', glow:'rgba(255,180,20,0.55)',  iconColor:'#ffe04b' },
    { bg:'linear-gradient(135deg,rgba(255,100,30,0.55),rgba(200,50,10,0.45))',  border:'rgba(255,140,60,0.70)',  nameColor:'#ffc49a', glow:'rgba(255,100,30,0.55)',  iconColor:'#ff8c42' },
  ];

  subFolders.forEach((sf, sfIdx) => {
    const sfPhotos = allPhotos.filter(p => p.folder === sf.id);
    const sc = sfColorMap[sfIdx % sfColorMap.length];

    const sfWrap = document.createElement('div');
    sfWrap.dataset.sfId = sf.id;
    sfWrap.style.cssText = 'position:relative;align-self:start;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;';

    const sfCard = document.createElement('div');
    sfCard.style.cssText = `width:100%;aspect-ratio:1/1;border-radius:16px;overflow:hidden;cursor:pointer;background:${sc.bg};border:2px solid ${sc.border};box-shadow:inset 0 1px 0 rgba(255,255,255,0.12),0 4px 16px rgba(0,0,0,0.35);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px;box-sizing:border-box;position:relative;transition:transform 0.2s cubic-bezier(.34,1.56,.64,1),box-shadow 0.2s;user-select:none;-webkit-user-select:none;`;

    const sfShine = document.createElement('div');
    sfShine.style.cssText = 'position:absolute;top:0;left:0;right:0;height:42%;background:linear-gradient(180deg,rgba(255,255,255,0.06) 0%,transparent 100%);border-radius:14px 14px 0 0;pointer-events:none;z-index:1;';
    sfCard.appendChild(sfShine);

    sfCard.innerHTML += `
      <i class="fas fa-folder" style="font-size:26px;position:relative;z-index:2;color:${sc.iconColor};filter:drop-shadow(0 2px 8px ${sc.iconColor});"></i>
      <div style="font-size:10px;font-weight:800;color:${sc.nameColor};text-align:center;word-break:break-word;max-width:88%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;position:relative;z-index:2;user-select:none;-webkit-user-select:none;">${sf.name}</div>
      <div style="font-size:9px;color:rgba(255,255,255,0.45);font-weight:700;position:relative;z-index:2;user-select:none;-webkit-user-select:none;">${sfPhotos.length} photo${sfPhotos.length!==1?'s':''}</div>
    `;

    let _sfLpt, _sfLpX = 0, _sfLpY = 0, _sfLpFired = false;
    sfWrap.addEventListener('touchstart', e => {
      sfCard.style.transform = 'scale(0.94)';
      _sfLpFired = false;
      _sfLpX = e.touches[0].clientX; _sfLpY = e.touches[0].clientY;
      _sfLpt = setTimeout(() => {
        _sfLpFired = true;
        sfCard.style.transform = '';
        if (navigator.vibrate) navigator.vibrate(30);
        _afsOpenFolderMenu(sf, _sfLpX, _sfLpY);
      }, 500);
    }, {passive:true});
    sfWrap.addEventListener('touchend', () => { clearTimeout(_sfLpt); sfCard.style.transform = ''; }, {passive:true});
    sfWrap.addEventListener('touchmove', e => {
      const dx = Math.abs(e.touches[0].clientX - _sfLpX), dy = Math.abs(e.touches[0].clientY - _sfLpY);
      if (dx > 10 || dy > 10) { clearTimeout(_sfLpt); sfCard.style.transform = ''; }
    }, {passive:true});
    sfWrap.oncontextmenu = e => { e.preventDefault(); _afsOpenFolderMenu(sf, e.clientX, e.clientY); };
    sfWrap.onmouseenter = () => { sfCard.style.transform = 'scale(1.05)'; sfCard.style.boxShadow = `0 8px 28px ${sc.glow},inset 0 1px 0 rgba(255,255,255,0.15)`; };
    sfWrap.onmouseleave = () => { sfCard.style.transform = ''; sfCard.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.12),0 4px 16px rgba(0,0,0,0.35)'; };
    sfWrap.onclick = () => {
      if (_sfLpFired) { _sfLpFired = false; return; }
      openFolderDetailPage(sf.id);
    };

    sfWrap.appendChild(sfCard);
    grid.appendChild(sfWrap);
  });

  // Fix empty state — show only if no photos AND no subfolders
  const fdpEmpty = document.getElementById('fdpEmpty');
  if (fdpEmpty) fdpEmpty.style.display = (folderPhotos.length === 0 && subFolders.length === 0) ? 'flex' : 'none';

  // Render photo cards with decrypt
  folderPhotos.forEach((img, i) => {
    const card = document.createElement('div');
    card.className = 'fdp-card';
    card.style.animationDelay = (i * 0.03) + 's';

    // Shimmer + lock placeholder
    const shimmer = document.createElement('div');
    shimmer.className = 'fdp-shimmer';
    const lock = document.createElement('div');
    lock.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:font-size:18px;color:rgba(255,255,255,0.25);justify-content:center;align-items:center;font-size:18px;';
    lock.textContent = '\uD83D\uDD12';
    card.appendChild(shimmer);
    card.appendChild(lock);

    // Media type badge
    const mt = _getMediaType(img);
    if (mt === 'video') {
      const vb = document.createElement('div');
      vb.style.cssText = 'position:absolute;bottom:6px;left:6px;background:rgba(0,0,0,0.65);color:white;font-size:9px;padding:2px 6px;border-radius:20px;font-weight:800;z-index:5;display:flex;align-items:center;gap:3px;';
      vb.innerHTML = '<i class="fas fa-play" style="font-size:8px;"></i>'; card.appendChild(vb);
    } else if (mt === 'gif') {
      const gb = document.createElement('span');
      gb.style.cssText = 'position:absolute;top:6px;left:6px;background:rgba(255,110,180,0.85);color:white;font-size:9px;padding:2px 6px;border-radius:20px;font-weight:800;z-index:5;';
      gb.textContent = 'GIF'; card.appendChild(gb);
    }

    // Tap → lightbox
    let pressTimer, touchX = 0, touchY = 0, longPressActive = false;
    card.onclick = (e) => {
      if (longPressActive) { longPressActive = false; return; }
      const idx = folderPhotos.findIndex(x => x.id === img.id);
      if (typeof openLightbox === 'function') openLightbox(idx >= 0 ? idx : i, folderPhotos.slice());
    };
    card.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); }; // no context menu in folder overlay
    card.addEventListener('touchstart', (e) => { touchX=e.touches[0].clientX; touchY=e.touches[0].clientY; longPressActive=false; pressTimer=setTimeout(()=>{ longPressActive=true; }, 850); }, {passive:true});
    card.addEventListener('touchend', (e) => { clearTimeout(pressTimer); if(longPressActive)e.stopPropagation(); });
    card.addEventListener('touchmove', (e) => { if(Math.abs(e.touches[0].clientX-touchX)>14||Math.abs(e.touches[0].clientY-touchY)>14)clearTimeout(pressTimer); }, {passive:true});

    grid.appendChild(card);

    // Lazy-decrypt via IntersectionObserver
    const obs = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      obs.disconnect();
      _fdpDecryptThumb(img, shimmer, lock, card);
    }, { rootMargin: '200px' });
    obs.observe(card);
  });
}

/* ── Folder detail page helper functions ── */

function _fdpToggleMenu() {
  const dd  = document.getElementById('fdpMenuDropdown');
  const btn = document.getElementById('fdpMenuBtn');
  if (!dd || !btn) return;
  const open = dd.style.display === 'block';
  if (open) { dd.style.display = 'none'; return; }
  const r = btn.getBoundingClientRect();
  dd.style.top   = (r.bottom + 6) + 'px';
  dd.style.right = (window.innerWidth - r.right) + 'px';
  dd.style.display = 'block';
  _fdpUpdateGridBtns();
  _fdpUpdateSortBtns(typeof _fdpCurrentSort !== 'undefined' ? _fdpCurrentSort : 'newest');
}

function _fdpCloseMenu() {
  const dd = document.getElementById('fdpMenuDropdown');
  if (dd) dd.style.display = 'none';
}

function _fdpOutsideClick(e) {
  const btn = document.getElementById('fdpMenuBtn');
  const dd  = document.getElementById('fdpMenuDropdown');
  if (!dd || dd.style.display !== 'block') return;
  if (btn && btn.contains(e.target)) return;
  if (dd.contains(e.target)) return;
  _fdpCloseMenu();
}

function _fdpUpdateGridBtns(cols) {
  const grid = document.getElementById('fdpGrid');
  const current = cols || parseInt(grid?.style.gridTemplateColumns?.match(/repeat\((\d+)/)?.[1] || '4');
  [2,3,4].forEach(n => {
    const btn = document.getElementById('fdpGrid' + n + 'Btn');
    if (!btn) return;
    const active = n === current;
    btn.dataset.active   = active ? '1' : '';
    btn.style.background = active ? '#3a3a3c' : '';
    btn.style.color      = active ? 'white' : 'rgba(255,255,255,0.7)';
    btn.style.fontWeight = active ? '700' : '600';
  });
}

function _fdpSetGrid(n) {
  const grid = document.getElementById('fdpGrid');
  if (!grid) return;
  grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  _fdpUpdateGridBtns(n);
  _fdpCloseMenu();
  const overlay = document.getElementById('folderDetailOverlay');
  if (overlay?._fdpFolderId) localStorage.setItem('pv_fdpGrid_' + overlay._fdpFolderId, n);
}

let _fdpCurrentSort = 'newest';

function _fdpSetSort(mode) {
  _fdpCurrentSort = mode;
  const overlay = document.getElementById('folderDetailOverlay');
  if (overlay?._fdpFolderId) localStorage.setItem('pv_fdpSort_' + overlay._fdpFolderId, mode);
  _fdpUpdateSortBtns(mode);
  _fdpCloseMenu();

  // Re-sort the grid cards in place
  const grid = document.getElementById('fdpGrid');
  if (!grid) return;
  const allFolders2 = (typeof folders !== 'undefined') ? folders : [];
  const allPhotos2  = (typeof photos  !== 'undefined') ? photos  : [];
  const fId = overlay?._fdpFolderId;
  if (!fId) return;
  const subIds = allFolders2.filter(sf => sf.parentId === fId).map(sf => sf.id);
  const allIds = new Set([fId, ...subIds]);
  let fp = allPhotos2.filter(p => allIds.has(p.folder));
  if (mode === 'newest') fp = fp.slice().sort((a,b) => (b.addedAt||0)-(a.addedAt||0));
  else if (mode === 'oldest') fp = fp.slice().sort((a,b) => (a.addedAt||0)-(b.addedAt||0));
  else if (mode === 'name') fp = fp.slice().sort((a,b) => (a.name||'').localeCompare(b.name||''));
  // Re-open with sorted list (simplest approach for full re-render)
  openFolderDetailPage(fId);
}

function _fdpUpdateSortBtns(mode) {
  ['newest','oldest','name'].forEach(m => {
    const el = document.getElementById('fdpSort' + m.charAt(0).toUpperCase() + m.slice(1));
    if (!el) return;
    const active = m === mode;
    el.dataset.active   = active ? '1' : '';
    el.style.background = active ? '#3a3a3c' : '';
    el.style.color      = active ? 'white' : 'rgba(255,255,255,0.7)';
    el.style.fontWeight = active ? '700' : '600';
  });
}

function _fdpUpload() {
  // Upload files into the folder currently open in the detail page
  const overlay = document.getElementById('folderDetailOverlay');
  const fId = overlay?._fdpFolderId;
  if (fId) {
    const prevFolder = activeFolder;
    activeFolder = fId;
    const fi = document.getElementById('fileInput');
    if (fi) {
      const onDone = () => {
        fi.removeEventListener('change', onDone);
        // Refresh the detail page after upload
        setTimeout(() => {
          const allFolders2 = (typeof folders !== 'undefined') ? folders : [];
          const f2 = allFolders2.find(x => x.id === fId);
          if (f2) openFolderDetailPage(fId);
        }, 600);
      };
      fi.addEventListener('change', onDone);
      fi.click();
    }
  }
}

/* Create subfolder from within the folder detail page */
function _fdpCreateSubfolder() {
  const overlay = document.getElementById('folderDetailOverlay');
  const fId = overlay?._fdpFolderId;
  if (!fId) return;
  const allFolders2 = (typeof folders !== 'undefined') ? folders : [];
  const parent = allFolders2.find(x => x.id === fId);
  if (!parent || parent.parentId) return; // block sub-sub-folder creation
  showFolderNameModal({
    title: 'New Subfolder',
    subtitle: 'Inside: ' + parent.name,
    placeholder: 'Subfolder name…',
    confirmLabel: 'Create',
    onConfirm: (name) => {
      if (!name) return;
      const newSub = { id: 'sf_' + Date.now(), name, parentId: fId, createdAt: Date.now() };
      if (typeof folders !== 'undefined') { folders.push(newSub); save(); renderFolders(); }
      showToast('📂 Subfolder "' + name + '" created!');
      // Refresh in-place — no page re-open needed
      _fdpRefreshGrid(fId);
    }
  });
}

/* Refresh the folder detail grid in-place after subfolder add/delete/rename */
function _fdpRefreshGrid(fId) {
  const overlay = document.getElementById('folderDetailOverlay');
  if (!overlay) return;
  const allFolders2 = (typeof folders !== 'undefined') ? folders : [];
  const allPhotos2  = (typeof photos  !== 'undefined') ? photos  : [];
  const f = allFolders2.find(x => x.id === fId);
  if (!f) return;

  const grid = document.getElementById('fdpGrid');
  if (!grid) return;

  // Remove existing subfolder cards (they are first children before photo cards)
  const subFolders = allFolders2.filter(sf => sf.parentId === fId);
  const subIds = subFolders.map(sf => sf.id);

  // Clear only subfolder tiles (elements with data-sf-id) and re-inject
  grid.querySelectorAll('[data-sf-id]').forEach(el => el.remove());

  // Also remove the "no subfolders" placeholder if any
  const placeholder = grid.querySelector('[data-sf-placeholder]');
  if (placeholder) placeholder.remove();

  const sfColorMap = [
    { bg:'linear-gradient(135deg,rgba(255,60,120,0.55),rgba(180,20,80,0.45))',  border:'rgba(255,100,160,0.70)', nameColor:'#ffb3d4', glow:'rgba(255,60,120,0.55)',  iconColor:'#ff80c0' },
    { bg:'linear-gradient(135deg,rgba(130,60,255,0.55),rgba(80,20,200,0.45))',  border:'rgba(160,100,255,0.70)', nameColor:'#c9a0ff', glow:'rgba(130,60,255,0.55)',  iconColor:'#c084fc' },
    { bg:'linear-gradient(135deg,rgba(20,180,160,0.55),rgba(10,120,110,0.45))', border:'rgba(40,220,200,0.70)',  nameColor:'#7dfff2', glow:'rgba(20,180,160,0.55)',  iconColor:'#3de8d8' },
    { bg:'linear-gradient(135deg,rgba(255,180,20,0.55),rgba(200,120,10,0.45))', border:'rgba(255,210,60,0.70)',  nameColor:'#ffe47a', glow:'rgba(255,180,20,0.55)',  iconColor:'#ffe04b' },
    { bg:'linear-gradient(135deg,rgba(255,100,30,0.55),rgba(200,50,10,0.45))',  border:'rgba(255,140,60,0.70)',  nameColor:'#ffc49a', glow:'rgba(255,100,30,0.55)',  iconColor:'#ff8c42' },
  ];

  // Insert new subfolder cards at the start of the grid
  const fragment = document.createDocumentFragment();
  subFolders.forEach((sf, sfIdx) => {
    const sfPhotos = allPhotos2.filter(p => p.folder === sf.id);
    const sc = sfColorMap[sfIdx % sfColorMap.length];

    const sfWrap = document.createElement('div');
    sfWrap.dataset.sfId = sf.id;
    sfWrap.style.cssText = 'position:relative;align-self:start;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;';
    sfWrap.style.animation = 'popIn 0.28s cubic-bezier(.34,1.56,.64,1) both';

    const sfCard = document.createElement('div');
    sfCard.style.cssText = `width:100%;aspect-ratio:1/1;border-radius:16px;overflow:hidden;cursor:pointer;background:${sc.bg};border:2px solid ${sc.border};box-shadow:inset 0 1px 0 rgba(255,255,255,0.12),0 4px 16px rgba(0,0,0,0.35);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px;box-sizing:border-box;position:relative;transition:transform 0.2s cubic-bezier(.34,1.56,.64,1),box-shadow 0.2s;user-select:none;-webkit-user-select:none;`;

    const sfShine = document.createElement('div');
    sfShine.style.cssText = 'position:absolute;top:0;left:0;right:0;height:42%;background:linear-gradient(180deg,rgba(255,255,255,0.06) 0%,transparent 100%);border-radius:14px 14px 0 0;pointer-events:none;z-index:1;';
    sfCard.appendChild(sfShine);

    sfCard.innerHTML += `
      <i class="fas fa-folder" style="font-size:26px;position:relative;z-index:2;color:${sc.iconColor};filter:drop-shadow(0 2px 8px ${sc.iconColor});"></i>
      <div style="font-size:10px;font-weight:800;color:${sc.nameColor};text-align:center;word-break:break-word;max-width:88%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;position:relative;z-index:2;user-select:none;-webkit-user-select:none;">${sf.name}</div>
      <div style="font-size:9px;color:rgba(255,255,255,0.45);font-weight:700;position:relative;z-index:2;user-select:none;-webkit-user-select:none;">${sfPhotos.length} photo${sfPhotos.length!==1?'s':''}</div>
    `;

    let _sfLpt, _sfLpX = 0, _sfLpY = 0, _sfLpFired = false;
    sfWrap.addEventListener('touchstart', e => {
      sfCard.style.transform = 'scale(0.94)';
      _sfLpFired = false;
      _sfLpX = e.touches[0].clientX; _sfLpY = e.touches[0].clientY;
      _sfLpt = setTimeout(() => {
        _sfLpFired = true;
        sfCard.style.transform = '';
        if (navigator.vibrate) navigator.vibrate(30);
        _afsOpenFolderMenu(sf, _sfLpX, _sfLpY);
      }, 500);
    }, {passive:true});
    sfWrap.addEventListener('touchend', () => { clearTimeout(_sfLpt); sfCard.style.transform = ''; }, {passive:true});
    sfWrap.addEventListener('touchmove', e => {
      const dx = Math.abs(e.touches[0].clientX - _sfLpX), dy = Math.abs(e.touches[0].clientY - _sfLpY);
      if (dx > 10 || dy > 10) { clearTimeout(_sfLpt); sfCard.style.transform = ''; }
    }, {passive:true});
    sfWrap.oncontextmenu = e => { e.preventDefault(); _afsOpenFolderMenu(sf, e.clientX, e.clientY); };
    sfWrap.onmouseenter = () => { sfCard.style.transform = 'scale(1.05)'; sfCard.style.boxShadow = `0 8px 28px ${sc.glow},inset 0 1px 0 rgba(255,255,255,0.15)`; };
    sfWrap.onmouseleave = () => { sfCard.style.transform = ''; sfCard.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.12),0 4px 16px rgba(0,0,0,0.35)'; };
    sfWrap.onclick = () => {
      if (_sfLpFired) { _sfLpFired = false; return; }
      openFolderDetailPage(sf.id);
    };
    sfWrap.appendChild(sfCard);
    fragment.appendChild(sfWrap);
  });

  // Prepend all subfolder cards before photo cards
  grid.insertBefore(fragment, grid.firstChild);
}

/* ── Subfolder context menu inside folder detail page ── */
let _fdpSubMenuTarget = null;

function _fdpOpenSubMenu(sf, tx, ty) {
  _fdpSubMenuTarget = sf;
  let menu = document.getElementById('fdpSubMenu');
  let bd   = document.getElementById('fdpSubMenuBackdrop');
  if (!menu) {
    bd = document.createElement('div');
    bd.id = 'fdpSubMenuBackdrop';
    bd.style.cssText = 'position:fixed;inset:0;z-index:10200;';
    bd.onclick = _fdpCloseSubMenu;
    document.body.appendChild(bd);

    menu = document.createElement('div');
    menu.id = 'fdpSubMenu';
    menu.onclick = e => e.stopPropagation();
    menu.style.cssText = 'display:none;position:fixed;background:#1e1e22;border:1px solid rgba(255,255,255,0.13);border-radius:18px;overflow:hidden;min-width:220px;box-shadow:0 12px 44px rgba(0,0,0,0.92);z-index:10201;';
    menu.innerHTML = `
      <div id="fdpSubMenuTitle" style="padding:13px 16px 10px;font-size:13px;font-weight:800;color:white;border-bottom:1px solid rgba(255,255,255,0.07);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;"></div>
      <div onclick="_fdpSubMenuAction('rename')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;font-size:13px;font-weight:700;color:white;transition:background 0.12s;" onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background=''"><i class="fas fa-pen" style="width:16px;text-align:center;color:rgba(255,255,255,0.5);font-size:13px;"></i>Rename</div>
      <div onclick="_fdpSubMenuAction('open')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;font-size:13px;font-weight:700;color:white;transition:background 0.12s;" onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background=''"><i class="fas fa-folder-open" style="width:16px;text-align:center;color:rgba(255,255,255,0.5);font-size:13px;"></i>Open Subfolder</div>
      <div style="height:1px;background:rgba(255,255,255,0.07);margin:0 12px;"></div>
      <div onclick="_fdpSubMenuAction('delete')" style="display:flex;align-items:center;gap:12px;padding:12px 16px 13px;cursor:pointer;font-size:13px;font-weight:700;color:#ff6b6b;transition:background 0.12s;" onmouseenter="this.style.background='rgba(239,68,68,0.08)'" onmouseleave="this.style.background=''"><i class="fas fa-trash" style="width:16px;text-align:center;color:#ff6b6b;font-size:13px;"></i>Delete Subfolder</div>
    `;
    document.body.appendChild(menu);
  }

  document.getElementById('fdpSubMenuTitle').textContent = sf.name;
  const mW = 228, mH = 180;
  let left = Math.min(tx, window.innerWidth  - mW - 10);
  let top  = Math.min(ty, window.innerHeight - mH - 10);
  left = Math.max(10, left); top = Math.max(60, top);
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  menu.style.opacity = '0'; menu.style.transform = 'scale(0.90)'; menu.style.display = 'block';
  bd.style.display = 'block';
  requestAnimationFrame(() => {
    menu.style.transition = 'opacity 0.15s, transform 0.15s cubic-bezier(.34,1.56,.64,1)';
    menu.style.opacity = '1'; menu.style.transform = 'scale(1)';
  });
}

function _fdpCloseSubMenu() {
  const m = document.getElementById('fdpSubMenu');
  const b = document.getElementById('fdpSubMenuBackdrop');
  if (m) { m.style.display = 'none'; m.style.transition = ''; }
  if (b) b.style.display = 'none';
  _fdpSubMenuTarget = null;
}

function _fdpSubMenuAction(action) {
  const sf = _fdpSubMenuTarget;
  _fdpCloseSubMenu();
  if (!sf) return;

  if (action === 'rename') {
    setTimeout(() => {
      showFolderNameModal({
        title: 'Rename Subfolder',
        subtitle: sf.name,
        placeholder: 'New name…',
        confirmLabel: 'Rename',
        onConfirm: (name) => {
          if (!name) return;
          sf.name = name;
          save(); renderFolders();
          showToast('\u270F\uFE0F Renamed to "' + name + '"');
          const overlay = document.getElementById('folderDetailOverlay');
          if (overlay?._fdpFolderId) setTimeout(() => openFolderDetailPage(overlay._fdpFolderId), 100);
        }
      });
    }, 120);

  } else if (action === 'open') {
    activeFolder = sf.id;
    if (typeof exitSelectMode === 'function') exitSelectMode();
    if (typeof render === 'function') render();
    if (typeof renderFolders === 'function') renderFolders();

  } else if (action === 'delete') {
    showConfirmModal(
      'Delete "' + sf.name + '"?',
      'Photos inside will be moved to Bin.',
      'Delete', '#ff4444',
      () => {
        if (typeof deleteFolder === 'function') {
          deleteFolder(sf.id);
          const overlay = document.getElementById('folderDetailOverlay');
          if (overlay?._fdpFolderId) setTimeout(() => openFolderDetailPage(overlay._fdpFolderId), 100);
        }
      }
    );
  }
}


async function _fdpLoadCardThumb(card, p, shimmer, lock) {
  if (!card || !document.contains(card)) return;
  if (card._fdpDone) return;
  card._fdpDone = true;
  try {
    let encBlob;
    if (p.storage === 'cloud') {
      encBlob = await fetchCloudBlob(p.encUrl);
    } else if (p.storage === 'idb') {
      encBlob = await idbGet(p.encId);
    } else {
      encBlob = base64ToBlob(p.encData);
    }
    if (!encBlob || !document.contains(card)) return;
    const decBlob = await decryptBlob(encBlob, sessionPin);
    if (!document.contains(card)) { URL.revokeObjectURL(URL.createObjectURL(decBlob)); return; }
    const url = URL.createObjectURL(decBlob);
    const isVideo = _getMediaType(p) === 'video';
    shimmer.remove(); lock.remove();
    if (isVideo) {
      const vid = document.createElement('video');
      vid.src = url; vid.muted = true; vid.playsInline = true; vid.preload = 'metadata';
      vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;';
      vid.onloadedmetadata = () => { try { vid.currentTime = 0.1; } catch(e) {} };
      vid.onseeked = () => { vid.style.opacity='1'; };
      vid.oncanplay = () => { vid.style.opacity='1'; };
      setTimeout(() => { vid.style.opacity='1'; }, 1200);
      card.insertBefore(vid, card.firstChild);
      const play = document.createElement('div');
      play.innerHTML = '\u25B6';
      play.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.55);color:white;font-size:14px;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;z-index:5;pointer-events:none;';
      card.appendChild(play);
    } else {
      const img = document.createElement('img');
      img.src = url; img.alt = '';
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;';
      img.onload = () => { img.style.opacity='1'; setTimeout(()=>URL.revokeObjectURL(url),30000); };
      img.onerror = () => URL.revokeObjectURL(url);
      card.insertBefore(img, card.firstChild);
    }
  } catch(e) {
    // silently fail — leave lock icon visible
  }
}

function closeFolderDetailPage() {
  document.removeEventListener('click', _fdpOutsideClick);
  _fdpCloseMenu();
  const overlay = document.getElementById('folderDetailOverlay');
  if (!overlay) return;

  const fromAfs = !!window._fdpOpenedFromAfs;
  window._fdpOpenedFromAfs = false;

  overlay.style.animation = 'fdpSlideOut 0.28s cubic-bezier(0.22,1,0.36,1) forwards';
  setTimeout(() => {
    overlay.style.display = 'none';
    if (!fromAfs) {
      // Only reset pg2 cards if we didn't come from the allFoldersSheet
      _resetPg2Cards();
    }
    // If fromAfs: allFoldersSheet is still display:block behind the overlay — nothing to do
  }, 290);
}

/* ── Navigate from a collection card — opens a dedicated full-screen page ── */
function _collectGo(type) {
  _openCollectionPage(type);
}

/* ════════════════════════════════════════════════════════════
   COLLECTION PAGES — full-screen overlays for each tag type
   Each page is its own independent view (not the homepage).
   Files added via upload are reflected automatically via
   _refreshCollectionPage() which is called from within
   the existing upload/save flow via a hook below.
   ════════════════════════════════════════════════════════════ */

window._collectionPageOpen = null; // currently open type or null

const _COLL_META = {
  starred:    { title: 'Pinned', icon: 'fas fa-link', accent: '#ffe04b', kind: 'folders'  },
  favourites: { title: 'Picked',      icon: '__sharp_star__',   accent: '#ff6eb4', kind: 'photos'   },
  images:     { title: 'Images',          icon: 'far fa-image',   accent: '#3de8d8', kind: 'photos'   },
  videos:     { title: 'Videos',          icon: 'fas fa-video',   accent: '#a259ff', kind: 'photos'   },
  gifs:       { title: 'GIFs',            icon: '__gif_custom__', accent: '#ff8c42', kind: 'photos'   },
  webps:      { title: 'WebP',            icon: '__webp_custom__',   accent: '#4ade80', kind: 'photos'   },
};

function _openCollectionPage(type) {
  const meta = _COLL_META[type];
  if (!meta) return;

  window._collectionPageOpen = type;
  history.pushState({ nav: 'collectionPage', type }, '');

  // Build / get the overlay
  let overlay = document.getElementById('collectionPageOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'collectionPageOverlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:9600;display:flex;flex-direction:column;',
      'background:#000000;overflow:hidden;',
      'animation:cpSlideUp 0.58s cubic-bezier(0.22,1,0.36,1) both;',
      'padding-left:0;padding-right:0;',
    ].join('');

    // Inject keyframe once
    if (!document.getElementById('_cpKf')) {
      const s = document.createElement('style');
      s.id = '_cpKf';
      s.textContent = `
        @keyframes cpSlideUp   { from{transform:translateY(5%) scale(0.95);opacity:0} to{transform:translateY(0) scale(1);opacity:1} }
        @keyframes cpSlideOut  { from{transform:translateY(0) scale(1);opacity:1}      to{transform:translateY(5%) scale(0.97);opacity:0} }
        #collectionPageOverlay .cp-card { position:relative;border-radius:16px;overflow:hidden;cursor:pointer;aspect-ratio:1/1;transition:transform 0.18s cubic-bezier(.34,1.56,.64,1);-webkit-tap-highlight-color:transparent; }
        #collectionPageOverlay .cp-card:active { transform:scale(0.91); }
        #collectionPageOverlay .cp-shimmer { position:absolute;inset:0;background:linear-gradient(110deg,rgba(255,255,255,0.05) 30%,rgba(255,255,255,0.12) 50%,rgba(255,255,255,0.05) 70%);background-size:200% 100%;animation:cpShim 1.4s linear infinite; }
        @keyframes cpShim { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        #collectionPageOverlay .cp-lock { position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:18px;color:rgba(255,255,255,0.25); }
        #collectionPageOverlay .cp-folder { display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;-webkit-tap-highlight-color:transparent;min-width:0; }
        #collectionPageOverlay .cp-folder:active .cp-ftile { transform:scale(0.93); }
        #collectionPageOverlay .cp-ftile { width:100%;aspect-ratio:1/1;border-radius:18px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;position:relative;transition:transform 0.2s;overflow:hidden; }
        #cpGrid { flex:1; }
      `;
      document.head.appendChild(s);
    }

    document.body.appendChild(overlay);
  }

  // Reset animation
  overlay.style.animation = 'none';
  void overlay.offsetWidth;
  overlay.style.animation = 'cpSlideUp 0.58s cubic-bezier(0.22,1,0.36,1) both';
  overlay.style.display = 'flex';

  // Render header + grid
  _buildCollectionPageDOM(overlay, type, meta);
  _renderCollectionPageContent(type, meta);
}

function _buildCollectionPageDOM(overlay, type, meta) {
  // Build the fixed dropdown outside the animated overlay, appended to body
  let cpDrop = document.getElementById('cpMenuDropdown');
  if (!cpDrop) {
    cpDrop = document.createElement('div');
    cpDrop.id = 'cpMenuDropdown';
    cpDrop.onclick = e => e.stopPropagation();
    document.body.appendChild(cpDrop);
  }
  // Rebuild dropdown contents to match Albums style
  const addFilesRow = meta.kind === 'photos'
    ? `<div onclick="_cpUpload('${type}');_closeCpMenu();" style="display:flex;align-items:center;gap:13px;padding:13px 18px;cursor:pointer;font-size:15px;font-weight:600;color:rgba(255,255,255,0.85);transition:background 0.1s;border-bottom:1px solid rgba(255,255,255,0.07);" onmouseenter="this.style.background='#242424'" onmouseleave="this.style.background=''"><i class="fas fa-plus" style="font-size:13px;width:18px;text-align:center;color:#a259ff;"></i>Add Files</div>`
    : '';
  cpDrop.innerHTML = `
    ${addFilesRow}
    <div style="padding:10px 18px 4px;font-size:10px;font-weight:800;color:rgba(255,255,255,0.28);letter-spacing:0.08em;text-transform:uppercase;">Grid</div>
    <div id="cpGrid2Btn" onclick="_setCpGrid(2)" style="display:flex;align-items:center;gap:13px;padding:12px 18px;cursor:pointer;font-size:15px;font-weight:600;color:rgba(255,255,255,0.7);transition:background 0.1s;" onmouseenter="if(!this.dataset.active)this.style.background='#242424'" onmouseleave="if(!this.dataset.active)this.style.background=''"><i class="fas fa-grip-lines" style="font-size:13px;width:18px;text-align:center;"></i>2 Columns</div>
    <div id="cpGrid3Btn" onclick="_setCpGrid(3)" style="display:flex;align-items:center;gap:13px;padding:12px 18px;cursor:pointer;font-size:15px;font-weight:600;color:rgba(255,255,255,0.7);transition:background 0.1s;" onmouseenter="if(!this.dataset.active)this.style.background='#242424'" onmouseleave="if(!this.dataset.active)this.style.background=''"><i class="fas fa-grip" style="font-size:13px;width:18px;text-align:center;"></i>3 Columns</div>
    <div id="cpGrid4Btn" onclick="_setCpGrid(4)" style="display:flex;align-items:center;gap:13px;padding:12px 18px 16px;cursor:pointer;font-size:15px;font-weight:600;color:rgba(255,255,255,0.7);transition:background 0.1s;" onmouseenter="if(!this.dataset.active)this.style.background='#242424'" onmouseleave="if(!this.dataset.active)this.style.background=''"><i class="fas fa-th" style="font-size:13px;width:18px;text-align:center;"></i>4 Columns</div>
  `;
  cpDrop.style.cssText = 'display:none;position:fixed;background:#2c2c2e;border:1px solid rgba(255,255,255,0.12);border-radius:14px;overflow:hidden;min-width:220px;box-shadow:0 8px 32px rgba(0,0,0,0.90);z-index:99999;animation:menuPop 0.15s ease;';

  overlay.innerHTML = `
    <!-- header -->
    <div style="flex-shrink:0;padding:18px 18px 0;background:#000000;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <button id="cpBackBtn" onclick="_closeCollectionPage()"
          style="background:none;border:none;color:white;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.7));">
          <i class="fas fa-arrow-left"></i>
        </button>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:10px;font-family:'Fredoka One',cursive;font-size:26px;line-height:1;">
            ${meta.icon === '__sharp_star__'
              ? `<svg viewBox="0 0 100 108" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:22px;height:22px;flex-shrink:0;"><path d="M65.7 10.8 L65.8 43.4 L96.0 55.6 L65.0 65.7 L62.7 98.2 L43.5 71.9 L11.9 79.7 L31.0 53.3 L13.8 25.7 L44.8 35.7 Z" stroke="white" stroke-width="8" stroke-linejoin="round"/></svg>`
              : meta.icon === '__webp_custom__'
              ? `<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cG9seWdvbiBwb2ludHM9IjUsMyA5Nyw0NyA1LDQ3IiBmaWxsPSJ3aGl0ZSIvPjxwb2x5Z29uIHBvaW50cz0iNSw5NyA5Nyw1MyA1LDUzIiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==" style="width:22px;height:22px;object-fit:contain;flex-shrink:0;">`
              : `<i class="${meta.icon}" style="color:white;font-size:22px;flex-shrink:0;"></i>`
            }
            <span style="color:white;">${meta.title}</span>
          </div>
          <div id="cpCountLabel" style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.35);margin-top:2px;letter-spacing:0.03em;"></div>
        </div>
        <!-- three-dot button only — dropdown is appended to body to avoid animation clipping -->
        <button id="cpMenuBtn" onclick="_toggleCpMenu('${type}')"
          style="background:none;border:none;color:white;font-size:22px;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:50%;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.7));">
          <i class="fas fa-ellipsis-vertical"></i>
        </button>
      </div>
      <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent);margin-bottom:0;"></div>
    </div>
    <!-- content grid wrapper -->
    <div style="padding:0 18px;flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;box-sizing:border-box;">
    <div id="cpGrid" style="display:grid;grid-template-columns:repeat(${meta.kind==='folders'?3:4},1fr);gap:${meta.kind==='folders'?12:4}px;align-content:start;align-items:start;padding-top:14px;padding-bottom:calc(env(safe-area-inset-bottom,0px)+80px);width:100%;box-sizing:border-box;">
    </div>
    </div>
    <!-- empty state -->
    <div id="cpEmpty" style="display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;padding:24px;">
      <div style="font-size:52px;margin-bottom:12px;">${meta.icon === '__sharp_star__' ? `<svg viewBox="0 0 100 108" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:52px;height:52px;"><path d="M65.7 10.8 L65.8 43.4 L96.0 55.6 L65.0 65.7 L62.7 98.2 L43.5 71.9 L11.9 79.7 L31.0 53.3 L13.8 25.7 L44.8 35.7 Z" stroke="white" stroke-width="7" stroke-linejoin="round"/></svg>` : meta.icon === '__webp_custom__' ? `<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cG9seWdvbiBwb2ludHM9IjUsMyA5Nyw0NyA1LDQ3IiBmaWxsPSJ3aGl0ZSIvPjxwb2x5Z29uIHBvaW50cz0iNSw5NyA5Nyw1MyA1LDUzIiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==" style="width:52px;height:52px;object-fit:contain;">` : meta.icon === '__gif_custom__' ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:52px;height:52px;"><path d="M4 3.5 C4 2.5 5 2.2 5.8 2.7 L19 10.2 C19.8 10.7 19.8 11.8 19 12.3 L5.8 19.8 C5 20.3 4 19.9 4 18.9 Z" fill="white"/><path d="M3 14.5 Q10 12.5 20 13.5" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/></svg>` : `<i class="${meta.icon}" style="color:white;"></i>`}</div>
      <div style="font-size:16px;font-weight:800;color:rgba(255,255,255,0.8);">Nothing here yet</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:6px;">${meta.kind==='photos'?'Upload files to see them here':'Pin folders to see them here'}</div>
    </div>
  `;
}

function _renderCollectionPageContent(type, meta) {
  const grid    = document.getElementById('cpGrid');
  const empty   = document.getElementById('cpEmpty');
  const countEl = document.getElementById('cpCountLabel');
  if (!grid) return;

  // Restore saved grid cols
  const savedCols = parseInt(localStorage.getItem('pv_cpGrid_' + type) || (meta.kind === 'folders' ? '3' : '4'));
  grid.style.gridTemplateColumns = `repeat(${savedCols}, 1fr)`;
  grid.style.gap = meta.kind === 'folders' ? '12px' : '4px';

  grid.innerHTML = '';

  const allPhotos  = (typeof photos  !== 'undefined') ? photos  : [];
  const allFolders = (typeof folders !== 'undefined') ? folders : [];

  if (meta.kind === 'folders') {
    // ── Starred folders ──
    const starredFolders = allFolders.filter(f => f.starred);
    if (countEl) countEl.textContent = starredFolders.length + (starredFolders.length === 1 ? ' folder' : ' folders');
    if (starredFolders.length === 0) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    starredFolders.forEach((f, i) => {
      const subIds = allFolders.filter(sf => sf.parentId === f.id).map(sf => sf.id);
      const allIds = new Set([f.id, ...subIds]);
      const count  = allPhotos.filter(p => allIds.has(p.folder)).length;

      const wrap = _buildFolderTile(f, count, 0, {
        showPinBadge: false,
        onTap: () => { openFolderDetailPage(f.id); setTimeout(() => _closeCollectionPage(), 50); },
      });
      wrap.className = 'cp-folder';
      grid.appendChild(wrap);
    });

  } else {
    // ── Photo-based views ──
    let list;
    if (type === 'favourites') {
      list = allPhotos.filter(p => p.fav);
    } else if (type === 'videos') {
      list = allPhotos.filter(p => _getMediaType(p) === 'video');
    } else if (type === 'gifs') {
      list = allPhotos.filter(p => _getMediaType(p) === 'gif');
    } else if (type === 'webps') {
      list = allPhotos.filter(p => _getMediaType(p) === 'webp');
    } else {
      // images — use _getMediaType so a video added from Images section still shows in Videos
      list = allPhotos.filter(p => _getMediaType(p) === 'image');
    }

    if (countEl) countEl.textContent = list.length + ' ' + (type === 'videos' ? 'video' : type === 'gifs' ? 'GIF' : type === 'webps' ? 'WebP' : 'photo') + (list.length !== 1 ? 's' : '');
    if (list.length === 0) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    list.forEach((img, i) => {
      const card = document.createElement('div');
      card.className = 'cp-card';
      card.dataset.id = img.id;
      card.style.animationDelay = (i * 0.04) + 's';
      card.style.background = '#111';

      const shimmer = document.createElement('div');
      shimmer.className = 'cp-shimmer';
      const lock = document.createElement('div');
      lock.className = 'cp-lock';
      lock.textContent = '🔒';
      card.appendChild(shimmer);
      card.appendChild(lock);

      // Tap to open lightbox
      let pressTimer, touchX = 0, touchY = 0, longPressActive = false;
      card.onclick = (e) => {
        if (longPressActive) { longPressActive = false; return; }
        const idx = list.findIndex(x => x.id === img.id);
        openLightbox(idx >= 0 ? idx : i, list.slice());
      };
      card.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); }; // no context menu in collection overlays
      card.addEventListener('touchstart', (e) => { touchX=e.touches[0].clientX; touchY=e.touches[0].clientY; longPressActive=false; pressTimer=setTimeout(()=>{ longPressActive=true; }, 850); }, {passive:true});
      card.addEventListener('touchend', (e) => { clearTimeout(pressTimer); if(longPressActive)e.stopPropagation(); });
      card.addEventListener('touchmove', (e) => { if(Math.abs(e.touches[0].clientX-touchX)>14||Math.abs(e.touches[0].clientY-touchY)>14)clearTimeout(pressTimer); }, {passive:true});

      grid.appendChild(card);

      // Lazy-decrypt thumbnail using IntersectionObserver
      const _cpObs = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting) return;
        _cpObs.disconnect();
        card._cpDecrypting = true;
        _cpDecryptThumb(img, shimmer, lock, card);
      }, { rootMargin: '200px' });
      card._cpObs = _cpObs;
      _cpObs.observe(card);
    });
  }
}

/* Decrypt and show a thumbnail inside a collection page card */
async function _cpDecryptThumb(p, shimmer, lock, card) {
  if (!card || !document.contains(card)) return;
  if (card._cpDone) return; // already decrypted
  card._cpDone = true;
  try {
    let encBlob;
    if (p.storage === 'cloud') {
      encBlob = await fetchCloudBlob(p.encUrl);
    } else if (p.storage === 'idb') {
      encBlob = await idbGet(p.encId);
    } else {
      encBlob = base64ToBlob(p.encData);
    }
    if (!encBlob || !document.contains(card)) return;
    const decBlob = await decryptBlob(encBlob, sessionPin);
    if (!document.contains(card)) { URL.revokeObjectURL(URL.createObjectURL(decBlob)); return; }
    const url = URL.createObjectURL(decBlob);
    const isVideo = p.mediaType === 'video' || p.name?.match(/\.(mp4|webm|mov|avi|mkv|m4v)$/i);
    shimmer.remove(); lock.remove();
    if (isVideo) {
      const vid = document.createElement('video');
      vid.src = url; vid.muted = true; vid.playsInline = true; vid.preload = 'metadata';
      vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;';
      vid.onloadedmetadata = () => { try { vid.currentTime = 0.1; } catch(e) {} };
      vid.onseeked = () => { vid.style.opacity='1'; };
      vid.oncanplay = () => { vid.style.opacity='1'; };
      setTimeout(() => { vid.style.opacity='1'; }, 1200);
      card.insertBefore(vid, card.firstChild);
      const play = document.createElement('div');
      play.innerHTML = '▶';
      play.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.55);color:white;font-size:14px;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;z-index:5;pointer-events:none;';
      card.appendChild(play);
    } else {
      const img = document.createElement('img');
      img.src = url; img.alt = '';
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;';
      img.onload = () => { img.style.opacity='1'; setTimeout(()=>URL.revokeObjectURL(url),30000); };
      img.onerror = () => URL.revokeObjectURL(url);
      card.insertBefore(img, card.firstChild);
    }
  } catch(e) {
    // silently fail — leave lock icon
  }
}

/* Upload trigger for the Add button inside a collection page */
function _cpUpload(type) {
  // Set a pending filter so after upload the page knows what to show
  window._cpPendingUploadType = type;
  const fi = document.getElementById('fileInput');
  if (!fi) return;
  // Restore accept after use
  fi.click();
}

/* ── Nuke & rebuild pg2 list cards so WebKit can't persist squished row heights ── */
function _resetPg2Cards() {
  // Save badge values before wiping
  const starredN = (document.getElementById('ccStarredBadge')||{}).textContent||'0';
  const favsN    = (document.getElementById('ccFavsBadge')||{}).textContent||'0';
  const imgsN    = (document.getElementById('ccImagesBadge')||{}).textContent||'0';
  const vidsN    = (document.getElementById('ccVideosBadge')||{}).textContent||'0';
  const gifsN    = (document.getElementById('ccGifsBadge')||{}).textContent||'0';
  const webpsN   = (document.getElementById('ccWebpsBadge')||{}).textContent||'0';
  const binBadge = (document.getElementById('ccBinBadge')||{});
  const binText  = binBadge.textContent||'';
  const binShow  = binBadge.style && binBadge.style.display !== 'none';

  const sc = document.getElementById('pg2StarredCard');
  if (sc) sc.innerHTML = `
    <div class="pg2-row" onclick="openAllFoldersSheet()" style="border-bottom:0.5px solid rgba(255,255,255,0.09);">
      <i class="fas fa-folder-open" style="font-size:18px;color:rgba(255,255,255,0.92);width:24px;text-align:center;flex-shrink:0;"></i>
      <div style="flex:1;font-size:15px;font-weight:700;color:white;">My Folders</div>
      <span id="ccStarredBadge" style="font-size:14px;color:rgba(255,255,255,0.55);font-weight:600;margin-right:6px;">${starredN}</span>
      <i class="fas fa-chevron-right" style="color:rgba(255,255,255,0.35);font-size:12px;flex-shrink:0;"></i>
    </div>
    <div class="pg2-row" onclick="_collectGo('favourites')">
      <svg viewBox="0 0 100 108" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px;flex-shrink:0;"><path d="M65.7 10.8 L65.8 43.4 L96.0 55.6 L65.0 65.7 L62.7 98.2 L43.5 71.9 L11.9 79.7 L31.0 53.3 L13.8 25.7 L44.8 35.7 Z" stroke="white" stroke-width="8" stroke-linejoin="round"/></svg>
      <div style="flex:1;font-size:15px;font-weight:700;color:white;">Picked</div>
      <span id="ccFavsBadge" style="font-size:14px;color:rgba(255,255,255,0.55);font-weight:600;margin-right:6px;">${favsN}</span>
      <i class="fas fa-chevron-right" style="color:rgba(255,255,255,0.35);font-size:12px;flex-shrink:0;"></i>
    </div>`;

  const mc = document.getElementById('pg2MediaCard');
  if (mc) mc.innerHTML = `
    <div class="pg2-row pg2-media-row" onclick="_collectGo('images')" style="border-bottom:0.5px solid rgba(255,255,255,0.09);">
      <i class="far fa-image" style="font-size:20px;color:rgba(255,255,255,0.92);width:24px;text-align:center;flex-shrink:0;"></i>
      <div style="flex:1;font-size:15px;font-weight:700;color:white;">Images</div>
      <span id="ccImagesBadge" style="font-size:14px;color:rgba(255,255,255,0.55);font-weight:600;margin-right:6px;">${imgsN}</span>
      <i class="fas fa-chevron-right" style="color:rgba(255,255,255,0.35);font-size:12px;flex-shrink:0;"></i>
    </div>
    <div class="pg2-row pg2-media-row" onclick="_collectGo('videos')" style="border-bottom:0.5px solid rgba(255,255,255,0.09);">
      <i class="fas fa-video" style="font-size:18px;color:rgba(255,255,255,0.92);width:24px;text-align:center;flex-shrink:0;"></i>
      <div style="flex:1;font-size:15px;font-weight:700;color:white;">Videos</div>
      <span id="ccVideosBadge" style="font-size:14px;color:rgba(255,255,255,0.55);font-weight:600;margin-right:6px;">${vidsN}</span>
      <i class="fas fa-chevron-right" style="color:rgba(255,255,255,0.35);font-size:12px;flex-shrink:0;"></i>
    </div>
    <div class="pg2-row pg2-media-row" onclick="_collectGo('gifs')" style="border-bottom:0.5px solid rgba(255,255,255,0.09);">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:26px;height:26px;flex-shrink:0;"><path d="M4 3.5 C4 2.5 5 2.2 5.8 2.7 L19 10.2 C19.8 10.7 19.8 11.8 19 12.3 L5.8 19.8 C5 20.3 4 19.9 4 18.9 Z" fill="white"/><path d="M3 14.5 Q10 12.5 20 13.5" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/></svg>
      <div style="flex:1;font-size:15px;font-weight:700;color:white;">GIFs</div>
      <span id="ccGifsBadge" style="font-size:14px;color:rgba(255,255,255,0.55);font-weight:600;margin-right:6px;">${gifsN}</span>
      <i class="fas fa-chevron-right" style="color:rgba(255,255,255,0.35);font-size:12px;flex-shrink:0;"></i>
    </div>
    <div class="pg2-row pg2-media-row" onclick="_collectGo('webps')">
      <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cG9seWdvbiBwb2ludHM9IjUsMyA5Nyw0NyA1LDQ3IiBmaWxsPSJ3aGl0ZSIvPjxwb2x5Z29uIHBvaW50cz0iNSw5NyA5Nyw1MyA1LDUzIiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==" style="width:20px;height:20px;object-fit:contain;flex-shrink:0;margin-left:4px;">
      <div style="flex:1;font-size:15px;font-weight:700;color:white;">WebP</div>
      <span id="ccWebpsBadge" style="font-size:14px;color:rgba(255,255,255,0.55);font-weight:600;margin-right:6px;">${webpsN}</span>
      <i class="fas fa-chevron-right" style="color:rgba(255,255,255,0.35);font-size:12px;flex-shrink:0;"></i>
    </div>`;

  const mo = document.getElementById('pg2MoreCard');
  if (mo) mo.innerHTML = `
    <div id="ccBinTag" class="pg2-row" onclick="openBinModal()">
      <i class="fas fa-trash-can" style="font-size:20px;color:rgba(255,255,255,0.92);width:24px;text-align:center;flex-shrink:0;"></i>
      <div style="flex:1;font-size:15px;font-weight:700;color:white;">Bin</div>
      <span id="ccBinBadge" style="display:${binShow?'inline':'none'};font-size:14px;color:rgba(255,255,255,0.55);font-weight:600;margin-right:6px;">${binText}</span>
      <i class="fas fa-chevron-right" style="color:rgba(255,255,255,0.35);font-size:12px;flex-shrink:0;"></i>
    </div>`;
}

/* Close the collection page overlay */
function _closeCollectionPage() {
  const overlay = document.getElementById('collectionPageOverlay');
  if (!overlay) return;
  _closeCpMenu(); // hide dropdown immediately
  overlay.style.animation = 'cpSlideOut 0.28s cubic-bezier(0.22,1,0.36,1) forwards';
  setTimeout(() => {
    if (overlay) overlay.style.display = 'none';
    window._collectionPageOpen = null;
    _resetPg2Cards();
  }, 290);
}

/* Three-dot menu toggle */
let _cpMenuType = null;
function _toggleCpMenu(type) {
  _cpMenuType = type;
  const dd  = document.getElementById('cpMenuDropdown');
  const btn = document.getElementById('cpMenuBtn');
  if (!dd || !btn) return;
  const open = dd.style.display === 'block';
  if (open) { dd.style.display = 'none'; return; }
  const r = btn.getBoundingClientRect();
  dd.style.top   = (r.bottom + 6) + 'px';
  dd.style.right = (window.innerWidth - r.right) + 'px';
  dd.style.display = 'block';
  _updateCpGridBtns();
}
function _closeCpMenu() {
  const dd = document.getElementById('cpMenuDropdown');
  if (dd) dd.style.display = 'none';
}
function _updateCpGridBtns() {
  const grid = document.getElementById('cpGrid');
  if (!grid) return;
  const cols = parseInt(grid.style.gridTemplateColumns?.match(/repeat\((\d+)/)?.[1] || '3');
  [2,3,4].forEach(n => {
    const btn = document.getElementById('cpGrid' + n + 'Btn');
    if (!btn) return;
    const active = n === cols;
    btn.dataset.active   = active ? '1' : '';
    btn.style.background = active ? '#3a3a3c' : '';
    btn.style.color      = active ? 'white' : 'rgba(255,255,255,0.7)';
    btn.style.fontWeight = active ? '700' : '600';
  });
}
function _setCpGrid(n) {
  const grid = document.getElementById('cpGrid');
  if (!grid) return;
  const isFolders = _cpMenuType === 'starred';
  grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  grid.style.gap = isFolders ? '12px' : '4px';
  _updateCpGridBtns();
  localStorage.setItem('pv_cpGrid_' + (_cpMenuType || 'photos'), n);
}

/* Close cp menu on outside tap */
document.addEventListener('click', function(e) {
  const btn = document.getElementById('cpMenuBtn');
  const dd  = document.getElementById('cpMenuDropdown');
  if (!dd || dd.style.display !== 'block') return;
  if (btn && btn.contains(e.target)) return;
  if (dd.contains(e.target)) return;
  _closeCpMenu();
});

/* Handle hardware/browser back button */
// Collection page back is now handled in the main popstate handler above

/* Called automatically after any upload/save to refresh the open collection page */
function _refreshCollectionPage() {
  const type = window._collectionPageOpen;
  if (!type) return;
  const overlay = document.getElementById('collectionPageOverlay');
  if (!overlay || overlay.style.display === 'none') return;
  const meta = _COLL_META[type];
  if (!meta) return;
  _renderCollectionPageContent(type, meta);
}

/* Hook into the existing save() function to auto-refresh */
(function() {
  const _origSave = window.save;
  if (typeof _origSave === 'function') {
    window.save = function() {
      _origSave.apply(this, arguments);
      _refreshCollectionPage();
      _refreshCollectionsBadges();
    };
  }
})();




function _currentTabRightAction() {
  if (_galPage === 1) {
    if (typeof makeFolder === 'function') makeFolder();
  } else {
    const fi = document.getElementById('fileInput');
    if (fi) fi.click();
  }
}


function _toggleFolderMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('pg2FolderMenu');
  if (!menu) return;
  const open = menu.style.display === 'block';
  menu.style.display = open ? 'none' : 'block';
  if (!open) _updatePg2MenuState();
}


function _pg2MenuCreateFolder() {
  _closeFolderMenu();
  setTimeout(() => { if (typeof makeFolder === 'function') makeFolder(); }, 120);
}


function _pg2SetGrid(n) {
  _pg2GridCols = n;
  const list = document.getElementById('pg2FolderList');
  if (list) list.style.gridTemplateColumns = 'repeat(' + n + ',1fr)';
  _updatePg2MenuState();
}


function _pg2SetSort(s) {
  _pg2FolderSort = s;
  _closeFolderMenu();
  _updatePg2MenuState();
  if (typeof _refreshCollectionsBadges === 'function') _refreshCollectionsBadges();
}


function _afsSetGrid(n) {
  _afsGridCols = n;
  const grid = document.getElementById('allFoldersGrid');
  if (grid) grid.style.gridTemplateColumns = 'repeat(' + n + ',1fr)';
  localStorage.setItem('pv_afsGrid', n);
  _afsUpdateMenu();
}


function _afsSetSort(s) {
  _afsSortMode = s;
  const _dm=document.getElementById('afsDotMenu');if(_dm)_dm.style.display='none';
  const _dmb=document.getElementById('afsDotBackdrop');if(_dmb)_dmb.style.display='none';
  localStorage.setItem('pv_afsSort', s);
  _afsUpdateMenu();
  _allFoldersRender(document.getElementById('allFoldersSearch')?.value || '');
}


function _afsUpdateMenu() {
  [2,3,4].forEach(n => {
    const el = document.getElementById('afsGrid' + n + 'Btn');
    if (!el) return;
    const active = n === _afsGridCols;
    el.dataset.active   = active ? '1' : '';
    el.style.background = active ? '#3a3a3c' : '';
    el.style.color      = active ? 'white' : 'rgba(255,255,255,0.7)';
    el.style.fontWeight = active ? '700' : '600';
  });
  ['name','date'].forEach(s => {
    const el = document.getElementById('afsSort' + s.charAt(0).toUpperCase() + s.slice(1));
    if (!el) return;
    const active = _afsSortMode === s;
    el.dataset.active   = active ? '1' : '';
    el.style.background = active ? '#3a3a3c' : '';
    el.style.color      = active ? 'white' : 'rgba(255,255,255,0.7)';
    el.style.fontWeight = active ? '700' : '600';
  });
}


function _afsCreateFolder() {
  // Show the folder-name modal directly so we can refresh the grid
  // only AFTER the folder is actually confirmed and saved.
  showFolderNameModal({
    title: 'New Folder',
    subtitle: 'Give your folder a name',
    placeholder: 'e.g. Memories, Travel, Work…',
    confirmLabel: 'Create',
    onConfirm: (n) => {
      if (!n || folders.some(f => f.name.toLowerCase() === n.toLowerCase() && !f.parentId)) {
        if (n) showToast('Folder already exists!'); return;
      }
      folders.push({ id: 'f' + Date.now(), name: n });
      save(); renderFolders();
      if (activeFolder === 'home') render();
      showToast('📁 Folder created!');
      // Refresh the My Folders sheet grid immediately after creation
      const search = document.getElementById('allFoldersSearch');
      _allFoldersRender(search ? search.value : '');
    }
  });
}


function _afsDeleteAllFolders() {
  if (typeof folders === 'undefined' || folders.length === 0) {
    showToast('No folders to delete!'); return;
  }
  const totalFolders = folders.length;
  showConfirmModal(
    '🗑️ Delete All Folders?',
    'This will delete all ' + totalFolders + ' folder(s). Photos inside will be moved to Bin.',
    'Delete All', '#ff4444',
    () => {
      // Move all photos in any folder to bin
      const allFolderIds = new Set(folders.map(f => f.id));
      const affectedPhotos = photos.filter(p => allFolderIds.has(p.folder));
      affectedPhotos.forEach(p => { p.trashedAt = Date.now(); });
      trashedPhotos = [...trashedPhotos, ...affectedPhotos];
      photos = photos.filter(p => !allFolderIds.has(p.folder));
      folders = [];
      activeFolder = 'home';
      _saveTrashed();
      save(); renderFolders(); render();
      if (typeof _updateBinBadge === 'function') _updateBinBadge();
      // Refresh the AFS grid
      _allFoldersRender('');
      const searchEl = document.getElementById('allFoldersSearch');
      if (searchEl) searchEl.value = '';
      showToast('🗑️ All folders deleted' + (affectedPhotos.length > 0 ? ' · ' + affectedPhotos.length + ' photo(s) moved to Bin' : ''));
    }
  );
}

/* ══════════════════════════════════════════════════════════════════
   MERGE ADDITION — real page-switch logic + swipe-right-to-open-Albums
   gesture. Declared after everything above so these definitions win
   over the switchToPage()/_goToPg2() placeholders declared earlier.
   ══════════════════════════════════════════════════════════════════ */

function switchToPage(n) {
  _galPage = n;
  const track = document.getElementById('pageSlideTrack');
  if (track) {
    track.style.transition = '';
    track.style.transform = 'translateX(' + (n === 1 ? -50 : 0) + '%)';
  }
  const tp = document.getElementById('tabPhotos');
  const ta = document.getElementById('tabAlbums');
  if (tp) tp.classList.toggle('active', n === 0);
  if (ta) ta.classList.toggle('active', n === 1);
}

function _goToPg2() { switchToPage(1); }

/* Swipe left (drag right→left) → open Albums (page 2), same direction
   as advancing to the next photo in a gallery. Swipe right → back to
   Photos. The page follows the finger live while dragging, with a bit
   of rubber-band resistance past the edges, then snaps to whichever
   page you dragged (or flicked) far enough toward on release — same
   feel as swiping between photos.
   Listens on #pageWrapper (touch-action: pan-y in CSS) so vertical
   scrolling inside pg1/pg2 is untouched — only a clearly-horizontal
   drag hijacks the gesture. */
(function () {
  const wrap  = document.getElementById('pageWrapper');
  const track = document.getElementById('pageSlideTrack');
  if (!wrap || !track) return;
  const COMMIT_RATIO   = 0.28;   // fraction of viewport width to commit to a page change
  const FLING_SPEED    = 0.5;    // px/ms — a fast flick commits even if short
  const SIDEBAR_COMMIT = 0.10;   // fraction of viewport width to commit to opening — gentle, small swipe
  let startX = 0, startY = 0, lastX = 0, lastT = 0, velocity = 0;
  let dragging = false, isHorizontal = null, sidebarDrag = false;

  wrap.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    startX = lastX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    lastT = Date.now();
    velocity = 0;
    dragging = true;
    isHorizontal = null;
    sidebarDrag = false;
    track.style.transition = 'none';
  }, { passive: true });

  wrap.addEventListener('touchmove', function (e) {
    if (!dragging) return;
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    const dx = x - startX, dy = y - startY;
    if (isHorizontal === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      isHorizontal = Math.abs(dx) > Math.abs(dy);
      if (!isHorizontal) { dragging = false; return; } // hand off to native vertical scroll
      // On the homepage, a left→right drag opens the sidebar instead of
      // moving the page (there's no page before Photos to reveal).
      sidebarDrag = (_galPage === 0 && dx > 0 && !window._sidebarIsOpen);
      if (sidebarDrag) {
        const sb = document.getElementById('sidebar');
        const aw = document.getElementById('appWrap');
        if (sb) { sb.style.willChange = 'transform'; sb.style.transition = 'none'; sb.classList.remove('sidebar-closed'); }
        if (aw) aw.style.transition = 'none';
      }
    }
    if (!isHorizontal) return;
    // Once we've committed to a horizontal drag, stop the browser's own
    // edge-swipe-to-go-back/forward gesture from also kicking in (that's
    // what shows the stray vertical bar at the screen edge).
    if (e.cancelable) e.preventDefault();

    const now = Date.now();
    const dt = Math.max(1, now - lastT);
    velocity = (x - lastX) / dt;
    lastX = x; lastT = now;

    const wrapW = wrap.offsetWidth || 1;

    if (sidebarDrag) {
      // 1:1 finger tracking — same as the page-track drag: a full
      // viewport-width drag = fully open, so the sidebar genuinely
      // follows the finger instead of racing ahead of it.
      const progress = Math.max(0, Math.min(1, dx / wrapW));
      _sidebarApplyProgress(progress);
      return;
    }

    // No page to reveal past Albums (page 2) — hold still instead of
    // rubber-banding into empty space.
    if (_galPage === 1 && dx < 0) {
      track.style.transform = 'translateX(-50%)';
      return;
    }

    const percentDelta = (dx / (wrapW * 2)) * 100; // track is 200% wide, so halve the ratio
    const basePercent = _galPage === 1 ? -50 : 0;
    let target = basePercent + percentDelta;
    if (target > 0)   target = 0;    // hard stop — no rubber-band before page 1
    if (target < -50) target = -50;  // hard stop — no rubber-band after page 2
    track.style.transform = 'translateX(' + target + '%)';
  }, { passive: false });

  wrap.addEventListener('touchend', function (e) {
    if (!dragging) return;
    dragging = false;
    track.style.transition = '';
    if (!isHorizontal) return;

    const dx = e.changedTouches[0].clientX - startX;
    const wrapW = wrap.offsetWidth || 1;
    const flinging = Math.abs(velocity) > FLING_SPEED;

    if (sidebarDrag) {
      const draggedRatio = dx / wrapW;
      _sidebarSettle(draggedRatio > SIDEBAR_COMMIT || (flinging && dx > 0));
      sidebarDrag = false;
      return;
    }

    const draggedRatio = dx / wrapW; // negative = dragged toward "left" (next page)
    if (_galPage === 0) {
      if (draggedRatio < -COMMIT_RATIO || (flinging && dx < 0)) switchToPage(1);
      else switchToPage(0);
    } else {
      if (draggedRatio > COMMIT_RATIO || (flinging && dx > 0)) switchToPage(0);
      else switchToPage(1);
    }
  }, { passive: true });

  wrap.addEventListener('touchcancel', function () {
    dragging = false;
    track.style.transition = '';
    if (sidebarDrag) {
      _sidebarSettle(false);
      sidebarDrag = false;
      return;
    }
    switchToPage(_galPage);
  }, { passive: true });
})();

/* ▓▓▓ PORTED FROM hope-fixed-main-2-1.html — SHARED CORE ENGINE ▓▓▓
   Encryption, IndexedDB storage, Telegram cloud sync, lightbox, bin/trash,
   storage breakdown, move-to-folder, confirm modal, PWA install.
   Placed as the LAST <script> block so its real save/load/openLightbox/
   openCloudModal/installPWA definitions replace the placeholder stubs
   declared earlier in this file (later function declarations win).
   Cloudinary backend intentionally NOT ported — it was already dead code
   in the source file (its own delete path is hardcoded disabled, and it
   has no matching settings UI). Telegram is the sole active cloud backend.
   ══════════════════════════════════════════════════════════════════════ */

/* ── AES-256-GCM encryption ── */
const E2E_SALT = 'pixelvault-e2e-salt-v2';
let _cachedKeyPin = '';
let _cachedKey    = null;
const ENC_SLICE = 64 * 1024 * 1024;
const ENC_MAGIC = new Uint8Array([0x50, 0x56, 0x32, 0x00]);

/* ── IndexedDB blob storage ── */
const IDB_NAME  = 'pixelvault_blobs';
const IDB_STORE = 'blobs';
let _idb = null;
const TARGET_STORAGE_BYTES = 25 * 1024 * 1024 * 1024;
const VAULT_STORAGE_LIMIT  = 25 * 1024 * 1024 * 1024;

/* ── Telegram cloud credentials ── */
let TG_TOKEN  = localStorage.getItem('pv_tg_token')  || '';
let TG_CHATID = localStorage.getItem('pv_tg_chatid') || '';

/* ── Cloudinary credentials (kept only because Bin's optional per-item cloud
   delete references them; the Cloudinary upload/backup pipeline itself was
   not ported) ── */
let API_KEY    = localStorage.getItem('pv_api_key')    || '';
let API_SECRET = localStorage.getItem('pv_api_secret') || '';

/* ── Photo/trash/lightbox session state ── */
let trashedPhotos    = [];
let contextTarget    = null;
let sliderList        = [];
let sIndex            = 0;
let decryptedUrls     = [];
let _photoIdCounter   = 0;
let pendingCtxSelect  = false;
let _movePickerFolder = null;

/* ── Cloud sync bookkeeping ── */
let _cloudSyncing            = false;
let _syncChannel;
let _lastAppliedManifestTime = 0;
let _pollInterval            = null;
let _syncDebounceTimer       = null;
let _lastSyncedVersion       = 0;
let _lastLocalSaveTime       = 0;

/* ── Decrypt concurrency + thumbnail cache ── */
const _decryptSemaphore = { active: 0, max: 12, queue: [] };
const _thumbCache = {};

/* ── Misc ── */
let _lbMenuStyle        = localStorage.getItem('pv_menuStyle') || 'sheet';
let _deferredInstallPrompt = null;

async function pinToKey(pin) {
  if (pin === _cachedKeyPin && _cachedKey) return _cachedKey;
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(pin), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(E2E_SALT), iterations: 200000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  _cachedKeyPin = pin;
  _cachedKey    = key;
  return key;
}

async function encryptBlob(blob, pin) {
  const key = await pinToKey(pin);
  const mimeBytes = new TextEncoder().encode(blob.type || 'application/octet-stream');
  const mimeLen   = new Uint8Array(4);
  new DataView(mimeLen.buffer).setUint32(0, mimeBytes.length);

  // Start with magic header so decryptBlob can reliably identify format
  const parts = [ENC_MAGIC, mimeLen, mimeBytes];
  let offset = 0;
  while (offset < blob.size) {
    const slice = blob.slice(offset, offset + ENC_SLICE);
    const buf   = await slice.arrayBuffer();
    const iv    = crypto.getRandomValues(new Uint8Array(12)); // fresh IV per slice
    const ct    = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf);
    const lenBuf = new Uint8Array(4);
    new DataView(lenBuf.buffer).setUint32(0, ct.byteLength);
    parts.push(iv, lenBuf, new Uint8Array(ct));
    offset += ENC_SLICE;
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

async function decryptBlob(encBlob, pin) {
  const key = await pinToKey(pin);

  // For the new multi-slice format, decrypt slice-by-slice WITHOUT loading the whole file
  // into a single ArrayBuffer — this prevents OOM on large (100MB+) files.
  // We still peek at the first 64 bytes to read the magic + mime header.
  const PEEK = 64 + 256; // enough for magic (4) + mimeLen (4) + mime (up to 256 bytes)
  const headerBuf = await encBlob.slice(0, PEEK).arrayBuffer();
  const hView = new DataView(headerBuf);

  const isNewFormat = headerBuf.byteLength >= 4 &&
    hView.getUint8(0) === 0x50 && hView.getUint8(1) === 0x56 &&
    hView.getUint8(2) === 0x32 && hView.getUint8(3) === 0x00;

  if (isNewFormat) {
    let hOff = 4; // skip magic
    const mimeLen = hView.getUint32(hOff); hOff += 4;
    const mimeEnd  = hOff + mimeLen;
    const mime = new TextDecoder().decode(new Uint8Array(headerBuf, hOff, mimeLen));
    let offset = mimeEnd; // byte offset into the full blob

    const parts = [];
    while (offset < encBlob.size) {
      // Read IV (12) + ctLen (4) header for this slice
      const sliceHeaderBuf = await encBlob.slice(offset, offset + 16).arrayBuffer();
      if (sliceHeaderBuf.byteLength < 16) break;
      const shView = new DataView(sliceHeaderBuf);
      const iv    = new Uint8Array(sliceHeaderBuf, 0, 12);
      const ctLen = shView.getUint32(12);
      offset += 16;
      if (ctLen === 0 || offset + ctLen > encBlob.size) break;

      // Decrypt only this slice — never loads more than ENC_SLICE bytes at once
      const ctBuf = await encBlob.slice(offset, offset + ctLen).arrayBuffer();
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ctBuf);
      parts.push(new Uint8Array(plain));
      offset += ctLen;
    }
    const total = parts.reduce((s, a) => s + a.length, 0);
    const out   = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) { out.set(p, pos); pos += p.length; }
    return new Blob([out], { type: mime });
  }

  // Legacy single-block format — load fully (these are small pre-chunked files)
  const buf  = await encBlob.arrayBuffer();
  const view = new DataView(buf);
  let offset = 0;
  const mimeLen = view.getUint32(0); offset = 4;
  const mime    = new TextDecoder().decode(new Uint8Array(buf, offset, mimeLen)); offset += mimeLen;
  const iv      = new Uint8Array(buf, offset, 12); offset += 12;
  const cipher  = new Uint8Array(buf, offset);
  const plain   = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new Blob([plain], { type: mime });
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = () => rej(new Error('FileReader failed to read blob'));
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(b64) {
  const parts = b64.split(',');
  if (parts.length < 2) throw new Error('Invalid base64 data URL');
  const mimeMatch = parts[0].match(/:(.*?);/);
  if (!mimeMatch) throw new Error('Invalid base64 data URL mime type');
  const mime = mimeMatch[1];
  const bin  = atob(parts[1]);
  const arr  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function base64StringToBlob(b64str, mime) {
  const bin = atob(b64str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function _openIDB() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = e => { _idb = e.target.result; res(_idb); };
    req.onerror   = () => rej(new Error('IDB open failed'));
  });
}

async function idbPut(key, blob) {
  const db = await _openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(blob, key);
    tx.oncomplete = res; tx.onerror = () => rej(new Error('IDB write failed'));
  });
}

async function idbGet(key) {
  const db = await _openIDB();
  return new Promise((res, rej) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror   = () => rej(new Error('IDB read failed'));
  });
}

async function idbDelete(key) {
  const db = await _openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = res; tx.onerror = () => rej(new Error('IDB delete failed'));
  });
}

async function _initStoragePersistence() {
  try {
    // 1. Request persistent storage (prevents browser eviction)
    if (navigator.storage && navigator.storage.persist) {
      const persisted = await navigator.storage.persist();
      console.log('[PixelVault] Persistent storage:', persisted ? 'granted ✅' : 'not granted (data may be evicted under disk pressure)');
    }

    // 2. Check available quota
    if (navigator.storage && navigator.storage.estimate) {
      const { quota, usage } = await navigator.storage.estimate();
      const quotaGB  = (quota  / 1024 / 1024 / 1024).toFixed(2);
      const usageGB  = (usage  / 1024 / 1024 / 1024).toFixed(2);
      const freeGB   = ((quota - usage) / 1024 / 1024 / 1024).toFixed(2);
      console.log(`[PixelVault] Storage quota: ${quotaGB} GB total, ${usageGB} GB used, ${freeGB} GB free`);

      // Update stats bar pill using actual photo sizes
      _updateStoragePill();

      // Warn if available quota is below 25 GB
      if (quota < TARGET_STORAGE_BYTES) {
        console.warn(`[PixelVault] Quota (${quotaGB} GB) is below target 25 GB — browser limits vary by device disk space.`);
      }
    }
  } catch(e) {
    console.warn('[PixelVault] Storage init error:', e.message);
  }
}

async function _clearAllIdb() {
  try {
    const db = await _openIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).clear();
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch(e) { console.warn('IDB clear failed (non-fatal):', e); }
}

function _cleanLocalPhotoStorage() {
  try {
    localStorage.removeItem('pv_photos');
  } catch(e) {}
  _clearAllIdb().catch(() => {});
}

function isTgEnabled() { return !!(TG_TOKEN && TG_CHATID); }

function tgSaveConfig() {
  const token  = (document.getElementById('tgBotToken')?.value || '').trim();
  const chatId = (document.getElementById('tgChatId')?.value   || '').trim();
  const errEl  = document.getElementById('tgError');
  if (!token || !chatId) {
    if (errEl) { errEl.textContent = '⚠️ Both Bot Token and Chat ID are required.'; errEl.style.display = 'block'; }
    return;
  }
  if (errEl) errEl.style.display = 'none';
  TG_TOKEN  = token;
  TG_CHATID = chatId;
  localStorage.setItem('pv_tg_token',  TG_TOKEN);
  localStorage.setItem('pv_tg_chatid', TG_CHATID);
  showToast('✅ Telegram connected!');
  _tgRefreshStatusUI();
  updateCloudUI();
}

function tgClearConfig() {
  if (!confirm('Disconnect Telegram? Your files on Telegram will NOT be deleted.')) return;
  TG_TOKEN = ''; TG_CHATID = '';
  localStorage.removeItem('pv_tg_token');
  localStorage.removeItem('pv_tg_chatid');
  showToast('Telegram disconnected.');
  _tgRefreshStatusUI();
  updateCloudUI();
}

function _tgRefreshStatusUI() {
  const statusEl = document.getElementById('tgStatus');
  const textEl   = document.getElementById('tgStatusText');
  const tokenIn  = document.getElementById('tgBotToken');
  const chatIn   = document.getElementById('tgChatId');
  if (tokenIn) tokenIn.value = TG_TOKEN  ? '••••••••••••••••' : '';
  if (chatIn)  chatIn.value  = TG_CHATID || '';
  if (statusEl && textEl) {
    if (isTgEnabled()) {
      statusEl.style.display = 'flex';
      textEl.textContent = '✅ Connected — Chat ID: ' + TG_CHATID;
    } else {
      statusEl.style.display = 'none';
    }
  }
}

async function tgTestConnection() {
  const token  = (document.getElementById('tgBotToken')?.value || '').trim() || TG_TOKEN;
  const chatId = (document.getElementById('tgChatId')?.value   || '').trim() || TG_CHATID;
  const errEl  = document.getElementById('tgError');
  if (!token || !chatId) {
    if (errEl) { errEl.textContent = '⚠️ Enter Bot Token and Chat ID first.'; errEl.style.display = 'block'; }
    return;
  }
  showToast('⏳ Testing connection…');
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '✅ Hope vault connected successfully!' })
    });
    const d = await r.json();
    if (d.ok) {
      if (errEl) errEl.style.display = 'none';
      showToast('✅ Connection works! Bot sent a message.');
    } else {
      throw new Error(d.description || 'Unknown error');
    }
  } catch(e) {
    if (errEl) { errEl.textContent = '❌ ' + e.message; errEl.style.display = 'block'; }
    showToast('❌ Test failed: ' + e.message);
  }
}

async function _tgSendFile(encBlob, filename) {
  const fd = new FormData();
  fd.append('chat_id', TG_CHATID);
  fd.append('document', encBlob, filename);
  // Store metadata as caption (JSON, safe to store since data is encrypted)
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendDocument`, {
    method: 'POST', body: fd
  });
  const d = await r.json();
  if (!d.ok) throw new Error('Telegram: ' + (d.description || 'upload failed'));
  // Return the file_id so we can retrieve it later
  return d.result.document.file_id;
}

async function _tgGetFileUrl(fileId) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const d = await r.json();
  if (!d.ok) throw new Error('Telegram getFile: ' + (d.description || 'failed'));
  return `https://api.telegram.org/file/bot${TG_TOKEN}/${d.result.file_path}`;
}

async function _tgSaveManifest() {
  const manifest = {
    v: 1, updatedAt: Date.now(),
    pinHash: _getPinHash() || '',
    photos: photos.map(p => ({
      id: p.id, name: p.name, folder: p.folder,
      storage: p.storage, mediaType: p.mediaType || (p.name && p.name.match(/\.(mp4|webm|mov|avi|mkv|m4v)$/i) ? 'video' : (p.name && p.name.match(/\.gif$/i) ? 'gif' : (p.name && p.name.match(/\.webp$/i) ? 'webp' : 'image'))),
      addedAt: p.addedAt, size: p.size,
      tgFileId: p.tgFileId || null,   // Telegram file_id for retrieval
    })),
    folders
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const fileId = await _tgSendFile(blob, 'hope_manifest.json');
  localStorage.setItem('pv_tg_manifest_fileid', fileId);
  return fileId;
}

async function _tgLoadManifest() {
  const savedId = localStorage.getItem('pv_tg_manifest_fileid');
  if (!savedId) throw new Error('No manifest found. Upload some files first.');
  const url = await _tgGetFileUrl(savedId);
  const r = await fetch(url);
  if (!r.ok) throw new Error('Could not fetch manifest from Telegram.');
  return await r.json();
}

async function tgPushAll() {
  if (!isTgEnabled()) { showToast('⚠️ Set up Telegram first!'); openCloudModal(); return; }
  if (!sessionPin)    { showToast('⚠️ Unlock the vault first.'); return; }

  const localPhotos = photos.filter(p =>
    (p.storage === 'idb' && p.encId) || (p.storage === 'local' && p.encData)
  );

  const box    = document.getElementById('cloudOpBox');
  const bar    = document.getElementById('cloudOpBar');
  const title  = document.getElementById('cloudOpTitle');
  const status = document.getElementById('cloudOpStatus');
  const icon   = document.getElementById('cloudOpIcon');

  if (box) box.style.display = 'block';
  if (bar) bar.style.width = '0%';
  if (icon) { icon.className = 'fas fa-rotate'; icon.style.cssText = 'animation:spin 1s linear infinite;'; }

  if (localPhotos.length === 0) {
    if (title) title.textContent = '✅ Nothing to upload';
    if (status) status.textContent = 'All photos are already in Telegram cloud.';
    showToast('✅ Already up to date!');
    return;
  }

  if (title) title.textContent = `Uploading ${localPhotos.length} file(s) to Telegram…`;
  if (status) status.textContent = 'Encrypting and sending…';

  let done = 0, failed = 0;

  for (const p of localPhotos) {
    try {
      if (status) status.textContent = `[${done+1}/${localPhotos.length}] Sending: ${p.name}`;

      // Get the encrypted blob
      let encBlob;
      if (p.storage === 'idb') {
        encBlob = await idbGet(p.encId);
        if (!encBlob) throw new Error('Blob missing from local storage');
      } else {
        encBlob = base64ToBlob(p.encData);
      }

      // Send to Telegram — filename includes .enc so it's clear it's encrypted
      const safeName = (p.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      const tgFileId = await _tgSendFile(encBlob, 'hope_' + p.id + '_' + safeName + '.enc');

      // Delete local copy to free device space
      if (p.storage === 'idb' && p.encId) {
        idbDelete(p.encId).catch(() => {});
      }

      // Update photo record — now it lives in Telegram
      p.storage   = 'tg';
      p.tgFileId  = tgFileId;
      delete p.encData;
      delete p.encId;

      done++;
      if (bar) bar.style.width = ((done / localPhotos.length) * 100) + '%';
      _saveLocalOnly();
    } catch(e) {
      console.warn('tgPushAll failed for', p.name, e);
      failed++;
      done++;
      if (bar) bar.style.width = ((done / localPhotos.length) * 100) + '%';
    }
  }

  // Save updated manifest to Telegram
  try {
    if (status) status.textContent = 'Saving file index to Telegram…';
    await _tgSaveManifest();
  } catch(e) {
    console.warn('Manifest save failed:', e);
  }

  if (icon) { icon.className = 'fas fa-circle-check'; icon.style.animation = 'none'; }
  const msg = failed > 0
    ? `✅ ${done - failed} uploaded, ⚠️ ${failed} failed`
    : `✅ ${done} file(s) uploaded & removed from device!`;
  if (title) title.textContent = msg;
  if (status) status.textContent = failed > 0
    ? 'Some files failed. They remain on device. Try again.'
    : 'Files are now in Telegram. Your device space is freed.';
  showToast(msg);
  _saveLocalOnly();
  render();
  updateCloudUI();
}

async function tgRetrieveAll() {
  if (!isTgEnabled()) { showToast('⚠️ Set up Telegram first!'); openCloudModal(); return; }
  if (!sessionPin)    { showToast('⚠️ Unlock the vault first.'); return; }

  const box    = document.getElementById('cloudOpBox');
  const bar    = document.getElementById('cloudOpBar');
  const title  = document.getElementById('cloudOpTitle');
  const status = document.getElementById('cloudOpStatus');
  const icon   = document.getElementById('cloudOpIcon');

  if (box) box.style.display = 'block';
  if (bar) bar.style.width = '0%';
  if (icon) { icon.className = 'fas fa-rotate'; icon.style.cssText = 'animation:spin 1s linear infinite;'; }
  if (title) title.textContent = 'Connecting to Telegram…';
  if (status) status.textContent = 'Loading file index…';

  try {
    // Load manifest
    const manifest = await _tgLoadManifest();
    if (!manifest || !Array.isArray(manifest.photos)) throw new Error('Invalid manifest');

    if (manifest.pinHash) _setPinHash(manifest.pinHash);
    if (Array.isArray(manifest.folders)) folders = manifest.folders;

    const tgPhotos = manifest.photos.filter(p => p.storage === 'tg' && p.tgFileId);
    if (tgPhotos.length === 0) {
      if (title) title.textContent = '📭 No files in Telegram yet';
      if (status) status.textContent = 'Upload some files first using "Upload All to Telegram".';
      showToast('📭 No files found in Telegram');
      return;
    }

    if (title) title.textContent = `Found ${tgPhotos.length} file(s) — fetching…`;

    // Merge tg photos into local photos array (in-memory only, not saved to localStorage)
    // Keep any existing local photos, add cloud ones that aren't already present
    const existingIds = new Set(photos.map(p => p.id));
    let added = 0;
    for (const tp of tgPhotos) {
      if (!existingIds.has(tp.id)) {
        photos.push(tp);
        existingIds.add(tp.id);
        added++;
      }
    }

    if (bar) bar.style.width = '100%';
    if (icon) { icon.className = 'fas fa-circle-check'; icon.style.animation = 'none'; }
    if (title) title.textContent = `✅ ${tgPhotos.length} file(s) ready to view!`;
    if (status) status.textContent = 'Tap any photo to decrypt and view it. Nothing is saved to your device.';

    showToast(`✅ ${tgPhotos.length} file(s) ready to view! Nothing saved to device.`);

    // Close cloud modal so user sees the gallery immediately
    closeCloudModal();
    render();
    renderFolders();
    updateCloudUI();

  } catch(e) {
    if (icon) { icon.className = 'fas fa-circle-exclamation'; icon.style.animation = 'none'; }
    if (title) title.textContent = '❌ Retrieve failed';
    if (status) status.textContent = e.message || 'Check your Bot Token and Chat ID.';
    showToast('❌ ' + (e.message || 'Retrieve failed. Check Bot Token & Chat ID in ☁️ Cloud Settings.'));
  }
}

async function _tgDecryptPhoto(p) {
  if (!TG_TOKEN) throw new Error('Telegram not configured');
  const url = await _tgGetFileUrl(p.tgFileId);
  const r = await fetch(url);
  if (!r.ok) throw new Error('Could not fetch file from Telegram');
  const encBlob = new Blob([await r.arrayBuffer()], { type: 'application/octet-stream' });
  return await decryptBlob(encBlob, sessionPin);
}

function isCloudEnabled() { return isTgEnabled(); }

function openCloudModal() {
  const m = document.getElementById('cloudModal');
  if (m) { _tgRefreshStatusUI(); m.classList.add('open'); }
}

function closeCloudModal() {
  const m = document.getElementById('cloudModal');
  if (m) m.classList.remove('open');
}

function updateCloudUI() {
  const banner = document.getElementById('cloudSetupBanner');
  const pill   = document.getElementById('cloudActivePill');
  if (banner) banner.classList.toggle('show', !isTgEnabled());
  if (pill)   pill.style.display = isTgEnabled() ? 'flex' : 'none';
}

async function forcePushToCloud()         { await tgPushAll(); }

async function forceRetrieveFromCloud()   { await tgRetrieveAll(); }

function isDeleteEnabled() { return false; }

function startCloudPolling() {
  if (_pollInterval) return;
  _pollInterval = setInterval(async () => {
    if (!isCloudEnabled() || _cloudSyncing || document.hidden) return;
    try {
      const manifest = await fetchManifest(CLOUD_NAME);
      if (manifest && manifest.updatedAt && manifest.updatedAt > _lastAppliedManifestTime) {
        // Skip if local is newer — we have a pending sync in flight (debounce window).
        // Applying a stale cloud manifest would restore recently-deleted photos.
        if (manifest.updatedAt < _lastLocalSaveTime) return;
        _lastAppliedManifestTime = manifest.updatedAt;
        applyManifest(manifest, CLOUD_NAME, UPLOAD_PRESET);
        render();
        showToast('☁️ Synced from cloud');
      }
    } catch(e) { console.warn('poll sync failed:', e); }
  }, 15000);
}

function stopCloudPolling() {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
}

async function syncToCloud() {
  if (!isCloudEnabled()) return;
  // Stamp this version of the data
  _lastSyncedVersion++;
  const myVersion = _lastSyncedVersion;

  if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(async () => {
    _syncDebounceTimer = null;
    // If another change came in while we were waiting, it already owns the slot
    if (myVersion !== _lastSyncedVersion) return;
    // Always reset — never permanently block on a stuck flag
    _cloudSyncing = false;
    _cloudSyncing = true;
    try {
      const manifest = {
        v: 2,
        updatedAt: Date.now(),
        pinHash: _getPinHash() || '',
        photos: photos
          .map(p => ({
            id: p.id, name: p.name, folder: p.folder, storage: p.storage,
            encrypted: p.encrypted, encUrl: p.encUrl || null,
            publicId: p.publicId || null,
            encData: p.storage === 'local' ? (p.encData || null) : null,
            encId:   p.storage === 'idb'   ? (p.encId   || null) : null,
            addedAt: p.addedAt, size: p.size,
            mediaType: p.mediaType || (p.name && p.name.match(/\.(mp4|webm|mov|avi|mkv|m4v)$/i) ? 'video' : (p.name && p.name.match(/\.gif$/i) ? 'gif' : (p.name && p.name.match(/\.webp$/i) ? 'webp' : 'image')))
          })),
        folders: folders,
        cloudName: CLOUD_NAME,
        uploadPreset: UPLOAD_PRESET,
        // Embed these so any device can reconstruct the versioned fetch URL
        // after first retrieval — solves the new-device cold-start problem
        manifestVersion: localStorage.getItem('pv_manifest_version') || ''
      };
      const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
      await uploadManifest(blob);
      // Notify same-origin tabs (regular → regular) instantly via BroadcastChannel
      try { _syncChannel.postMessage({ type: 'sync', updatedAt: manifest.updatedAt }); } catch(e) {}
    } catch(e) {
      console.error('syncToCloud failed:', e.message);
      const errMsg = e.message || '';
      const hint = errMsg.toLowerCase().includes('preset') || errMsg.toLowerCase().includes('upload') || errMsg.toLowerCase().includes('not found')
        ? 'Upload preset not found or not Unsigned — go to Cloud Settings to fix'
        : errMsg.slice(0, 70);
      showToast('⚠️ Cloud sync failed — ' + hint);
    } finally {
      _cloudSyncing = false;
    }
  }, 2000); // 2s debounce — batches rapid changes, avoids hammering Cloudinary
}

async function restoreFromCloud(cloudName, uploadPreset) {
  showToast('☁️ Restoring from cloud…');
  const manifest = await fetchManifest(cloudName);
  if (!manifest) { showToast('⚠️ No cloud backup found.'); return false; }
  return applyManifest(manifest, cloudName, uploadPreset);
}

function applyManifest(manifest, cloudName, uploadPreset) {
  // Accept v:2, v:1, or any manifest that has a photos array (legacy / missing version)
  if (!manifest || (!Array.isArray(manifest.photos) && manifest.v !== 2 && manifest.v !== 1)) return false;
  // Restore PIN hash
  if (manifest.pinHash) _setPinHash(manifest.pinHash);
  // Cloud manifest is the single source of truth.
  // Only import cloud-stored photos from the manifest — local/IDB entries
  // from the manifest are skipped because their encrypted data is on other devices.
  if (Array.isArray(manifest.photos)) {
    const manifestIds = new Set(manifest.photos.map(p => p.id));
    // Keep any local/idb photos already in memory this session (not yet pushed)
    const localExtra = photos.filter(p =>
      !manifestIds.has(p.id) &&
      ((p.storage === 'local' && p.encData) || (p.storage === 'idb' && p.encId))
    );
    // Only accept cloud-stored photos from the manifest
    const cloudFromManifest = manifest.photos.filter(p => p.storage === 'cloud' && p.encUrl);
    photos = [...cloudFromManifest, ...localExtra];
    photos.forEach((p, i) => { if (!p.id) p.id = 'ph' + Date.now() + i; });
  }
  // Restore folders
  if (Array.isArray(manifest.folders)) folders = manifest.folders;
  // Restore cloud credentials
  if (manifest.cloudName)    { CLOUD_NAME    = manifest.cloudName;    localStorage.setItem('pv_cloud_name', CLOUD_NAME);    try { sessionStorage.setItem('pv_cloud_name',    CLOUD_NAME);    } catch(e) {} }
  if (manifest.uploadPreset) { UPLOAD_PRESET = manifest.uploadPreset; localStorage.setItem('pv_upload_preset', UPLOAD_PRESET); try { sessionStorage.setItem('pv_upload_preset', UPLOAD_PRESET); } catch(e) {} }
  // Bootstrap new devices: if the manifest itself embeds a version number, save it locally.
  // This lets fetchManifest reconstruct the versioned URL on future retrieves without
  // needing a prior push on this device.
  if (manifest.manifestVersion) {
    localStorage.setItem('pv_manifest_version', manifest.manifestVersion);
    try { sessionStorage.setItem('pv_manifest_version', manifest.manifestVersion); } catch(e) {}
  }
  // Save folders only — NOT photos.
  // Photos are session-only: they must never be written to localStorage
  // because load() always starts empty and requires the user to tap Retrieve.
  try {
    localStorage.setItem('pv_folders', JSON.stringify(folders));
  } catch(e) { /* quota */ }
  // Ensure all cloud URLs have CORS flag so decryption works cross-origin
  _ensureCorsifiedUrls();
  return true;
}

function _saveLocalOnly() {
  try {
    localStorage.setItem('pv_folders', JSON.stringify(folders));
  } catch(e) { /* quota */ }
}

function _formatSize(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function _fmtBytes(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/1024/1024).toFixed(1) + ' MB';
}

function _updateStoragePill() {
  const pill  = document.getElementById('storageUsagePill');
  const label = document.getElementById('storageUsageLabel');
  const sub   = document.getElementById('pg2StorageSub');
  if (!pill || !label) return;
  const totalBytes = (photos || []).reduce((s, p) => s + (p.size || 0), 0)
                   + (trashedPhotos || []).reduce((s, p) => s + (p.size || 0), 0);
  const limitGB = (VAULT_STORAGE_LIMIT / 1024 / 1024 / 1024).toFixed(0);
  label.textContent = _formatSize(totalBytes) + ' / ' + limitGB + ' GB';
  if (sub) sub.textContent = _formatSize(totalBytes) + ' used of ' + limitGB + ' GB';
  const hsl = document.getElementById('headerStorageLabel');
  if (hsl) hsl.textContent = _formatSize(totalBytes) + ' / ' + limitGB + ' GB';
  pill.style.display = 'flex';
  const dot = pill.querySelector('.stat-dot');
  if (dot) dot.style.background = (totalBytes / VAULT_STORAGE_LIMIT > 0.8) ? 'var(--orange)' : 'var(--green)';
}

function openStorageBreakdown() {
  const allPhotos = photos || [];
  const allTrashed = trashedPhotos || [];
  const allFolders = folders || [];

  // Per-type
  let imageBytes = 0, videoBytes = 0, gifBytes = 0;
  let imageCount = 0, videoCount = 0, gifCount = 0;
  allPhotos.forEach(p => {
    const s = p.size || 0;
    const mt = _getMediaType(p); // always derived from MIME + filename for accuracy
    if (mt === 'video') { videoBytes += s; videoCount++; }
    else if (mt === 'gif') { gifBytes += s; gifCount++; }
    else { imageBytes += s; imageCount++; }
  });

  // Bin
  const binBytes = allTrashed.reduce((s, p) => s + (p.size || 0), 0);
  const binCount = allTrashed.length;

  const totalBytes = allPhotos.reduce((s, p) => s + (p.size || 0), 0) + binBytes;
  const limitGB = (VAULT_STORAGE_LIMIT / 1024 / 1024 / 1024).toFixed(0);
  const pct = Math.min(100, (totalBytes / VAULT_STORAGE_LIMIT * 100)).toFixed(1);

  document.getElementById('sbTotalLabel').textContent = _formatSize(totalBytes) + ' / ' + limitGB + ' GB';
  document.getElementById('sbTotalBar').style.width = pct + '%';
  document.getElementById('sbTotalBar').style.background = parseFloat(pct) > 80
    ? 'linear-gradient(90deg,var(--orange),#f87171)'
    : 'linear-gradient(90deg,var(--green),var(--cyan))';
  document.getElementById('sbTotalPct').textContent = pct + '% used';

  const rows = document.getElementById('sbRows');
  rows.innerHTML = '';

  function _makeRow(icon, lbl, bytes, count, color) {
    const pctRow = totalBytes > 0 ? Math.min(100, bytes / totalBytes * 100) : 0;
    const el = document.createElement('div');
    el.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:14px;padding:12px 14px;border:1px solid var(--border);';
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">${icon}</span>
          <div>
            <div style="font-size:13px;font-weight:800;color:white;">${lbl}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4);font-weight:700;">${count} item${count !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <span style="font-size:13px;font-weight:800;color:${color};">${_formatSize(bytes)}</span>
      </div>
      <div style="height:5px;border-radius:5px;background:rgba(255,255,255,0.08);overflow:hidden;">
        <div style="height:100%;border-radius:5px;background:${color};width:${pctRow.toFixed(1)}%;"></div>
      </div>`;
    rows.appendChild(el);
  }

  if (imageCount > 0) _makeRow('🖼️', 'Images', imageBytes, imageCount, 'var(--pink)');
  if (videoCount > 0) _makeRow('🎬', 'Videos', videoBytes, videoCount, 'var(--purple)');
  if (gifCount > 0)   _makeRow('🎞️', 'GIFs',   gifBytes,   gifCount,   'var(--cyan)');

  // Per top-level folder
  allFolders.filter(f => !f.parentId).forEach(f => {
    const subIds = allFolders.filter(sf => sf.parentId === f.id).map(sf => sf.id);
    const inFolder = allPhotos.filter(p => p.folder === f.id || subIds.includes(p.folder));
    const fBytes = inFolder.reduce((s, p) => s + (p.size || 0), 0);
    if (inFolder.length > 0) _makeRow('📁', escapeHtml(f.name), fBytes, inFolder.length, 'var(--yellow)');
  });

  if (binCount > 0) _makeRow('🗑️', 'Bin', binBytes, binCount, 'var(--orange)');

  if (totalBytes === 0) {
    rows.innerHTML = '<div style="text-align:center;padding:24px 0;color:rgba(255,255,255,0.3);font-size:14px;font-weight:700;">No files stored yet</div>';
  }

  document.getElementById('storageModal').classList.add('open');
}

  function _makeRow(icon, lbl, bytes, count, color) {
    const pctRow = totalBytes > 0 ? Math.min(100, bytes / totalBytes * 100) : 0;
    const el = document.createElement('div');
    el.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:14px;padding:12px 14px;border:1px solid var(--border);';
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">${icon}</span>
          <div>
            <div style="font-size:13px;font-weight:800;color:white;">${lbl}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4);font-weight:700;">${count} item${count !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <span style="font-size:13px;font-weight:800;color:${color};">${_formatSize(bytes)}</span>
      </div>
      <div style="height:5px;border-radius:5px;background:rgba(255,255,255,0.08);overflow:hidden;">
        <div style="height:100%;border-radius:5px;background:${color};width:${pctRow.toFixed(1)}%;"></div>
      </div>`;
    rows.appendChild(el);
  }

function closeStorageBreakdown() {
  document.getElementById('storageModal').classList.remove('open');
}

function save() {
  // Photos are session-only — NEVER written to localStorage.
  // Only folders (structural metadata) are persisted across sessions.
  try {
    const now = Date.now().toString();
    localStorage.setItem('pv_folders',   JSON.stringify(folders));
    localStorage.setItem('pv_save_time', now);
    _lastLocalSaveTime = parseInt(now, 10);
  } catch(e) {
    console.error('Save failed:', e);
  }
  // Sync manifest to cloud whenever all in-session photos are cloud-stored
  const hasPendingLocal = photos.some(p => p.storage === 'local' || p.storage === 'idb');
  if (isCloudEnabled() && !hasPendingLocal) syncToCloud().catch(e => console.warn('Cloud sync failed:', e));
}

function load() {
  // ── ALWAYS start with zero photos on every page load / refresh ──
  // Photos must NEVER auto-appear. The user must explicitly tap
  // "Retrieve from Cloud" each session to load them.
  // We do load folders (structural metadata only, no image data).
  photos = [];
  try {
    const rawFolders = localStorage.getItem('pv_folders') || '[]';
    folders = JSON.parse(rawFolders);
  } catch(e) { folders = []; }
  // Wipe any stale photo data from localStorage so it can never leak back in
  localStorage.removeItem('pv_photos');
  // Clear IDB blobs from any previous session
  _clearAllIdb().catch(() => {});
  _loadTrashed();
  _updateBinBadge();
}

function newPhotoId() { return 'ph_' + Date.now() + '_' + (++_photoIdCounter); }

function _acquireDecrypt() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (_decryptSemaphore.active < _decryptSemaphore.max) {
        _decryptSemaphore.active++;
        resolve();
      } else {
        _decryptSemaphore.queue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

function _releaseDecrypt() {
  const next = _decryptSemaphore.queue.shift();
  if (next) {
    // Keep active count the same — we're handing the slot to the next waiter
    next();
  } else {
    _decryptSemaphore.active--;
  }
}

function _captureVideoFrame(videoUrl) { return Promise.resolve(null); }

function _applyCachedThumb(cached, shimmer, card) {
  const { mediaType } = cached;
  const isVideo = mediaType === 'video';
  // Always remove shimmer first
  shimmer.style.display = 'none';
  if (shimmer.parentNode) shimmer.remove();
  if (isVideo) {
    // Use a live <video> element — same approach as initial decrypt
    const thumb = document.createElement('video');
    thumb.src = cached.url;
    thumb.muted = true;
    thumb.playsInline = true;
    thumb.preload = 'metadata';
    thumb.setAttribute('playsinline', '');
    thumb.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.4s;pointer-events:none;z-index:3;';
    thumb.onloadedmetadata = () => {
      try { thumb.currentTime = Math.max(0.1, (thumb.duration || 1) * 0.1); } catch(e) {}
    };
    thumb.onseeked = () => { thumb.style.opacity = '1'; };
    thumb.oncanplay = () => { thumb.style.opacity = '1'; };
    setTimeout(() => { thumb.style.opacity = '1'; }, 1500);
    card.appendChild(thumb);
    const playIcon = document.createElement('div');
    playIcon.innerHTML = '▶';
    playIcon.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.55);color:white;font-size:18px;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;z-index:5;pointer-events:none;backdrop-filter:blur(4px);';
    card.appendChild(playIcon);
  } else {
    // image or gif — blob URL works directly with <img>
    const img = document.createElement('img');
    img.src = cached.url; img.alt = '';
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;z-index:3;';
    img.onload = () => { img.style.opacity = '1'; };
    card.appendChild(img);
  }
}

async function decryptThumbnail(p, shimmer, card) {
  // card is passed explicitly from the IntersectionObserver — don't derive from shimmer.parentNode
  // (it becomes null after re-renders clear the DOM between the observe() and the async callback)
  if (!card) card = shimmer.parentNode;
  if (!card) return;

  // ── CACHE HIT: already decrypted in a previous render — attach instantly, no semaphore needed ──
  if (_thumbCache[p.id]) {
    if (!document.contains(card)) {
      const liveCard = document.querySelector(`.photo-card[data-id="${p.id}"]`);
      if (!liveCard) return;
      const liveShimmer = liveCard.querySelector('.photo-loading');
      if (!liveShimmer) return;
      card = liveCard; shimmer = liveShimmer;
    }
    _applyCachedThumb(_thumbCache[p.id], shimmer, card);
    return;
  }

  // THUMBNAIL FIX: If the card was removed from the DOM by a re-render that happened
  // between the IntersectionObserver firing and this async function running, look up the
  // freshly-rendered card by photo-id and restart with the live card/shimmer instead.
  if (!document.contains(card)) {
    const liveCard = document.querySelector(`.photo-card[data-id="${p.id}"]`);
    if (!liveCard) return; // photo was deleted
    const liveShimmer = liveCard.querySelector('.photo-loading');
    if (!liveShimmer) return; // already decrypted by another observer
    card = liveCard;
    shimmer = liveShimmer;
  }

  await _acquireDecrypt();
  try {
    let encBlob;
    if (p.storage === 'cloud') {
      encBlob = await fetchCloudBlob(p.encUrl);
    } else if (p.storage === 'idb') {
      encBlob = await idbGet(p.encId);
      if (!encBlob) throw new Error('Blob missing from local storage');
    } else {
      encBlob = base64ToBlob(p.encData);
    }
    const plainBlob = await decryptBlob(encBlob, sessionPin);

    // After awaits — verify card is still in DOM (re-render may have cleared it).
    // If cleared, look up the live replacement card so we can still display the result.
    if (!document.contains(card)) {
      const liveCard = document.querySelector(`.photo-card[data-id="${p.id}"]`);
      if (!liveCard) { return; } // photo was deleted
      const liveShimmer = liveCard.querySelector('.photo-loading');
      card = liveCard;
      shimmer = liveShimmer || shimmer;
    }

    const url = URL.createObjectURL(plainBlob);
    const isVideo = p.mediaType === 'video' || p.name?.match(/\.(mp4|webm|mov|avi|mkv|m4v)$/i);
    const isGif   = p.mediaType === 'gif'   || p.name?.toLowerCase().endsWith('.gif');
    const mediaType = isVideo ? 'video' : (isGif ? 'gif' : 'image');

    if (isVideo) {
      // ── VIDEO THUMBNAIL: use a live <video> element directly in the card ──
      // Canvas-based frame capture is unreliable on mobile/GitHub Pages (GPU decoder
      // requires user gesture or visible element with enough size). A muted <video>
      // with currentTime set renders its own thumbnail natively — no canvas needed.
      _thumbCache[p.id] = { url, mediaType: 'video', posterUrl: null };

      shimmer.style.display = 'none';
      if (shimmer.parentNode) shimmer.remove();

      const thumb = document.createElement('video');
      thumb.src = url;
      thumb.muted = true;
      thumb.playsInline = true;
      thumb.preload = 'metadata';
      thumb.setAttribute('playsinline', '');
      // currentTime triggers the browser to decode & paint the first frame
      thumb.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.4s;pointer-events:none;z-index:3;';
      thumb.onloadedmetadata = () => {
        try { thumb.currentTime = Math.max(0.1, (thumb.duration || 1) * 0.1); } catch(e) {}
      };
      thumb.onseeked = () => { thumb.style.opacity = '1'; };
      thumb.oncanplay = () => { thumb.style.opacity = '1'; };
      // Fallback: show after 1.5 s regardless
      setTimeout(() => { thumb.style.opacity = '1'; }, 1500);
      card.appendChild(thumb);

      // Play icon overlay
      const playIcon = document.createElement('div');
      playIcon.innerHTML = '▶';
      playIcon.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.55);color:white;font-size:18px;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;z-index:5;pointer-events:none;backdrop-filter:blur(4px);';
      card.appendChild(playIcon);
    } else {
      // ── IMAGE / GIF: use <img> with blob URL ──
      // ── Store in cache so future re-renders display instantly ──
      _thumbCache[p.id] = { url, mediaType };  // preserves 'gif' vs 'image'

      const img = document.createElement('img');
      img.src = url; img.alt = p.name;
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;z-index:3;';
      img.onload = () => {
        img.style.opacity = '1';
        shimmer.style.display = 'none';
        if (shimmer.parentNode) shimmer.remove();
        // Do NOT revoke — URL is kept alive in _thumbCache for re-renders
      };
      img.onerror = () => {
        delete _thumbCache[p.id];
        URL.revokeObjectURL(url);
        if (shimmer.parentNode) shimmer.innerHTML = '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#f87171;font-size:11px;padding:8px;text-align:center;">Failed to load</span>';
      };
      // Append directly to the captured card — reliable even if shimmer was removed
      card.appendChild(img);
    }
  } catch(e) {
    if (shimmer.parentNode) shimmer.innerHTML = '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#f87171;font-size:11px;padding:8px;text-align:center;">Failed to decrypt</span>';
  } finally {
    _releaseDecrypt();
  }
}

async function decryptOne(p) {
  let encBlob;
  if (p.storage === 'cloud') {
    encBlob = await fetchCloudBlob(p.encUrl);
  } else if (p.storage === 'idb') {
    encBlob = await idbGet(p.encId);
    if (!encBlob) throw new Error('Blob missing from local storage');
  } else {
    encBlob = base64ToBlob(p.encData);
  }
  const plain = await decryptBlob(encBlob, sessionPin);
  const url = URL.createObjectURL(plain);
  decryptedUrls.push(url);
  return url;
}

async function fetchCloudBlob(encUrl) {
  // Use the CORS-friendly URL for cross-origin hosted environments
  const url = _corsify(encUrl);
  let r;
  try {
    r = await fetch(url, { cache: 'no-store', mode: 'cors' });
  } catch(networkErr) {
    throw new Error('Network error fetching from Cloudinary. Check your internet connection. (' + networkErr.message + ')');
  }
  if (!r.ok) throw new Error(`Cloudinary returned ${r.status} for stored file. The file may have been deleted from Cloudinary, or the URL is incorrect.`);

  // Always read as ArrayBuffer — reading as text corrupts binary data because
  // TextDecoder mangles invalid UTF-8 sequences, breaking AES-GCM decryption.
  // Peek at the first bytes to detect legacy text formats without corrupting binary.
  const buf = await r.arrayBuffer();
  if (buf.byteLength === 0) throw new Error('Empty response from Cloudinary — possible CORS block. In your Cloudinary preset settings, make sure "Allowed formats" is not restricted, and "Signing Mode" is set to Unsigned.');
  const firstBytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, 5));
  const prefix = String.fromCharCode(...firstBytes);

  // Legacy: plain data URI (starts with "data:")
  if (prefix === 'data:') {
    const text = new TextDecoder().decode(buf);
    return base64ToBlob(text);
  }

  // Legacy: JSON envelope { mime, data } — starts with "{"
  if (prefix[0] === '{') {
    try {
      const text = new TextDecoder().decode(buf);
      const env = JSON.parse(text);
      if (env?.data && env?.mime) return base64StringToBlob(env.data, env.mime);
    } catch(e) {}
  }

  // Current format: raw binary .enc file — return as-is
  return new Blob([buf], { type: 'application/octet-stream' });
}

function _corsify(url) {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  // Already has a transformation flag — don't double-add
  if (url.includes('/fl_attachment')) return url;
  // Insert fl_attachment:false after /raw/upload/ or /auto/upload/ or /image/upload/
  return url.replace(/(\/(?:raw|auto|image|video)\/upload\/)/, '$1fl_attachment:false/');
}

async function openLightbox(startIndex, list) {
  sliderList = list; sIndex = startIndex;
  const lb    = document.getElementById('lightbox');
  const track = document.getElementById('sliderTrack');
  const decEl = document.getElementById('lbDecrypting');

  decryptedUrls.forEach(u => URL.revokeObjectURL(u));
  decryptedUrls = [];
  track.innerHTML = '';
  track.classList.add('no-transition');
  track.style.transform = `translateX(${-startIndex * 100}vw)`;
  lb.classList.add('open');
  requestAnimationFrame(() => requestAnimationFrame(() => lb.classList.add('lb-visible')));
  decEl.style.display = 'flex';

  // Create placeholder slides
  list.forEach((_, i) => {
    const slide = document.createElement('div');
    slide.className = 'slide'; slide.id = 'slide-' + i;
    track.appendChild(slide);
  });
  track.offsetHeight;
  track.classList.remove('no-transition');

  // Decrypt and fill a single slide
  async function fillSlide(idx) {
    if (idx < 0 || idx >= list.length) return;
    const slide = document.getElementById('slide-' + idx);
    if (!slide || slide.dataset.filled) return;
    slide.dataset.filled = '1';
    try {
      const url = await decryptOne(list[idx]);
      slide.innerHTML = '';
      const isVideo = list[idx].mediaType === 'video' || list[idx].name?.match(/\.(mp4|webm|mov|avi|mkv|m4v)$/i);
      if (isVideo) {
        const vid = document.createElement('video');
        vid.src = url; vid.controls = true; vid.playsInline = true;
        if (idx === startIndex) vid.autoplay = true;
        vid.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;';
        slide.appendChild(vid);
      } else {
        const img = document.createElement('img'); img.src = url; img.draggable = false;
        slide.appendChild(img);
      }
    } catch(e) {
      if (slide) slide.innerHTML = '<div style="color:#f87171;font-size:14px;">❌ Failed to decrypt</div>';
    }
  }

  // Decrypt current slide first — show it as fast as possible
  await fillSlide(startIndex);
  decEl.style.display = 'none';
  _lbUpdateUI();  // populate top bar with filename, fav state, etc.

  // Prefetch immediate neighbours without blocking UI
  fillSlide(startIndex + 1).catch(() => {});
  fillSlide(startIndex - 1).catch(() => {});
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  lb.classList.remove('lb-visible');
  setTimeout(() => {
    lb.classList.remove('open');
    decryptedUrls.forEach(u => URL.revokeObjectURL(u));
    decryptedUrls = [];
    const track = document.getElementById('sliderTrack');
    if (track) track.innerHTML = '';
    sliderList = []; sIndex = 0;
  }, 280);
}

function _setSlide(idx, animated) {
  const track = document.getElementById('sliderTrack');
  if (!track) return;
  if (!animated) track.classList.add('no-transition');
  track.style.transform = `translateX(${-idx * 100}vw)`;
  if (!animated) { track.offsetHeight; track.classList.remove('no-transition'); }
}

function _lbUpdateUI() {
  // Update top bar + bottom bar for current slide
  const p = sliderList[sIndex];
  if (!p) return;
  const nameEl = document.getElementById('lbFileName');
  const infoEl = document.getElementById('lbFileInfo');
  const favIco = document.getElementById('lbFavIcon');
  const favInd = document.getElementById('lbFavIndicator');
  const mFavIco = document.getElementById('lbMenuFavIcon');
  const mFavLbl = document.getElementById('lbMenuFavLabel');
  const mTitle  = document.getElementById('lbMenuTitle');
  if (nameEl) nameEl.textContent = p.name || 'Photo';
  if (infoEl) {
    const parts = [];
    if (_getMediaType(p) === 'video') parts.push('🎬 Video');
    else if (_getMediaType(p) === 'gif') parts.push('🎞 GIF');
    else parts.push('🖼 Image');
    if (p.size) parts.push(_fmtBytes(p.size));
    if (p.folder && p.folder !== 'home') {
      const f = (typeof folders !== 'undefined') ? folders.find(x => x.id === p.folder) : null;
      if (f) parts.push('📁 ' + f.name);
    }
    infoEl.textContent = parts.join('  ·  ');
  }
  const isFav = !!p.fav;
  if (favIco) { favIco.className = isFav ? 'fas fa-burst' : 'far fa-burst'; favIco.style.color = isFav ? '#ff6eb4' : ''; }
  if (favInd) favInd.style.display = isFav ? 'block' : 'none';
  if (mFavIco) { mFavIco.style.color = isFav ? '#ff6eb4' : 'rgba(255,110,180,0.5)'; mFavIco.style.opacity = isFav ? '1' : '0.6'; }
  if (mFavLbl) mFavLbl.textContent = isFav ? 'Remove from Picked' : 'Add to Picked';
  if (mTitle) mTitle.textContent = (p.name || 'Photo').length > 36 ? (p.name||'Photo').slice(0,33)+'…' : (p.name || 'Photo');
}

  async function fillSlide(idx) {
    if (idx < 0 || idx >= list.length) return;
    const slide = document.getElementById('slide-' + idx);
    if (!slide || slide.dataset.filled) return;
    slide.dataset.filled = '1';
    try {
      const url = await decryptOne(list[idx]);
      slide.innerHTML = '';
      const isVideo = list[idx].mediaType === 'video' || list[idx].name?.match(/\.(mp4|webm|mov|avi|mkv|m4v)$/i);
      if (isVideo) {
        const vid = document.createElement('video');
        vid.src = url; vid.controls = true; vid.playsInline = true;
        if (idx === startIndex) vid.autoplay = true;
        vid.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;';
        slide.appendChild(vid);
      } else {
        const img = document.createElement('img'); img.src = url; img.draggable = false;
        slide.appendChild(img);
      }
    } catch(e) {
      if (slide) slide.innerHTML = '<div style="color:#f87171;font-size:14px;">❌ Failed to decrypt</div>';
    }
  }

function slideNav(dir) {
  const newIdx = Math.max(0, Math.min(sliderList.length - 1, sIndex + dir));
  if (newIdx === sIndex) return;
  sIndex = newIdx;
  _setSlide(sIndex, true);
  // Fill the current slide if not yet decrypted, then prefetch neighbours
  const slide = document.getElementById('slide-' + sIndex);
  if (slide && !slide.dataset.filled) {
    slide.dataset.filled = '1';
    decryptOne(sliderList[sIndex]).then(url => {
      slide.innerHTML = '';
      const isVideo = sliderList[sIndex].mediaType === 'video' || sliderList[sIndex].name?.match(/\.(mp4|webm|mov|avi|mkv|m4v)$/i);
      if (isVideo) {
        const vid = document.createElement('video'); vid.src = url; vid.controls = true; vid.playsInline = true;
        vid.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;';
        slide.appendChild(vid);
      } else { const img = document.createElement('img'); img.src = url; img.draggable = false; slide.appendChild(img); }
    }).catch(() => { slide.innerHTML = '<div style="color:#f87171;font-size:14px;">❌ Failed</div>'; });
  }
  _prefetchAdjacentSlides(sIndex).catch(() => {});
  _lbUpdateUI();  // update top bar for new slide
}

async function _prefetchAdjacentSlides(idx) {
  await Promise.allSettled([
    (async () => {
      const s = document.getElementById('slide-' + (idx + 1));
      if (s && !s.dataset.filled) { s.dataset.filled = '1'; try { const u = await decryptOne(sliderList[idx+1]); s.innerHTML=''; const i=document.createElement('img');i.src=u;i.draggable=false;s.appendChild(i); } catch(e){} }
    })(),
    (async () => {
      const s = document.getElementById('slide-' + (idx - 1));
      if (s && !s.dataset.filled) { s.dataset.filled = '1'; try { const u = await decryptOne(sliderList[idx-1]); s.innerHTML=''; const i=document.createElement('img');i.src=u;i.draggable=false;s.appendChild(i); } catch(e){} }
    })()
  ]);
}

function openLbMenu() {
  _lbUpdateUI();
  if (_lbMenuStyle === 'flat') {
    const flat = document.getElementById('lbFlatMenu');
    // Sync fav label
    const p = sliderList[sIndex];
    const favLabel = document.getElementById('lbFlatFavLabel');
    if (favLabel && p) favLabel.textContent = p.fav ? 'Remove from Picked' : 'Add to Picked';
    if (flat) { flat.classList.add('open'); _positionFlatMenu(); }
  } else {
    const sheet = document.getElementById('lbMenuSheet');
    if (sheet) sheet.style.display = 'block';
  }
}

function closeLbMenu() {
  const sheet = document.getElementById('lbMenuSheet');
  if (sheet) sheet.style.display = 'none';
  const flat = document.getElementById('lbFlatMenu');
  if (flat) flat.classList.remove('open');
}

function _setMenuStyle(style) {
  _lbMenuStyle = style;
  localStorage.setItem('pv_menuStyle', style);
  // Update picker UI
  const sheet = document.getElementById('menuStyleOpt-sheet');
  const flat  = document.getElementById('menuStyleOpt-flat');
  if (sheet && flat) {
    if (style === 'sheet') {
      sheet.style.border = '2px solid rgba(162,89,255,0.5)';
      sheet.style.background = 'rgba(162,89,255,0.07)';
      sheet.querySelector('span').style.color = 'rgba(162,89,255,0.9)';
      sheet.querySelector('span').textContent = '✦ Bottom Sheet';
      flat.style.border = '2px solid rgba(255,255,255,0.12)';
      flat.style.background = 'rgba(255,255,255,0.03)';
      flat.querySelector('span').style.color = 'rgba(255,255,255,0.4)';
      flat.querySelector('span').textContent = 'Dropdown';
    } else {
      flat.style.border = '2px solid rgba(162,89,255,0.5)';
      flat.style.background = 'rgba(162,89,255,0.07)';
      flat.querySelector('span').style.color = 'rgba(162,89,255,0.9)';
      flat.querySelector('span').textContent = '✦ Dropdown';
      sheet.style.border = '2px solid rgba(255,255,255,0.12)';
      sheet.style.background = 'rgba(255,255,255,0.03)';
      sheet.querySelector('span').style.color = 'rgba(255,255,255,0.4)';
      sheet.querySelector('span').textContent = 'Bottom Sheet';
    }
  }
}

function _positionFlatMenu() {
  const btn = document.getElementById('lbMenuBtn');
  const box = document.getElementById('lbFlatMenuBox');
  if (!btn || !box) return;
  const r = btn.getBoundingClientRect();
  const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat') || '0') || 0;
  box.style.position = 'fixed';
  box.style.top  = (r.bottom + 6) + 'px';
  box.style.right = (window.innerWidth - r.right) + 'px';
  box.style.left = 'auto';
}

function lbAction_delete() {
  const p = sliderList[sIndex]; if (!p) return;
  showConfirmModal(
    'Move to Bin?',
    '"' + (p.name || 'this photo') + '" will be moved to Bin.',
    'Move to Bin', '#ff4444',
    () => {
      p.trashedAt = Date.now();
      if (typeof trashedPhotos !== 'undefined') trashedPhotos.push(p);
      if (typeof photos !== 'undefined') {
        const idx = photos.findIndex(x => x.id === p.id);
        if (idx !== -1) photos.splice(idx, 1);
      }
      sliderList.splice(sIndex, 1);
      if (typeof _saveTrashed === 'function') _saveTrashed();
      if (typeof save === 'function') save();
      if (typeof render === 'function') render();
      if (typeof _updateBinBadge === 'function') _updateBinBadge();
      showToast('🗑️ Moved to Bin');
      if (sliderList.length === 0) { closeLightbox(); return; }
      sIndex = Math.min(sIndex, sliderList.length - 1);
      _setSlide(sIndex, false);
      _lbUpdateUI();
    }
  );
}

async function lbAction_download() {
  const p = sliderList[sIndex]; if (!p) return;
  showToast('⬇️ Saving…');
  try {
    let encBlob;
    if (p.storage === 'cloud') encBlob = await fetchCloudBlob(p.encUrl);
    else if (p.storage === 'idb') { encBlob = await idbGet(p.encId); if (!encBlob) throw new Error('Missing'); }
    else encBlob = base64ToBlob(p.encData);
    const plain = await decryptBlob(encBlob, sessionPin);
    const url = URL.createObjectURL(plain);
    _triggerDownload(url, p.name);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch(e) { showToast('❌ Save failed'); }
}

function lbAction_favourite() {
  const p = sliderList[sIndex]; if (!p) return;
  p.fav = !p.fav;
  _lbUpdateUI();
  if (typeof save === 'function') save();
  if (typeof renderFavStrip === 'function') renderFavStrip();
  showToast(p.fav ? '✨ Added to Picked!' : '✖ Removed from Picked');
}

function lbAction_info() {
  const p = sliderList[sIndex]; if (!p) return;
  let overlay = document.getElementById('lbInfoOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'lbInfoOverlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('open'); };
    document.body.appendChild(overlay);
  }
  const f = (p.folder && p.folder !== 'home' && typeof folders !== 'undefined')
    ? folders.find(x => x.id === p.folder) : null;
  const addedDate = p.addedAt ? new Date(p.addedAt).toLocaleString() : '—';
  overlay.innerHTML = `
    <div id="lbInfoPanel">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
        <div style="font-family:'Fredoka One',cursive;font-size:22px;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">File Info</div>
        <button onclick="document.getElementById('lbInfoOverlay').classList.remove('open')" style="background:rgba(255,255,255,0.1);border:none;color:white;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">&times;</button>
      </div>
      ${_infoRow('📄','Name', p.name||'—')}
      ${_infoRow('🎭','Type', _getMediaType(p)==='video'?'Video':_getMediaType(p)==='gif'?'GIF':'Image')}
      ${_infoRow('📦','Size', _fmtBytes(p.size)||'—')}
      ${_infoRow('📁','Folder', f?f.name:'All Photos (no folder)')}
      ${_infoRow('🕐','Added', addedDate)}
      ${_infoRow('💾','Storage', p.storage==='cloud'?'☁️ Cloud (Telegram)':p.storage==='idb'?'📱 Local (IndexedDB)':'Local')}
      ${_infoRow('🔒','Encrypted', p.encrypted?'Yes — AES-256-GCM':'No')}
      ${p.fav?_infoRow('❤️','Picked','Yes'):''}
    </div>
  `;
  overlay.classList.add('open');
}

function lbAction_move() {
  const p = sliderList[sIndex]; if (!p) return;
  contextTarget = p;
  if (typeof selected !== 'undefined') { selected.clear(); selected.add(p.id); }
  if (typeof openMoveModal === 'function') openMoveModal();
}

function lbAction_rename() {
  const p = sliderList[sIndex]; if (!p) return;
  const newName = prompt('Rename:', p.name)?.trim();
  if (!newName || newName === p.name) return;
  p.name = newName;
  _lbUpdateUI();
  if (typeof save === 'function') save();
  if (typeof render === 'function') render();
  showToast('✏️ Renamed!');
}

async function lbAction_share() {
  const p = sliderList[sIndex]; if (!p) return;
  try {
    let encBlob;
    if (p.storage === 'cloud') encBlob = await fetchCloudBlob(p.encUrl);
    else if (p.storage === 'idb') { encBlob = await idbGet(p.encId); if (!encBlob) throw new Error('Missing'); }
    else encBlob = base64ToBlob(p.encData);
    const plain = await decryptBlob(encBlob, sessionPin);
    if (navigator.share && navigator.canShare) {
      const file = new File([plain], p.name, { type: plain.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: p.name });
        return;
      }
    }
    // Fallback: download
    const url = URL.createObjectURL(plain);
    _triggerDownload(url, p.name);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast('📥 Saved (share not available)');
  } catch(e) { if (e.name !== 'AbortError') showToast('❌ Share failed'); }
}

function _triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function _infoRow(emoji, label, value) {
  return '<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">' +
    '<span style="font-size:18px;flex-shrink:0;width:26px;text-align:center;">' + emoji + '</span>' +
    '<div style="flex:1;min-width:0;"><div style="font-size:10px;font-weight:800;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:2px;">' + label + '</div>' +
    '<div style="font-size:13px;font-weight:700;color:white;word-break:break-all;">' + value + '</div></div></div>';
}

  function _isVisible(el) { return el && el.style.display !== 'none' && el.style.display !== ''; }

  function _updateArrows() {
    if (!arrowL || !arrowR) return;
    arrowL.style.opacity = offset < -2          ? '0.5' : '0';
    arrowR.style.opacity = offset > -(maxOff-2) ? '0.5' : '0';
  }

  function _momentum() {
    if (Math.abs(velX) < 0.5) { velX = 0; return; }
    velX *= 0.88;
    _setOffset(offset + velX, false);
    rafId = requestAnimationFrame(_momentum);
  }

  function _setOffset(v, smooth) {
    offset = _clamp(v);
    inner.style.transition = smooth ? 'transform 0.28s cubic-bezier(.4,0,.2,1)' : 'none';
    inner.style.transform  = `translateX(${offset}px)`;
    _updateArrows();
  }

  function _clamp(v) { return Math.max(-maxOff, Math.min(0, v)); }

  function _updateMax() {
    if (!inner || !bar) return;
    maxOff = Math.max(0, inner.scrollWidth - bar.clientWidth);
    _updateArrows();
  }

function closeMoveModal() {
  document.getElementById('moveModal').classList.remove('open');
  // If ctxMove temporarily borrowed `selected`, clear it back out so the user
  // isn't left in a half-selected state after canceling.
  if (pendingCtxSelect) {
    selected.clear();
    pendingCtxSelect = false;
    selectMode = false;
    updateSelectBanner && updateSelectBanner();
    render();
  }
  _movePickerFolder = null;
}

function confirmMove(folderId, folderName) {
  const ids = selected.size > 0 ? new Set(selected) : (contextTarget ? new Set([contextTarget.id]) : new Set());
  if (ids.size === 0) { closeMoveModal(); return; }

  let count = 0;
  photos.forEach(p => { if (ids.has(p.id)) { p.folder = folderId; count++; } });
  save();

  // Move done — clear the borrow flag so closeMoveModal doesn't try to undo state.
  pendingCtxSelect = false;
  document.getElementById('moveModal').classList.remove('open');
  exitSelectMode();

  // If we're on home, bounce the target folder tile then re-render
  if (activeFolder === 'home' && folderId !== 'home') {
    render(); renderFolders();
    // After render the tile exists in the DOM — bounce it
    setTimeout(() => { if (typeof bounceFolderTile === 'function') bounceFolderTile(folderId); }, 20);
  } else {
    render(); renderFolders();
  }
  showToast(`📁 Moved ${count} photo(s) to "${folderName}"`);
}

async function _deletePhotosFromCloud(targets) {
  // Clean up IDB blobs first
  for (const p of targets) {
    if (p.storage === 'idb' && p.encId) {
      idbDelete(p.encId).catch(() => {});
    }
  }
  if (!isDeleteEnabled()) return;
  const cloudPhotos = targets.filter(p => p.storage === 'cloud' && p.encUrl);
  if (!cloudPhotos.length) return;
  for (const p of cloudPhotos) {
    const pid = p.publicId || _extractPublicId(p.encUrl);
    if (!pid) continue;
    try { await _cloudinaryDestroy(pid); }
    catch(e) { console.warn('Cloud delete failed for', p.name, e.message); }
  }
}

async function emptyBin() {
  if (!trashedPhotos.length) return;
  const count = trashedPhotos.length;
  if (!confirm(`Permanently delete all ${count} item(s) from the bin? This cannot be undone.`)) return;

  // Pick up API credentials directly from the input fields in case the user
  // typed them but didn't click "Save Credentials" first
  const keyEl = document.getElementById('binApiKey');
  const secEl = document.getElementById('binApiSecret');
  if (keyEl?.value.trim() && secEl?.value.trim()) {
    API_KEY = keyEl.value.trim();
    API_SECRET = secEl.value.trim();
    localStorage.setItem('pv_api_key', API_KEY);
    localStorage.setItem('pv_api_secret', API_SECRET);
    try { sessionStorage.setItem('pv_api_key', API_KEY); } catch(e) {}
    try { sessionStorage.setItem('pv_api_secret', API_SECRET); } catch(e) {}
  }

  const toDelete = [...trashedPhotos];
  trashedPhotos = [];
  _saveTrashed();
  _renderBinItems();
  _updateBinBadge();

  const cloudItems = toDelete.filter(p => p.storage === 'cloud' && p.encUrl);
  const hasApiCreds = !!(API_KEY && API_SECRET);

  if (cloudItems.length > 0 && hasApiCreds) {
    showToast(`🗑️ Deleting ${cloudItems.length} item(s) from cloud…`);
    try {
      await _deletePhotosFromCloud(cloudItems);
      showToast(`✅ Bin emptied — ${count} item(s) permanently deleted from cloud!`);
    } catch(e) {
      showToast(`⚠️ Bin cleared locally — some cloud files may remain: ${e.message || ''}`);
      console.warn('emptyBin cloud delete error:', e);
    }
  } else if (cloudItems.length > 0 && !hasApiCreds) {
    showToast(`🗑️ Bin cleared — ${count} item(s) removed (add API creds to delete from cloud)`);
  } else {
    showToast(`🗑️ Bin emptied — ${count} item(s) permanently deleted`);
  }
}

function closeBinModal() {
  document.getElementById('binModal').classList.remove('open');
}

function setBinGrid(cols) {
  const list = document.getElementById('binItemList');
  if (list) list.style.gridTemplateColumns = `repeat(${cols},minmax(0,1fr))`;
  localStorage.setItem('pv_bin_grid', cols);
  _updateBinGridBtns(cols);
}

function restoreFromBin(id) {
  const idx = trashedPhotos.findIndex(p => p.id === id);
  if (idx === -1) return;
  const p = trashedPhotos.splice(idx, 1)[0];
  delete p.trashedAt;
  // If the folder it belonged to no longer exists, send to home screen
  if (p.folderId && !folders.find(f => f.id === p.folderId)) {
    delete p.folderId;
  }
  photos.push(p);
  _saveTrashed();
  save(); render();
  // Remove just this card — no full grid rebuild so no black flash
  const card = document.querySelector('#binItemList [data-pid="' + id + '"]');
  if (card) card.remove();
  // Update count and empty state
  const countEl = document.getElementById('binItemCount');
  if (countEl) countEl.textContent = trashedPhotos.length;
  if (trashedPhotos.length === 0) {
    const emptyMsg = document.getElementById('binEmptyMsg');
    const emptyBtn = document.getElementById('btnEmptyBin');
    if (emptyMsg) emptyMsg.style.display = 'block';
    if (emptyBtn) emptyBtn.style.display = 'none';
  }
  _updateBinBadge();
}

async function permanentDelete(id) {
  const idx = trashedPhotos.findIndex(p => p.id === id);
  if (idx === -1) return;
  const [p] = trashedPhotos.splice(idx, 1);
  _saveTrashed();
  _renderBinItems();
  _updateBinBadge();

  // Pick up API credentials from the input fields in case user typed but didn't save
  const keyEl = document.getElementById('binApiKey');
  const secEl = document.getElementById('binApiSecret');
  if (keyEl?.value.trim() && secEl?.value.trim()) {
    API_KEY = keyEl.value.trim();
    API_SECRET = secEl.value.trim();
    localStorage.setItem('pv_api_key', API_KEY);
    localStorage.setItem('pv_api_secret', API_SECRET);
    try { sessionStorage.setItem('pv_api_key', API_KEY); } catch(e) {}
    try { sessionStorage.setItem('pv_api_secret', API_SECRET); } catch(e) {}
  }

  const isCloud = p.storage === 'cloud' && p.encUrl;
  const hasApiCreds = !!(API_KEY && API_SECRET);

  if (isCloud && hasApiCreds) {
    showToast('🗑️ Deleting from cloud…');
    try {
      await _deletePhotosFromCloud([p]);
      showToast('✅ Permanently deleted from cloud!');
    } catch(e) {
      showToast('⚠️ Removed from vault — cloud delete failed: ' + (e.message || ''));
      console.warn('Cloud delete error:', e);
    }
  } else if (isCloud && !hasApiCreds) {
    showToast('🗑️ Removed from vault (no API creds — file may remain on Cloudinary)');
  } else {
    showToast('🗑️ Permanently deleted');
  }
}

function saveBinApiCredentials() {
  const keyEl = document.getElementById('binApiKey');
  const secEl = document.getElementById('binApiSecret');
  const st = document.getElementById('binApiStatus');
  const key = (keyEl?.value || '').trim();
  const sec = (secEl?.value || '').trim();

  // Validate: both must be provided, or both must be empty (to clear credentials)
  if ((key && !sec) || (!key && sec)) {
    if (st) {
      st.textContent = '⚠️ Both API Key and API Secret are required together.';
      st.style.color = '#f87171';
    }
    return;
  }

  API_KEY = key; API_SECRET = sec;
  localStorage.setItem('pv_api_key', key);
  localStorage.setItem('pv_api_secret', sec);
  try { sessionStorage.setItem('pv_api_key', key); } catch(e) {}
  try { sessionStorage.setItem('pv_api_secret', sec); } catch(e) {}
  if (st) {
    if (key && sec) {
      st.textContent = '✅ Credentials saved — cloud deletion is now enabled!';
      st.style.color = '#4ade80';
    } else {
      st.textContent = '✅ Credentials cleared — only local deletion will occur.';
      st.style.color = 'rgba(255,255,255,0.4)';
    }
  }
}

function _binLogoUpload(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) { _setBinLogo(ev.target.result); };
  reader.readAsDataURL(file);
}

function _setBinBg(mode) {
  var el = document.getElementById('binScrollContainer');
  var hdr = document.getElementById('binScrollHeader');
  if (!el) return;
  if (mode === 'image') {
    el.style.backgroundImage = "url('" + _BIN_BG_IMG + "')";
    el.style.backgroundColor = '';
    if (hdr) hdr.style.background = 'rgba(0,0,0,0.45)';
    try { localStorage.setItem('pv_bin_bg', 'image'); } catch(e) {}
  } else if (mode === 'teal') {
    el.style.backgroundImage = 'none';
    el.style.backgroundColor = '#0d1e27';
    if (hdr) hdr.style.background = '#0d1e27';
    try { localStorage.setItem('pv_bin_bg', 'teal'); } catch(e) {}
  } else {
    el.style.backgroundImage = '';
    el.style.backgroundColor = '';
    if (hdr) hdr.style.background = '#000000';
    try { localStorage.setItem('pv_bin_bg', 'black'); } catch(e) {}
  }
  document.getElementById('binLogoMenu').style.display = 'none';
  document.getElementById('binLogoBackdrop').style.display = 'none';
}

function _setBinLogo(src) {
  var img = document.getElementById('binHeaderLogo');
  if (img) img.src = src;
  try { localStorage.setItem('pv_bin_logo', src); } catch(e){}
  document.getElementById('binLogoMenu').style.display = 'none';
  document.getElementById('binLogoBackdrop').style.display = 'none';
}

function _renderBinItems() {
  const list = document.getElementById('binItemList');
  const emptyMsg = document.getElementById('binEmptyMsg');
  const countEl = document.getElementById('binItemCount');
  const emptyBtn = document.getElementById('btnEmptyBin');
  if (!list) return;
  list.innerHTML = '';
  if (countEl) countEl.textContent = trashedPhotos.length;
  if (trashedPhotos.length === 0) {
    if (emptyMsg) emptyMsg.style.display = 'block';
    if (emptyBtn) emptyBtn.style.display = 'none';
    return;
  }
  if (emptyMsg) emptyMsg.style.display = 'none';
  if (emptyBtn) emptyBtn.style.display = 'block';

  // Apply saved bin grid cols
  const binCols = parseInt(localStorage.getItem('pv_bin_grid') || '3');
  list.style.gridTemplateColumns = `repeat(${binCols},minmax(0,1fr))`;
  _updateBinGridBtns(binCols);

  trashedPhotos.forEach((p, i) => {
    // Wrapper: overflow visible so swipe animation isn't clipped; collapses on delete to fill gap
    const cardWrap = document.createElement('div');
    cardWrap.style.cssText = 'overflow:visible;position:relative;';

    const card = document.createElement('div');
    card.dataset.pid = p.id;
    card.style.cssText = 'position:relative;width:100%;aspect-ratio:1/1;border-radius:12px;overflow:hidden;background:var(--card);cursor:pointer;';

    // Single tap → lightbox; long press (600ms) → restore
    (function(pid) {
      var lpTimer = null, lpFired = false, startX = 0, startY = 0;
      var swipeFired = false;
      card.addEventListener('touchstart', function(e) {
        lpFired = false; swipeFired = false;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        lpTimer = setTimeout(function() {
          lpTimer = null; lpFired = true;
          restoreFromBin(pid);
          showToast('↩ Restored');
        }, 600);
      }, {passive: true});
      card.addEventListener('touchmove', function(e) {
        var dx = e.touches[0].clientX - startX;
        var dy = e.touches[0].clientY - startY;
        // Cancel long press if moved
        if (lpTimer && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) { clearTimeout(lpTimer); lpTimer = null; }
        // Swipe detection: horizontal > 60px and more horizontal than vertical
        if (!swipeFired && !lpFired && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          e.preventDefault();
          swipeFired = true;
          if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
          // Animate card out AND collapse wrapper simultaneously for instant smooth gap-fill
          var dir = dx > 0 ? 1 : -1;
          var wrapper = card.parentNode;
          // 1. Slide card out
          card.style.transition = 'transform 0.22s cubic-bezier(0.4,0,1,1), opacity 0.22s ease';
          card.style.transform = 'translateX(' + (dir * 120) + '%)';
          card.style.opacity = '0';
          // 2. Simultaneously collapse wrapper height so neighbours slide up right away
          if (wrapper && wrapper !== document.getElementById('binItemList')) {
            var h = wrapper.offsetHeight;
            wrapper.style.overflow = 'hidden';
            wrapper.style.height = h + 'px';
            wrapper.offsetHeight; // force reflow
            wrapper.style.transition = 'height 0.22s cubic-bezier(0.4,0,0.2,1)';
            wrapper.style.height = '0';
          }
          setTimeout(function() {
            // Permanently delete from bin
            var idx = trashedPhotos.findIndex(function(x){ return x.id === pid; });
            if (idx >= 0) {
              var p = trashedPhotos[idx];
              trashedPhotos.splice(idx, 1);
              if (p.encId) { try { idbDelete(p.encId); } catch(e){} }
              _saveTrashed();
              save();
              if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
              else if (card.parentNode) card.parentNode.removeChild(card);
              // Update count
              var countEl = document.getElementById('binItemCount');
              if (countEl) countEl.textContent = trashedPhotos.length;
              var emptyMsg = document.getElementById('binEmptyMsg');
              var emptyBtn = document.getElementById('btnEmptyBin');
              if (trashedPhotos.length === 0) {
                if (emptyMsg) emptyMsg.style.display = 'block';
                if (emptyBtn) emptyBtn.style.display = 'none';
              }
              showToast('🗑️ Deleted');
            }
          }, 240);
        }
      }, {passive: false});
      card.addEventListener('touchend', function(e) {
        if (swipeFired) return; // swipe handled it
        if (lpTimer) {
          clearTimeout(lpTimer); lpTimer = null;
          // short tap — open lightbox
          e.preventDefault();
          var idx = trashedPhotos.findIndex(function(x){ return x.id === pid; });
          if (idx >= 0) openLightbox(idx, trashedPhotos.slice());
        }
      });
      card.addEventListener('touchcancel', function() {
        // Clear timer on touchcancel (e.g. Android screenshot, incoming call, system gesture)
        // This prevents the long-press restore firing when the user wasn't holding the card
        if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
        lpFired = false;
      });
    }(p.id));

    // Shimmer / placeholder
    const shimmer = document.createElement('div');
    shimmer.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.03);';
    const mediaIcon = _getMediaType(p) === 'video' ? '🎬' : (_getMediaType(p) === 'gif' ? '🎞️' : '🖼️');
    shimmer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width:28px;height:28px;opacity:0.18;" fill="white"><rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="none" stroke="white" stroke-width="1.5"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21" fill="none" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    card.appendChild(shimmer);

    // Gradient overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.75) 0%,transparent 55%);z-index:2;pointer-events:none;';
    card.appendChild(overlay);

    // Try to decrypt and show thumbnail
    if (p.storage === 'cloud' && p.encUrl) {
      (async () => {
        try {
          const encBlob = await fetchCloudBlob(p.encUrl);
          const plainBlob = await decryptBlob(encBlob, sessionPin);
          if (!card.isConnected) return;
          const url = URL.createObjectURL(plainBlob);
          const isVideo = p.mediaType === 'video' || p.name?.match(/\.(mp4|webm|mov|avi|mkv|m4v)$/i);
          if (isVideo) {
            const vid = document.createElement('video');
            vid.src = url; vid.muted = true; vid.playsInline = true; vid.preload = 'metadata';
            vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;z-index:1;';
            vid.onloadedmetadata = () => { try { vid.currentTime = 0.1; } catch(e) {} };
            vid.onseeked = () => { vid.style.opacity='1'; shimmer.remove(); };
            vid.oncanplay = () => { vid.style.opacity='1'; };
            setTimeout(() => { vid.style.opacity='1'; if(shimmer.parentNode) shimmer.remove(); }, 1500);
            card.insertBefore(vid, card.firstChild);
          } else {
            const img = document.createElement('img');
            img.src = url; img.alt = '';
            img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;z-index:1;';
            img.onload = () => { img.style.opacity='1'; shimmer.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000); };
            img.onerror = () => URL.revokeObjectURL(url);
            card.insertBefore(img, card.firstChild);
          }
        } catch(e) {}
      })();
    } else if ((p.storage === 'idb' && p.encId) || (p.storage === 'local' && p.encData)) {
      (async () => {
        try {
          let encBlob;
          if (p.storage === 'idb') {
            encBlob = await idbGet(p.encId);
          } else {
            const byteStr = atob(p.encData.split(',')[1] || p.encData);
            const ab = new ArrayBuffer(byteStr.length);
            const u8 = new Uint8Array(ab);
            for (let j = 0; j < byteStr.length; j++) u8[j] = byteStr.charCodeAt(j);
            encBlob = new Blob([ab]);
          }
          if (!encBlob) return;
          const plainBlob = await decryptBlob(encBlob, sessionPin);
          if (!card.isConnected) return;
          const url = URL.createObjectURL(plainBlob);
          const isVideo = p.mediaType === 'video' || p.name?.match(/\.(mp4|webm|mov|avi|mkv|m4v)$/i);
          if (isVideo) {
            const vid = document.createElement('video');
            vid.src = url; vid.muted = true; vid.playsInline = true; vid.preload = 'metadata';
            vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;z-index:1;';
            vid.onloadedmetadata = () => { try { vid.currentTime = 0.1; } catch(e) {} };
            vid.onseeked = () => { vid.style.opacity='1'; shimmer.remove(); };
            vid.oncanplay = () => { vid.style.opacity='1'; };
            setTimeout(() => { vid.style.opacity='1'; if(shimmer.parentNode) shimmer.remove(); }, 1500);
            card.insertBefore(vid, card.firstChild);
          } else {
            const img = document.createElement('img');
            img.src = url; img.alt = '';
            img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;z-index:1;';
            img.onload = () => { img.style.opacity='1'; shimmer.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000); };
            img.onerror = () => URL.revokeObjectURL(url);
            card.insertBefore(img, card.firstChild);
          }
        } catch(e) {}
      })();
    }

    cardWrap.appendChild(card);
    list.appendChild(cardWrap);
  });
}

function _updateBinBadge() {
  const badge = document.getElementById('binCountBadge');
  if (!badge) return;
  if (trashedPhotos.length > 0) {
    badge.style.display = 'inline-block';
    badge.textContent = trashedPhotos.length;
  } else {
    badge.style.display = 'none';
  }
}

function _updateBinGridBtns(cols) {
  [2,3,4].forEach(n => {
    const btn = document.getElementById('binGrid'+n);
    if (!btn) return;
    if (n === cols) {
      btn.style.borderColor = 'var(--cyan)';
      btn.style.background = 'rgba(61,232,216,0.15)';
      btn.style.color = 'white';
    } else {
      btn.style.borderColor = 'rgba(255,255,255,0.15)';
      btn.style.background = 'rgba(255,255,255,0.05)';
      btn.style.color = 'rgba(255,255,255,0.5)';
    }
  });
}

function _loadTrashed() {
  try {
    const raw = localStorage.getItem('pv_trashed') || sessionStorage.getItem('pv_trashed') || '[]';
    trashedPhotos = JSON.parse(raw);
  } catch(e) { trashedPhotos = []; }
}

function _saveTrashed() {
  try {
    // Only persist cloud-storage trashed items across sessions.
    // Local/IDB trashed items are session-only — they vanish on refresh
    // because their encrypted data is no longer available after load().
    const persistable = trashedPhotos.filter(p => p.storage === 'cloud' && p.encUrl);
    const t = JSON.stringify(persistable);
    localStorage.setItem('pv_trashed', t);
    try { sessionStorage.setItem('pv_trashed', t); } catch(e) {}
  } catch(e) {}
}

  function sanitize(el) {
    let dirty = false;
    BANNED_PROPS.forEach(prop => {
      const v = el.style[prop];
      if (!v) return;
      // Allow any linear-gradient — set by _applyBrandCSS; browser normalises
      // hex → rgb so exact string match would always fail for gradient values.
      if (v.trim().startsWith('linear-gradient')) return;
      // Use dynamically-updated allowed list so preset colours pass through
      if (!_brandGuardAllowed.includes(v.trim())) {
        el.style[prop] = SAFE[prop] || 'none';
        dirty = true;
      }
    });
    // Sub elements: allow preset subColor in addition to white family
    if (SUB_IDS.includes(el.id) && el.style.color) {
      const allowed = ['rgba(255,255,255,0.75)','rgba(255, 255, 255, 0.75)','#ffffff','white','',
                       ..._brandGuardAllowed];
      if (!allowed.includes(el.style.color.trim())) {
        el.style.color = 'rgba(255,255,255,0.75)';
        dirty = true;
      }
    }
    if (dirty) console.warn('[BrandGuard] Cleaned rogue style on', el.id);
  }

function showConfirmModal(title, message, confirmLabel, confirmColor, onConfirm) {
  let el = document.getElementById('_confirmModal');
  if (!el) {
    el = document.createElement('div');
    el.id = '_confirmModal';
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);align-items:center;justify-content:center;padding:24px;box-sizing:border-box;';
    el.innerHTML = `
      <div id="_confirmBox" style="background:#1c1c1e;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:28px 24px 20px;max-width:320px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,0.8);">
        <div id="_confirmTitle" style="font-size:17px;font-weight:800;color:#fff;margin-bottom:8px;"></div>
        <div id="_confirmMsg" style="font-size:13px;color:rgba(255,255,255,0.45);line-height:1.5;margin-bottom:24px;"></div>
        <div style="display:flex;gap:10px;">
          <button id="_confirmCancel" style="flex:1;padding:12px;border-radius:12px;border:none;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7);font-size:14px;font-weight:700;cursor:pointer;">Cancel</button>
          <button id="_confirmOk" style="flex:1;padding:12px;border-radius:12px;border:none;font-size:14px;font-weight:700;cursor:pointer;color:#fff;"></button>
        </div>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('_confirmCancel').onclick = () => { el.style.display = 'none'; };
    el.addEventListener('click', e => { if (e.target === el) el.style.display = 'none'; });
  }
  document.getElementById('_confirmTitle').textContent = title;
  document.getElementById('_confirmMsg').textContent = message;
  const okBtn = document.getElementById('_confirmOk');
  okBtn.textContent = confirmLabel || 'Confirm';
  okBtn.style.background = confirmColor || '#007aff';
  okBtn.onclick = () => { el.style.display = 'none'; if (onConfirm) onConfirm(); };
  el.style.display = 'flex';
}

function installPWA() {
  if (!_deferredInstallPrompt) {
    showToast('ℹ️ Already installed or use browser menu → Add to Home Screen');
    return;
  }
  _deferredInstallPrompt.prompt();
  _deferredInstallPrompt.userChoice.then(choice => {
    if (choice.outcome === 'accepted') showToast('🎉 Installing Hope…');
    _deferredInstallPrompt = null;
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.style.display = 'none';
  });
}

/* ── Wire the ported engine into the existing unlock/lock flow ──
   (unlockVault/lockVault already exist above; we wrap them rather than
   edit them, matching the render()-hooking pattern from the source file) */
const _origUnlockVault = unlockVault;
unlockVault = function(...args) {
  _origUnlockVault.apply(this, args);
  load();
  _initStoragePersistence();
  startCloudPolling();
  if (typeof render === 'function') render();
  if (typeof renderFolders === 'function') renderFolders();
};

const _origLockVault = lockVault;
lockVault = function(...args) {
  stopCloudPolling();
  _origLockVault.apply(this, args);
};
