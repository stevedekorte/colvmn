// Scheduled updates, step 2: running script jobs, watch, minInterval, on: push,
// the "nothing to do" status, the job's environment, and publishing.
// Each test builds a small site in a temp git repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../update.js";
import { UpdateJobs } from "../update/UpdateJobs.js";
import { JobRunner } from "../update/JobRunner.js";
import { Git } from "../update/Git.js";
import { Credentials } from "../update/Credentials.js";
import { Notifier } from "../update/Notifier.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function git (root, ...args) {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function write (root, rel, text) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, text);
}

function commit (root, message) {
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", message);
    return git(root, "rev-parse", "HEAD");
}

function withRepo (files, fn) {
    const root = mkdtempSync(join(tmpdir(), "colvmn-runner-"));
    try {
        git(root, "init", "-q");
        git(root, "config", "user.name", "Test");
        git(root, "config", "user.email", "test@example.com");
        for (const [rel, text] of Object.entries(files)) {
            write(root, rel, text);
        }
        commit(root, "site");
        return fn(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

/** Runs main() with console.log silenced; returns its status and output. */
function run (args) {
    const out = [];
    const log = console.log;
    console.log = (s) => out.push(String(s));
    try {
        return { status: main(args), out: out.join("\n") };
    } finally {
        console.log = log;
    }
}

const APPEND = `import { appendFileSync } from "node:fs";
appendFileSync("out.txt", "ran\\n");
`;

const JOB = `---
schedule: daily
run: job.js
publish: direct
---
Appends a line.`;

test("a script job's changes are committed, with its state", () => {
    withRepo({ "Job/_update.md": JOB, "Job/job.js": APPEND }, (root) => {
        const start = git(root, "rev-parse", "HEAD");
        const { status, out } = run([root]);
        assert.equal(status, 0, out);
        assert.match(out, /Job: changed/);
        assert.equal(git(root, "status", "--porcelain"), "");
        assert.equal(readFileSync(join(root, "Job/out.txt"), "utf8"), "ran\n");
        const state = JSON.parse(readFileSync(join(root, "Job/_update.state.json"), "utf8"));
        assert.equal(state.lastResult, "changed");
        assert.equal(state.lastCommit, start);
        assert.match(git(root, "log", "-1", "--format=%s"), /^Job: update/);
    });
});

test("the nothing-to-do status leaves no trace", () => {
    const script = `import { writeFileSync } from "node:fs";
writeFileSync("out.txt", "half-done");
process.exit(Number(process.env.COLVMN_NOTHING_TO_DO));
`;
    withRepo({ "Job/_update.md": JOB, "Job/job.js": script }, (root) => {
        const before = git(root, "rev-parse", "HEAD");
        const { status, out } = run([root]);
        assert.equal(status, 0);
        assert.match(out, /Job: nothing/);
        assert.equal(git(root, "rev-parse", "HEAD"), before);
        assert.equal(git(root, "status", "--porcelain"), "");
        assert.equal(existsSync(join(root, "Job/_update.state.json")), false);
    });
});

test("changes outside writes fail the run and are discarded", () => {
    const script = `import { writeFileSync } from "node:fs";
writeFileSync("out.txt", "ok");
writeFileSync("../elsewhere.txt", "not allowed");
`;
    withRepo({ "Job/_update.md": JOB, "Job/job.js": script }, (root) => {
        const before = git(root, "rev-parse", "HEAD");
        const { status, out } = run([root]);
        assert.equal(status, 1);
        assert.match(out, /Job: failed — changed files outside writes \(Job\/\*\*\): elsewhere\.txt/);
        assert.equal(git(root, "rev-parse", "HEAD"), before);
        assert.equal(git(root, "status", "--porcelain"), "");
    });
});

test("a script gets only the credentials it lists, and a missing one stops it", () => {
    const script = `import { writeFileSync } from "node:fs";
writeFileSync("env.json", JSON.stringify(Object.keys(process.env).sort()));
`;
    const job = JOB.replace("publish: direct", "publish: direct\nsecrets: [API_KEY]");
    withRepo({ "Job/_update.md": job, "Job/job.js": script, "_credentials/API_KEY.json": "{}" }, (root) => {
        const theJob = UpdateJobs.inSite(root).inFolder("Job");
        const g = new Git(root);
        const missing = new JobRunner({ siteRoot: root, git: g, env: { PATH: process.env.PATH } }).run(theJob);
        assert.equal(missing.result, "failed");
        assert.match(missing.message, /credential API_KEY has no value/);

        const env = { PATH: process.env.PATH, API_KEY: "k", OTHER_SECRET: "s" };
        const r = new JobRunner({ siteRoot: root, git: g, env }).run(theJob);
        assert.equal(r.result, "changed", r.message);
        const keys = JSON.parse(readFileSync(join(root, "Job/env.json"), "utf8"));
        assert.ok(keys.includes("API_KEY"));
        assert.ok(!keys.includes("OTHER_SECRET"));
        assert.ok(keys.includes("COLVMN_JOB_FOLDER"));
    });
});

test("on: push jobs run only for --on push, and watch makes them wait for a change", () => {
    const job = `---
on: push
watch: src
run: job.js
publish: direct
---
Rebuilds from src.`;
    withRepo({ "Job/_update.md": job, "Job/job.js": APPEND, "src/a.txt": "a" }, (root) => {
        assert.match(run([root]).out, /No jobs due/);
        assert.match(run([root, "--on", "push"]).out, /Job: changed/);
        assert.match(run([root, "--on", "push"]).out, /No jobs due/, "its own commit doesn't count");
        write(root, "other.txt", "unwatched");
        commit(root, "unwatched change");
        assert.match(run([root, "--on", "push"]).out, /No jobs due/);
        write(root, "src/a.txt", "changed");
        commit(root, "watched change");
        assert.match(run([root, "--on", "push"]).out, /Job: changed/);
    });
});

test("minInterval holds a due job back", () => {
    const job = JOB.replace("schedule: daily", "schedule: daily\nminInterval: 30d");
    withRepo({ "Job/_update.md": job, "Job/job.js": APPEND }, (root) => {
        assert.match(run([root, "--now", "2026-11-01T08:00:00Z"]).out, /Job: changed/);
        assert.match(run([root, "--now", "2026-11-05T08:00:00Z"]).out, /No jobs due/);
        assert.match(run([root, "--now", "2026-12-02T08:00:00Z"]).out, /Job: changed/);
    });
});

test("a dirty working tree is refused", () => {
    withRepo({ "Job/_update.md": JOB, "Job/job.js": APPEND }, (root) => {
        write(root, "uncommitted.txt", "x");
        assert.throws(() => run([root]), /uncommitted changes/);
    });
});

test("update files: on, watch and minInterval are checked", () => {
    withRepo({
        "A/_update.md": "---\non: tuesday\nrun: a.js\npublish: direct\n---\n",
        "B/_update.md": "---\non: push\nschedule: daily\nrun: b.js\npublish: direct\n---\n",
        "C/_update.md": "---\nschedule: daily\nminInterval: soon\nrun: c.js\npublish: direct\n---\n"
    }, (root) => {
        const jobs = UpdateJobs.inSite(root);
        assert.match(jobs.inFolder("A").problems().join(), /on must be push/);
        assert.match(jobs.inFolder("B").problems().join(), /schedule or an on: trigger, not both/);
        assert.match(jobs.inFolder("C").problems().join(), /minInterval must be/);
    });
});

// --- step 3: credentials, the leak check, publish: pr ---

const KEY_JOB = JOB.replace("publish: direct", "publish: direct\nsecrets: [API_KEY]");

test("credentials: the nearest description wins, blocked refuses, and a job lists what it gets", () => {
    withRepo({
        "_credentials/API_KEY.json": "{}",
        "Open/_update.md": KEY_JOB, "Open/job.js": APPEND,
        "Closed/_credentials/API_KEY.json": "{ \"blocked\": true }",
        "Closed/_update.md": KEY_JOB, "Closed/job.js": APPEND,
        "Undescribed/_update.md": KEY_JOB.replace("API_KEY", "OTHER_KEY"), "Undescribed/job.js": APPEND
    }, (root) => {
        const creds = new Credentials(root, { API_KEY: "a-long-key-value", OTHER_KEY: "another-value" });
        const jobs = UpdateJobs.inSite(root);
        assert.deepEqual(creds.forJob(jobs.inFolder("Open")), { values: { API_KEY: "a-long-key-value" }, problems: [] });
        assert.match(creds.forJob(jobs.inFolder("Closed")).problems.join(), /API_KEY is blocked for this folder/);
        assert.match(creds.forJob(jobs.inFolder("Undescribed")).problems.join(), /OTHER_KEY isn't described/);
    });
});

test("credentials: values from .secret.txt files, unless locked by git-crypt; formats are checked", () => {
    withRepo({
        "_credentials/STRIPE_KEY.json": "{ \"pattern\": \"^rk_\" }",
        "_credentials/STRIPE_KEY.secret.txt": "rk_live_abcdef\n",
        "_credentials/SERVICE.json": "{ \"format\": \"json\" }",
        "_credentials/SERVICE.secret.txt": "not json",
        "_credentials/LOCKED.json": "{}",
        "_credentials/LOCKED.secret.txt": "\u0000GITCRYPT\u0000ciphertext",
        ".gitignore": "_credentials/STRIPE_KEY.secret.txt\n_credentials/SERVICE.secret.txt\n",
        ".gitattributes": "_credentials/LOCKED.secret.txt filter=git-crypt diff=git-crypt\n",
        "Job/_update.md": JOB
    }, (root) => {
        const creds = new Credentials(root, {});
        const folder = join(root, "Job");
        assert.deepEqual(creds.resolve("STRIPE_KEY", folder), { value: "rk_live_abcdef" });
        assert.match(creds.resolve("SERVICE", folder).problem, /should be JSON/);
        assert.match(creds.resolve("LOCKED", folder).problem, /has no value/);
        assert.deepEqual(new Credentials(root, { LOCKED: "from-env" }).resolve("LOCKED", folder), { value: "from-env" });
        const wrong = new Credentials(root, { STRIPE_KEY: "sk_live_x" }).resolve("STRIPE_KEY", folder);
        assert.match(wrong.problem, /should match \^rk_/);
        assert.doesNotMatch(wrong.problem, /sk_live_x/);
    });
});

test("the leak check refuses a change that contains a credential value", () => {
    const script = `import { writeFileSync } from "node:fs";
writeFileSync("out.txt", "key: " + process.env.API_KEY);
`;
    withRepo({ "Job/_update.md": KEY_JOB, "Job/job.js": script, "_credentials/API_KEY.json": "{}" }, (root) => {
        const before = git(root, "rev-parse", "HEAD");
        const r = new JobRunner({ siteRoot: root, git: new Git(root), env: { PATH: process.env.PATH, API_KEY: "secret-value-123" } })
            .run(UpdateJobs.inSite(root).inFolder("Job"));
        assert.equal(r.result, "failed");
        assert.equal(r.message, "Job/out.txt contains the value of credential API_KEY");
        assert.equal(git(root, "rev-parse", "HEAD"), before);
        assert.equal(git(root, "status", "--porcelain"), "");
    });
});

test("publish: pr commits on the job's branch, returns, and waits while that branch exists", () => {
    const job = JOB.replace("publish: direct", "publish: pr");
    withRepo({ "Job/_update.md": job, "Job/job.js": APPEND }, (root) => {
        const base = git(root, "rev-parse", "--abbrev-ref", "HEAD");
        const before = git(root, "rev-parse", "HEAD");
        assert.match(run([root]).out, /Job: changed — committed on colvmn-update\/Job \(not pushed/);
        assert.equal(git(root, "rev-parse", "--abbrev-ref", "HEAD"), base);
        assert.equal(git(root, "rev-parse", "HEAD"), before);
        assert.match(git(root, "log", "-1", "--format=%s", "colvmn-update/Job"), /^Job: update/);
        assert.match(run([root, "--now", "2099-01-01T00:00:00Z"]).out, /Job: nothing — an earlier update is awaiting review on colvmn-update\/Job/);
    });
});

// --- step 4: prompt jobs, notifications ---

const PROMPT_JOB = `---
schedule: daily
publish: direct
model: claude-haiku-5-5
budget: 0.50
---
Update the page.`;

/** A stand-in for Claude Code: records its arguments and environment, edits the page, prints a result. */
function fakeClaude (root, { fail = false } = {}) {
    const path = join(root, "..", `fake-claude-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(path, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(root, "..", "claude-call.json"))}, JSON.stringify({ args: process.argv.slice(2), env: Object.keys(process.env), cwd: process.cwd() }));
${fail ? "" : `writeFileSync("Job/_index.md", "# Updated\\n");`}
console.log(JSON.stringify(${fail ? `{ is_error: true, subtype: "error_max_budget_usd", total_cost_usd: 0.5 }` : `{ is_error: false, subtype: "success", result: "Updated the page.", total_cost_usd: 0.12 }`}));
process.exit(${fail ? 1 : 0});
`);
    execFileSync("chmod", ["+x", path]);
    return path;
}

test("a prompt job runs Claude Code bare, with no shell, edits only in writes, its budget, and its cost recorded", () => {
    withRepo({ "Job/_update.md": PROMPT_JOB, "Job/_index.md": "# Old\n" }, (root) => {
        const env = { PATH: process.env.PATH, ANTHROPIC_API_KEY: "runner-key-123", JOB_SECRET: "x", COLVMN_CLAUDE: fakeClaude(root) };
        const r = new JobRunner({ siteRoot: root, git: new Git(root), env }).run(UpdateJobs.inSite(root).inFolder("Job"));
        assert.equal(r.result, "changed", r.message);
        assert.equal(r.cost, 0.12);
        const call = JSON.parse(readFileSync(join(root, "..", "claude-call.json"), "utf8"));
        const args = call.args.join(" ");
        assert.match(args, /--bare/);
        assert.match(args, /--model claude-haiku-5-5/);
        assert.match(args, /--max-budget-usd 0\.5/);
        assert.match(args, /--permission-mode dontAsk/);
        assert.match(args, /Edit\(Job\/\*\*\) Write\(Job\/\*\*\)/);
        assert.match(args, /--disallowedTools Bash/);
        assert.match(call.args[1], /You may change only files matching: Job\/\*\*[\s\S]*Update the page\./);
        assert.ok(call.env.includes("ANTHROPIC_API_KEY"));
        assert.ok(!call.env.includes("JOB_SECRET"));
        const state = JSON.parse(readFileSync(join(root, "Job/_update.state.json"), "utf8"));
        assert.equal(state.lastCost, 0.12);
    });
});

test("a prompt job that hits its budget fails, keeps nothing, and reports its cost; without the runner's key it doesn't start", () => {
    withRepo({ "Job/_update.md": PROMPT_JOB, "Job/_index.md": "# Old\n" }, (root) => {
        const job = UpdateJobs.inSite(root).inFolder("Job");
        const noKey = new JobRunner({ siteRoot: root, git: new Git(root), env: { PATH: process.env.PATH } }).run(job);
        assert.match(noKey.message, /need the runner's ANTHROPIC_API_KEY/);
        const env = { PATH: process.env.PATH, ANTHROPIC_API_KEY: "k", COLVMN_CLAUDE: fakeClaude(root, { fail: true }) };
        const r = new JobRunner({ siteRoot: root, git: new Git(root), env }).run(job);
        assert.equal(r.result, "failed");
        assert.match(r.message, /error_max_budget_usd/);
        assert.equal(r.cost, 0.5);
        assert.equal(git(root, "status", "--porcelain"), "");
    });
});

test("notifications: off by default; on failure and changes, or what a job asks for; addresses come from credentials", async () => {
    withRepo({
        "colvmn.json": "{}",
        "A/_update.md": JOB, "B/_update.md": JOB.replace("publish: direct", "publish: direct\nnotify: [all]")
    }, (root) => assert.equal(Notifier.forSite(root), null));

    const files = {
        "colvmn.json": JSON.stringify({ updates: { notify: {} } }),
        "_credentials/NOTIFY_EMAIL_TO.json": "{}",
        "_credentials/NOTIFY_EMAIL_FROM.json": "{}",
        "_credentials/RESEND_API_KEY.json": "{}",
        "A/_update.md": JOB,
        "B/_update.md": JOB.replace("publish: direct", "publish: direct\nnotify: [all]")
    };
    const root = mkdtempSync(join(tmpdir(), "colvmn-notify-"));
    try {
        for (const [rel, text] of Object.entries(files)) {
            write(root, rel, text);
        }
        const jobs = UpdateJobs.inSite(root);
        const results = [
            { job: jobs.inFolder("A"), result: "nothing", message: "the job had nothing to do" },
            { job: jobs.inFolder("B"), result: "nothing", message: "the job had nothing to do" }
        ];
        const sent = [];
        const env = { NOTIFY_EMAIL_TO: "me@example.com, you@example.com", NOTIFY_EMAIL_FROM: "bot@example.com", RESEND_API_KEY: "re_key_123", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "7" };
        const notifier = Notifier.forSite(root, env, async (url, init) => { sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true }; });

        assert.equal(await notifier.send(results, new Set()), "notification sent");
        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0].body.to, ["me@example.com", "you@example.com"]);
        assert.equal(sent[0].auth, "Bearer re_key_123");
        assert.match(sent[0].body.text, /^B: nothing/);
        assert.doesNotMatch(sent[0].body.text, /^A:/m);
        assert.match(sent[0].body.text, /Run log: https:\/\/github\.com\/o\/r\/actions\/runs\/7/);

        const withheld = notifier.compose([{ job: jobs.inFolder("A"), result: "failed", message: "leaked the-secret-value" }], new Set(["the-secret-value"]));
        assert.match(withheld.text, /withheld/);
        assert.equal(notifier.compose([results[0]]), null);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("credential value files git could commit: not read, never staged, never cleaned, and the build fails", () => {
    withRepo({
        "_credentials/API_KEY.json": "{}",
        "Job/_update.md": KEY_JOB, "Job/job.js": APPEND
    }, (root) => {
        writeFileSync(join(root, "_credentials", "API_KEY.secret.txt"), "exposed-key-value\n");   // after the first commit, not ignored
        const problem = new Credentials(root, {}).resolve("API_KEY", join(root, "Job")).problem;
        assert.match(problem, /API_KEY\.secret\.txt isn't ignored by git/);
        assert.doesNotMatch(problem, /exposed-key-value/);
        assert.equal(new Credentials(root, { API_KEY: "from-env-123" }).resolve("API_KEY", root).value, "from-env-123", "the environment needs no file");

        const g = new Git(root);
        writeFileSync(join(root, "Job", "page.md"), "changed");
        g.commitAll("a change");
        assert.equal(git(root, "ls-files", "_credentials"), "_credentials/API_KEY.json", "the value file isn't committed");
        g.discardChanges();
        assert.ok(existsSync(join(root, "_credentials", "API_KEY.secret.txt")), "nor cleaned away");

        writeFileSync(join(root, "_index.md"), "# Root\n");
        writeFileSync(join(root, "index.html"), "");
        const build = spawnSync(process.execPath, [join(HERE, "..", "static-gen.js"), root], { encoding: "utf8" });
        assert.equal(build.status, 1);
        assert.match(build.stderr, /git could commit: _credentials\/API_KEY\.secret\.txt/);

        writeFileSync(join(root, ".gitignore"), "_credentials/*.secret.txt\n");
        assert.equal(new Credentials(root, {}).resolve("API_KEY", root).value, "exposed-key-value");
    });
});
