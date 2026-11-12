#!/usr/bin/env node

/**
 * Scheduled updates for a colvmn site: folders that refresh their own pages.
 * A folder with an `_update.md` is a job; its frontmatter says when it runs
 * and what it may change, and its body is the prompt (or `run:` names a
 * script). See the "Scheduled updates" docs page.
 *
 * Usage:
 *   node colvmn/update.js                           # run every scheduled job that is due, and commit each
 *   node colvmn/update.js --on push                 # run every on: push job whose watched paths changed
 *   node colvmn/update.js --push                    # ... and push the commits, and open PRs
 *   node colvmn/update.js --folder Competition      # run one job now, due or not
 *   node colvmn/update.js --dry-run                 # every job: due or not, and what it would be given
 *   node colvmn/update.js --dry-run --folder Competition
 *   node colvmn/update.js <site-root> --dry-run     # site root other than colvmn's parent
 *   node colvmn/update.js --dry-run --now 2026-11-10T07:30:00Z   # as if at another time
 *   node colvmn/update.js --dry-run --json          # the same, as JSON
 *
 * Script jobs run and publish (publish: direct commits here; publish: pr
 * commits on a branch, and --push pushes it and opens the PR). Prompt jobs
 * are not built yet; such jobs are reported as failed. The runner
 * refuses to start on a working tree with uncommitted changes. See
 * update/JobRunner.js for what a script gets and how its exit status is read.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UpdateJobs } from "./update/UpdateJobs.js";
import { JobRunner } from "./update/JobRunner.js";
import { Git } from "./update/Git.js";
import { Credentials } from "./update/Credentials.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Reads the command line.
 * @param {string[]} argv - arguments after the script name
 * @returns {{ siteRoot: string, dryRun: boolean, folder: string|null, now: Date, json: boolean, trigger: string, push: boolean }}
 */
export function parseArgs (argv) {
    const options = { siteRoot: resolve(HERE, ".."), dryRun: false, folder: null, now: new Date(), json: false, trigger: "schedule", push: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dry-run") {
            options.dryRun = true;
        } else if (a === "--json") {
            options.json = true;
        } else if (a === "--folder") {
            options.folder = argv[++i];
        } else if (a === "--on") {
            options.trigger = argv[++i];
            if (options.trigger !== "push") {
                throw new Error("--on takes push");
            }
        } else if (a === "--push") {
            options.push = true;
        } else if (a === "--now") {
            options.now = new Date(argv[++i]);
        } else if (!a.startsWith("--")) {
            options.siteRoot = resolve(a);
        } else {
            throw new Error(`unknown option ${a}`);
        }
    }
    if (isNaN(options.now.getTime())) {
        throw new Error("--now needs an ISO time, e.g. 2026-11-10T07:30:00Z");
    }
    return options;
}

/**
 * The jobs this invocation is about: one folder's (whether or not it is
 * due — running a job by hand ignores its schedule), else every job.
 */
export function selectJobs (jobs, options) {
    if (!options.folder) {
        return jobs.all();
    }
    const job = jobs.inFolder(options.folder);
    if (!job) {
        throw new Error(`no ${options.folder}/_update.md under ${jobs.siteRoot}`);
    }
    return [job];
}

/** One job as dry-run lines. */
export function describeJobLines (description) {
    const d = description;
    const status = d.problems.length > 0 ? "cannot run" : (d.due ? "DUE" : "not due");
    const when = d.trigger === "schedule" ? (d.schedule || "no schedule") : `on ${d.trigger}`;
    const lines = [`${d.folder}  —  ${status}  (${d.kind} job, ${when}, last run ${d.lastRun || "never"})`];
    if (d.watch.length || d.minInterval) {
        lines.push(`    ${d.watch.length ? "watches " + d.watch.join(", ") : "no watch"}${d.minInterval ? "; at most every " + d.minInterval : ""}`);
    }
    lines.push(`    target ${d.target}; may change ${d.writes.join(", ")}; publish ${d.publish}`);
    if (d.kind === "script") {
        lines.push(`    runs ${d.script} with ${d.secrets.length ? "credentials " + d.secrets.join(", ") : "no credentials"}`);
    } else {
        lines.push(`    prompt on ${d.model || "the default model"}, budget ${d.budget === null ? "none" : "$" + d.budget.toFixed(2)}, no credentials`);
    }
    d.problems.forEach(p => lines.push(`    ✗ ${p}`));
    return lines;
}

export function main (argv) {
    const options = parseArgs(argv);
    const jobs = UpdateJobs.inSite(options.siteRoot);
    const selected = selectJobs(jobs, options);
    const git = new Git(options.siteRoot);
    const context = { trigger: options.trigger, git: git.isRepo() ? git : null };
    if (!options.dryRun) {
        return runJobs(selected, options, git, context);
    }
    const credentials = new Credentials(options.siteRoot);
    const descriptions = selected.map(j => {
        const d = j.describe(options.now, context);
        d.problems.push(...credentials.forJob(j).problems);
        return d;
    });
    if (options.json) {
        console.log(JSON.stringify({ siteRoot: options.siteRoot, now: options.now.toISOString(), jobs: descriptions }, null, 2));
        return 0;
    }
    if (descriptions.length === 0) {
        console.log(`No update jobs under ${options.siteRoot} (a job is a folder with an _update.md).`);
        return 0;
    }
    const dueCount = descriptions.filter(d => d.due).length;
    console.log(`${descriptions.length} job${descriptions.length === 1 ? "" : "s"}, ${dueCount} due at ${options.now.toISOString()}:\n`);
    descriptions.forEach(d => console.log(describeJobLines(d).join("\n") + "\n"));
    return descriptions.some(d => d.problems.length > 0) ? 1 : 0;
}

/**
 * Runs the due jobs (or the one --folder names, due or not), each committed
 * on its own, and pushes the commits with --push.
 * @returns {number} exit status: 1 if any job failed
 */
export function runJobs (selected, options, git, context) {
    if (!context.git) {
        throw new Error(`${options.siteRoot} is not in a git repo; jobs commit what they change`);
    }
    if (!git.isClean()) {
        throw new Error("the working tree has uncommitted changes; commit or stash them first, so a job's commit holds only its own changes");
    }
    const toRun = options.folder ? selected : selected.filter(j => j.isDue(options.now, context));
    if (toRun.length === 0) {
        console.log(`No jobs due (${options.trigger}).`);
        return 0;
    }
    const runner = new JobRunner({ siteRoot: options.siteRoot, git, now: options.now, push: options.push });
    const results = toRun.map(job => ({ job, ...runner.run(job) }));
    results.forEach(r => console.log(`${r.job.folderName()}: ${r.result} — ${r.message}`));
    if (options.push && results.some(r => r.commit)) {
        git.push();
        console.log("Pushed.");
    }
    return results.some(r => r.result === "failed") ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (e) {
        console.error(e.message);
        process.exitCode = 1;
    }
}
