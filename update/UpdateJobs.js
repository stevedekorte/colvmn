/**
 * The update jobs of a site: every folder under the site root that has an
 * `_update.md`, with when each last ran and whether it is due.
 *
 * A job's last run is kept next to its update file, in
 * `_update.state.json`, and committed with the run's changes, so the
 * schedule survives on any machine that checks the site out.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UpdateFile, UPDATE_FILE_NAME } from "./UpdateFile.js";
import { Schedule } from "./Schedule.js";

export const STATE_FILE_NAME = "_update.state.json";

const SKIPPED_FOLDERS = new Set(["node_modules", "colvmn"]);

export class UpdateJob {

    constructor (updateFile) {
        this.updateFile = updateFile;
    }

    folderName () {
        return this.updateFile.folderName();
    }

    statePath () {
        return join(this.updateFile.folder(), STATE_FILE_NAME);
    }

    /** The saved state: { lastRun, lastCost, lastResult }, or {} before the first run. */
    state () {
        if (!existsSync(this.statePath())) {
            return {};
        }
        try {
            return JSON.parse(readFileSync(this.statePath(), "utf8"));
        } catch {
            return {};
        }
    }

    lastRun () {
        const t = this.state().lastRun;
        return t ? new Date(t) : null;
    }

    schedule () {
        return new Schedule(this.updateFile.schedule());
    }

    /** What stops the job from running, as sentences; empty when it can run. */
    problems () {
        const problems = this.updateFile.problems();
        if (this.updateFile.schedule() && !this.schedule().isValid()) {
            problems.push(`schedule "${this.updateFile.schedule()}" is not daily, weekly, monthly, or a cron string`);
        }
        return problems;
    }

    isDue (now) {
        return this.problems().length === 0 && this.schedule().isDue(this.lastRun(), now);
    }

    /**
     * Records a run, for the next due check.
     * @param {{ at: Date, cost?: number, result: string }} run
     */
    recordRun ({ at, cost = null, result }) {
        const state = { lastRun: at.toISOString(), lastCost: cost, lastResult: result };
        writeFileSync(this.statePath(), JSON.stringify(state, null, 4) + "\n");
        return this;
    }

    /** A plain description for --dry-run and logs. */
    describe (now) {
        const f = this.updateFile;
        return {
            folder: this.folderName(),
            kind: f.kind(),
            schedule: f.schedule(),
            lastRun: this.state().lastRun || null,
            due: this.isDue(now),
            target: f.target(),
            writes: f.writes(),
            publish: f.publish(),
            model: f.model(),
            budget: f.budget(),
            script: f.kind() === "script" ? f.fields.run : null,
            secrets: f.secrets(),
            problems: this.problems()
        };
    }
}

export class UpdateJobs {

    /**
     * Finds every update job under a site root.
     * @param {string} siteRoot - absolute path
     * @returns {UpdateJobs}
     */
    static inSite (siteRoot) {
        return new UpdateJobs(siteRoot, findUpdateFiles(siteRoot).map(p => new UpdateJob(UpdateFile.fromPath(p, siteRoot))));
    }

    constructor (siteRoot, jobs) {
        this.siteRoot = siteRoot;
        this.jobs = jobs;
    }

    all () {
        return this.jobs;
    }

    due (now) {
        return this.jobs.filter(j => j.isDue(now));
    }

    /** The job whose folder is this one (relative to the site root), or null. */
    inFolder (folderName) {
        const name = folderName.replace(/\/+$/, "") || ".";
        return this.jobs.find(j => j.folderName() === name) || null;
    }
}

/**
 * Every `_update.md` under a folder, skipping hidden folders, node_modules
 * and the colvmn engine itself.
 * @param {string} root
 * @returns {string[]} absolute paths, sorted
 */
export function findUpdateFiles (root) {
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (!entry.name.startsWith(".") && !SKIPPED_FOLDERS.has(entry.name)) {
                    walk(join(dir, entry.name));
                }
            } else if (entry.name === UPDATE_FILE_NAME) {
                found.push(join(dir, entry.name));
            }
        }
    };
    walk(root);
    return found.sort();
}
