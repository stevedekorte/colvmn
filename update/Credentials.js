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
 * set (e.g. GitHub Actions secrets), else from `_credentials/<NAME>.secret.txt`
 * beside the description, which must be ignored by git or encrypted with
 * git-crypt (see SecretFiles.js; a file still locked counts as missing). A description may check the value's format:
 *
 *   { "about": "Stripe restricted key, read-only", "pattern": "^rk_" }
 *   { "about": "GCP service account", "format": "json" }
 *
 * colvmn describes the providers' standard API keys itself (ANTHROPIC_API_KEY,
 * OPENAI_API_KEY, GEMINI_API_KEY, XAI_API_KEY), and any other key names the
 * site's aiReviews "keys" setting gives, so they need only a value, as if
 * described at the site root. A site's own description of the same name
 * wins. Problems name the credential and never include its value.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { AiReviews, PROVIDERS } from "../layout/AiReviews.js";

import { CREDENTIALS_FOLDER as FOLDER, SECRET_SUFFIX, isProtected } from "./SecretFiles.js";

/** The standard API key names colvmn describes itself, for any job that lists them. */
const STANDARD_KEYS = Object.fromEntries(Object.values(PROVIDERS).map(p => [p.key, { about: `${p.company} API key` }]));
const GIT_CRYPT_HEADER = Buffer.from("\0GITCRYPT");

export class Credentials {

    constructor (siteRoot, env = process.env) {
        this.siteRoot = siteRoot;
        this.env = env;
        this.builtIn = { ...STANDARD_KEYS, ...aiReviewKeys(siteRoot) };
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
        const exposed = this.exposedValueFile(name, found.dir);
        if (exposed) {
            return { problem: `credential ${name}: ${exposed} isn't ignored by git, so it could be committed; add "${FOLDER}/*${SECRET_SUFFIX}" to .gitignore` };
        }
        const value = this.valueFor(name, found.dir);
        if (value === null) {
            return { problem: `credential ${name} has no value: set the ${name} environment variable or add ${FOLDER}/${name}${SECRET_SUFFIX} (unlocked)` };
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
        return this.builtIn[name] ? { dir: this.siteRoot, path: "(built in)", description: this.builtIn[name] } : null;
    }

    /** The value file's path when it exists and git could commit it, else null. */
    exposedValueFile (name, dir) {
        if (this.env[name]) {
            return null;
        }
        const path = join(dir, FOLDER, `${name}${SECRET_SUFFIX}`);
        return existsSync(path) && !isProtected(path) ? join(FOLDER, `${name}${SECRET_SUFFIX}`) : null;
    }

    valueFor (name, dir) {
        if (this.env[name]) {
            return this.env[name];
        }
        const path = join(dir, FOLDER, `${name}${SECRET_SUFFIX}`);
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

/** The key names a site's aiReviews "keys" setting gives, described like the standard ones. */
function aiReviewKeys (siteRoot) {
    try {
        const reviews = siteRoot ? AiReviews.forSiteRoot(siteRoot) : null;
        return reviews ? Object.fromEntries(reviews.producible().map(p => [p.key, { about: `${p.company} API key for AI Reviews` }])) : {};
    } catch {
        return {};
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
