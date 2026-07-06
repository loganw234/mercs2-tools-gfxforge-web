// -- autosave --------------------------------------------------------------
//
// Plain localStorage, with an in-memory fallback only for the rare case
// it's unavailable (private browsing in some browsers, quota exceeded, a
// sandboxed iframe) — detected once at startup rather than assumed, so it
// fails gracefully instead of throwing mid-edit.

const AUTOSAVE_KEY = 'gfxforge:autosave';
let storageBackend = 'memory'; // 'localStorage' | 'memory'
let memoryStore = new Map();
let autosaveTimer = null;

function detectStorageBackend() {
  try {
    const testKey = 'gfxforge:probe';
    localStorage.setItem(testKey, '1');
    const ok = localStorage.getItem(testKey) === '1';
    localStorage.removeItem(testKey);
    storageBackend = ok ? 'localStorage' : 'memory';
  } catch (e) {
    storageBackend = 'memory';
  }
}

function storageSet(key, value) {
  try {
    if (storageBackend === 'localStorage') { localStorage.setItem(key, value); return true; }
    memoryStore.set(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

function storageGet(key) {
  try {
    if (storageBackend === 'localStorage') return localStorage.getItem(key);
    return memoryStore.has(key) ? memoryStore.get(key) : null;
  } catch (e) {
    return null;
  }
}

function storageDelete(key) {
  try {
    if (storageBackend === 'localStorage') { localStorage.removeItem(key); return; }
    memoryStore.delete(key);
  } catch (e) { /* ignore */ }
}

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(doAutosave, 800);
}

function doAutosave() {
  try {
    storageSet(AUTOSAVE_KEY, JSON.stringify(serializeProject()));
    updateAutosaveIndicator();
  } catch (e) { /* autosave is best-effort; never interrupt editing over it */ }
}

function updateAutosaveIndicator() {
  const indicator = document.getElementById('autosaveIndicator');
  if (!indicator) return;
  if (storageBackend === 'memory') {
    indicator.textContent = 'Autosave: this session only';
    indicator.title = 'Persistent storage isn\'t available here (private browsing or a disabled setting), so this only protects against accidental navigation within the tab, not a refresh.';
  } else {
    indicator.textContent = 'Autosaved';
    indicator.title = 'Saved to this browser\'s local storage after every edit.';
  }
}

function checkForAutosaveOnStartup() {
  detectStorageBackend();
  updateAutosaveIndicator();
  const raw = storageGet(AUTOSAVE_KEY);
  if (!raw) return false;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { return false; }
  if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) return false;
  showRestoreBanner(parsed);
  return true;
}

function showRestoreBanner(parsed) {
  const stageName = (parsed.stage && parsed.stage.name) || 'untitled';
  const count = parsed.items.length;
  const banner = el('div', {
    style: 'position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:250;background:var(--panel);border:1px solid var(--amber);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;box-shadow:0 10px 30px -10px rgba(0,0,0,.6);',
  }, [
    el('span', { style: 'font-size:12px;', text: `Recovered unsaved work: "${stageName}" (${count} item${count === 1 ? '' : 's'}) from your last session.` }),
    el('button', {
      class: 'primary', text: 'Restore', style: 'padding:5px 10px;',
      onclick: () => {
        const ok = loadProjectJsonText(JSON.stringify(parsed), 'autosaved session');
        if (ok) banner.remove();
      },
    }),
    el('button', {
      class: 'ghost', text: 'Discard', style: 'padding:5px 10px;',
      onclick: () => {
        storageDelete(AUTOSAVE_KEY);
        banner.remove();
        loadProjectJsonText(JSON.stringify(SAMPLE_PROJECT), 'sample HUD');
      },
    }),
  ]);
  document.body.appendChild(banner);
}
