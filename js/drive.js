/* ============================================================
   drive.js - sincronizacao com o Google Drive
   ------------------------------------------------------------
   Escopo usado: drive.file
     "ver e gerenciar APENAS os arquivos que este app criou"
   O app cria uma pasta propria e dentro dela um unico arquivo,
   cofre.enc, que e o envelope cifrado. O Google armazena bytes
   ilegiveis: a chave nunca sai do dispositivo.
   ============================================================ */

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const FOLDER_NAME = 'Cofre de Senhas';
const FILE_NAME = 'cofre.enc';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;
let gisLoaded = null;

export function isConnected() {
  return !!accessToken && Date.now() < tokenExpiry;
}

export function currentOrigin() {
  return location.origin;
}

/* ---------- carregamento do SDK de identidade ---------- */

function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    if (window.google && window.google.accounts) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Nao foi possivel carregar o login do Google (sem internet?).'));
    document.head.appendChild(s);
  });
  return gisLoaded;
}

/* ---------- autorizacao ---------- */

/**
 * Pede o token de acesso. interactive=false tenta renovar sem mostrar janela.
 * O token vive cerca de 1 hora; nao existe refresh token no navegador - por
 * design, para que nada de longa duracao fique guardado aqui.
 */
export async function connect(clientId, interactive = true) {
  if (!clientId) throw new Error('Configure o ID do cliente OAuth primeiro.');
  await loadGis();

  return new Promise((resolve, reject) => {
    try {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: (resp) => {
          if (resp && resp.access_token) {
            accessToken = resp.access_token;
            tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
            resolve(accessToken);
          } else {
            reject(new Error(describeAuthError(resp)));
          }
        },
        error_callback: (err) => reject(new Error(describeAuthError(err))),
      });
      tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    } catch (e) {
      reject(e);
    }
  });
}

function describeAuthError(resp) {
  const t = (resp && (resp.type || resp.error)) || '';
  if (t === 'popup_closed' || t === 'popup_failed_to_open') {
    return 'A janela do Google foi fechada ou bloqueada. Permita pop-ups para este site.';
  }
  if (String(t).indexOf('access_denied') !== -1) {
    return 'Acesso negado. Confirme que a sua conta esta na lista de usuarios de teste do projeto.';
  }
  if (String(t).indexOf('invalid_client') !== -1 || String(t).indexOf('origin') !== -1) {
    return 'ID do cliente invalido, ou a origem ' + location.origin
      + ' nao foi autorizada no Google Cloud Console.';
  }
  return 'Falha na autorizacao do Google' + (t ? ' (' + t + ')' : '') + '.';
}

export function disconnect() {
  if (accessToken && window.google && google.accounts && google.accounts.oauth2) {
    try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch (e) { /* ignora */ }
  }
  accessToken = null;
  tokenExpiry = 0;
}

async function ensureToken(clientId) {
  if (isConnected()) return accessToken;
  // tenta renovar silenciosamente; se o Google exigir interacao, abre a janela
  try {
    return await connect(clientId, false);
  } catch (e) {
    return connect(clientId, true);
  }
}

/* ---------- chamadas REST ---------- */

async function api(clientId, path, opts) {
  const o = opts || {};
  const token = await ensureToken(clientId);
  const headers = Object.assign({ Authorization: 'Bearer ' + token }, o.headers || {});
  const res = await fetch(path, Object.assign({}, o, { headers }));
  if (res.status === 401) {
    accessToken = null;
    const t2 = await ensureToken(clientId);
    const r2 = await fetch(
      path,
      Object.assign({}, o, { headers: Object.assign({}, headers, { Authorization: 'Bearer ' + t2 }) })
    );
    if (!r2.ok) throw new Error(await errText(r2));
    return r2;
  }
  if (!res.ok) throw new Error(await errText(res));
  return res;
}

async function errText(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = (j.error && (j.error.message || j.error.status)) || '';
  } catch (e) { /* resposta sem json */ }
  return 'Drive respondeu ' + res.status + (detail ? ': ' + detail : '');
}

/* ---------- pasta e arquivo ---------- */

async function ensureFolder(clientId, knownId) {
  if (knownId) {
    try {
      const r = await api(clientId, API + '/files/' + knownId + '?fields=id,trashed');
      const j = await r.json();
      if (!j.trashed) return j.id;
    } catch (e) { /* recria abaixo */ }
  }
  const q = encodeURIComponent(
    "name='" + FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false"
  );
  const found = await api(clientId, API + '/files?q=' + q + '&fields=files(id)&spaces=drive');
  const fj = await found.json();
  if (fj.files && fj.files.length) return fj.files[0].id;

  const created = await api(clientId, API + '/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return (await created.json()).id;
}

/** Procura o cofre.enc ja criado por este app. */
export async function findVaultFile(clientId) {
  const q = encodeURIComponent("name='" + FILE_NAME + "' and trashed=false");
  const res = await api(
    clientId,
    API + '/files?q=' + q + '&fields=files(id,name,modifiedTime,size)&spaces=drive&orderBy=modifiedTime desc'
  );
  const j = await res.json();
  return j.files && j.files.length ? j.files[0] : null;
}

export async function downloadVault(clientId, fileId) {
  const res = await api(clientId, API + '/files/' + fileId + '?alt=media');
  return res.json();
}

export async function fileMeta(clientId, fileId) {
  const res = await api(clientId, API + '/files/' + fileId + '?fields=id,modifiedTime,size,version');
  return res.json();
}

/**
 * Sobe o envelope. Cria o arquivo na primeira vez; depois atualiza o mesmo id,
 * o que preserva o historico de versoes do proprio Drive.
 */
export async function uploadVault(clientId, envelope, fileId, folderId) {
  const body = JSON.stringify(envelope);

  if (fileId) {
    const res = await api(
      clientId,
      UPLOAD + '/files/' + fileId + '?uploadType=media&fields=id,modifiedTime',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }
    );
    return res.json();
  }

  const folder = await ensureFolder(clientId, folderId);
  const boundary = 'cofre' + Math.random().toString(36).slice(2);
  const metadata = {
    name: FILE_NAME,
    parents: [folder],
    description: 'Cofre de senhas cifrado (AES-256-GCM). Nao edite este arquivo a mao.',
    mimeType: 'application/json',
  };
  const multipart =
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: application/json\r\n\r\n' +
    body + '\r\n' +
    '--' + boundary + '--';

  const res = await api(clientId, UPLOAD + '/files?uploadType=multipart&fields=id,modifiedTime', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
    body: multipart,
  });
  const j = await res.json();
  return Object.assign(j, { folderId: folder });
}
