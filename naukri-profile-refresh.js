/**
 * Naukri Profile Refresh — toggles a trailing "." on the resume headline
 * and re-uploads the resume PDF, alternating between two files, so the
 * profile counts as "updated" every run.
 *
 * Hourly:  Windows Task Scheduler runs:  node naukri-profile-refresh.js   (off-screen Chrome)
 * Debug:   node naukri-profile-refresh.js login                           (visible Chrome window)
 *
 * Login is automatic: if the Naukri session is gone, it signs in with the
 * Google account below. Headline state lives in the headline itself:
 * ends with "." → remove it, else add it. Resume-alternation state lives
 * in .naukri-resume-state.json (which file was uploaded last).
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { CREDS, naukriProfileUrl, resumeAPath, resumeBPath } = require('./config'); // credentials + profile URL + resume paths come from .env, never hard-coded

const PROFILE_URL = naukriProfileUrl;
const LOGIN_URL = `https://www.naukri.com/nlogin/login?URL=${PROFILE_URL}`;

const PROFILE_DIR = path.join(__dirname, '.naukri-chrome-profile');
const LOG_FILE = path.join(__dirname, 'naukri-refresh.log');
const ERROR_SHOT = path.join(__dirname, 'naukri-refresh-error.png');
const RESUME_STATE_FILE = path.join(__dirname, '.naukri-resume-state.json');
const LOGIN_MODE = process.argv[2] === 'login';

const MAX_ATTEMPTS = 3;
const GOTO_TIMEOUT = 90000;
const EDIT_TIMEOUT = 45000;
const TEXTAREA_TIMEOUT = 45000;

const log = (msg) => {
  const line = `[${new Date().toLocaleString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const onProfile = (url) => url.pathname.startsWith('/mnjuser');

async function gotoRetry(page, url, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });
      return;
    } catch (err) {
      lastErr = err;
      log(`goto retry ${i}/${tries}: ${err.message.split('\n')[0]}`);
      await sleep(2000 * i);
    }
  }
  throw lastErr;
}

async function googleLogin(ctx, page) {
  log('Session gone — signing in with Google...');
  await gotoRetry(page, LOGIN_URL);

  // Naukri's "Sign in with Google" is a plain div.socialbtn.google
  const googleBtn = page.locator('.socialbtn.google, [class*="socialbtn"][class*="google"], button:has-text("Sign in with Google")').first();
  await googleBtn.waitFor({ timeout: 30000 });
  await googleBtn.click();

  // The Google sign-in may open a popup OR replace the current tab — find it either way
  let g = null;
  for (let i = 0; i < 45 && !g; i++) {
    await sleep(1000);
    g = ctx.pages().find((p) => /accounts\.google\./.test(p.url())) || null;
  }
  if (!g) throw new Error('Google sign-in page never appeared');
  await g.waitForLoadState('domcontentloaded');

  // Account already known to this Chrome profile → click it, else full email+password
  const knownAccount = g.locator(`[data-email="${CREDS.email}"]`).first();
  if (await knownAccount.isVisible().catch(() => false)) {
    await knownAccount.click();
  } else {
    const emailBox = g.locator('input#identifierId, input[type="email"], input[name="identifier"]').first();
    await emailBox.waitFor({ state: 'visible', timeout: 60000 });
    await emailBox.fill(CREDS.email);
    await g.locator('#identifierNext, button:has-text("Next")').first().click();
    const passBox = g.locator('input[type="password"], input[name="Passwd"]').first();
    await passBox.waitFor({ state: 'visible', timeout: 60000 });
    await passBox.fill(CREDS.password);
    await g.locator('#passwordNext, button:has-text("Next")').first().click();
  }

  // Wait until any tab lands back on the logged-in naukri profile
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    // consent screen ("Continue") sometimes follows the password step
    if (!g.isClosed()) {
      await g.locator('button:has-text("Continue")').first().click({ timeout: 500 }).catch(() => {});
    }
    const done = ctx.pages().find((p) => {
      try { return onProfile(new URL(p.url())); } catch { return false; }
    });
    if (done) { log('Google login OK, session saved.'); return done; }
    if (g.isClosed() || /naukri\.com/.test(g.url())) {
      // auth finished but landed elsewhere — go to the profile directly
      await gotoRetry(page, PROFILE_URL).catch(() => {});
      if (onProfile(new URL(page.url()))) { log('Google login OK, session saved.'); return page; }
    }
    await sleep(2000);
  }
  throw new Error(
    'Google login did not complete — likely a 2-step verification prompt. ' +
    'Run "node naukri-profile-refresh.js login" and approve it once manually.'
  );
}

function resumePathFor(label) {
  return label === 'A' ? resumeAPath : resumeBPath;
}

function nextResumeLabel() {
  let last = 'B'; // so the very first run (no state file yet) uploads A
  try {
    last = JSON.parse(fs.readFileSync(RESUME_STATE_FILE, 'utf8')).last || 'B';
  } catch {}
  return last === 'A' ? 'B' : 'A';
}

function saveResumeLabel(label) {
  fs.writeFileSync(RESUME_STATE_FILE, JSON.stringify({ last: label }));
}

async function uploadResume(page) {
  const label = nextResumeLabel();
  const resumePath = resumePathFor(label);
  if (!fs.existsSync(resumePath)) throw new Error(`resume file missing: ${resumePath}`);

  const before = await page.getByText(/Uploaded on/i).first().innerText({ timeout: 10000 }).catch(() => '');

  await page.locator('#attachCV, input[type="file"]').first().setInputFiles(resumePath);

  const success = page.getByText(/uploaded successfully/i).first();
  const failure = page.getByText(/upload failed|something went wrong|invalid file/i).first();
  await Promise.race([
    success.waitFor({ state: 'visible', timeout: TEXTAREA_TIMEOUT }).catch(() => {}),
    failure.waitFor({ state: 'visible', timeout: TEXTAREA_TIMEOUT }).catch(() => {}),
  ]);
  if (await failure.isVisible().catch(() => false)) {
    throw new Error(`resume upload rejected by Naukri: "${(await failure.innerText().catch(() => '')).slice(0, 80)}"`);
  }

  // modal/toast isn't proof the upload stuck — reload from the server and re-read
  await gotoRetry(page, PROFILE_URL);
  const after = await page.getByText(/Uploaded on/i).first().innerText({ timeout: TEXTAREA_TIMEOUT }).catch(() => '');
  if (!after) throw new Error('resume upload did not stick — "Uploaded on" text not found after reload');

  saveResumeLabel(label);
  // Naukri's displayed date is day-granularity, so re-uploading later the same day won't change this text — that's expected, not a failure.
  const changed = after.trim() !== before.trim() ? 'date changed' : 'same-day, date text unchanged as expected';
  log(`OK: resume ${label} uploaded (verified, ${changed}) → "${path.basename(resumePath)}", profile shows "${after.trim()}"`);
  return page;
}

function editIcon(page) {
  return page.locator(
    '#lazyResumeHead span.edit.icon, [data-ga-track*="resumeHeadline"] .edit, #lazyResumeHead .edit, .resumeHeadline .edit, span.edit.icon'
  ).first();
}

function headlineTextarea(page) {
  return page.locator('#resumeHeadline, #resumeHeadlineTxt, textarea.ge__text-area').first();
}

async function dismissSurveyPopup(page) {
  const popup = page.getByText(/how likely are you to recommend/i).first();
  if (!(await popup.isVisible().catch(() => false))) return;

  log('survey popup detected — dismissing before editing headline');

  const closeBtn = page.locator(
    '[role="dialog"] button, [role="dialog"] [aria-label*="close" i], .modal [aria-label*="close" i], .modal button.close, [class*="close"][class*="icon"]'
  ).first();
  await closeBtn.click({ timeout: 3000 }).catch(() => {});

  if (await popup.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
  }
  if (await popup.isVisible().catch(() => false)) {
    await page.mouse.click(10, 10).catch(() => {});
  }
  await popup.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}

async function openHeadlineEditor(page) {
  await dismissSurveyPopup(page);

  const icon = editIcon(page);
  await icon.waitFor({ state: 'visible', timeout: EDIT_TIMEOUT });
  await icon.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(500);

  const box = headlineTextarea(page);
  for (let i = 1; i <= 3; i++) {
    await dismissSurveyPopup(page);
    await icon.click({ timeout: 10000 }).catch(() => {});
    try {
      await box.waitFor({ state: 'visible', timeout: TEXTAREA_TIMEOUT });
      return box;
    } catch (err) {
      if (i === 3) throw err;
      log(`headline editor not ready, re-click ${i}/3`);
      await sleep(1500);
    }
  }
  return box;
}

async function ensureProfile(page, ctx) {
  await gotoRetry(page, PROFILE_URL);
  if (!onProfile(new URL(page.url()))) {
    page = await googleLogin(ctx, page);
  }
  if (!/\/mnjuser\/profile/.test(page.url())) {
    await gotoRetry(page, PROFILE_URL);
  }
  // Give lazy widgets a moment to mount
  await editIcon(page).waitFor({ state: 'visible', timeout: EDIT_TIMEOUT });
  await sleep(800);
  return page;
}

async function refreshOnce(page, ctx) {
  page = await ensureProfile(page, ctx);

  const textarea = await openHeadlineEditor(page);
  const current = (await textarea.inputValue()).trimEnd();
  const updated = current.endsWith('.') ? current.slice(0, -1) : current + '.';

  await textarea.fill(updated);
  await page.getByRole('button', { name: /^save$/i }).first().click();
  await textarea.waitFor({ state: 'hidden', timeout: TEXTAREA_TIMEOUT });

  // modal closing isn't proof the save stuck — reload from the server and re-read
  await gotoRetry(page, PROFILE_URL);
  const verifyBox = await openHeadlineEditor(page);
  const saved = (await verifyBox.inputValue()).trimEnd();
  if (saved !== updated) {
    throw new Error(`save did not stick — server headline is "${saved.slice(0, 60)}", expected "${updated.slice(0, 60)}"`);
  }

  log(`OK: headline ${current.endsWith('.') ? 'dot removed' : 'dot added'} (verified) → "${updated.slice(0, 60)}"`);

  // Resume alternation is optional — skip if PDFs aren't present so headline refresh still succeeds
  if (fs.existsSync(resumeAPath) && fs.existsSync(resumeBPath)) {
    page = await uploadResume(page);
  } else {
    log('skip resume upload — place resume-a.pdf and resume-b.pdf in the repo (or set RESUME_A_PATH / RESUME_B_PATH) to enable');
  }
  return page;
}

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false, // naukri's Akamai bot-check blocks headless; off-screen headed instead
    viewport: { width: 1280, height: 850 },
    args: [
      '--disable-blink-features=AutomationControlled',
      ...(LOGIN_MODE ? [] : ['--window-position=-32000,-32000']),
    ],
  });
  let page = ctx.pages()[0] || (await ctx.newPage());
  let lastErr;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        page = await refreshOnce(page, ctx);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        log(`attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message.split('\n')[0]}`);
        if (attempt < MAX_ATTEMPTS) await sleep(2500 * attempt);
      }
    }

    if (lastErr) {
      const pages = ctx.pages();
      for (let i = 0; i < pages.length; i++) {
        await pages[i].screenshot({ path: ERROR_SHOT.replace('.png', `-${i}.png`) }).catch(() => {});
      }
      log(`ERROR: ${lastErr.message.split('\n')[0]} (screenshots: naukri-refresh-error-*.png)`);
      process.exitCode = 1;
    }
  } finally {
    await ctx.close();
  }
})();
