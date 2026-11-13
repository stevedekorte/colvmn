/**
 * Runs one update job and publishes what it changed.
 *
 * A script job runs as `node <script>` in its folder, with a minimal
 * environment: PATH, HOME and locale, the credentials it lists (see
 * Credentials.js), and COLVMN_* values describing the run. Nothing else in
 * the runner's environment reaches it.
 *
 * A prompt job runs Claude Code headless (`claude -p --bare`) in the site
 * root, with the runner's ANTHROPIC_API_KEY (the environment variable, else
 * _credentials/ANTHROPIC_API_KEY.secret.txt) and nothing else from its
 * environment, no shell, edit access only to the job's `writes`, and the
 * job's budget as a hard stop (--max-budget-usd). Its cost is recorded.
 * COLVMN_CLAUDE overrides the command (tests use a stand-in).
 *
 * The script's exit status says what happened:
 *   0                       done; whatever it changed is checked and published
 *   NOTHING_TO_DO_STATUS    nothing to do; changes are discarded, nothing is
 *                           committed and no state is written (no trace)
 *   anything else           failed; changes are discarded
 *
 * After a successful run: every changed file must match the job's `writes`;
 * the site's pages are rebuilt; no changed file may contain a credential
 * value the job was given; the run is recorded in _update.state.json; and the
 * change is published:
 *   direct   committed on the current branch
 *   pr       committed on the branch colvmn-update/<folder>; with push, that
 *            branch is pushed and a PR opened (gh). While the branch exists,
 *            the job waits rather than open another.
 * The runner starts only from a clean working tree, so discarding a run's
 * changes restores it exactly.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { matchesAnyGlob } from "./Glob.js";
import { Credentials } from "./Credentials.js";

export const NOTHING_TO_DO_STATUS = 3;

const BASE_ENV = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "TZ"];
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_LEAK_CHECK_LENGTH = 8;
const DEFAULT_PROMPT_MODEL = "claude-sonnet-5-5";
const PROMPT_READ_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];

export class JobRunner {

    /**
     * @param {{ siteRoot: string, git: Git, env?: Object, now?: Date, push?: boolean, timeoutMs?: number }} options
     *   push: for publish: pr, push the branch and open the PR
     */
    constructor ({ siteRoot, git, env = process.env, now = new Date(), push = false, timeoutMs = DEFAULT_TIMEOUT_MS }) {
        this.siteRoot = siteRoot;
        this.git = git;
        this.credentials = new Credentials(siteRoot, env);
        this.env = env;
        this.now = now;
        this.push = push;
        this.timeoutMs = timeoutMs;
        this.handedOut = new Set();
    }

    /**
     * Runs a job.
     * @param {UpdateJob} job
     * @returns {{ result: "changed"|"nothing"|"failed", message: string, commit?: string }}
     */
    run (job) {
        const { values, problems } = this.credentials.forJob(job);
        const refusal = this.refusal(job, problems);
        if (refusal) {
            return failed(refusal);
        }
        if (job.updateFile.publish() === "pr" && this.git.branchExists(prBranchName(job))) {
            return nothing(`an earlier update is awaiting review on ${prBranchName(job)}`);
        }
        Object.values(values).forEach(v => this.handedOut.add(v));
        const startCommit = this.git.head();
        const outcome = job.updateFile.kind() === "prompt" ? this.runPrompt(job) : { status: this.runScript(job, values), cost: null };
        if (outcome.status !== 0) {
            this.git.discardChanges();
            const r = outcome.status === NOTHING_TO_DO_STATUS ? nothing("the job had nothing to do") : failed(outcome.error || `the script exited with status ${outcome.status}`);
            return { ...r, cost: outcome.cost };
        }
        return { ...this.checkAndPublish(job, startCommit, values, outcome.cost), cost: outcome.cost };
    }

    /** Why the job can't be run, or null. */
    refusal (job, credentialProblems) {
        const f = job.updateFile;
        const problems = [...job.problems(), ...credentialProblems];
        if (f.kind() === "prompt" && !this.runnerKey()) {
            problems.push("prompt jobs need the runner's ANTHROPIC_API_KEY: set the environment variable or add _credentials/ANTHROPIC_API_KEY.secret.txt");
        }
        if (f.scriptPath() && !existsSync(f.scriptPath())) {
            problems.push(`no script at ${f.fields.run}`);
        }
        return problems.length ? problems.join("; ") : null;
    }

    /** The script's exit status (a timeout or a crash counts as failure, 1). */
    runScript (job, values) {
        mkdirSync(job.updateFile.folder(), { recursive: true });   // a built-in job's folder may not exist yet
        const r = spawnSync(process.execPath, [job.updateFile.scriptPath()], {
            cwd: job.updateFile.folder(),
            env: this.scriptEnv(job, values),
            stdio: "inherit",
            timeout: this.timeoutMs
        });
        return r.status === null ? 1 : r.status;
    }

    /**
     * Runs a prompt job through Claude Code.
     * @returns {{ status: number, cost: number|null, error?: string }}
     */
    runPrompt (job) {
        const r = spawnSync(this.env.COLVMN_CLAUDE || "claude", this.promptArgs(job), {
            cwd: this.siteRoot,
            env: { ...this.baseEnv(), ANTHROPIC_API_KEY: this.runnerKey() },
            encoding: "utf8",
            timeout: this.timeoutMs,
            maxBuffer: 64 * 1024 * 1024
        });
        if (r.error) {
            return { status: 1, cost: null, error: `couldn't start Claude Code: ${r.error.message}` };
        }
        let report = null;
        try {
            report = JSON.parse(r.stdout);
        } catch {
            return { status: 1, cost: null, error: `Claude Code exited with status ${r.status} and no result` };
        }
        const cost = typeof report.total_cost_usd === "number" ? report.total_cost_usd : null;
        if (r.status !== 0 || report.is_error) {
            return { status: 1, cost, error: `Claude Code stopped: ${report.subtype || "error"}` };
        }
        return { status: 0, cost };
    }

    /** The runner's own Claude key, for prompt jobs: the environment variable, else the site root's secret file. */
    runnerKey () {
        const r = this.credentials.resolve("ANTHROPIC_API_KEY", this.siteRoot);
        return r.problem ? null : r.value;
    }

    promptArgs (job) {
        const f = job.updateFile;
        const edits = f.writes().flatMap(w => [`Edit(${w})`, `Write(${w})`]);
        return [
            "-p", promptText(job),
            "--bare",
            "--output-format", "json",
            "--model", f.model() || DEFAULT_PROMPT_MODEL,
            "--max-budget-usd", String(f.budget()),
            "--permission-mode", "dontAsk",
            "--allowedTools", ...PROMPT_READ_TOOLS, ...edits,
            "--disallowedTools", "Bash",
            "--strict-mcp-config",
            "--no-session-persistence"
        ];
    }

    baseEnv () {
        const env = {};
        for (const name of BASE_ENV) {
            if (this.env[name] !== undefined) {
                env[name] = this.env[name];
            }
        }
        // AI Reviews API addresses, when replaced (tests point them at a local stand-in)
        for (const name of Object.keys(this.env).filter(n => n.startsWith("COLVMN_AI_BASE_"))) {
            env[name] = this.env[name];
        }
        return env;
    }

    scriptEnv (job, values) {
        const state = job.state();
        return {
            ...this.baseEnv(),
            ...values,
            COLVMN_SITE_ROOT: this.siteRoot,
            COLVMN_JOB_FOLDER: job.folderName(),
            COLVMN_LAST_RUN: state.lastRun || "",
            COLVMN_LAST_COMMIT: state.lastCommit || "",
            COLVMN_NOTHING_TO_DO: String(NOTHING_TO_DO_STATUS)
        };
    }

    /** The checks after a successful script, then publishing; discards the changes if a check fails. */
    checkAndPublish (job, startCommit, values, cost) {
        const changed = this.git.changedFiles();
        if (changed.length === 0) {
            return nothing("the job changed nothing");
        }
        const problem = this.writesProblem(job, changed)
            || (this.rebuild() ? null : "rebuilding the pages failed")
            || this.leakProblem(values);
        if (problem) {
            this.git.discardChanges();
            return failed(problem);
        }
        job.recordRun({ at: this.now, result: "changed", commit: startCommit, cost });
        const message = `${job.folderName()}: update (${changed.length} file${changed.length === 1 ? "" : "s"})`;
        const published = job.updateFile.publish() === "pr" ? this.publishPr(job, message) : this.publishDirect(message, changed.length);
        return { ...published, files: changed };
    }

    writesProblem (job, changed) {
        const writes = job.updateFile.writes();
        const outside = changed.filter(p => !matchesAnyGlob(p, writes));
        return outside.length ? `changed files outside writes (${writes.join(", ")}): ${outside.join(", ")}` : null;
    }

    /** Whether a changed file holds a credential value the job was given. Names the file and credential, never the value. */
    leakProblem (values) {
        const secrets = Object.entries(values).filter(([, v]) => v.length >= MIN_LEAK_CHECK_LENGTH);
        for (const path of this.git.changedFiles()) {
            const full = join(this.siteRoot, path);
            if (!existsSync(full)) {
                continue;
            }
            const text = readFileSync(full).toString("latin1");
            const leaked = secrets.find(([, v]) => text.includes(Buffer.from(v, "utf8").toString("latin1")));
            if (leaked) {
                return `${path} contains the value of credential ${leaked[0]}`;
            }
        }
        return null;
    }

    /** Regenerates the site's pages, when the site has a colvmn engine. */
    rebuild () {
        const staticGen = join(this.siteRoot, "colvmn", "static-gen.js");
        if (!existsSync(staticGen)) {
            return true;
        }
        return spawnSync(process.execPath, [staticGen, this.siteRoot], { stdio: "ignore", timeout: this.timeoutMs }).status === 0;
    }

    publishDirect (message, count) {
        const commit = this.git.commitAll(message);
        return { result: "changed", message: `committed ${count} changed file${count === 1 ? "" : "s"}`, commit };
    }

    /** Commits on the job's PR branch and returns to the current branch; with push, pushes it and opens the PR. */
    publishPr (job, message) {
        const base = this.git.currentBranch();
        const branch = prBranchName(job);
        this.git.checkoutNewBranch(branch);
        const commit = this.git.commitAll(message);
        this.git.checkout(base);
        if (!this.push) {
            return { result: "changed", message: `committed on ${branch} (not pushed; --push opens the PR)`, commit };
        }
        this.git.pushBranch(branch);
        this.git.deleteBranch(branch);
        return { result: "changed", message: this.openPr(branch, base, message), commit };
    }

    openPr (branch, base, title) {
        const body = "Opened by colvmn's update runner. Merge to publish; close and delete the branch to discard.";
        const r = spawnSync("gh", ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body],
            { cwd: this.siteRoot, encoding: "utf8" });
        if (r.status === 0) {
            return `opened ${r.stdout.trim()}`;
        }
        return `pushed ${branch}, but couldn't open the PR (${r.error ? "gh not found" : (r.stderr || "").trim()}); open it by hand`;
    }
}

/** What Claude Code is told: the job's limits, then the job's own prompt. */
export function promptText (job) {
    const f = job.updateFile;
    const folder = job.folderName();
    return [
        "You are refreshing part of a website, as a scheduled job. Your working folder is the site's root.",
        `The job's folder is ${folder}; the page to update is ${folder === "." ? "" : folder + "/"}${f.target()}.`,
        `You may change only files matching: ${f.writes().join(", ")}. Any other change fails the run.`,
        "You have no shell. When you are done, reply with one line saying what you changed, or \"Nothing to change.\"",
        "",
        f.prompt()
    ].join("\n");
}

/** The branch a job's PR is published on. */
export function prBranchName (job) {
    const name = job.folderName() === "." ? "site" : job.folderName();
    return "colvmn-update/" + name.replace(/[^A-Za-z0-9/_-]+/g, "-");
}

function failed (message) {
    return { result: "failed", message };
}

function nothing (message) {
    return { result: "nothing", message };
}
