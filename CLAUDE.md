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
- `layout/Content*.js` — content block renderers (Text, Cards, Table, Image (see "Image layout"), Timeline, Toc, KeyValue, UnorderedList, OrderedList)
- `layout/MarkdownParser.js` — frontmatter + markdown to page JSON
- `layout/ContentSlideshow.js` — the slideshow block for `_index.json` pages
- `layout/ContentFolder.js` — folder listings (see "Folder listings"): `ContentFolderCards` and `ContentFileCards`
- `viewers/` — standalone viewer pages that file cards open for files a browser can't show: `model.html` (OBJ, three.js) and `drawing.html` (DWG/DXF, LibreDWG as WebAssembly, rendered to SVG). Both load their libraries from jsdelivr at pinned versions and take `?src=` (the file's path relative to the viewer page); they need the site served over HTTP, not `file://`
- `layout/Columns.js` — builds a page's columns on wide viewports (see `maxColumns` under Page Metadata)
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
- Image attribute lists — a Pandoc-style `{…}` suffix on an image: `![alt](src){.class #id key=value}` (see "Zoomable images" and "Image layout")
- Tables (standard `| col | col |` pipe syntax). A header cell may end in a class list that applies to its whole column: `| Phone {.nowrap} |` keeps that column's cells on one line (the parser writes `colvmn-table-nowrap`, from `MarkdownParser.TABLE_COLUMN_OPTIONS`; other classes pass through as-is)
- Raw HTML blocks (passed through as-is)
- YAML frontmatter for page metadata (string values, plus `true`/`false` coerced to booleans). A frontmatter `subtitle` wins over the body: a short first paragraph is then kept as body text rather than promoted to the subtitle
- Folder listings — `folderCards`, `fileCards` and `cardsFirst` in frontmatter (see "Folder listings")

## Zoomable images

Any image can be made click-to-enlarge by giving it the class `colvmn-zoomable-image`. Clicking it (or focusing it and pressing Enter) opens a full-viewport overlay with the image; clicking the overlay or pressing Escape returns to normal.

- **Markdown:** append an attribute list — `![Architecture](images/arch.svg){.colvmn-zoomable-image}`. The attribute list also accepts `#id` and `key=value` pairs (e.g. `{.colvmn-zoomable-image width=480}`).
- **Raw HTML / `ContentText` body:** add the class directly — `<img class="colvmn-zoomable-image" src="screen.png" alt="…">`.

It is progressive enhancement: the markup ships from the build, and the interactivity is attached at runtime by `layout/Lightbox.js` (`initLightbox`, wired in from `layout.js`). Because it is page-global behavior — not tied to any content block — it lives in `layout.js` rather than a `Content*` block, and uses event delegation so it works for images from any source (markdown, raw HTML, etc.). With no JS the image still renders normally. See "Rendering model" for why page-global behavior belongs in `layout.js`.

## Image layout

An image's size and placement are options, as classes in its attribute list (`![Chart](chart.png){.left .column}`), or `size` and `align` on a `ContentImage` block in `_index.json`. The parser writes each option as `colvmn-image-<option>` (`MarkdownParser.IMAGE_OPTIONS`), so the framework's styles never touch a class a page already gives its images; in raw HTML, use the prefixed class (`<img class="colvmn-image-left" …>`).

- **Size:** `natural` (the default: the image's own pixel size, shrunk to fit), `fill` (the full width of where it sits, scaled up past its own size if need be), `column` (its own size, but no wider than one of the page's columns, so an image in a full-width block matches the columns; on a one-column page that is the page width; `colvmn-image-column` also caps any element, such as a raw-HTML `<figure>` with a caption). `width=480` (an HTML attribute) shows it at most 480px wide.
- **Placement:** centered when it stands alone (an image alone in its paragraph, which the parser marks `<p class="colvmn-image">`, or a `ContentImage`; an image beside text stays inline), `left`, `float-left` / `float-right` (text wraps beside it; at most half the width; on its own line under 600px). `center` is the default made explicit.
- **Rows:** consecutive images marked `{.row}` (in one paragraph or several in a row) become one row of figures (`MarkdownParser.imageRowHtml`): side by side with a column gutter between them, each no wider than one of the page's columns, bottoms aligned, wrapping onto more lines when the page is too narrow. An image's markdown title becomes its caption: `![Stock engine](stock.png "Stock — twin-turbo"){.row}`. In raw HTML, `<div class="colvmn-image-row">` around `<figure>`s (each an `<img>` and an optional `<figcaption>`) gets the same layout. The styles are style.css's "Image rows". CSS only, no runtime behavior.
- **JSON:** `{ "type": "ContentImage", "src": "images/a.png", "alt": "…", "size": "column", "align": "left", "zoomable": true, "width": 480 }` (`title` adds a heading), in a `<div class="colvmn-image">`. Built by `layout/ContentImage.js`; the styles are style.css's "Image layout options". CSS only, no runtime behavior.

## Folder listings

A page can list what is in its own folder: `folderCards: true` (or `newest-first`) in `_index.md` frontmatter adds a `ContentFolderCards` block, a card for each subfolder that is a page (has `_index.md`/`_index.json`), titled and subtitled from it like a `ContentCards` folder card; `fileCards: true` adds a `ContentFileCards` block, a card for each file (name less extension, type and size, a thumbnail for images), linking to it. `folderOrder: overview, history, photos` lists folders to put first, in that order (the rest follow, sorted). `folderExclude: drafts, notes` leaves those subfolders out of the cards (link them from the text instead). `folderCardsTitle` / `fileCardsTitle` give them headings. `folderLayout: table` lists the folders as a table instead of a card grid, one row each (`ContentCards.computeTableHtml`, styled as a markdown table, class `.listing-table`, first column on one line); `folderColumns: Date=line1, Record=title, Summary=line2` names its columns and what fills each: `title` (the page title, linked), `lineN` (line N of the page's full subtitle, split at `<br>`), or any other frontmatter key of the listed pages (`date`, `type`, `summary`…), bare headers taking title, line1, line2… in turn (default: Title, then one unlabeled column per subtitle line). With `withFiles`, each file is a row too (its name, then type and size). `folderSort: Date desc` orders the listing (cards or table) by a column, named by its header or its source (`ContentFolderCards.sortItems`): A to Z with numbers by value, Z to A with `desc`; pages without a value go last, and `folderOrder` folders stay first. With both on and neither titled, they share one grid: the folder cards, then the file cards (`withFiles` on the `ContentFolderCards` block). They go after the page's text, or before its first titled section with `cardsFirst: true` (`MarkdownParser.parseMarkdown`). Names starting with `.` or `_`, and `index.html`, are never listed. The listing needs the filesystem, so static-gen sets `ContentBase.listDirFn` for each page (`listPageDir`); in the browser it is unset and the blocks list nothing, which is fine since built pages are not re-rendered (see "Rendering model"). Files a browser can't show (`FOLDER_VIEWERS`: OBJ, DWG, DXF) link to a viewer page in `viewers/` instead (arrow "View in browser"), through `ContentBase.viewerHrefFn` (static-gen's `viewerHref`). Listing grids keep every card one column wide (`listing: true` on `ContentCards`, class `.listing`). Styles: style.css's "File cards".

## Collapsed sections

A top-level section can start closed: mark its heading `## Details {.collapsed}` in markdown, or set `"collapsed": true` on its `ContentText` entry in `_index.json`. The heading becomes a button with a plus mark; clicking it slides the section open and the plus turns to a minus. A link to the section (a contents entry, say) or to anything inside it opens it. The markup ships from the build (`ContentText.collapsedHtml`); `layout/Collapsible.js` (`initCollapsibles`, wired in from `layout.js`) attaches the behavior. With no JS, a `<noscript>` style shows it open, and print shows it open. The marker is left out of `llms-full.txt`. AI review pages use it for their Details.

## Slideshows

Consecutive images marked `{.slideshow}` (`![Alt](a.jpg){.slideshow}`, in one paragraph or several in a row) become one slideshow: the images share one frame and crossfade slowly, with previous and next buttons and an "n / total" count below. Arrow keys (when it has focus), a swipe or a two-finger trackpad swipe move between them; a click enlarges the image (each slide is `colvmn-zoomable-image`). Options, as classes on any of its images: `.autoplay` advances by itself every 6.5 seconds while on screen (pausing on hover, focus, a hidden tab, an enlarged image or reduced motion), `.no-controls` hides the arrows and count (keys, swipes and clicks still work), and `.inset` sets the images in a frame pressed into the page (a paper mat with an inner shadow and a fine rule around the picture). `{.slideshow .autoplay .no-controls}` is a hands-off slideshow. In `_index.json`, the same slideshow is a `ContentSlideshow` block: `{ "type": "ContentSlideshow", "autoplay": true, "controls": false, "inset": true, "images": [{ "src": "images/a.jpg", "alt": "…" }] }`. The markup ships from the build (`MarkdownParser.slideshowHtml`, also used by `layout/ContentSlideshow.js`); `layout/Slideshow.js` (`initSlideshows`, wired in from `layout.js` after `initLightbox`) attaches the behavior. Without JS, and in print, the images are stacked.

## Page Metadata

Top-level keys in `_index.json` (or `_index.md` frontmatter) recognised by the engine:

- `title`, `subtitle`, `topTitle`, `cardSubtitle` — header / intro / parent-card text
- `pageLayout` — adds a `page-{value}` class to the `.page` div for layout variants.
- `toc: false` — no table of contents (one is added automatically when a page has 4 or more titled sections).
- `maxColumns` — 1 to 4 (default 4, or `colvmn.json`'s `maxColumns`): the most columns the page's titled sections are set in on wide viewports (two from 1200px, three from 1860px, four from 2500px, given enough sections and subsections to fill them). `PageIndex` wraps each titled top-level `ContentText`, list or `ContentKeyValue` in a `.col-group`, its heading and first subsection in a `.col-keep`, and marks the page `.has-cols`/`.has-cols-3`/`.has-cols-4` and `.max-cols-2`/`.max-cols-3`. `layout/Columns.js` builds the columns (`.col-set`): it splits the sections' units (each `.col-keep`, and each later subsection) in order into the columns, never splitting a unit, preferring to start sections at a column top unless continuing one saves over 15% height, and gives a subsection continuing at a column top a heading's worth of space (`.col-continued`). Without JS, style.css's fallback uses the browser's own columns. Everything else (intro, contents, cards, tables, untitled text, footer) spans the page, with up to four cards in one row (five where the page has three or more columns). Narrower viewports and print are one column.
- `heroImage`, `heroLayout`, `heroAspect` — hero block configuration
- `analytics: false` — omit the site's analytics snippets (from `colvmn.json`) on this page.
- `llms: false` — leave this page and everything under it out of `llms.txt` / `llms-full.txt` (it is still generated and in the sitemap). Site-wide folder patterns go in `colvmn.json` as `llmsExclude`.
- `aiReviews: true` — AI models review this page's folder and everything below it (the site's settings are `colvmn.json`'s `aiReviews`); its reviews live in that setting's `folder` inside this page's folder, and the page gets a footer link to them. `prompt` sets this page's review prompt. Not inherited.
- `footerLinks` — `[{ "title": "llms.txt", "href": "llms.txt" }, …]`: links on one line at the left of the page footer, separated by middle dots; the AI reviews link (`aiReviews: true`) joins them.
- `nextSectionLink: true` — render a footer link at the bottom of the page pointing to the next sibling (taken from the parent's `ContentCards` items list). Falls back to an up-link to the parent if this page is the last sibling. Opt-in per page; absent flag = no footer.
