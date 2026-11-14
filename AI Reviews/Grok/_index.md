---
modelName: Grok 4.7
model: grok-4.7
reviewed: 2026-11-13
summary: A tiny opinionated static-site engine with useful LLM outputs, but AI publishing features add cost and accuracy risk.
stamp: colvmn · 2026-11-13 · b6b227c
inputHash: b3a8599fd720a61c
---
# Grok

colvmn (pronounced “column”) is a small, self-hosting layout engine for static sites. A page is a directory with a thin `index.html` shell plus `_index.md` (YAML frontmatter) or `_index.json`. The same renderer runs in Node at build time and in the browser, writing pre-rendered HTML that crawlers and no-JavaScript clients can read, then optionally replacing it with a live DOM render. It is MIT-licensed and distributed as a git submodule.

## Strengths

The page model is easy to hold in your head: directories are the site tree, cards can be filled from child folders, `topTitle` and back-links walk upward, and markdown and JSON compile to the same block model. The block set covers the usual docs needs (prose, cards, tables, lists, FAQ, timeline, images, slideshows, collapsed sections, TOC) without a plugin marketplace.

Pre-rendering is the right default. `sitemap.xml`, `llms.txt`, and `llms-full.txt` are emitted on every build, with per-folder llms files, exclusions, and an optional build stamp. Nested sites stay out of the parent’s llms output. Generated pages can be read from `file://` for content, CSS, and navigation.

Scheduled updates are unusually careful for a tiny tool. Jobs are due only on a trigger, optional watch globs, and a minimum interval; a job’s own output cannot retrigger itself. Script jobs get a minimal environment and only listed secrets. Prompt jobs get no job credentials, no shell, a dollar budget, and a `writes` allowlist. After a run, paths, a rebuild, and a credential-value scan must pass or the diff is discarded. Default publish is a pull request, not a direct commit. Notifications can be withheld if they would contain a secret.

AI reviews are opt-in per folder, not inherited, published unedited, archived, and kept out of every llms file so later reviews do not read earlier ones. Model IDs must come from the provider’s list; a provider Claude cannot choose is skipped rather than guessed. Unchanged docs and model skip the paid review.

## Weaknesses and risks

The docs describe mechanism, not evidence. There is no mention of tests that the Node and browser renderers stay identical, no versioning or upgrade story beyond “nested colvmn must match or the build stops,” and no themes, search, i18n, image pipeline, or CMS. New block types mean editing `layout.js` and `static-gen.js`. Every page needs a hand-maintained shell. Markdown body and a frontmatter `content` array do not merge, so the wrong authoring path silently replaces the page. The Quick Start in this dump cuts off inside the sample `_index.md`, so the onboarding page as shipped here is incomplete.

The distinctive features are also the risk. Prompt jobs run Claude Code with web access and edit rights inside `writes`. A broad glob, a poisoned page, or a bad prompt can still change the site; the sandbox is convention plus post-checks, not a strong isolation boundary. Script jobs that receive secrets can write them into allowed files; the scanner is a backstop, not a guarantee. LaunchAgent setups keep keys in a plist outside the repo. Provider keys and Resend are operational dependencies.

Reviews are published as the model wrote them. Hallucinations, bias, and prompt-injection leftovers become site content until the next run. An author’s note can sit beside a review, but the review itself is never edited. Cost scales with the attached `llms-full.txt` (about one to three dollars per model around 200k tokens, plus a model-selection call). Model choice depends on Claude plus vendor announcements; names the selector does not understand are skipped. Scheduling is UTC cron, launchd, or GitHub Actions — nothing else is documented.

## Who should and should not use it

Use it if you are a solo author or a very small team shipping a docs or project site, you want directory-shaped content and automatic LLM exports, and you are willing to run Node, git, and optional API keys yourself.

Do not use it if you need a mature static-site ecosystem, a visual CMS, multilingual content, heavy media, or a large contributor base. Do not turn on prompt jobs or AI reviews if unedited model text must not appear next to your docs, if you cannot bound spend and secrets, or if a wrong published paragraph is worse than a stale page.

## Compared with alternatives

Against Eleventy, Hugo, Jekyll, Astro, or Docusaurus, colvmn is smaller and more opinionated, and it loses on themes, plugins, content volume, and community answers. Those tools do not, in the same first-party way, emit per-folder `llms-full.txt`, stamp builds, or run budgeted update jobs and multi-model reviews as part of the site engine. MkDocs and similar doc generators are a closer job fit for reference sites and are safer if you only want Markdown to HTML. Colvmn is the better fit only when the LLM export and the guarded update/review loop are the point, not when you want a general static-site framework.
