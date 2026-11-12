// Scheduled updates, step 1: update files, schedules, finding jobs, due checks.
// Run: npm test (in colvmn), or node --test "colvmn/tests/*.test.js"

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUpdateMarkdown, UpdateFile } from "../update/UpdateFile.js";
import { Schedule, CronExpression } from "../update/Schedule.js";
import { UpdateJobs } from "../update/UpdateJobs.js";
import { main, parseArgs } from "../update.js";

const at = (iso) => new Date(iso);

function withSite (files, fn) {
    const root = mkdtempSync(join(tmpdir(), "colvmn-update-"));
    try {
        for (const [rel, text] of Object.entries(files)) {
            const p = join(root, rel);
            mkdirSync(join(p, ".."), { recursive: true });
            writeFileSync(p, text);
        }
        return fn(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

const COMPETITION = `---
schedule: weekly            # once a week
writes: ["Competition/**"]
publish: pr
model: claude-sonnet-5-5
budget: 1.00
---
Research the AI tabletop products listed below.`;

const USAGE = `---
schedule: "30 7 * * *"
run: usage.js
publish: direct
secrets:
  - GCP_PROD_READER
---
Usage numbers from production.`;

// --- the update file ---

test("frontmatter reads strings, numbers, inline and block lists, and drops comments", () => {
    const { fields, body } = parseUpdateMarkdown(COMPETITION);
    assert.deepEqual(fields, { schedule: "weekly", writes: ["Competition/**"], publish: "pr", model: "claude-sonnet-5-5", budget: 1 });
    assert.equal(body, "Research the AI tabletop products listed below.");
    assert.deepEqual(parseUpdateMarkdown(USAGE).fields.secrets, ["GCP_PROD_READER"]);
    assert.equal(parseUpdateMarkdown(USAGE).fields.schedule, "30 7 * * *");
});

test("a # inside quotes is not a comment", () => {
    assert.equal(parseUpdateMarkdown("---\nmodel: \"a#b\"\n---\nx").fields.model, "a#b");
});

test("a prompt job: kind, defaults and no problems", () => {
    const f = new UpdateFile(COMPETITION, "/site/Competition/_update.md", "/site");
    assert.equal(f.kind(), "prompt");
    assert.equal(f.folderName(), "Competition");
    assert.equal(f.target(), "_index.md");
    assert.deepEqual(f.problems(), []);
});

test("writes defaults to the job's own folder", () => {
    const f = new UpdateFile("---\nschedule: daily\nbudget: 0.5\n---\nGo.", "/site/Timeline/_update.md", "/site");
    assert.deepEqual(f.writes(), ["Timeline/**"]);
});

test("a script job may list credentials", () => {
    const f = new UpdateFile(USAGE, "/site/Usage/_update.md", "/site");
    assert.equal(f.kind(), "script");
    assert.equal(f.scriptPath(), "/site/Usage/usage.js");
    assert.deepEqual(f.secrets(), ["GCP_PROD_READER"]);
    assert.deepEqual(f.problems(), []);
});

test("a prompt job that lists credentials is refused", () => {
    const f = new UpdateFile("---\nschedule: daily\nbudget: 1\nsecrets: [STRIPE_READ_KEY]\n---\nGo.", "/site/F/_update.md", "/site");
    assert.ok(f.problems().some(p => p.startsWith("a prompt job may not list credentials")));
});

test("problems name what is wrong", () => {
    const f = new UpdateFile("---\npublish: sometimes\nsecrets: [stripe]\ncolour: red\n---\n", "/site/F/_update.md", "/site");
    const p = f.problems().join(" | ");
    assert.match(p, /unknown setting "colour"/);
    assert.match(p, /no schedule/);
    assert.match(p, /publish must be pr or direct/);
    assert.match(p, /a prompt job needs a budget/);
    assert.match(p, /"stripe" is not UPPER_SNAKE_CASE/);
    assert.match(p, /a prompt job needs a prompt/);
});

// --- schedules ---

test("a job that never ran is due", () => {
    assert.equal(new Schedule("monthly").isDue(null, at("2026-11-10T07:30:00Z")), true);
});

test("daily counts calendar days, not 24 hours", () => {
    const s = new Schedule("daily");
    assert.equal(s.isDue(at("2026-11-09T07:31:00Z"), at("2026-11-10T07:30:00Z")), true, "a minute short of 24 h, but yesterday");
    assert.equal(s.isDue(at("2026-11-10T01:00:00Z"), at("2026-11-10T23:00:00Z")), false, "already ran today");
});

test("weekly is seven days on; monthly is the next calendar month", () => {
    assert.equal(new Schedule("weekly").isDue(at("2026-11-03T09:00:00Z"), at("2026-11-10T07:00:00Z")), true);
    assert.equal(new Schedule("weekly").isDue(at("2026-11-04T09:00:00Z"), at("2026-11-10T07:00:00Z")), false);
    assert.equal(new Schedule("monthly").isDue(at("2026-10-31T23:00:00Z"), at("2026-11-01T00:30:00Z")), true);
    assert.equal(new Schedule("monthly").isDue(at("2026-11-01T00:30:00Z"), at("2026-11-30T23:00:00Z")), false);
});

test("cron: due when one of its times has passed since the last run", () => {
    const s = new Schedule("30 7 * * 1"); // 07:30 UTC on Mondays (2026-11-09 is a Monday)
    assert.equal(s.isDue(at("2026-11-02T08:00:00Z"), at("2026-11-09T07:45:00Z")), true);
    assert.equal(s.isDue(at("2026-11-09T07:31:00Z"), at("2026-11-15T23:00:00Z")), false);
});

test("cron fields: lists, ranges, steps, Sunday as 7, day-of-month OR day-of-week", () => {
    const c = CronExpression.parse("*/15 9-17 * * 1-5");
    assert.equal(c.matches(at("2026-11-10T09:45:00Z")), true);
    assert.equal(c.matches(at("2026-11-10T09:50:00Z")), false);
    assert.equal(c.matches(at("2026-11-08T10:00:00Z")), false, "Sunday");
    assert.equal(CronExpression.parse("0 0 * * 7").matches(at("2026-11-08T00:00:00Z")), true);
    const either = CronExpression.parse("0 12 1 * 1"); // the 1st, or any Monday
    assert.equal(either.matches(at("2026-11-09T12:00:00Z")), true);
    assert.equal(either.matches(at("2026-12-01T12:00:00Z")), true);
    assert.equal(either.matches(at("2026-11-10T12:00:00Z")), false);
});

test("a schedule that isn't one is never due and is reported", () => {
    assert.equal(new Schedule("every so often").isValid(), false);
    assert.equal(CronExpression.parse("61 * * * *"), null);
    withSite({ "A/_update.md": "---\nschedule: fortnightly\nbudget: 1\n---\nGo." }, (root) => {
        const job = UpdateJobs.inSite(root).inFolder("A");
        assert.equal(job.isDue(at("2026-11-10T00:00:00Z")), false);
        assert.match(job.problems().join(), /"fortnightly" is not daily, weekly, monthly, or a cron string/);
    });
});

// --- jobs in a site ---

test("jobs are found in every folder, skipping hidden folders, node_modules and colvmn", () => {
    withSite({
        "Competition/_update.md": COMPETITION,
        "Reports/Usage/_update.md": USAGE,
        ".git/_update.md": COMPETITION,
        "node_modules/x/_update.md": COMPETITION,
        "colvmn/_update.md": COMPETITION
    }, (root) => {
        assert.deepEqual(UpdateJobs.inSite(root).all().map(j => j.folderName()), ["Competition", "Reports/Usage"]);
    });
});

test("a recorded run makes the job not due until its schedule comes round", () => {
    withSite({ "Competition/_update.md": COMPETITION }, (root) => {
        const jobs = UpdateJobs.inSite(root);
        const job = jobs.inFolder("Competition");
        assert.equal(job.isDue(at("2026-11-10T07:30:00Z")), true);
        job.recordRun({ at: at("2026-11-10T07:30:00Z"), cost: 0.42, result: "published" });
        assert.equal(job.isDue(at("2026-11-12T07:30:00Z")), false);
        assert.equal(job.isDue(at("2026-11-17T07:30:00Z")), true);
        assert.deepEqual(job.state(), { lastRun: "2026-11-10T07:30:00.000Z", lastCost: 0.42, lastResult: "published", lastCommit: null });
    });
});

// --- the command ---

test("--dry-run lists the jobs; --folder picks one; without --dry-run nothing runs", () => {
    withSite({
        "Competition/_update.md": COMPETITION,
        "Usage/_update.md": USAGE,
        "_credentials/GCP_PROD_READER.json": "{}",
        "_credentials/GCP_PROD_READER.secret": "service-account-json"
    }, (root) => {
        const out = [];
        const log = console.log;
        console.log = (s) => out.push(String(s));
        try {
            assert.equal(main([root, "--dry-run", "--now", "2026-11-10T07:30:00Z"]), 0);
            assert.match(out.join("\n"), /2 jobs, 2 due/);
            assert.match(out.join("\n"), /Usage {2}— {2}DUE {2}\(script job/);
            assert.match(out.join("\n"), /runs usage\.js with credentials GCP_PROD_READER/);
            out.length = 0;
            assert.equal(main([root, "--dry-run", "--folder", "Competition", "--json"]), 0);
            assert.deepEqual(JSON.parse(out.join("\n")).jobs.map(j => j.folder), ["Competition"]);
            out.length = 0;
            assert.throws(() => main([root]), /not in a git repo/);
        } finally {
            console.log = log;
        }
    });
});

test("bad arguments are refused", () => {
    assert.throws(() => parseArgs(["--now", "soon"]), /--now needs an ISO time/);
    assert.throws(() => parseArgs(["--frobnicate"]), /unknown option/);
});
