/* ============================================================
   store.js - persistencia local (IndexedDB)
   ------------------------------------------------------------
   O que fica gravado aqui:
     - "vault": o envelope JA CIFRADO (nada legivel)
     - "config": preferencias nao sensiveis (client ID do Drive,
       tempo de auto-bloqueio, id do arquivo no Drive, etc.)
   A senha-mestra e a chave derivada NUNCA entram aqui.
   ============================================================ */

const DB_NAME = 'cofre-senhas';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try {
      result = fn(store);
    } catch (e) {
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function kvGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const req = t.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvSet(key, value) {
  return tx('readwrite', (store) => {
    store.put(value, key);
  });
}

export async function kvDel(key) {
  return tx('readwrite', (store) => {
    store.delete(key);
  });
}

/* ---------- atalhos de dominio ---------- */

export const loadEnvelope = () => kvGet('vault');
export const saveEnvelope = (env) => kvSet('vault', env);
export const dropEnvelope = () => kvDel('vault');

const DEFAULT_CONFIG = {
  driveClientId: '',   // o usuario cola o dele nas Configuracoes
  driveFileId: '',     // id do cofre.enc no Drive, preenchido no 1o sync
  driveFolderId: '',   // pasta criada pelo app no Drive
  autoLockMinutes: 5,
  clipboardClearSeconds: 30,
  lastSyncAt: '',
  lastSyncRev: 0,
  deviceId: '',
};

export async function loadConfig() {
  const saved = (await kvGet('config')) || {};
  const cfg = Object.assign({}, DEFAULT_CONFIG, saved);
  if (!cfg.deviceId) {
    cfg.deviceId = 'dev-' + Math.random().toString(36).slice(2, 10);
    await kvSet('config', cfg);
  }
  return cfg;
}

export async function saveConfig(patch) {
  const cfg = await loadConfig();
  const next = Object.assign({}, cfg, patch);
  await kvSet('config', next);
  return next;
}

/** Existe cofre neste dispositivo? */
export async function hasVault() {
  return !!(await loadEnvelope());
}
