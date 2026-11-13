/**
 * Reading a model's answer and writing it as a review page, plus a scope's
 * default reviews page. Used by reviews.js; see layout/AiReviews.js for
 * the frontmatter the pages carry and how they're shown.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVE } from "../../layout/AiReviews.js";

const STAMP_LINE = /^Site build:.*$/m;

/** The site's build stamp, as written at the top of llms-full.txt, or null. */
export function buildStampOf (llmsFull) {
    const m = llmsFull.match(STAMP_LINE);
    return m ? m[0].trim() : null;
}

/**
 * What a review is made from, as a hash: the docs (without the stamp line,
 * which changes on any commit), the model, and the prompt.
 */
export function inputHash (llmsFull, modelId, prompt) {
    return createHash("sha256").update(llmsFull.replace(STAMP_LINE, "")).update("\0" + modelId + "\0" + prompt).digest("hex").slice(0, 16);
}

/** The message sent to a model: the prompt, and the docs in place of the link (the site's, or one section's). */
export function reviewMessage (fullPrompt, llmsFull, isRoot = true) {
    const what = isRoot ? "the site's llms-full.txt (all its pages)" : "this section's llms-full.txt (its pages)";
    return `${fullPrompt}\n\nYou can't browse here, so ${what} is below. Base your review only on it.\n\n<llms-full.txt>\n${llmsFull}\n</llms-full.txt>`;
}

/**
 * Splits an answer into the quoted stamp, the verdict and the review.
 * @returns {{ stamp: string, verdict: string, body: string }}
 */
export function parseAnswer (text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const found = { stamp: "", verdict: "" };
    const keep = [];
    lines.forEach((line, i) => {
        const m = i < 12 && line.match(/^[\s*_#>]*(Build stamp|Verdict)[\s*_]*:[\s*_]*(.*?)[\s*_]*$/i);
        if (m) {
            const field = m[1].toLowerCase() === "verdict" ? "verdict" : "stamp";
            found[field] = unquote(m[2]);
        } else {
            keep.push(line);
        }
    });
    if (/^none\.?$/i.test(found.stamp)) {
        found.stamp = "";
    }
    return { ...found, body: safeMarkdown(keep.join("\n").trim()) };
}

function unquote (s) {
    return s.trim().replace(/^["'`“”]+|["'`“”]+$/g, "").trim();
}

/**
 * A model's Markdown, made safe to publish: no raw HTML outside code (a page
 * must never run what a model wrote), and its headings arranged for the page.
 */
export function safeMarkdown (md) {
    const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/);
    const escaped = parts.map((p, i) => i % 2 === 1 ? p : p.replace(/</g, "&lt;")).join("");
    return normalizeHeadings(escaped);
}

/**
 * Headings as the page needs them: a lone title at the top is dropped (the
 * page has its own), and the top level used becomes ## (the page's sections,
 * which its contents list links to). Only heading levels change; no words.
 */
export function normalizeHeadings (md) {
    const lines = md.split("\n");
    let inFence = false;
    const headings = [];
    lines.forEach((line, i) => {
        if (/^```/.test(line)) {
            inFence = !inFence;
        }
        const m = !inFence && line.match(/^(#{1,6}) /);
        if (m) {
            headings.push({ i, level: m[1].length });
        }
    });
    if (headings.length === 0) {
        return md;
    }
    const first = headings[0];
    const isLeadingTitle = lines.slice(0, first.i).every(l => l.trim() === "")
        && headings.filter(h => h.level <= first.level).length === 1 && headings.length > 1;
    if (isLeadingTitle) {
        lines[first.i] = null;
        if (lines[first.i + 1] !== undefined && lines[first.i + 1].trim() === "") {
            lines[first.i + 1] = null;
        }
        headings.shift();
    }
    const shift = Math.min(...headings.map(h => h.level)) - 2;
    headings.forEach(h => {
        const level = Math.max(2, Math.min(6, h.level - shift));
        lines[h.i] = "#".repeat(level) + lines[h.i].replace(/^#+/, "");
    });
    return lines.filter(l => l !== null).join("\n").trim();
}

/** One frontmatter line; values kept to one line. */
function field (name, value) {
    return value ? `${name}: ${String(value).replace(/\s*\n\s*/g, " ").trim()}\n` : "";
}

/** A review page's _index.md. */
export function reviewMarkdown (providerName, review) {
    return "---\n"
        + field("modelName", review.modelName)
        + field("model", review.model)
        + field("reviewed", review.reviewed)
        + field("summary", review.verdict)
        + field("stamp", review.stamp)
        + field("inputHash", review.inputHash)
        + "---\n"
        + `# ${providerName}\n\n${review.body}\n`;
}

/** A page's frontmatter value, or null (enough for the fields written above). */
export function frontmatterValue (markdown, name) {
    const head = markdown.match(/^---\n([\s\S]*?)\n---/);
    const m = head && head[1].match(new RegExp(`^${name}:\\s*(.*)$`, "m"));
    return m ? m[1].trim() : null;
}

/** Makes a folder a page: its _index.md (when given) and an index.html for the generator to fill. */
export function writePage (dir, markdown) {
    mkdirSync(dir, { recursive: true });
    if (markdown !== null) {
        writeFileSync(join(dir, "_index.md"), markdown);
    }
    if (!existsSync(join(dir, "index.html"))) {
        writeFileSync(join(dir, "index.html"), "");
    }
}

/** Moves a provider's current review to archive/<date>/ (another suffix if that date is taken). */
export function archiveReview (providerDir) {
    const path = join(providerDir, "_index.md");
    if (!existsSync(path)) {
        return null;
    }
    const markdown = readFileSync(path, "utf8");
    const date = frontmatterValue(markdown, "reviewed");
    if (!date) {
        return null;
    }
    let name = date, n = 2;
    while (existsSync(join(providerDir, ARCHIVE, name))) {
        name = `${date}-${n++}`;
    }
    const dir = join(providerDir, ARCHIVE, name);
    mkdirSync(dir, { recursive: true });
    renameSync(path, join(dir, "_index.md"));
    writeFileSync(join(dir, "index.html"), "");
    return name;
}

/** A scope's reviews page, when the site hasn't written one. */
export function defaultSectionMarkdown (title, isRoot = true) {
    return `# ${title}\n\nAI reviews of this ${isRoot ? "site" : "section"}'s content on {date}\n`;
}
