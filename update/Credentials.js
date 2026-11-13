/**
 * The credentials a job may be given.
 *
 * A credential is described by `_credentials/<NAME>.json` in the job's folder
 * or any folder above it, up to the site root; the nearest description wins.
 * `{ "blocked": true }` there refuses the credential to everything below it.
 * Being described is not being given: a job gets only what it lists in
 * `secrets:`.
 *
 * The value comes from the environment variable of the same name when it is
 * set (e.g. GitHub Actions secrets), else from `_credentials/<NAME>.secret`
 * beside the description (kept encrypted in git; a file still locked by
 * git-crypt counts as missing). A description may check the value's format:
 *
 *   { "about": "Stripe restricted key, read-only", "pattern": "^rk_" }
 *   { "about": "GCP service account", "format": "json" }
 *
 * colvmn describes the AI Reviews keys itself (CLAUDE_REVIEW_KEY,
 * OPENAI_REVIEW_KEY, GEMINI_REVIEW_KEY, XAI_REVIEW_KEY), so they need only a
 * value. Problems name the credential and never include its value.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { PROVIDERS } from "../layout/AiReviews.js";

const FOLDER = "_credentials";

/** Credentials colvmn describes itself: the AI Reviews keys. A site's own description of the same name wins. */
const BUILT_IN = Object.fromEntries(Object.entries(PROVIDERS).map(([name, p]) => [p.key, { about: `${name} API key for AI Reviews; give it a low spend limit` }]));
const GIT_CRYPT_HEADER = Buffer.from("\0GITCRYPT");

export class Credentials {

    constructor (siteRoot, env = process.env) {
        this.siteRoot = siteRoot;
        this.env = env;
    }

    /**
     * The values a job is given, and what stops it.
     * @param {UpdateJob} job
     * @returns {{ values: Object<string,string>, problems: string[] }}
     */
    forJob (job) {
        const values = {}, problems = [];
        for (const name of job.updateFile.secrets()) {
            const r = this.resolve(name, job.updateFile.folder());
            if (r.problem) {
                problems.push(r.problem);
            } else {
                values[name] = r.value;
            }
        }
        return { values, problems };
    }

    /** One credential for a folder: { value } or { problem }. */
    resolve (name, folder) {
        const found = this.descriptionFor(name, folder);
        if (!found) {
            return { problem: `credential ${name} isn't described: no ${FOLDER}/${name}.json in the job's folder or above it` };
        }
        if (found.description.blocked === true) {
            return { problem: `credential ${name} is blocked for this folder (${found.path})` };
        }
        const value = this.valueFor(name, found.dir);
        if (value === null) {
            return { problem: `credential ${name} has no value: set the ${name} environment variable or add ${FOLDER}/${name}.secret (unlocked)` };
        }
        const formatProblem = checkFormat(name, value, found.description);
        return formatProblem ? { problem: formatProblem } : { value };
    }

    /**
     * The nearest description at or above a folder, else colvmn's own (the
     * AI review keys), as if at the site root; or null.
     */
    descriptionFor (name, folder) {
        for (let dir = folder; ; dir = dirname(dir)) {
            const path = join(dir, FOLDER, `${name}.json`);
            if (existsSync(path)) {
                return { dir, path, description: readDescription(path) };
            }
            if (dir === this.siteRoot || !dir.startsWith(this.siteRoot + sep)) {
                break;
            }
        }
        return BUILT_IN[name] ? { dir: this.siteRoot, path: "(built in)", description: BUILT_IN[name] } : null;
    }

    valueFor (name, dir) {
        if (this.env[name]) {
            return this.env[name];
        }
        const path = join(dir, FOLDER, `${name}.secret`);
        if (!existsSync(path)) {
            return null;
        }
        const bytes = readFileSync(path);
        if (bytes.subarray(0, GIT_CRYPT_HEADER.length).equals(GIT_CRYPT_HEADER)) {
            return null;
        }
        const text = bytes.toString("utf8").trim();
        return text === "" ? null : text;
    }
}

function readDescription (path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    } catch {
        return { invalid: true };
    }
}

function checkFormat (name, value, description) {
    if (description.invalid) {
        return `credential ${name}: its description isn't valid JSON`;
    }
    if (description.pattern && !new RegExp(description.pattern).test(value)) {
        return `credential ${name} doesn't look right: it should match ${description.pattern}`;
    }
    if (description.format === "json") {
        try {
            JSON.parse(value);
        } catch {
            return `credential ${name} doesn't look right: it should be JSON`;
        }
    }
    return null;
}
