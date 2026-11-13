/**
 * Keeping credential values out of git. A value file
 * (`_credentials/<NAME>.secret.txt`) is safe only when git ignores it or
 * git-crypt encrypts it. colvmn checks this three ways:
 *
 *   - Credentials won't read a value file that isn't safe.
 *   - static-gen.js fails the build while one isn't (you build often, so
 *     you hear about it before anything is committed).
 *   - The runner never stages value files, and never cleans them away when
 *     it discards a run's changes.
 *
 * Outside a git repo nothing can be committed, so every file is safe.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export const SECRET_SUFFIX = ".secret.txt";
export const CREDENTIALS_FOLDER = "_credentials";

/** Leaves value files out of a git add or clean, wherever they are. */
export const SECRET_FILES_EXCLUDE = `:(exclude,glob)**/${CREDENTIALS_FOLDER}/*${SECRET_SUFFIX}`;

const SKIPPED = new Set(["node_modules", ".git"]);

function git (dir, args) {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** Whether git can't commit this file as it is: not in a repo, ignored, or encrypted by git-crypt. */
export function isProtected (path) {
    const dir = dirname(path);
    try {
        git(dir, ["rev-parse", "--git-dir"]);
    } catch {
        return true;
    }
    try {
        git(dir, ["check-ignore", "-q", path]);
        return true;
    } catch {
        // not ignored
    }
    try {
        return /: filter: git-crypt/.test(git(dir, ["check-attr", "filter", "--", path]));
    } catch {
        return false;
    }
}

/** Every value file under a folder that git could commit, relative to it. */
export function exposedSecretFiles (root) {
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIPPED.has(entry.name)) {
                    walk(path);
                }
            } else if (entry.name.endsWith(SECRET_SUFFIX) && dir.endsWith(CREDENTIALS_FOLDER) && !isProtected(path)) {
                found.push(relative(root, path));
            }
        }
    };
    if (existsSync(root)) {
        walk(root);
    }
    return found.sort();
}

/** What to tell someone about exposed value files. */
export function exposedMessage (files) {
    return `credential value files that git could commit: ${files.join(", ")}. `
        + `Add "${CREDENTIALS_FOLDER}/*${SECRET_SUFFIX}" to the site's .gitignore (or encrypt them with git-crypt). `
        + "If one was ever committed, rotate that key.";
}
