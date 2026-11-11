#!/usr/bin/env node

/**
 * Scheduled updates for a colvmn site: folders that refresh their own pages.
 * A folder with an `_update.md` is a job; its frontmatter says when it runs
 * and what it may change, and its body is the prompt (or `run:` names a
 * script). See the "Scheduled updates" docs page.
 *
 * Usage:
 *   node colvmn/update.js --dry-run                 # every job: due or not, and what it would be given
 *   node colvmn/update.js --dry-run --folder Competition
 *   node colvmn/update.js <site-root> --dry-run     # site root other than colvmn's parent
 *   node colvmn/update.js --dry-run --now 2026-11-10T07:30:00Z   # as if at another time
 *   node colvmn/update.js --dry-run --json          # the same, as JSON
 *
 * This build finds jobs and decides which are due; running them (scripts,
 * prompts, checks, publishing) comes next. Without --dry-run it says so and
 * exits without changing anything.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UpdateJobs } from "./update/UpdateJobs.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Reads the command line.
 * @param {string[]} argv - arguments after the script name
 * @returns {{ siteRoot: string, dryRun: boolean, folder: string|null, now: Date, json: boolean }}
 */
export function parseArgs (argv) {
    const options = { siteRoot: resolve(HERE, ".."), dryRun: false, folder: null, now: new Date(), json: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dry-run") {
            options.dryRun = true;
        } else if (a === "--json") {
            options.json = true;
        } else if (a === "--folder") {
            options.folder = argv[++i];
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
    const lines = [`${d.folder}  —  ${status}  (${d.kind} job, ${d.schedule || "no schedule"}, last run ${d.lastRun || "never"})`];
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
    if (!options.dryRun) {
        console.log("Running jobs isn't built yet: use --dry-run to see what is due. Nothing was changed.");
        return 2;
    }
    const descriptions = selected.map(j => j.describe(options.now));
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (e) {
        console.error(e.message);
        process.exitCode = 1;
    }
}
