// Tests for AI Reviews production: picking the top model, reading answers,
// the built-in jobs, and models.js / reviews.js against a local stand-in for
// the Claude API (no real provider is called).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAnswer, safeMarkdown, inputHash, normalizeHeadings } from "../update/ai/ReviewPages.js";
import { parseChoice, validChoices } from "../update/ai/ModelChooser.js";
import { UpdateJobs } from "../update/UpdateJobs.js";

const AI = join(dirname(fileURLToPath(import.meta.url)), "..", "update", "ai");

test("an answer gives its quoted stamp, verdict and review; HTML is escaped outside code", () => {
    const a = parseAnswer("**Build stamp:** `Site build: X · 2026-11-12 · abc`\nVerdict: \"Solid, small community.\"\n\n# Review\n\nIt's fine <script>alert(1)</script> and `a<b`.\n");
    assert.equal(a.stamp, "Site build: X · 2026-11-12 · abc");
    assert.equal(a.verdict, "Solid, small community.");
    assert.match(a.body, /^## Review/);                  // the page's title is the only h1
    assert.match(a.body, /&lt;script>/);
    assert.match(a.body, /`a<b`/);
    assert.equal(parseAnswer("Build stamp: none\nVerdict: ok\nText").stamp, "");
    assert.equal(safeMarkdown("```\n<b>\n```"), "```\n<b>\n```");
    assert.equal(normalizeHeadings("# STRVCT review\n\nIntro.\n\n### What it is\n\nText.\n\n#### Detail\n\n### Strengths"), "Intro.\n\n## What it is\n\nText.\n\n### Detail\n\n## Strengths");
    assert.equal(normalizeHeadings("## A\n\nx\n\n## B"), "## A\n\nx\n\n## B", "already sectioned: unchanged");
    assert.equal(normalizeHeadings("```\n# not a heading\n```\n### A\n### B"), "```\n# not a heading\n```\n## A\n## B");
    assert.notEqual(inputHash("a\nSite build: 1\n", "m", "p"), inputHash("a\nSite build: 1\n", "m2", "p"));
    assert.equal(inputHash("a\nSite build: 1\n", "m", "p"), inputHash("a\nSite build: 2\n", "m", "p"));   // the stamp line doesn't count
});

function makeSite (aiReviews) {
    const site = mkdtempSync(join(tmpdir(), "colvmn-ai-"));
    writeFileSync(join(site, "colvmn.json"), JSON.stringify({ siteUrl: "https://example.com/", aiReviews }));
    writeFileSync(join(site, "_index.md"), "---\ntopTitle: Example\n---\n# Example\n\nRoot.\n");
    writeFileSync(join(site, "llms-full.txt"), "# Example\n\nSite build: Example · 2026-11-12 · abc1234\n\nThe docs.\n");
    return site;
}

test("Claude's model choice: the JSON at the end of its answer, and only IDs from the provider's own list", () => {
    const choice = parseChoice('Searched.\n```json\n{"Gemini": {"id": "gemini-4-carbon", "name": "Gemini 4 Carbon", "source": "https://blog.google/x", "why": "Newest frontier."}, "Grok": {"id": "grok-9"}}\n```');
    const lists = { Gemini: { ids: ["gemini-4-argon", "gemini-4-carbon"] }, Grok: { ids: ["grok-4.7"] } };
    const { chosen, rejected } = validChoices(choice, lists);
    assert.deepEqual(chosen, { Gemini: { id: "gemini-4-carbon", name: "Gemini 4 Carbon", source: "https://blog.google/x", why: "Newest frontier." } });
    assert.deepEqual(rejected, ["Grok: grok-9 isn't in its model list"]);
});

test("aiReviews adds one reviews job (monthly, direct), with the keys that have values", () => {
    const site = makeSite({ folder: "AI Reviews", about: "Review Process" });
    try {
        let jobs = UpdateJobs.inSite(site, {});
        assert.deepEqual(jobs.all().map(j => j.folderName()), ["AI Reviews"]);
        assert.match(jobs.all()[0].problems().join(), /no AI provider key has a value/);

        const [reviews] = UpdateJobs.inSite(site, { ANTHROPIC_API_KEY: "sk-test-123456" }).all();
        assert.deepEqual(reviews.problems(), []);
        assert.deepEqual(reviews.updateFile.secrets(), ["ANTHROPIC_API_KEY"]);
        assert.equal(reviews.updateFile.publish(), "direct");
        assert.equal(reviews.updateFile.schedule(), "monthly");
        assert.deepEqual(reviews.updateFile.watch(), []);
        assert.ok(reviews.updateFile.writes().includes("AI Reviews/Claude/**"));
        assert.ok(reviews.updateFile.writes().includes("AI Reviews/_models/**"));
        assert.ok(existsSync(reviews.updateFile.scriptPath()));
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

/** A stand-in for the Claude API: model lists, the model choice (a request with tools, paused once), and reviews. */
async function fakeClaude (answer, chosenId = "claude-fable-5-2") {
    const calls = { reviews: 0, choices: 0, lastBody: null };
    const server = createServer((req, res) => {
        let body = "";
        req.on("data", c => { body += c; });
        req.on("end", () => {
            res.setHeader("content-type", "application/json");
            if (req.headers["x-api-key"] !== "sk-test-123456") {
                res.statusCode = 401;
                return res.end(JSON.stringify({ error: { message: "bad key" } }));
            }
            if (req.method === "GET" && req.url.startsWith("/v1/models")) {
                return res.end(JSON.stringify({ data: [{ id: "claude-fable-5-2", display_name: "Claude Fable 5.2", created_at: "2026-10-20" }, { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-10-01" }], has_more: false }));
            }
            const request = JSON.parse(body);
            if (request.tools) {
                calls.choices++;
                if (request.messages.length === 1) {
                    return res.end(JSON.stringify({ stop_reason: "pause_turn", content: [{ type: "text", text: "Searching." }] }));
                }
                const json = JSON.stringify({ Claude: { id: chosenId, name: "Claude Fable 5.2", source: "https://www.anthropic.com/news/x", why: "Newest frontier." } });
                return res.end(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "```json\n" + json + "\n```" }] }));
            }
            calls.reviews++;
            calls.lastBody = request;
            res.end(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: answer }], usage: { input_tokens: 100, output_tokens: 50 } }));
        });
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    return { calls, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

function runReviews (site, base, args = [], key = "sk-test-123456") {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [join(AI, "reviews.js"), ...args], {
            env: { PATH: process.env.PATH, COLVMN_SITE_ROOT: site, ANTHROPIC_API_KEY: key, COLVMN_AI_BASE_CLAUDE: base },
            stdio: ["ignore", "pipe", "pipe"]
        });
        let out = "";
        child.stdout.on("data", c => { out += c; });
        child.stderr.on("data", c => { out += c; });
        child.on("close", status => resolve({ status, out }));
    });
}

test("reviews.js: Claude chooses the model, --models stops there; then the review is written, skipped when nothing changed, archived when the docs change", async () => {
    const site = makeSite({ folder: "AI Reviews", about: "Review Process", providers: ["Claude", "Gemini"] });
    const api = await fakeClaude("Build stamp: Site build: Example · 2026-11-12 · abc1234\nVerdict: Clear docs, small ecosystem.\n\n## Strengths\n\nGood.\n");
    try {
        let r = await runReviews(site, api.url, ["--models"]);
        assert.equal(r.status, 0, r.out);
        assert.equal(api.calls.choices, 2, "one pause, then the answer");
        assert.equal(api.calls.reviews, 0, "--models pays for no review");
        const models = JSON.parse(readFileSync(join(site, "AI Reviews", "_models", "models.json"), "utf8"));
        assert.equal(models.Claude.id, "claude-fable-5-2");
        assert.equal(models.Claude.source, "https://www.anthropic.com/news/x");

        r = await runReviews(site, api.url);
        assert.equal(r.status, 0, r.out);
        assert.equal(api.calls.reviews, 1);
        assert.equal(api.calls.lastBody.model, "claude-fable-5-2");
        assert.match(api.calls.lastBody.messages[0].content, /Start your answer with these two lines[\s\S]*<llms-full\.txt>[\s\S]*The docs\./);
        const review = readFileSync(join(site, "AI Reviews", "Claude", "_index.md"), "utf8");
        assert.match(review, /^---\nmodelName: Claude Fable 5\.2\nmodel: claude-fable-5-2\nreviewed: \d{4}-\d{2}-\d{2}\nsummary: Clear docs, small ecosystem\.\nstamp: Site build: Example · 2026-11-12 · abc1234\ninputHash: [0-9a-f]{16}\n---\n# Claude\n\n## Strengths\n\nGood\.\n$/);
        assert.ok(existsSync(join(site, "AI Reviews", "Claude", "index.html")));
        assert.match(readFileSync(join(site, "AI Reviews", "_index.md"), "utf8"), /on \{date\}/);
        assert.match(readFileSync(join(site, "AI Reviews", "Review Process", "_index.md"), "utf8"), /Once a month, each provider's top model is checked/);

        r = await runReviews(site, api.url);
        assert.equal(r.status, 3, r.out);
        assert.equal(api.calls.reviews, 1, "same docs and model: no new review");

        writeFileSync(join(site, "llms-full.txt"), "# Example\n\nSite build: Example · 2026-11-13 · def5678\n\nThe docs, revised.\n");
        r = await runReviews(site, api.url, ["--only", "Claude"]);
        assert.equal(r.status, 0, r.out);
        assert.equal(api.calls.reviews, 2);
        const [dated] = readdirSync(join(site, "AI Reviews", "Claude", "archive"));
        assert.match(dated, /^\d{4}-\d{2}-\d{2}$/);
    } finally {
        api.close();
        rmSync(site, { recursive: true, force: true });
    }
});

test("an ID Claude names that isn't in the provider's list is refused, and that provider is skipped, not guessed", async () => {
    const site = makeSite({ folder: "AI Reviews", providers: ["Claude"] });
    const api = await fakeClaude("unused", "claude-made-up-9");
    try {
        const r = await runReviews(site, api.url);
        assert.equal(r.status, 3, r.out);
        assert.match(r.out, /no model chosen this run: Claude: claude-made-up-9 isn't in its model list[\s\S]*Claude: skipped \(no model chosen\)/);
        assert.equal(api.calls.reviews, 0);
        assert.ok(!existsSync(join(site, "AI Reviews", "Claude")));
    } finally {
        api.close();
        rmSync(site, { recursive: true, force: true });
    }
});

test("reviews.js with a key the provider rejects: nothing is written, and it fails without showing the key", async () => {
    const site = makeSite({ folder: "AI Reviews", providers: ["Claude"] });
    const api = await fakeClaude("unused");
    try {
        const r = await runReviews(site, api.url, [], "sk-wrong-key-000");
        assert.equal(r.status, 3, r.out);
        assert.match(r.out, /Claude: couldn't list models: 127\.0\.0\.1:\d+ answered 401: bad key/);
        assert.doesNotMatch(r.out, /sk-wrong-key/);
        assert.ok(!existsSync(join(site, "AI Reviews", "Claude")));
    } finally {
        api.close();
        rmSync(site, { recursive: true, force: true });
    }
});

function git (site, ...args) {
    return new Promise(resolve => {
        const child = spawn("git", ["-C", site, ...args]);
        let out = "";
        child.stdout.on("data", c => { out += c; });
        child.on("close", () => resolve(out.trim()));
    });
}

function runUpdate (site, args, base) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [join(AI, "..", "..", "update.js"), site, ...args], {
            env: { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: "sk-test-123456", COLVMN_AI_BASE_CLAUDE: base, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" }
        });
        let out = "";
        child.stdout.on("data", c => { out += c; });
        child.stderr.on("data", c => { out += c; });
        child.on("close", status => resolve({ status, out }));
    });
}

test("through the runner: the reviews job chooses the model, reviews, and commits both", async () => {
    const site = makeSite({ folder: "AI Reviews", providers: ["Claude"] });
    const api = await fakeClaude("Build stamp: none\nVerdict: Fine.\n\nA review.\n");
    try {
        await git(site, "init", "-q", "-b", "main");
        await git(site, "add", "-A");
        await git(site, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "site");
        const r = await runUpdate(site, ["--folder", "AI Reviews"], api.url);
        assert.equal(r.status, 0, r.out);
        assert.match(r.out, /AI Reviews: changed — committed/);
        const stat = await git(site, "show", "--stat", "--format=%s", "HEAD");
        assert.match(stat, /AI Reviews\/Claude\/_index\.md/);
        assert.match(stat, /AI Reviews\/_models\/models\.json/);
        assert.equal(api.calls.reviews, 1);
    } finally {
        api.close();
        rmSync(site, { recursive: true, force: true });
    }
});

test("keys: the standard names by default, a site's own names with aiReviews keys, values from .secret.txt files", () => {
    const site = makeSite({ folder: "AI Reviews", providers: ["Claude", "ChatGPT"], keys: { Claude: "CLAUDE_REVIEW_KEY" } });
    try {
        mkdirSync(join(site, "_credentials"));
        writeFileSync(join(site, "_credentials", "CLAUDE_REVIEW_KEY.secret.txt"), "sk-review-123456\n");
        const [reviews] = UpdateJobs.inSite(site, { OPENAI_API_KEY: "sk-openai-123456", ANTHROPIC_API_KEY: "sk-runner-123456" }).all();
        assert.deepEqual(reviews.updateFile.secrets(), ["CLAUDE_REVIEW_KEY", "OPENAI_API_KEY"], "Claude uses its own key, not the runner's");
        assert.deepEqual(reviews.problems(), []);
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

test("a provider not chosen this run keeps Claude's last choice when it is still listed", async () => {
    const site = makeSite({ folder: "AI Reviews", providers: ["Claude"] });
    const api = await fakeClaude("Build stamp: none\nVerdict: Fine.\n\nA review.\n", "claude-made-up-9");
    try {
        mkdirSync(join(site, "AI Reviews", "_models"), { recursive: true });
        writeFileSync(join(site, "AI Reviews", "_models", "models.json"), JSON.stringify({ Claude: { id: "claude-opus-5-5", name: "Claude Opus 5.5", source: "https://www.anthropic.com/news/y" } }));
        const r = await runReviews(site, api.url);
        assert.equal(r.status, 0, r.out);
        assert.match(r.out, /Claude: keeping the last choice, claude-opus-5-5/);
        assert.equal(api.calls.lastBody.model, "claude-opus-5-5");
    } finally {
        api.close();
        rmSync(site, { recursive: true, force: true });
    }
});
