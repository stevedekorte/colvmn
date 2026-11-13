# colvmn - Layout Engine

A minimal static-site layout engine. Pages are described by `_index.md` (with YAML frontmatter) or `_index.json`; `static-gen.js` renders them to static HTML at build time. In the browser, the same rendering code can build the DOM live, but on shipped (built) pages it does **not** — see "Rendering model" below.

## Key Rule

**Do not edit `index.html` files directly.** These are generated output. Edit the `_index.md` (or `_index.json`) source file instead, then regenerate:

```bash
node colvmn/static-gen.js
```

This walks the site tree and rewrites every `index.html`, plus `sitemap.xml`, `llms.txt`, and `llms-full.txt`.

## Rendering model

The HTML you see in a shipped page is produced **once, at build time**, by `static-gen.js`. The browser does **not** re-render it. There is one HTML render (build-time) plus a runtime *behavior-attachment* pass — not two renders.

How it works:

1. **Build (`static-gen.js`).** Runs the layout code under Node, writes the final markup into `<div class="page loaded">…</div>`, and inlines a prefetch cache (`<script id="colvmn-prefetch">`) of every `_index.*` URL the build fetched. Each page also references `layout/bundle.js` (the layout sources concatenated into one classic script, since Chrome won't load ES modules over `file://`).

2. **Runtime (`bundle.js`).** On `DOMContentLoaded`, `PageIndex.init()` always runs `loadPage()` (re-reading the inlined prefetch JSON and rebuilding the in-memory block tree) and then `render()`. But `render()` is guarded:

   ```js
   if (!page.classList.contains("loaded")) {   // built pages already have "loaded"
       page.innerHTML = this.computePageHtml(); // ← skipped on shipped pages
   }
   ...
   this.children.forEach(c => c.postRender(page)); // ← always runs
   ```

   So `computePageHtml()` is **dead code on shipped pages** — it only fires if a `.page` element isn't marked `loaded`. The reason `bundle.js` still ships on every page is `postRender()`: that is the runtime hook where interactive blocks attach their listeners (e.g. `ContentTimeline` zoom/drag, `ContentCompetitorTable` toggles). For a plain text/cards/image page, the runtime pass does effectively nothing.

**Implications when adding features:**

- Markup must be emitted by the build path (`computeHtml()` / `computePageHtml()`), since that is what ships. Don't rely on browser-side DOM construction.
- Interactivity belongs in `postRender(page)` (per-block) or, for page-global behavior not tied to a block, in `layout.js`'s `DOMContentLoaded` handler. Prefer event delegation so it works regardless of which blocks are present.
- There is no static/dynamic markup to keep in sync: the build is the single source of the HTML; the runtime only enhances it.

## Structure

- `style.css` — base framework CSS (typography, page, cards, tables, timeline, hero, FAQ, mobile)
- `static-gen.js` — Node.js generator that walks the site tree and rewrites each `index.html` (build-time render; also builds `layout/bundle.js`)
- `analytics.js` — provider registry for the `analytics` section of `colvmn.json`; builds and injects the marked snippet blocks (build-time only, not bundled); the snippets are wrapped in a `<template>` plus a loader that skips them in browsers opted out via `?analytics=off`
- `layout/layout.js` — browser bootstrap; entry point for page-global runtime behavior
- `layout/PageIndex.js` — page-level builder (`computePageHtml` for build; `render`/`postRender` for runtime — see "Rendering model")
- `layout/ContentBase.js` — base class for content blocks (`computeHtml` = build markup; `postRender` = runtime behavior hook)
- `layout/Content*.js` — content block renderers (Text, Cards, Table, Image, Timeline, Toc, KeyValue, UnorderedList, OrderedList)
- `layout/MarkdownParser.js` — frontmatter + markdown to page JSON
- `layout/ContentSlideshow.js` — the slideshow block for `_index.json` pages
- `layout/Slideshow.js` — slideshow behavior (see "Slideshows")
- `layout/Collapsible.js` — open/close behavior for collapsed sections (page-global, event delegation; see "Collapsed sections")
- `layout/AiReviews.js` — AI reviews: `AiReviews` (the site's `colvmn.json` `aiReviews` settings and providers, and the pages that opt in with `aiReviews: true`) and `ReviewScope` (one opted-in page's folder: its prompt, its reviews folder, and what the generator adds: provider cards, review headers and details, archive lists, the footer link, the home card; reviews folders are out of every llms file). Build-time only, not bundled
- `update.js` — the scheduled-updates runner: finds `_update.md` jobs, decides which are due (schedule or `on: push`, `watch`, `minInterval`), runs them, publishes (`direct` or `pr`), and emails a summary if `colvmn.json` asks
- `update/` — its parts: `UpdateFile` (update-file parsing), `Schedule` (named and cron schedules), `UpdateJobs` (jobs, state, due checks), `JobRunner` (running script and prompt jobs, the `writes` and leak checks, publishing), `Credentials` (`_credentials/` lookup and values), `SecretFiles` (keeping `*.secret.txt` value files out of git: not read, build fails, never staged), `Notifier` (email via Resend), `Git`, `Glob`, `workflow-template.yml`
- `update/ai/` — AI Reviews production: `AiReviewJobs` (the built-in job `aiReviews` adds), `reviews.js` (the job: choose the models once, then review each opted-in page; `--models`, `--only`, `--scope` by hand), `ModelChooser` (Claude with web search picks each provider's top model from its real model list; no name guessing), `Providers` (the four APIs: model lists and review calls; plain HTTPS), `ReviewPages` (reading answers, writing and archiving review pages). `update/launchd-template.plist` runs the runner daily on a Mac
- `tests/` — `npm test` (node:test); the runner tests build temp git repos; the AI tests use a local stand-in for the Claude API
- `docs/plans/` — design plans (not published: no `index.html`)

## Markdown Features

The markdown parser supports:
- Standard markdown (headings, bold, italic, links, images, code blocks, lists)
- Collapsed sections — `## Details {.collapsed}` (or `"collapsed": true` on a top-level `ContentText` in JSON) builds a section shown closed, whose heading opens it (see "Collapsed sections")
- Slideshows — consecutive images marked `{.slideshow}` share one frame and crossfade (see "Slideshows")
- Image attribute lists — a Pandoc-style `{…}` suffix on an image: `![alt](src){.class #id key=value}` (see "Zoomable images")
- Tables (standard `| col | col |` pipe syntax)
- Raw HTML blocks (passed through as-is)
- YAML frontmatter for page metadata (string values, plus `true`/`false` coerced to booleans)

## Zoomable images

Any image can be made click-to-enlarge by giving it the class `colvmn-zoomable-image`. Clicking it (or focusing it and pressing Enter) opens a full-viewport overlay with the image; clicking the overlay or pressing Escape returns to normal.

- **Markdown:** append an attribute list — `![Architecture](images/arch.svg){.colvmn-zoomable-image}`. The attribute list also accepts `#id` and `key=value` pairs (e.g. `{.colvmn-zoomable-image width=480}`).
- **Raw HTML / `ContentText` body:** add the class directly — `<img class="colvmn-zoomable-image" src="screen.png" alt="…">`.

It is progressive enhancement: the markup ships from the build, and the interactivity is attached at runtime by `layout/Lightbox.js` (`initLightbox`, wired in from `layout.js`). Because it is page-global behavior — not tied to any content block — it lives in `layout.js` rather than a `Content*` block, and uses event delegation so it works for images from any source (markdown, raw HTML, etc.). With no JS the image still renders normally. See "Rendering model" for why page-global behavior belongs in `layout.js`.

## Collapsed sections

A top-level section can start closed: mark its heading `## Details {.collapsed}` in markdown, or set `"collapsed": true` on its `ContentText` entry in `_index.json`. The heading becomes a button with a plus mark; clicking it slides the section open and the plus turns to a minus. A link to the section (a contents entry, say) or to anything inside it opens it. The markup ships from the build (`ContentText.collapsedHtml`); `layout/Collapsible.js` (`initCollapsibles`, wired in from `layout.js`) attaches the behavior. With no JS, a `<noscript>` style shows it open, and print shows it open. The marker is left out of `llms-full.txt`. AI review pages use it for their Details.

## Slideshows

Consecutive images marked `{.slideshow}` (`![Alt](a.jpg){.slideshow}`, in one paragraph or several in a row) become one slideshow: the images share one frame and crossfade slowly, with previous and next buttons and an "n / total" count below. Arrow keys (when it has focus), a swipe or a two-finger trackpad swipe move between them; a click enlarges the image (each slide is `colvmn-zoomable-image`). Options, as classes on any of its images: `.autoplay` advances by itself every 6.5 seconds while on screen (pausing on hover, focus, a hidden tab, an enlarged image or reduced motion), and `.no-controls` hides the arrows and count (keys, swipes and clicks still work). `{.slideshow .autoplay .no-controls}` is a hands-off slideshow. In `_index.json`, the same slideshow is a `ContentSlideshow` block: `{ "type": "ContentSlideshow", "autoplay": true, "controls": false, "images": [{ "src": "images/a.jpg", "alt": "…" }] }`. The markup ships from the build (`MarkdownParser.slideshowHtml`, also used by `layout/ContentSlideshow.js`); `layout/Slideshow.js` (`initSlideshows`, wired in from `layout.js` after `initLightbox`) attaches the behavior. Without JS, and in print, the images are stacked.

## Page Metadata

Top-level keys in `_index.json` (or `_index.md` frontmatter) recognised by the engine:

- `title`, `subtitle`, `topTitle`, `cardSubtitle` — header / intro / parent-card text
- `pageLayout` — adds a `page-{value}` class to the `.page` div for layout variants
- `heroImage`, `heroLayout`, `heroAspect` — hero block configuration
- `analytics: false` — omit the site's analytics snippets (from `colvmn.json`) on this page.
- `llms: false` — leave this page and everything under it out of `llms.txt` / `llms-full.txt` (it is still generated and in the sitemap). Site-wide folder patterns go in `colvmn.json` as `llmsExclude`.
- `aiReviews: true` — AI models review this page's folder and everything below it (the site's settings are `colvmn.json`'s `aiReviews`); its reviews live in that setting's `folder` inside this page's folder, and the page gets a footer link to them. `prompt` sets this page's review prompt. Not inherited.
- `footerLinks` — `[{ "title": "llms.txt", "href": "llms.txt" }, …]`: links on one line at the left of the page footer, separated by middle dots; the AI reviews link (`aiReviews: true`) joins them.
- `nextSectionLink: true` — render a footer link at the bottom of the page pointing to the next sibling (taken from the parent's `ContentCards` items list). Falls back to an up-link to the parent if this page is the last sibling. Opt-in per page; absent flag = no footer.
