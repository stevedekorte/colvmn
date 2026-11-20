// Tests for static-gen.js: pages left out of the llms files, and the build stamp.
// Each test builds a small site in a temp folder (a git repo) and runs the
// generator on it as a child process, the way a site runs it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ANSWER_FORMAT } from "../layout/AiReviews.js";
import { linkPhoneNumbers } from "../layout/MarkdownParser.js";

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
        assert.doesNotMatch(section, /The Prompt|class="review-prompt"/);   // the prompt is in each review's Details

        const claude = read("AI Reviews/Claude");
        assert.match(claude, /class="review-prompt">Read https:\/\/example\.com\/llms\.txt &amp; evaluate it\./);
        const askUrl = "https://claude.ai/new?q=" + encodeURIComponent(`${prompt}\n\n${ANSWER_FORMAT}`);
        assert.ok(claude.includes(`href="${askUrl.replace(/&/g, "&amp;")}"`), "the prefilled link carries the prompt and the answer format");
        // Model, date and links on top; the technical details after the review.
        // Model, date and verdict on top; the details and the links to try it after the review.
        assert.match(claude, /class="review-header">[\s\S]*It is a framework\.[\s\S]*Details[\s\S]*Build stamp it quoted: Site build: Example · 2026-11-19 · abc1234[\s\S]*Ask Claude yourself[\s\S]*View the original conversation[\s\S]*Earlier reviews/);
        assert.doesNotMatch(claude.split("It is a framework.")[0], /Build stamp it quoted|not an endorsement/);
        assert.match(claude, /View the original conversation/);
        assert.match(claude, /not an endorsement by Anthropic/);
        assert.match(claude, /<h2 id="details" class="collapsible-head"><button type="button" class="collapsible-toggle" aria-expanded="false" aria-controls="details-panel">/);   // Details starts closed
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
        assert.doesNotMatch(build(site).rootHtml, /AI reviews →/, "no reviews page yet");
        writePage(site, "AI Reviews", "# AI Reviews\n\nAI reviews of this site's content on {date}\n");
        assert.match(build(site).rootHtml, /<div class="page-footer"><span class="footer-links"><a href="AI%20Reviews\/index\.html"><strong>AI reviews →<\/strong><\/a><\/span><\/div>/);
        assert.doesNotMatch(readFileSync(join(site, "kept", "index.html"), "utf-8"), /AI reviews →/);
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
        assert.match(guide, /<a href="AI%20Reviews\/index\.html"><strong>AI reviews →<\/strong><\/a>/);
        assert.doesNotMatch(readFileSync(join(site, "guide", "lesson", "index.html"), "utf-8"), /AI reviews →/, "not inherited");

        const section = readFileSync(join(site, "guide", "AI Reviews", "index.html"), "utf-8");
        assert.match(section, /<h3>Claude Fable 5\.2<\/h3><p>Just the guide\.<\/p>/);
        assert.match(section, /AI reviews of this section(&#39;|')s content on 2026-11-11/);
        assert.doesNotMatch(section, /class="review-prompt"/);
        assert.match(readFileSync(join(site, "guide", "AI Reviews", "Claude", "index.html"), "utf-8"), /class="review-prompt">Is this guide clear\?/);
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
        assert.match(build(site).rootHtml, /<div class="page-footer"><span class="footer-links"><a href="llms\.txt">llms\.txt<\/a><span class="footer-sep"> &middot; <\/span><a href="llms-full\.txt">llms-full\.txt<\/a><span class="footer-sep"> &middot; <\/span><a href="AI%20Reviews\/index\.html"><strong>AI reviews →<\/strong><\/a><\/span><\/div>/);
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

test("a heading marked {.collapsed} builds a closed section that its heading opens; the marker stays out of the llms files", () => {
    const site = makeSite({});
    try {
        writePage(site, "kept", "# Kept Page\n\nKept text.\n\n## Notes {.collapsed}\n\nHidden text.\n\n```markdown\n## Example {.collapsed}\n```\n\n## Open\n\nShown text.\n");
        const { llmsFull } = build(site);
        const html = readFileSync(join(site, "kept", "index.html"), "utf-8");
        assert.match(html, /<h2 id="notes" class="collapsible-head"><button type="button" class="collapsible-toggle" aria-expanded="false" aria-controls="notes-panel"><span class="collapsible-title">Notes<\/span>/);
        assert.match(html, /<noscript><style>#notes-panel\{[^<]*<\/style><\/noscript><div id="notes-panel" class="collapsible-panel"><div class="collapsible-inner"><div class="section"><div class="section-body"><p>Hidden text\.<\/p>/);
        assert.match(html, /<h2 id="open">Open<\/h2>/);
        assert.match(llmsFull, /^## Notes$/m);
        assert.doesNotMatch(llmsFull, /^## Notes \{\.collapsed\}/m);
        assert.match(llmsFull, /^## Example \{\.collapsed\}$/m);   // an example in a code block keeps it
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("consecutive images marked {.slideshow} become one slideshow of zoomable slides; other images stay as they are", () => {
    const site = makeSite({});
    try {
        writePage(site, "kept", "# Kept Page\n\nKept text.\n\n![One](a.jpg){.slideshow}\n\n![Two](b.jpg){.slideshow}\n![Three](c.jpg){.slideshow}\n\n![Alone](d.jpg)\n");
        build(site);
        const html = readFileSync(join(site, "kept", "index.html"), "utf-8");
        assert.equal((html.match(/class="colvmn-slideshow"/g) || []).length, 1);
        assert.match(html, /<figure class="slide is-active" aria-roledescription="slide" aria-label="1 of 3"><img src="a\.jpg" alt="One" class="colvmn-zoomable-image"><\/figure>/);
        assert.match(html, /aria-label="3 of 3" aria-hidden="true"><img loading="lazy" src="c\.jpg" alt="Three" class="colvmn-zoomable-image">/);
        assert.match(html, /<span class="slideshow-count">1 \/ 3<\/span>/);
        assert.match(html, /<button class="slideshow-edge slideshow-edge-prev" type="button" tabindex="-1" aria-label="Previous image">[\s\S]*<button class="slideshow-edge slideshow-edge-next"[^>]*>.*?<\/button><\/div><div class="slideshow-controls">/);   // the image's sides, inside the frame
        assert.match(html, /<p class="colvmn-image"><img src="d\.jpg" alt="Alone"><\/p>/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("consecutive images marked {.row} become one row of figures, titles as captions; image titles elsewhere stay titles", () => {
    const site = makeSite({});
    try {
        writePage(site, "kept", "# Kept Page\n\nKept text.\n\n![One](a.png \"First one\"){.row}\n\n![Two](b%20c.png){.row .colvmn-zoomable-image}\n![Three](my d.png \"Third\"){.row}\n\n![Alone](e.png \"Tip\")\n");
        build(site);
        const html = readFileSync(join(site, "kept", "index.html"), "utf-8");
        assert.equal((html.match(/class="colvmn-image-row"/g) || []).length, 1);
        assert.match(html, /<div class="colvmn-image-row"><figure><img src="a\.png" alt="One"><figcaption>First one<\/figcaption><\/figure><figure><img src="b%20c\.png" alt="Two" class="colvmn-zoomable-image"><\/figure><figure><img src="my d\.png" alt="Three"><figcaption>Third<\/figcaption><\/figure><\/div>/);
        assert.match(html, /<p class="colvmn-image"><img src="e\.png" alt="Alone" title="Tip"><\/p>/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("image layout options: classes in markdown pass through; ContentImage builds them from size, align, zoomable and width", () => {
    const site = makeSite({});
    try {
        writePage(site, "kept", "# Kept Page\n\n![Wide](w.png){.left .column .mine}\n\nSee ![icon](i.png) here.\n\n<img src=\"r.png\" class=\"left\">\n");
        mkdirSync(join(site, "shots"), { recursive: true });
        writeFileSync(join(site, "shots", "_index.json"), JSON.stringify({ title: "Shots", content: [
            { type: "ContentImage", src: "a.png", alt: "A \"quoted\"", size: "column", align: "middle", zoomable: true, width: 480 },
            { type: "ContentImage", src: "b.png", alt: "B", size: "huge", align: "float-right" },
            { type: "ContentImage", alt: "No source" },
        ] }));
        writeFileSync(join(site, "shots", "index.html"), "");
        build(site);
        const md = readFileSync(join(site, "kept", "index.html"), "utf-8");
        assert.match(md, /<p class="colvmn-image"><img src="w\.png" alt="Wide" class="colvmn-image-left colvmn-image-column mine"><\/p>/);   // options prefixed, a page's own class kept
        assert.match(md, /<p>See <img src="i\.png" alt="icon"> here\.<\/p>/);   // beside text: inline, not centered
        assert.match(md, /<img src="r\.png" class="left">/);   // raw HTML: the page's own class, untouched
        const html = readFileSync(join(site, "shots", "index.html"), "utf-8");
        assert.match(html, /<div class="colvmn-image"><img src="a\.png" alt="A &quot;quoted&quot;" class="colvmn-image-column colvmn-zoomable-image" width="480"><\/div>/);
        assert.match(html, /<div class="colvmn-image"><img src="b\.png" alt="B" class="colvmn-image-float-right"><\/div>/);   // an unknown size or align is left out
        assert.doesNotMatch(html.split("colvmn-prefetch")[0], /No source/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("slideshow options: .autoplay and .no-controls on any image go on the slideshow, not the images", () => {
    const site = makeSite({});
    try {
        writePage(site, "kept", "# Kept Page\n\nKept text.\n\n![One](a.jpg){.slideshow .autoplay}\n![Two](b.jpg){.slideshow .no-controls}\n");
        build(site);
        const html = readFileSync(join(site, "kept", "index.html"), "utf-8");
        assert.match(html, /<div class="colvmn-slideshow autoplay no-controls" role="region"/);
        assert.match(html, /<img src="a\.jpg" alt="One" class="colvmn-zoomable-image">/);
        assert.match(html, /<img loading="lazy" src="b\.jpg" alt="Two" class="colvmn-zoomable-image">/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("a markdown page's frontmatter stays out of llms-full.txt, but its title and subtitle are kept", () => {
    const site = makeSite({});
    try {
        writePage(site, "headed", "---\nmaxColumns: 1\n---\n# Headed Page\n\nHeaded text.\n");
        writePage(site, "titled", "---\ntitle: Titled Page\nsubtitle: A short summary.\n---\n\n## Part\n\nTitled text.\n");
        const { llmsFull } = build(site);
        assert.doesNotMatch(llmsFull, /maxColumns|^title:|^subtitle:/m);
        assert.match(llmsFull, /Source: headed\/\n\n# Headed Page\n\nHeaded text\./);
        assert.match(llmsFull, /Source: titled\/\n\n# Titled Page\n\nA short summary\.\n\n## Part\n\nTitled text\./);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("ContentSlideshow builds the same slideshow in a JSON page, with its options, and lists its images in llms-full.txt", () => {
    const site = makeSite({});
    try {
        writeFileSync(join(site, "kept", "_index.json"), JSON.stringify({ title: "Kept Page", content: [{ type: "ContentSlideshow", autoplay: true, controls: false, inset: true, images: [{ src: "a.jpg", alt: "One" }, { src: "b.jpg", alt: "Two" }] }] }));
        rmSync(join(site, "kept", "_index.md"));
        const { llmsFull } = build(site);
        const html = readFileSync(join(site, "kept", "index.html"), "utf-8");
        assert.match(html, /<div class="colvmn-slideshow autoplay no-controls inset" role="region"[\s\S]*<img src="a\.jpg" alt="One" class="colvmn-zoomable-image">[\s\S]*<img loading="lazy" src="b\.jpg" alt="Two" class="colvmn-zoomable-image">/);
        assert.match(llmsFull, /!\[One\]\(kept\/a\.jpg\)\n\n!\[Two\]\(kept\/b\.jpg\)/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("columns by default: each titled top-level section (text, list, key/value) is a .col-group; maxColumns caps them, 1 turns them off", () => {
    const site = makeSite({ maxColumns: 3 });
    try {
        writePage(site, "kept", "# Kept Page\n\nAn intro line.\n\n## One\n\nFirst.\n\n## Two\n\nSecond.\n");
        writePage(site, "tabled", "# Tabled\n\nIntro.\n\n## Grid\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n\n## One\n\nFirst.\n\n## Two\n\nSecond.\n");
        writePage(site, "guide", "---\nmaxColumns: 1\n---\n# Guide\n\nGuide text.\n\n## One\n\nFirst.\n\n## Two\n\nSecond.\n");
        writeFileSync(join(site, "private", "_index.json"), JSON.stringify({ title: "Private Page", llms: false, maxColumns: 2, content: [{ type: "ContentKeyValue", title: "Facts", items: { A: "1" } }, { type: "ContentText", title: "Notes", body: "<p>x</p>" }] }));
        rmSync(join(site, "private", "_index.md"));
        build(site);
        const kept = readFileSync(join(site, "kept", "index.html"), "utf-8");
        assert.match(kept, /<div class="col-group"><div class="col-keep"><h2 id="one">One<\/h2><div class="section"><div class="section-body"><p>First\.<\/p><\/div><\/div><\/div><\/div><div class="col-group"><div class="col-keep"><h2 id="two">Two<\/h2>/);   // a heading is kept with its first subsection
        assert.match(kept, /<div class="page loaded has-cols max-cols-3">/);          // two sections, and the site's cap
        const tabled = readFileSync(join(site, "tabled", "index.html"), "utf-8");
        assert.doesNotMatch(tabled, /<div class="col-group"><div class="col-keep"><h2 id="grid">/);   // a section holding a table spans the page
        assert.match(tabled, /<div class="col-group"><div class="col-keep"><h2 id="one">/);           // the others still flow into columns
        const guide = readFileSync(join(site, "guide", "index.html"), "utf-8");
        assert.doesNotMatch(guide, /col-group|max-cols/);                           // maxColumns: 1
        const priv = readFileSync(join(site, "private", "index.html"), "utf-8");
        assert.match(priv, /<div class="page loaded has-cols max-cols-2">/);          // the page's own cap wins
        assert.match(priv, /<div class="col-group"><div class="col-keep"><h2>Facts<\/h2><div class="section">/);                // key/value blocks are sections too
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("planColumns splits units, in order, into non-empty columns with the tallest as short as it can be", async () => {
    const { planColumns } = await import("../layout/Columns.js");
    const u = (height, keep = false, last = false) => ({ height, keep, last });
    // Three sections, the last long with three subsections: one column each, the long one continuing in a third.
    const units = [u(400, true, true), u(300, true, true), u(250, true), u(500), u(400, false, true)];
    assert.deepEqual(planColumns(units, 3, 60), [2, 4]);
    // Two columns: starting the long section fresh in the second column (1150 tall) is within 15% of
    // continuing it (1120), so the section isn't split.
    const two = [u(500, true, true), u(250, true, true), u(250, true), u(500), u(400, false, true)];
    assert.deepEqual(planColumns(two, 2, 60), [2]);
    // Starting it fresh (1660) is far taller than continuing its last subsection (1260): continue it.
    const tall = [u(200, true, true), u(200, true), u(800), u(800, false, true)];
    assert.deepEqual(planColumns(tall, 2, 60), [3]);
    assert.deepEqual(planColumns([u(100, true, true), u(100, true, true)], 4), [1]);   // never more columns than units
    assert.deepEqual(planColumns([u(100, true, true), u(100, true, true)], 1), []);
});

test("columns count a section's parts: one section with three subsections can fill three columns", () => {
    const site = makeSite({});
    try {
        writeFileSync(join(site, "kept", "_index.json"), JSON.stringify({ title: "Kept Page", content: [{ type: "ContentText", title: "Product", body: "<p>Intro.</p>", content: [
            { type: "ContentText", title: "Features", body: "<p>a</p>" }, { type: "ContentText", title: "Stack", body: "<p>b</p>" }] }] }));
        rmSync(join(site, "kept", "_index.md"));
        build(site);
        const html = readFileSync(join(site, "kept", "index.html"), "utf-8");
        assert.match(html, /<div class="page loaded has-cols has-cols-3">/);
        assert.match(html, /<div class="col-group"><div class="col-keep"><h2 id="product">Product<\/h2><div class="section"><div class="section-body"><p>Intro\.<\/p><\/div><\/div><\/div><div class="section"><div class="section-head">Features/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});


test("a table header cell's {.nowrap} applies to its whole column", () => {
    const site = makeSite({});
    writePage(site, "kept", "# Kept Page\n\n| Who | Number {.nowrap} | Notes {.nowrap .wide} |\n| --- | --- | --- |\n| Poison | 1-800-222-1222 | Any time |\n");
    const { llmsFull } = build(site);
    const html = readFileSync(join(site, "kept", "index.html"), "utf-8").split('id="colvmn-prefetch"')[0];
    assert.match(html, /<th>Who<\/th><th class="colvmn-table-nowrap">Number<\/th><th class="colvmn-table-nowrap wide">Notes<\/th>/);
    assert.match(html, /<td>Poison<\/td><td class="colvmn-table-nowrap"><a class="colvmn-tel" href="tel:\+18002221222">1-800-222-1222<\/a><\/td><td class="colvmn-table-nowrap wide">Any time<\/td>/);
    assert.doesNotMatch(html, /\{\.nowrap/);
    assert.match(llmsFull, /\| Who \| Number \| Notes \|/);
    rmSync(site, { recursive: true, force: true });
});

test("folderCards and fileCards list a folder's subpages and files as cards; cardsFirst puts them before the titled sections", () => {
    const site = makeSite({});
    try {
        writePage(site, "jobs", "---\ntitle: Jobs\nsubtitle: All jobs.\nfolderCards: newest-first\ncardsFirst: true\n---\n\nHow to add a job.\n\n## Notes\n\nNote text.\n");
        writePage(site, "jobs/2020-01 paint", "---\ntitle: Paint\nsubtitle: Jan 2020.\nfileCards: true\n---\n");
        writePage(site, "jobs/2021-05 roof", "---\ntitle: Roof\n---\n");
        mkdirSync(join(site, "jobs/not a page"));
        writeFileSync(join(site, "jobs/2020-01 paint/Invoice #1.pdf"), "x".repeat(2048));
        writeFileSync(join(site, "jobs/2020-01 paint/photo.jpg"), "jpg");
        writeFileSync(join(site, "jobs/2020-01 paint/_notes.txt"), "hidden");
        build(site);
        const jobs = readFileSync(join(site, "jobs", "index.html"), "utf-8");
        // the frontmatter subtitle wins, and the short first paragraph stays in the body
        assert.match(jobs, /<p>How to add a job\.<\/p>/);
        // newest first, only folders that are pages, before the Notes section
        assert.match(jobs, /<h3>Roof<\/h3>[\s\S]*<h3>Paint<\/h3><p>Jan 2020\.<\/p>[\s\S]*<h2 id="notes">/);
        assert.doesNotMatch(jobs, /not a page/);
        const paint = readFileSync(join(site, "jobs/2020-01 paint", "index.html"), "utf-8");
        assert.match(paint, /<a class="card file-card" href="Invoice%20%231\.pdf"><h3>Invoice #1<\/h3><p>PDF · 2 KB<\/p>/);
        assert.match(paint, /<a class="card file-card[^"]*" href="photo\.jpg"><img class="file-card-thumb" src="photo\.jpg"/);
        assert.doesNotMatch(paint, /_notes|index\.html"><h3>/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("file cards for OBJ, DWG and DXF files open the engine's viewer pages, with the file's path relative to the viewer", () => {
    const site = makeSite({});
    try {
        writePage(site, "cad/house plans", "---\ntitle: Plans\nfileCards: true\n---\n");
        writeFileSync(join(site, "cad/house plans/Floor 1.dwg"), "dwg");
        writeFileSync(join(site, "cad/house plans/house.obj"), "obj");
        build(site);
        const pageDir = join(site, "cad/house plans");
        const html = readFileSync(join(pageDir, "index.html"), "utf-8");
        const hrefs = [...html.matchAll(/<a class="card file-card" href="([^"]+)">/g)].map(m => m[1]);
        const resolved = hrefs.map(h => {
            const [page, query] = h.split("?");
            const viewerPage = resolve(pageDir, decodeURIComponent(page));
            return [basename(viewerPage), resolve(dirname(viewerPage), new URLSearchParams(query).get("src"))];
        });
        assert.deepEqual(resolved, [
            ["drawing.html", join(pageDir, "Floor 1.dwg")],
            ["model.html", join(pageDir, "house.obj")],
        ]);
        assert.ok(existsSync(join(dirname(staticGen), "viewers", "drawing.html")));
        assert.match(html, /<h3>Floor 1<\/h3><p>AutoCAD drawing · 3 bytes<\/p><span class="arrow">View in browser &rarr;/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

// One sample of every content block type, each with marker text that must
// reach both the page and llms-full.txt (AI reviewers read only that file).
const BLOCK_SAMPLES = {
    ContentText: { type: "ContentText", title: "Text Mk1", body: "<p>Text Mk2</p>", content: [{ type: "ContentUnorderedList", items: ["Text Mk3"] }] },
    ContentCards: { type: "ContentCards", title: "Cards Mk1", items: ["child", { title: "Cards Mk2", subtitle: "Cards Mk3", href: "https://example.com/" }] },
    ContentKeyValue: { type: "ContentKeyValue", title: "KV Mk1", items: { "KV Mk2": "KV Mk3" }, content: [{ type: "ContentText", body: "<p>KV Mk4</p>" }] },
    ContentUnorderedList: { type: "ContentUnorderedList", title: "UL Mk1", items: ["UL Mk2", { text: "UL Mk3", content: [{ type: "ContentUnorderedList", items: ["UL Mk4"] }] }] },
    ContentOrderedList: { type: "ContentOrderedList", title: "OL Mk1", items: ["OL Mk2"] },
    ContentTable: { type: "ContentTable", title: "Tbl Mk1", subtitle: "Tbl Mk2", columns: ["Tbl Mk3"], rows: [["Tbl Mk4"]], note: "Tbl Mk5", content: [{ type: "ContentText", body: "<p>Tbl Mk6</p>" }] },
    ContentImage: { type: "ContentImage", title: "Img Mk1", src: "img-mk2.png", alt: "Img Mk3" },
    ContentTimeline: { type: "ContentTimeline", title: "TL Mk1", items: [{ date: "2020", title: "TL Mk2", subtitle: "TL Mk3" }] },
    ContentToc: { type: "ContentToc", items: ["Text Mk1"] },
    ContentFAQ: { type: "ContentFAQ", title: "FAQ Mk1", items: [{ q: "FAQ Mk2", a: "<p>FAQ Mk3</p>" }] },
    ContentClassDoc: { type: "ContentClassDoc", sections: [
        { name: "CD Mk1", categories: [{ name: "CD Mk2", members: [{ name: "cdMk3", signature: "(cdMk4)", description: "CD Mk5" }] }] },
        { name: "CD Mk6", categories: [{ members: [{ name: "cdMk7" }] }] },
    ] },
    ContentComparisonTable: { type: "ContentComparisonTable", title: "Cmp Mk1", items: ["acme-mk2"], itemsLabel: "Tools",
        infoRows: [{ label: "Cmp Mk3", field: "tagline" }],
        featureRows: [{ key: "f", label: "Cmp Mk4" }, { key: "u", label: "Cmp Mk5" }] },
    ContentSlideshow: { type: "ContentSlideshow", title: "Show Mk1", images: [{ src: "show-mk2.png", alt: "Show Mk3" }] },
    ContentFolderCards: { type: "ContentFolderCards", title: "Folders Mk1" },
    ContentFileCards: { type: "ContentFileCards", title: "Files Mk1" },
};
// Text that comes from elsewhere: the child page, the comparison's _info.json, the folder's file.
const SAMPLE_SOURCE_MARKERS = ["Child Mk1", "Child Mk2", "Cmp Mk6", "Cmp Mk7", "Cmp Mk8", "files-mk1"];

test("every content block's text reaches both the page and llms-full.txt", () => {
    const registered = readFileSync(staticGen, "utf-8").match(/ContentBase\.typeMap = \{([\s\S]*?)\};/)[1].match(/\w+/g);
    assert.deepEqual(Object.keys(BLOCK_SAMPLES).sort(), [...registered].sort(), "a sample for every registered block type");

    const site = makeSite({});
    try {
        const dir = join(site, "blocks");
        mkdirSync(join(dir, "acme-mk2"), { recursive: true });
        writeFileSync(join(dir, "_index.json"), JSON.stringify({ title: "Blocks", content: Object.values(BLOCK_SAMPLES) }));
        writeFileSync(join(dir, "index.html"), "");
        writePage(site, "blocks/child", "---\nsubtitle: Child Mk2\n---\n# Child Mk1\n");
        writeFileSync(join(dir, "acme-mk2", "_info.json"), JSON.stringify({ tagline: "Cmp Mk6", features: {
            f: { value: "partial", summary: "Cmp Mk7", notes: "Cmp Mk8" }, u: { value: true },
        } }));
        writeFileSync(join(dir, "files-mk1.pdf"), "pdf");
        const { llmsFull } = build(site);
        const html = readFileSync(join(dir, "index.html"), "utf-8").split('id="colvmn-prefetch"')[0];
        const markers = [...JSON.stringify(BLOCK_SAMPLES).matchAll(/[A-Za-z]+ ?Mk\d|[a-z]+-mk\d/gi)].map(m => m[0]);
        for (const marker of [...new Set(markers), ...SAMPLE_SOURCE_MARKERS]) {
            assert.ok(html.includes(marker), `page shows ${marker}`);
            assert.ok(llmsFull.includes(marker), `llms-full.txt has ${marker}`);
        }
        // the universal feature is a note, not a column, in both
        assert.match(llmsFull, /All tools also support Cmp Mk5\./);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("a markdown page's folder and file listings reach llms-full.txt; the colvmn engine folder is never a folder card", () => {
    const site = makeSite({});
    try {
        writePage(site, "jobs", "---\ntitle: Jobs\nfolderCards: true\nfileCards: true\nfileCardsTitle: Documents\n---\nJob notes.\n");
        writePage(site, "jobs/roof", "---\nsubtitle: New roof, 2021.\n---\n# Roof\n");
        writeFileSync(join(site, "jobs", "Contract.pdf"), "pdf");
        writeFileSync(join(site, "_index.md"), "---\ntopTitle: Example\nfolderCards: true\n---\n# Example\n\nThe root page.\n");
        mkdirSync(join(site, "colvmn"));
        writeFileSync(join(site, "colvmn", "_index.json"), JSON.stringify({ title: "Engine Docs" }));
        writeFileSync(join(site, "colvmn", "index.html"), "");
        const { llmsFull, rootHtml } = build(site);
        const jobs = llmsFull.split("<!-- Page: jobs -->")[1].split("<!-- Page:")[0];
        assert.match(jobs, /- \[Roof\]\(jobs\/roof\/index\.html\) — New roof, 2021\./);
        assert.match(jobs, /## Documents\n\n- \[Contract\]\(jobs\/Contract\.pdf\) — PDF · 3 bytes/);
        assert.match(rootHtml, /<h3>Kept Page<\/h3>/);
        assert.doesNotMatch(rootHtml + llmsFull, /Engine Docs/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("a folder table's columns, from its pages' frontmatter, reach llms-full.txt in the table's sorted order", () => {
    const site = makeSite({});
    try {
        writePage(site, "projects", "---\ntitle: Projects\nfolderCards: true\nfolderLayout: table\nfolderColumns: Project=title, Owner=owner, Status=status\nfolderSort: Owner\n---\nAll projects.\n");
        writePage(site, "projects/deck", "---\ntitle: Deck\nowner: Zoe\nstatus: Done\n---\n");
        writePage(site, "projects/roof", "---\ntitle: Roof\nowner: Ann\nstatus: Planned\n---\n");
        const { llmsFull } = build(site);
        assert.match(llmsFull, /\| Project \| Owner \| Status \|\n\| --- \| --- \| --- \|\n\| \[Roof\]\(projects\/roof\/index\.html\) \| Ann \| Planned \|\n\| \[Deck\]\(projects\/deck\/index\.html\) \| Zoe \| Done \|/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("each page links its own site's llms.txt page-relatively, so a site served under a subfolder finds its own", () => {
    const site = makeSite({});
    try {
        writeFileSync(join(site, "kept", "index.html"), '<!DOCTYPE html>\n<html>\n<head>\n  <link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt">\n</head>\n<body>\n  <div class="page"></div>\n  <script src="/colvmn/layout/bundle.js" defer></script>\n</body>\n</html>\n');
        const { rootHtml } = build(site);
        build(site);
        const kept = readFileSync(join(site, "kept", "index.html"), "utf-8");
        const nested = readFileSync(join(site, "private", "child", "index.html"), "utf-8");
        const links = html => [...html.matchAll(/<link rel="alternate"[^>]*href="([^"]+)"/g)].map(m => m[1]);
        assert.deepEqual(links(rootHtml), ["./llms.txt"]);
        assert.deepEqual(links(kept), ["../llms.txt"], "an older /llms.txt tag is replaced, and rebuilding adds no second");
        assert.deepEqual(links(nested), ["../../llms.txt"]);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("a folder listing on an opted-in page may show its AI Reviews folder, but no card for it, or for any page left out, reaches the llms files", () => {
    const site = makeSite({ aiReviews: { folder: "AI Reviews" } });
    try {
        writePage(site, "docs", "---\ntitle: Docs\naiReviews: true\nfolderCards: true\n---\nDocs text.\n");
        writePage(site, "docs/guide", "# Guide\n\nGuide text.\n");
        writePage(site, "docs/hidden", "---\nllms: false\n---\n# Hidden Page\n");
        writePage(site, "docs/AI Reviews", "---\ntitle: Reviews Page\nsubtitle: Reviews subtitle.\n---\n");
        writePage(site, "docs/AI Reviews/Claude", "---\ntitle: Claude\nsubtitle: The verdict.\n---\nThe review.\n");
        const { llms, llmsFull } = build(site);
        const docsFull = readFileSync(join(site, "docs", "llms-full.txt"), "utf-8");
        for (const text of [llms, llmsFull, docsFull]) {
            assert.match(text, /\[Guide\]/);
            assert.doesNotMatch(text, /Reviews Page|Reviews subtitle|verdict|The review|Hidden Page/);
        }
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("paths in the llms files are relative to the site root, so a site served under a subfolder works; code examples and URLs are left alone", () => {
    const site = makeSite({});
    try {
        writePage(site, "guide/setup", "# Setup\n\nSee [Kept](../../kept/index.html), [part](#part), [img](shot.png \"Shot\"), [ext](https://example.com/a), [abs](/x/).\n\nExample: `[a](b.html)`\n\n```\n[c](d.html)\n```\n");
        const { llms, llmsFull } = build(site);
        assert.match(llms, /- \[Setup\]\(guide\/setup\/\)/);
        assert.doesNotMatch(llms + llmsFull, /\]\(\/(?!x\/)|Source: \/|See also: \//);
        assert.match(llmsFull, /See also: llms\.txt \(curated index\) and sitemap\.xml\.\n\nPaths are relative to the site root\./);
        assert.match(llmsFull, /Source: \.\/\n/);
        assert.match(llmsFull, /Source: guide\/setup\/\n/);
        assert.match(llmsFull, /See \[Kept\]\(kept\/index\.html\), \[part\]\(guide\/setup\/#part\), \[img\]\(guide\/setup\/shot\.png "Shot"\), \[ext\]\(https:\/\/example\.com\/a\), \[abs\]\(\/x\/\)\./);
        assert.match(llmsFull, /Example: `\[a\]\(b\.html\)`\n\n```\n\[c\]\(d\.html\)\n```/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("frontmatter that isn't one-line key: value settings stops the build, naming the file and line", () => {
    const site = makeSite({});
    try {
        writePage(site, "kept", "---\ntitle: Kept\ncontent:\n  - type: ContentText\n    body: Lost text\n---\n# Kept Page\n");
        let stderr = "";
        try {
            execFileSync("node", [staticGen, site], { stdio: "pipe", encoding: "utf-8", cwd: site });
            assert.fail("the build should fail");
        } catch (e) {
            stderr = String(e.stderr || "");
        }
        assert.match(stderr, /kept\/_index\.md: frontmatter line 4 \("- type: ContentText"\) is not a one-line "key: value" setting/);
        assert.match(stderr, /_index\.json/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("a markdown page's # line inside fenced code is an example, not its title, in llms-full.txt", () => {
    const site = makeSite({});
    try {
        writePage(site, "kept", "---\ntitle: Real Title\n---\n\nIntro.\n\n```markdown\n# Example Title\n```\n");
        const { llmsFull } = build(site);
        assert.match(llmsFull, /Source: kept\/\n\n# Real Title\n\nIntro\.\n\n```markdown\n# Example Title\n```/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

// bundle.js joins the layout files into one scope: if two declare the same
// top-level name, the browser rejects the whole bundle and no runtime
// behavior (columns, lightbox, collapsibles, slideshows) runs on any page.
test("layout/bundle.js parses as a classic script", async () => {
    const vm = await import("node:vm");
    const bundle = readFileSync(join(dirname(staticGen), "layout", "bundle.js"), "utf-8");
    assert.doesNotThrow(() => new vm.Script(bundle, { filename: "layout/bundle.js" }));
});

test("phone numbers in table cells link to the phone app; dates, permit numbers and existing links don't", () => {
    const tel = (n, href) => `<a class="colvmn-tel" href="tel:${href}">${n}</a>`;
    assert.equal(linkPhoneNumbers("(415) 435-3266"), tel("(415) 435-3266", "+14154353266"));
    assert.equal(linkPhoneNumbers("Ring support 1-800-656-1918"), "Ring support " + tel("1-800-656-1918", "+18006561918"));
    assert.equal(linkPhoneNumbers("415.945.1400; office 415-435-1501"), tel("415.945.1400", "+14159451400") + "; office " + tel("415-435-1501", "+14154351501"));
    assert.equal(linkPhoneNumbers(" 911 "), " " + tel("911", "911") + " ");
    for (const s of ["2017 11 21", "Permit 2011-050", "060-201-03", "Tiburon, CA 94920-2549", "license 0H08075", "Call 911 first", "<a href=\"x\">(415) 435-3266</a>", "<img alt=\"415-435-3266\">"]) {
        assert.equal(linkPhoneNumbers(s), s, s);
    }
    const site = makeSite({});
    try {
        writePage(site, "contacts", "# Contacts\n\n| Who | Phone |\n| --- | --- |\n| Police | (415) 435-3266 |\n| Emergency | 911 |\n");
        build(site);
        const html = readFileSync(join(site, "contacts", "index.html"), "utf-8");
        assert.match(html, /<td><a class="colvmn-tel" href="tel:\+14154353266">\(415\) 435-3266<\/a><\/td>/);
        assert.match(html, /<td><a class="colvmn-tel" href="tel:911">911<\/a><\/td>/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("a {listing: folder} line embeds that subfolder's listing, set up by its own page, after its section", () => {
    const site = makeSite({});
    try {
        writePage(site, "jobs", "---\ntitle: Jobs\nfolderCards: true\nfolderExclude: offers\n---\n\n## Offers\n\nNot taken.\n\n{listing: offers}\n\n## Notes\n\nMore.\n");
        writePage(site, "jobs/2020 roof", "---\ntitle: Roof\ndate: 2020\n---\n");
        writePage(site, "jobs/offers", "---\ntitle: Offers\nfolderCards: true\nfolderLayout: table\nfolderColumns: Date=date, Offer=title, Cost=cost\nfolderSort: Date desc\n---\n");
        writePage(site, "jobs/offers/a", "---\ntitle: Deck\ndate: 2023 12 03\ncost: $9\n---\n");
        writePage(site, "jobs/offers/b", "---\ntitle: Fence\ndate: 2023 12 05\ncost: $5\n---\n");
        writePage(site, "jobs/offers/../../outside", "---\ntitle: Outside\n---\n");
        build(site);
        const html = readFileSync(join(site, "jobs", "index.html"), "utf-8");
        // The section's text, then the offers table (newest first, linking into the subfolder), then the next section.
        assert.match(html, /Not taken\.[\s\S]*<th>Date<\/th><th>Offer<\/th><th>Cost<\/th>[\s\S]*2023 12 05[\s\S]*href="offers\/b\/index\.html[^"]*">Fence<\/a>[\s\S]*\$5[\s\S]*2023 12 03[\s\S]*Deck[\s\S]*More\./);
        // The page's own listing leaves the embedded folder out.
        assert.match(html, />Roof</);
        assert.doesNotMatch(html, /href="offers\/index\.html/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("{listing: .} places the page's own listing there", () => {
    const site = makeSite({});
    try {
        writePage(site, "jobs", "---\ntitle: Jobs\nfolderCards: true\nfolderCardsTitle: Work\ncardsFirst: true\n---\n\n## Offers\n\nNot taken.\n\n{listing: .}\n\n## Notes\n\nMore.\n");
        writePage(site, "jobs/roof", "---\ntitle: Roof\n---\n");
        build(site);
        const html = readFileSync(join(site, "jobs", "index.html"), "utf-8");
        assert.match(html, /id="offers"[\s\S]*Not taken\.[\s\S]*<h2[^>]*>Work<\/h2>[\s\S]*>Roof<[\s\S]*id="notes"/);
        assert.doesNotMatch(html.split('id="colvmn-prefetch"')[0], /\{listing/);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});
