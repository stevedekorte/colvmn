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
- `layout/layout.js` — browser bootstrap; entry point for page-global runtime behavior
- `layout/PageIndex.js` — page-level builder (`computePageHtml` for build; `render`/`postRender` for runtime — see "Rendering model")
- `layout/ContentBase.js` — base class for content blocks (`computeHtml` = build markup; `postRender` = runtime behavior hook)
- `layout/Content*.js` — content block renderers (Text, Cards, Table, Image, Timeline, Toc, KeyValue, UnorderedList, OrderedList)
- `layout/MarkdownParser.js` — frontmatter + markdown to page JSON

## Markdown Features

The markdown parser supports:
- Standard markdown (headings, bold, italic, links, images, code blocks, lists)
- Image attribute lists — a Pandoc-style `{…}` suffix on an image: `![alt](src){.class #id key=value}` (see "Zoomable images")
- Tables (standard `| col | col |` pipe syntax)
- Raw HTML blocks (passed through as-is)
- YAML frontmatter for page metadata (string values, plus `true`/`false` coerced to booleans)

## Zoomable images

Any image can be made click-to-enlarge by giving it the class `colvmn-zoomable-image`. Clicking it (or focusing it and pressing Enter) opens a full-viewport overlay with the image; clicking the overlay or pressing Escape returns to normal.

- **Markdown:** append an attribute list — `![Architecture](images/arch.svg){.colvmn-zoomable-image}`. The attribute list also accepts `#id` and `key=value` pairs (e.g. `{.colvmn-zoomable-image width=480}`).
- **Raw HTML / `ContentText` body:** add the class directly — `<img class="colvmn-zoomable-image" src="screen.png" alt="…">`.

It is progressive enhancement: the markup ships from the build, and the interactivity is attached at runtime by `layout/Lightbox.js` (`initLightbox`, wired in from `layout.js`). Because it is page-global behavior — not tied to any content block — it lives in `layout.js` rather than a `Content*` block, and uses event delegation so it works for images from any source (markdown, raw HTML, etc.). With no JS the image still renders normally. See "Rendering model" for why page-global behavior belongs in `layout.js`.

## Page Metadata

Top-level keys in `_index.json` (or `_index.md` frontmatter) recognised by the engine:

- `title`, `subtitle`, `topTitle`, `cardSubtitle` — header / intro / parent-card text
- `pageLayout` — adds a `page-{value}` class to the `.page` div for layout variants
- `heroImage`, `heroLayout`, `heroAspect` — hero block configuration
- `nextSectionLink: true` — render a footer link at the bottom of the page pointing to the next sibling (taken from the parent's `ContentCards` items list). Falls back to an up-link to the parent if this page is the last sibling. Opt-in per page; absent flag = no footer.
