// Scheduled updates, step 2: running script jobs, watch, minInterval, on: push,
// the "nothing to do" status, the job's environment, and publishing.
// Each test builds a small site in a temp git repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../update.js";
import { UpdateJobs } from "../update/UpdateJobs.js";
import { JobRunner } from "../update/JobRunner.js";
import { Git } from "../update/Git.js";
import { Credentials } from "../update/Credentials.js";

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

test("credentials: values from .secret files, unless locked by git-crypt; formats are checked", () => {
    withRepo({
        "_credentials/STRIPE_KEY.json": "{ \"pattern\": \"^rk_\" }",
        "_credentials/STRIPE_KEY.secret": "rk_live_abcdef\n",
        "_credentials/SERVICE.json": "{ \"format\": \"json\" }",
        "_credentials/SERVICE.secret": "not json",
        "_credentials/LOCKED.json": "{}",
        "_credentials/LOCKED.secret": "\u0000GITCRYPT\u0000ciphertext",
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
