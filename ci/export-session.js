/**
 * Exports the laptop's logged-in Naukri session and encrypts it (plus both resumes) into ci-secrets/
 * for GitHub Actions. Re-run whenever CI reports "session expired", then commit + push ci-secrets/.
 *
 *   npm run export-session
 */
const { chromium } = require('playwright-core');
const path = require('path');
const { naukriProfileUrl, resumeAPath, resumeBPath } = require('../config');
const { encryptAll, SECRETS_DIR } = require('./crypto');

const PROFILE_DIR = path.join(__dirname, '..', '.naukri-chrome-profile');
const SESSION_FILE = path.join(SECRETS_DIR, 'naukri-session.json');

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--window-position=-32000,-32000'],
  });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(naukriProfileUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    if (!new URL(page.url()).pathname.startsWith('/mnjuser')) {
      throw new Error('not logged in on the laptop — run "npm run login" first, then export again');
    }
    await ctx.storageState({ path: SESSION_FILE });
  } finally {
    await ctx.close();
  }

  encryptAll([
    [SESSION_FILE, 'naukri-session.json'],
    [resumeAPath, 'resume-a.pdf'],
    [resumeBPath, 'resume-b.pdf'],
  ]);
  console.log('done — now commit and push ci-secrets/*.enc');
})().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
