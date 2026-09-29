/**
 * AES-256-GCM file encryption (key from a passphrase via scrypt), so private files can live in a public repo
 * or public CI artifacts. Passphrase: CI_SECRETS_PASSPHRASE env var, else the local .ci-passphrase file.
 *
 *   node ci/crypto.js decrypt [dir]      decrypt every *.enc in dir (default ci-secrets/) next to itself
 *   node ci/crypto.js encrypt <files...> write <file>.enc next to each existing file
 *
 * The session + resumes are encrypted via `npm run export-session`, which creates .ci-passphrase on first use.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SECRETS_DIR = path.join(ROOT, 'ci-secrets');
const PASSPHRASE_FILE = path.join(ROOT, '.ci-passphrase');

function passphrase({ create = false } = {}) {
  if (process.env.CI_SECRETS_PASSPHRASE) return process.env.CI_SECRETS_PASSPHRASE;
  if (!fs.existsSync(PASSPHRASE_FILE)) {
    if (!create) throw new Error('no passphrase: set CI_SECRETS_PASSPHRASE or run "npm run export-session" first');
    fs.writeFileSync(PASSPHRASE_FILE, crypto.randomBytes(32).toString('base64url'));
    console.log(`created ${PASSPHRASE_FILE} — add its contents as the CI_SECRETS_PASSPHRASE repo secret`);
  }
  return fs.readFileSync(PASSPHRASE_FILE, 'utf8').trim();
}

function encryptFile(src, dest, pass) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(pass, salt, 32), iv);
  const body = Buffer.concat([cipher.update(fs.readFileSync(src)), cipher.final()]);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.concat([salt, iv, cipher.getAuthTag(), body]));
}

function decryptDir(dir, pass) {
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.enc'))) {
    const buf = fs.readFileSync(path.join(dir, f));
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(pass, buf.subarray(0, 16), 32), buf.subarray(16, 28));
    decipher.setAuthTag(buf.subarray(28, 44));
    fs.writeFileSync(path.join(dir, f.slice(0, -4)), Buffer.concat([decipher.update(buf.subarray(44)), decipher.final()]));
    console.log(`decrypted ${f}`);
  }
}

function encryptAll(files) {
  const pass = passphrase({ create: true });
  for (const [src, name] of files) {
    encryptFile(src, path.join(SECRETS_DIR, `${name}.enc`), pass);
    console.log(`encrypted ${path.basename(src)} → ci-secrets/${name}.enc`);
  }
}

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'decrypt') {
    decryptDir(args[0] || SECRETS_DIR, passphrase());
  } else if (cmd === 'encrypt') {
    const files = args.filter((f) => fs.existsSync(f));
    const pass = files.length ? passphrase() : '';
    for (const f of files) {
      encryptFile(f, `${f}.enc`, pass);
      console.log(`encrypted ${f}`);
    }
  } else {
    console.error('usage: node ci/crypto.js decrypt [dir] | encrypt <files...>');
    process.exitCode = 1;
  }
}

module.exports = { encryptAll, SECRETS_DIR };
