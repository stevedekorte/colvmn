---
modelName: Gemini 4 Carbon
model: gemini-4-carbon
reviewed: 2026-11-13
summary: A minimal static site engine with native LLM exports, guarded self-updating pages, and automated AI reviews.
stamp: colvmn · 2026-11-13 · b6b227c
inputHash: e75a20aff686b81b
---
# Gemini

## What colvmn Is

**colvmn** (pronounced *column*) is an MIT-licensed, minimal static-site layout engine written in JavaScript for Node and the browser. Rather than relying on a complex bundler or build framework, it drops into a repository as a Git submodule (`colvmn/`).

Every page in a colvmn site is a directory containing two files:
1. A thin `index.html` shell loading `/colvmn/style.css` and `/colvmn/layout/layout.js`.
2. A content file written either as Markdown with YAML frontmatter (`_index.md`) or as structured JSON (`_index.json`).

At build time, `node colvmn/static-gen.js` walks the directory tree, renders each page's content blocks into static HTML inside `index.html`, and emits `sitemap.xml`, `llms.txt`, and `llms-full.txt`. At runtime in the browser, `layout.js` runs the exact same renderer to mount live DOM over the pre-rendered HTML. Beyond rendering, colvmn bundles a Git-integrated automation runner (`update.js`) for scheduled page updates and unedited, multi-model AI reviews.

---

## Strengths

* **First-class LLM citizens:** Every build automatically generates `llms.txt` and `llms-full.txt` alongside `sitemap.xml`, with granular opt-out controls (`llmsExclude` in `colvmn.json` or `llms: false` per page) and optional Git commit build stamps (`buildStamp: true`) so agents and readers can verify freshness.
* **Thoughtfully sandboxed self-updating pages:** Adding an `_update.md` turns a folder into a self-refreshing page driven either by a deterministic Node script or a headless Claude Code prompt. The security model is notably well-engineered:
  * Prompt jobs have **no shell access** and **cannot receive job secrets**, preventing prompt-injection attacks on fetched web pages from exfiltrating credentials.
  * Every run enforces a `writes` glob allowlist, a hard dollar `budget` for prompt jobs, clean-working-tree checks, and post-run scans ensuring secret values never appear in modified files or notification emails.
  * Jobs support PR-based publishing (`publish: pr`), `minInterval` throttling, and `watch` paths that allow cheap jobs to trigger expensive downstream jobs without self-triggering loops.
* **Transparent, cost-aware AI reviews:** Opting a page in (`aiReviews: true`) generates scoped `llms-full.txt` files and queries Claude, ChatGPT, Gemini, and Grok to evaluate that section. Answers are published unedited (corrections must go in a separate `## Author's note`), archived across versions, excluded from `llms-full.txt` to prevent circular groupthink, and skipped when neither the docs, prompt, nor top model has changed.
* **Zero-server portability and progressive enhancement:** Because HTML is pre-rendered and asset URLs are rewritten to page-relative paths, sites can be browsed directly off disk via `file://` and indexed by JS-free crawlers, while interactive features (crossfading slideshows, zoomable images, collapsible sections) gracefully stack or expand when JavaScript is disabled or printed.
* **Directory-driven ergonomics:** Hierarchy comes free from the filesystem—`topTitle` inherits down the tree, parent back-links and `nextSectionLink` footers generate automatically, `ContentCards` pull titles/subtitles directly from subfolder `_index` files, and sub-projects can live as isolated **nested sites**.

---

## Weaknesses and Risks

* **Per-page `index.html` boilerplate:** Requiring a physical `index.html` shell alongside `_index.md` or `_index.json` in every single page directory creates repetitive file clutter and makes site-wide `<head>` changes (analytics, meta tags, favicons, custom stylesheets) tedious to maintain across large sites.
* **Rigid split between prose and structured blocks:** While Markdown handles `ContentText`, zoomable images, slideshows, and collapsed sections via `{…}` suffixes, structured blocks (`ContentCards`, `ContentTimeline`, `ContentFAQ`, `ContentKeyValue`, `ContentTable`) require JSON. Putting a `content` array in `_index.md` frontmatter *replaces* the Markdown body rather than merging with it, making it awkward to interleave long-form Markdown prose with structured widgets.
* **Unnecessary client-side re-rendering:** Having `layout.js` replace already-identical pre-rendered HTML in the browser on every page load adds client-side work for static text pages that only strictly need JS hydration for interactive elements.
* **Awkward extensibility via Git submodule:** Adding custom block types requires extending `ContentBase` and registering the new class inside `layout.js` and `static-gen.js`. Because colvmn is installed as a Git submodule, customizing blocks means forking colvmn rather than registering plugins cleanly in userland.
* **Hard vendor dependencies in automation:** Prompt-based updates and automatic model selection in AI reviews strictly depend on Anthropic (`ANTHROPIC_API_KEY` and headless Claude Code), and email notifications strictly require Resend.
* **Scaling and maintenance friction:**
  * Nested sites must run the *exact* same version of colvmn as the root site or the build halts—a sharp edge for modular documentation spanning independent repos.
  * AI reviews send the full scoped `llms-full.txt` per model (~$1–$3 per model at ~200,000 tokens); opting in multiple parent and child sections duplicates token spend because parent reviews include child content.
  * Minor documentation rough edges exist in the current build—for instance, the `quick-start` page's `_index.md` example cuts off mid-frontmatter.

---

## Who Should and Shouldn't Use It

### Who should use colvmn
* **Developer-tool authors and open-source maintainers** who want clean hierarchical documentation with automatic `llms.txt` / `llms-full.txt` generation out of the box.
* **Maintainers of "living" reference sites**—competitive matrices, benchmark dashboards, API/model trackers, or generated class trees—who can pair deterministic Node scripts with scheduled PR updates via GitHub Actions or macOS `launchd`.
* **Technical authors seeking external accountability** who want automated, unedited multi-model critiques attached to their documentation or specs.
* **Minimalists** who dislike `node_modules` bloat, complex bundlers, and framework churn, or who distribute offline documentation meant to open cleanly via `file://`.

### Who shouldn't use colvmn
* **Content-heavy blogs and publications** needing tags, categories, pagination, RSS/Atom feeds, date-based routing, or built-in full-text search (none of which colvmn provides).
* **Marketing teams and custom designers** who need bespoke layouts, rich theming systems, or visual CMS editing rather than a fixed set of ~11 content block types.
* **Authors accustomed to MDX** who expect to drop interactive components inline mid-article without dropping out of Markdown into raw HTML strings inside JSON.
* **Large federated organizations** embedding docs from multiple teams that upgrade their site tooling on independent schedules (due to the strict nested-site version lock).

---

## Comparison to Alternatives

| Alternative | Where the Alternative Wins | Where colvmn Wins |
| :--- | :--- | :--- |
| **Traditional SSGs** *(Hugo, Jekyll, Eleventy)* | Single-file Markdown authoring (no per-folder `index.html` shells), full templating languages, taxonomies, RSS feeds, faster pure-static builds with zero client JS re-render. | Built-in `llms.txt` / `llms-full.txt` generation, native scheduled script/LLM update runner, automated AI reviews, and `file://` portability with zero templating setup. |
| **Modern Docs Frameworks** *(Astro/Starlight, VitePress, Docusaurus)* | MDX support (freely mixing Markdown and components), built-in search, rich plugin ecosystems, custom theming, and userland component registration without editing engine files. | Tiny footprint via Git submodule, no heavy bundler pipeline, guarded `_update.md` automation, and native multi-provider AI auditing. |
| **DIY GitHub Actions + Cron Scripts** | Complete freedom over LLM runners, notification channels (Slack, SMTP, etc.), and site generators. | Integrated guardrails out of the box: `writes` scoping, secret leak scanning in diffs/emails, `watch` dependency chaining, PR deduplication, and cost caps configured right beside the page it updates. |
