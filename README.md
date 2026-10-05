# Naukri Profile Refresh

Keeps your Naukri profile "recently updated" — recruiters see fresh profiles first.
Every run it toggles a trailing `.` on your **resume headline** and re-uploads your
**resume**, alternating between two PDFs, both of which count as profile updates on
Naukri. Run it in the cloud on GitHub Actions (3 fixed runs a day, laptop can be off),
or locally via Windows Task Scheduler.

- Logs in automatically with your **Google account** (session is saved after the first login).
- Runs in an off-screen Chrome window (Naukri blocks headless browsers).
- Verifies the headline save and the resume upload actually stuck on the server before reporting success.
- All personal data lives in `.env` — nothing sensitive is in the code.

## Requirements

- Windows 10/11 (uses Task Scheduler for the hourly run)
- [Node.js](https://nodejs.org/) 18+
- Google Chrome installed
- A Naukri account that signs in with Google

## Setup

**1. Clone and install:**

```powershell
git clone https://github.com/ankitbaghel01/naukri_update.git
cd naukri_update
npm install
```

**2. Create your `.env`:**

```powershell
copy .env.example .env
```

Open `.env` and fill in at least:

| Variable | What it is |
|---|---|
| `GOOGLE_EMAIL` | The Google account your Naukri profile uses |
| `GOOGLE_PASSWORD` | Its password (used only for the automated sign-in) |
| `NAUKRI_PROFILE_URL` | Your Naukri profile page — the default `https://www.naukri.com/mnjuser/profile` works for every account |
| `RESUME_A_PATH` / `RESUME_B_PATH` | Your two resume PDFs, alternated on every hourly run |

`.env` is git-ignored, so your credentials never get pushed.

**Drop your two resume PDFs in the repo folder** as `resume-a.pdf` and `resume-b.pdf`
(or point `RESUME_A_PATH`/`RESUME_B_PATH` at different files/locations). Every run
uploads whichever one wasn't uploaded last time, tracked in `.naukri-resume-state.json`.
`*.pdf` is git-ignored, so the resumes themselves never get pushed.

**3. First login (one time, visible browser):**

```powershell
node naukri-profile-refresh.js login
```

A Chrome window opens and signs in with Google. If Google asks for 2-step
verification, approve it once — the session is saved to `.naukri-chrome-profile/`
and reused by every later run.

**4. Test a silent run:**

```powershell
node naukri-profile-refresh.js
```

Check `naukri-refresh.log` — you should see a line like:

```
[27/7/2026, 1:05:12 pm] OK: headline dot added (verified) → "AI Full Stack Developer | ..."
[27/7/2026, 1:05:12 pm] OK: resume A uploaded (verified, same-day, date text unchanged as expected) → "resume-a.pdf", profile shows "Uploaded on: 27 Jul'26"
```

## Run it hourly (Task Scheduler)

Run this once in PowerShell (adjust the path to where you cloned the repo):

```powershell
$repo = "C:\path\to\auto-apply"
$action  = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$repo\run-hidden.vbs`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "NaukriProfileRefresh" -Action $action -Trigger $trigger -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable)
```

That's it — the script now refreshes your profile every hour while your PC is on.
`run-hidden.vbs` launches it without a console window, so scheduled runs never steal focus from what you're doing.

Useful commands:

```powershell
Get-ScheduledTask NaukriProfileRefresh            # check status
Start-ScheduledTask NaukriProfileRefresh          # run now
Disable-ScheduledTask NaukriProfileRefresh        # pause
Enable-ScheduledTask NaukriProfileRefresh         # resume
Unregister-ScheduledTask NaukriProfileRefresh     # remove
```

## Run it in the cloud (GitHub Actions — laptop can be off)

`.github/workflows/naukri-refresh.yml` runs the refresh on GitHub's servers daily at
**exactly 08:00, 09:18 and 14:00 IST** (no random delay). Free on public repos.
GitHub's scheduler can still queue a run a few minutes late under load — that part is outside our control.

The laptop's logged-in session and both resumes are shipped to CI **encrypted** in `ci-secrets/*.enc`
(AES-256-GCM); only the passphrase lives in GitHub secrets.

1. `npm run export-session` — exports the session + resumes into `ci-secrets/*.enc` and creates `.ci-passphrase` (git-ignored).
2. Repo → Settings → Secrets and variables → Actions → **New repository secret**:
   name `CI_SECRETS_PASSPHRASE`, value = contents of `.ci-passphrase`.
3. Commit + push `ci-secrets/*.enc`, then Actions → *Naukri profile refresh* → **Run workflow** to test.

When a run fails with `session expired` (or you change a resume), repeat step 1 and push — the passphrase stays the same.

### Checking that it ran (and worked)

Repo → **Actions** tab → **Naukri profile refresh**. Every run is one row:

| You see | Meaning |
|---|---|
| ✅ green row | Profile updated — headline + resume both verified on Naukri's server |
| ❌ red row | Run failed — GitHub also emails you |
| No row near a slot | Scheduler didn't fire (GitHub's cron is best-effort; rare) |

Click a run to see, at the top of the page (the **run summary**):

```
### Naukri refresh — success — 30 Sep 2026, 08:00 IST
[30/9/2026, 8:00:21 am] OK: headline dot added (verified) → "SDE | React.js | ..."
[30/9/2026, 8:01:07 am] OK: resume A uploaded (verified, ...) → "resume-a.pdf", profile shows "Uploaded on Sep 30, 2026"
```

For step-by-step output, click the **refresh** job → expand any step (the *Refresh profile* step has the full script output).

### When a run fails

1. Read the `ERROR:` line in the run summary.
   - `session expired` → `npm run export-session`, commit + push `ci-secrets/*.enc`.
   - `CI_SECRETS_PASSPHRASE is not set` / `unable to authenticate data` → the repo secret is missing or wrong; re-copy `.ci-passphrase`.
   - Timeouts on the headline editor → Naukri changed its page (or a new popup); check the screenshots.
2. Screenshots: the failed run's **Artifacts** section has `naukri-refresh-debug` (kept 7 days).
   The screenshots are **encrypted** (public repo — artifacts are downloadable by anyone), so unzip it
   into a folder and run `node ci/crypto.js decrypt <that-folder>` in this repo to get the `.png` files.

### What's public and what isn't

The repo, Actions logs and artifacts are public. Nothing personal is readable there:
the session cookies, both resumes and failure screenshots are AES-256-GCM encrypted (`*.enc`),
and the passphrase exists only in `.ci-passphrase` (git-ignored, on the laptop) and in GitHub's encrypted secrets.
`.env`, `*.pdf`, `.naukri-chrome-profile/` and plaintext `ci-secrets/*` are git-ignored.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Google login did not complete` in the log | Run `node naukri-profile-refresh.js login` and approve the 2-step verification prompt once manually. |
| `save did not stick` in the log | Naukri changed its headline editor — open an issue. |
| `resume upload did not stick` / `resume upload rejected by Naukri` in the log | Naukri changed its resume-upload control, or the PDF was rejected (size/format) — check the error screenshot. |
| `resume file missing` in the log | `RESUME_A_PATH`/`RESUME_B_PATH` points at a file that isn't there — check `.env`. |
| Any other error | Check `naukri-refresh-error-*.png` screenshots in the repo folder — they show exactly what the browser saw when it failed. |
| Want to start fresh | Delete the `.naukri-chrome-profile/` folder and run the `login` step again. |

## Files

| File | Purpose |
|---|---|
| `naukri-profile-refresh.js` | The refresh script |
| `config.js` | Loads `.env` (no dependencies) |
| `.env.example` | Template — copy to `.env` and fill in |
| `resume-a.pdf` / `resume-b.pdf` | Your two resumes, alternated each run (git-ignored) |
| `naukri-refresh.log` | Run history (git-ignored) |
| `.naukri-chrome-profile/` | Saved Chrome session (git-ignored) |
| `.naukri-resume-state.json` | Tracks which resume was uploaded last (git-ignored) |
| `run-hidden.vbs` | Launches the local scheduled run without a console window |
| `.github/workflows/naukri-refresh.yml` | GitHub Actions schedule (08:00 / 09:18 / 14:00 IST exact) |
| `ci/export-session.js` | `npm run export-session` — exports the laptop session + resumes, encrypted, for CI |
| `ci/crypto.js` | AES-256-GCM encrypt/decrypt for `ci-secrets/` and failure screenshots |
| `ci-secrets/*.enc` | Encrypted session + resumes used by CI (the only committed secrets — unreadable without the passphrase) |
| `.ci-passphrase` | The passphrase (git-ignored; also stored as the `CI_SECRETS_PASSPHRASE` repo secret) |

## Disclaimer

Automating your own profile may be against Naukri's Terms of Service. It edits
your own headline and re-uploads your own resume at a slow, human-like (hourly)
rate, but use at your own risk — frequent resume re-uploads are a stronger
signal than the headline tweak, so this may draw more scrutiny.
