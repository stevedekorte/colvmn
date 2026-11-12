/**
 * The git operations the runner needs, run in the site root. Paths and
 * pathspecs are relative to the site root, which may be a folder inside a
 * larger repo.
 */

import { execFileSync } from "node:child_process";

export class Git {

    constructor (siteRoot) {
        this.siteRoot = siteRoot;
    }

    run (args) {
        return execFileSync("git", ["-C", this.siteRoot, ...args],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    }

    isRepo () {
        try {
            this.run(["rev-parse", "--git-dir"]);
            return true;
        } catch {
            return false;
        }
    }

    head () {
        return this.run(["rev-parse", "HEAD"]);
    }

    hasCommit (commit) {
        try {
            this.run(["cat-file", "-e", `${commit}^{commit}`]);
            return true;
        } catch {
            return false;
        }
    }

    /** Files changed, added or deleted in the working tree, relative to the site root. */
    changedFiles () {
        const out = this.run(["ls-files", "--modified", "--others", "--deleted", "--exclude-standard", "-z", "--", "."]);
        return [...new Set(out.split("\0").filter(Boolean))].sort();
    }

    isClean () {
        return this.changedFiles().length === 0 && this.run(["diff", "--cached", "--name-only", "--", "."]) === "";
    }

    /**
     * Whether any commit after `since` touched the pathspecs.
     * @param {string} since - a commit
     * @param {string[]} pathspecs - what to look at, then `:(exclude)…` entries
     */
    hasChangesSince (since, pathspecs) {
        return this.run(["log", "-1", "--format=%H", `${since}..HEAD`, "--", ...pathspecs]) !== "";
    }

    /** Throws away every change in the site's working tree. */
    discardChanges () {
        this.run(["checkout", "-q", "--", "."]);
        this.run(["clean", "-fdq", "--", "."]);
    }

    commitAll (message) {
        this.run(["add", "-A", "--", "."]);
        this.run(["commit", "-q", "-m", message]);
        return this.head();
    }

    push () {
        return this.run(["push", "-q"]);
    }

    /** The current branch, or the commit when HEAD is detached. */
    currentBranch () {
        const name = this.run(["rev-parse", "--abbrev-ref", "HEAD"]);
        return name === "HEAD" ? this.head() : name;
    }

    /** Whether a branch exists here, or on origin. */
    branchExists (name) {
        try {
            this.run(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]);
            return true;
        } catch {
            return this.remoteBranchExists(name);
        }
    }

    remoteBranchExists (name) {
        try {
            return this.run(["ls-remote", "--heads", "origin", name]) !== "";
        } catch {
            return false;
        }
    }

    checkoutNewBranch (name) {
        this.run(["checkout", "-q", "-b", name]);
    }

    checkout (ref) {
        this.run(["checkout", "-q", ref]);
    }

    pushBranch (name) {
        this.run(["push", "-q", "-u", "origin", name]);
    }

    deleteBranch (name) {
        this.run(["branch", "-q", "-D", name]);
    }
}
