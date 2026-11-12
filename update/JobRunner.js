/**
 * Runs one update job and publishes what it changed.
 *
 * A script job runs as `node <script>` in its folder, with a minimal
 * environment: PATH, HOME and locale, the credentials it lists (from the
 * runner's environment), and COLVMN_* values describing the run. Nothing
 * else in the runner's environment reaches it.
 *
 * The script's exit status says what happened:
 *   0                       done; whatever it changed is checked and committed
 *   NOTHING_TO_DO_STATUS    nothing to do; changes are discarded, nothing is
 *                           committed and no state is written (no trace)
 *   anything else           failed; changes are discarded
 *
 * After a successful run: every changed file must match the job's `writes`,
 * the site's pages are rebuilt, the run is recorded in _update.state.json,
 * and everything is committed (publish: direct). The runner starts only from
 * a clean working tree, so discarding a run's changes restores it exactly.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { matchesAnyGlob } from "./Glob.js";

export const NOTHING_TO_DO_STATUS = 3;

const BASE_ENV = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "TZ"];
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export class JobRunner {

    /**
     * @param {{ siteRoot: string, git: Git, env?: Object, now?: Date, timeoutMs?: number }} options
     */
    constructor ({ siteRoot, git, env = process.env, now = new Date(), timeoutMs = DEFAULT_TIMEOUT_MS }) {
        this.siteRoot = siteRoot;
        this.git = git;
        this.env = env;
        this.now = now;
        this.timeoutMs = timeoutMs;
    }

    /**
     * Runs a job.
     * @param {UpdateJob} job
     * @returns {{ result: "changed"|"nothing"|"failed", message: string, commit?: string }}
     */
    run (job) {
        const refusal = this.refusal(job);
        if (refusal) {
            return failed(refusal);
        }
        const startCommit = this.git.head();
        const status = this.runScript(job);
        if (status !== 0) {
            this.git.discardChanges();
            return status === NOTHING_TO_DO_STATUS ? nothing("the job had nothing to do") : failed(`the script exited with status ${status}`);
        }
        return this.publish(job, startCommit);
    }

    /** Why the job can't be run, or null. */
    refusal (job) {
        const f = job.updateFile;
        const problems = [...job.problems(), ...this.missingSecrets(job).map(n => `credential ${n} is not set`)];
        if (f.kind() === "prompt") {
            problems.push("prompt jobs aren't built yet");
        }
        if (f.publish() !== "direct") {
            problems.push("publish: pr isn't built yet; use publish: direct");
        }
        if (f.scriptPath() && !existsSync(f.scriptPath())) {
            problems.push(`no script at ${f.fields.run}`);
        }
        return problems.length ? problems.join("; ") : null;
    }

    missingSecrets (job) {
        return job.updateFile.secrets().filter(n => !this.env[n]);
    }

    /** The script's exit status (a timeout or a crash counts as failure, 1). */
    runScript (job) {
        const r = spawnSync(process.execPath, [job.updateFile.scriptPath()], {
            cwd: job.updateFile.folder(),
            env: this.scriptEnv(job),
            stdio: "inherit",
            timeout: this.timeoutMs
        });
        return r.status === null ? 1 : r.status;
    }

    scriptEnv (job) {
        const env = {};
        for (const name of [...BASE_ENV, ...job.updateFile.secrets()]) {
            if (this.env[name] !== undefined) {
                env[name] = this.env[name];
            }
        }
        const state = job.state();
        return {
            ...env,
            COLVMN_SITE_ROOT: this.siteRoot,
            COLVMN_JOB_FOLDER: job.folderName(),
            COLVMN_LAST_RUN: state.lastRun || "",
            COLVMN_LAST_COMMIT: state.lastCommit || "",
            COLVMN_NOTHING_TO_DO: String(NOTHING_TO_DO_STATUS)
        };
    }

    /** Checks, rebuilds, records and commits a successful run's changes. */
    publish (job, startCommit) {
        const changed = this.git.changedFiles();
        if (changed.length === 0) {
            return nothing("the script changed nothing");
        }
        const outside = changed.filter(p => !matchesAnyGlob(p, job.updateFile.writes()));
        if (outside.length) {
            this.git.discardChanges();
            return failed(`changed files outside writes (${job.updateFile.writes().join(", ")}): ${outside.join(", ")}`);
        }
        if (!this.rebuild()) {
            this.git.discardChanges();
            return failed("rebuilding the pages failed");
        }
        job.recordRun({ at: this.now, result: "changed", commit: startCommit });
        const commit = this.git.commitAll(`${job.folderName()}: update (${changed.length} file${changed.length === 1 ? "" : "s"})`);
        return { result: "changed", message: `committed ${changed.length} changed file${changed.length === 1 ? "" : "s"}`, commit };
    }

    /** Regenerates the site's pages, when the site has a colvmn engine. */
    rebuild () {
        const staticGen = join(this.siteRoot, "colvmn", "static-gen.js");
        if (!existsSync(staticGen)) {
            return true;
        }
        return spawnSync(process.execPath, [staticGen, this.siteRoot], { stdio: "ignore", timeout: this.timeoutMs }).status === 0;
    }
}

function failed (message) {
    return { result: "failed", message };
}

function nothing (message) {
    return { result: "nothing", message };
}
