/* ============================================================
   app.js - interface, eventos e sincronizacao
   ============================================================ */

import * as C from './crypto.js';
import * as S from './store.js';
import * as V from './vault.js';
import * as D from './drive.js';
import { parseList, hostOf } from './importer.js';
import * as K from './keep.js';

const APP_VERSION = '1.2.0';

let cfg = null;
let lockTimer = null;
let clipTimer = null;
let pendingRemote = null; // envelope do Drive aguardando senha
let remoteMode = '';      // 'merge' | 'adopt'

/* ---------- atalhos de DOM ---------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const show = (sel) => $(sel).classList.remove('hidden');
const hide = (sel) => $(sel).classList.add('hidden');

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 5200 : 2600);
}

function screen(name) {
  ['#screen-setup', '#screen-lock', '#screen-vault'].forEach(hide);
  show(name);
}

function openModal(sel) { show(sel); }
function closeModal(sel) { hide(sel); }

/* ---------- inicializacao ---------- */

async function boot() {
  cfg = await S.loadConfig();
  $('#cfg-version').textContent = 'Cofre v' + APP_VERSION + ' - origem: ' + location.origin;
  $('#cfg-origin-hint').innerHTML =
    'No Google Cloud Console, esta origem precisa estar em '
    + '<b>Origens JavaScript autorizadas</b>: <code>' + location.origin + '</code>';

  wireEvents();
  registerServiceWorker();

  if (await S.hasVault()) {
    screen('#screen-lock');
    $('#unlock-pw').focus();
  } else {
    screen('#screen-setup');
    $('#setup-pw').focus();
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* sem offline, segue o jogo */ });
}

/* ============================================================
   TELA DE CRIACAO
   ============================================================ */

function wireSetup() {
  const pw = $('#setup-pw');
  pw.addEventListener('input', () => {
    const s = C.estimateStrength(pw.value);
    $('#setup-bar').className = 'l' + s.level;
    $('#setup-bits').textContent = pw.value ? s.label + ' (~' + s.bits + ' bits)' : '';
  });

  $('#setup-suggest').addEventListener('click', (ev) => {
    ev.preventDefault();
    const phrase = C.generatePassphrase(4);
    const box = $('#setup-suggestion');
    box.textContent = phrase + '   (clique para usar)';
    box.classList.remove('hidden');
    box.onclick = () => {
      pw.value = phrase;
      $('#setup-pw2').value = phrase;
      pw.dispatchEvent(new Event('input'));
      toast('Frase-senha preenchida. Anote-a antes de continuar.');
    };
  });

  $('#setup-go').addEventListener('click', async () => {
    const a = $('#setup-pw').value;
    const b = $('#setup-pw2').value;
    const err = $('#setup-error');
    err.classList.add('hidden');

    if (a.length < 8) return fail(err, 'Use pelo menos 8 caracteres na senha-mestra.');
    if (a !== b) return fail(err, 'As duas senhas nao sao iguais.');
    if (C.estimateStrength(a).level < 1) return fail(err, 'Senha fraca demais para proteger tudo. Tente a frase-senha sugerida.');

    $('#setup-go').disabled = true;
    $('#setup-go').textContent = 'Criando...';
    try {
      await V.createVault(a);
      $('#setup-pw').value = '';
      $('#setup-pw2').value = '';
      await enterVault();
      toast('Cofre criado. Guarde a senha-mestra em lugar seguro.', 'ok');
    } catch (e) {
      fail(err, e.message);
    } finally {
      $('#setup-go').disabled = false;
      $('#setup-go').textContent = 'Criar cofre';
    }
  });

  $('#setup-restore').addEventListener('click', () => openModal('#modal-restore'));
}

function fail(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

/* ============================================================
   DESBLOQUEIO
   ============================================================ */

function wireUnlock() {
  $('#unlock-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pw = $('#unlock-pw').value;
    const err = $('#unlock-error');
    err.classList.add('hidden');
    if (!pw) return;

    $('#unlock-go').disabled = true;
    show('#unlock-busy');
    // deixa o navegador pintar o "derivando a chave" antes do PBKDF2 travar a thread
    await new Promise((r) => setTimeout(r, 30));
    try {
      await V.unlock(pw);
      $('#unlock-pw').value = '';
      await enterVault();
    } catch (e) {
      fail(err, 'Senha-mestra incorreta.');
      $('#unlock-pw').select();
    } finally {
      $('#unlock-go').disabled = false;
      hide('#unlock-busy');
    }
  });

  $('#unlock-reset').addEventListener('click', async () => {
    if (!confirm('Apagar o cofre DESTE dispositivo?\n\nA copia no Google Drive e seus backups nao sao afetados.')) return;
    await S.dropEnvelope();
    location.reload();
  });
}

/* ============================================================
   COFRE
   ============================================================ */

async function enterVault() {
  screen('#screen-vault');
  render();
  resetLockTimer();
  updateSyncChip();
  // sincroniza sozinho na abertura, se o Drive estiver configurado
  if (cfg.driveClientId) {
    setTimeout(() => doSync(true), 600);
  }
}

function render() {
  const q = $('#search').value;
  const items = V.listEntries(q);
  const list = $('#list');
  list.innerHTML = '';

  const st = V.stats();
  $('#stat-total').textContent = st.total + (st.total === 1 ? ' senha' : ' senhas');
  toggleChip('#stat-weak', st.weak, st.weak + ' fraca' + (st.weak > 1 ? 's' : ''));
  toggleChip('#stat-reused', st.reused, st.reused + ' repetida' + (st.reused > 1 ? 's' : ''));

  if (!st.total) {
    show('#empty');
    hide('#list');
    return;
  }
  hide('#empty');
  show('#list');

  if (!items.length) {
    list.innerHTML = '<p class="muted" style="text-align:center;padding:30px">Nada encontrado para essa busca.</p>';
    return;
  }

  for (const e of items) list.appendChild(itemNode(e));
}

function toggleChip(sel, n, text) {
  const el = $(sel);
  if (n > 0) { el.textContent = text; el.classList.remove('hidden'); }
  else el.classList.add('hidden');
}

const AV_COLORS = ['#4f8cff', '#3ecf8e', '#f5a524', '#f2555a', '#a569ff', '#1fb6c1', '#ef6ba8', '#7a8cff'];

function itemNode(e) {
  const node = document.createElement('article');
  node.className = 'item';

  const label = (e.title || '?').trim();
  const initials = label.slice(0, 2).toUpperCase();
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;

  const av = document.createElement('div');
  av.className = 'avatar';
  av.style.background = AV_COLORS[h % AV_COLORS.length];
  av.textContent = initials;

  const main = document.createElement('div');
  main.className = 'item-main';
  const t = document.createElement('div');
  t.className = 'item-title';
  t.textContent = e.title;
  const sub = document.createElement('div');
  sub.className = 'item-sub';
  sub.textContent = e.username || hostOf(e.url) || 'sem usuario';
  main.appendChild(t);
  main.appendChild(sub);
  if (e.tags && e.tags.length) {
    const tags = document.createElement('div');
    tags.className = 'item-tags';
    for (const tg of e.tags) {
      const s = document.createElement('span');
      s.className = 'tag';
      s.textContent = tg;
      tags.appendChild(s);
    }
    main.appendChild(tags);
  }

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  actions.appendChild(iconButton('\u{1F464}', 'Copiar usuario', (ev) => {
    ev.stopPropagation();
    copyToClipboard(e.username, 'Usuario copiado');
  }));
  actions.appendChild(iconButton('\u{1F511}', 'Copiar senha', (ev) => {
    ev.stopPropagation();
    copyToClipboard(e.password, 'Senha copiada');
  }));
  if (e.url) {
    actions.appendChild(iconButton('↗', 'Abrir site', (ev) => {
      ev.stopPropagation();
      const u = e.url.indexOf('://') === -1 ? 'https://' + e.url : e.url;
      window.open(u, '_blank', 'noopener');
    }));
  }

  node.appendChild(av);
  node.appendChild(main);
  node.appendChild(actions);
  node.addEventListener('click', () => openEntry(e.id));
  return node;
}

function iconButton(glyph, title, onClick) {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.title = title;
  b.textContent = glyph;
  b.addEventListener('click', onClick);
  return b;
}

async function copyToClipboard(text, msg) {
  if (!text) return toast('Nada para copiar.');
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    return toast('O navegador bloqueou a copia.', 'err');
  }
  const secs = Number(cfg.clipboardClearSeconds || 0);
  toast(msg + (secs ? ' - sera limpa em ' + secs + 's' : ''), 'ok');
  if (clipTimer) clearTimeout(clipTimer);
  if (secs > 0) {
    clipTimer = setTimeout(() => {
      navigator.clipboard.writeText('').catch(() => {});
    }, secs * 1000);
  }
  resetLockTimer();
}

/* ============================================================
   MODAL DE ENTRADA
   ============================================================ */

function openEntry(id) {
  const e = id ? V.getEntry(id) : null;
  $('#entry-title').textContent = e ? 'Editar entrada' : 'Nova entrada';
  $('#e-id').value = e ? e.id : '';
  $('#e-title').value = e ? e.title : '';
  $('#e-username').value = e ? e.username : '';
  $('#e-password').value = e ? e.password : '';
  $('#e-url').value = e ? e.url : '';
  $('#e-tags').value = e && e.tags ? e.tags.join(', ') : '';
  $('#e-notes').value = e ? e.notes : '';
  $('#e-password').type = 'password';
  $('#entry-error').classList.add('hidden');
  $('#e-delete').classList.toggle('hidden', !e);
  updateEntryStrength();
  openModal('#modal-entry');
  setTimeout(() => $('#e-title').focus(), 50);
}

function updateEntryStrength() {
  const s = C.estimateStrength($('#e-password').value);
  $('#e-bar').className = 'l' + s.level;
  $('#e-bits').textContent = $('#e-password').value ? s.label + ' (~' + s.bits + ' bits)' : '';
}

function wireEntry() {
  $('#e-password').addEventListener('input', updateEntryStrength);

  $('#e-reveal').addEventListener('click', () => {
    const f = $('#e-password');
    f.type = f.type === 'password' ? 'text' : 'password';
  });
  $('#e-copy').addEventListener('click', () => copyToClipboard($('#e-password').value, 'Senha copiada'));
  $('#e-gen').addEventListener('click', () => openGenerator((pw) => {
    $('#e-password').value = pw;
    $('#e-password').type = 'text';
    updateEntryStrength();
  }));

  $('#e-save').addEventListener('click', async () => {
    const err = $('#entry-error');
    err.classList.add('hidden');
    const data = {
      id: $('#e-id').value || null,
      title: $('#e-title').value,
      username: $('#e-username').value,
      password: $('#e-password').value,
      url: $('#e-url').value,
      tags: $('#e-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      notes: $('#e-notes').value,
    };
    if (!data.title.trim() && !data.username.trim()) return fail(err, 'Preencha pelo menos o titulo.');
    try {
      await V.upsertEntry(data);
      closeModal('#modal-entry');
      render();
      updateSyncChip();
      toast('Salvo.', 'ok');
      autoSyncSoon();
    } catch (e) {
      fail(err, e.message);
    }
  });

  $('#e-delete').addEventListener('click', async () => {
    const id = $('#e-id').value;
    if (!id) return;
    const e = V.getEntry(id);
    if (!confirm('Excluir "' + (e ? e.title : '') + '" do cofre?')) return;
    await V.deleteEntry(id);
    closeModal('#modal-entry');
    render();
    updateSyncChip();
    toast('Entrada excluida.');
    autoSyncSoon();
  });
}

/* ============================================================
   GERADOR
   ============================================================ */

let genCallback = null;

function openGenerator(cb) {
  genCallback = cb || null;
  regen();
  openModal('#modal-gen');
}

function genOptions() {
  return {
    length: Number($('#gen-len').value),
    upper: $('#gen-upper').checked,
    lower: $('#gen-lower').checked,
    digits: $('#gen-digits').checked,
    symbols: $('#gen-symbols').checked,
    avoidAmbiguous: $('#gen-amb').checked,
  };
}

function regen() {
  $('#gen-len-label').textContent = $('#gen-len').value;
  $('#gen-out').textContent = C.generatePassword(genOptions());
}

function wireGenerator() {
  ['#gen-len', '#gen-upper', '#gen-lower', '#gen-digits', '#gen-symbols', '#gen-amb']
    .forEach((s) => $(s).addEventListener('input', regen));
  $('#gen-again').addEventListener('click', regen);
  $('#gen-phrase').addEventListener('click', () => {
    $('#gen-out').textContent = C.generatePassphrase(4);
  });
  $('#gen-out').addEventListener('click', () => copyToClipboard($('#gen-out').textContent, 'Senha copiada'));
  $('#gen-use').addEventListener('click', () => {
    if (genCallback) genCallback($('#gen-out').textContent);
    closeModal('#modal-gen');
  });
}

/* ============================================================
   IMPORTACAO
   ============================================================ */

let pendingFiles = [];

function wireImport() {
  $('#imp-file').addEventListener('change', async (ev) => {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    pendingFiles = [];
    for (const f of files) {
      pendingFiles.push({ name: f.name, text: await f.text() });
    }
    $('#imp-filename').textContent =
      files.length === 1 ? files[0].name : files.length + ' arquivos selecionados';
    // mostra o conteudo so quando for um arquivo unico e pequeno
    if (files.length === 1 && pendingFiles[0].text.length < 20000) {
      $('#imp-text').value = K.toPlainText(pendingFiles[0].name, pendingFiles[0].text);
      pendingFiles = [];
    }
  });

  $('#imp-go').addEventListener('click', () => {
    const err = $('#imp-error');
    err.classList.add('hidden');

    const sources = pendingFiles.length
      ? pendingFiles
      : [{ name: 'colado.txt', text: $('#imp-text').value }];

    if (!sources.some((s) => s.text.trim())) {
      return fail(err, 'Escolha um arquivo ou cole o texto da nota.');
    }

    let items = [];
    let modos = new Set();
    try {
      for (const s of sources) {
        const plain = K.toPlainText(s.name, s.text);
        if (!plain.trim()) continue;
        if (K.looksLikeCsv(plain)) {
          items = items.concat(parseList(plain).items);
          modos.add('CSV');
        } else {
          items = items.concat(K.parseFreeform(plain));
          modos.add('texto livre');
        }
      }
    } catch (e) {
      return fail(err, 'Nao consegui ler esse conteudo: ' + e.message);
    }

    if (!items.length) return fail(err, 'Nenhuma entrada reconhecida. Confira o texto e tente de novo.');

    renderImportPreview(items, Array.from(modos).join(' + '));
    hide('#imp-input');
    show('#imp-hint');
    hide('#imp-go');
    show('#imp-confirm');
    show('#imp-back');
  });

  $('#imp-back').addEventListener('click', () => {
    $('#imp-preview').classList.add('hidden');
    show('#imp-input');
    hide('#imp-hint');
    show('#imp-go');
    hide('#imp-confirm');
    hide('#imp-back');
  });

  $('#imp-confirm').addEventListener('click', async () => {
    const items = collectImportPreview();
    if (!items.length) return fail($('#imp-error'), 'Nenhuma linha marcada para importar.');
    try {
      const n = await V.addMany(items);
      closeModal('#modal-import');
      resetImportModal();
      render();
      updateSyncChip();
      toast(n + ' senhas importadas.', 'ok');
      autoSyncSoon();
    } catch (e) {
      fail($('#imp-error'), e.message);
    }
  });
}

/**
 * Previa EDITAVEL. O parser de texto livre acerta muito, mas nao tudo:
 * aqui da para corrigir campo a campo e desmarcar o que nao presta
 * antes de qualquer coisa entrar no cofre.
 */
function renderImportPreview(items, modo) {
  const box = $('#imp-preview');
  box.innerHTML = '';
  box.className = 'preview editable';

  const head = document.createElement('div');
  head.className = 'imp-head';
  const info = document.createElement('span');
  info.className = 'small';
  const semSenha = items.filter((i) => !i.password).length;
  info.innerHTML = '<b>' + items.length + '</b> entradas reconhecidas (' + esc(modo) + ')'
    + (semSenha ? ' &middot; <span class="warn-flag">' + semSenha + ' sem senha</span>' : '');
  const toggle = document.createElement('button');
  toggle.className = 'btn ghost small';
  toggle.textContent = 'Desmarcar todas';
  let allOn = true;
  toggle.addEventListener('click', () => {
    allOn = !allOn;
    box.querySelectorAll('.imp-row input[type="checkbox"]').forEach((c) => {
      c.checked = allOn;
      c.closest('.imp-row').classList.toggle('off', !allOn);
    });
    toggle.textContent = allOn ? 'Desmarcar todas' : 'Marcar todas';
  });
  head.appendChild(info);
  head.appendChild(document.createElement('span')).className = 'grow';
  head.appendChild(toggle);
  box.appendChild(head);

  for (const it of items) box.appendChild(importRow(it));
  box.classList.remove('hidden');
}

function importRow(it) {
  const row = document.createElement('div');
  row.className = 'imp-row';

  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = true;
  chk.addEventListener('change', () => row.classList.toggle('off', !chk.checked));

  const fields = document.createElement('div');
  fields.className = 'imp-fields';

  const mk = (val, ph, cls) => {
    const i = document.createElement('input');
    i.value = val || '';
    i.placeholder = ph;
    i.className = cls;
    i.spellcheck = false;
    return i;
  };

  const title = mk(it.title, 'titulo', 'f-title');
  const pair = document.createElement('div');
  pair.className = 'pair';
  pair.appendChild(mk(it.username, 'usuario', 'f-user'));
  pair.appendChild(mk(it.password, 'senha', 'f-pass'));

  fields.appendChild(title);
  fields.appendChild(pair);
  if (it.url || it.notes) {
    const extra = document.createElement('div');
    extra.className = 'pair';
    extra.appendChild(mk(it.url, 'site', 'f-url'));
    extra.appendChild(mk(it.notes ? it.notes.replace(/\n/g, ' | ') : '', 'notas', 'f-notes'));
    fields.appendChild(extra);
  }

  row.appendChild(chk);
  row.appendChild(fields);
  row._tags = it.tags || [];
  return row;
}

function collectImportPreview() {
  const out = [];
  $$('#imp-preview .imp-row').forEach((row) => {
    const chk = row.querySelector('input[type="checkbox"]');
    if (!chk || !chk.checked) return;
    const val = (cls) => {
      const el = row.querySelector('.' + cls);
      return el ? el.value.trim() : '';
    };
    const item = {
      title: val('f-title'),
      username: val('f-user'),
      password: val('f-pass'),
      url: val('f-url'),
      notes: val('f-notes'),
      tags: row._tags || [],
    };
    if (!item.title && !item.username && !item.password) return;
    out.push(item);
  });
  return out;
}

function resetImportModal() {
  $('#imp-text').value = '';
  $('#imp-filename').textContent = '';
  $('#imp-file').value = '';
  const box = $('#imp-preview');
  box.innerHTML = '';
  box.className = 'preview hidden';
  $('#imp-error').classList.add('hidden');
  show('#imp-input');
  hide('#imp-hint');
  show('#imp-go');
  hide('#imp-confirm');
  hide('#imp-back');
  pendingFiles = [];
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ============================================================
   CONFIGURACOES
   ============================================================ */

function wireSettings() {
  $('#btn-settings').addEventListener('click', () => {
    $('#cfg-clientid').value = cfg.driveClientId || '';
    $('#cfg-autolock').value = cfg.autoLockMinutes;
    $('#cfg-clip').value = cfg.clipboardClearSeconds;
    updateDriveStateLabel();
    openModal('#modal-settings');
  });

  $('#cfg-save').addEventListener('click', async () => {
    cfg = await S.saveConfig({
      driveClientId: $('#cfg-clientid').value.trim(),
      autoLockMinutes: Math.max(1, Number($('#cfg-autolock').value) || 5),
      clipboardClearSeconds: Math.max(0, Number($('#cfg-clip').value) || 0),
    });
    closeModal('#modal-settings');
    resetLockTimer();
    updateSyncChip();
    toast('Configuracoes salvas.', 'ok');
  });

  $('#cfg-connect').addEventListener('click', async () => {
    const id = $('#cfg-clientid').value.trim();
    if (!id) return toast('Cole o ID do cliente OAuth primeiro.', 'err');
    cfg = await S.saveConfig({ driveClientId: id });
    try {
      await D.connect(id, true);
      updateDriveStateLabel();
      updateSyncChip();
      toast('Conectado ao Google Drive.', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  $('#cfg-disconnect').addEventListener('click', () => {
    D.disconnect();
    updateDriveStateLabel();
    updateSyncChip();
    toast('Desconectado.');
  });

  $('#cfg-changepw').addEventListener('click', () => {
    $('#cp-old').value = '';
    $('#cp-new').value = '';
    $('#cp-new2').value = '';
    $('#cp-error').classList.add('hidden');
    openModal('#modal-changepw');
  });

  $('#cp-go').addEventListener('click', async () => {
    const err = $('#cp-error');
    err.classList.add('hidden');
    const o = $('#cp-old').value;
    const a = $('#cp-new').value;
    const b = $('#cp-new2').value;
    if (a.length < 8) return fail(err, 'A nova senha precisa de pelo menos 8 caracteres.');
    if (a !== b) return fail(err, 'A nova senha e a repeticao nao batem.');
    try {
      await V.changeMasterPassword(o, a);
      closeModal('#modal-changepw');
      toast('Senha-mestra trocada. Sincronize para atualizar o Drive.', 'ok');
      updateSyncChip();
    } catch (e) {
      fail(err, 'Senha atual incorreta.');
    }
  });

  $('#cfg-export').addEventListener('click', async () => {
    const env = await V.currentEnvelope();
    const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cofre-backup-' + new Date().toISOString().slice(0, 10) + '.enc';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup cifrado baixado.', 'ok');
  });

  $('#cfg-import').addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    try {
      const env = JSON.parse(await f.text());
      pendingRemote = env;
      remoteMode = 'adopt';
      closeModal('#modal-settings');
      $('#rm-pw').value = '';
      $('#rm-error').classList.add('hidden');
      openModal('#modal-remote');
    } catch (e) {
      toast('Arquivo de backup invalido.', 'err');
    }
    ev.target.value = '';
  });

  $('#cfg-import-csv').addEventListener('click', () => {
    closeModal('#modal-settings');
    resetImportModal();
    openModal('#modal-import');
  });

  $('#cfg-wipe').addEventListener('click', async () => {
    if (!confirm('Apagar o cofre deste dispositivo?\n\nA copia no Drive e seus backups continuam intactos.')) return;
    await S.dropEnvelope();
    location.reload();
  });
}

function updateDriveStateLabel() {
  $('#cfg-drive-state').textContent = D.isConnected() ? 'conectado' : 'nao conectado';
}

/* ============================================================
   SINCRONIZACAO
   ============================================================ */

let syncTimer = null;

function autoSyncSoon() {
  if (!cfg.driveClientId) return;
  // sem rede nao adianta tentar: o evento 'online' cuida disso depois
  if (!navigator.onLine) { updateSyncChip(); return; }
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => doSync(true), 2500);
}

/** A falha veio de falta de rede, e nao de um erro de verdade do Drive? */
function ehFalhaDeRede(e) {
  if (!navigator.onLine) return true;
  const m = String((e && e.message) || e);
  return /failed to fetch|networkerror|network request failed|net::/i.test(m);
}

function updateSyncChip() {
  const chip = $('#sync-state');
  if (!cfg.driveClientId) {
    chip.textContent = 'Drive nao configurado';
    chip.className = 'chip sync off';
    return;
  }
  if (!navigator.onLine) {
    chip.textContent = V.isDirty() ? 'sem conexao - pendente' : 'sem conexao';
    chip.className = 'chip sync pending';
    return;
  }
  if (V.isDirty()) {
    chip.textContent = 'alteracoes pendentes';
    chip.className = 'chip sync pending';
    return;
  }
  chip.textContent = cfg.lastSyncAt
    ? 'sincronizado ' + new Date(cfg.lastSyncAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : 'nunca sincronizado';
  chip.className = 'chip sync' + (cfg.lastSyncAt ? ' ok' : '');
}

async function doSync(silent) {
  if (!V.isUnlocked()) return;
  if (!cfg.driveClientId) {
    if (!silent) toast('Configure o ID do cliente OAuth nas Configuracoes.', 'err');
    return;
  }
  if (!navigator.onLine) {
    updateSyncChip();
    if (!silent) toast('Sem internet. Sincronizo assim que a conexao voltar.');
    return;
  }

  const chip = $('#sync-state');
  chip.textContent = 'sincronizando...';
  chip.className = 'chip sync pending';

  try {
    const clientId = cfg.driveClientId;
    let file = null;

    if (cfg.driveFileId) {
      try {
        file = await D.fileMeta(clientId, cfg.driveFileId);
      } catch (e) {
        file = null; // arquivo apagado ou sem acesso: procura de novo
      }
    }
    if (!file) file = await D.findVaultFile(clientId);

    // 1) nao existe cofre no Drive: sobe o nosso
    if (!file) {
      const env = await V.currentEnvelope();
      const up = await D.uploadVault(clientId, env, null, cfg.driveFolderId);
      cfg = await S.saveConfig({
        driveFileId: up.id,
        driveFolderId: up.folderId || cfg.driveFolderId,
        lastSyncAt: new Date().toISOString(),
        lastSyncRev: V.revision(),
      });
      V.markSynced();
      updateSyncChip();
      toast('Cofre enviado ao Drive.', 'ok');
      return;
    }

    // 2) existe: baixa e compara
    const remote = await D.downloadVault(clientId, file.id);
    const remoteRev = Number(remote.rev || 0);
    const localRev = V.revision();

    if (remoteRev === cfg.lastSyncRev && !V.isDirty()) {
      cfg = await S.saveConfig({ driveFileId: file.id, lastSyncAt: new Date().toISOString() });
      updateSyncChip();
      if (!silent) toast('Tudo em dia.', 'ok');
      return;
    }

    // chave diferente? (senha-mestra trocada no outro dispositivo)
    if (!V.sameKeyAs(remote)) {
      pendingRemote = remote;
      remoteMode = 'merge';
      $('#rm-pw').value = '';
      $('#rm-error').classList.add('hidden');
      openModal('#modal-remote');
      updateSyncChip();
      return;
    }

    const remotePayload = await V.decryptWithCurrentKey(remote);
    const res = await V.mergeRemote(remotePayload);
    const merged = await V.currentEnvelope();
    const up = await D.uploadVault(clientId, merged, file.id, cfg.driveFolderId);

    cfg = await S.saveConfig({
      driveFileId: up.id || file.id,
      lastSyncAt: new Date().toISOString(),
      lastSyncRev: V.revision(),
    });
    V.markSynced();
    render();
    updateSyncChip();

    if (res.added || res.updated) {
      toast('Sincronizado: ' + res.added + ' nova(s), ' + res.updated + ' atualizada(s).', 'ok');
    } else if (!silent) {
      toast('Sincronizado (local era mais novo: rev ' + localRev + ').', 'ok');
    }
  } catch (e) {
    updateSyncChip();
    if (ehFalhaDeRede(e)) {
      // nao e erro do usuario: o cofre local ja esta salvo e cifrado
      if (!silent) toast('Sem internet. As alteracoes ficam salvas e sobem quando a conexao voltar.');
    } else {
      toast(e.message, 'err');
    }
  }
}

function wireRemoteModal() {
  $('#rm-go').addEventListener('click', async () => {
    const err = $('#rm-error');
    err.classList.add('hidden');
    const pw = $('#rm-pw').value;
    if (!pw || !pendingRemote) return;

    try {
      if (remoteMode === 'adopt') {
        await V.adoptEnvelope(pendingRemote, pw);
        pendingRemote = null;
        closeModal('#modal-remote');
        cfg = await S.saveConfig({ lastSyncRev: V.revision() });
        await enterVault();
        toast('Cofre restaurado neste dispositivo.', 'ok');
        return;
      }
      // merge: abre o remoto com a senha dele e mescla no local
      const opened = await C.unlockEnvelope(pendingRemote, pw);
      pendingRemote = null;
      closeModal('#modal-remote');
      const res = await V.mergeRemote(opened.payload);
      const merged = await V.currentEnvelope();
      const up = await D.uploadVault(cfg.driveClientId, merged, cfg.driveFileId, cfg.driveFolderId);
      cfg = await S.saveConfig({
        driveFileId: up.id || cfg.driveFileId,
        lastSyncAt: new Date().toISOString(),
        lastSyncRev: V.revision(),
      });
      V.markSynced();
      render();
      updateSyncChip();
      toast('Mesclado: ' + res.added + ' nova(s), ' + res.updated + ' atualizada(s).', 'ok');
    } catch (e) {
      fail(err, 'Senha incorreta para esse cofre.');
    }
  });
}

/* ============================================================
   RESTAURAR EM DISPOSITIVO NOVO
   ============================================================ */

function wireRestore() {
  $('#rs-file').addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    try {
      pendingRemote = JSON.parse(await f.text());
      remoteMode = 'adopt';
      closeModal('#modal-restore');
      $('#rm-pw').value = '';
      openModal('#modal-remote');
    } catch (e) {
      toast('Arquivo de backup invalido.', 'err');
    }
    ev.target.value = '';
  });

  $('#rs-drive').addEventListener('click', async () => {
    const id = $('#rs-clientid').value.trim();
    if (!id) return toast('Cole o ID do cliente OAuth.', 'err');
    cfg = await S.saveConfig({ driveClientId: id });
    try {
      await D.connect(id, true);
      const file = await D.findVaultFile(id);
      if (!file) return toast('Nenhum cofre.enc encontrado nesta conta do Drive.', 'err');
      pendingRemote = await D.downloadVault(id, file.id);
      remoteMode = 'adopt';
      cfg = await S.saveConfig({ driveFileId: file.id });
      closeModal('#modal-restore');
      $('#rm-pw').value = '';
      openModal('#modal-remote');
    } catch (e) {
      toast(e.message, 'err');
    }
  });
}

/* ============================================================
   BLOQUEIO AUTOMATICO
   ============================================================ */

function resetLockTimer() {
  if (lockTimer) clearTimeout(lockTimer);
  if (!V.isUnlocked()) return;
  const mins = Math.max(1, Number(cfg.autoLockMinutes) || 5);
  lockTimer = setTimeout(lockNow, mins * 60 * 1000);
}

function lockNow() {
  V.lock();
  $$('.modal').forEach((m) => m.classList.add('hidden'));
  $('#search').value = '';
  $('#list').innerHTML = '';
  $('#unlock-pw').value = '';
  $('#unlock-error').classList.add('hidden');
  screen('#screen-lock');
  $('#unlock-pw').focus();
}

/* ============================================================
   LIGACAO GERAL DOS EVENTOS
   ============================================================ */

function wireEvents() {
  wireSetup();
  wireUnlock();
  wireEntry();
  wireGenerator();
  wireImport();
  wireSettings();
  wireRemoteModal();
  wireRestore();

  $('#search').addEventListener('input', render);
  $('#btn-new').addEventListener('click', () => openEntry(null));
  $('#empty-new').addEventListener('click', () => openEntry(null));
  $('#empty-import').addEventListener('click', () => { resetImportModal(); openModal('#modal-import'); });
  $('#btn-lock').addEventListener('click', lockNow);
  $('#btn-sync').addEventListener('click', () => doSync(false));

  // fechar modais
  $$('[data-close]').forEach((b) => {
    b.addEventListener('click', () => {
      const m = b.closest('.modal');
      if (m) m.classList.add('hidden');
    });
  });
  $$('.modal').forEach((m) => {
    m.addEventListener('click', (ev) => { if (ev.target === m) m.classList.add('hidden'); });
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') $$('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden'));
    if (ev.key === 'l' && (ev.ctrlKey || ev.metaKey) && ev.shiftKey) { ev.preventDefault(); lockNow(); }
  });

  // atividade do usuario reinicia o cronometro de bloqueio
  ['click', 'keydown', 'touchstart', 'mousemove'].forEach((evt) => {
    document.addEventListener(evt, throttle(resetLockTimer, 20000), { passive: true });
  });

  // a conexao voltou: sincroniza na hora, sem esperar reabrir o app
  window.addEventListener('online', () => {
    updateSyncChip();
    if (V.isUnlocked() && cfg.driveClientId) {
      toast('Conexao de volta. Sincronizando...');
      doSync(true);
    }
  });
  window.addEventListener('offline', updateSyncChip);

  // bloqueia ao voltar de segundo plano depois de muito tempo
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > (cfg.autoLockMinutes || 5) * 60 * 1000) lockNow();
  });
}

function throttle(fn, ms) {
  let last = 0;
  return function () {
    const now = Date.now();
    if (now - last > ms) { last = now; fn(); }
  };
}

boot();
