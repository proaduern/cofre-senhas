/* ============================================================
   keep.js - leitura de notas do Google Keep (e de texto solto)
   ------------------------------------------------------------
   O Keep nao tem API publica para contas pessoais, entao a
   entrada aqui e o texto: copiado da nota, ou vindo dos arquivos
   .json / .html que o Google Takeout exporta.

   O parser trabalha por BLOCO (trecho entre linhas em branco),
   nao linha a linha. Isso importa: so olhando o bloco inteiro da
   para saber que

       ITAU RI
       minhasenha

   e titulo + senha, enquanto

       TONHO MEU INSS
       87797240434
       @Antonio1962

   e titulo + usuario + senha. A ultima linha solta de um bloco e
   quase sempre a senha; as do meio, o usuario.

   Ainda assim e heuristica, nao ciencia: o resultado SEMPRE passa
   por uma previa editavel antes de entrar no cofre.
   ============================================================ */

/* ---------- rotulos reconhecidos ---------- */

const LABELS = [
  { field: 'password', words: ['senha', 'senhas', 'password', 'pass', 'pwd', 'pin', 'codigo', 'code', 'chave', 'secret'] },
  { field: 'username', words: ['usuario', 'user', 'username', 'login', 'email', 'e-mail', 'mail', 'conta', 'cpf', 'matricula', 'id'] },
  { field: 'url', words: ['site', 'url', 'link', 'endereco', 'pagina'] },
  { field: 'notes', words: ['obs', 'observacao', 'observacoes', 'nota', 'notas', 'note', 'comentario', 'info', 'agencia', 'telefone', 'contato'] },
];

export const SECTION_MARK = '\u0000secao\u0000';

function deaccent(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function fieldForKey(key) {
  for (const l of LABELS) {
    if (l.words.indexOf(key) !== -1) return l.field;
    for (const w of l.words) {
      if (key.indexOf(w + ' ') === 0) return l.field; // "codigo acesso", "senha do banco"
    }
  }
  return null;
}

/**
 * "senha: abc" (sempre) e "senha abc" (so fora da primeira linha do bloco).
 * A restricao da primeira linha e o que impede o titulo "Senha ICSEE"
 * de ser lido como "a senha e ICSEE".
 */
function matchLabel(line, allowBare) {
  const m = line.match(/^\s*([^:=]{1,24})\s*[:=]\s*(.+)$/);
  if (m) {
    const key = deaccent(m[1]).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const value = m[2].trim();
    if (value) {
      const field = fieldForKey(key);
      if (field) return { field, value };
    }
    return null;
  }
  if (!allowBare) return null;

  const m2 = line.match(/^\s*(\S+(?:\s+\S+)?)\s+(\S+)\s*$/);
  if (m2) {
    const key = deaccent(m2[1]).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const field = fieldForKey(key);
    if (field && field !== 'notes') return { field, value: m2[2].trim() };
  }
  return null;
}

/** Linha que e SO um rotulo solto ("cpf", "senha"): descreve algo, nao e valor. */
function isDanglingLabel(line) {
  const key = deaccent(line).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) return false;
  for (const l of LABELS) if (l.words.indexOf(key) !== -1) return true;
  return false;
}

const RE_URL = /^(https?:\/\/|www\.)\S+$|^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUrl(s) {
  if (RE_EMAIL.test(s)) return false;
  return RE_URL.test(s.trim());
}
function isEmail(s) { return RE_EMAIL.test(s.trim()); }

/** Frase de 3+ palavras: nao e usuario nem senha, e anotacao. */
function isWordy(s) { return s.trim().split(/\s+/).length >= 3; }

/** Marcadores de lista do Keep e de texto solto. */
function stripMarker(line) {
  return line
    .replace(/^[\s ]*[☐☑☒□✓✔•●○‣·*+–—-]\s+/, '')
    .replace(/^\s*\[[ xX]?\]\s*/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .trim();
}

/** Nome curto todo em caixa alta: candidato a cabecalho de grupo. */
function isAllCapsName(line, max) {
  if (!line || line.length > (max || 28) || line.indexOf(':') !== -1) return false;
  const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, '');
  return letters.length >= 3 && line === line.toUpperCase();
}

/** Linha formada so por letras maiusculas e espacos ("MAE", "PAI"). */
function isCapsWord(line) {
  return /^[A-ZÀ-Ü][A-ZÀ-Ü\s]+$/.test(String(line || '').trim());
}

const SEPARATORS = /\s+[–—|/]\s+|\t+|\s-\s|\s=\s/;

function splitInline(line) {
  return line.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
}

function blank() {
  return { title: '', username: '', password: '', url: '', notes: '', tags: [] };
}
function isEmpty(e) {
  return !e.title && !e.username && !e.password && !e.url && !e.notes;
}
function addNote(e, t) {
  if (!t) return;
  e.notes = e.notes ? e.notes + '\n' + t : t;
}

/* ---------- parser principal ---------- */

export function parseFreeform(text) {
  const rawLines = String(text || '').replace(/\r\n?/g, '\n').split('\n');

  // 1) agrupa em blocos separados por linha em branco
  const blocks = [];
  let cur = [];
  const closeBlock = () => { if (cur.length) { blocks.push(cur); cur = []; } };

  for (const raw of rawLines) {
    if (raw.indexOf(SECTION_MARK) === 0) {
      closeBlock();
      blocks.push({ section: raw.slice(SECTION_MARK.length).trim() });
      continue;
    }
    const line = stripMarker(raw);
    if (!line) { closeBlock(); continue; }
    cur.push(line);
  }
  closeBlock();

  // 2) interpreta bloco a bloco
  const entries = [];
  let section = '';

  for (const b of blocks) {
    if (!Array.isArray(b)) { section = b.section.toLowerCase(); continue; }

    // bloco de uma linha so, em caixa alta: cabecalho que vale ate o proximo
    if (b.length === 1 && isAllCapsName(b[0])) {
      section = b[0].toLowerCase();
      continue;
    }

    let lines = b;
    let grupo = '';
    // "RN+VACINAS / MAE / senha": a primeira linha e titulo de grupo,
    // reconhecivel porque a seguinte tambem e um nome em caixa alta.
    if (lines.length >= 3 && isAllCapsName(lines[0]) && isCapsWord(lines[1])) {
      grupo = lines[0].toLowerCase();
      lines = lines.slice(1);
    }

    for (const e of parseBlock(lines)) {
      const tags = [];
      if (section) tags.push(section);
      if (grupo) tags.push(grupo);
      e.tags = tags;
      entries.push(e);
    }
  }

  return entries.filter((e) => e.title || e.username || e.password);
}

/** Interpreta um bloco; pode render mais de uma entrada. */
function parseBlock(lines) {
  const out = [];
  let e = blank();
  const flush = () => { if (!isEmpty(e)) out.push(e); e = blank(); };

  // classifica cada linha antes de distribuir
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = matchLabel(line, i > 0);
    if (kv) { items.push({ k: 'kv', kv, line }); continue; }
    if (isUrl(line)) { items.push({ k: 'url', line }); continue; }
    if (isEmail(line)) { items.push({ k: 'email', line }); continue; }
    const parts = splitInline(line);
    if (parts.length >= 2) { items.push({ k: 'parts', parts }); continue; }
    const colon = line.match(/^\s*([^:]{1,40}):\s*(\S+)\s*$/);
    if (colon) { items.push({ k: 'colon', a: colon[1].trim(), b: colon[2].trim() }); continue; }
    if (isDanglingLabel(line)) { items.push({ k: 'dangling', line }); continue; }
    items.push({ k: 'bare', line });
  }

  // a 1a linha solta e o titulo; as demais (curtas) sao os valores,
  // e a ULTIMA delas e a senha
  const bareList = items.filter((x) => x.k === 'bare');
  const titleItem = bareList.length ? bareList[0] : null;
  const valueTotal = bareList.slice(1).filter((x) => !isWordy(x.line)).length;
  let valueIdx = 0;

  // Uma segunda senha so comeca outra entrada se, desde a anterior, apareceu
  // uma linha que sirva de titulo novo. Senao e credencial extra da mesma
  // conta ("codigo acesso: xxx" logo abaixo da senha) e vira anotacao.
  let tituloNovoDesdeASenha = false;

  for (const it of items) {
    if (it.k === 'kv') {
      if (it.kv.field === 'password' && e.password && tituloNovoDesdeASenha) flush();
      // valor que nao coube vai para as anotacoes COM o texto original,
      // para nao renomear "codigo acesso" como se fosse a senha
      if (it.kv.field === 'notes' || e[it.kv.field]) addNote(e, it.line);
      else e[it.kv.field] = it.kv.value;
      if (it.kv.field === 'password') tituloNovoDesdeASenha = false;

    } else if (it.k === 'url') {
      if (!e.url) e.url = it.line;
      else addNote(e, it.line);

    } else if (it.k === 'email') {
      if (!e.username) e.username = it.line;
      else if (!e.title) e.title = it.line;
      else addNote(e, it.line);

    } else if (it.k === 'parts') {
      if (e.password) flush();
      placeParts(e, it.parts);

    } else if (it.k === 'colon') {
      if (e.password) flush();
      if (!e.title) e.title = it.a; else addNote(e, it.a);
      if (!e.password) e.password = it.b; else addNote(e, it.b);

    } else if (it.k === 'dangling') {
      addNote(e, it.line);

    } else {
      if (it === titleItem && !e.title) {
        e.title = it.line;
        tituloNovoDesdeASenha = true;
        continue;
      }
      if (isWordy(it.line)) { addNote(e, it.line); continue; }

      valueIdx++;
      const restam = valueTotal - valueIdx;

      if (!e.title) { e.title = it.line; tituloNovoDesdeASenha = true; continue; }
      if (!e.password && restam === 0) { e.password = it.line; tituloNovoDesdeASenha = false; continue; }
      if (!e.username) { e.username = it.line; continue; }
      if (!e.password) { e.password = it.line; tituloNovoDesdeASenha = false; continue; }
      flush();
      e.title = it.line;
      tituloNovoDesdeASenha = true;
    }
  }
  flush();
  return out;
}


function placeParts(e, parts) {
  if (parts.length === 2) {
    assignLoose(e, parts[0]);
    const second = parts[1];
    if (isUrl(second) || isEmail(second)) assignLoose(e, second);
    else if (!e.password) e.password = second;
    else assignLoose(e, second);
  } else {
    for (const p of parts) assignLoose(e, p);
  }
}

function assignLoose(e, token) {
  const t = String(token || '').trim();
  if (!t) return;
  if (isUrl(t) && !e.url) { e.url = t; return; }
  if (isEmail(t) && !e.username) { e.username = t; return; }
  if (!e.title) { e.title = t; return; }
  if (!isWordy(t)) {
    if (!e.username) { e.username = t; return; }
    if (!e.password) { e.password = t; return; }
  }
  addNote(e, t);
}

/* ---------- Google Takeout ---------- */

/**
 * Um arquivo .json do Takeout = uma nota.
 * null = nao e JSON de nota do Keep; '' = nota valida porem sem nada util.
 */
export function keepJsonToText(jsonText) {
  let n;
  try { n = JSON.parse(jsonText); } catch (e) { return null; }
  const notes = Array.isArray(n) ? n : [n];
  const ehKeep = notes.some((x) => x && typeof x === 'object'
    && ('textContent' in x || 'listContent' in x || 'isTrashed' in x));
  if (!ehKeep) return null;

  const out = [];
  for (const note of notes) {
    if (!note || typeof note !== 'object') continue;
    if (note.isTrashed) continue;
    const parts = [];
    if (note.title) parts.push(SECTION_MARK + String(note.title).trim());
    if (note.textContent) parts.push(String(note.textContent).trim());
    if (Array.isArray(note.listContent)) {
      for (const item of note.listContent) {
        if (item && item.text) parts.push(String(item.text).trim());
      }
    }
    if (Array.isArray(note.annotations)) {
      for (const a of note.annotations) {
        if (a && a.url) parts.push(String(a.url).trim());
      }
    }
    if (parts.length) out.push(parts.join('\n'));
  }
  return out.join('\n\n');
}

/** Um arquivo .html do Takeout. */
export function keepHtmlToText(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const blocks = [];
  const notes = doc.querySelectorAll('.note');
  const roots = notes.length ? notes : [doc.body];

  for (const root of roots) {
    if (!root) continue;
    const titleEl = root.querySelector('.title');
    const contentEl = root.querySelector('.content') || root;
    const parts = [];
    if (titleEl && titleEl.textContent.trim()) {
      parts.push(SECTION_MARK + titleEl.textContent.trim());
    }
    const clone = contentEl.cloneNode(true);
    clone.querySelectorAll('.heading, .title').forEach((n) => n.remove());
    clone.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
    clone.querySelectorAll('li, div, p').forEach((n) => n.append('\n'));
    const body = clone.textContent.replace(/\n{3,}/g, '\n\n').trim();
    if (body) parts.push(body);
    if (parts.length) blocks.push(parts.join('\n'));
  }
  return blocks.join('\n\n');
}

/* ---------- despachante ---------- */

export function toPlainText(filename, content) {
  const name = String(filename || '').toLowerCase();
  const head = content.slice(0, 400).trim();

  if (name.endsWith('.json') || head.startsWith('{') || head.startsWith('[')) {
    const t = keepJsonToText(content);
    if (t !== null) return t;
  }
  if (name.endsWith('.html') || name.endsWith('.htm') || /<(html|body|div|br)\b/i.test(head)) {
    const t = keepHtmlToText(content);
    if (t) return t;
  }
  return content;
}

/** O texto parece uma tabela CSV com cabecalho? */
export function looksLikeCsv(text) {
  const first = (text.split('\n')[0] || '').toLowerCase();
  const cols = first.split(/[,;\t]/).length;
  if (cols < 2) return false;
  return /(^|[,;\t])\s*(name|title|url|username|password|login_password|senha|usuario)\s*([,;\t]|$)/.test(first);
}
