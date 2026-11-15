/* ============================================================
   vault.js - modelo do cofre e estado em memoria
   ------------------------------------------------------------
   Formato do conteudo em claro:
   {
     rev: 7,                       // revisao, cresce a cada gravacao
     entries: [ {
        id, title, username, password, url, notes, tags[],
        createdAt, updatedAt, deleted           // deleted = tombstone
     } ]
   }
   Tombstones (deleted: true) existem para que uma exclusao feita no
   celular nao "ressuscite" ao sincronizar com o PC.
   ============================================================ */

import * as C from './crypto.js';
import * as S from './store.js';

const state = {
  key: null,       // CryptoKey - so em memoria, perdido ao bloquear
  salt: null,
  iterations: C.KDF_ITERATIONS,
  payload: null,   // conteudo em claro
  dirty: false,    // tem alteracao ainda nao sincronizada
};

export function isUnlocked() {
  return !!state.key;
}

export function isDirty() {
  return state.dirty;
}

export function revision() {
  return state.payload ? state.payload.rev : 0;
}

/* ---------- criacao / abertura / bloqueio ---------- */

export async function createVault(masterPassword) {
  const salt = C.randomBytes(16);
  const key = await C.deriveKey(masterPassword, salt);
  state.key = key;
  state.salt = salt;
  state.iterations = C.KDF_ITERATIONS;
  state.payload = { rev: 1, entries: [] };
  state.dirty = true;
  await persist();
  return true;
}

export async function unlock(masterPassword) {
  const env = await S.loadEnvelope();
  if (!env) throw new Error('Nenhum cofre neste dispositivo.');
  const opened = await C.unlockEnvelope(env, masterPassword);
  state.key = opened.key;
  state.salt = opened.salt;
  state.iterations = opened.iterations;
  state.payload = normalize(opened.payload);
  state.dirty = false;
  return true;
}

/** Abre um envelope vindo do Drive (ou de um backup) e o adota localmente. */
export async function adoptEnvelope(envelope, masterPassword) {
  const opened = await C.unlockEnvelope(envelope, masterPassword);
  state.key = opened.key;
  state.salt = opened.salt;
  state.iterations = opened.iterations;
  state.payload = normalize(opened.payload);
  state.dirty = false;
  await S.saveEnvelope(envelope);
  return true;
}

export function lock() {
  state.key = null;
  state.salt = null;
  state.payload = null;
  state.dirty = false;
}

function normalize(p) {
  const out = p && typeof p === 'object' ? p : {};
  if (!Array.isArray(out.entries)) out.entries = [];
  if (!out.rev) out.rev = 1;
  return out;
}

/* ---------- gravacao local ---------- */

export async function persist(bumpRevision = false) {
  if (!state.key) throw new Error('Cofre bloqueado.');
  if (bumpRevision) state.payload.rev = (state.payload.rev || 0) + 1;
  const env = await C.encryptVault(state.payload, state.key, state.salt, state.iterations);
  await S.saveEnvelope(env);
  return env;
}

/** Devolve o envelope cifrado atual, para subir ao Drive ou exportar. */
export async function currentEnvelope() {
  return (await S.loadEnvelope()) || persist();
}

/* ---------- consultas ---------- */

export function listEntries(query) {
  if (!state.payload) return [];
  const live = state.payload.entries.filter((e) => !e.deleted);
  const q = (query || '').trim().toLowerCase();
  const filtered = q
    ? live.filter((e) =>
        [e.title, e.username, e.url, e.notes, (e.tags || []).join(' ')]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
    : live;
  return filtered.sort((a, b) =>
    (a.title || '').localeCompare(b.title || '', 'pt-BR', { sensitivity: 'base' })
  );
}

export function getEntry(id) {
  if (!state.payload) return null;
  return state.payload.entries.find((e) => e.id === id) || null;
}

export function allTags() {
  const set = new Set();
  for (const e of state.payload ? state.payload.entries : []) {
    if (e.deleted) continue;
    for (const t of e.tags || []) set.add(t);
  }
  return Array.from(set).sort();
}

export function stats() {
  const live = (state.payload ? state.payload.entries : []).filter((e) => !e.deleted);
  const weak = live.filter((e) => C.estimateStrength(e.password).level <= 1).length;
  const seen = new Map();
  let reused = 0;
  for (const e of live) {
    if (!e.password) continue;
    const n = (seen.get(e.password) || 0) + 1;
    seen.set(e.password, n);
    if (n === 2) reused += 2;
    else if (n > 2) reused += 1;
  }
  return { total: live.length, weak, reused };
}

/* ---------- escrita ---------- */

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'e-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export async function upsertEntry(data) {
  if (!state.key) throw new Error('Cofre bloqueado.');
  const now = new Date().toISOString();
  const clean = {
    title: (data.title || '').trim() || 'Sem titulo',
    username: (data.username || '').trim(),
    password: data.password || '',
    url: (data.url || '').trim(),
    notes: data.notes || '',
    tags: (data.tags || []).map((t) => t.trim()).filter(Boolean),
  };

  if (data.id) {
    const e = getEntry(data.id);
    if (!e) throw new Error('Entrada nao encontrada.');
    Object.assign(e, clean, { updatedAt: now, deleted: false });
  } else {
    state.payload.entries.push(
      Object.assign({ id: newId(), createdAt: now, updatedAt: now, deleted: false }, clean)
    );
  }
  state.dirty = true;
  await persist(true);
}

export async function deleteEntry(id) {
  const e = getEntry(id);
  if (!e) return;
  e.deleted = true;
  e.password = '';
  e.notes = '';
  e.username = '';
  e.url = '';
  e.updatedAt = new Date().toISOString();
  state.dirty = true;
  await persist(true);
}

/** Importacao em lote. Devolve quantas entradas entraram. */
export async function addMany(items) {
  if (!state.key) throw new Error('Cofre bloqueado.');
  const now = new Date().toISOString();
  let n = 0;
  for (const it of items) {
    if (!it || (!it.title && !it.username && !it.password)) continue;
    state.payload.entries.push({
      id: newId(),
      title: (it.title || it.url || 'Sem titulo').trim(),
      username: (it.username || '').trim(),
      password: it.password || '',
      url: (it.url || '').trim(),
      notes: it.notes || '',
      tags: it.tags || [],
      createdAt: now,
      updatedAt: now,
      deleted: false,
    });
    n++;
  }
  if (n) {
    state.dirty = true;
    await persist(true);
  }
  return n;
}

export async function changeMasterPassword(currentPw, newPw) {
  const env = await S.loadEnvelope();
  if (!env) throw new Error('Nenhum cofre local.');
  await C.unlockEnvelope(env, currentPw); // valida a senha atual
  const salt = C.randomBytes(16);
  const key = await C.deriveKey(newPw, salt);
  state.key = key;
  state.salt = salt;
  state.iterations = C.KDF_ITERATIONS;
  state.dirty = true;
  await persist(true);
}

/* ---------- comparacao de chave entre cofres ---------- */

/**
 * O envelope remoto usa a MESMA chave que a nossa?
 * O sal muda apenas quando a senha-mestra e trocada. Se sal e iteracoes
 * batem, a chave em memoria ja abre o remoto - sem pedir senha de novo.
 */
export function sameKeyAs(envelope) {
  if (!state.salt || !envelope || !envelope.kdf) return false;
  return (
    envelope.kdf.salt === C.bytesToB64(state.salt) &&
    Number(envelope.kdf.iter) === Number(state.iterations)
  );
}

/** Decifra um envelope que usa a mesma chave que a nossa. */
export async function decryptWithCurrentKey(envelope) {
  if (!state.key) throw new Error('Cofre bloqueado.');
  return normalize(await C.decryptVault(envelope, state.key));
}

/* ---------- mesclagem (resolucao de conflito entre dispositivos) ---------- */

/**
 * Mescla o cofre remoto no local, entrada por entrada.
 * Regra: para cada id, vence a versao com updatedAt mais recente.
 * Exclusoes sao tombstones, logo tambem competem por data - uma
 * exclusao recente vence uma edicao antiga, e vice-versa.
 */
export async function mergeRemote(remotePayload) {
  if (!state.key) throw new Error('Cofre bloqueado.');
  const byId = new Map();
  for (const e of state.payload.entries) byId.set(e.id, e);

  let added = 0;
  let updated = 0;

  for (const r of (remotePayload && remotePayload.entries) || []) {
    const local = byId.get(r.id);
    if (!local) {
      state.payload.entries.push(r);
      byId.set(r.id, r);
      added++;
    } else if (new Date(r.updatedAt || 0) > new Date(local.updatedAt || 0)) {
      Object.assign(local, r);
      updated++;
    }
  }

  const newRev = Math.max(state.payload.rev || 1, (remotePayload && remotePayload.rev) || 1) + 1;
  state.payload.rev = newRev;
  state.dirty = true;
  await persist(false);
  return { added, updated };
}

export function markSynced() {
  state.dirty = false;
}

/** Exporta o conteudo em claro - usado apenas pelo backup explicito do usuario. */
export function exportPlain() {
  return JSON.parse(JSON.stringify(state.payload || { rev: 0, entries: [] }));
}
