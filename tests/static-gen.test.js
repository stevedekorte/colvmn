// Tests for static-gen.js: pages left out of the llms files, and the build stamp.
// Each test builds a small site in a temp folder (a git repo) and runs the
// generator on it as a child process, the way a site runs it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ANSWER_FORMAT } from "../layout/AiReviews.js";

const staticGen = join(dirname(fileURLToPath(import.meta.url)), "..", "static-gen.js");

function git (site, ...args) {
    return execFileSync("git", ["-C", site, ...args], { encoding: "utf-8" }).trim();
}

function writePage (site, folder, markdown) {
    const dir = join(site, folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "_index.md"), markdown);
    writeFileSync(join(dir, "index.html"), "");
}

/** Opts a page in to AI reviews, keeping its title and text. */
function optIn (site, folder, title = null, extra = "") {
    const path = join(site, folder, "_index.md");
    const text = readFileSync(path, "utf-8");
    const body = text.replace(/^---\n([\s\S]*?)\n---\n/, "");
    const head = (text.match(/^---\n([\s\S]*?)\n---\n/) || [null, ""])[1];
    writeFileSync(path, `---\n${head ? head + "\n" : ""}aiReviews: true\n${extra}---\n${title ? body.replace(/^# .*/, `# ${title}`) : body}`);
}

function commitAll (site, message) {
    git(site, "add", "-A");
    git(site, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", message);
    return git(site, "log", "-1", "--format=%h");
}

function build (site) {
    execFileSync("node", [staticGen, site], { stdio: "ignore" });
    return {
        llms: readFileSync(join(site, "llms.txt"), "utf-8"),
        llmsFull: readFileSync(join(site, "llms-full.txt"), "utf-8"),
        rootHtml: readFileSync(join(site, "index.html"), "utf-8"),
    };
}

function makeSite (config) {
    const site = mkdtempSync(join(tmpdir(), "colvmn-site-"));
    git(site, "init", "-q");
    writeFileSync(join(site, "colvmn.json"), JSON.stringify(config));
    writePage(site, ".", "---\ntopTitle: Example\n---\n# Example\n\nThe root page.\n");
    writePage(site, "kept", "# Kept Page\n\nKept text.\n");
    writePage(site, "private", "---\nllms: false\n---\n# Private Page\n\nPrivate text.\n");
    writePage(site, "private/child", "# Private Child\n\nChild text.\n");
    writePage(site, "guide/_unused", "# Unused Draft\n\nDraft text.\n");
    writePage(site, "guide", "# Guide\n\nGuide text.\n");
    return site;
}

test("unlisted folders stay generated but leave the sitemap and llms files", () => {
    const site = makeSite({ siteUrl: "https://example.com/", unlisted: ["guide"] });
    try {
        commitAll(site, "pages");
        const { llms, llmsFull } = build(site);
        const sitemap = readFileSync(join(site, "sitemap.xml"), "utf-8");
        assert.match(sitemap, /example\.com\/kept\//);
        assert.doesNotMatch(sitemap, /\/guide\//, "the folder and everything under it");
        for (const text of [llms, llmsFull]) {
            assert.match(text, /Kept Page/);
            assert.doesNotMatch(text, /Guide|Unused Draft/);
        }
        assert.match(readFileSync(join(site, "guide", "index.html"), "utf-8"), /Guide text/, "still generated");
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("llms: false leaves a page and its subtree out; llmsExclude matches a folder name at any depth", () => {
    const site = makeSite({ llmsExclude: ["_unused"] });
    try {
        commitAll(site, "pages");
        const { llms, llmsFull } = build(site);
        for (const text of [llms, llmsFull]) {
            assert.match(text, /Kept Page/);
            assert.match(text, /Guide/);
            assert.doesNotMatch(text, /Private Page|Private Child|Unused Draft/);
        }
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("a nested site's pages stay out of the enclosing site's llms files and build stamp, but are generated and in the sitemap", () => {
    const site = makeSite({ buildStamp: true });
    try {
        writePage(site, "fun/game/docs", "# Game Docs\n\nNested site text.\n");
        writePage(site, "fun/game/docs/rules", "# Rules\n\nNested rules text.\n");
        symlinkSync(join(dirname(staticGen)), join(site, "fun", "game", "docs", "colvmn"));
        const first = commitAll(site, "pages");
        writeFileSync(join(site, "fun", "game", "docs", "rules", "_index.md"), "# Rules\n\nEdited.\n");
        commitAll(site, "nested edit");
        const { llms, llmsFull } = build(site);
        assert.doesNotMatch(llms + llmsFull, /Game Docs|Nested|Rules|fun\/game/);
        assert.match(llmsFull, new RegExp(`· ${first}`), "a nested edit doesn't move the stamp");
        assert.match(readFileSync(join(site, "fun", "game", "docs", "rules", "index.html"), "utf-8"), /Edited\./);
        assert.match(readFileSync(join(site, "sitemap.xml"), "utf-8"), /fun\/game\/docs\/rules\//);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("no build stamp unless colvmn.json asks for one", () => {
    const site = makeSite({});
    try {
        commitAll(site, "pages");
        const { llms, llmsFull, rootHtml } = build(site);
        assert.doesNotMatch(llms + llmsFull, /Site build:/);
        assert.doesNotMatch(rootHtml, /Site build:/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("the build stamp names the last commit that changed included pages", () => {
    const site = makeSite({ buildStamp: true, llmsExclude: ["_unused"] });
    try {
        const first = commitAll(site, "pages");
        let out = build(site);
        const stamp = new RegExp(`Site build: Example · \\d{4}-\\d{2}-\\d{2} · ${first}`);
        assert.match(out.llms, stamp);
        assert.match(out.llmsFull, stamp);
        assert.match(out.rootHtml, /<!-- Site build: Example/);
        assert.doesNotMatch(out.rootHtml, /class="build-stamp"/, "the stamp is not shown on the page");

        // Generated output and excluded pages don't move it.
        commitAll(site, "generated output");
        writeFileSync(join(site, "private", "_index.md"), "---\nllms: false\n---\n# Private Page\n\nEdited.\n");
        writeFileSync(join(site, "guide", "_unused", "_index.md"), "# Unused Draft\n\nEdited.\n");
        commitAll(site, "excluded edits");
        out = build(site);
        assert.match(out.llmsFull, stamp);

        // An included page does.
        writeFileSync(join(site, "kept", "_index.md"), "# Kept Page\n\nEdited.\n");
        const third = commitAll(site, "kept edit");
        out = build(site);
        assert.match(out.llmsFull, new RegExp(`· ${third}`));
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("aiReviews: provider cards, review headers with prefilled links, the archive, and no llms", () => {
    const prompt = "Read https://example.com/llms.txt & evaluate it.";
    const site = makeSite({ buildStamp: true, aiReviews: { folder: "AI Reviews", prompt, providers: ["Claude", "Gemini"] } });
    try {
        optIn(site, ".");
        writePage(site, "AI Reviews", "# AI Reviews\n\nAI reviews of this site's content on {date}\n\n## How they're made\n\nThe first answer is published.\n");
        writePage(site, "AI Reviews/Claude", "---\nmodelName: Claude Opus 5.5\nreviewed: 2026-11-20\nsummary: A coherent naked-objects framework with a small community.\nstamp: Site build: Example · 2026-11-19 · abc1234\nshare: https://claude.ai/share/xyz\n---\n# Claude\n\nIt is a framework.\n");
        writePage(site, "AI Reviews/Claude/archive/2026-10-01", "---\nmodelName: Claude Opus 5\nreviewed: 2026-10-01\n---\n# Claude\n\nAn older review.\n");
        const before = commitAll(site, "pages");
        build(site);
        const read = folder => readFileSync(join(site, folder, "index.html"), "utf-8");

        const section = read("AI Reviews");
        assert.match(section, /<h3>Claude Opus 5\.5<\/h3><p>A coherent naked-objects framework with a small community\.<\/p>/);
        assert.match(section, /AI reviews of this site(&#39;|')s content on 2026-11-20/);
        assert.match(section, /Not reviewed yet\./);                 // Gemini has no review
        assert.match(section, /How they(&#39;|')re made/);
        assert.match(section, /class="review-prompt">Read https:\/\/example\.com\/llms\.txt &amp; evaluate it\./);

        const claude = read("AI Reviews/Claude");
        const askUrl = "https://claude.ai/new?q=" + encodeURIComponent(`${prompt}\n\n${ANSWER_FORMAT}`);
        assert.ok(claude.includes(`href="${askUrl.replace(/&/g, "&amp;")}"`), "the prefilled link carries the prompt and the answer format");
        // Model, date and links on top; the technical details after the review.
        // Model, date and verdict on top; the details and the links to try it after the review.
        assert.match(claude, /class="review-header">[\s\S]*It is a framework\.[\s\S]*Details[\s\S]*Build stamp it quoted: Site build: Example · 2026-11-19 · abc1234[\s\S]*Ask Claude yourself[\s\S]*View the original conversation[\s\S]*Earlier reviews/);
        assert.doesNotMatch(claude.split("It is a framework.")[0], /Build stamp it quoted|not an endorsement/);
        assert.match(claude, /View the original conversation/);
        assert.match(claude, /not an endorsement by Anthropic/);
        assert.match(claude, /class="review-header">[\s\S]*<nav class="toc"><ul><li><a href="#details">Details<\/a><\/li><li><a href="#earlier-reviews">Earlier reviews<\/a><\/li><\/ul><\/nav>/);   // a contents list under the header
        assert.match(claude, /class="review-verdict">A coherent naked-objects framework with a small community\.<\/p>/);   // the full verdict, at the top
        assert.match(claude, /Earlier reviews[\s\S]*archive\/2026-10-01\/index\.html/);

        const archived = read("AI Reviews/Claude/archive/2026-10-01");
        assert.match(archived, /The current review/);
        assert.match(archived, /didn(&#39;|')t quote the site(&#39;|')s build stamp|didn't quote/);

        const { llms, llmsFull } = build(site);
        assert.doesNotMatch(llms + llmsFull, /AI Reviews|It is a framework/);
        assert.match(llmsFull, new RegExp(`· ${before}`));
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("aiReviews: a page that opts in gets a footer link once its reviews page exists; other pages don't", () => {
    const site = makeSite({ aiReviews: { folder: "AI Reviews", providers: ["Claude"] } });
    try {
        optIn(site, ".");
        commitAll(site, "pages");
        assert.doesNotMatch(build(site).rootHtml, /AI reviews of this site/, "no reviews page yet");
        writePage(site, "AI Reviews", "# AI Reviews\n\nAI reviews of this site's content on {date}\n");
        assert.match(build(site).rootHtml, /<div class="page-footer"><span class="footer-links"><a href="AI%20Reviews\/index\.html">AI reviews of this site<\/a><\/span><\/div>/);
        assert.doesNotMatch(readFileSync(join(site, "kept", "index.html"), "utf-8"), /AI reviews of this/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("aiReviews: a section that opts in gets its own reviews, footer link, and llms-full.txt with its own stamp; no reviews folder reaches any llms file", () => {
    const site = makeSite({ buildStamp: true, aiReviews: { folder: "AI Reviews", providers: ["Claude"] } });
    try {
        optIn(site, ".");
        optIn(site, "guide", "Guide", "prompt: Is this guide clear?\n");
        writePage(site, "guide/lesson", "# Lesson\n\nLesson text.\n");
        writePage(site, "AI Reviews", "# AI Reviews\n\nAI reviews of this site's content on {date}\n");
        writePage(site, "AI Reviews/Claude", "---\nmodelName: Claude Fable 5.2\nreviewed: 2026-11-12\nsummary: The whole site.\n---\n# Claude\n\nRoot review text.\n");
        writePage(site, "guide/AI Reviews", "# AI Reviews\n\nAI reviews of this section's content on {date}\n");
        writePage(site, "guide/AI Reviews/Claude", "---\nmodelName: Claude Fable 5.2\nreviewed: 2026-11-11\nsummary: Just the guide.\n---\n# Claude\n\nGuide review text.\n");
        const guideCommit = commitAll(site, "pages");
        writeFileSync(join(site, "kept", "_index.md"), "# Kept Page\n\nEdited outside the guide.\n");
        const keptCommit = commitAll(site, "kept edit");

        const { llms, llmsFull } = build(site);
        const scoped = readFileSync(join(site, "guide", "llms-full.txt"), "utf-8");
        assert.match(scoped, /^# Example: Guide — Full Documentation/);
        assert.match(scoped, new RegExp(`Site build: Example › Guide · \\d{4}-\\d{2}-\\d{2} · ${guideCommit}`), "the guide's stamp ignores commits outside it");
        assert.match(llmsFull, new RegExp(`· ${keptCommit}`));
        assert.match(scoped, /Guide text\.[\s\S]*Lesson text\./);
        assert.doesNotMatch(scoped, /Kept text|The root page|Edited outside/);
        for (const text of [llms, llmsFull, scoped]) {
            assert.doesNotMatch(text, /review text|Just the guide|The whole site/);
        }

        const guide = readFileSync(join(site, "guide", "index.html"), "utf-8");
        assert.match(guide, /<a href="AI%20Reviews\/index\.html">AI reviews of this section<\/a>/);
        assert.doesNotMatch(readFileSync(join(site, "guide", "lesson", "index.html"), "utf-8"), /AI reviews of this/, "not inherited");

        const section = readFileSync(join(site, "guide", "AI Reviews", "index.html"), "utf-8");
        assert.match(section, /<h3>Claude Fable 5\.2<\/h3><p>Just the guide\.<\/p>/);
        assert.match(section, /AI reviews of this section(&#39;|')s content on 2026-11-11/);
        assert.match(section, /class="review-prompt">Is this guide clear\?/);
        assert.match(readFileSync(join(site, "AI Reviews", "index.html"), "utf-8"), /<p>The whole site\.<\/p>/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("footerLinks and the AI reviews link share one footer line, separated by middle dots", () => {
    const site = makeSite({ aiReviews: { folder: "AI Reviews", providers: ["Claude"] } });
    try {
        rmSync(join(site, "_index.md"));
        writeFileSync(join(site, "_index.json"), JSON.stringify({ topTitle: "Example", title: "Example", aiReviews: true, footerLinks: [{ title: "llms.txt", href: "llms.txt" }, { title: "llms-full.txt", href: "llms-full.txt" }], content: [] }));
        writePage(site, "AI Reviews", "# AI Reviews\n\nAI reviews of this site's content on {date}\n");
        commitAll(site, "pages");
        assert.match(build(site).rootHtml, /<div class="page-footer"><span class="footer-links"><a href="llms\.txt">llms\.txt<\/a><span class="footer-sep"> &middot; <\/span><a href="llms-full\.txt">llms-full\.txt<\/a><span class="footer-sep"> &middot; <\/span><a href="AI%20Reviews\/index\.html">AI reviews of this site<\/a><\/span><\/div>/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("aiReviews homeCard: a card for the section joins the root page's last card grid, once the section exists", () => {
    const site = makeSite({ aiReviews: { folder: "AI Reviews", homeCard: true } });
    try {
        rmSync(join(site, "_index.md"));
        writeFileSync(join(site, "_index.json"), JSON.stringify({ topTitle: "Example", title: "Example", aiReviews: true, content: [{ type: "ContentCards", items: [{ folder: "kept", title: "Kept" }] }] }));
        commitAll(site, "pages");
        assert.doesNotMatch(build(site).rootHtml, /<h3>AI Reviews<\/h3>/, "no section page yet");
        writePage(site, "AI Reviews", "---\ncardSubtitle: What four models make of it.\n---\n# AI Reviews\n\nAI reviews of this site's content on {date}\n");
        const { rootHtml, llmsFull } = build(site);
        assert.match(rootHtml, /<h3>Kept<\/h3>[\s\S]*<a class="card[^"]*" href="AI%20Reviews\/index\.html"><h3>AI Reviews<\/h3><p>What four models make of it\.<\/p>/);
        assert.doesNotMatch(llmsFull, /What four models/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});
