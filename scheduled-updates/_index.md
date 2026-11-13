---
title: Scheduled Updates
subtitle: Pages that refresh themselves. A folder with an update file runs a script or a prompt on a schedule, or when what it watches changes, and publishes the result.
---

Some pages go stale unless someone remembers to update them: reports, figures, generated reference pages. colvmn's update runner keeps them current. Put an `_update.md` in a page's folder; the runner decides when it is due, runs it, checks what it changed, rebuilds the pages and commits the result, or opens a pull request for review.

## The update file

Its frontmatter says when the job runs and what it may change. Its body is the prompt for a prompt job, or a note for a script job.

```markdown
---
schedule: weekly            # daily, weekly, monthly, or a cron string (UTC)
writes: ["Competition/**"]  # what the run may change; default: the job's folder
publish: pr                 # pr (review first) or direct
model: claude-sonnet-5-5
budget: 1.00                # dollars per run; a hard stop
---
Research the products listed below. Update each one's card:
pricing, recent launches, notable reviews. Cite sources.
```

| Setting | Meaning |
| --- | --- |
| `schedule` | `daily`, `weekly`, `monthly`, or a five-field cron string, in UTC. |
| `on` | `push`: run when the site's main branch is pushed, instead of on a schedule. |
| `watch` | Folders or globs, from the site root. The job runs only if one changed since its last run. Works with either trigger. |
| `minInterval` | The least time between runs: `12h`, `30d`, `2w`. |
| `run` | A script to run with Node, from the job's folder. Without it, the job is a prompt job. |
| `writes` | Globs the run may change, from the site root. Anything else fails the run. |
| `publish` | `direct` commits on the current branch; `pr` commits on a branch and opens a pull request. Default `pr`. |
| `secrets` | Credentials a script job is given, by name. Prompt jobs may not have any. |
| `model`, `budget` | For prompt jobs: the Claude model, and the most a run may spend. |
| `notify` | Which results this job emails about: `failure`, `changed`, `nothing` or `all`. Overrides the site's setting. |
| `target` | The page the job refreshes; default the folder's `_index.md`. |

## When a job runs

A job runs when its **trigger** fires (its schedule comes round, or a push), it is past its **minInterval**, and something it **watches** has changed. Any part left out is no condition.

```yaml
on: push
watch: ["source"]        # a folder means everything under it
run: classTree.js
```

A job's own output never counts as a change to what it watches, so a job can't make itself due. Another job's output does count, which is how one job triggers another: a cheap daily job writes `models.json`, and a costlier job that watches it runs only when it changes.

## Script jobs

A script job runs `node <script>` in its folder. It gets a minimal environment: `PATH`, `HOME` and locale, the credentials it lists, and these:

| Variable | Value |
| --- | --- |
| `COLVMN_SITE_ROOT` | The site root. |
| `COLVMN_JOB_FOLDER` | The job's folder, from the site root. |
| `COLVMN_LAST_RUN`, `COLVMN_LAST_COMMIT` | When the job last ran, and the commit it started from. |
| `COLVMN_NOTHING_TO_DO` | The exit status that means "nothing to do" (3). |

Its exit status says what happened: `0`, done; `3`, nothing to do (its changes are discarded and nothing is recorded, so the run leaves no trace); anything else, failed. Numbers belong in scripts: they give the same answer every time and can't make a figure up.

## Prompt jobs

A prompt job runs Claude Code headless in the site root, with the job's prompt. It has no shell. It can read, search the web and fetch pages, and edit only what `writes` allows. Its `budget` is a hard stop, and its cost is recorded and shown in notifications. It uses the runner's own `ANTHROPIC_API_KEY`, never a job credential, so a web page that tells the model to send a key somewhere has no key to send.

## After a run

1. Every changed file must match `writes`.
2. The site's pages are rebuilt.
3. No changed file may contain a credential value the job was given.
4. The run is recorded in `_update.state.json` beside the update file.
5. The change is published: committed (`direct`), or committed on the branch `colvmn-update/<folder>` and opened as a pull request (`pr`). While that branch exists, the job waits rather than open another.

If any check fails, the run's changes are discarded. The runner only starts from a clean working tree, so discarding restores it exactly.

## Credentials

A credential is described once, by a file named after it, in a `_credentials` folder at the site root or in a folder above the job:

```json
{ "about": "Stripe restricted key, read-only", "pattern": "^rk_" }
```

saved as `_credentials/STRIPE_READ_KEY.json`. The nearest description wins; `{ "blocked": true }` refuses the credential to everything below it. Being described is not being given: a job gets only what it lists in `secrets`.

The value comes from the environment variable of the same name when it is set (for example a GitHub Actions secret), else from `_credentials/STRIPE_READ_KEY.secret.txt` beside the description, which must be ignored by git or encrypted with git-crypt: add `_credentials/*.secret.txt` to the site's `.gitignore`. colvmn won't read a value file git could commit, the build fails while one exists, and the runner never stages or cleans these files. A description can check the value's format with `pattern` (a regular expression) or `"format": "json"`. Problems name the credential, never its value.

colvmn describes the AI providers' standard keys itself: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` and `XAI_API_KEY`. Any job can list them in `secrets` with no description file; they need only a value. `ANTHROPIC_API_KEY` is also the runner's own key for prompt jobs.

Keep every key read-only and narrowly scoped, so the worst a leak exposes is figures that were headed for the site anyway.

## Running it

```bash
node colvmn/update.js --dry-run              # every job: due or not, and what it would be given
node colvmn/update.js                        # run the scheduled jobs that are due
node colvmn/update.js --on push              # run the push jobs whose watched paths changed
node colvmn/update.js --folder Competition   # run one job now, due or not
node colvmn/update.js --push                 # ... and push the commits and open pull requests
```

To run on a schedule on your own Mac, copy `colvmn/update/launchd-template.plist` to `~/Library/LaunchAgents/`, fill in the site's path and the keys, and load it with `launchctl` (the file says how). Once a day it pulls, runs the due jobs and the push jobs whose watched paths changed, and pushes what they commit. Give it a checkout you don't edit in, since the runner won't start on uncommitted changes. The keys stay in that file, outside the repo.

To run on GitHub Actions instead, copy `colvmn/update/workflow-template.yml` to `.github/workflows/` in the site's repo and add the secrets it names. It runs the due jobs daily and the push jobs on each push. Commits pushed with the workflow's own token don't start new runs, so the runner's commits can't trigger it again.

## Built-in jobs

A site whose `colvmn.json` has `aiReviews` gets two jobs without writing any update file: one keeps track of each AI provider's top model, the other has those models review the site. See [AI Reviews](../ai-reviews/index.html).

## Notifications

The runner can email a summary after it runs. Turn it on in the site's `colvmn.json`:

```json
"updates": {
    "notify": { "on": ["failure", "changed"] }
}
```

`on` takes `failure`, `changed`, `nothing` or `all`, and a job can override it with `notify`. One email covers the whole run: each job's result, message, cost, changed files and commit, and a link to the run's log. The addresses and the sending key are credentials, `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM` and `RESEND_API_KEY` by default (rename them with `to`, `from` and `key`), so no address is in the repo. Mail is sent through Resend. An email that would contain a credential value is withheld.
