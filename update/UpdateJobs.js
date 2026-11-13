/**
 * The update jobs of a site: every folder under the site root that has an
 * `_update.md`, plus the AI Reviews jobs colvmn adds when colvmn.json asks
 * (ai/AiReviewJobs.js), with when each last ran and whether it is due.
 *
 * A job's last run is kept next to its update file, in
 * `_update.state.json`, and committed with the run's changes, so the
 * schedule survives on any machine that checks the site out.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UpdateFile, UPDATE_FILE_NAME } from "./UpdateFile.js";
import { Schedule } from "./Schedule.js";
import { aiReviewUpdateFiles } from "./ai/AiReviewJobs.js";

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

    /** The saved state: { lastRun, lastCost, lastResult, lastCommit }, or {} before the first run. */
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

    /**
     * Whether the job should run now: its trigger has fired, it is past its
     * minInterval, and something it watches has changed.
     * @param {Date} now
     * @param {{ trigger?: string, git?: Git }} context - the trigger this
     *   invocation is for ("schedule" by default), and the site's git, for watch
     */
    isDue (now, context = {}) {
        return this.problems().length === 0
            && this.triggerFires(now, context.trigger || "schedule")
            && !this.isWithinMinInterval(now)
            && this.watchedPathsChanged(context.git);
    }

    triggerFires (now, trigger) {
        if (this.updateFile.trigger() !== "schedule") {
            return trigger === this.updateFile.trigger();
        }
        return trigger === "schedule" && this.schedule().isDue(this.lastRun(), now);
    }

    isWithinMinInterval (now) {
        const interval = this.updateFile.minIntervalMs();
        const last = this.lastRun();
        return interval !== null && last !== null && now.getTime() - last.getTime() < interval;
    }

    /**
     * Whether a watched path changed since the commit recorded at the last
     * run. The job's own writes and the runner's state files never count, so
     * a job's own output can't make it due; another job's output can. With no
     * watch list, no recorded commit, or no git, the answer is yes.
     */
    watchedPathsChanged (git) {
        const specs = this.updateFile.watchPathspecs();
        const since = this.state().lastCommit;
        if (specs.length === 0 || !git || !since || !git.hasCommit(since)) {
            return true;
        }
        return git.hasChangesSince(since, [...specs, ...this.ownOutputExcludes()]);
    }

    ownOutputExcludes () {
        return [...this.updateFile.writes().map(w => `:(exclude,glob)${w}`), `:(exclude,glob)**/${STATE_FILE_NAME}`];
    }

    /**
     * Records a run, for the next due check.
     * @param {{ at: Date, cost?: number, result: string, commit?: string }} run -
     *   `commit` is the commit the run started from; watch looks at changes after it
     */
    recordRun ({ at, cost = null, result, commit = null }) {
        const state = { lastRun: at.toISOString(), lastCost: cost, lastResult: result, lastCommit: commit };
        writeFileSync(this.statePath(), JSON.stringify(state, null, 4) + "\n");
        return this;
    }

    /** A plain description for --dry-run and logs. */
    describe (now, context = {}) {
        const f = this.updateFile;
        return {
            folder: this.folderName(),
            kind: f.kind(),
            schedule: f.schedule(),
            trigger: f.trigger(),
            watch: f.watch(),
            minInterval: f.fields.minInterval ?? null,
            lastRun: this.state().lastRun || null,
            due: this.isDue(now, context),
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
    static inSite (siteRoot, env = process.env) {
        const files = [...findUpdateFiles(siteRoot).map(p => UpdateFile.fromPath(p, siteRoot)), ...aiReviewUpdateFiles(siteRoot, env)];
        return new UpdateJobs(siteRoot, files.map(f => new UpdateJob(f)));
    }

    constructor (siteRoot, jobs) {
        this.siteRoot = siteRoot;
        this.jobs = jobs;
    }

    all () {
        return this.jobs;
    }

    due (now, context = {}) {
        return this.jobs.filter(j => j.isDue(now, context));
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
