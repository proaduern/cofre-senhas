/* ============================================================
   importer.js - leitura de listas de senhas
   ------------------------------------------------------------
   Roda 100% no navegador. Reconhece automaticamente os cabecalhos
   do Chrome/Google Senhas, Bitwarden, KeePass, LastPass, 1Password
   e Firefox; se nao achar cabecalho conhecido, cai para um modo
   generico (titulo, usuario, senha separados por , ; tab ou |).
   ============================================================ */

/** Parser de CSV de verdade: lida com campos entre aspas, virgulas e quebras dentro do campo. */
export function parseCsv(text, delimiter) {
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === d) { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const counts = [
    [',', (firstLine.match(/,/g) || []).length],
    [';', (firstLine.match(/;/g) || []).length],
    ['\t', (firstLine.match(/\t/g) || []).length],
    ['|', (firstLine.match(/\|/g) || []).length],
  ].sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/* ---------- mapeamento de colunas ---------- */

const ALIASES = {
  title: ['name', 'title', 'nome', 'titulo', 'account', 'conta', 'item', 'display name', 'entry'],
  username: ['username', 'user', 'usuario', 'login', 'login_username', 'email', 'e-mail',
             'user name', 'login name', 'account name'],
  password: ['password', 'senha', 'login_password', 'pass', 'pwd', 'login password'],
  url: ['url', 'uri', 'site', 'website', 'login_uri', 'web site', 'hostname', 'link', 'address'],
  notes: ['note', 'notes', 'notas', 'comment', 'comentario', 'extra', 'observacoes', 'description'],
  tags: ['folder', 'group', 'grouping', 'pasta', 'grupo', 'category', 'categoria', 'collection', 'tags'],
};

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function mapHeader(headerRow) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const n = norm(h);
    for (const field in ALIASES) {
      if (map[field] !== undefined) continue;
      if (ALIASES[field].indexOf(n) !== -1) map[field] = idx;
    }
  });
  return map;
}

function looksLikeHeader(row) {
  const m = mapHeader(row);
  // precisa ter pelo menos senha + (titulo ou usuario ou url)
  return m.password !== undefined && (m.title !== undefined || m.username !== undefined || m.url !== undefined);
}

/* ---------- entrada principal ---------- */

/**
 * Converte texto bruto numa lista de entradas prontas para o cofre.
 * @returns {{items: Array, skipped: number, mode: string, columns: object}}
 */
export function parseList(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { items: [], skipped: 0, mode: 'vazio', columns: {} };

  if (looksLikeHeader(rows[0])) {
    const cols = mapHeader(rows[0]);
    const items = [];
    let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const get = (f) => (cols[f] !== undefined ? String(r[cols[f]] || '').trim() : '');
      const item = {
        title: get('title'),
        username: get('username'),
        password: get('password'),
        url: get('url'),
        notes: get('notes'),
        tags: splitTags(get('tags')),
      };
      if (!item.title) item.title = hostOf(item.url) || item.username || 'Sem titulo';
      if (!item.password && !item.username) { skipped++; continue; }
      items.push(item);
    }
    return { items, skipped, mode: 'csv', columns: cols };
  }

  // modo generico: cada linha = titulo, usuario, senha (nessa ordem)
  const items = [];
  let skipped = 0;
  for (const r of rows) {
    const parts = r.map((x) => String(x || '').trim());
    if (parts.length < 2) { skipped++; continue; }
    const item = {
      title: parts[0] || 'Sem titulo',
      username: parts[1] || '',
      password: parts[2] || parts[1] || '',
      url: parts.find((p) => /^https?:\/\//i.test(p)) || '',
      notes: parts.slice(3).filter((p) => !/^https?:\/\//i.test(p)).join(' | '),
      tags: [],
    };
    if (parts.length === 2) { item.username = ''; item.password = parts[1]; }
    items.push(item);
  }
  return { items, skipped, mode: 'generico', columns: {} };
}

function splitTags(s) {
  if (!s) return [];
  return s.split(/[\/,;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 4);
}

export function hostOf(url) {
  if (!url) return '';
  try {
    const u = new URL(url.indexOf('://') === -1 ? 'https://' + url : url);
    return u.hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}
