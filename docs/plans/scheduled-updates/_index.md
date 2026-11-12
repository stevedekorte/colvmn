---
subtitle: Folders that refresh their own pages on a schedule. An update file in a folder says what to run and when; credentials are named in the tree and kept encrypted.
---
# Scheduled Updates

> Status (2026-11-12): **design settled; script jobs run** (on `main`). `update.js` finds jobs, decides which are due (schedule or `on: push`, `watch`, `minInterval`), runs script jobs with only their listed credentials, resolves credentials from `_credentials/` (nearest description, `blocked`, `.secret` files or environment variables, format checks), checks `writes`, rebuilds the pages, refuses changes containing a credential value, records the run, and publishes (`direct`, or `pr` on a branch per job, pushed and opened with `--push`). Next: prompt jobs, email, the workflow template and the docs page. Agreed with Steve 2026-11-09, 2026-11-10 and 2026-11-12.
>
> This plan covers the general colvmn feature. Site-specific setup lives with each site; the first site is undreamedof.biz (Uo repo: `Servers/GameServer/docs/Plans/Scheduled Updates`).

## Why

Some pages go stale unless someone remembers to update them: reports, timelines, figures. The author's laptop isn't always on, so updates have to run somewhere else, on a schedule, and publish themselves (or open a PR to review).

Rather than a workflow per report, colvmn makes it a feature: **a folder that has an update file refreshes its own page.** Adding a report means adding a file to a folder.

## The update file

A folder that refreshes itself has an `_update.md`. Its frontmatter says when and how; its body is the prompt.

```markdown
---
schedule: weekly            # daily, weekly, monthly, or a cron string
target: _index.md           # default: this folder's _index.md or _index.json
writes: ["Competition/**"]  # what the run may change; anything else fails it
publish: pr                 # pr (review first) or direct
model: claude-sonnet-5-5
budget: 1.00                # dollars per run
---
Research the products listed below. Update each one's card:
pricing, recent launches, notable reviews. Cite sources. Flag anything new
since the last run under "Changes".
```

- **One file, not a prompt file and a schedule file:** the two would drift apart.
- **The target is the folder's own page** unless the file says otherwise. A run may read anything; it may change only what `writes` allows, which defaults to the folder itself.
- **Two kinds of job.** A prompt job has a prompt body and is run by Claude Code. A script job has `run: usage.js` instead and is run by Node. **Numbers come from scripts**, which give the same answer every time, cost nothing, and cannot make up a figure. A prompt job can then read a script's output and write the prose around it.
- **Frontmatter needs lists** (`writes`, `secrets`). colvmn's page parser reads only strings and booleans; the runner reads update files with its own parser, so pages are unaffected.

## The runner

`colvmn/update.js`, general colvmn code with nothing specific to any site:

1. Finds every `_update.md` under the site root.
2. Decides which are due from its schedule and when it last ran (the last-run time is kept next to the file, in `_update.state.json`, committed with the run).
3. Runs each due job, starting in its folder:
   - **Script jobs:** `node <script>`, given only the credentials the job lists (below).
   - **Prompt jobs:** Claude Code in headless mode (`claude -p`), with only the tools a report needs: read, web search, web fetch, and edit/write within `writes`. **No shell**, so the model cannot read the environment.
4. **Checks what changed** (git's list of changed files) against `writes`. Anything outside it fails the run; nothing is committed.
5. **Checks for leaked credentials:** it knows every credential value it handed out, and refuses any changed file that contains one.
6. Rebuilds the pages (`static-gen.js`) and records the run's date and cost where the page can show it ("Updated Nov 9 · $0.42").
7. Publishes: `direct` commits to the site's branch; `pr` puts the change on a branch and opens a PR.

`node colvmn/update.js --folder Competition` runs one job by hand, whether or not it is due. `--dry-run` says what is due and what each job would be given, without running anything.

**Cost:** `budget` is a hard stop per run, checked against the cost Claude Code reports. Prompt jobs default to a smaller model; a run's cost is estimated before a new job is turned on.

## Where it runs

- **Scheduled by GitHub Actions** in the site's repo: one workflow, once a day, that calls the runner. Adding a job never touches the workflow. The schedule, logs and history are on GitHub, visible from anywhere.
- **Jobs that need credentials run on a self-hosted runner**: an always-on machine registered with GitHub, running as **its own non-admin user**, so the operating system keeps jobs and the owner's files apart. If the machine is offline, its jobs wait in the queue rather than fail silently.
- **Jobs without credentials** can run on GitHub's own machines.
- A self-hosted runner serves **only a private repo**, and runs workflows **only from the protected `main` branch**, never from PRs.

colvmn ships a workflow template sites copy, for both kinds of runner.

## Credentials

### Named in the tree, once

Each credential is described by a file named after it, `_credentials/<NAME>.json`:

```json
{ "about": "Stripe restricted key, read-only", "rotated": "2026-11-09", "owner": "Steve" }
```

- **The file name is the credential's name**, in `UPPER_SNAKE_CASE`: the same name as the environment variable the job gets and the GitHub secret (if any). Names say the service and the reach: `STRIPE_READ_KEY`, `GCP_PROD_READER`.
- **The runner looks up from the job's folder to the site root**, and the nearest file wins (as `.gitignore` and CSS cascade). Most sites define everything once, at the root; a lower file only overrides one, or blocks it for a subtree with `{ "blocked": true }`.
- **Defined above a job is not the same as given to it.** A job lists what it uses, `secrets: [STRIPE_READ_KEY]`, and gets only those. A new job anywhere under the root gets nothing it didn't ask for.
- **Prompt jobs may not list any.** The runner refuses to start one that does. Scripts get keys; the model gets the web; no run has both, so a web page telling the model to send a key somewhere has no key to send.

### Values: encrypted in the repo, decryptable only by the runner

The value sits next to its description, `_credentials/<NAME>.secret`, encrypted with **git-crypt under a key of its own** for the site (`git-crypt init -k <site>`; `.gitattributes`: `_credentials/*.secret filter=git-crypt-<site> diff=git-crypt-<site>`).

- **GitHub holds only ciphertext.** A copy of the repo, or a breach at GitHub, exposes nothing.
- **The key is held only by the runner machine** (its runner user), plus **one offline backup**. It is not any key developers share.
- **Adding or rotating a key is drag and drop on the runner machine:** save the file the service gives you as `_credentials/<NAME>.secret` in the runner's unlocked checkout and commit it. git-crypt encrypts it on commit. The runner checks the file's format when it loads it (a Stripe key starts with `rk_`, a service-account file parses) and reports a bad one by name, without printing it.
- **Editors don't see the plain text:** it exists only in the runner user's checkout. Developers' checkouts stay locked, so `.secret` files there are ciphertext.
- **Rotation means revoking the old key at the service**, not just replacing the file: old ciphertext stays in git history.
- Values may also come from environment variables when present (e.g. GitHub Actions secrets).

### Keys that need no secret

- **Cloud providers with keyless access** (e.g. Google Cloud via Workload Identity Federation): the workflow gets a short-lived identity token from GitHub and exchanges it for scoped access. Nothing is stored; this works on GitHub's machines too.
- **Every key should be read-only and narrowly scoped.** The worst a leak should expose is figures that were headed for the site.

### The Anthropic key for prompt jobs

Claude Code needs an API key to run prompt jobs. It is the runner's, not the job's: a separate key with its own spend limit, used only for scheduled updates. Prompt jobs have no shell, so the model cannot read it.

### What this does not protect against

**Someone who can push to the site's repo.** The runner runs code that comes from GitHub, so an attacker controlling the owner's GitHub account could push a workflow that decrypts and sends the keys out. Narrowed by: workflows only from protected `main`, signed commits required for workflow and runner changes, few people with write access, and read-only keys. Taking GitHub out of the trust entirely would mean the runner runs only code checked on it, scheduled locally, which loses the remote logs and visible failures; not worth it while every key is read-only. A credential that ever needs more than read access should get this reconsidered.

## Additions (agreed with Steve, 2026-11-12)

These came out of the AI Reviews idea for the strvct site (strvct repo: `notes/AI Reviews Plan.md`), but are general.

### Run when something changed: `watch`

Today a job is due when its schedule says so. Some jobs should run only when their inputs changed. `watch` links a job to changes in specified folders or files, and works with **any trigger**. One rule: a job runs when its trigger fires **and** something it watches has changed.

```yaml
schedule: daily                 # how often to check
watch: ["llms-full.txt", "AI Reviews/models/models.json"]
minInterval: 30d                # and at most this often
```

```yaml
on: push
watch: ["source"]               # a folder means everything under it
run: classTree.js
```

- **With `on: push`:** the job runs only if the pushed commits touched a watched path. Like GitHub's `paths` filter, but per job, so one workflow serves many jobs, and a push runs only the jobs whose inputs it changed.
- **With `schedule`:** the job runs only if a watched path changed since the commit the last run produced (recorded in `_update.state.json`; see "Jobs must not trigger themselves").
- **Without `watch`:** as today. A scheduled job runs on its schedule; a push job runs on every push.
- **Paths are relative to the site root**, not the job's folder: a job usually watches something outside its own folder (a class-hierarchy job in `docs/` watches `source/`).
- **Folders or globs:** `source` means `source/**`.
- **A job's own output never counts as a change** (its `writes`, and every `_update.state.json`), so no job triggers itself. Other jobs' output does count: that is how one job triggers another.
- `minInterval`: a floor between runs, so a site edited daily doesn't rerun a costly job daily.
- One job can trigger another by writing a file the other watches. Example: a cheap daily script checks providers' model lists and writes `models.json` (published as a PR, since "top model" needs a human to confirm); the review job watches it.

### Credentialed jobs on public repos

The self-hosted runner serves only private repos, so a public site (strvct) can't use the credentials setup above. For keys whose only risk is spend (LLM API keys with low limits), a public repo can use **GitHub-hosted runners with GitHub Actions secrets**, which aren't passed to PRs from forks. The runner already reads values from environment variables. A side benefit: run history on a public repo is public, which is useful when the output should be visibly unedited (AI reviews: every run is on record, so no run can be quietly redone).

### Run on push

Some jobs depend only on the repo, not the outside world: API docs, class hierarchies, the docs HTML, `llms.txt` / `llms-full.txt`, the sitemap. They are deterministic and free, and should run when the code changes, not on a clock:

```yaml
on: push           # instead of schedule
run: classTree.js
```

A workflow that fires on each push to the site's main branch runs the runner with `--on push`, which runs every job with `on: push` whose `watch` paths the push touched (or every one without `watch`), and commits each job's output as its own commit. Keeping these in the runner rather than in a separate release script keeps every "page that refreshes itself" in one place, with one log. (The strvct site treats every push of code as a release; decided 2026-11-12.)

The workflow must not fire on its own follow-up commit: it ignores pushes that change only generated output and job output (`paths-ignore`). GitHub also doesn't start workflow runs for commits pushed with the workflow's own `GITHUB_TOKEN`, but a self-hosted runner pushing with another credential would, so the path filter is the guard to rely on.

A site that prefers one commit per push can instead use a CI check that fails when `static-gen.js` would change anything, leaving regeneration to the author.

### Jobs must not trigger themselves

A job whose output changes something it watches retriggers itself. Found in the AI Reviews design: the runner rebuilds the pages after a run, the rebuild rewrote the build stamp in `llms-full.txt`, and the job watched `llms-full.txt`. Three rules:

1. **A run's own changes never count as new input.** The state file records the commit the run started from (it can't name the commit it is part of), and `watch` ignores the job's own `writes` and the state files, so the run's commit adds nothing `watch` sees.
2. **"Nothing to do" leaves no trace.** A script job can exit with a reserved status meaning nothing changed; the runner then commits nothing and doesn't rebuild. It only updates the last-checked time in `_update.state.json`, which is not a watched file. `watch` then only decides whether to check, and a job decides for itself, cheaply, whether anything really changed (e.g. by comparing an input hash).
3. **Stable stamps.** A site's build stamp should name the last commit that changed sources, not the latest commit, or every job's own commit changes every page that carries it.

### Email notifications (optional)

A site can ask the runner to send an email after jobs run. Off by default. Set in the site's `colvmn.json`, and overridable per job in `_update.md`:

```json
"updates": {
    "notify": {
        "email": "NOTIFY_EMAIL_TO",
        "on": ["failure", "changed"]
    }
}
```

- **When:** `failure` (a job failed, including a failed `writes` or leak check, or a budget stop), `changed` (a job committed or opened a PR), `nothing` (a job ran and had nothing to do), or `all`. The default is `["failure", "changed"]`, so routine "nothing to do" runs stay quiet. A job can override this, e.g. `notify: [failure]` on a noisy job.
- **What:** one email per runner invocation, not per job: for each job that matches, its folder, result, cost, changed files, and links to the commit or PR and to the run's log. A failure includes the error message. The email never includes page content or job output beyond that, and it goes through the same leak check as committed files.
- **Recipients are not in the repo.** `email` names a credential (here `NOTIFY_EMAIL_TO`), not an address, so a public repo doesn't publish anyone's email address.
- **Sending:** through an email API (e.g. Resend, Postmark) or SMTP, with its key held as a runner-level credential, like the Anthropic key for prompt jobs. It belongs to the runner, not to any job, so jobs never see it.
- **If sending fails,** the run's result doesn't change. The failure is logged in the run and recorded in `_update.state.json`.
- **Why not just GitHub's own emails:** GitHub only emails about failed workflow runs, and only to its own users. It can't report what a job changed or cost, and a self-hosted runner's job failing a check inside a successful workflow wouldn't trigger it.

## Work

- `update.js`: discovery, due check, `--folder`, `--dry-run`, last-run state. **(done, step 1)**
- Update-file parsing (frontmatter with lists). **(done, step 1)**
- Script jobs: run with only their listed credentials, as environment variables. **(done, step 2)**
- Prompt jobs: Claude Code headless, restricted tools, budget stop, reported cost.
- Credentials: look-up from folder to root, `blocked`, `secrets:` lists, prompt jobs refused credentials, value loading from `.secret` files (or from environment variables when present; the variable wins), format checks (`pattern`, `format: json`). **(done, step 3)**
- Checks after a run: `writes` **(done, step 2)**, leaked values **(done, step 3)**.
- Publishing: `direct` **(done, step 2)** and `pr` **(done, step 3)**: a branch per job, `colvmn-update/<folder>`; with `--push` it is pushed and a PR opened with `gh`; while the branch exists the job waits rather than open another.
- Page footer: last update and its cost.
- A workflow template sites copy, for GitHub-hosted and self-hosted runners.
- Tests: due logic, credential look-up and blocking, the `writes` check, the leak check, a prompt job refused credentials.
- colvmn docs: a "Scheduled updates" page (authoring an update file, credentials, running jobs by hand, setting up a runner), then push to colvmn.
- `watch` / `minInterval`, `on: push` and `--on push`, the run's own changes not counting, the "nothing to do" exit status. **(done, step 2)**
- The public-repo credentials path (values from environment variables works; the workflow template is still to do); optional email notifications.
