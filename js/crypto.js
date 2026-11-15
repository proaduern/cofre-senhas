/* ============================================================
   crypto.js - camada criptografica do cofre
   ------------------------------------------------------------
   Principios:
   - A senha-mestra NUNCA e armazenada em disco.
   - Dela derivamos uma chave via PBKDF2-SHA256 (WebCrypto nativo).
   - O cofre e cifrado com AES-256-GCM (confidencialidade + integridade).
   - O cabecalho em claro (kdf, iv, rev) entra como AAD, portanto e
     autenticado: ninguem altera o cabecalho sem invalidar o cofre.
   ============================================================ */

export const KDF_ITERATIONS = 600000; // recomendacao OWASP p/ PBKDF2-SHA256
const FORMAT = 'cofre-v1';

/* ---------- utilitarios base64 <-> bytes ---------- */

export function bytesToB64(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, arr.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/* ---------- derivacao de chave ---------- */

/**
 * Deriva a chave AES a partir da senha-mestra.
 * Retorna um CryptoKey nao-extraivel: nem o proprio JS le os bytes dela.
 */
export async function deriveKey(masterPassword, saltBytes, iterations = KDF_ITERATIONS) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(masterPassword.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // nao extraivel
    ['encrypt', 'decrypt']
  );
}

/* ---------- cifra / decifra do cofre ---------- */

/** Serializacao estavel do cabecalho: a ordem precisa ser identica ao cifrar e decifrar. */
function canonicalAad(h) {
  return [
    h.fmt,
    h.kdf.alg,
    h.kdf.iter,
    h.kdf.salt,
    h.cipher,
    h.iv,
    h.rev,
    h.updatedAt,
  ].join('|');
}

/**
 * Cifra o objeto do cofre e devolve o envelope pronto para gravar/subir.
 */
export async function encryptVault(payload, key, salt, iterations = KDF_ITERATIONS) {
  const iv = randomBytes(12); // 96 bits, tamanho canonico do GCM
  const header = {
    fmt: FORMAT,
    kdf: { alg: 'PBKDF2-SHA256', iter: iterations, salt: bytesToB64(salt) },
    cipher: 'AES-GCM-256',
    iv: bytesToB64(iv),
    rev: payload.rev || 1,
    updatedAt: new Date().toISOString(),
  };
  const aad = enc.encode(canonicalAad(header));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    enc.encode(JSON.stringify(payload))
  );
  return Object.assign({}, header, { ct: bytesToB64(ct) });
}

/**
 * Decifra um envelope. Lanca erro se a senha estiver errada OU se o
 * arquivo tiver sido adulterado - o GCM detecta os dois casos.
 */
export async function decryptVault(envelope, key) {
  if (!envelope || envelope.fmt !== FORMAT) {
    throw new Error('Formato de cofre desconhecido.');
  }
  const header = Object.assign({}, envelope);
  delete header.ct;
  const aad = enc.encode(canonicalAad(header));
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: b64ToBytes(envelope.iv),
      additionalData: aad,
      tagLength: 128,
    },
    key,
    b64ToBytes(envelope.ct)
  );
  return JSON.parse(dec.decode(plain));
}

/** Abre um envelope a partir da senha-mestra, reusando o sal do proprio arquivo. */
export async function unlockEnvelope(envelope, masterPassword) {
  const salt = b64ToBytes(envelope.kdf.salt);
  const key = await deriveKey(masterPassword, salt, envelope.kdf.iter);
  const payload = await decryptVault(envelope, key); // falha aqui = senha errada
  return { key, salt, iterations: envelope.kdf.iter, payload };
}

/* ---------- gerador de senhas ---------- */

const SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz', // sem o "l"
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',  // sem "I" e "O"
  digits: '23456789',                 // sem "0" e "1"
  symbols: '!@#$%&*+-=?_~',
};

/** Sorteio uniforme por rejeicao - evita o vies do operador modulo. */
function pick(alphabet) {
  const n = alphabet.length;
  const limit = Math.floor(256 / n) * n;
  const buf = new Uint8Array(1);
  let v;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return alphabet[v % n];
}

export function generatePassword(opts) {
  const o = opts || {};
  const length = o.length || 20;
  const avoid = o.avoidAmbiguous !== false;

  const groups = [];
  if (o.lower !== false) groups.push(avoid ? SETS.lower : SETS.lower + 'l');
  if (o.upper !== false) groups.push(avoid ? SETS.upper : SETS.upper + 'IO');
  if (o.digits !== false) groups.push(avoid ? SETS.digits : SETS.digits + '01');
  if (o.symbols !== false) groups.push(SETS.symbols);
  if (!groups.length) groups.push(SETS.lower);

  const alphabet = groups.join('');
  const out = [];
  // garante pelo menos um caractere de cada grupo escolhido
  for (const g of groups) out.push(pick(g));
  while (out.length < length) out.push(pick(alphabet));

  // embaralhamento Fisher-Yates com fonte criptografica
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out.slice(0, Math.max(length, groups.length)).join('');
}

/** Frase-senha memorizavel: boa opcao para a senha-mestra. */
const WORDS = ('agua arco areia barco bravo cacto calma campo canto carro ceu chave chuva cinza corda '
  + 'couro dedo doce duna faca farol festa fibra flora folha forte fruta fuga gelo girassol globo grao '
  + 'horta ilha jarro janela lago lapis leite letra livro lontra lua luva malha mapa marco mesa mina '
  + 'nave neve nevoa noite norte nuvem onda ouro palha pedra pena pinho placa ponte porta prata '
  + 'praia prado queda quilo raio ramo rede rio rocha roda sal selo serra sino solo sombra sul '
  + 'teia telha terra torre trevo trigo tubo vale vapor vela vento verde vidro vinho voz zebra').split(' ');

export function generatePassphrase(words, sep) {
  const n = words || 4;
  const s = sep || '-';
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(WORDS[crypto.getRandomValues(new Uint32Array(1))[0] % WORDS.length]);
  }
  const num = crypto.getRandomValues(new Uint32Array(1))[0] % 90 + 10;
  return out.join(s) + s + num;
}

/* ---------- estimativa de forca ---------- */

export function estimateStrength(pw) {
  if (!pw) return { bits: 0, label: 'vazia', level: 0 };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 25;
  const unique = new Set(pw).size;
  // penaliza repeticao: "aaaaaaaa" tem entropia real baixa
  const effective = Math.min(pw.length, unique * 1.6 + 2);
  const bits = Math.round(effective * Math.log2(pool || 2));
  let level = 0;
  let label = 'muito fraca';
  if (bits >= 40) { level = 1; label = 'fraca'; }
  if (bits >= 60) { level = 2; label = 'razoavel'; }
  if (bits >= 80) { level = 3; label = 'forte'; }
  if (bits >= 100) { level = 4; label = 'excelente'; }
  return { bits, label, level };
}
