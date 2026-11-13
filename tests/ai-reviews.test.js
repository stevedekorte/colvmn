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
import { providerFor, compareVersions } from "../update/ai/Providers.js";
import { parseAnswer, safeMarkdown, inputHash } from "../update/ai/ReviewPages.js";
import { UpdateJobs } from "../update/UpdateJobs.js";

const AI = join(dirname(fileURLToPath(import.meta.url)), "..", "update", "ai");

test("the top model: Fable over Opus for Claude, the plain highest version elsewhere", () => {
    const claude = providerFor("Claude", {});
    assert.deepEqual(claude.pickTop([
        { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-10-01" },
        { id: "claude-fable-5-1", display_name: "Claude Fable 5.1", created_at: "2026-08-01" },
        { id: "claude-fable-5-2", display_name: "Claude Fable 5.2", created_at: "2026-10-20" },
        { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", created_at: "2026-11-01" }
    ]), { id: "claude-fable-5-2", name: "Claude Fable 5.2" });
    assert.deepEqual(claude.pickTop([{ id: "claude-opus-5", created_at: "1" }, { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2" }]), { id: "claude-opus-5-5", name: "Claude Opus 5.5" });

    const openai = providerFor("ChatGPT", {});
    assert.deepEqual(openai.pickTop(["gpt-5", "gpt-5.1", "gpt-5.1-mini", "gpt-5.10-2026-01-01", "gpt-4.1", "o3"].map(id => ({ id }))), { id: "gpt-5.1", name: "GPT-5.1" });

    const grok = providerFor("Grok", {});
    assert.deepEqual(grok.pickTop(["grok-3", "grok-4", "grok-4-fast", "grok-code-1"].map(id => ({ id }))), { id: "grok-4", name: "Grok 4" });

    const gemini = providerFor("Gemini", {});
    const g = (id, displayName) => ({ name: `models/${id}`, displayName, supportedGenerationMethods: ["generateContent"] });
    assert.deepEqual(gemini.pickTop([g("gemini-2.5-pro", "Gemini 2.5 Pro"), g("gemini-3-pro-preview", "Gemini 3 Pro Preview"), g("gemini-3-flash", "x")]), { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" });
    assert.deepEqual(gemini.pickTop([g("gemini-3-pro-preview", "P"), g("gemini-3-pro", "Gemini 3 Pro")]), { id: "gemini-3-pro", name: "Gemini 3 Pro" });

    assert.ok(compareVersions("5.10", "5.9") > 0);
    assert.equal(providerFor("Mistral"), null);
});

test("an answer gives its quoted stamp, verdict and review; HTML is escaped outside code", () => {
    const a = parseAnswer("**Build stamp:** `Site build: X · 2026-11-12 · abc`\nVerdict: \"Solid, small community.\"\n\n# Review\n\nIt's fine <script>alert(1)</script> and `a<b`.\n");
    assert.equal(a.stamp, "Site build: X · 2026-11-12 · abc");
    assert.equal(a.verdict, "Solid, small community.");
    assert.match(a.body, /^## Review/);                  // the page's title is the only h1
    assert.match(a.body, /&lt;script>/);
    assert.match(a.body, /`a<b`/);
    assert.equal(parseAnswer("Build stamp: none\nVerdict: ok\nText").stamp, "");
    assert.equal(safeMarkdown("```\n<b>\n```"), "```\n<b>\n```");
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

test("aiReviews adds a models job (pr) and a reviews job (direct, watching the docs and models.json), with the keys that have values", () => {
    const site = makeSite({ folder: "AI Reviews", about: "Review Process" });
    try {
        let jobs = UpdateJobs.inSite(site, {});
        assert.deepEqual(jobs.all().map(j => j.folderName()), ["AI Reviews/_models", "AI Reviews"]);
        assert.match(jobs.all()[0].problems().join(), /no AI Reviews key has a value/);

        jobs = UpdateJobs.inSite(site, { CLAUDE_REVIEW_KEY: "sk-test-123456" });
        const [models, reviews] = jobs.all();
        assert.deepEqual(models.problems(), []);
        assert.equal(models.updateFile.publish(), "pr");
        assert.deepEqual(models.updateFile.secrets(), ["CLAUDE_REVIEW_KEY"]);
        assert.equal(reviews.updateFile.publish(), "direct");
        assert.deepEqual(reviews.updateFile.watch(), ["llms-full.txt", "AI Reviews/_models/models.json"]);
        assert.equal(reviews.updateFile.minIntervalMs(), 30 * 86400e3);
        assert.ok(reviews.updateFile.writes().includes("AI Reviews/Claude/**"));
        assert.ok(!reviews.updateFile.writes().some(w => w.includes("_models")), "models.json isn't the reviews job's own output, so changing it makes the job due");
        assert.ok(existsSync(reviews.updateFile.scriptPath()));
    } finally {
        rmSync(site, { recursive: true, force: true });
    }
});

/** A stand-in for the Claude API; counts the reviews asked for. */
async function fakeClaude (answer) {
    const calls = { reviews: 0, lastBody: null };
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
            calls.reviews++;
            calls.lastBody = JSON.parse(body);
            res.end(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: answer }], usage: { input_tokens: 100, output_tokens: 50 } }));
        });
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    return { calls, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

function runScript (name, site, base) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [join(AI, name)], {
            env: { PATH: process.env.PATH, COLVMN_SITE_ROOT: site, CLAUDE_REVIEW_KEY: "sk-test-123456", COLVMN_AI_BASE_CLAUDE: base },
            stdio: ["ignore", "pipe", "pipe"]
        });
        let out = "";
        child.stdout.on("data", c => { out += c; });
        child.stderr.on("data", c => { out += c; });
        child.on("close", status => resolve({ status, out }));
    });
}

test("models.js writes the top model; reviews.js writes the review, skips it when nothing changed, and archives it when the docs change", async () => {
    const site = makeSite({ folder: "AI Reviews", about: "Review Process", providers: ["Claude", "Gemini"] });
    const api = await fakeClaude("Build stamp: Site build: Example · 2026-11-12 · abc1234\nVerdict: Clear docs, small ecosystem.\n\n## Strengths\n\nGood.\n");
    try {
        let r = await runScript("models.js", site, api.url);
        assert.equal(r.status, 0, r.out);
        const models = JSON.parse(readFileSync(join(site, "AI Reviews", "_models", "models.json"), "utf8"));
        assert.deepEqual(models, { Claude: { id: "claude-fable-5-2", name: "Claude Fable 5.2" } });
        assert.equal((await runScript("models.js", site, api.url)).status, 3, "no change the second time");

        r = await runScript("reviews.js", site, api.url);
        assert.equal(r.status, 0, r.out);
        assert.equal(api.calls.reviews, 1);
        assert.equal(api.calls.lastBody.model, "claude-fable-5-2");
        assert.match(api.calls.lastBody.messages[0].content, /Start your answer with these two lines[\s\S]*<llms-full\.txt>[\s\S]*The docs\./);
        const review = readFileSync(join(site, "AI Reviews", "Claude", "_index.md"), "utf8");
        assert.match(review, /^---\nmodelName: Claude Fable 5\.2\nmodel: claude-fable-5-2\nreviewed: \d{4}-\d{2}-\d{2}\nsummary: Clear docs, small ecosystem\.\nstamp: Site build: Example · 2026-11-12 · abc1234\ninputHash: [0-9a-f]{16}\n---\n# Claude\n\n## Strengths\n\nGood\.\n$/);
        assert.ok(existsSync(join(site, "AI Reviews", "Claude", "index.html")));
        assert.match(readFileSync(join(site, "AI Reviews", "_index.md"), "utf8"), /on \{date\}/);              // default section page
        assert.match(readFileSync(join(site, "AI Reviews", "Review Process", "_index.md"), "utf8"), /at most every 30 days/);

        r = await runScript("reviews.js", site, api.url);
        assert.equal(r.status, 3, r.out);
        assert.equal(api.calls.reviews, 1, "unchanged docs and model: no new review");

        writeFileSync(join(site, "llms-full.txt"), "# Example\n\nSite build: Example · 2026-11-13 · def5678\n\nThe docs, revised.\n");
        r = await runScript("reviews.js", site, api.url);
        assert.equal(r.status, 0, r.out);
        assert.equal(api.calls.reviews, 2);
        const archive = join(site, "AI Reviews", "Claude", "archive");
        const [dated] = readdirSync(archive);
        assert.match(dated, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(existsSync(join(archive, dated, "_index.md")) && existsSync(join(archive, dated, "index.html")));
    } finally {
        api.close();
        rmSync(site, { recursive: true, force: true });
    }
});

test("reviews.js with a key the provider rejects: nothing is written, and it fails", async () => {
    const site = makeSite({ folder: "AI Reviews", providers: ["Claude"] });
    const api = await fakeClaude("unused");
    try {
        mkdirSync(join(site, "AI Reviews", "_models"), { recursive: true });
        writeFileSync(join(site, "AI Reviews", "_models", "models.json"), JSON.stringify({ Claude: { id: "claude-fable-5-2", name: "Claude Fable 5.2" } }));
        const r = await new Promise(resolve => {
            const child = spawn(process.execPath, [join(AI, "reviews.js")], { env: { PATH: process.env.PATH, COLVMN_SITE_ROOT: site, CLAUDE_REVIEW_KEY: "sk-wrong-key-000", COLVMN_AI_BASE_CLAUDE: api.url } });
            let out = "";
            child.stdout.on("data", c => { out += c; });
            child.on("close", status => resolve({ status, out }));
        });
        assert.equal(r.status, 1);
        assert.match(r.out, /Claude: failed: 127\.0\.0\.1:\d+ answered 401: bad key/);
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
            env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_REVIEW_KEY: "sk-test-123456", COLVMN_AI_BASE_CLAUDE: base, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" }
        });
        let out = "";
        child.stdout.on("data", c => { out += c; });
        child.stderr.on("data", c => { out += c; });
        child.on("close", status => resolve({ status, out }));
    });
}

test("through the runner: the models job opens a PR branch; merged, the reviews job commits a review", async () => {
    const site = makeSite({ folder: "AI Reviews", providers: ["Claude"] });
    const api = await fakeClaude("Build stamp: none\nVerdict: Fine.\n\nA review.\n");
    try {
        await git(site, "init", "-q", "-b", "main");
        await git(site, "add", "-A");
        await git(site, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "site");

        let r = await runUpdate(site, ["--folder", "AI Reviews/_models"], api.url);
        assert.equal(r.status, 0, r.out);
        assert.match(r.out, /committed on colvmn-update\/AI-Reviews\/_models/);
        assert.equal(await git(site, "status", "--porcelain"), "");
        await git(site, "-c", "user.name=T", "-c", "user.email=t@example.com", "merge", "-q", "colvmn-update/AI-Reviews/_models");   // a person confirms the model

        r = await runUpdate(site, ["--folder", "AI Reviews"], api.url);
        assert.equal(r.status, 0, r.out);
        assert.match(r.out, /AI Reviews: changed — committed/);
        assert.match(await git(site, "show", "--stat", "--format=%s", "HEAD"), /AI Reviews\/Claude\/_index\.md[\s\S]*AI Reviews\/_update\.state\.json/);
        assert.equal(api.calls.reviews, 1);
    } finally {
        api.close();
        rmSync(site, { recursive: true, force: true });
    }
});
