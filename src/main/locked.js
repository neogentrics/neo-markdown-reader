'use strict';
// Password-locked documents (.mdlock).
//
// A locked file is a small JSON envelope around AES-256-GCM ciphertext. The key comes from the
// password through scrypt (N = 2^17, r = 8, p = 1, a 16-byte random salt). Everything about the
// document — its text, its original name — is inside the ciphertext; the envelope only carries what
// is needed to decrypt it. GCM authenticates both the ciphertext and the envelope's parameters, so a
// wrong password or a tampered file is detected rather than producing garbage.
//
// There is no recovery: without the password the content cannot be read. That is the point.
const crypto = require('node:crypto');

const FORMAT = 'neo-markdown-locked';
const VERSION = 1;
const KDF_DEFAULT = Object.freeze({ name: 'scrypt', N: 2 ** 17, r: 8, p: 1 });
// Limits for files we read, so a crafted file can't make scrypt eat the machine.
const KDF_MAX = { N: 2 ** 20, r: 16, p: 4 };
const MAX_FILE = 80 * 1024 * 1024;
const MIN_PASSWORD = 8;

class WrongPasswordError extends Error {
  constructor() { super('That password isn’t right.'); this.code = 'WRONG_PASSWORD'; }
}
class NotLockedError extends Error {
  constructor(msg = 'This isn’t a locked Neo Markdown Reader document, or it is damaged.') { super(msg); this.code = 'NOT_LOCKED'; }
}

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => Buffer.from(String(s), 'base64');

function deriveKey(password, salt, kdf = KDF_DEFAULT) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password).normalize('NFC'), salt, 32,
      { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r + 16 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** The envelope's parameters, authenticated as additional data. */
function aad(env) {
  return Buffer.from(`${FORMAT}|${env.version}|${env.kdf.name}|${env.kdf.N}|${env.kdf.r}|${env.kdf.p}|${env.kdf.salt}`, 'utf8');
}

/** Encrypt with an already-derived key (re-saving an unlocked document keeps its salt and key). */
function sealWithKey({ content, name }, key, { salt, kdf = KDF_DEFAULT }) {
  const env = { format: FORMAT, version: VERSION, kdf: { ...kdf, salt: b64(salt) }, cipher: 'aes-256-gcm' };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(env));
  const plain = Buffer.from(JSON.stringify({ name: String(name || ''), content: String(content ?? '') }), 'utf8');
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return JSON.stringify({ ...env, iv: b64(iv), tag: b64(cipher.getAuthTag()), data: b64(data) }, null, 1) + '\n';
}

/** Lock a document with a password. Resolves to { text, key, salt, kdf }. */
async function lock({ content, name }, password, kdf = KDF_DEFAULT) {
  if (typeof password !== 'string' || [...password].length < MIN_PASSWORD) throw new Error(`Use a password of at least ${MIN_PASSWORD} characters.`);
  const salt = crypto.randomBytes(16);
  const key = await deriveKey(password, salt, kdf);
  return { text: sealWithKey({ content, name }, key, { salt, kdf }), key, salt, kdf };
}

/** Parse and sanity-check an envelope. */
function parseEnvelope(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE) throw new NotLockedError();
  let env;
  try { env = JSON.parse(text); } catch { throw new NotLockedError(); }
  const k = env?.kdf;
  if (!env || env.format !== FORMAT || env.cipher !== 'aes-256-gcm' || !k || k.name !== 'scrypt') throw new NotLockedError();
  if (env.version !== VERSION) throw new NotLockedError('This locked document was made by a newer version of Neo Markdown Reader. Update the app to open it.');
  const pow2 = (n) => Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;
  if (!pow2(k.N) || k.N > KDF_MAX.N || !Number.isInteger(k.r) || k.r < 1 || k.r > KDF_MAX.r || !Number.isInteger(k.p) || k.p < 1 || k.p > KDF_MAX.p) throw new NotLockedError();
  for (const f of ['iv', 'tag', 'data']) if (typeof env[f] !== 'string') throw new NotLockedError();
  if (typeof k.salt !== 'string' || unb64(k.salt).length < 16 || unb64(env.iv).length !== 12 || unb64(env.tag).length !== 16) throw new NotLockedError();
  return env;
}

function openWithKey(env, key) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, unb64(env.iv));
    decipher.setAAD(aad(env));
    decipher.setAuthTag(unb64(env.tag));
    const plain = Buffer.concat([decipher.update(unb64(env.data)), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plain);
    return { content: String(payload.content ?? ''), name: String(payload.name || '') };
  } catch { throw new WrongPasswordError(); }
}

/** Unlock with a password. Resolves to { content, name, key, salt, kdf }. */
async function unlock(text, password) {
  const env = parseEnvelope(text);
  const salt = unb64(env.kdf.salt);
  const kdf = { name: 'scrypt', N: env.kdf.N, r: env.kdf.r, p: env.kdf.p };
  const key = await deriveKey(String(password ?? ''), salt, kdf);
  return { ...openWithKey(env, key), key, salt, kdf };
}

/** Unlock with a key remembered from an earlier unlock (live reload, reopening a tab). */
function unlockWithKey(text, key) {
  return openWithKey(parseEnvelope(text), key);
}

/** Does this text look like a locked document? */
function isLockedText(text) {
  try { parseEnvelope(text); return true; } catch { return false; }
}

module.exports = { lock, unlock, unlockWithKey, sealWithKey, parseEnvelope, isLockedText, deriveKey, WrongPasswordError, NotLockedError, KDF_DEFAULT, MIN_PASSWORD, FORMAT };
