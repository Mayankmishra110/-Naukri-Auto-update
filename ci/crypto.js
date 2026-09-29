/**
 * Encrypts the Naukri session + resumes into ci-secrets/*.enc (safe to commit to a public repo)
 * and decrypts them inside GitHub Actions. AES-256-GCM, key derived from a passphrase via scrypt.
 *
 *   node ci/crypto.js encrypt   (laptop — passphrase from .ci-passphrase, created on first use)
 *   node ci/crypto.js decrypt   (CI — passphrase from the CI_SECRETS_PASSPHRASE secret)
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SECRETS_DIR = path.join(ROOT, 'ci-secrets');
const PASSPHRASE_FILE = path.join(ROOT, '.ci-passphrase');

function localPassphrase() {
  if (!fs.existsSync(PASSPHRASE_FILE)) {
    fs.writeFileSync(PASSPHRASE_FILE, crypto.randomBytes(32).toString('base64url'));
    console.log(`created ${PASSPHRASE_FILE} — add its contents as the CI_SECRETS_PASSPHRASE repo secret`);
  }
  return fs.readFileSync(PASSPHRASE_FILE, 'utf8').trim();
}

function encryptFile(src, name, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(fs.readFileSync(src)), cipher.final()]);
  fs.mkdirSync(SECRETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SECRETS_DIR, `${name}.enc`), Buffer.concat([salt, iv, cipher.getAuthTag(), body]));
}

function decryptAll(passphrase) {
  for (const f of fs.readdirSync(SECRETS_DIR).filter((f) => f.endsWith('.enc'))) {
    const buf = fs.readFileSync(path.join(SECRETS_DIR, f));
    const key = crypto.scryptSync(passphrase, buf.subarray(0, 16), 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(16, 28));
    decipher.setAuthTag(buf.subarray(28, 44));
    const out = Buffer.concat([decipher.update(buf.subarray(44)), decipher.final()]);
    fs.writeFileSync(path.join(SECRETS_DIR, f.slice(0, -4)), out);
    console.log(`decrypted ${f}`);
  }
}

function encryptAll(files) {
  const passphrase = localPassphrase();
  for (const [src, name] of files) {
    encryptFile(src, name, passphrase);
    console.log(`encrypted ${path.basename(src)} → ci-secrets/${name}.enc`);
  }
}

if (require.main === module) {
  if (process.argv[2] === 'decrypt') {
    const pass = process.env.CI_SECRETS_PASSPHRASE;
    if (!pass) throw new Error('CI_SECRETS_PASSPHRASE is not set');
    decryptAll(pass);
  } else {
    console.error('usage: node ci/crypto.js decrypt  (encryption runs via npm run export-session)');
    process.exitCode = 1;
  }
}

module.exports = { encryptAll, SECRETS_DIR };
