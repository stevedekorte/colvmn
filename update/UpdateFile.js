/**
 * An `_update.md`: a folder's instructions for refreshing itself on a
 * schedule. Its frontmatter says when and how; its body is the prompt (or,
 * for a script job, `run:` names the script and the body is a note).
 *
 *   ---
 *   schedule: weekly
 *   writes: ["Competition/**"]
 *   publish: pr
 *   model: claude-sonnet-5-5
 *   budget: 1.00
 *   ---
 *   Research the AI tabletop products listed below...
 *
 * The frontmatter here needs lists (`writes`, `secrets`), which the page
 * parser does not read, so update files have their own small parser; pages
 * are unaffected.
 */

import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export const UPDATE_FILE_NAME = "_update.md";

const PUBLISH_MODES = ["pr", "direct"];
const KNOWN_KEYS = ["schedule", "target", "writes", "publish", "model", "budget", "run", "secrets"];
const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;

export class UpdateFile {

    /**
     * Reads and parses the update file at a path.
     * @param {string} filePath - absolute path to an `_update.md`
     * @param {string} siteRoot - the site's root folder
     * @returns {UpdateFile}
     */
    static fromPath (filePath, siteRoot) {
        return new UpdateFile(readFileSync(filePath, "utf8"), filePath, siteRoot);
    }

    constructor (text, filePath, siteRoot) {
        this.filePath = filePath;
        this.siteRoot = siteRoot;
        const { fields, body } = parseUpdateMarkdown(text);
        this.fields = fields;
        this.body = body;
    }

    /** The job's folder, absolute. */
    folder () {
        return dirname(this.filePath);
    }

    /** The job's folder relative to the site root, "/"-separated ("." for the root). */
    folderName () {
        const rel = relative(this.siteRoot, this.folder());
        return rel === "" ? "." : rel.split(sep).join("/");
    }

    /** "script" when the file names a script to run, else "prompt". */
    kind () {
        return this.fields.run ? "script" : "prompt";
    }

    schedule () {
        return this.fields.schedule || null;
    }

    /** The page the job refreshes: the file's `target`, else the folder's own page. */
    target () {
        return this.fields.target || "_index.md";
    }

    /** What the run may change, as globs relative to the site root; default: the folder itself. */
    writes () {
        if (Array.isArray(this.fields.writes)) {
            return this.fields.writes;
        }
        const name = this.folderName();
        return [name === "." ? "**" : name + "/**"];
    }

    publish () {
        return this.fields.publish || "pr";
    }

    model () {
        return this.fields.model || null;
    }

    /** Dollars per run, or null when none is set. */
    budget () {
        return typeof this.fields.budget === "number" ? this.fields.budget : null;
    }

    /** The script a script job runs, absolute, or null for a prompt job. */
    scriptPath () {
        return this.fields.run ? join(this.folder(), this.fields.run) : null;
    }

    /** The credentials the job asks for, by name. */
    secrets () {
        return Array.isArray(this.fields.secrets) ? this.fields.secrets : [];
    }

    prompt () {
        return this.kind() === "prompt" ? this.body : null;
    }

    /**
     * What is wrong with the file, as sentences; empty when it can run.
     * @returns {string[]}
     */
    problems () {
        return [
            ...this.unknownKeyProblems(),
            ...this.scheduleProblems(),
            ...this.publishProblems(),
            ...this.budgetProblems(),
            ...this.secretProblems(),
            ...this.promptProblems()
        ];
    }

    unknownKeyProblems () {
        return Object.keys(this.fields).filter(k => !KNOWN_KEYS.includes(k)).map(k => `unknown setting "${k}"`);
    }

    scheduleProblems () {
        return this.schedule() ? [] : ["no schedule (daily, weekly, monthly, or a cron string)"];
    }

    publishProblems () {
        return PUBLISH_MODES.includes(this.publish()) ? [] : [`publish must be pr or direct, not "${this.publish()}"`];
    }

    budgetProblems () {
        const b = this.fields.budget;
        if (b === undefined) {
            return this.kind() === "prompt" ? ["a prompt job needs a budget (dollars per run)"] : [];
        }
        return (typeof b === "number" && b > 0) ? [] : [`budget must be a number of dollars above 0, not "${b}"`];
    }

    secretProblems () {
        const bad = this.secrets().filter(n => !SECRET_NAME.test(n)).map(n => `credential name "${n}" is not UPPER_SNAKE_CASE`);
        if (this.kind() === "prompt" && this.secrets().length > 0) {
            bad.push("a prompt job may not list credentials: scripts get keys, the model gets the web, no run has both");
        }
        return bad;
    }

    promptProblems () {
        return (this.kind() === "prompt" && this.body.trim() === "") ? ["a prompt job needs a prompt (the file's body)"] : [];
    }
}

/**
 * Splits an update file into its frontmatter fields and body.
 * Frontmatter values may be strings (quoted or not), numbers, booleans,
 * inline lists (`["a", b]`) or block lists (`- a` lines under `key:`).
 * A `#` after a space starts a comment.
 * @param {string} text
 * @returns {{fields: Object, body: string}}
 */
export function parseUpdateMarkdown (text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    if (lines[0].trim() !== "---") {
        return { fields: {}, body: text.trim() };
    }
    const end = lines.indexOf("---", 1);
    if (end === -1) {
        return { fields: {}, body: text.trim() };
    }
    return { fields: parseFrontmatterLines(lines.slice(1, end)), body: lines.slice(end + 1).join("\n").trim() };
}

function parseFrontmatterLines (lines) {
    const fields = {};
    let listKey = null;
    for (const raw of lines) {
        const line = stripComment(raw);
        if (line.trim() === "") {
            continue;
        }
        const item = line.match(/^\s+-\s+(.*)$/) || line.match(/^-\s+(.*)$/);
        if (item && listKey) {
            fields[listKey].push(parseScalar(item[1]));
            continue;
        }
        const pair = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
        if (!pair) {
            continue;
        }
        const [, key, value] = pair;
        listKey = value === "" ? key : null;
        fields[key] = value === "" ? [] : parseValue(value);
    }
    return fields;
}

function stripComment (line) {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
            if (c === quote) { quote = null; }
        } else if (c === "\"" || c === "'") {
            quote = c;
        } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
            return line.slice(0, i).trimEnd();
        }
    }
    return line;
}

function parseValue (value) {
    const v = value.trim();
    if (v.startsWith("[") && v.endsWith("]")) {
        return splitInlineList(v.slice(1, -1)).map(parseScalar);
    }
    return parseScalar(v);
}

function splitInlineList (inner) {
    const items = [];
    let current = "", quote = null;
    for (const c of inner) {
        if (quote) {
            current += c;
            if (c === quote) { quote = null; }
        } else if (c === "\"" || c === "'") {
            quote = c; current += c;
        } else if (c === ",") {
            items.push(current); current = "";
        } else {
            current += c;
        }
    }
    items.push(current);
    return items.map(s => s.trim()).filter(s => s !== "");
}

function parseScalar (value) {
    const v = value.trim();
    if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) {
        return v.slice(1, -1);
    }
    if (v === "true" || v === "false") {
        return v === "true";
    }
    if (/^-?\d+(\.\d+)?$/.test(v)) {
        return Number(v);
    }
    return v;
}
