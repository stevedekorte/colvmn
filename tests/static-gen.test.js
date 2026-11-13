// Tests for static-gen.js: pages left out of the llms files, and the build stamp.
// Each test builds a small site in a temp folder (a git repo) and runs the
// generator on it as a child process, the way a site runs it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

test("no build stamp unless colvmn.json asks for one", () => {
    const site = makeSite({});
    try {
        commitAll(site, "pages");
        const { llms, llmsFull, rootHtml } = build(site);
        assert.doesNotMatch(llms + llmsFull, /Site build:/);
        assert.doesNotMatch(rootHtml, /build-stamp/);
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
        assert.match(out.rootHtml, /<div class="build-stamp">Site build: Example/);

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
        writePage(site, "AI Reviews", "# AI Reviews\n\nUnedited reviews of this site.\n\n## How they're made\n\nThe first answer is published.\n");
        writePage(site, "AI Reviews/Claude", "---\nmodelName: Claude Opus 5.5\nreviewed: 2026-11-20\nstamp: Site build: Example · 2026-11-19 · abc1234\nshare: https://claude.ai/share/xyz\n---\n# Claude\n\nIt is a framework.\n");
        writePage(site, "AI Reviews/Claude/archive/2026-10-01", "---\nmodelName: Claude Opus 5\nreviewed: 2026-10-01\n---\n# Claude\n\nAn older review.\n");
        const before = commitAll(site, "pages");
        build(site);
        const read = folder => readFileSync(join(site, folder, "index.html"), "utf-8");

        const section = read("AI Reviews");
        assert.match(section, /Claude Opus 5\.5 · 2026-11-20/);
        assert.match(section, /Not reviewed yet\./);                 // Gemini has no review
        assert.match(section, /How they(&#39;|')re made/);
        assert.match(section, /class="review-prompt">Read https:\/\/example\.com\/llms\.txt &amp; evaluate it\./);

        const claude = read("AI Reviews/Claude");
        assert.match(claude, new RegExp(`href="https://claude\\.ai/new\\?q=${encodeURIComponent(prompt).replace(/[.?*()]/g, "\\$&")}"`));
        assert.match(claude, /Quoted build stamp: Site build: Example · 2026-11-19 · abc1234/);
        assert.match(claude, /View the original conversation/);
        assert.match(claude, /not an endorsement by Anthropic/);
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

test("aiReviews about: its card ends the grid, and the prompt moves to its page", () => {
    const site = makeSite({ aiReviews: { folder: "AI Reviews", prompt: "Evaluate it.", providers: ["Claude", "Grok"], about: "How" } });
    try {
        writePage(site, "AI Reviews", "# AI Reviews\n\nShort summary.\n");
        writePage(site, "AI Reviews/How", "---\ncardSubtitle: The rules.\n---\n# How These Are Made\n\nThe rules.\n");
        commitAll(site, "pages");
        build(site);
        const section = readFileSync(join(site, "AI Reviews", "index.html"), "utf-8");
        assert.match(section, /<h3>Grok<\/h3>[\s\S]*<h3>How These Are Made<\/h3><p>The rules\.<\/p>/);
        assert.doesNotMatch(section, /review-prompt/);
        const about = readFileSync(join(site, "AI Reviews", "How", "index.html"), "utf-8");
        assert.match(about, /class="review-prompt">Evaluate it\./);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});
