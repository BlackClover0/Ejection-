/* ════════════════════════════════════════════════════════════════════════
   TABLE OF CONTENTS — 6 sections, in the order they appear in this file.

   Some functions are declared TWICE on purpose: once as an early stub
   (so nothing throws before the real thing loads) and once as the real
   implementation further down, which overrides it. JS keeps whichever
   declaration runs LAST, so moving code out of this order would silently
   break things. Sections are labeled where they sit rather than physically
   regrouped, for that reason.

     SECTION 1 — LOCK SCREEN ................. line 1
     SECTION 2 — SIDEBAR ...................... line ~195
       (also holds shared app state + early stub functions that must
       load before the sidebar init code and later sections use them)
     SECTION 3 — HOMEPAGE, part A ............. line ~705
       (date/time + greeting + stats widget)
     SECTION 4 — PAGE 2 ........................ line ~838
       (tab/sort menus, All-Folders sheet, folder detail page,
       collection pages for Pinned/Picked/Images/Videos/GIFs/WebP)
     SECTION 3 — HOMEPAGE, part B (continued) . line ~2776
       (real render()/renderFolders()/renameFolder()/deleteFolder() —
       declared here, after the stubs in Section 2, so these win)
     SECTION 5 — SHARED ........................ line ~2986
       (encryption, IndexedDB, pCloud sync, storage accounting/
       quota, bin/trash — cross-page state and services other sections
       depend on, so it loads before Section 6)
     SECTION 6 — EVERYTHING ELSE ............... line ~4611
       (real switchToPage()/_goToPg2() page-switch + swipe logic,
       lightbox, move-to-folder modal, file upload, thumbnail
       rendering, confirm modal, PWA install, lock-screen overrides —
       depends on Section 5, so it loads after it)
   ════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   SECTION 1 — VAULT UNLOCK (PIN lock screen removed — app is opened
   directly. Using an APK with the phone's own app-locker instead.
   sessionPin is now a fixed constant: encryptBlob/decryptBlob derive
   the real AES-256 key from it via PBKDF2, so it still needs a value
   even with no PIN UI. Fresh install, so no legacy PIN-encrypted data
   to migrate.
   ══════════════════════════════════════════════════════════════════ */
const sessionPin = 'hope-vault-static-key-v1';

async function unlockVault() {
  // Paint the library from the on-device index first (instant, works offline),
  // then sync with the cloud manifest in the background.
  try { await _vcLoadIndexIntoPhotos(); } catch (e) { console.warn('[vc] index load failed', e); }
  _autoRestoreFromCloud();
}


/* Runs automatically every time the vault is unlocked (fresh unlock, first-
   time PIN setup, or a PIN change) so cloud-stored photos decrypt and
   reappear on their own. Deliberately quiet: it should never greet the
   person with a scary error toast just because they haven't uploaded
   anything yet or a request briefly failed. */
async function _autoRestoreFromCloud() {
  if (!isPcloudEnabled() || !sessionPin) return;
  // Quiet auto-op — if an upload is already in flight, just skip this pass
  // rather than blocking unlock.
  if (_cloudUploadBusy) return;
  await _acquireCloudDirection('retrieve', 4000);
  try {
    const manifest = await _tgLoadManifest();
    if (!manifest || !Array.isArray(manifest.photos)) return;
    const st = _vcMergeManifest(manifest);
    _saveLocalOnly();            // persists folders + the on-device index
    _vcWarmThumbs();             // background: pull missing thumbnails into the device cache
    if (st.added > 0) {
      showToast(`☁️ ${st.added} photo${st.added !== 1 ? 's' : ''} restored from pCloud`);
      _setActivityStatus(`${st.added} file${st.added !== 1 ? 's' : ''} retrieved from cloud`, 'fa-cloud-arrow-down', 'cloud');
    }
  } catch(e) {
    // A missing manifest (nothing pushed yet) or a transient network hiccup
    // shouldn't interrupt opening the app.
    console.warn('Auto-restore from cloud skipped:', e.message);
  } finally {
    _releaseCloudDirection('retrieve');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  unlockVault();
});

/* ════════════════════════════════════════════════════════════════════════
     SECTION 2 — SIDEBAR
     NOTE: Also holds shared app state and early stub functions (save/load/
     render/openBinModal/etc.). They have to live here, before the sidebar
     init code below that calls them — and before Sections 3-5 declare the
     real versions that override these stubs. See the table of contents
     at the top of the file for where each real version lives.
     ════════════════════════════════════════════════════════════════════════ */
/* ══ SHARED STATE ══ */
let photos        = [];
let folders       = [];
let activeFolder  = 'home';
let selectMode    = false;
let selected      = new Set();
let cardMap       = {};
let _galPage      = 0; // default: page 1 (Photos/homepage) — matches what's actually shown on load

/* ── Stub helpers ── */
function showToast(msg, type) {
  if (!document.getElementById('_toastKf')) {
    const s = document.createElement('style');
    s.id = '_toastKf';
    s.textContent = `
      @keyframes _toastIn  { from{transform:translate(-50%,14px);opacity:0} to{transform:translate(-50%,0);opacity:1} }
      @keyframes _toastOut { from{transform:translate(-50%,0);opacity:1} to{transform:translate(-50%,14px);opacity:0} }
    `;
    document.head.appendChild(s);
  }
  let t = document.getElementById('_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_toast';
    t.style.cssText = 'position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 32px);left:50%;background:rgba(28,28,30,0.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:white;padding:11px 18px;border-radius:100px;font-size:13px;font-weight:600;z-index:99999;pointer-events:none;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,0.08);box-shadow:0 8px 24px rgba(0,0,0,0.45);';
    document.body.appendChild(t);
  }
  const dotColor = type === 'success' ? '#34d399' : type === 'error' ? '#ff5c5c' : 'rgba(255,255,255,0.4)';
  t.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${dotColor};flex-shrink:0;"></span><span style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(msg)}</span>`;
  t.style.display = 'flex';
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '_toastIn 0.22s cubic-bezier(.34,1.56,.64,1) both';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => {
    t.style.animation = '_toastOut 0.25s ease both';
    clearTimeout(t._hid);
    t._hid = setTimeout(() => { t.style.display = 'none'; }, 250);
  }, 2400);
}
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* Cloud bar (top of the homepage) — full-width bar showing whether pCloud is
   connected, the latest cloud activity line, and the Upload-all button.
   _setActivityStatus() updates the activity line; _updateCloudBar() syncs the
   connected / not-connected state. Both fail silently if the bar isn't in
   the DOM yet. */
function _setActivityStatus(text, iconClass) {
  const iconEl = document.getElementById('activityCloudIcon');
  const timeEl = document.getElementById('activityCloudTime');
  if (!iconEl || !timeEl) return;
  if (iconClass) iconEl.innerHTML = `<i class="fas ${iconClass}"></i>`;
  timeEl.textContent = text.includes('…') ? text : text + ' · just now';
}

function _cloudBarIdleText(on) {
  if (!on) return 'Connect pCloud to back up your files';
  const n = (typeof _pendingUploadCount === 'function') ? _pendingUploadCount() : 0;
  return n > 0 ? `${n} file${n !== 1 ? 's' : ''} waiting · tap Upload` : 'Everything is backed up';
}

function _updateCloudBar(force) {
  const card = document.getElementById('activityCloudCard');
  if (!card) return;
  const on = (typeof isPcloudEnabled === 'function') && isPcloudEnabled();
  const changed = card.dataset.state !== (on ? '1' : '0');
  card.dataset.state = on ? '1' : '0';
  card.classList.toggle('connected', on);
  const t = document.getElementById('activityCloudText');
  const sub = document.getElementById('activityCloudTime');
  const icon = document.getElementById('activityCloudIcon');
  if (t) t.textContent = on ? 'Connected to pCloud' : 'Not connected';
  if (window._tgPushBusyUI) return; // an upload is running — its progress line owns the bar
  if (icon && (changed || force || !icon.firstElementChild || /circle|arrow|lock/.test(icon.firstElementChild.className))) {
    icon.innerHTML = `<i class="fas ${on ? 'fa-cloud' : 'fa-link-slash'}"></i>`;
  }
  // keep the latest activity line (e.g. "12 files uploaded") unless something changed
  if (sub && (changed || force)) sub.textContent = _cloudBarIdleText(on);
}

function _setCloudBarBusy(busy) {
  window._tgPushBusyUI = !!busy;
  const btn = document.getElementById('activityCloudUploadBtn');
  if (!btn) return;
  btn.disabled = !!busy;
  btn.classList.toggle('busy', !!busy);
  btn.innerHTML = busy ? '<i class="fas fa-rotate"></i><span>Uploading</span>' : '<i class="fas fa-cloud-arrow-up"></i><span>Upload</span>';
}

document.addEventListener('DOMContentLoaded', () => { _updateCloudBar(); });

function save() { try { localStorage.setItem('pv_folders', JSON.stringify(folders)); } catch(e) {} }
function load() { try { const f = localStorage.getItem('pv_folders'); if (f) folders = JSON.parse(f); } catch(e) {} }
function render() { showToast('📸 Gallery render (requires full app)'); }
function renderFolders() {}
function exitSelectMode() {
  selectMode = false;
  selected.clear();
  document.getElementById('selectBanner').style.display = 'none';
  document.querySelectorAll('#folderDetailOverlay .fdp-card.fdp-selected').forEach(el => {
    if (typeof _fdpSetCardSelected === 'function') _fdpSetCardSelected(el, false);
  });
  // Media-type collection pages (Images/Videos/GIFs/WebP/Picked) have their
  // own selection highlight class — previously left un-cleared here, so a
  // card could stay showing the "selected" ring/badge after Download,
  // Delete, Move, or Cancel finished.
  document.querySelectorAll('#collectionPageOverlay .cp-card.cp-selected').forEach(el => {
    if (typeof _cpSetCardSelected === 'function') _cpSetCardSelected(el, false);
  });
}
function updateCardSelection() {}
function updateSelectBanner() { const e = document.getElementById('selCount'); if (e) e.textContent = selected.size + ' selected'; }

/* ── Bulk Download / Delete for the multi-select banner (#selectBanner).
   These previously didn't exist at all — the buttons always fell back to
   a "Not available yet" toast — Move was the only bulk action that
   worked. Both read straight off the shared `selected` Set, so they work
   anywhere select mode can be entered: inside a folder, inside a
   subfolder (same folder-detail overlay), and every media-type
   collection page (Images/Videos/GIFs/WebP/Picked), with no per-page
   wiring needed. ── */
async function bulkDownload() {
  const ids = (typeof selected !== 'undefined' && selected.size > 0)
    ? new Set(selected)
    : (typeof contextTarget !== 'undefined' && contextTarget ? new Set([contextTarget.id]) : new Set());
  if (ids.size === 0) return;
  const items = (typeof photos !== 'undefined' ? photos : []).filter(p => ids.has(p.id));
  if (items.length === 0) { showToast('Nothing to download'); return; }

  showToast(`⬇️ Saving ${items.length} file${items.length !== 1 ? 's' : ''}…`);
  let ok = 0, failed = 0;
  for (const p of items) {
    try {
      let encBlob;
      if (p.storage === 'cloud') encBlob = await fetchCloudBlob(p);
      else if (p.storage === 'idb') { encBlob = await idbGet(p.encId); if (!encBlob) throw new Error('Missing'); }
      else encBlob = base64ToBlob(p.encData);
      const plain = await decryptBlob(encBlob, sessionPin);
      const url = URL.createObjectURL(plain);
      _triggerDownload(url, p.name);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      ok++;
      // A small stagger between triggered downloads — firing many
      // programmatic downloads back-to-back in the same tick gets some of
      // them silently dropped by the browser/WebView.
      if (items.length > 1) await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      failed++;
    }
  }
  exitSelectMode();
  showToast(failed === 0 ? `⬇️ Saved ${ok} file${ok !== 1 ? 's' : ''}` : `⬇️ Saved ${ok}, ${failed} failed`);
}

function bulkDelete() {
  const ids = (typeof selected !== 'undefined' && selected.size > 0)
    ? new Set(selected)
    : (typeof contextTarget !== 'undefined' && contextTarget ? new Set([contextTarget.id]) : new Set());
  if (ids.size === 0) return;

  const count = ids.size;
  showConfirmModal(
    'Move to Bin?',
    count + (count === 1 ? ' file' : ' files') + ' will be moved to Bin.',
    'Move to Bin', '#ff4444',
    () => {
      const moved = [];
      if (typeof photos !== 'undefined') {
        for (let i = photos.length - 1; i >= 0; i--) {
          const p = photos[i];
          if (!ids.has(p.id)) continue;
          p.trashedAt = Date.now();
          if (p.storage === 'idb') _removeFromPendingQueue(p.id);
          moved.push(p);
          photos.splice(i, 1);
        }
      }
      if (typeof trashedPhotos !== 'undefined') trashedPhotos.push(...moved);
      if (typeof _saveTrashed === 'function') _saveTrashed();
      exitSelectMode();
      if (typeof save === 'function') save();
      if (typeof render === 'function') render();
      if (typeof renderFolders === 'function') renderFolders();
      if (typeof _updateBinBadge === 'function') _updateBinBadge();
      showToast(`🗑️ Moved ${moved.length} to Bin`);
    }
  );
}
function openLightbox() { showToast('🔍 Lightbox (requires full app)'); }
function openCloudModal() { showToast('☁️ pCloud (requires full app)'); }
function openBinModal() { showToast('🗑️ Bin (requires full app)'); }
function getRootFolderId(id) { const f = folders.find(x => x.id === id); return f?.parentId ? f.parentId : id; }
function openFolderActionSheet(f, e) {
  // Real implementation (_afsOpenFolderMenu, defined later) opens the same
  // rename/pin/delete menu used by the All-Folders sheet; fall back to a
  // toast only if that hasn't loaded for some reason.
  if (typeof _afsOpenFolderMenu === 'function') {
    const r = e && e.target && e.target.getBoundingClientRect ? e.target.getBoundingClientRect() : null;
    _afsOpenFolderMenu(f, r ? r.left : 40, r ? r.bottom : 80);
  } else {
    showToast('📁 Options for: ' + f.name);
  }
}
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
  // Header hamburger icon now opens the sidebar the same way the
  // left/right swipe gesture does, instead of the old bottom
  // select-all action banner.
  if (window._sidebarIsOpen) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

/* Exactly matches #pageSlideTrack's CSS transition (index.html) — same
   duration and easing curve as the Home↔Gallery swipe, so the sidebar
   feels like the same physical track instead of a separately-tuned
   animation system. */
const SIDEBAR_TRANSITION = 'transform 0.46s cubic-bezier(0.22, 1, 0.36, 1)';

/* Same rubber-band amount used on the Home↔Gallery page swipe — dragging
   the sidebar past fully-open or fully-closed now gives a little instead
   of stopping dead, matching that swipe's feel. Drag call sites compute
   progress with this resistance already applied (see the two drag
   handlers below), so this no longer hard-clamps to [0,1] — that clamp
   used to silently cancel the overshoot before it could ever render. */
const SIDEBAR_EDGE_RESISTANCE = 0.32;

function _sidebarApplyProgress(progress) {
  // progress: 0 = fully closed, 1 = fully open (callers may pass slightly
  // outside this range mid-drag for the rubber-band effect)
  const sb = document.getElementById('sidebar');
  const aw = document.getElementById('appWrap');
  const p  = progress;
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
/* Keeps the bottom bar's glow on exactly one label at a time: "Sidebar" while
   the drawer is open, otherwise whichever of Home/Gallery matches _galPage. */
function _syncTabBarActive(sidebarOpen) {
  const ts = document.getElementById('tabSidebar');
  const tp = document.getElementById('tabPhotos');
  const ta = document.getElementById('tabAlbums');
  if (ts) ts.classList.toggle('active', sidebarOpen);
  const onPg2 = (typeof _galPage !== 'undefined' && _galPage === 1);
  if (tp) tp.classList.toggle('active', !sidebarOpen && !onPg2);
  if (ta) ta.classList.toggle('active', !sidebarOpen && onPg2);
}

function _sidebarSettle(open) {
  const sb = document.getElementById('sidebar');
  const aw = document.getElementById('appWrap');
  clearTimeout(_sidebarSettleTimer);
  window._sidebarIsOpen = open;
  _syncTabBarActive(open);
  if (sb) { sb.style.willChange = 'transform'; sb.style.transition = SIDEBAR_TRANSITION; }
  if (aw) { aw.style.willChange = 'transform'; aw.style.transition = SIDEBAR_TRANSITION; }
  _sidebarApplyProgress(open ? 1 : 0);
  if (aw) aw.classList.toggle('sidebar-pushed', open);
  _sidebarSettleTimer = setTimeout(() => {
    if (sb) {
      sb.classList.toggle('sidebar-closed', !open);
      sb.style.willChange = 'auto';
    }
    if (aw) {
      aw.style.willChange = 'auto';
      if (!open) {
        aw.style.transform    = '';
        aw.style.transition   = '';
        aw.style.pointerEvents = '';
      }
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

/* ── Suppress back navigation (browser back button + Android hardware back)
   while a selection is active, or while a folder detail page (top-level or
   subfolder) is open. In those states, pressing back performs no action —
   no closing, no going up a level, no deselecting. Explicit in-app buttons
   (the X / back arrow inside the folder page) still work normally, since
   they call their close functions directly instead of going through here. */
function _backNavShouldBeSuppressed() {
  if (typeof selectMode !== 'undefined' && selectMode) return true;
  const fdp = document.getElementById('folderDetailOverlay');
  if (fdp && (fdp.style.display === 'flex' || fdp.style.display === '')) return true;
  return false;
}
window.addEventListener('popstate', function(e) {
  if (_backNavShouldBeSuppressed()) {
    // Immediately re-push the state that was just popped, so the back
    // action (hardware button or browser back) has no visible effect.
    history.pushState(e.state || {}, '');
  }
});

function openSidebar() {
  const sb = document.getElementById('sidebar');
  const aw = document.getElementById('appWrap');
  if (!sb) return;

  // Highlight correct sidebar tab
  const tg = document.getElementById('sidebarTabGallery');
  const tc = document.getElementById('sidebarTabCollections');
  if (tg && tc) {
    const onPg2 = (typeof _galPage !== 'undefined' && _galPage === 1);
    tg.classList.toggle('active', !onPg2);
    tc.classList.toggle('active', onPg2);
  }

  window._sidebarIsOpen = true;
  _syncTabBarActive(true);
  // Step 1: position sidebar at closed state with NO transition
  sb.style.willChange = 'transform';
  sb.style.transition = 'none';
  sb.classList.remove('sidebar-closed');
  _sidebarApplyProgress(0);
  // Reset appWrap transitions so step 2 drives them cleanly
  if (aw) {
    aw.style.willChange = 'transform';
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
    setTimeout(() => { sb.style.willChange = 'auto'; if (aw) aw.style.willChange = 'auto'; }, 520);
  }));
}

function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const aw = document.getElementById('appWrap');
  if (!sb) return;

  // Mark closed immediately so swipe gestures unblock right away
  window._sidebarIsOpen = false;
  _syncTabBarActive(false);

  sb.style.willChange = 'transform';
  sb.style.transition = SIDEBAR_TRANSITION;
  // Also transition the appWrap slide back smoothly
  if (aw) {
    aw.style.willChange = 'transform';
    aw.style.transition = SIDEBAR_TRANSITION;
  }

  _sidebarApplyProgress(0);
  if (aw) aw.classList.remove('sidebar-pushed');

  setTimeout(() => {
    sb.classList.add('sidebar-closed');
    sb.style.willChange = 'auto';
    if (aw) {
      aw.style.willChange = 'auto';
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
      row.onclick = () => { exitSelectMode(); closeSidebar(); openFolderDetailPage(f.id); };
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
      row.onclick = () => { exitSelectMode(); closeSidebar(); openFolderDetailPage(sf.id); };
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
          // Open the folder containing this photo, then the lightbox on top of it
          const targetFolder = p.folder || 'home';
          exitSelectMode(); closeSidebar();
          let list;
          if (targetFolder === 'home') list = photos.filter(x => !x.folder || x.folder === 'home');
          else list = photos.filter(x => x.folder === targetFolder);
          const idx = list.findIndex(x => x.id === p.id);
          if (targetFolder !== 'home') openFolderDetailPage(targetFolder);
          setTimeout(() => { if (idx >= 0) openLightbox(idx, list); }, targetFolder !== 'home' ? 200 : 0);
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
    label.onclick = () => { exitSelectMode(); closeSidebar(); openFolderDetailPage(f.id); };

    const optBtn = document.createElement('button');
    optBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
    optBtn.title = 'Folder options';
    optBtn.className = 'rename-btn ml-auto px-2';
    optBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;opacity:0.55;transition:opacity 0.15s;color:rgba(255,255,255,0.5);flex-shrink:0;';
    optBtn.onclick = (e) => { e.stopPropagation(); openFolderActionSheet(f, e); };

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
     appWrap chasing a moving target through its own 0.52s animation.

     Axis-locked exactly like the Photos↔Albums swipe on #pageWrapper: the
     first few px of movement decide ONCE whether this is a horizontal
     swipe (close the sidebar) or a vertical scroll (hand off to the
     list's native scrolling and never touch it again for this touch).
     The old version decided "closing" from horizontal distance alone,
     with no comparison to vertical distance — so an ordinary vertical
     scroll (fingers always drift a few px sideways) kept getting
     misread as a close-swipe, freezing the transition mid-scroll and
     snapping the sidebar shut on lift-off. That was the source of the
     janky scrolling, the swipe/scroll conflict, and the jump/flicker. */
  let startX = 0, startY = 0, lastX = 0, lastT = 0, velocity = 0;
  let dragging = false, isHorizontal = null;
  const CLOSE_COMMIT   = 0.10; // match SIDEBAR_COMMIT on the homepage — gentle, small swipe
  const FLING_SPEED    = 0.5;  // px/ms — same fling threshold as the homepage handler
  const AXIS_THRESHOLD = 8;    // px of movement before committing to swipe vs scroll
  const sb = document.getElementById('sidebar');
  const aw = document.getElementById('appWrap');
  if (sb) {
    sb.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      startX = lastX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      lastT = Date.now();
      velocity = 0;
      dragging = false;
      isHorizontal = null;
    }, { passive: true });

    sb.addEventListener('touchmove', e => {
      if (isHorizontal === false) return; // locked to vertical — fully hands off to native scroll
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      const dx = startX - x, dy = y - startY;

      if (isHorizontal === null) {
        if (Math.abs(dx) < AXIS_THRESHOLD && Math.abs(dy) < AXIS_THRESHOLD) return; // not enough movement yet to tell
        isHorizontal = Math.abs(dx) > Math.abs(dy);
        if (!isHorizontal) return; // vertical intent confirmed — let the list scroll, untouched from here on
        // Horizontal intent confirmed — now (and only now) start the
        // close-drag, freezing both layers so they track the finger 1:1.
        dragging = true;
        sb.style.willChange = 'transform';
        sb.style.transition = 'none';
        if (aw) { aw.style.willChange = 'transform'; aw.style.transition = 'none'; }
      }

      if (!dragging || !window._sidebarIsOpen) return;
      // Safe to take over the gesture now — stop native scroll/bounce
      // from also reacting to the same drag.
      if (e.cancelable) e.preventDefault();

      const now = Date.now();
      const dt = Math.max(1, now - lastT);
      velocity = (x - lastX) / dt;
      lastX = x; lastT = now;
      // Rubber-band past the edges instead of a hard clamp — same
      // resistance as the Home↔Gallery page swipe.
      let progress = 1 - (dx / window.innerWidth);
      if (progress > 1)      progress = 1 + (progress - 1) * SIDEBAR_EDGE_RESISTANCE;
      else if (progress < 0) progress = progress * SIDEBAR_EDGE_RESISTANCE;
      _sidebarApplyProgress(progress);
    }, { passive: false });

    sb.addEventListener('touchend', e => {
      if (!dragging) { isHorizontal = null; return; }
      const dx = startX - e.changedTouches[0].clientX;
      const flinging = Math.abs(velocity) > FLING_SPEED;
      _sidebarSettle(!(dx > window.innerWidth * CLOSE_COMMIT || (flinging && dx > 0)));
      dragging = false;
      isHorizontal = null;
    }, { passive: true });

    sb.addEventListener('touchcancel', () => {
      if (dragging) _sidebarSettle(true);
      dragging = false;
      isHorizontal = null;
    }, { passive: true });
  }
});

/* ════════════════════════════════════════════════════════════════════════
     SECTION 3 — HOMEPAGE (part A)
     NOTE: date/time + greeting banner updater. The rest of the homepage
     (render()/renderFolders()/renameFolder()/deleteFolder()) is further
     down, after Section 4, because it has to be declared after the stubs
     in Section 2 to override them — see the table of contents up top.
     ════════════════════════════════════════════════════════════════════════ */
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
  var MONTHS_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sept','Oct','Nov','Dec'];

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
    var gbGreetingEl = document.getElementById('gbGreeting');
    var gbFullDateEl = document.getElementById('gbFullDate');

    var weekdayName = WEEKDAYS[now.getDay()];
    var fullDate = MONTHS_FULL[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
    // Two-line hero date: "Saturday" / "19 Sept , 2026 ."
    var heroDate = weekdayName + '\n' + now.getDate() + ' ' + MONTHS_ABBR[now.getMonth()] + ' , ' + now.getFullYear() + ' .';

    if (weekdayEl) weekdayEl.textContent = weekdayName;
    if (fullDateEl) fullDateEl.textContent = fullDate;

    var hrs = now.getHours();
    var ampm = hrs >= 12 ? 'pm' : 'am';
    var h12 = hrs % 12; if (h12 === 0) h12 = 12;
    var timeStr = h12 + ':' + pad(now.getMinutes()) + ' ' + ampm;
    if (timeEl) timeEl.textContent = timeStr;
    if (topTimeEl) topTimeEl.textContent = timeStr;

    if (gbGreetingEl) gbGreetingEl.textContent = greetingForHour(hrs);
    if (gbFullDateEl) gbFullDateEl.textContent = heroDate;
  }

  // Cache of the raw stat numbers, still exposed on window in case other
  // parts of the app read them.
  function syncStats() {
    var headerCount = document.getElementById('statCount');
    var headerStorage = document.getElementById('storageUsageLabel');
    var storageValEl = document.getElementById('dcStorageValue');
    var storageLabelEl = document.getElementById('dcStorageLabel');
    var storageFillEl = document.getElementById('dcStorageFill');
    var progressWrap = document.getElementById('dcStorageProgressWrap');
    var storagePctEl = document.getElementById('dcStoragePct');

    if (headerCount) {
      var countMatch = headerCount.textContent.match(/[\d,]+/);
      window._itemsCount = countMatch ? countMatch[0] : '0';
      // NOTE: dcCountValue (the "Files" dashboard card) is intentionally
      // NOT set here — it's kept in sync with the TOTAL library count
      // (photos.length, across all folders) directly inside render(),
      // since #statCount only ever tracks unfiled home-page photos.
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

    if (storageValEl && window._storageUsedText) storageValEl.textContent = window._storageUsedText;
    if (storageLabelEl && window._storageTotalText) storageLabelEl.textContent = 'of ' + window._storageTotalText + ' used';
    if (storageFillEl && window._storagePct !== undefined) storageFillEl.style.width = window._storagePct + '%';
    if (storagePctEl && window._storagePct !== undefined) storagePctEl.textContent = Math.round(window._storagePct) + '% full';
    if (progressWrap) progressWrap.style.display = '';
  }

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
  window._goToPicked = function () {
    _callFirstAvailable(['openPickedFiles', 'showPicked', 'goToPicked', 'openPicked'], 'Picked');
  };
  window._goToBin = function () {
    _callFirstAvailable(['openBinFolder', 'showBin', 'goToBin', 'openBin', 'openTrash', 'openBinModal'], 'Bin');
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

/* ════════════════════════════════════════════════════════════════════════
     SECTION 4 — PAGE 2
     Tab/sort menus, the All-Folders sheet, the folder detail page, and the
     collection pages (Pinned / Picked / Images / Videos / GIFs / WebP).
     ════════════════════════════════════════════════════════════════════════ */
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
  // sidebar is intentionally left open underneath so closing the bin returns to it
  _renderBinItems();
  try { _updateBinGridBtns(parseInt(localStorage.getItem('pv_bin_grid') || '3')); } catch(e) {}
  const _bm = document.getElementById('binModal');
  _bm.classList.remove('closing');
  _bm.classList.add('open');
  // Restore saved background
  try {
    var savedBg = localStorage.getItem('pv_bin_bg');
    if (savedBg === 'image') _setBinBg('image'); else if (savedBg === 'gold') _setBinBg('gold'); else _setBinBg('black');
  } catch(e) {}
  // Restore saved logo
  try {
    const saved = localStorage.getItem('pv_bin_logo');
    if (saved) { const img = document.getElementById('binHeaderLogo'); if (img) img.src = saved; }
  } catch(e) {}
}


function _switchTab(n) {
  // If the sidebar drawer is open (or mid-close animation), close it first
  // and let the page switch happen right after — same pattern the sidebar's
  // own Gallery/Albums pills already use. Without this, tapping Home/Gallery
  // while the sidebar is open changes the page behind the still-open drawer
  // (two tabs lit up at once, and a page change you can't even see yet).
  if (window._sidebarIsOpen) {
    closeSidebar();
    setTimeout(() => _switchTab(n), 180);
    return;
  }
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
          if (img.storage === 'cloud' && img.pcFileId) {
            blob = await decryptBlob(await fetchCloudBlob(img), sessionPin);
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


/* ── Display Settings page — real implementation (previously a
     "requires full app" placeholder toast). Settings, all persisted
     to localStorage and applied on load:
     - Theme (dark/light)
     - Brightness (dims/brightens the whole app)
     - Home gallery grid column count
     - Reduce motion (disables the sheet slide-up/down animations)

     Theme + brightness are both applied as a single CSS filter on
     <html> so they compose correctly: light mode inverts + hue-rotates
     the whole UI (a "poor man's" theme flip that works without
     re-theming every hardcoded color), and photos/videos get the same
     invert+hue-rotate a second time via CSS (see html.light-mode img/
     video in index.html) so the two passes cancel out and pictures
     keep their true colors. Brightness scales on top of that. ── */
/* Grid columns + Reduce motion no longer have visible controls (their
   Display Settings sections were removed), so they're pinned to their
   normal/default values here instead of being read back from
   localStorage — otherwise a value a person set before the controls
   were removed would stay stuck with no way to change it back. Also
   clear out any old saved values so a re-added control later starts
   from a clean slate. */
localStorage.removeItem('pv_homeGrid');
localStorage.removeItem('pv_reduceMotion');
let _dsGridCols = 4;
let _dsReduceMotion = false;
let _dsLightMode = localStorage.getItem('pv_lightMode') === '1';
let _dsBrightness = parseInt(localStorage.getItem('pv_brightness') || '100');

function openDisplaySettings() {
  const sheet = document.getElementById('displaySettingsSheet');
  const panel = document.getElementById('displaySettingsPanel');
  if (!sheet || !panel) return;
  sheet.style.display = 'block';
  panel.style.animation = _dsReduceMotion ? 'none' : 'afsSlideUp 0.58s cubic-bezier(0.22,1,0.36,1) both';
  _dsRefreshUI();
}

function closeDisplaySettings() {
  const sheet = document.getElementById('displaySettingsSheet');
  const panel = document.getElementById('displaySettingsPanel');
  if (!sheet || !panel) return;
  if (_dsReduceMotion) {
    sheet.style.display = 'none';
    return;
  }
  panel.style.animation = 'afsSlideOut 0.28s cubic-bezier(0.22,1,0.36,1) forwards';
  setTimeout(() => {
    sheet.style.display = 'none';
    panel.style.animation = '';
  }, 280);
}

function _dsRefreshUI() {
  [3, 4, 5].forEach(n => {
    const btn = document.getElementById('dsGrid' + n + 'Btn');
    if (btn) btn.classList.toggle('active', n === _dsGridCols);
  });
  const toggle = document.getElementById('dsReduceMotionToggle');
  if (toggle) toggle.classList.toggle('on', _dsReduceMotion);

  const darkBtn = document.getElementById('dsThemeDarkBtn');
  const lightBtn = document.getElementById('dsThemeLightBtn');
  if (darkBtn) darkBtn.classList.toggle('active', !_dsLightMode);
  if (lightBtn) lightBtn.classList.toggle('active', _dsLightMode);

  const slider = document.getElementById('dsBrightnessSlider');
  const label = document.getElementById('dsBrightnessLabel');
  if (slider) slider.value = _dsBrightness;
  if (label) label.textContent = _dsBrightness + '%';
}

function _dsSetGridCols(n) {
  _dsGridCols = n;
  localStorage.setItem('pv_homeGrid', n);
  _dsApplyGridCols();
  _dsRefreshUI();
}

function _dsApplyGridCols() {
  const grid = document.getElementById('galleryGrid');
  if (grid) grid.style.gridTemplateColumns = 'repeat(' + _dsGridCols + ',minmax(0,1fr))';
}

function _dsToggleReduceMotion() {
  _dsReduceMotion = !_dsReduceMotion;
  localStorage.setItem('pv_reduceMotion', _dsReduceMotion ? '1' : '0');
  _dsRefreshUI();
}

function _dsSetTheme(isLight) {
  _dsLightMode = isLight;
  localStorage.setItem('pv_lightMode', isLight ? '1' : '0');
  _dsApplyAppearance();
  _dsRefreshUI();
}

function _dsSetBrightness(val) {
  _dsBrightness = parseInt(val, 10) || 100;
  localStorage.setItem('pv_brightness', _dsBrightness);
  _dsApplyAppearance();
  const label = document.getElementById('dsBrightnessLabel');
  if (label) label.textContent = _dsBrightness + '%';
}

function _dsApplyAppearance() {
  const html = document.documentElement;
  const parts = [];
  if (_dsLightMode) parts.push('invert(1) hue-rotate(180deg)');
  if (_dsBrightness !== 100) parts.push('brightness(' + (_dsBrightness / 100) + ')');
  html.style.filter = parts.join(' ');
  html.classList.toggle('light-mode', _dsLightMode);
}

// Apply saved appearance/grid settings once the page exists.
document.addEventListener('DOMContentLoaded', function () {
  _dsApplyGridCols();
  _dsApplyAppearance();
});

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
      if (typeof selectMode !== 'undefined' && selectMode) return;
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
  wrap.oncontextmenu = e => { e.preventDefault(); if (typeof selectMode !== 'undefined' && selectMode) return; if (opts.onLongPress) opts.onLongPress(e.clientX, e.clientY); };
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
      #folderDetailOverlay .fdp-card.fdp-selected { box-shadow:inset 0 0 0 3px var(--cyan, #3de8d8); }
      #folderDetailOverlay .fdp-select-badge { position:absolute; top:6px; right:6px; width:20px; height:20px; border-radius:50%; background:var(--cyan, #3de8d8); color:#ffffff; display:flex; align-items:center; justify-content:center; font-size:11px; z-index:6; box-shadow:0 2px 8px rgba(0,0,0,0.5); pointer-events:none; }
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

  // Collect photos — only ones uploaded directly into THIS folder. Photos
  // inside a subfolder stay on the subfolder's own page (the subfolder is
  // still shown here as a tile, with its own photo count).
  let folderPhotos = allPhotos.filter(p => p.folder === f.id);

  // Saved grid cols + sort
  const savedCols = parseInt(localStorage.getItem('pv_fdpGrid_' + f.id) || '3');
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
    <div onclick="_fdpUpload();_fdpCloseMenu();" style="display:flex;align-items:center;gap:13px;padding:14px 16px;cursor:pointer;font-size:14px;font-weight:600;color:rgba(255,255,255,0.85);transition:background 0.1s;border-bottom:1px solid rgba(255,255,255,0.07);" onmouseenter="this.style.background='#242424'" onmouseleave="this.style.background=''"><i class="fas fa-plus" style="font-size:13px;width:18px;text-align:center;color:rgba(255,255,255,0.5);"></i>Add Files</div>
    ${f.parentId ? '' : `<div onclick="_fdpCreateSubfolder();_fdpCloseMenu();" style="display:flex;align-items:center;gap:13px;padding:14px 16px;cursor:pointer;font-size:14px;font-weight:600;color:rgba(255,255,255,0.85);transition:background 0.1s;border-bottom:1px solid rgba(255,255,255,0.07);" onmouseenter="this.style.background='#242424'" onmouseleave="this.style.background=''"><i class="fas fa-folder-plus" style="font-size:13px;width:18px;text-align:center;color:rgba(255,255,255,0.5);"></i>Create Subfolder</div>`}
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
    <!-- single scrollable wrapper: header + grid together, so the whole page scrolls as one -->
    <div style="flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;box-sizing:border-box;">
      <!-- header -->
      <div style="padding:18px 18px 0;background:#000000;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <button onclick="closeFolderDetailPage()"
            style="background:none;border:none;color:white;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.7));">
            <i class="fas fa-arrow-left"></i>
          </button>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;font-family:'Fredoka One',cursive;font-size:26px;line-height:1.2;min-width:0;">
              <i class="fas fa-folder-open" style="color:rgba(255,255,255,0.45);font-size:20px;flex-shrink:0;display:flex;align-items:center;"></i>
              <span style="color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;">${f.name}</span>
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
      <!-- grid — same padding/style as collection page -->
      <div style="padding:0 18px;box-sizing:border-box;">
        <div id="fdpGrid" style="display:grid;grid-template-columns:repeat(${savedCols},1fr);gap:10px;align-content:start;padding-top:14px;padding-bottom:calc(env(safe-area-inset-bottom,0px)+80px);width:100%;box-sizing:border-box;"></div>
      </div>
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

  // Render subfolder cards + photo cards (shared with in-place refresh after upload)
  _fdpRenderGridContents(f, allFolders, allPhotos, folderPhotos);
}

/* Shared color palette for subfolder tiles, used by every render/sync path
   so a given subfolder always gets the same color regardless of which
   function built its tile. */
const _fdpSfColorMap = [
  { bg:'linear-gradient(135deg,rgba(255,60,120,0.55),rgba(180,20,80,0.45))',  border:'rgba(255,100,160,0.70)', nameColor:'#ffb3d4', glow:'rgba(255,60,120,0.55)',  iconColor:'#ff80c0' },
  { bg:'linear-gradient(135deg,rgba(130,60,255,0.55),rgba(80,20,200,0.45))',  border:'rgba(160,100,255,0.70)', nameColor:'#c9a0ff', glow:'rgba(130,60,255,0.55)',  iconColor:'#c084fc' },
  { bg:'linear-gradient(135deg,rgba(20,180,160,0.55),rgba(10,120,110,0.45))', border:'rgba(40,220,200,0.70)',  nameColor:'#7dfff2', glow:'rgba(20,180,160,0.55)',  iconColor:'#3de8d8' },
  { bg:'linear-gradient(135deg,rgba(255,180,20,0.55),rgba(200,120,10,0.45))', border:'rgba(255,210,60,0.70)',  nameColor:'#ffe47a', glow:'rgba(255,180,20,0.55)',  iconColor:'#ffe04b' },
  { bg:'linear-gradient(135deg,rgba(255,100,30,0.55),rgba(200,50,10,0.45))',  border:'rgba(255,140,60,0.70)',  nameColor:'#ffc49a', glow:'rgba(255,100,30,0.55)',  iconColor:'#ff8c42' },
];

/* Builds a single subfolder tile (DOM element). Pure — does not touch the grid. */
function _fdpBuildSubfolderTile(sf, sc, sfPhotoCount) {
  const sfWrap = document.createElement('div');
  sfWrap.dataset.sfId = sf.id;
  sfWrap.style.cssText = 'position:relative;align-self:start;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;';

  const sfCard = document.createElement('div');
  sfCard.style.cssText = `width:100%;aspect-ratio:1/1;border-radius:16px;overflow:hidden;cursor:pointer;background:${sc.bg};border:2px solid ${sc.border};box-shadow:inset 0 1px 0 rgba(255,255,255,0.12),0 4px 16px rgba(0,0,0,0.35);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px;box-sizing:border-box;position:relative;transition:transform 0.2s cubic-bezier(.34,1.56,.64,1),box-shadow 0.2s;user-select:none;-webkit-user-select:none;`;

  const sfShine = document.createElement('div');
  sfShine.style.cssText = 'position:absolute;top:0;left:0;right:0;height:42%;background:linear-gradient(180deg,rgba(255,255,255,0.06) 0%,transparent 100%);border-radius:14px 14px 0 0;pointer-events:none;z-index:1;';
  sfCard.appendChild(sfShine);

  sfCard.innerHTML += `
    <i class="fas fa-folder" style="font-size:22px;position:relative;z-index:2;color:${sc.iconColor};filter:drop-shadow(0 2px 8px ${sc.iconColor});"></i>
    <div style="font-size:9px;line-height:1.25;font-weight:800;color:${sc.nameColor};text-align:center;word-break:break-word;max-width:92%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;position:relative;z-index:2;user-select:none;-webkit-user-select:none;">${sf.name}</div>
    <div data-sf-count style="font-size:8.5px;color:rgba(255,255,255,0.45);font-weight:700;position:relative;z-index:2;user-select:none;-webkit-user-select:none;">${sfPhotoCount} photo${sfPhotoCount!==1?'s':''}</div>
  `;

  let _sfLpt, _sfLpX = 0, _sfLpY = 0, _sfLpFired = false;
  sfWrap.addEventListener('touchstart', e => {
    sfCard.style.transform = 'scale(0.94)';
    _sfLpFired = false;
    _sfLpX = e.touches[0].clientX; _sfLpY = e.touches[0].clientY;
    _sfLpt = setTimeout(() => {
      if (typeof selectMode !== 'undefined' && selectMode) return;
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
  sfWrap.oncontextmenu = e => { e.preventDefault(); if (typeof selectMode !== 'undefined' && selectMode) return; _afsOpenFolderMenu(sf, e.clientX, e.clientY); };
  sfWrap.onmouseenter = () => { sfCard.style.transform = 'scale(1.05)'; sfCard.style.boxShadow = `0 8px 28px ${sc.glow},inset 0 1px 0 rgba(255,255,255,0.15)`; };
  sfWrap.onmouseleave = () => { sfCard.style.transform = ''; sfCard.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.12),0 4px 16px rgba(0,0,0,0.35)'; };
  sfWrap.onclick = () => {
    if (_sfLpFired) { _sfLpFired = false; return; }
    openFolderDetailPage(sf.id);
  };

  sfWrap.appendChild(sfCard);
  return sfWrap;
}

/* Builds a single photo card (DOM element) and wires up its lazy-decrypt
   observer. Pure — does not touch the grid. `folderPhotosRef` is a live
   reference to the current sorted photo list, used for lightbox index/nav. */
function _fdpBuildPhotoCard(img, i, folderPhotosRef) {
  const card = document.createElement('div');
  card.className = 'fdp-card';
  card.dataset.photoId = img.id;
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

  // Tap → lightbox (or toggle selection, if select mode is active), long-press → floating file menu (same pattern as subfolder tiles)
  let pressTimer, touchX = 0, touchY = 0, longPressActive = false;
  if (typeof selectMode !== 'undefined' && selectMode && typeof selected !== 'undefined' && selected.has(img.id)) {
    _fdpSetCardSelected(card, true);
  }
  card.onclick = (e) => {
    if (longPressActive) { longPressActive = false; return; }
    if (typeof selectMode !== 'undefined' && selectMode) { _fdpToggleCardSelect(img, card); return; }
    const idx = folderPhotosRef.findIndex(x => x.id === img.id);
    if (typeof openLightbox === 'function') openLightbox(idx >= 0 ? idx : i, folderPhotosRef.slice());
  };
  card.oncontextmenu = (e) => { e.preventDefault(); if (typeof selectMode !== 'undefined' && selectMode) return; _fdpOpenPhotoMenu(img, card); };
  card.addEventListener('touchstart', (e) => {
    touchX=e.touches[0].clientX; touchY=e.touches[0].clientY; longPressActive=false;
    pressTimer=setTimeout(()=>{
      if (typeof selectMode !== 'undefined' && selectMode) return;
      longPressActive=true;
      if (navigator.vibrate) navigator.vibrate(30);
      _fdpOpenPhotoMenu(img, card);
    }, 500);
  }, {passive:true});
  card.addEventListener('touchend', (e) => { clearTimeout(pressTimer); if(longPressActive)e.stopPropagation(); });
  card.addEventListener('touchmove', (e) => { if(Math.abs(e.touches[0].clientX-touchX)>14||Math.abs(e.touches[0].clientY-touchY)>14)clearTimeout(pressTimer); }, {passive:true});

  // Lazy-decrypt via IntersectionObserver
  const obs = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    obs.disconnect();
    _fdpLoadCardThumb(card, img, shimmer, lock);
  }, { rootMargin: '200px' });
  obs.observe(card);

  return card;
}

/* Full (re)build of #fdpGrid — clears and recreates every tile. Used only
   for the initial page open, where there's nothing on screen yet to flicker. */
function _fdpRenderGridContents(f, allFolders, allPhotos, folderPhotos) {
  const grid = document.getElementById('fdpGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const subFolders = allFolders.filter(sf => sf.parentId === f.id);

  subFolders.forEach((sf, sfIdx) => {
    const sfPhotos = allPhotos.filter(p => p.folder === sf.id);
    const sc = _fdpSfColorMap[sfIdx % _fdpSfColorMap.length];
    grid.appendChild(_fdpBuildSubfolderTile(sf, sc, sfPhotos.length));
  });

  // Fix empty state — show only if no photos AND no subfolders
  const fdpEmpty = document.getElementById('fdpEmpty');
  if (fdpEmpty) fdpEmpty.style.display = (folderPhotos.length === 0 && subFolders.length === 0) ? 'flex' : 'none';

  folderPhotos.forEach((img, i) => {
    grid.appendChild(_fdpBuildPhotoCard(img, i, folderPhotos));
  });
}

/* Syncs #fdpGrid to the current data WITHOUT recreating tiles that already
   exist on screen — this is what prevents the flicker/re-decrypt flash that
   a full grid.innerHTML='' + rebuild would cause when files are added to a
   folder that already has content. Existing photo/subfolder tiles are left
   completely untouched; only genuinely new or removed items change the DOM. */
function _fdpSyncGridContents(f, allFolders, allPhotos, folderPhotos) {
  const grid = document.getElementById('fdpGrid');
  if (!grid) return;
  const subFolders = allFolders.filter(sf => sf.parentId === f.id);

  const existingByKey = new Map();
  Array.from(grid.children).forEach(el => {
    if (el.dataset.sfId) existingByKey.set('sf_' + el.dataset.sfId, el);
    else if (el.dataset.photoId) existingByKey.set('ph_' + el.dataset.photoId, el);
  });

  const desired = [];

  subFolders.forEach((sf, sfIdx) => {
    const key = 'sf_' + sf.id;
    const sfPhotos = allPhotos.filter(p => p.folder === sf.id);
    let el = existingByKey.get(key);
    if (el) {
      const countEl = el.querySelector('[data-sf-count]');
      if (countEl) countEl.textContent = sfPhotos.length + ' photo' + (sfPhotos.length !== 1 ? 's' : '');
    } else {
      const sc = _fdpSfColorMap[sfIdx % _fdpSfColorMap.length];
      el = _fdpBuildSubfolderTile(sf, sc, sfPhotos.length);
    }
    desired.push(el);
    existingByKey.delete(key);
  });

  folderPhotos.forEach((img, i) => {
    const key = 'ph_' + img.id;
    let el = existingByKey.get(key);
    if (!el) el = _fdpBuildPhotoCard(img, i, folderPhotos);
    desired.push(el);
    existingByKey.delete(key);
  });

  // Anything left in existingByKey is stale (deleted/moved elsewhere) — remove it.
  existingByKey.forEach(el => el.remove());

  // Reorder/insert only where the actual sequence differs from desired.
  desired.forEach((el, idx) => {
    if (grid.children[idx] !== el) grid.insertBefore(el, grid.children[idx] || null);
  });

  const fdpEmpty = document.getElementById('fdpEmpty');
  if (fdpEmpty) fdpEmpty.style.display = (folderPhotos.length === 0 && subFolders.length === 0) ? 'flex' : 'none';
}

/* Refresh the folder detail page's photo + subfolder grid IN PLACE, with no
   re-open animation, no history push, and no flicker on already-loaded
   tiles. Called after uploads finish so the page never visibly "reopens". */
function _fdpRefreshAfterUpload(fId) {
  const overlay = document.getElementById('folderDetailOverlay');
  if (!overlay || overlay.style.display === 'none') return; // user already navigated away
  const allFolders = (typeof folders !== 'undefined') ? folders : [];
  const allPhotos  = (typeof photos  !== 'undefined') ? photos  : [];
  const f = allFolders.find(x => x.id === fId);
  if (!f) return;

  // Only photos uploaded directly into THIS folder — subfolder photos stay
  // on the subfolder's own page.
  let folderPhotos = allPhotos.filter(p => p.folder === f.id);

  const savedSort = localStorage.getItem('pv_fdpSort_' + f.id) || 'newest';
  if (savedSort === 'oldest') folderPhotos = folderPhotos.slice().sort((a,b) => (a.addedAt||0)-(b.addedAt||0));
  else if (savedSort === 'name') folderPhotos = folderPhotos.slice().sort((a,b) => (a.name||'').localeCompare(b.name||''));
  else folderPhotos = folderPhotos.slice().sort((a,b) => (b.addedAt||0)-(a.addedAt||0));

  const countLabel = document.getElementById('fdpCountLabel');
  if (countLabel) countLabel.textContent = folderPhotos.length + ' ' + (folderPhotos.length === 1 ? 'photo' : 'photos');

  _fdpSyncGridContents(f, allFolders, allPhotos, folderPhotos);
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
  let fp = allPhotos2.filter(p => p.folder === fId);
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
        // activeFolder is only read once, synchronously, at the very top of
        // _handleFileInputChange (before it starts awaiting each file), so
        // it's safe to restore it immediately — no need to wait or guess a
        // timing window. The grid refreshes itself once ALL files are done
        // uploading via renderFolders() → _fdpRefreshGrid(), which stays in
        // sync with however long encryption actually takes, instead of a
        // fixed delay that broke on multi-file uploads.
        activeFolder = prevFolder;
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

/* Refresh the folder detail grid in-place after subfolder add/delete/rename,
   AND after uploads. Delegates to the same diff-based sync used everywhere
   else (_fdpRefreshAfterUpload → _fdpSyncGridContents) so subfolder tiles
   and photo cards are always kept in sync together — previously this only
   rebuilt subfolder tiles and silently ignored new photos, which is why
   some uploaded files stayed invisible until the folder page was reopened. */
function _fdpRefreshGrid(fId) {
  _fdpRefreshAfterUpload(fId);
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

/* ── File card selection (multi-select), entered via the "Select" item in
   the floating file menu below. Reuses the app-wide selectMode/selected
   state so Move already works unchanged; Download/Delete in #selectBanner
   still fall back to "Not available yet" until bulkDownload/bulkDelete
   are implemented. ── */
function _fdpSetCardSelected(card, isSelected) {
  if (!card) return;
  card.classList.toggle('fdp-selected', isSelected);
  let badge = card.querySelector('.fdp-select-badge');
  if (isSelected) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'fdp-select-badge';
      badge.innerHTML = '<i class="fas fa-check"></i>';
      card.appendChild(badge);
    }
  } else if (badge) {
    badge.remove();
  }
}

function _fdpToggleCardSelect(img, card) {
  if (typeof selected === 'undefined') return;
  if (selected.has(img.id)) {
    selected.delete(img.id);
    _fdpSetCardSelected(card, false);
  } else {
    selected.add(img.id);
    _fdpSetCardSelected(card, true);
  }
  if (selected.size === 0) {
    if (typeof exitSelectMode === 'function') exitSelectMode();
    return;
  }
  if (typeof updateSelectBanner === 'function') updateSelectBanner();
}

/* ── Floating file menu (image/video/gif/webp) inside folder detail page ──
   Same visual design as the subfolder popup menu (fdpSubMenu) above. */
let _fdpPhotoMenuTarget = null;
let _fdpPhotoMenuAnchor = null;

function _fdpOpenPhotoMenu(p, anchorEl) {
  _fdpPhotoMenuTarget = p;
  _fdpPhotoMenuAnchor = anchorEl;
  let menu = document.getElementById('fdpPhotoMenu');
  let bd   = document.getElementById('fdpPhotoMenuBackdrop');
  if (!menu) {
    bd = document.createElement('div');
    bd.id = 'fdpPhotoMenuBackdrop';
    bd.style.cssText = 'position:fixed;inset:0;z-index:10200;';
    bd.onclick = _fdpClosePhotoMenu;
    document.body.appendChild(bd);

    menu = document.createElement('div');
    menu.id = 'fdpPhotoMenu';
    menu.onclick = e => e.stopPropagation();
    menu.style.cssText = 'display:none;position:fixed;background:#1e1e22;border:1px solid rgba(255,255,255,0.13);border-radius:18px;overflow:hidden;min-width:210px;box-shadow:0 12px 44px rgba(0,0,0,0.92);z-index:10201;';
    menu.innerHTML = `
      <div id="fdpPhotoMenuTitle" style="padding:13px 16px 10px;font-size:13px;font-weight:800;color:white;border-bottom:1px solid rgba(255,255,255,0.07);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;"></div>
      <div onclick="_fdpPhotoMenuAction('select')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;font-size:13px;font-weight:700;color:white;transition:background 0.12s;" onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background=''"><i class="fas fa-check-circle" style="width:16px;text-align:center;color:rgba(255,255,255,0.5);font-size:13px;"></i>Select</div>
      <div onclick="_fdpPhotoMenuAction('move')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;font-size:13px;font-weight:700;color:white;transition:background 0.12s;" onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background=''"><i class="fas fa-folder" style="width:16px;text-align:center;color:rgba(255,255,255,0.5);font-size:13px;"></i>Move</div>
      <div onclick="_fdpPhotoMenuAction('download')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;font-size:13px;font-weight:700;color:white;transition:background 0.12s;" onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background=''"><i class="fas fa-arrow-down" style="width:16px;text-align:center;color:rgba(255,255,255,0.5);font-size:13px;"></i>Download</div>
      <div style="height:1px;background:rgba(255,255,255,0.07);margin:0 12px;"></div>
      <div onclick="_fdpPhotoMenuAction('delete')" style="display:flex;align-items:center;gap:12px;padding:12px 16px 13px;cursor:pointer;font-size:13px;font-weight:700;color:#ff6b6b;transition:background 0.12s;" onmouseenter="this.style.background='rgba(239,68,68,0.08)'" onmouseleave="this.style.background=''"><i class="fas fa-trash" style="width:16px;text-align:center;color:#ff6b6b;font-size:13px;"></i>Delete</div>
    `;
    document.body.appendChild(menu);
  }

  document.getElementById('fdpPhotoMenuTitle').textContent = p.name || 'File';
  const r = anchorEl.getBoundingClientRect();
  const mW = 210, mH = 218;
  let left = r.right - mW;
  left = Math.max(10, Math.min(left, window.innerWidth - mW - 10));
  let top = r.bottom + 6;
  if (top + mH > window.innerHeight - 10) top = Math.max(60, r.top - mH - 6);
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  menu.style.opacity = '0'; menu.style.transform = 'scale(0.90)'; menu.style.display = 'block';
  bd.style.display = 'block';
  requestAnimationFrame(() => {
    menu.style.transition = 'opacity 0.15s, transform 0.15s cubic-bezier(.34,1.56,.64,1)';
    menu.style.opacity = '1'; menu.style.transform = 'scale(1)';
  });
}

function _fdpClosePhotoMenu() {
  const m = document.getElementById('fdpPhotoMenu');
  const b = document.getElementById('fdpPhotoMenuBackdrop');
  if (m) { m.style.display = 'none'; m.style.transition = ''; }
  if (b) b.style.display = 'none';
  _fdpPhotoMenuTarget = null;
  _fdpPhotoMenuAnchor = null;
}

function _fdpPhotoMenuAction(action) {
  const p = _fdpPhotoMenuTarget;
  const anchorEl = _fdpPhotoMenuAnchor;
  _fdpClosePhotoMenu();
  if (!p) return;

  if (action === 'select') {
    if (typeof selected !== 'undefined') selected.add(p.id);
    if (typeof selectMode !== 'undefined') selectMode = true;
    // Guard entry: guarantees there's always a history state to trap,
    // so back/forward has something to hit even if no overlay pushed one.
    history.pushState({ nav: 'selecting' }, '');
    const banner = document.getElementById('selectBanner');
    if (banner) banner.style.display = 'flex';
    if (typeof updateSelectBanner === 'function') updateSelectBanner();
    _fdpSetCardSelected(anchorEl, true);

  } else if (action === 'move') {
    contextTarget = p;
    if (typeof selected !== 'undefined') { selected.clear(); selected.add(p.id); }
    pendingCtxSelect = true;
    if (typeof openMoveModal === 'function') openMoveModal();

  } else if (action === 'download') {
    (async () => {
      showToast('⬇️ Saving…');
      try {
        let encBlob;
        if (p.storage === 'cloud') encBlob = await fetchCloudBlob(p);
        else if (p.storage === 'idb') { encBlob = await idbGet(p.encId); if (!encBlob) throw new Error('Missing'); }
        else encBlob = base64ToBlob(p.encData);
        const plain = await decryptBlob(encBlob, sessionPin);
        const url = URL.createObjectURL(plain);
        _triggerDownload(url, p.name);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      } catch(e) { showToast('❌ Save failed'); }
    })();

  } else if (action === 'delete') {
    showConfirmModal(
      'Move to Bin?',
      '"' + (p.name || 'this file') + '" will be moved to Bin.',
      'Move to Bin', '#ff4444',
      () => {
        p.trashedAt = Date.now();
        if (p.storage === 'idb') _removeFromPendingQueue(p.id);
        if (typeof trashedPhotos !== 'undefined') trashedPhotos.push(p);
        if (typeof photos !== 'undefined') {
          const idx = photos.findIndex(x => x.id === p.id);
          if (idx !== -1) photos.splice(idx, 1);
        }
        if (typeof _saveTrashed === 'function') _saveTrashed();
        if (typeof save === 'function') save();
        if (typeof render === 'function') render();
        if (typeof _updateBinBadge === 'function') _updateBinBadge();
        showToast('🗑️ Moved to Bin');
      }
    );
  }
}


async function _legacyFdpLoadCardThumb(card, p, shimmer, lock) {
  if (!card || !document.contains(card)) return;
  if (card._fdpDone) return;
  card._fdpDone = true;
  // Placeholder stays put until the real media has actually faded in —
  // removing it early exposes the card's bare dark background for a beat.
  const clearPlaceholder = () => {
    if (shimmer && shimmer.parentNode) shimmer.remove();
    if (lock && lock.parentNode) lock.remove();
  };
  try {
    let encBlob;
    if (p.storage === 'cloud') {
      encBlob = await fetchCloudBlob(p);
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
    if (isVideo) {
      const vid = document.createElement('video');
      vid.src = url; vid.muted = true; vid.playsInline = true; vid.preload = 'metadata';
      vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;';
      vid.onloadedmetadata = () => { try { vid.currentTime = 0.1; } catch(e) {} };
      vid.onseeked = () => { vid.style.opacity='1'; clearPlaceholder(); };
      vid.oncanplay = () => { vid.style.opacity='1'; clearPlaceholder(); };
      setTimeout(() => { vid.style.opacity='1'; clearPlaceholder(); }, 1200);
      card.insertBefore(vid, card.firstChild);
      const play = document.createElement('div');
      play.innerHTML = '\u25B6';
      play.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.55);color:white;font-size:14px;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;z-index:5;pointer-events:none;';
      card.appendChild(play);
    } else {
      const img = document.createElement('img');
      img.src = url; img.alt = '';
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;';
      img.onload = () => { img.style.opacity='1'; clearPlaceholder(); setTimeout(()=>URL.revokeObjectURL(url),30000); };
      img.onerror = () => { URL.revokeObjectURL(url); clearPlaceholder(); };
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
        #collectionPageOverlay .cp-card.cp-selected { box-shadow:inset 0 0 0 3px var(--cyan, #3de8d8); }
        #collectionPageOverlay .cp-select-badge { position:absolute; top:6px; right:6px; width:20px; height:20px; border-radius:50%; background:var(--cyan, #3de8d8); color:#ffffff; display:flex; align-items:center; justify-content:center; font-size:11px; z-index:6; box-shadow:0 2px 8px rgba(0,0,0,0.5); pointer-events:none; }
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
  // "Add Files" only makes sense on the Picked page — picking files there
  // actually tags them (pendingType === 'favourites', see
  // _encryptAndSaveBatch). On Images/Videos/GIFs/WebP the category is
  // derived purely from each file's own type, so an "Add Files" button
  // here didn't actually add to *that* category (a video added from the
  // Images page would still show up under Videos) — just upload from the
  // homepage or a folder instead, and it'll sort into the right media
  // type on its own.
  const addFilesRow = type === 'favourites'
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

      // Tap → lightbox (or toggle selection, if select mode is active), long-press → floating file menu (same pattern as folder detail pages)
      if (typeof selectMode !== 'undefined' && selectMode && typeof selected !== 'undefined' && selected.has(img.id)) {
        _cpSetCardSelected(card, true);
      }
      let pressTimer, touchX = 0, touchY = 0, longPressActive = false;
      card.onclick = (e) => {
        if (longPressActive) { longPressActive = false; return; }
        if (typeof selectMode !== 'undefined' && selectMode) { _cpToggleCardSelect(img, card); return; }
        const idx = list.findIndex(x => x.id === img.id);
        openLightbox(idx >= 0 ? idx : i, list.slice());
      };
      card.oncontextmenu = (e) => { e.preventDefault(); if (typeof selectMode !== 'undefined' && selectMode) return; _cpOpenPhotoMenu(img, card); };
      card.addEventListener('touchstart', (e) => {
        touchX=e.touches[0].clientX; touchY=e.touches[0].clientY; longPressActive=false;
        pressTimer=setTimeout(()=>{
          if (typeof selectMode !== 'undefined' && selectMode) return;
          longPressActive=true;
          if (navigator.vibrate) navigator.vibrate(30);
          _cpOpenPhotoMenu(img, card);
        }, 500);
      }, {passive:true});
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

/* ── File card selection (multi-select) inside a media-type collection page
   (Images/Videos/GIFs/WebP/Picked), entered via "Select" in the floating
   file menu below. Mirrors _fdpSetCardSelected/_fdpToggleCardSelect. ── */
function _cpSetCardSelected(card, isSelected) {
  if (!card) return;
  card.classList.toggle('cp-selected', isSelected);
  let badge = card.querySelector('.cp-select-badge');
  if (isSelected) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'cp-select-badge';
      badge.innerHTML = '<i class="fas fa-check"></i>';
      card.appendChild(badge);
    }
  } else if (badge) {
    badge.remove();
  }
}

function _cpToggleCardSelect(img, card) {
  if (typeof selected === 'undefined') return;
  if (selected.has(img.id)) {
    selected.delete(img.id);
    _cpSetCardSelected(card, false);
  } else {
    selected.add(img.id);
    _cpSetCardSelected(card, true);
  }
  if (selected.size === 0) {
    if (typeof exitSelectMode === 'function') exitSelectMode();
    return;
  }
  if (typeof updateSelectBanner === 'function') updateSelectBanner();
}

/* ── Floating file menu (image/video/gif/webp) inside a media-type
   collection page — same visual design and behaviour as the folder
   detail page's floating file menu (_fdpOpenPhotoMenu). Kept as a
   separate cp-* instance (own DOM node + backdrop) so it can be open
   independently of, and layer correctly above, the collection page
   overlay it lives in. ── */
let _cpPhotoMenuTarget = null;
let _cpPhotoMenuAnchor = null;

function _cpOpenPhotoMenu(p, anchorEl) {
  _cpPhotoMenuTarget = p;
  _cpPhotoMenuAnchor = anchorEl;
  let menu = document.getElementById('cpPhotoMenu');
  let bd   = document.getElementById('cpPhotoMenuBackdrop');
  if (!menu) {
    bd = document.createElement('div');
    bd.id = 'cpPhotoMenuBackdrop';
    bd.style.cssText = 'position:fixed;inset:0;z-index:10200;';
    bd.onclick = _cpClosePhotoMenu;
    document.body.appendChild(bd);

    menu = document.createElement('div');
    menu.id = 'cpPhotoMenu';
    menu.onclick = e => e.stopPropagation();
    menu.style.cssText = 'display:none;position:fixed;background:#1e1e22;border:1px solid rgba(255,255,255,0.13);border-radius:18px;overflow:hidden;min-width:210px;box-shadow:0 12px 44px rgba(0,0,0,0.92);z-index:10201;';
    menu.innerHTML = `
      <div id="cpPhotoMenuTitle" style="padding:13px 16px 10px;font-size:13px;font-weight:800;color:white;border-bottom:1px solid rgba(255,255,255,0.07);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;"></div>
      <div onclick="_cpPhotoMenuAction('select')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;font-size:13px;font-weight:700;color:white;transition:background 0.12s;" onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background=''"><i class="fas fa-check-circle" style="width:16px;text-align:center;color:rgba(255,255,255,0.5);font-size:13px;"></i>Select</div>
      <div onclick="_cpPhotoMenuAction('favourite')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;font-size:13px;font-weight:700;color:white;transition:background 0.12s;" onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background=''"><i id="cpPhotoMenuFavIcon" class="far fa-burst" style="width:16px;text-align:center;color:rgba(255,110,180,0.7);font-size:13px;"></i><span id="cpPhotoMenuFavLabel">Add to Picked</span></div>
      <div onclick="_cpPhotoMenuAction('move')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;font-size:13px;font-weight:700;color:white;transition:background 0.12s;" onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background=''"><i class="fas fa-folder" style="width:16px;text-align:center;color:rgba(255,255,255,0.5);font-size:13px;"></i>Move</div>
      <div onclick="_cpPhotoMenuAction('download')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;font-size:13px;font-weight:700;color:white;transition:background 0.12s;" onmouseenter="this.style.background='rgba(255,255,255,0.07)'" onmouseleave="this.style.background=''"><i class="fas fa-arrow-down" style="width:16px;text-align:center;color:rgba(255,255,255,0.5);font-size:13px;"></i>Download</div>
      <div style="height:1px;background:rgba(255,255,255,0.07);margin:0 12px;"></div>
      <div onclick="_cpPhotoMenuAction('delete')" style="display:flex;align-items:center;gap:12px;padding:12px 16px 13px;cursor:pointer;font-size:13px;font-weight:700;color:#ff6b6b;transition:background 0.12s;" onmouseenter="this.style.background='rgba(239,68,68,0.08)'" onmouseleave="this.style.background=''"><i class="fas fa-trash" style="width:16px;text-align:center;color:#ff6b6b;font-size:13px;"></i>Delete</div>
    `;
    document.body.appendChild(menu);
  }

  document.getElementById('cpPhotoMenuTitle').textContent = p.name || 'File';
  const favIco = document.getElementById('cpPhotoMenuFavIcon');
  const favLbl = document.getElementById('cpPhotoMenuFavLabel');
  if (favIco) { favIco.className = p.fav ? 'fas fa-burst' : 'far fa-burst'; favIco.style.color = p.fav ? '#ff6eb4' : 'rgba(255,110,180,0.7)'; }
  if (favLbl) favLbl.textContent = p.fav ? 'Remove from Picked' : 'Add to Picked';

  const r = anchorEl.getBoundingClientRect();
  const mW = 210, mH = 258;
  let left = r.right - mW;
  left = Math.max(10, Math.min(left, window.innerWidth - mW - 10));
  let top = r.bottom + 6;
  if (top + mH > window.innerHeight - 10) top = Math.max(60, r.top - mH - 6);
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  menu.style.opacity = '0'; menu.style.transform = 'scale(0.90)'; menu.style.display = 'block';
  bd.style.display = 'block';
  requestAnimationFrame(() => {
    menu.style.transition = 'opacity 0.15s, transform 0.15s cubic-bezier(.34,1.56,.64,1)';
    menu.style.opacity = '1'; menu.style.transform = 'scale(1)';
  });
}

function _cpClosePhotoMenu() {
  const m = document.getElementById('cpPhotoMenu');
  const b = document.getElementById('cpPhotoMenuBackdrop');
  if (m) { m.style.display = 'none'; m.style.transition = ''; }
  if (b) b.style.display = 'none';
  _cpPhotoMenuTarget = null;
  _cpPhotoMenuAnchor = null;
}

function _cpPhotoMenuAction(action) {
  const p = _cpPhotoMenuTarget;
  const anchorEl = _cpPhotoMenuAnchor;
  _cpClosePhotoMenu();
  if (!p) return;

  if (action === 'select') {
    if (typeof selected !== 'undefined') selected.add(p.id);
    if (typeof selectMode !== 'undefined') selectMode = true;
    // Guard entry: guarantees there's always a history state to trap,
    // so back/forward has something to hit even if no overlay pushed one.
    history.pushState({ nav: 'selecting' }, '');
    const banner = document.getElementById('selectBanner');
    if (banner) banner.style.display = 'flex';
    if (typeof updateSelectBanner === 'function') updateSelectBanner();
    _cpSetCardSelected(anchorEl, true);

  } else if (action === 'favourite') {
    p.fav = !p.fav;
    // save() (below) already re-renders the open collection page via its
    // own hook, so toggling here correctly refreshes the grid immediately
    // — including removing the card right away if this is the Picked page.
    if (typeof save === 'function') save();
    if (typeof renderFavStrip === 'function') renderFavStrip();
    showToast(p.fav ? '✨ Added to Picked!' : '✖ Removed from Picked');

  } else if (action === 'move') {
    contextTarget = p;
    if (typeof selected !== 'undefined') { selected.clear(); selected.add(p.id); }
    pendingCtxSelect = true;
    if (typeof openMoveModal === 'function') openMoveModal();

  } else if (action === 'download') {
    (async () => {
      showToast('⬇️ Saving…');
      try {
        let encBlob;
        if (p.storage === 'cloud') encBlob = await fetchCloudBlob(p);
        else if (p.storage === 'idb') { encBlob = await idbGet(p.encId); if (!encBlob) throw new Error('Missing'); }
        else encBlob = base64ToBlob(p.encData);
        const plain = await decryptBlob(encBlob, sessionPin);
        const url = URL.createObjectURL(plain);
        _triggerDownload(url, p.name);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      } catch(e) { showToast('❌ Save failed'); }
    })();

  } else if (action === 'delete') {
    showConfirmModal(
      'Move to Bin?',
      '"' + (p.name || 'this file') + '" will be moved to Bin.',
      'Move to Bin', '#ff4444',
      () => {
        p.trashedAt = Date.now();
        if (p.storage === 'idb') _removeFromPendingQueue(p.id);
        if (typeof trashedPhotos !== 'undefined') trashedPhotos.push(p);
        if (typeof photos !== 'undefined') {
          const idx = photos.findIndex(x => x.id === p.id);
          if (idx !== -1) photos.splice(idx, 1);
        }
        if (typeof _saveTrashed === 'function') _saveTrashed();
        if (typeof save === 'function') save();
        if (typeof render === 'function') render();
        if (typeof _updateBinBadge === 'function') _updateBinBadge();
        showToast('🗑️ Moved to Bin');
      }
    );
  }
}


/* Decrypt and show a thumbnail inside a collection page card */
async function _legacyCpDecryptThumb(p, shimmer, lock, card) {
  if (!card || !document.contains(card)) return;
  if (card._cpDone) return; // already decrypted
  card._cpDone = true;
  // Placeholder stays put until the real media has actually faded in —
  // removing it early exposes the card's bare dark background for a beat.
  const clearPlaceholder = () => {
    if (shimmer && shimmer.parentNode) shimmer.remove();
    if (lock && lock.parentNode) lock.remove();
  };
  try {
    let encBlob;
    if (p.storage === 'cloud') {
      encBlob = await fetchCloudBlob(p);
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
    if (isVideo) {
      const vid = document.createElement('video');
      vid.src = url; vid.muted = true; vid.playsInline = true; vid.preload = 'metadata';
      vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;';
      vid.onloadedmetadata = () => { try { vid.currentTime = 0.1; } catch(e) {} };
      vid.onseeked = () => { vid.style.opacity='1'; clearPlaceholder(); };
      vid.oncanplay = () => { vid.style.opacity='1'; clearPlaceholder(); };
      setTimeout(() => { vid.style.opacity='1'; clearPlaceholder(); }, 1200);
      card.insertBefore(vid, card.firstChild);
      const play = document.createElement('div');
      play.innerHTML = '▶';
      play.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.55);color:white;font-size:14px;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;z-index:5;pointer-events:none;';
      card.appendChild(play);
    } else {
      const img = document.createElement('img');
      img.src = url; img.alt = '';
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s;pointer-events:none;';
      img.onload = () => { img.style.opacity='1'; clearPlaceholder(); setTimeout(()=>URL.revokeObjectURL(url),30000); };
      img.onerror = () => { URL.revokeObjectURL(url); clearPlaceholder(); };
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

/* ── Refresh the pg2 list cards after closing an overlay, without tearing
   down and rebuilding their DOM. This used to fully replace each card's
   innerHTML on every close (to force WebKit to recompute row heights that
   can otherwise stay squished after returning from a full-screen overlay),
   but destroying and recreating every icon/badge caused a visible flash
   each time — reported as "the folder/picked cards flicker after opening
   and closing media type or pinned". A synchronous display:none → ''
   round-trip forces the same layout recalculation without removing any
   nodes, so nothing flashes. ── */
function _resetPg2Cards() {
  ['pg2StarredCard', 'pg2MediaCard', 'pg2MoreCard'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prevDisplay = el.style.display;
    el.style.display = 'none';
    void el.offsetHeight; // force a synchronous reflow
    el.style.display = prevDisplay;
  });
  // Badges/preview reflect live data rather than whatever text happened
  // to already be in the DOM.
  if (typeof _updateMediaTypeCounts === 'function') _updateMediaTypeCounts();
  if (typeof _pg2RenderPinnedPreview === 'function') _pg2RenderPinnedPreview();
  const topFolders = (typeof folders !== 'undefined') ? folders.filter(f => !f.parentId) : [];
  const starredBadge = document.getElementById('ccStarredBadge');
  if (starredBadge) starredBadge.textContent = topFolders.length;
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
      // _refreshCollectionsBadges is not defined anywhere in this file — calling
      // it unguarded threw a ReferenceError on every single save(), which
      // silently killed every statement written AFTER save() in whichever
      // function called it (folder creation's renderFolders()/showToast()/
      // _allFoldersRender() included). Guarded the same way the other call
      // to this function (below, in _pg2SetSort) already was.
      if (typeof _refreshCollectionsBadges === 'function') _refreshCollectionsBadges();
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
      affectedPhotos.forEach(p => { p.trashedAt = Date.now(); if (p.storage === 'idb') _removeFromPendingQueue(p.id); });
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


/* ════════════════════════════════════════════════════════════════════════
     SECTION 3 — HOMEPAGE (part B, continued from before Section 4)
     FOLDER SYSTEM FIX — real render()/renderFolders()/_folderColor(), plus
     deleteFolder()/renameFolder()/_goBackHome() which menus already called
     but which were never defined. Declared here (after the stubs earlier
     in the file) so these definitions win, the same pattern already used
     for switchToPage()/openLightbox()/openBinModal() above.
     ════════════════════════════════════════════════════════════════════════ */

/* ── Deterministic color theme per folder id — used by _buildFolderTile,
     which every folder view (home grid, All-Folders sheet, folder detail
     page) depends on. This was missing entirely, so no folder tile could
     ever render without throwing — the root cause of folders "not showing
     up anywhere." ── */
function _folderColor(id) {
  const palette = [
    { bg: 'linear-gradient(160deg,#2a1a45,#1a0f2e)', border: 'rgba(162,89,255,0.35)', glow: 'rgba(162,89,255,0.45)', iconColor: '#a259ff', nameColor: 'rgba(255,255,255,0.85)', svgId: 'icon_stripes3' },
    { bg: 'linear-gradient(160deg,#123a3a,#0c2424)', border: 'rgba(61,232,216,0.35)',  glow: 'rgba(61,232,216,0.45)',  iconColor: '#3de8d8', nameColor: 'rgba(255,255,255,0.85)', svgId: 'icon_layers3' },
    { bg: 'linear-gradient(160deg,#3a2412,#241706)', border: 'rgba(255,140,66,0.35)',  glow: 'rgba(255,140,66,0.45)',  iconColor: '#ff8c42', nameColor: 'rgba(255,255,255,0.85)', svgId: 'icon_bars3' },
    { bg: 'linear-gradient(160deg,#3a1230,#24071c)', border: 'rgba(255,110,180,0.35)', glow: 'rgba(255,110,180,0.45)', iconColor: '#ff6eb4', nameColor: 'rgba(255,255,255,0.85)', svgId: 'icon_slabs' },
    { bg: 'linear-gradient(160deg,#123a1e,#0c2413)', border: 'rgba(74,222,128,0.35)',  glow: 'rgba(74,222,128,0.45)',  iconColor: '#4ade80', nameColor: 'rgba(255,255,255,0.85)', svgId: 'icon_steps' },
    { bg: 'linear-gradient(160deg,#3a3212,#242006)', border: 'rgba(255,224,75,0.35)',  glow: 'rgba(255,224,75,0.45)',  iconColor: '#ffe04b', nameColor: 'rgba(255,255,255,0.85)', svgId: 'icon_stripes3' },
    { bg: 'linear-gradient(160deg,#12233a,#0c1624)', border: 'rgba(96,165,250,0.35)',  glow: 'rgba(96,165,250,0.45)',  iconColor: '#60a5fa', nameColor: 'rgba(255,255,255,0.85)', svgId: 'icon_layers3' },
  ];
  let hash = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

/* ── Simple photo card for the home grid (root photos / in-folder photos).
     Kept intentionally lighter than the folder-detail page's decrypting
     card — this app build has no upload pipeline wired up yet, so this
     just needs to be correct and non-throwing for whatever lands in
     `photos`. ── */
function _buildHomePhotoCard(p, list, idx) {
  const card = document.createElement('div');
  card.style.cssText = 'position:relative;border-radius:16px;overflow:hidden;aspect-ratio:1/1;cursor:pointer;background:#141416;border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;';
  const mt = (typeof _getMediaType === 'function') ? _getMediaType(p) : (p.mediaType || 'image');
  const icon = document.createElement('i');
  icon.className = mt === 'video' ? 'fas fa-video' : (mt === 'gif' ? 'fas fa-image' : 'far fa-image');
  icon.style.cssText = 'font-size:20px;color:rgba(255,255,255,0.25);';
  card.appendChild(icon);
  card.onclick = () => { if (typeof openLightbox === 'function') openLightbox(idx, list); };
  // Lazy thumbnail from the on-device cache (built once, then instant)
  const obs = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    obs.disconnect();
    _vcPaint(card, p, { shimmer: icon, first: true, badge: 32 }).catch(() => {});
  }, { rootMargin: '300px' });
  obs.observe(card);
  return card;
}

/* ── Home page (pg1) render: draws folder tiles + photos into #galleryGrid
     for whichever folder is currently "open" (activeFolder), and swaps the
     header between the brand logo (at Home) and a back button + title
     (inside a folder). This was previously just a toast — nothing was ever
     drawn, so a newly-created folder had nowhere to appear and no way to
     be opened. ── */
function render() {
  const grid  = document.getElementById('galleryGrid');
  const empty = document.getElementById('emptyState');
  if (!grid) return;

  // Home screen shows only the dashboard + any unfiled photos. Folders are
  // never drawn here — "My Folders" (openAllFoldersSheet) and the sidebar
  // are the only places folders are browsed, and opening one goes straight
  // to the dedicated folder-detail overlay (openFolderDetailPage).
  grid.innerHTML = '';

  const homePhotos = photos.filter(p => !p.folder || p.folder === 'home');
  homePhotos.forEach((p, i) => grid.appendChild(_buildHomePhotoCard(p, homePhotos, i)));

  if (empty) empty.style.display = homePhotos.length === 0 ? 'flex' : 'none';

  const count = homePhotos.length;
  const countEl = document.getElementById('statCount');
  if (countEl) countEl.textContent = count + (count === 1 ? ' item' : ' items');

  // Dashboard "Files" card — total files across the whole library (root +
  // every folder), not just the unfiled home photos counted above. Was
  // previously left to syncStats(), which only ever read the home-only
  // count off #statCount, so the card showed 0 whenever every photo lived
  // inside a folder (e.g. 19 photos all filed under "jjj").
  const totalCount = (typeof photos !== 'undefined') ? photos.length : count;
  const dcCountEl = document.getElementById('dcCountValue');
  if (dcCountEl) dcCountEl.textContent = totalCount;
}

/* ── Back button in the header. Currently unused (the home screen no
     longer has an in-page "inside a folder" state — folders open in their
     own overlay instead), kept only so the header markup's onclick doesn't
     throw if it's ever shown. ── */
function _goBackHome() {
  activeFolder = 'home';
  exitSelectMode();
  render();
  _buildFolderNav('');
}


/* ── Refresh everything that depends on the folder list: the home grid,
     the sidebar nav, the pg2 folder-count badge, and — if they happen to
     be open — the All-Folders sheet and the folder-detail overlay. Was a
     no-op before, so a created/renamed/deleted folder never propagated
     anywhere. ── */
/* ── Front-of-page-2 "Pinned" preview strip. Reads live `folders` data and
   shows starred (pinned) folders as tiles, falling back to the "No pinned
   folders yet" empty state. Previously #pg2FolderList was never populated
   by any code — only the empty-state placeholder existed in the markup —
   so a genuinely pinned folder never appeared on the front page even
   though it showed up correctly inside the full "Pinned" collection page.
   Called from renderFolders() so it stays live with every pin/unpin,
   folder create/delete, and app load. ── */
function _pg2RenderPinnedPreview() {
  const list  = document.getElementById('pg2FolderList');
  const empty = document.getElementById('pg2FolderEmpty');
  if (!list) return;

  const allFolders = (typeof folders !== 'undefined') ? folders : [];
  const allPhotos  = (typeof photos  !== 'undefined') ? photos  : [];
  const starred = allFolders.filter(f => f.starred);

  // Clear any previously-rendered tiles, but keep the empty-state node in
  // the DOM (just toggle its display) so it doesn't need to be rebuilt.
  Array.from(list.children).forEach(child => { if (child !== empty) child.remove(); });

  if (starred.length === 0) {
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Show a handful on the front page — tapping the "Pinned" header row
  // above already opens the full collection view for the complete list.
  starred.slice(0, 6).forEach(f => {
    const subIds = allFolders.filter(sf => sf.parentId === f.id).map(sf => sf.id);
    const allIds = new Set([f.id, ...subIds]);
    const count  = allPhotos.filter(p => allIds.has(p.folder)).length;
    const wrap = _buildFolderTile(f, count, 0, {
      showPinBadge: false,
      onTap: () => openFolderDetailPage(f.id),
    });
    list.appendChild(wrap);
  });
}

function renderFolders() {
  render();

  const navSearchEl = document.getElementById('folderSearch');
  _buildFolderNav(navSearchEl ? navSearchEl.value.toLowerCase().trim() : '');

  const topFolders = folders.filter(f => !f.parentId);
  const badge = document.getElementById('ccStarredBadge');
  if (badge) badge.textContent = topFolders.length;

  _updateMediaTypeCounts();
  _pg2RenderPinnedPreview();

  const sheet = document.getElementById('allFoldersSheet');
  if (sheet && sheet.style.display !== 'none' && typeof _allFoldersRender === 'function') {
    const searchEl = document.getElementById('allFoldersSearch');
    _allFoldersRender(searchEl ? searchEl.value : '');
  }

  const fdpOverlay = document.getElementById('folderDetailOverlay');
  if (fdpOverlay && fdpOverlay._fdpFolderId && typeof _fdpRefreshGrid === 'function') {
    _fdpRefreshGrid(fdpOverlay._fdpFolderId);
  }
}

/* ── pg2 "Media Types" + "Picked" badge counts — these read straight off
     the live `photos` array so they're never stale. Previously nothing
     ever computed them: the only code touching these badges
     (_resetPg2Cards) just copied whatever text was already in the DOM,
     which was always the "0" it started as. Trashed photos are already
     removed from `photos` (moved to `trashedPhotos`) so no extra
     filtering is needed here. ── */
function _updateMediaTypeCounts() {
  const list = (typeof photos !== 'undefined') ? photos : [];
  let imgs = 0, vids = 0, gifs = 0, webps = 0, favs = 0;
  list.forEach(p => {
    if (p.fav) favs++;
    const t = p.mediaType || _getMediaType(p);
    if (t === 'video') vids++;
    else if (t === 'gif') gifs++;
    else if (t === 'webp') webps++;
    else imgs++;
  });
  const setBadge = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setBadge('ccImagesBadge', imgs);
  setBadge('ccVideosBadge', vids);
  setBadge('ccGifsBadge', gifs);
  setBadge('ccWebpsBadge', webps);
  setBadge('ccFavsBadge', favs);
}

/* ── Rename a folder (top-level or subfolder). Was called by the folder
     context menus but never defined, so "Rename" silently threw. ── */
function renameFolder(id, currentName) {
  const f = folders.find(x => x.id === id);
  if (!f) return;
  showFolderNameModal({
    title: 'Rename Folder',
    subtitle: 'Give your folder a new name',
    placeholder: 'Folder name…',
    initialValue: currentName != null ? currentName : f.name,
    confirmLabel: 'Save',
    onConfirm: (n) => {
      if (!n) return;
      const dup = folders.some(x => x.id !== id && !x.parentId === !f.parentId && x.parentId === f.parentId && x.name.toLowerCase() === n.toLowerCase());
      if (dup) { showToast('Folder already exists!'); return; }
      f.name = n;
      save();
      renderFolders();
      showToast('✏️ Folder renamed to "' + n + '"');
    }
  });
}

/* ── Delete a folder. Any subfolders and the photos inside all of them are
     moved to the Bin rather than being permanently destroyed. Was called
     by the folder context menu but never defined, so "Delete" silently
     threw and folders that misbehaved could never actually be removed. ── */
function deleteFolder(id) {
  const f = folders.find(x => x.id === id);
  if (!f) return;

  const subIds = f.parentId ? [] : folders.filter(sf => sf.parentId === id).map(sf => sf.id);
  const allIds = new Set([id, ...subIds]);

  const affectedPhotos = photos.filter(p => allIds.has(p.folder));
  affectedPhotos.forEach(p => { p.trashedAt = Date.now(); if (p.storage === 'idb') _removeFromPendingQueue(p.id); });
  if (typeof trashedPhotos !== 'undefined') trashedPhotos = [...trashedPhotos, ...affectedPhotos];
  photos = photos.filter(p => !allIds.has(p.folder));

  folders = folders.filter(x => !allIds.has(x.id));

  // If we were looking at the folder (or a subfolder of it) that just got deleted, go home
  if (activeFolder && allIds.has(activeFolder)) activeFolder = 'home';

  if (typeof _saveTrashed === 'function') _saveTrashed();
  save();
  renderFolders();
  if (typeof _updateBinBadge === 'function') _updateBinBadge();

  const fdpOverlay = document.getElementById('folderDetailOverlay');
  if (fdpOverlay && fdpOverlay._fdpFolderId && allIds.has(fdpOverlay._fdpFolderId) && typeof closeFolderDetailPage === 'function') {
    closeFolderDetailPage();
  }

  showToast('🗑️ Folder deleted' + (affectedPhotos.length > 0 ? ' · ' + affectedPhotos.length + ' photo(s) moved to Bin' : ''));
}

/* ── Dashboard cards on the homepage ("Pinned" / "My Folders") were
     looking for function names (openPinnedFolder, openAllFoldersPage…)
     that don't exist anywhere in the app, so tapping them silently did
     nothing. Point them at the real handlers. ── */
window.openAllFoldersPage = function () { openAllFoldersSheet(); };
window.openPinnedFolder   = function () { _openCollectionPage('starred'); };
window.openPickedFiles    = function () { _openCollectionPage('favourites'); };

/* Draw the initial state once the folder list has loaded */
document.addEventListener('DOMContentLoaded', () => { render(); });

/* ════════════════════════════════════════════════════════════════════════
     SECTION 5 — SHARED (encryption, bin, cloud storage, local storage)
     Cross-page state and services: PIN-derived AES-GCM encryption, IndexedDB
     blob storage, pCloud sync, storage breakdown/quota, bin/trash, and
     folder save/load. pCloud is the sole active cloud backend — files are
     AES-256-GCM encrypted on-device before upload, and only the resulting
     ciphertext + a manifest (hope_manifest.json) ever reach pCloud.
   ════════════════════════════════════════════════════════════════════════ */

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

/* ── pCloud credentials ──
   PCLOUD_APP_KEY comes from the pCloud App Console (App Console → your app
   → "App key"). PCLOUD_TOKEN is the OAuth access token obtained via the
   poll-based flow in pcConnect() below, and PCLOUD_HOST records whether the
   token lives on pCloud's US (api.pcloud.com) or EU (eapi.pcloud.com)
   endpoint, since pCloud returns that at auth time and every subsequent
   call must hit the same region. */

const PCLOUD_APP_KEY_DEFAULT = ''; // fallback if nothing has been saved from the UI yet

let PCLOUD_APP_KEY = localStorage.getItem('pv_pcloud_app_key') || PCLOUD_APP_KEY_DEFAULT;

let PCLOUD_TOKEN = localStorage.getItem('pv_pcloud_token') || '';

let PCLOUD_HOST  = localStorage.getItem('pv_pcloud_host')  || 'api.pcloud.com';

/* ── Photo/trash/lightbox session state ── */

let trashedPhotos    = [];

let _cloudSyncing            = false;

let _syncChannel;

let _lastAppliedManifestTime = 0;

let _pollInterval            = null;

let _syncDebounceTimer       = null;

let _lastSyncedVersion       = 0;

let _lastLocalSaveTime       = 0;

/* ── Cloud direction lock ──
   Uploading TO pCloud (tgPushAll / syncToCloud) and
   pulling FROM pCloud (_autoRestoreFromCloud / the polling
   sync) must never run at the same time — a retrieve mid-upload can read a
   half-written manifest, and vice versa. Same-direction calls are still
   free to overlap/queue (pushing a new batch while an earlier push is in
   flight is fine, and already handled by each function's own in-progress
   flag) — this lock only keeps the two *directions* apart. */
let _cloudUploadBusy   = false;
let _cloudRetrieveBusy = false;

async function _acquireCloudDirection(direction, maxWaitMs = 15000) {
  const start = Date.now();
  while (direction === 'upload' ? _cloudRetrieveBusy : _cloudUploadBusy) {
    if (Date.now() - start > maxWaitMs) break; // never deadlock — proceed anyway
    await new Promise(res => setTimeout(res, 250));
  }
  if (direction === 'upload') _cloudUploadBusy = true; else _cloudRetrieveBusy = true;
}
function _releaseCloudDirection(direction) {
  if (direction === 'upload') _cloudUploadBusy = false; else _cloudRetrieveBusy = false;
}

/* ── Decrypt concurrency + thumbnail cache ── */

const _decryptSemaphore = { active: 0, max: 12, queue: [] };

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


function isPcloudEnabled() { return !!PCLOUD_TOKEN; }

/* Back-compat alias — kept because a couple of call sites elsewhere in the
   file still read isCloudEnabled(); both names now mean "pCloud is linked". */
function isTgEnabled() { return isPcloudEnabled(); }


/* ── Poll-based OAuth ──
   Delegates to pCloud's own official JS SDK (loaded via <script> in the
   HTML — see the pcloud-sdk-js <script> tag near the other script includes)
   rather than hand-rolling the wire protocol: the exact request/response
   shape behind initOauthPollToken isn't public API and guessing at it would
   silently fail, so the maintained SDK does the actual polling. It opens
   pCloud's login in a new tab (a real browser context, not the APK's
   WebView, so pCloud's own login page isn't blocked the way Google's is)
   and calls back here once the person finishes logging in there. */
async function pcConnect() {
  if (!PCLOUD_APP_KEY) { showToast('⚠️ Paste your pCloud App Key above and tap Save first.'); return; }
  const errEl = document.getElementById('tgError');
  if (errEl) errEl.style.display = 'none';

  const sdk = window.pCloudSDK || window.pCloudSdk;
  if (!sdk || !sdk.oauth || typeof sdk.oauth.initOauthPollToken !== 'function') {
    const msg = 'pCloud SDK failed to load — check your internet connection and that the pcloudsdk.js <script> tag is present.';
    if (errEl) { errEl.textContent = '❌ ' + msg; errEl.style.display = 'block'; }
    showToast('❌ ' + msg);
    return;
  }

  showToast('⏳ Complete sign-in in the tab that just opened…');
  sdk.oauth.initOauthPollToken({
    client_id: PCLOUD_APP_KEY,
    receiveToken: function(access_token, locationid) {
      // locationid: 1 = US region (api.pcloud.com), 2 = EU region (eapi.pcloud.com).
      // Every later call must hit the same region the token was issued for.
      PCLOUD_TOKEN = access_token;
      PCLOUD_HOST  = (locationid === 2) ? 'eapi.pcloud.com' : 'api.pcloud.com';
      localStorage.setItem('pv_pcloud_token', PCLOUD_TOKEN);
      localStorage.setItem('pv_pcloud_host',  PCLOUD_HOST);
      showToast('✅ pCloud connected!');
      _tgRefreshStatusUI();
      updateCloudUI();
      setTimeout(() => { _autoRestoreFromCloud(); }, 300);   // bring the library back right away
    },
    onError: function(err) {
      const msg = (err && (err.message || err.error)) || 'Login failed, was cancelled, or timed out.';
      if (errEl) { errEl.textContent = '❌ ' + msg; errEl.style.display = 'block'; }
      showToast('❌ pCloud connect failed: ' + msg);
    }
  });
}


function tgClearConfig() {
  if (!confirm('Disconnect pCloud? Your files on pCloud will NOT be deleted.')) return;
  PCLOUD_TOKEN = ''; PCLOUD_HOST = 'api.pcloud.com';
  localStorage.removeItem('pv_pcloud_token');
  localStorage.removeItem('pv_pcloud_host');
  showToast('pCloud disconnected.');
  _tgRefreshStatusUI();
  updateCloudUI();
}


function _tgRefreshStatusUI() {
  const statusEl = document.getElementById('tgStatus');
  const textEl   = document.getElementById('tgStatusText');
  if (statusEl && textEl) {
    if (isPcloudEnabled()) {
      statusEl.style.display = 'flex';
      textEl.textContent = '✅ Connected to pCloud';
    } else {
      statusEl.style.display = 'none';
    }
  }
  _pcRefreshAppKeyUI();
}


/* ── App Key box (Cloud page → Account) ──
   Lets the app key be pasted in from the UI instead of hand-edited into
   the source file. Saving writes it to localStorage (so it survives
   reloads on this device) and updates the live PCLOUD_APP_KEY used by
   pcConnect() immediately — no page refresh needed. Pasting a new key
   and hitting Save again simply overwrites the old one. */
function _pcRefreshAppKeyUI() {
  const input  = document.getElementById('pcAppKeyInput');
  const status = document.getElementById('pcAppKeyStatus');
  if (!input) return;
  if (PCLOUD_APP_KEY) {
    input.placeholder = 'Saved: ' + _pcMaskKey(PCLOUD_APP_KEY) + ' — paste a new key to replace it';
    if (status) { status.textContent = 'App Key saved on this device.'; status.style.color = 'rgba(255,255,255,0.35)'; }
  } else {
    input.placeholder = 'Paste pCloud App Key';
    if (status) { status.textContent = 'No App Key saved yet.'; status.style.color = 'rgba(255,255,255,0.35)'; }
  }
}

function _pcMaskKey(key) {
  if (key.length <= 8) return key;
  return key.slice(0, 4) + '…' + key.slice(-4);
}

function _pcSaveAppKey() {
  const input  = document.getElementById('pcAppKeyInput');
  const status = document.getElementById('pcAppKeyStatus');
  if (!input) return;
  const key = input.value.trim();
  if (!key) {
    if (status) { status.textContent = 'Paste a key before saving.'; status.style.color = '#f87171'; }
    return;
  }
  PCLOUD_APP_KEY = key;
  localStorage.setItem('pv_pcloud_app_key', key);
  input.value = '';
  _pcRefreshAppKeyUI();
  showToast('✅ pCloud App Key saved');
}


async function tgTestConnection() {
  const errEl = document.getElementById('tgError');
  if (!isPcloudEnabled()) {
    if (errEl) { errEl.textContent = '⚠️ Connect pCloud first.'; errEl.style.display = 'block'; }
    return;
  }
  showToast('⏳ Testing connection…');
  try {
    const r = await fetch(`https://${PCLOUD_HOST}/userinfo?access_token=${encodeURIComponent(PCLOUD_TOKEN)}`);
    const d = await r.json();
    if (d.result === 0) {
      if (errEl) errEl.style.display = 'none';
      showToast(`✅ Connection works! Signed in as ${d.email || 'pCloud user'}.`);
    } else {
      throw new Error(d.error || 'Unknown error');
    }
  } catch(e) {
    if (errEl) { errEl.textContent = '❌ ' + e.message; errEl.style.display = 'block'; }
    showToast('❌ Test failed: ' + e.message);
  }
}


async function _pcUploadFile(encBlob, filename) {
  const fd = new FormData();
  fd.append('file', encBlob, filename);
  const r = await fetch(`https://${PCLOUD_HOST}/uploadfile?access_token=${encodeURIComponent(PCLOUD_TOKEN)}&folderid=0&nopartial=1`, {
    method: 'POST', body: fd
  });
  const d = await r.json();
  if (d.result !== 0 || !d.fileids || !d.fileids.length) throw new Error('pCloud: ' + (d.error || 'upload failed'));
  return d.fileids[0];
}


const _vcLinkCache = new Map();           // fileId -> { url, exp }
const _VC_LINK_TTL = 5 * 60 * 1000;       // pCloud links expire; re-ask every 5 min
function _vcLinkForget(fileId) { _vcLinkCache.delete(String(fileId)); }
async function _pcGetFileLink(fileId) {
  const hit = _vcLinkCache.get(String(fileId));
  if (hit && hit.exp > Date.now()) return hit.url;
  const url = await _pcGetFileLinkFresh(fileId);
  _vcLinkCache.set(String(fileId), { url, exp: Date.now() + _VC_LINK_TTL });
  return url;
}
async function _pcGetFileLinkFresh(fileId) {
  const r = await fetch(`https://${PCLOUD_HOST}/getfilelink?access_token=${encodeURIComponent(PCLOUD_TOKEN)}&fileid=${encodeURIComponent(fileId)}`);
  const d = await r.json();
  if (d.result !== 0 || !d.hosts || !d.hosts.length) throw new Error('pCloud getfilelink: ' + (d.error || 'failed'));
  return `https://${d.hosts[0]}${d.path}`;
}


async function _pcDeleteFile(fileId) {
  const r = await fetch(`https://${PCLOUD_HOST}/deletefile?access_token=${encodeURIComponent(PCLOUD_TOKEN)}&fileid=${encodeURIComponent(fileId)}`);
  const d = await r.json();
  if (d.result !== 0) throw new Error('pCloud deletefile: ' + (d.error || 'failed'));
  return true;
}


async function _tgSaveManifest() {
  const manifest = {
    v: 1, updatedAt: Date.now(),
    photos: photos.map(p => ({
      id: p.id, name: p.name, folder: p.folder,
      storage: p.storage, mediaType: p.mediaType || (p.name && p.name.match(/\.(mp4|webm|mov|avi|mkv|m4v)$/i) ? 'video' : (p.name && p.name.match(/\.gif$/i) ? 'gif' : (p.name && p.name.match(/\.webp$/i) ? 'webp' : 'image'))),
      addedAt: p.addedAt, size: p.size,
      pcFileId: p.pcFileId || null,   // pCloud fileid for retrieval
      rid: p.rid, batch: p.batch, doneAt: p.doneAt,   // retrieval code / batch / encryption-done stamp
      fav: p.fav || undefined,
      thId: p.thId || undefined, pvId: p.pvId || undefined,   // encrypted thumbnail / preview in pCloud
    })),
    folders
  };
  // Overwrite: upload the new manifest FIRST, and only delete the previous
  // one once that succeeds — deleting first would risk losing the whole
  // index (with every pcFileId in it) if the new upload then failed.
  const prevId = localStorage.getItem('pv_pcloud_manifest_fileid');
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const fileId = await _pcUploadFile(blob, 'hope_manifest.json');
  localStorage.setItem('pv_pcloud_manifest_fileid', fileId);
  if (prevId && prevId !== fileId) { try { await _pcDeleteFile(prevId); } catch(e) {} }
  return fileId;
}


async function _tgLoadManifest() {
  // 1. Fast path: the pointer saved on this device.
  const savedId = localStorage.getItem('pv_pcloud_manifest_fileid');
  if (savedId) {
    try {
      const url = await _pcGetFileLink(savedId);
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch (e) { /* fall through to lookup by name */ }
    _vcLinkForget(savedId);
  }
  // 2. Pointer missing (new device, reinstalled APK, cleared site data) or stale:
  //    find hope_manifest.json in pCloud by name.
  const foundId = await _vcFindManifestId();
  if (!foundId) throw new Error('No manifest found. Upload some files first.');
  const url = await _pcGetFileLink(foundId);
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('Could not fetch manifest from pCloud.');
  try { localStorage.setItem('pv_pcloud_manifest_fileid', String(foundId)); } catch (e) {}
  return await r.json();
}


let _tgPushBusy = false;

async function tgPushAll() {
  if (!isPcloudEnabled()) { showToast('⚠️ Connect pCloud first!'); openCloudModal(); return; }
  if (_tgPushBusy) { showToast('⏳ Already uploading to pCloud…'); return; }
  _setCloudBarBusy(true);
  try { await _tgPushAllCore(); }
  finally { _setCloudBarBusy(false); _updateCloudBar(); }
}

/* A file is "waiting" when it is encrypted on this device but not yet in pCloud. */
function _isWaitingForUpload(p) {
  return !!p && ((p.storage === 'idb' && p.encId) || (p.storage === 'local' && p.encData));
}
function _pendingUploadCount() { return (photos || []).filter(_isWaitingForUpload).length; }

/* Upload — runs ONLY when the Upload button is tapped.
   • Takes a snapshot of the files waiting at that moment and uploads exactly
     those, one by one, in the background (the rest of the app stays usable).
   • Files added while it runs are NOT sent — they wait for the next tap.
   • The local encrypted copy is only removed after the cloud index (manifest)
     that lists the file has been saved, so a closed app or a dropped
     connection can never leave a file that exists nowhere. */
async function _tgPushAllCore() {
  if (!isPcloudEnabled()) { showToast('⚠️ Connect pCloud first!'); openCloudModal(); return; }
  _tgPushBusy = true;
  await _acquireCloudDirection('upload'); // waits out any in-flight retrieve

  // Snapshot — only what exists right now
  const snapshot = photos.filter(_isWaitingForUpload).map(p => p.id);

  const box    = document.getElementById('cloudOpBox');
  const bar    = document.getElementById('cloudOpBar');
  const title  = document.getElementById('cloudOpTitle');
  const status = document.getElementById('cloudOpStatus');
  const icon   = document.getElementById('cloudOpIcon');

  if (box) box.style.display = 'block';
  if (bar) bar.style.width = '0%';
  if (icon) { icon.className = 'fas fa-rotate'; icon.style.cssText = 'animation:spin 1s linear infinite;'; }

  const finish = () => { _tgPushBusy = false; _releaseCloudDirection('upload'); };

  if (snapshot.length === 0) {
    if (title) title.textContent = '✅ Nothing to upload';
    if (status) status.textContent = 'All files are already in pCloud.';
    if (icon) { icon.className = 'fas fa-circle-check'; icon.style.animation = 'none'; }
    showToast('✅ Already up to date!');
    _setActivityStatus('Everything is already in pCloud', 'fa-circle-check');
    finish();
    return;
  }

  if (title) title.textContent = `Uploading ${snapshot.length} file(s) to pCloud…`;
  if (status) status.textContent = 'Sending one by one…';

  let sent = 0, failed = 0, step = 0;
  const unsaved = [];   // uploaded, but not yet listed in the saved cloud index

  // Save the cloud index, and only then free the local copies it covers.
  const checkpoint = async () => {
    if (!unsaved.length) return true;
    try { await _tgSaveManifest(); }
    catch (e) { console.warn('Cloud index save failed:', e); return false; }
    for (const u of unsaved) {
      if (u.encId) idbDelete(u.encId).catch(() => {});
      _removeFromPendingQueue(u.p.id);
    }
    unsaved.length = 0;
    return true;
  };

  for (const id of snapshot) {
    const p = photos.find(x => x.id === id);
    if (!_isWaitingForUpload(p)) continue;          // deleted / trashed meanwhile
    step++;
    if (status) status.textContent = `[${step}/${snapshot.length}] Sending: ${p.name}`;
    _setActivityStatus(`Uploading ${step}/${snapshot.length}…`, 'fa-cloud-arrow-up');

    try {
      let encBlob;
      if (p.storage === 'idb') {
        encBlob = await idbGet(p.encId);
        if (!encBlob) throw new Error('Blob missing from local storage');
      } else {
        encBlob = base64ToBlob(p.encData);
      }
      const safeName = (p.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      const fname = 'hope_' + p.id + '_' + (p.rid ? p.rid + '_' : '') + safeName + '.enc';

      let pcFileId = null, lastErr = null;
      for (let attempt = 1; attempt <= 3 && !pcFileId; attempt++) {
        try { pcFileId = await _pcUploadFile(encBlob, fname); }
        catch (e) { lastErr = e; if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt)); }
      }
      if (!pcFileId) throw lastErr || new Error('Upload failed');

      // Thumbnail + preview go up too, so any device (or a reinstalled APK) can rebuild the gallery.
      try { await _vcUploadDerivs(p, encBlob); } catch (e) { console.warn('thumb upload skipped for', p.name, e.message); }

      unsaved.push({ p, encId: p.encId });
      p.storage  = 'cloud';
      p.pcFileId = pcFileId;
      delete p.encData;
      delete p.encId;
      sent++;
      if (unsaved.length >= 5) await checkpoint();
    } catch (e) {
      console.warn('tgPushAll failed for', p.name, e);
      failed++;
    }
    if (bar) bar.style.width = (((sent + failed) / snapshot.length) * 100) + '%';
  }

  // Final index save. If it can't be saved, put the unlisted files back to
  // "waiting" (and drop their cloud copies) so the next tap re-sends them.
  if (status) status.textContent = 'Saving file index to pCloud…';
  if (!(await checkpoint())) {
    for (const u of unsaved) {
      const fid = u.p.pcFileId;
      u.p.storage = 'idb'; u.p.encId = u.encId; delete u.p.pcFileId;
      _pcDeleteFile(fid).catch(() => {});
      if (u.p.thId) { _pcDeleteFile(u.p.thId).catch(() => {}); delete u.p.thId; }
      if (u.p.pvId) { _pcDeleteFile(u.p.pvId).catch(() => {}); delete u.p.pvId; }
      sent--; failed++;
    }
    unsaved.length = 0;
  }

  if (bar) bar.style.width = '100%';
  if (icon) { icon.className = failed > 0 ? 'fas fa-circle-exclamation' : 'fas fa-circle-check'; icon.style.animation = 'none'; }
  const msg = failed > 0
    ? `✅ ${sent} uploaded, ⚠️ ${failed} failed`
    : `✅ ${sent} file(s) uploaded & removed from device!`;
  if (title) title.textContent = msg;
  if (status) status.textContent = failed > 0
    ? 'Some files failed. They remain on device — tap Upload to try again.'
    : 'Files are now in pCloud. Your device space is freed.';
  showToast(msg);
  _setActivityStatus(failed > 0 ? `${sent} uploaded, ${failed} failed` : `${sent} file${sent !== 1 ? 's' : ''} uploaded`, failed > 0 ? 'fa-circle-exclamation' : 'fa-circle-check');
  _saveLocalOnly();
  render();
  if (typeof _updateStoragePill === 'function') _updateStoragePill();
  updateCloudUI();
  finish();
}


async function _tgDecryptPhoto(p) {
  if (!isPcloudEnabled()) throw new Error('pCloud not configured');
  const url = await _pcGetFileLink(p.pcFileId);
  const r = await fetch(url);
  if (!r.ok) throw new Error('Could not fetch file from pCloud');
  const encBlob = new Blob([await r.arrayBuffer()], { type: 'application/octet-stream' });
  return await decryptBlob(encBlob, sessionPin);
}


function isCloudEnabled() { return isPcloudEnabled(); }


function openCloudModal() {
  const m = document.getElementById('cloudModal');
  if (m) { _tgRefreshStatusUI(); m.classList.add('open'); }
}


function closeCloudModal() {
  const m = document.getElementById('cloudModal');
  if (!m || !m.classList.contains('open') || m.classList.contains('closing')) return;
  m.classList.add('closing');
  setTimeout(() => { m.classList.remove('open', 'closing'); }, 280);
}


function updateCloudUI() {
  _updateCloudBar(true);
  const banner = document.getElementById('cloudSetupBanner');
  const pill   = document.getElementById('cloudActivePill');
  if (banner) banner.classList.toggle('show', !isPcloudEnabled());
  if (pill)   pill.style.display = isPcloudEnabled() ? 'flex' : 'none';
}


async function forcePushToCloud()         { await tgPushAll(); }


/* pCloud actually supports deleting a file by fileid (deletefile), unlike
   the old Cloudinary path this replaces (which was permanently hardcoded
   off above). Cloud delete is available whenever pCloud is connected. */
function isDeleteEnabled() { return isPcloudEnabled(); }


function startCloudPolling() {
  if (_pollInterval) return;
  _pollInterval = setInterval(async () => {
    if (!isCloudEnabled() || _cloudSyncing || document.hidden) return;
    // Background/quiet retrieve — if a push is already in flight, just wait
    // for the next 15s tick rather than blocking on it.
    if (_cloudUploadBusy || _cloudRetrieveBusy) return;
    await _acquireCloudDirection('retrieve', 3000);
    try {
      const manifest = await _tgLoadManifest();
      if (manifest && manifest.updatedAt && manifest.updatedAt > _lastAppliedManifestTime) {
        // Skip if local is newer — we have a pending sync in flight (debounce window).
        // Applying a stale cloud manifest would restore recently-deleted photos.
        if (manifest.updatedAt < _lastLocalSaveTime) return;
        _lastAppliedManifestTime = manifest.updatedAt;
        applyManifest(manifest);
        render();
        showToast('☁️ Synced from cloud');
      }
    } catch(e) { console.warn('poll sync failed:', e); }
    finally { _releaseCloudDirection('retrieve'); }
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
    await _acquireCloudDirection('upload'); // waits out any in-flight retrieve
    try {
      // _tgSaveManifest() (pCloud-backed — see above) already builds the
      // manifest from `photos`/`folders` and overwrites hope_manifest.json.
      const updatedAt = Date.now();
      await _tgSaveManifest();
      _lastLocalSaveTime = updatedAt;
      // Notify same-origin tabs (regular → regular) instantly via BroadcastChannel
      try { _syncChannel.postMessage({ type: 'sync', updatedAt }); } catch(e) {}
    } catch(e) {
      console.error('syncToCloud failed:', e.message);
      showToast('⚠️ Cloud sync failed — ' + (e.message || '').slice(0, 70));
    } finally {
      _cloudSyncing = false;
      _releaseCloudDirection('upload');
    }
  }, 2000); // 2s debounce — batches rapid changes, avoids hammering the pCloud API
}


async function restoreFromCloud() {
  showToast('☁️ Restoring from cloud…');
  let manifest;
  try { manifest = await _tgLoadManifest(); }
  catch(e) { showToast('⚠️ No cloud backup found.'); return false; }
  return applyManifest(manifest);
}


function applyManifest(manifest) {
  // Accept v:1, or any manifest that has a photos array (legacy / missing version)
  if (!manifest || (!Array.isArray(manifest.photos) && manifest.v !== 1)) return false;
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
    // Only accept cloud-stored photos (in pCloud) from the manifest
    const cloudFromManifest = manifest.photos.filter(p => p.storage === 'cloud' && p.pcFileId);
    photos = [...cloudFromManifest, ...localExtra];
    photos.forEach((p, i) => { if (!p.id) p.id = 'ph' + Date.now() + i; });
  }
  // Restore folders
  if (Array.isArray(manifest.folders)) folders = manifest.folders;
  // Save folders only — NOT photos.
  // Photos are session-only: they must never be written to localStorage
  // because load() always starts empty and relies on the auto-restore that runs on unlock.
  try {
    localStorage.setItem('pv_folders', JSON.stringify(folders));
  } catch(e) { /* quota */ }
  return true;
}


function _saveLocalOnly() {
  try {
    localStorage.setItem('pv_folders', JSON.stringify(folders));
  } catch(e) { /* quota */ }
  _vcScheduleIndexSave();
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
  _vcScheduleIndexSave();
  // Keep the pCloud manifest current whenever pCloud is connected — even if
  // some items are still local-only (not yet pushed, or a direct upload
  // fell back to device storage). The manifest only ever tracks items that
  // already have a pcFileId, so it's always safe to sync; waiting for every
  // last local item to be pushed first just delayed indexing the ones that
  // already made it to the cloud.
  if (isCloudEnabled()) syncToCloud().catch(e => console.warn('Cloud sync failed:', e));
}


function load() {
  // ── Photos are still session-only for VIEWING — the gallery only ever
  // shows what's behind the PIN lock screen, same as before. What changed:
  // we no longer blindly wipe IndexedDB here. Any file that was added but
  // been uploaded to pCloud yet is reconstructed from the pending-uploads
  // queue below, so it is still there and still waiting for the next tap on
  // Upload. Its thumbnail still can't
  // be decrypted/shown until the PIN is entered; only the raw ciphertext
  // needed to finish the upload is touched before that.
  photos = [];
  try {
    const rawFolders = localStorage.getItem('pv_folders') || '[]';
    folders = JSON.parse(rawFolders);
  } catch(e) { folders = []; }
  // Wipe any stale photo data from localStorage so it can never leak back in
  localStorage.removeItem('pv_photos');

  _restorePendingQueueIntoPhotos();
  _loadTrashed();
  _updateBinBadge();

  // Nothing is sent to pCloud here — files wait in the pending queue until
  // the Upload button is tapped (see tgPushAll).
  try { _updateCloudBar(true); } catch(e) {}
}


/* ── Pending-upload queue ──
   A small localStorage record of files that have been encrypted and saved
   to IndexedDB but not yet uploaded to pCloud. Files wait here until the
   Upload button is tapped. The actual ciphertext lives in IndexedDB
   (untouched by load() above), and this queue carries just enough plain
   metadata (name/folder/size/retrieval code/etc, the same fields stored in
   plaintext in the pCloud manifest) to rebuild the photo record after the
   app is closed and reopened. */

function _getPendingQueue() {
  try { return JSON.parse(localStorage.getItem('pv_pending_uploads') || '[]'); }
  catch(e) { return []; }
}

function _setPendingQueue(list) {
  try { localStorage.setItem('pv_pending_uploads', JSON.stringify(list)); } catch(e) {}
}

function _addToPendingQueue(photo) {
  const q = _getPendingQueue();
  if (!q.some(x => x.id === photo.id)) {
    q.push({
      id: photo.id, name: photo.name, size: photo.size, addedAt: photo.addedAt,
      folder: photo.folder, mediaType: photo.mediaType, fav: photo.fav || undefined,
      rid: photo.rid, batch: photo.batch, doneAt: photo.doneAt,
      storage: 'idb', encId: photo.id, encrypted: true
    });
    _setPendingQueue(q);
  }
}

function _removeFromPendingQueue(id) {
  const q = _getPendingQueue();
  const next = q.filter(x => x.id !== id);
  if (next.length !== q.length) _setPendingQueue(next);
}

/* Re-adds any queued-but-unconfirmed items to `photos` on startup so they
   (a) are visible in the gallery once unlocked, and (b) can be pushed to
   pCloud by tgPushAll(), which matches queue entries against `photos` by
   id to update storage/pcFileId in place on success. */
function _restorePendingQueueIntoPhotos() {
  const q = _getPendingQueue();
  if (!q.length) return;
  const existingIds = new Set(photos.map(p => p.id));
  for (const entry of q) {
    if (!existingIds.has(entry.id)) { photos.push({ ...entry }); existingIds.add(entry.id); }
  }
}


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
      encBlob = await fetchCloudBlob(p);
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
    encBlob = await fetchCloudBlob(p);
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


/* Takes the photo record (not a bare URL) because pCloud's getfilelink
   links expire — resolving a fresh one from p.pcFileId right before fetch
   is the same "ask again each time" pattern _tgGetFileUrl used to use. */
async function fetchCloudBlob(p, noCache) {
  if (!p || !p.pcFileId) throw new Error('No pCloud file reference found for this item.');
  // Recently opened originals stay on the device (still encrypted) so re-opening is instant.
  const cached = await _vcOrigGet(p.id).catch(() => null);
  if (cached) return cached;
  let url = await _pcGetFileLink(p.pcFileId);
  let r;
  try {
    r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) {   // link may have expired — ask for a fresh one once
      _vcLinkForget(p.pcFileId);
      url = await _pcGetFileLink(p.pcFileId);
      r = await fetch(url, { cache: 'no-store' });
    }
  } catch(networkErr) {
    throw new Error('Network error fetching from pCloud. Check your internet connection. (' + networkErr.message + ')');
  }
  if (!r.ok) throw new Error(`pCloud returned ${r.status} for stored file. The file may have been deleted from pCloud, or the link expired.`);

  // Always read as ArrayBuffer — reading as text corrupts binary data because
  // TextDecoder mangles invalid UTF-8 sequences, breaking AES-GCM decryption.
  const buf = await r.arrayBuffer();
  if (buf.byteLength === 0) throw new Error('Empty response from pCloud.');

  // Raw binary .enc file — return as-is
  const encBlob = new Blob([buf], { type: 'application/octet-stream' });
  if (!noCache) _vcOrigPut(p.id, encBlob);   // fire-and-forget
  return encBlob;
}


async function _deletePhotosFromCloud(targets) {
  for (const p of targets) { _vcForget(p.id); }
  // Clean up IDB blobs first
  for (const p of targets) {
    if (p.storage === 'idb' && p.encId) {
      idbDelete(p.encId).catch(() => {});
    }
  }
  if (!isDeleteEnabled()) return;
  const cloudPhotos = targets.filter(p => p.storage === 'cloud' && p.pcFileId);
  if (!cloudPhotos.length) return;
  for (const p of cloudPhotos) {
    try { await _pcDeleteFile(p.pcFileId); }
    catch(e) { console.warn('Cloud delete failed for', p.name, e.message); }
    if (p.thId) { try { await _pcDeleteFile(p.thId); } catch(e) {} }
    if (p.pvId) { try { await _pcDeleteFile(p.pvId); } catch(e) {} }
  }
}


async function emptyBin() {
  if (!trashedPhotos.length) return;
  const count = trashedPhotos.length;
  if (!confirm(`Permanently delete all ${count} item(s) from the bin? This cannot be undone.`)) return;

  const toDelete = [...trashedPhotos];
  trashedPhotos = [];
  _saveTrashed();
  _renderBinItems();
  _updateBinBadge();

  const cloudItems = toDelete.filter(p => p.storage === 'cloud' && p.pcFileId);
  const hasCloudAuth = isPcloudEnabled();

  if (cloudItems.length > 0 && hasCloudAuth) {
    showToast(`🗑️ Deleting ${cloudItems.length} item(s) from cloud…`);
    try {
      await _deletePhotosFromCloud(cloudItems);
      showToast(`✅ Bin emptied — ${count} item(s) permanently deleted from cloud!`);
    } catch(e) {
      showToast(`⚠️ Bin cleared locally — some cloud files may remain: ${e.message || ''}`);
      console.warn('emptyBin cloud delete error:', e);
    }
  } else if (cloudItems.length > 0 && !hasCloudAuth) {
    showToast(`🗑️ Bin cleared — ${count} item(s) removed (connect pCloud to delete from cloud)`);
  } else {
    showToast(`🗑️ Bin emptied — ${count} item(s) permanently deleted`);
  }
}


function closeBinModal() {
  const m = document.getElementById('binModal');
  if (!m || !m.classList.contains('open') || m.classList.contains('closing')) return;
  m.classList.add('closing');
  setTimeout(() => { m.classList.remove('open', 'closing'); }, 280);
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
  if (p.storage === 'idb' && p.encId) { _addToPendingQueue(p); _updateCloudBar(true); }
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

  const isCloud = p.storage === 'cloud' && p.pcFileId;
  const hasCloudAuth = isPcloudEnabled();

  if (isCloud && hasCloudAuth) {
    showToast('🗑️ Deleting from cloud…');
    try {
      await _deletePhotosFromCloud([p]);
      showToast('✅ Permanently deleted from cloud!');
    } catch(e) {
      showToast('⚠️ Removed from vault — cloud delete failed: ' + (e.message || ''));
      console.warn('Cloud delete error:', e);
    }
  } else if (isCloud && !hasCloudAuth) {
    showToast('🗑️ Removed from vault (connect pCloud to delete the remote copy)');
  } else {
    showToast('🗑️ Permanently deleted');
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
  } else if (mode === 'gold') {
    el.style.backgroundImage = 'radial-gradient(ellipse 900px 520px at 50% -6%, rgba(200,173,122,0.30), transparent 65%), radial-gradient(ellipse 700px 460px at 50% 110%, rgba(200,173,122,0.14), transparent 60%), linear-gradient(#17130c, #0d0b07)';
    el.style.backgroundColor = '';
    if (hdr) hdr.style.background = '';
    try { localStorage.setItem('pv_bin_bg', 'gold'); } catch(e) {}
  } else {
    el.style.backgroundImage = '';
    el.style.backgroundColor = '';
    if (hdr) hdr.style.background = '';
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
    card.style.cssText = 'position:relative;width:100%;aspect-ratio:1/1;border-radius:14px;overflow:hidden;background:var(--card);border:1px solid rgba(255,255,255,0.075);box-shadow:0 8px 20px -12px rgba(0,0,0,0.7);cursor:pointer;';

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
    if (p.storage === 'cloud' && p.pcFileId) {
      (async () => {
        try {
          const encBlob = await fetchCloudBlob(p);
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
    btn.classList.toggle('active', n === cols);
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
    const persistable = trashedPhotos.filter(p => p.storage === 'cloud' && p.pcFileId);
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


/* ════════════════════════════════════════════════════════════════════════
     SECTION 6 — EVERYTHING ELSE
     Page navigation/swipe, lightbox (slider, menu, actions), move-to-folder
     modal, file-input/upload handling, thumbnail rendering, generic confirm
     modal, PWA install, and lock-screen overrides. Depends on Section 5 for
     encryption/storage/cloud/bin — load Section 5 before this file.
   ════════════════════════════════════════════════════════════════════════ */

/* ── Page slider (rewritten) ──────────────────────────────────────────
   #pg1/#pg2 are permanently promoted to their own compositor layer via
   CSS (transform: translateZ(0), see index.html), so this no longer
   toggles will-change on the fly — that toggle could miss the first
   drag frame on Android WebView and show up as a black flash at the
   leading edge of the incoming page. All transform writes below use
   translate3d and a rounded percentage to avoid sub-pixel seams. ── */
const PAGE_TRANSITION = 'transform 0.46s cubic-bezier(0.22, 1, 0.36, 1)';

function _setTrackX(track, percent, animate) {
  track.style.transition = animate ? PAGE_TRANSITION : 'none';
  // Round to 3 decimals — avoids the sub-pixel gap between the two
  // 50%-wide flex children that can otherwise flash the page-wrapper
  // background through the seam for a frame.
  const p = Math.round(percent * 1000) / 1000;
  track.style.transform = 'translate3d(' + p + '%, 0, 0)';
}

function switchToPage(n) {
  _galPage = n;
  const track = document.getElementById('pageSlideTrack');
  if (track) _setTrackX(track, n === 1 ? -50 : 0, true);

  const tp = document.getElementById('tabPhotos');
  const ta = document.getElementById('tabAlbums');
  if (tp) tp.classList.toggle('active', n === 0);
  if (ta) ta.classList.toggle('active', n === 1);
  // Floating "+" only makes sense on page 2 (Gallery) — hidden on the homepage
  const tr = document.getElementById('tabBarRight');
  if (tr) tr.classList.toggle('visible', n === 1);
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
   drag hijacks the gesture. Drag updates are batched through
   requestAnimationFrame so the transform write always lands on a
   fresh frame instead of racing the browser's own paint. */
(function () {
  const wrap  = document.getElementById('pageWrapper');
  const track = document.getElementById('pageSlideTrack');
  if (!wrap || !track) return;

  const COMMIT_RATIO   = 0.28;   // fraction of viewport width to commit to a page change
  const FLING_SPEED    = 0.5;    // px/ms — a fast flick commits even if short
  const SIDEBAR_COMMIT = 0.10;   // fraction of viewport width to commit to opening — gentle, small swipe
  const EDGE_RESISTANCE = 0.32;  // rubber-band damping past the first/last page

  let startX = 0, startY = 0, lastX = 0, lastT = 0, velocity = 0;
  let dragging = false, isHorizontal = null, sidebarDrag = false;
  let rafId = null, pendingDx = 0;

  function applyDragFrame() {
    rafId = null;
    const wrapW = wrap.offsetWidth || 1;
    const dx = pendingDx;

    if (sidebarDrag) {
      // 1:1 finger tracking — same as the page-track drag: a full
      // viewport-width drag = fully open, so the sidebar genuinely
      // follows the finger instead of racing ahead of it. Rubber-bands
      // past the edges with the same resistance as the page-track drag,
      // instead of a hard clamp.
      let progress = dx / wrapW;
      if (progress > 1)      progress = 1 + (progress - 1) * SIDEBAR_EDGE_RESISTANCE;
      else if (progress < 0) progress = progress * SIDEBAR_EDGE_RESISTANCE;
      _sidebarApplyProgress(progress);
      return;
    }

    const percentDelta = (dx / (wrapW * 2)) * 100; // track is 200% wide, so halve the ratio
    const basePercent = _galPage === 1 ? -50 : 0;
    let target = basePercent + percentDelta;
    // Elastic resistance past the first/last page — the same rubber-band
    // give a native photo viewer has when you swipe past the last image,
    // instead of the drag going dead the instant it hits the edge. The
    // finger still moves the track, just damped to a fraction of the
    // distance past the boundary, and it springs back on release via the
    // track's own CSS transition (see touchend below).
    if (target > 0)   target = target * EDGE_RESISTANCE;
    if (target < -50) target = -50 + (target - (-50)) * EDGE_RESISTANCE;
    _setTrackX(track, target, false);
  }

  wrap.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    startX = lastX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    lastT = Date.now();
    velocity = 0;
    dragging = true;
    isHorizontal = null;
    sidebarDrag = false;
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
        if (aw) { aw.style.willChange = 'transform'; aw.style.transition = 'none'; }
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

    pendingDx = dx;
    if (rafId === null) rafId = requestAnimationFrame(applyDragFrame);
  }, { passive: false });

  wrap.addEventListener('touchend', function (e) {
    if (!dragging) return;
    dragging = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
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
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (sidebarDrag) {
      _sidebarSettle(false);
      sidebarDrag = false;
      return;
    }
    switchToPage(_galPage);
  }, { passive: true });
})();


/* ── Lightbox / cloud-sync / move-picker state, and the real save/load/
   openLightbox/openCloudModal/installPWA implementations that override
   the placeholder stubs declared earlier in this file (later function
   declarations win). Must remain part of the LAST script block. ── */

let contextTarget    = null;

let sliderList        = [];

let sIndex            = 0;

let decryptedUrls     = [];

let _photoIdCounter   = 0;

let pendingCtxSelect  = false;

let _movePickerFolder = null;

/* ── Cloud sync bookkeeping ── */

const _thumbCache = {};

/* ── Misc ── */

let _lbMenuStyle        = localStorage.getItem('pv_menuStyle') || 'sheet';

let _deferredInstallPrompt = null;


function newPhotoId() { return 'ph_' + Date.now() + '_' + (++_photoIdCounter); }

/* ── Add-files pipeline — wired to the single global #fileInput used by
   every "Add Files" trigger in the app (homepage add button, folder
   detail pages, subfolders, and each media-type collection page).

   Step 1 · DIGEST  — the whole selection is taken in first: every file
            gets its id, a retrieval code (rid) and a batch code up front.
   Step 2 · ENCRYPT — files are then encrypted strictly one by one and
            saved to IndexedDB; each finished file is stamped with doneAt
            and shows up in the gallery straight away.
   Step 3 · WAIT    — the encrypted files sit in the pending-uploads queue.
            NOTHING is sent to pCloud until the Upload button is tapped
            (see tgPushAll). ── */

/* ── Local encryption queue ──
   Encryption itself must stay strictly serial — only one file-selection
   batch is ever being digested + encrypted at a time. Picking new files
   while a batch is mid-encryption is still instant (it just adds another
   batch to the queue); the queued batch waits its turn. */
let _encryptQueue    = [];
let _encryptionBusy  = false;

async function _handleFileInputChange(e) {
  const input = e.target;
  const files = Array.from(input.files || []);
  input.value = ''; // allow re-selecting the same file(s) again later
  if (files.length === 0) return;

  // Which folder these files should land in — set by _fdpUpload() when
  // adding from inside a folder/subfolder detail page, otherwise home.
  const folderId = (typeof activeFolder !== 'undefined' && activeFolder && activeFolder !== 'home')
    ? activeFolder : undefined;
  // Set by _cpUpload() when adding from inside a media-type collection page
  // (e.g. tag new uploads as favourites when added from the Picked page).
  const pendingType = window._cpPendingUploadType;
  window._cpPendingUploadType = null;

  _encryptQueue.push({ files, folderId, pendingType });

  if (_encryptionBusy) {
    showToast(`⏳ Queued ${files.length} file${files.length !== 1 ? 's' : ''} — encrypting after the current batch…`);
  }

  _drainEncryptQueue();
}

async function _drainEncryptQueue() {
  if (_encryptionBusy) return; // something is already draining the queue
  _encryptionBusy = true;
  try {
    while (_encryptQueue.length) {
      const batch = _encryptQueue.shift();
      await _encryptAndSaveBatch(batch);
    }
  } finally {
    _encryptionBusy = false;
  }
}

/* Coalesced UI refresh — lets each file "pop in" as soon as it's ready
   instead of waiting for a whole batch to finish, without doing a full
   render()/renderFolders() pass per file (which would be wasteful for a
   20-30 file batch). Multiple calls in the same frame collapse into one
   refresh via requestAnimationFrame; each call also bumps a save so a
   mid-batch crash/reload never loses already-encrypted files. */
let _batchRefreshPending    = false;
let _batchRefreshSafetyId   = null;

/* The actual refresh work, guaranteed to run at most once per scheduled
   round no matter which path (rAF, the safety timeout, or the
   visibilitychange fallback below) ends up triggering it first. */
function _flushBatchUIRefresh() {
  if (!_batchRefreshPending) return;
  _batchRefreshPending = false;
  if (_batchRefreshSafetyId !== null) { clearTimeout(_batchRefreshSafetyId); _batchRefreshSafetyId = null; }
  if (typeof render === 'function') render();
  if (typeof renderFolders === 'function') renderFolders();
  if (typeof _updateStoragePill === 'function') _updateStoragePill();
}

function _scheduleBatchUIRefresh() {
  if (typeof save === 'function') save();
  if (_batchRefreshPending) return;
  _batchRefreshPending = true;
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_flushBatchUIRefresh);
  else { _flushBatchUIRefresh(); return; }
  // Safety net: rAF callbacks are silently dropped/delayed by the browser
  // while the page is backgrounded — which is exactly what happens for a
  // moment when the native "choose files/folder" picker opens on top of
  // the WebView. When that happened, the rAF above never fired, so
  // `_batchRefreshPending` stayed stuck `true` forever and every uploaded
  // file after that point silently stopped refreshing the grid — the app
  // only looked right again after a full reload (reopening the page),
  // which is why this bug kept resurfacing. A plain setTimeout keeps
  // running even while hidden, so it guarantees the flush still happens.
  _batchRefreshSafetyId = setTimeout(_flushBatchUIRefresh, 250);
}

/* Extra belt-and-suspenders: the instant the app becomes visible again
   (returning from the file picker, task switcher, etc.), force through
   any refresh that might still be pending so nothing is ever left
   waiting on a background timer. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _flushBatchUIRefresh();
});

/* Step 1 — DIGEST: take in the whole selection and give every file its
   retrieval identity before any encryption starts. */
const _RID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — easy to read back
function _shortCode(len) {
  const a = new Uint8Array(len);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.from(a, n => _RID_CHARS[n % _RID_CHARS.length]).join('');
}
function _newRetrievalCode() {
  const used = new Set((photos || []).concat(trashedPhotos || []).map(p => p.rid));
  let rid;
  do { rid = 'HP-' + _shortCode(6); } while (used.has(rid));
  return rid;
}
function _digestBatch(files) {
  const batch = 'B' + _shortCode(5);
  return files.map((file, i) => ({
    file, batch, seq: i + 1, total: files.length,
    id: newPhotoId(), rid: _newRetrievalCode(),
  }));
}

async function _encryptAndSaveBatch({ files, folderId, pendingType }) {
  // Step 1 — digest the whole batch first
  const entries = _digestBatch(files);
  showToast(`⏳ Adding ${entries.length} file${entries.length !== 1 ? 's' : ''}…`);

  // Step 2 — encrypt one by one
  let added = 0, failed = 0;
  for (const en of entries) {
    try {
      if (!window._tgPushBusyUI) _setActivityStatus(`Encrypting ${en.seq}/${en.total}…`, 'fa-lock');
      const encBlob = await encryptBlob(en.file, sessionPin);
      await idbPut(en.id, encBlob);
      _vcSeedFromPlain(en.id, en.file, _getMediaType(en.file)).catch(() => {});  // thumb + preview, in background
      const photo = {
        id: en.id,
        rid: en.rid,            // retrieval code
        batch: en.batch,        // which selection it arrived with
        doneAt: Date.now(),     // encryption finished
        name: en.file.name,
        size: en.file.size,
        addedAt: Date.now(),
        storage: 'idb',
        encId: en.id,
        encrypted: true,
        mediaType: _getMediaType(en.file),
      };
      if (folderId) photo.folder = folderId;
      if (pendingType === 'favourites') photo.fav = true;
      photos.push(photo);
      _addToPendingQueue(photo);
      added++;
      // Refresh as soon as THIS file lands, so a 20-30 file batch shows up
      // progressively instead of only after the last file finishes.
      _scheduleBatchUIRefresh();
    } catch (err) {
      console.warn('Encrypt failed for', en.file.name, err);
      failed++;
    }
  }

  // Final, unconditional refresh — guarantees the very last file (whose
  // rAF-scheduled refresh may not have fired yet) is always shown, and
  // covers the all-failed case too.
  if (typeof save === 'function') save();
  if (typeof render === 'function') render();
  if (typeof renderFolders === 'function') renderFolders();
  if (typeof _updateStoragePill === 'function') _updateStoragePill();

  // Step 3 — files now wait locally until Upload is tapped
  _updateCloudBar(true);
  if (added > 0) {
    const cloudNote = isPcloudEnabled() ? ' — tap Upload to send to pCloud' : '';
    showToast(`Added ${added} file${added !== 1 ? 's' : ''}${cloudNote}${failed ? `, ${failed} failed` : ''}`, 'success');
  } else if (failed > 0) {
    showToast(`❌ Failed to add ${failed} file${failed !== 1 ? 's' : ''}`);
  }
}


function _captureVideoFrame(videoUrl) { return Promise.resolve(null); }


function _applyCachedThumb(cached, shimmer, card) {
  const { mediaType } = cached;
  const isVideo = mediaType === 'video';
  // Placeholder stays put until the real media has actually faded in —
  // removing it early exposes the card's bare dark background for a beat.
  const clearPlaceholder = () => {
    if (!shimmer) return;
    shimmer.style.display = 'none';
    if (shimmer.parentNode) shimmer.remove();
  };
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
    thumb.onseeked = () => { thumb.style.opacity = '1'; clearPlaceholder(); };
    thumb.oncanplay = () => { thumb.style.opacity = '1'; clearPlaceholder(); };
    setTimeout(() => { thumb.style.opacity = '1'; clearPlaceholder(); }, 1500);
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
    img.onload = () => { img.style.opacity = '1'; clearPlaceholder(); };
    img.onerror = () => clearPlaceholder();
    card.appendChild(img);
  }
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

  // Fill a slide: local preview first (instant), full-resolution swaps in behind it.
  const fillSlide = (idx) => _vcFillSlide(idx, idx === startIndex, true);

  // Decrypt current slide first — show it as fast as possible
  await fillSlide(startIndex);
  decEl.style.display = 'none';
  _lbUpdateUI();  // populate top bar with filename, fav state, etc.

  // Warm the neighbours (previews are local → swiping never waits)
  _prefetchAdjacentSlides(startIndex).catch(() => {});
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


/* ── Lightbox swipe: smooth, 1:1 finger-tracking horizontal swipe between
   slides (images/videos/gifs/webps alike), with elastic resistance at the
   first/last item and a commit-distance/fling threshold — the same feel
   as the homepage's page-track swipe further up this file. Bound once to
   #sliderViewport; sliderList/sIndex/track are read live on every drag so
   this keeps working across repeated openLightbox() calls. ── */
(function () {
  const LB_COMMIT_RATIO = 0.28;   // fraction of viewport width to commit a swipe
  const LB_FLING_SPEED  = 0.5;    // px/ms — a fast flick commits regardless of distance
  const LB_EDGE_RESIST  = 0.35;   // rubber-band damping past the first/last slide

  let dragging = false, isHorizontal = null, onVideoControls = false;
  let startX = 0, startY = 0, lastX = 0, lastT = 0, velocity = 0, pendingDx = 0, rafId = null;

  function viewportEl() { return document.getElementById('sliderViewport'); }
  function trackEl()    { return document.getElementById('sliderTrack'); }

  function applyDragFrame() {
    rafId = null;
    const vp = viewportEl(), track = trackEl();
    if (!vp || !track) return;
    const w = vp.offsetWidth || window.innerWidth || 1;
    let dx = pendingDx;
    if (sIndex <= 0 && dx > 0) dx *= LB_EDGE_RESIST;
    if (sIndex >= sliderList.length - 1 && dx < 0) dx *= LB_EDGE_RESIST;
    track.style.transform = `translateX(${(-sIndex * w) + dx}px)`;
  }

  function onStart(e) {
    const lb = document.getElementById('lightbox');
    if (!lb || !lb.classList.contains('open')) return;
    if (e.touches.length !== 1) return;
    // A drag that starts on a video's native control strip (scrubber,
    // play/pause, volume — rendered by the browser along the bottom edge)
    // should scrub the video, not swipe the lightbox. The rest of the
    // video (the actual picture) still swipes like every other slide.
    onVideoControls = false;
    const vid = e.target.closest('video');
    if (vid) {
      const vr = vid.getBoundingClientRect();
      const yInVideo = e.touches[0].clientY - vr.top;
      onVideoControls = yInVideo > vr.height - 44; // native control strip height
    }
    if (onVideoControls) return;
    startX = lastX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    lastT = Date.now();
    velocity = 0; pendingDx = 0; dragging = true; isHorizontal = null;
    const track = trackEl();
    if (track) track.classList.add('no-transition');
  }

  function onMove(e) {
    if (!dragging || onVideoControls) return;
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    const dx = x - startX, dy = y - startY;
    if (isHorizontal === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      isHorizontal = Math.abs(dx) > Math.abs(dy);
      if (!isHorizontal) { dragging = false; settle(); return; } // hand off to e.g. native video controls / vertical gestures
    }
    if (!isHorizontal) return;
    if (e.cancelable) e.preventDefault();
    const now = Date.now();
    const dt = Math.max(1, now - lastT);
    velocity = (x - lastX) / dt;
    lastX = x; lastT = now;
    pendingDx = dx;
    if (rafId === null) rafId = requestAnimationFrame(applyDragFrame);
  }

  function settle() {
    const track = trackEl();
    if (track) track.classList.remove('no-transition');
  }

  function onEnd(e) {
    if (!dragging) return;
    dragging = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    settle();
    if (!isHorizontal) return;
    const touch = (e.changedTouches && e.changedTouches[0]) || null;
    const dx = (touch ? touch.clientX : lastX) - startX;
    const vp = viewportEl();
    const w = (vp && vp.offsetWidth) || window.innerWidth || 1;
    const ratio = dx / w;
    const flinging = Math.abs(velocity) > LB_FLING_SPEED;

    if ((ratio < -LB_COMMIT_RATIO || (flinging && dx < 0)) && sIndex < sliderList.length - 1) {
      slideNav(1);
    } else if ((ratio > LB_COMMIT_RATIO || (flinging && dx > 0)) && sIndex > 0) {
      slideNav(-1);
    } else {
      _setSlide(sIndex, true); // didn't clear the commit threshold — snap back
    }
  }

  function onCancel() {
    if (!dragging) return;
    dragging = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    settle();
    _setSlide(sIndex, true);
  }

  function bind() {
    const vp = viewportEl();
    if (!vp || vp.dataset.lbSwipeBound) return;
    vp.dataset.lbSwipeBound = '1';
    vp.addEventListener('touchstart', onStart, { passive: true });
    vp.addEventListener('touchmove', onMove, { passive: false });
    vp.addEventListener('touchend', onEnd, { passive: true });
    vp.addEventListener('touchcancel', onCancel, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();


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
      if (p.storage === 'idb') _removeFromPendingQueue(p.id);
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
    if (p.storage === 'cloud') encBlob = await fetchCloudBlob(p);
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
      ${_infoRow('💾','Storage', p.storage==='cloud'?'☁️ Cloud (pCloud)':p.storage==='idb'?'📱 Local (IndexedDB)':'Local')}
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
    if (p.storage === 'cloud') encBlob = await fetchCloudBlob(p);
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


function openMoveModal() {
  const modal = document.getElementById('moveModal');
  const list  = document.getElementById('folderList');
  const back  = document.getElementById('movePicker_back');
  const subtitle = document.getElementById('movePicker_subtitle');
  if (!modal || !list) return;
  if (back) back.style.display = 'none';

  const allFolders = (typeof folders !== 'undefined') ? folders : [];
  const count = (typeof selected !== 'undefined' && selected.size > 0) ? selected.size : (contextTarget ? 1 : 0);
  if (subtitle) subtitle.textContent = count + (count === 1 ? ' item selected' : ' items selected');

  list.innerHTML = '';
  const rowBase = 'display:flex;align-items:center;gap:12px;padding:13px 16px;cursor:pointer;font-size:14px;font-weight:700;color:white;transition:background 0.12s;-webkit-tap-highlight-color:transparent;';

  const homeRow = document.createElement('div');
  homeRow.style.cssText = rowBase + 'border-bottom:1px solid rgba(255,255,255,0.07);';
  homeRow.innerHTML = '<i class="fas fa-home" style="width:18px;text-align:center;color:rgba(255,255,255,0.5);"></i>All Photos (no folder)';
  homeRow.onmouseenter = () => homeRow.style.background = 'rgba(255,255,255,0.07)';
  homeRow.onmouseleave = () => homeRow.style.background = '';
  homeRow.onclick = () => confirmMove('home', 'All Photos');
  list.appendChild(homeRow);

  const topFolders = allFolders.filter(f => !f.parentId);
  topFolders.forEach(f => {
    const row = document.createElement('div');
    row.style.cssText = rowBase;
    row.innerHTML = `<i class="fas fa-folder" style="width:18px;text-align:center;color:rgba(255,255,255,0.5);"></i>${escapeHtml(f.name)}`;
    row.onmouseenter = () => row.style.background = 'rgba(255,255,255,0.07)';
    row.onmouseleave = () => row.style.background = '';
    row.onclick = () => confirmMove(f.id, f.name);
    list.appendChild(row);

    allFolders.filter(sf => sf.parentId === f.id).forEach(sf => {
      const srow = document.createElement('div');
      srow.style.cssText = rowBase + 'padding-left:38px;font-size:13px;color:rgba(255,255,255,0.8);';
      srow.innerHTML = `<i class="fas fa-folder" style="width:16px;text-align:center;color:rgba(255,255,255,0.35);font-size:12px;"></i>${escapeHtml(sf.name)}`;
      srow.onmouseenter = () => srow.style.background = 'rgba(255,255,255,0.07)';
      srow.onmouseleave = () => srow.style.background = '';
      srow.onclick = () => confirmMove(sf.id, sf.name);
      list.appendChild(srow);
    });
  });

  if (topFolders.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:24px 16px;text-align:center;color:rgba(255,255,255,0.35);font-size:13px;font-weight:700;';
    empty.textContent = 'No folders yet';
    list.appendChild(empty);
  }

  modal.classList.add('open');
}


function movePicker_goBack() { /* flat folder list — nothing to navigate back from */ }


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

/* ── Wire the ported engine into the existing unlock flow ──
   (unlockVault already exists above; we wrap it rather than edit it,
   matching the render()-hooking pattern from the source file) */

const _origUnlockVault = unlockVault;
unlockVault = function(...args) {
  _origUnlockVault.apply(this, args);
  load();
  _initStoragePersistence();
  startCloudPolling();
  if (typeof render === 'function') render();
  if (typeof renderFolders === 'function') renderFolders();
};


/* ════════════════════════════════════════════════════════════════════════
     SECTION 6 — VAULT CACHE (thumbnails, previews, library index)

     Every file is stored in pCloud as THREE encrypted pieces:
        original   hope_<id>_<rid>_<name>.enc   (the real file)
        thumbnail  hope_<id>_th.enc             (~400px JPEG, tens of KB)
        preview    hope_<id>_pv.enc             (~1280px JPEG, ~150 KB)
     and hope_manifest.json lists them all (ids, folders, thumb/preview ids).
     The device keeps a cache of the small pieces + the library index in
     IndexedDB, so after the first sync the gallery paints from disk, and a
     wiped/reinstalled APK simply rebuilds the cache from pCloud.
     ════════════════════════════════════════════════════════════════════════ */

const _VC = {
  THUMB_PX: 400,                    // longest side of the grid thumbnail
  PREVIEW_PX: 1280,                 // longest side of the instant-open preview
  ORIG_MAX: 500 * 1024 * 1024,      // cap for recently opened originals kept on device
  ORIG_ITEM_MAX: 150 * 1024 * 1024, // bigger files (long videos) are not cached
};
let _vcReady = false;
window._vcIndexSavedAt = window._vcIndexSavedAt || 0;

/* ── tiny IndexedDB layer (separate DB, so the old blob DB is untouched) ── */
let _vcDbP = null;
function _vcDb() {
  if (_vcDbP) return _vcDbP;
  _vcDbP = new Promise((res, rej) => {
    const rq = indexedDB.open('pixelvault_cache', 1);
    rq.onupgradeneeded = () => { ['thumb', 'orig', 'origmeta', 'index'].forEach(n => rq.result.createObjectStore(n)); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => { _vcDbP = null; rej(rq.error || new Error('vc db open failed')); };
  });
  return _vcDbP;
}
function _vcTx(store, mode, fn) {
  return _vcDb().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    let out;
    try { out = fn(tx.objectStore(store)); } catch (e) { rej(e); return; }
    tx.oncomplete = () => res(out && typeof out === 'object' && 'result' in out ? out.result : out);
    tx.onerror = tx.onabort = () => rej(tx.error || new Error('vc tx failed'));
  }));
}
const _vcDbGet = (store, key) => _vcTx(store, 'readonly', st => st.get(key));
const _vcDbPut = (store, key, val) => _vcTx(store, 'readwrite', st => st.put(val, key));
const _vcDbDel = (store, key) => _vcTx(store, 'readwrite', st => st.delete(key));

/* read-modify-write in ONE transaction so parallel thumb/preview writes can't clobber each other */
function _vcMergeRec(id, patch) {
  return _vcDb().then(db => new Promise((res, rej) => {
    const tx = db.transaction('thumb', 'readwrite');
    const st = tx.objectStore('thumb');
    let next;
    const g = st.get(id);
    g.onsuccess = () => { next = Object.assign({}, g.result || {}, patch); st.put(next, id); };
    tx.oncomplete = () => res(next);
    tx.onerror = tx.onabort = () => rej(tx.error || new Error('vc merge failed'));
  }));
}

/* ── small concurrency limiter ── */
function _vcLimiter(n) {
  let active = 0; const q = [];
  const next = () => { active--; const f = q.shift(); if (f) f(); };
  return fn => new Promise((res, rej) => {
    const go = () => {
      if (active < n) { active++; Promise.resolve().then(fn).then(res, rej).finally(next); }
      else q.push(go);
    };
    go();
  });
}
const _vcDl  = _vcLimiter(3);   // full-file download + decrypt (memory heavy)
const _vcCpu = _vcLimiter(2);   // thumbnail generation
const _vcNet = _vcLimiter(6);   // small thumbnail / preview downloads

function _vcKind(p) { return (_getMediaType(p) === 'video' || p.mediaType === 'video') ? 'video' : 'image'; }

/* ── thumbnail + preview generation (runs on the device — pCloud only ever sees ciphertext) ── */
function _vcCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function _vcDraw(src, sw, sh, maxSide) {
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const cv = _vcCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h);   // transparent PNG/GIF → dark, not black-hole
  ctx.drawImage(src, 0, 0, w, h);
  return cv;
}
function _vcToJpeg(cv, q) {
  if (cv.convertToBlob) return cv.convertToBlob({ type: 'image/jpeg', quality: q });
  return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', q));
}
async function _vcDerivFromSource(src, sw, sh) {
  const big = _vcDraw(src, sw, sh, _VC.PREVIEW_PX);
  const preview = await _vcToJpeg(big, 0.8);
  const thumb = await _vcToJpeg(_vcDraw(big, big.width, big.height, _VC.THUMB_PX), 0.72);
  return { thumb, preview };
}
async function _vcDerivImage(blob) {
  const bmp = await createImageBitmap(blob);
  try { return await _vcDerivFromSource(bmp, bmp.width, bmp.height); }
  finally { if (bmp.close) bmp.close(); }
}
function _vcDerivVideo(blob) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('playsinline', '');
    let done = false, timer = null;
    const finish = r => {
      if (done) return; done = true; clearTimeout(timer);
      try { v.removeAttribute('src'); v.load(); } catch (e) {}
      URL.revokeObjectURL(url); resolve(r);
    };
    timer = setTimeout(() => finish(null), 12000);
    v.onerror = () => finish(null);
    v.onloadeddata = () => {
      try { v.currentTime = Math.min(1, (v.duration || 1) * 0.1); } catch (e) { finish(null); }
    };
    v.onseeked = async () => {
      try {
        if (!v.videoWidth) return finish(null);
        finish(await _vcDerivFromSource(v, v.videoWidth, v.videoHeight));
      } catch (e) { finish(null); }
    };
    v.src = url;
  });
}

/* plain file → encrypted thumb+preview stored on the device */
async function _vcSeedFromPlain(id, plain, kind) {
  const d = await _vcCpu(() => kind === 'video' ? _vcDerivVideo(plain) : _vcDerivImage(plain)).catch(() => null);
  if (!d) return null;
  const t = await encryptBlob(d.thumb, sessionPin);
  const p = await encryptBlob(d.preview, sessionPin);
  return _vcMergeRec(id, { t, p });
}

/* ── pCloud side: upload / download the small encrypted pieces ── */
async function _vcUploadRetry(blob, name) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try { return await _pcUploadFile(blob, name); }
    catch (e) { last = e; if (i < 3) await new Promise(r => setTimeout(r, 1200 * i)); }
  }
  throw last || new Error('upload failed');
}
async function _vcPutDerivs(p, rec) {
  if (!p.thId) p.thId = await _vcUploadRetry(rec.t, 'hope_' + p.id + '_th.enc');
  if (!p.pvId) p.pvId = await _vcUploadRetry(rec.p, 'hope_' + p.id + '_pv.enc');
}
/* called by the Upload button flow, right after the original is in pCloud */
async function _vcUploadDerivs(p, encOriginal) {
  let rec = await _vcDbGet('thumb', p.id).catch(() => null);
  if (!rec || !rec.t || !rec.p) {
    const plain = await decryptBlob(encOriginal, sessionPin);
    rec = await _vcSeedFromPlain(p.id, plain, _vcKind(p));
  }
  if (rec && rec.t && rec.p) await _vcPutDerivs(p, rec);
}
async function _vcFetchDeriv(fileId) {
  let r = await fetch(await _pcGetFileLink(fileId), { cache: 'no-store' });
  if (!r.ok) { _vcLinkForget(fileId); r = await fetch(await _pcGetFileLink(fileId), { cache: 'no-store' }); }
  if (!r.ok) throw new Error('pCloud ' + r.status);
  const buf = await r.arrayBuffer();
  if (!buf.byteLength) throw new Error('empty thumbnail');
  return new Blob([buf], { type: 'application/octet-stream' });
}

/* Files uploaded before this feature (or whose thumb upload failed) get their
   thumbnail/preview uploaded later, once they exist on this device. */
let _vcRepairing = false, _vcRepairTimer = null;
function _vcQueueRepair() { clearTimeout(_vcRepairTimer); _vcRepairTimer = setTimeout(_vcRepairCloudDerivs, 4000); }
async function _vcRepairCloudDerivs() {
  if (_vcRepairing || !isPcloudEnabled()) return;
  _vcRepairing = true;
  let changed = 0;
  try {
    for (const p of photos.slice()) {
      if (p.storage !== 'cloud' || (p.thId && p.pvId)) continue;
      if (_cloudUploadBusy || _tgPushBusy) break;
      const rec = await _vcDbGet('thumb', p.id).catch(() => null);
      if (!rec || !rec.t || !rec.p) continue;
      try { await _vcPutDerivs(p, rec); changed++; } catch (e) { break; }
    }
  } finally { _vcRepairing = false; }
  if (changed) save();   // writes the new ids into the manifest (debounced sync)
}

/* Background: pull every missing thumbnail into the device cache (fresh install / new device). */
let _vcWarming = false;
async function _vcWarmThumbs() {
  if (_vcWarming || !isPcloudEnabled()) return;
  if (navigator.connection && navigator.connection.saveData) return;
  _vcWarming = true;
  try {
    const have = new Set(await _vcTx('thumb', 'readonly', st => st.getAllKeys()));
    const todo = photos.filter(p => p.storage === 'cloud' && p.thId && !(have.has(p.id)));
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const p = todo[i++];
        try { const blob = await _vcNet(() => _vcFetchDeriv(p.thId)); await _vcMergeRec(p.id, { t: blob }); } catch (e) {}
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  } catch (e) { /* offline etc. — thumbnails still load lazily */ }
  finally { _vcWarming = false; }
  _vcQueueRepair();
}

/* ── build thumbnail from the original (only when neither device nor cloud has one) ── */
const _vcBuilding = new Map();
async function _vcEncOriginal(p, noCache) {
  if (p.storage === 'idb' && p.encId) return idbGet(p.encId);
  if (p.storage === 'local' && p.encData) return base64ToBlob(p.encData);
  if (p.storage === 'cloud') return fetchCloudBlob(p, noCache);
  return null;
}
function _vcBuildOnce(p) {
  if (_vcBuilding.has(p.id)) return _vcBuilding.get(p.id);
  const job = (async () => {
    const plain = await _vcDl(async () => {
      const enc = await _vcEncOriginal(p, true);
      return enc ? decryptBlob(enc, sessionPin) : null;
    });
    if (!plain) return null;
    const rec = await _vcSeedFromPlain(p.id, plain, _vcKind(p));
    if (rec && p.storage === 'cloud' && !(p.thId && p.pvId)) _vcQueueRepair();
    return rec;
  })().finally(() => _vcBuilding.delete(p.id));
  _vcBuilding.set(p.id, job);
  return job;
}

/* ── thumbnail / preview → blob URL (memory → device → pCloud → build) ── */
const _vcMaps = { t: new Map(), p: new Map() };
const _vcCaps = { t: 3000, p: 40 };
const _vcInflight = new Map();
function _vcUrl(kind, p, allowBuild) {
  const map = _vcMaps[kind];
  const hit = map.get(p.id);
  if (hit) { map.delete(p.id); map.set(p.id, hit); return Promise.resolve(hit); }
  const key = kind + (allowBuild ? '+' : '-') + p.id;
  if (_vcInflight.has(key)) return _vcInflight.get(key);
  const job = (async () => {
    let rec = await _vcDbGet('thumb', p.id).catch(() => null);
    if (!(rec && rec[kind])) {
      const cid = kind === 't' ? p.thId : p.pvId;
      if (cid && isPcloudEnabled()) {
        try {
          const blob = await _vcNet(() => _vcFetchDeriv(cid));
          rec = await _vcMergeRec(p.id, { [kind]: blob });
        } catch (e) { /* offline / not found — fall through */ }
      }
    }
    if (!(rec && rec[kind]) && allowBuild) rec = await _vcBuildOnce(p);
    if (!(rec && rec[kind])) return null;
    const url = URL.createObjectURL(await decryptBlob(rec[kind], sessionPin));
    map.set(p.id, url);
    while (map.size > _vcCaps[kind]) {
      const k = map.keys().next().value, u = map.get(k);
      map.delete(k); setTimeout(() => URL.revokeObjectURL(u), 120000);
    }
    return url;
  })().finally(() => _vcInflight.delete(key));
  _vcInflight.set(key, job);
  return job;
}

/* paint a thumbnail into a grid card. Resolves false when no thumbnail could be made (caller falls back). */
async function _vcPaint(card, p, o) {
  const url = await _vcUrl('t', p, true);
  if (!url) return false;
  if (!card.isConnected) return true;
  const clear = () => {
    if (o.shimmer && o.shimmer.parentNode) o.shimmer.remove();
    if (o.lock && o.lock.parentNode) o.lock.remove();
  };
  const img = document.createElement('img');
  img.alt = ''; img.draggable = false; img.decoding = 'async';
  img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.2s;pointer-events:none;' + (o.z ? 'z-index:' + o.z + ';' : '');
  img.onload = () => { img.style.opacity = '1'; clear(); };
  img.onerror = () => { clear(); };
  img.src = url;
  if (o.first) card.insertBefore(img, card.firstChild); else card.appendChild(img);
  if (_vcKind(p) === 'video' && o.badge) {
    const b = o.badge, play = document.createElement('div');
    play.textContent = '\u25B6';
    play.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.55);color:white;font-size:' + Math.round(b * 0.45) + 'px;border-radius:50%;width:' + b + 'px;height:' + b + 'px;display:flex;align-items:center;justify-content:center;z-index:5;pointer-events:none;';
    card.appendChild(play);
  }
  return true;
}

/* folder page + collection page tiles now use the cache; the old full-download code stays as fallback (HEIC etc.) */
async function _fdpLoadCardThumb(card, p, shimmer, lock) {
  if (!card || !document.contains(card) || card._fdpDone) return;
  card._fdpDone = true;
  let ok = false;
  try { ok = await _vcPaint(card, p, { shimmer, lock, first: true, badge: 32 }); } catch (e) {}
  if (!ok && card.isConnected) { card._fdpDone = false; return _legacyFdpLoadCardThumb(card, p, shimmer, lock); }
}
async function _cpDecryptThumb(p, shimmer, lock, card) {
  if (!card || !document.contains(card) || card._cpDone) return;
  card._cpDone = true;
  let ok = false;
  try { ok = await _vcPaint(card, p, { shimmer, lock, first: true, badge: 32 }); } catch (e) {}
  if (!ok && card.isConnected) { card._cpDone = false; return _legacyCpDecryptThumb(p, shimmer, lock, card); }
}

/* ── lightbox: local preview first, full quality swaps in behind it ── */
async function _vcFillSlide(idx, autoplay, wantFull) {
  const p = sliderList[idx];
  const slide = document.getElementById('slide-' + idx);
  if (!p || !slide) return;
  const isVideo = _vcKind(p) === 'video';
  let showedQuick = !!slide.dataset.quickOk;

  if (!slide.dataset.quick) {
    slide.dataset.quick = '1';
    let q = null;
    try { q = await _vcUrl(isVideo ? 't' : 'p', p, false); } catch (e) {}
    if (q && slide.isConnected && !slide.dataset.fullDone) {
      const img = document.createElement('img');
      img.src = q; img.draggable = false;
      slide.innerHTML = ''; slide.appendChild(img);
      slide.dataset.quickOk = '1'; slide._vcQ = q; showedQuick = true;
    }
  }
  if (!wantFull || slide.dataset.full) return;
  slide.dataset.full = '1';

  const upgrade = (async () => {
    try {
      const url = await decryptOne(p);
      if (!slide.isConnected) return;
      let node;
      if (isVideo) {
        node = document.createElement('video');
        node.src = url; node.controls = true; node.playsInline = true;
        if (slide._vcQ) node.poster = slide._vcQ;
        if (autoplay) node.autoplay = true;
        node.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;';
      } else {
        node = document.createElement('img');
        node.src = url; node.draggable = false;
        try { await node.decode(); } catch (e) {}
      }
      if (!slide.isConnected) return;
      slide.innerHTML = ''; slide.appendChild(node);
      slide.dataset.fullDone = '1';
    } catch (e) {
      if (slide.isConnected && !slide.dataset.quickOk) slide.innerHTML = '<div style="color:#f87171;font-size:14px;">\u274C Failed to load</div>';
    }
  })();
  if (!showedQuick) await upgrade;   // nothing to show yet → keep the spinner until the full file is ready
}

function slideNav(dir) {
  const newIdx = Math.max(0, Math.min(sliderList.length - 1, sIndex + dir));
  if (newIdx === sIndex) return;
  sIndex = newIdx;
  _setSlide(sIndex, true);
  _vcFillSlide(sIndex, false, true).catch(() => {});
  _prefetchAdjacentSlides(sIndex).catch(() => {});
  _lbUpdateUI();
}

async function _prefetchAdjacentSlides(idx) {
  // Previews are small and cached → warm 3 slides each way; full quality only for the immediate neighbours.
  for (const d of [1, -1, 2, -2, 3, -3]) {
    const i = idx + d;
    if (i < 0 || i >= sliderList.length) continue;
    _vcFillSlide(i, false, Math.abs(d) === 1).catch(() => {});
  }
}

/* ── recently opened originals (encrypted) kept on the device, least-recently-used dropped first ── */
async function _vcOrigGet(id) {
  const rec = await _vcDbGet('orig', id);
  if (!rec || !rec.blob) return null;
  _vcDbPut('origmeta', id, { size: rec.size, used: Date.now() }).catch(() => {});
  return rec.blob;
}
async function _vcOrigPut(id, blob) {
  try {
    if (!blob || blob.size > _VC.ORIG_ITEM_MAX) return;
    await _vcDbPut('orig', id, { blob, size: blob.size });
    await _vcDbPut('origmeta', id, { size: blob.size, used: Date.now() });
    _vcOrigTrim();
  } catch (e) { /* quota — cache is optional */ }
}
let _vcTrimming = false;
async function _vcOrigTrim() {
  if (_vcTrimming) return;
  _vcTrimming = true;
  try {
    const keys = await _vcTx('origmeta', 'readonly', st => st.getAllKeys());
    const vals = await _vcTx('origmeta', 'readonly', st => st.getAll());
    const rows = keys.map((k, i) => ({ k, size: (vals[i] && vals[i].size) || 0, used: (vals[i] && vals[i].used) || 0 }));
    let total = rows.reduce((a, r) => a + r.size, 0);
    if (total <= _VC.ORIG_MAX) return;
    rows.sort((a, b) => a.used - b.used);
    for (const r of rows) {
      if (total <= _VC.ORIG_MAX * 0.85) break;
      await _vcDbDel('orig', r.k).catch(() => {});
      await _vcDbDel('origmeta', r.k).catch(() => {});
      total -= r.size;
    }
  } catch (e) {} finally { _vcTrimming = false; }
}

function _vcForget(id) {
  ['thumb', 'orig', 'origmeta'].forEach(s => _vcDbDel(s, id).catch(() => {}));
  _vcMaps.t.delete(id); _vcMaps.p.delete(id);
}

/* ── library index kept on the device: gallery paints instantly, even offline ── */
let _vcIdxTimer = null;
function _vcScheduleIndexSave() { clearTimeout(_vcIdxTimer); _vcIdxTimer = setTimeout(_vcSaveIndexNow, 800); }
async function _vcSaveIndexNow() {
  _vcIdxTimer = null;
  if (!_vcReady) return;   // never overwrite a good index before it has been loaded
  try {
    const list = (photos || [])
      .filter(p => p.storage === 'cloud' && p.pcFileId)
      .map(p => { const c = Object.assign({}, p); delete c.encData; delete c.encId; return c; });
    const savedAt = Date.now();
    await _vcDbPut('index', 'photos', { savedAt, list });
    window._vcIndexSavedAt = savedAt;
  } catch (e) {}
}
async function _vcLoadIndexIntoPhotos() {
  try {
    const rec = await _vcDbGet('index', 'photos');
    if (rec && Array.isArray(rec.list)) {
      window._vcIndexSavedAt = rec.savedAt || 0;
      const have = new Set(photos.map(p => p.id));
      let n = 0;
      for (const p of rec.list) { if (!have.has(p.id)) { photos.push(p); have.add(p.id); n++; } }
      if (n) {
        try { render(); } catch (e) {}
        try { if (typeof renderFolders === 'function') renderFolders(); } catch (e) {}
        try { _updateStoragePill(); } catch (e) {}
        try { updateCloudUI(); } catch (e) {}
      }
    }
  } finally { _vcReady = true; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && _vcIdxTimer) { clearTimeout(_vcIdxTimer); _vcSaveIndexNow(); }
});

/* ── find the manifest by NAME when this device has no pointer to it (cleared data / reinstall) ── */
async function _vcFindManifestId() {
  try {
    const r = await fetch(`https://${PCLOUD_HOST}/listfolder?access_token=${encodeURIComponent(PCLOUD_TOKEN)}&folderid=0`);
    const d = await r.json();
    if (d.result !== 0) return null;
    const items = ((d.metadata && d.metadata.contents) || []).filter(c => !c.isfolder && c.name === 'hope_manifest.json');
    items.sort((a, b) => Date.parse(b.modified || 0) - Date.parse(a.modified || 0));
    return items.length ? items[0].fileid : null;
  } catch (e) { return null; }
}


/* ════════════════════════════════════════════════════════════════════════
     SECTION 7 — RETRIEVE PAGE

     Pulls everything EXCEPT the main files from pCloud onto this device:
       • the library index (file ids, names, folders / subfolders, favourites)
       • every thumbnail
       • every preview
     Main files are never downloaded here — they stay in pCloud and are
     fetched (and decrypted) the moment you tap one.
     ════════════════════════════════════════════════════════════════════════ */

/* merge a manifest into the in-memory library (shared by auto-restore and the Retrieve page) */
function _vcMergeManifest(manifest) {
  if (Array.isArray(manifest.folders)) folders = manifest.folders;
  const cloudPhotos = manifest.photos.filter(p => p.storage === 'cloud' && p.pcFileId);
  const existingIds = new Set(photos.map(p => p.id));
  const localById = new Map(photos.map(p => [p.id, p]));
  let added = 0, removed = 0;
  for (const cp of cloudPhotos) {
    if (!existingIds.has(cp.id)) { photos.push(cp); existingIds.add(cp.id); added++; }
    else {
      const lp = localById.get(cp.id);   // keep the local record, but learn cloud thumb/preview ids
      if (lp && lp.storage === 'cloud') { if (!lp.thId && cp.thId) lp.thId = cp.thId; if (!lp.pvId && cp.pvId) lp.pvId = cp.pvId; }
    }
  }
  // Drop cached cloud entries deleted elsewhere — only when the manifest is at least as new as our
  // cached index, so a half-finished upload on this device is never mistaken for a deletion.
  const cloudIds = new Set(cloudPhotos.map(p => p.id));
  if ((manifest.updatedAt || 0) >= (window._vcIndexSavedAt || 0)) {
    const keep = photos.filter(p => p.storage !== 'cloud' || cloudIds.has(p.id));
    removed = photos.length - keep.length;
    if (removed) photos = keep;
  }
  if (added > 0 || removed > 0) {
    try { render(); } catch (e) {}
    try { renderFolders(); } catch (e) {}
    try { updateCloudUI(); } catch (e) {}
  }
  return { added, removed, total: cloudPhotos.length };
}

/* which thumbnails / previews are already saved on this device */
async function _vcLocalState() {
  const hasT = new Set(), hasP = new Set();
  const db = await _vcDb();
  await new Promise((res, rej) => {
    const rq = db.transaction('thumb', 'readonly').objectStore('thumb').openCursor();
    rq.onsuccess = () => {
      const c = rq.result;
      if (!c) return res();
      if (c.value && c.value.t) hasT.add(c.key);
      if (c.value && c.value.p) hasP.add(c.key);
      c.continue();
    };
    rq.onerror = () => rej(rq.error);
  });
  return { hasT, hasP };
}

let _rtRunning = false, _rtStop = false;
const _rtEl = id => document.getElementById(id);

function openRetrieveModal() {
  const m = _rtEl('retrieveModal');
  if (!m) return;
  m.classList.add('open');
  retrieveRefreshStats();
}
function closeRetrieveModal() {
  const m = _rtEl('retrieveModal');
  if (!m || !m.classList.contains('open') || m.classList.contains('closing')) return;
  m.classList.add('closing');
  setTimeout(() => { m.classList.remove('open', 'closing'); }, 280);
}

async function retrieveRefreshStats() {
  const set = (id, v) => { const e = _rtEl(id); if (e) e.textContent = v; };
  const note = _rtEl('rtNote');
  const connected = isPcloudEnabled();
  if (note) note.style.display = connected ? 'none' : 'block';
  try {
    const cloud = photos.filter(p => p.storage === 'cloud');
    const { hasT, hasP } = await _vcLocalState();
    set('rtStatFiles', String(cloud.length));
    set('rtStatThumbs', cloud.filter(p => hasT.has(p.id)).length + ' / ' + cloud.filter(p => p.thId).length);
    set('rtStatPrev', cloud.filter(p => hasP.has(p.id)).length + ' / ' + cloud.filter(p => p.pvId).length);
    const missing = cloud.filter(p => !p.thId || !p.pvId).length;
    const mEl = _rtEl('rtStatMissing');
    if (mEl) {
      mEl.style.display = missing ? 'block' : 'none';
      mEl.textContent = missing + ' file' + (missing !== 1 ? 's have' : ' has') + ' no thumbnail in pCloud yet — created and uploaded automatically the first time they are shown.';
    }
    const last = parseInt(localStorage.getItem('pv_last_retrieve') || '0', 10);
    set('rtLast', last ? 'Last retrieved: ' + new Date(last).toLocaleString() : 'Not retrieved on this device yet');
  } catch (e) { /* stats are cosmetic */ }
}

function retrieveStop() { _rtStop = true; const b = _rtEl('rtStopBtn'); if (b) { b.disabled = true; b.textContent = 'Stopping…'; } }

async function retrieveRun() {
  if (_rtRunning) return;
  if (!isPcloudEnabled()) { showToast('⚠️ Connect pCloud first!'); closeRetrieveModal(); openCloudModal(); return; }
  if (!sessionPin) { showToast('🔒 Unlock first'); return; }
  if (_cloudUploadBusy || _tgPushBusy) { showToast('⏳ Upload in progress — try again when it finishes'); return; }

  _rtRunning = true; _rtStop = false;
  const runBtn = _rtEl('rtRunBtn'), stopBtn = _rtEl('rtStopBtn'), box = _rtEl('rtBox');
  const bar = _rtEl('rtBar'), title = _rtEl('rtTitle'), status = _rtEl('rtStatus'), icon = _rtEl('rtIcon');
  const ui = (t, s, pct) => { if (title) title.textContent = t; if (status) status.textContent = s || ''; if (bar && pct != null) bar.style.width = pct + '%'; };
  if (runBtn) { runBtn.disabled = true; runBtn.style.opacity = '0.55'; }
  if (stopBtn) { stopBtn.style.display = 'block'; stopBtn.disabled = false; stopBtn.textContent = 'Stop'; }
  if (box) box.style.display = 'block';
  if (icon) icon.className = 'fas fa-rotate';
  ui('Reading library…', 'Fetching the file list from pCloud', 2);

  await _acquireCloudDirection('retrieve', 4000);
  let nT = 0, nP = 0, failed = 0, merged = null;
  try {
    // 1 ── library index: ids, names, folders, subfolders
    const manifest = await _tgLoadManifest();
    if (!manifest || !Array.isArray(manifest.photos)) throw new Error('The pCloud library index is empty or unreadable.');
    merged = _vcMergeManifest(manifest);
    _saveLocalOnly();
    ui('Library restored', merged.total + ' file' + (merged.total !== 1 ? 's' : '') + ' found', 8);

    // 2 ── work out what this device is missing
    const cloud = photos.filter(p => p.storage === 'cloud');
    const { hasT, hasP } = await _vcLocalState();
    const jobs = [];
    for (const p of cloud) {
      if (p.thId && !hasT.has(p.id)) jobs.push({ p, kind: 't', fid: p.thId });
    }
    for (const p of cloud) {
      if (p.pvId && !hasP.has(p.id)) jobs.push({ p, kind: 'p', fid: p.pvId });
    }

    // 3 ── thumbnails first (so the grid fills quickly), then previews
    let done = 0, idx = 0;
    const worker = async () => {
      while (!_rtStop && idx < jobs.length) {
        const j = jobs[idx++];
        try {
          const blob = await _vcNet(() => _vcFetchDeriv(j.fid));
          await _vcMergeRec(j.p.id, { [j.kind]: blob });
          if (j.kind === 't') nT++; else nP++;
        } catch (e) { failed++; }
        done++;
        ui('Saving thumbnails & previews…', done + ' of ' + jobs.length + (failed ? ' · ' + failed + ' failed' : ''), 8 + Math.round(92 * done / Math.max(1, jobs.length)));
      }
    };
    if (jobs.length) await Promise.all([worker(), worker(), worker(), worker()]);

    try { localStorage.setItem('pv_last_retrieve', String(Date.now())); } catch (e) {}
    if (icon) icon.className = 'fas fa-circle-check';
    const stopped = _rtStop;
    ui(stopped ? 'Stopped' : 'Retrieve complete',
       merged.total + ' files · ' + nT + ' thumbnails · ' + nP + ' previews saved' + (failed ? ' · ' + failed + ' failed' : '') + '. Main files stay in pCloud and open when tapped.',
       stopped ? null : 100);
    try { render(); } catch (e) {}
    if (!stopped && !failed) showToast('✅ Retrieved from pCloud');
  } catch (e) {
    if (icon) icon.className = 'fas fa-triangle-exclamation';
    ui('Retrieve failed', (e && e.message) || 'Could not reach pCloud.', null);
  } finally {
    _releaseCloudDirection('retrieve');
    _rtRunning = false; _rtStop = false;
    if (runBtn) { runBtn.disabled = false; runBtn.style.opacity = '1'; }
    if (stopBtn) stopBtn.style.display = 'none';
    retrieveRefreshStats();
  }
}
