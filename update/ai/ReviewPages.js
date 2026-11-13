/**
 * Reading a model's answer and writing it as a review page, plus the
 * section's default pages. Used by reviews.js; see layout/AiReviews.js for
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

/** The message sent to a model: the prompt, and the docs in place of the link. */
export function reviewMessage (fullPrompt, llmsFull) {
    return `${fullPrompt}\n\nYou can't browse here, so the site's llms-full.txt (llms.txt with the pages it links) is below instead.\n\n<llms-full.txt>\n${llmsFull}\n</llms-full.txt>`;
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
 * must never run what a model wrote), and headings one level down when it
 * used a top-level one (the page's own title is the only h1).
 */
export function safeMarkdown (md) {
    const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/);
    const escaped = parts.map((p, i) => i % 2 === 1 ? p : p.replace(/</g, "&lt;")).join("");
    return /^# /m.test(escaped) ? escaped.replace(/^(#{1,5}) /gm, "#$1 ") : escaped;
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

/** The section page, when the site hasn't written one. */
export function defaultSectionMarkdown (title) {
    return `# ${title}\n\nAI reviews of this site's content on {date}\n`;
}

/** The review process page, when the site hasn't written one. */
export function defaultAboutMarkdown (title, every) {
    return `---
cardSubtitle: The prompt, the rules, and how to check a review yourself.
---
# ${title}

Each model is sent the same prompt, with this site's documentation attached (its llms-full.txt), by a scheduled job.

## No editing, no rerolling

Each review is the model's first complete answer, published as written, criticism included. A run that fails is retried; a finished answer is never replaced by a second try.

## Corrections beside the review

Where a review gets a fact wrong, an Author's note may follow it. The review itself is never edited.

## Dated, with history kept

A review is redone when the site's documentation or the provider's top model changes, at most every ${every}. The replaced review moves to that model's earlier reviews.

## Check it yourself

Each review page links to the same prompt in that model's own app. Answers vary with the account, plan and settings they're asked from.
`;
}
