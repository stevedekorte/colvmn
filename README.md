# colvmn

A minimal static-site layout engine. Pages are described by `_index.md` (with
YAML frontmatter) or `_index.json`; the engine renders them to static HTML at
build time and to live DOM in the browser.

Pronounced "column" — the `v` is Latin-styled for `u`.

## Layout

```
colvmn/
  style.css            # base framework CSS (typography, page, cards, timeline, hero, FAQ, mobile)
  static-gen.js        # Node generator: walks the site tree, rewrites each index.html
  layout/
    layout.js          # browser bootstrap
    PageIndex.js       # page-level builder
    ContentBase.js     # base class for content blocks
    Content*.js        # content block renderers (Text, Cards, Table, Image, Timeline, ...)
    MarkdownParser.js  # frontmatter + markdown → page JSON
  update.js            # scheduled-updates runner (see "Scheduled updates")
  update/              # its parts: update files, schedules, credentials, runner, notifier, workflow template
  tests/               # npm test
```

## Usage as a submodule

```bash
git submodule add https://github.com/stevedekorte/colvmn.git colvmn
```

Each page's `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/colvmn/style.css">
  <title>…</title>
</head>
<body>
  <div class="page"></div>
  <script src="/colvmn/layout/layout.js" type="module"></script>
</body>
</html>
```

(Adjust the paths to be relative to the page's depth, or use absolute `/colvmn/...` if the site is served from root.)

Alongside each `index.html` put an `_index.md`:

```markdown
---
title: My Page
topTitle: My Site
---

# My Page

Some intro text.
```

Then generate static HTML:

```bash
node colvmn/static-gen.js
```

### Sequential navigation — `nextSectionLink`

Opt a page into a bottom-of-page footer link by setting `nextSectionLink: true` in its `_index.md` frontmatter (or `"nextSectionLink": true` in `_index.json`):

```markdown
---
nextSectionLink: true
---

# My Page
```

The footer renders a link to the next sibling page, taken from the next entry after this page in the parent's `ContentCards` items list. The link text uses the sibling's `title` (either the parent's per-item override, or the sibling's own `_index.json` / `_index.md` title). If this page is the last sibling, the footer falls back to an up-link to the parent.

The flag is opt-in per page — pages without it render no footer.

### Columns on wide screens — `maxColumns`

On a wide screen, a page's titled sections are set in columns: two from 1200px, three from 1860px and four from 2500px, given enough sections and subsections to fill them. A section's heading always starts a column with its first subsection; a long section may continue in the next column between its subsections, which then line up with the text beside them. Everything else (the intro, contents, cards, tables, untitled text, the footer) spans them, and up to four cards sit in one row (five where the page has three or more columns) underneath. Narrower screens and print show the usual single column.

It's on for every page. To cap it, set `maxColumns` (1 to 4) on a page, or in `colvmn.json` for the whole site; a page's own setting wins. `maxColumns: 1` keeps a page in one column.

### Collapsed sections — `{.collapsed}`

Mark a section's heading to have it start closed; clicking the heading opens it, and its plus mark turns to a minus:

```markdown
## Details {.collapsed}
```

In `_index.json`, set `"collapsed": true` on a top-level `ContentText` entry. A link to the section opens it. Without JavaScript, and in print, it shows open. AI review pages use it for their Details.

### Slideshows — `{.slideshow}`

Mark consecutive images to show them as one slideshow that fades between them:

```markdown
![Light cycles](images/light-cycles.jpg){.slideshow}
![The maze](images/maze.jpg){.slideshow}
```

Below the image are previous and next buttons and a count. Arrow keys, swipes and trackpad swipes move between images, and a click enlarges one.

Two options, as classes on any of the images:

- `.autoplay` advances by itself every few seconds while on screen, pausing while you hover or interact.
- `.no-controls` hides the buttons and count.
- `.inset` sets the images in a frame pressed into the page: a paper mat with an inner shadow, and a fine rule around the picture.

`![Light cycles](images/light-cycles.jpg){.slideshow .autoplay .no-controls}` makes a hands-off slideshow.

In `_index.json`, use a `ContentSlideshow` block:

```json
{ "type": "ContentSlideshow", "autoplay": true, "controls": false, "inset": true,
  "images": [{ "src": "images/light-cycles.jpg", "alt": "Light cycles" }, { "src": "images/maze.jpg", "alt": "The maze" }] }
``` Without JavaScript, and in print, the images are stacked.

### Zoomable images — `colvmn-zoomable-image`

Give any image the class `colvmn-zoomable-image` to make it click-to-enlarge. Clicking the image (or focusing it and pressing Enter) opens a full-viewport overlay; clicking the overlay or pressing Escape closes it.

In markdown, use a Pandoc-style attribute list after the image:

```markdown
![Architecture diagram](images/arch.svg){.colvmn-zoomable-image}
```

The attribute list also accepts `#id` and `key=value` pairs, e.g. `{.colvmn-zoomable-image width=480}`. In raw HTML (or a `ContentText` body) just add the class: `<img class="colvmn-zoomable-image" src="…" alt="…">`.

It's progressive enhancement — the image renders normally without JavaScript, and `layout/Lightbox.js` attaches the zoom behavior at runtime.

### Optional site config — `colvmn.json`

At the site root:

```json
{
  "siteUrl": "https://example.com/",
  "title": "My Site",
  "analytics": {
    "cloudflare": { "token": "0123456789abcdef0123456789abcdef" }
  }
}
```

`siteUrl` (when set and not `/`) enables canonical-URL tags and absolute sitemap entries. The older name `llms-config.json` is still read if `colvmn.json` is absent.

A site without its own `colvmn.json` uses the nearest one in a folder above it, taking only `analytics` and `siteUrl` (extended by the folder path). This is how a nested site — e.g. a submodule's docs served inside a larger site — gets the enclosing site's analytics and URLs. Giving a site its own `colvmn.json` stops the upward search.

#### What the llms files leave out — `llmsExclude` and `llms: false`

`llms.txt` and `llms-full.txt` include every page unless told otherwise. Pages left out stay in the sitemap and are still generated; only the llms files skip them.

- A page sets `llms: false` in its frontmatter (or `"llms": false` in `_index.json`) to leave out itself and everything under it.
- A site lists folders in `colvmn.json`: `"llmsExclude": ["_unused", "drafts/old"]`. A name without `/` matches a folder of that name at any depth; one with `/` matches that path from the site root, and everything under it.

#### Hidden pages — `unlisted`

`"unlisted": ["projects/old-draft"]` in `colvmn.json` keeps those folders' pages out of `sitemap.xml`, `llms.txt` and `llms-full.txt`. Patterns match as in `llmsExclude`. The pages are still generated; remove a page's card from its parent's `_index.json` to drop it from navigation, and leave the folder out of the deploy if it should not be served at all.

#### Build stamp — `buildStamp`

`"buildStamp": true` adds a line like `Site build: My Site · 2026-11-12 · 3c23b7b` to the top of `llms.txt` and `llms-full.txt`, and as an HTML comment at the bottom of the root page (in its source, not shown on the page). It names the last commit that changed a page the llms files include, so rebuilding without such a change, or committing only generated output or excluded pages, leaves it as it was. Uncommitted edits don't count until they're committed. Nothing is written outside a git repo.

`buildStamp`, `llmsExclude` and `aiReviews` belong to a site's own `colvmn.json`; a nested site doesn't inherit them.

#### AI reviews — `aiReviews`

AI models review a page's folder and everything below it, produced and rendered by colvmn. A page opts in with `aiReviews: true` in its frontmatter (or `"aiReviews": true` in its `_index.json`); the root is just another page that may opt in. The site needs this setting and at least one API key:

```json
"aiReviews": {
  "folder": "AI Reviews",
  "homeCard": true
}
```

Each opted-in page's reviews live in its own `<folder>` subfolder (`docs/Guide/AI Reviews/Claude/`, …), and the page gets a footer link to them, **AI reviews →**. Opting in isn't inherited. A review of the root is made from the site's `llms-full.txt`; a review of any other page from `<page>/llms-full.txt`, which the build writes with only that folder's pages and, with `buildStamp`, its own stamp (the last commit that touched a page in it). Every reviews folder is left out of every llms file and build stamp, so no review reads another.

With it, the update runner adds a job of its own (no `_update.md` needed). Once a month (`schedule`, default `monthly`), it first has Claude, with web search, choose each provider's latest top model from the IDs that provider's API lists (once per run, shared by every page, recorded in `<folder>/_models/models.json` at the root; a provider it can't choose for is skipped, never guessed), then, page by page, sends each model whose review is out of date (that page's content, the model or the prompt changed) the prompt with that page's `llms-full.txt` attached and commits its answer as written. `node colvmn/update/ai/reviews.js --models` runs only the choice; `--only <provider>` reviews with one provider; `--scope docs/Guide` reviews one page (`.` for the root). The keys are the providers' standard ones, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` and `XAI_API_KEY`, from the environment or `_credentials/NAME.secret.txt` (which must be in `.gitignore`: colvmn won't read a value file git could commit, and the build fails while one exists), and colvmn describes them itself so any job can list them; `keys` (e.g. `{ "Claude": "CLAUDE_REVIEW_KEY" }`) gives the reviews keys of their own, to keep their spending apart. A provider without a key is skipped and shown as not reviewed yet.

The prompt: a page's own `prompt` (frontmatter), else the site's `prompt`, else the default: for the root, read the site's `llms-full.txt` and evaluate the site's subject; for another page, read its `llms-full.txt` and evaluate that section. colvmn adds lines asking for the build stamp and a one-sentence verdict, which it reads from the answer. Other settings: `providers` (default the four; another is `{ "name", "company", "app", "ask" }` and is shown but not produced; `{ "name": "Claude", "model": "<id>" }` pins a model), `homeCard` (a card for the root's reviews on the root page, when the root opts in), `schedule` (default `monthly`), and `keys`. `about` is no longer used: each review's Details show its prompt.

A reviews page is written with default text the first time; edit it as you like, and an `## Author's note` after a review is kept until that review is replaced. A review page's frontmatter: `modelName`, `model`, `reviewed`, `summary` (the verdict, shown on its card), `stamp` (the build stamp the model quoted), `share` (optional link to an original conversation), `inputHash`. Replaced reviews move to `<provider>/archive/<date>/`. `{date}` in a reviews page's subtitle becomes its latest review's date.

### Scheduled updates

A folder with an `_update.md` refreshes its own page: on a schedule or on push, when what it `watch`es changed, by running a Node script or a Claude prompt. The runner checks what the job changed, rebuilds the pages, and commits it or opens a pull request:

```bash
node colvmn/update.js --dry-run       # what is due, and what each job would be given
node colvmn/update.js --push          # run the due jobs, push, open PRs
```

Credentials are described in `_credentials/` folders and given only to the script jobs that list them. `update/workflow-template.yml` runs it from GitHub Actions. The full guide is the "Scheduled Updates" page (`scheduled-updates/_index.md`).

### Nested sites

A folder below the site root with its own `colvmn/` engine (typically a submodule's docs) is a nested site. The root build regenerates its pages too, rendering them as their own site (own root page, header and brand), so the output matches what the nested site's own build produces. Because those pages load their own engine's CSS and JS, the root build fails if a nested site's colvmn version differs from the root's — update the nested copy, then rerun. A nested site's pages are in the sitemap but not in the enclosing site's `llms.txt`, `llms-full.txt` or build stamp: the nested site has llms files of its own.

#### Analytics

The `analytics` section adds tracking snippets to every generated page — one key per provider, using the ID from that provider's dashboard. Several can be enabled at once:

| Provider | Config |
|---|---|
| Cloudflare Web Analytics | `"cloudflare": { "token": "…" }` — the `token` in Cloudflare's snippet |
| Google Analytics 4 | `"googleAnalytics": { "measurementId": "G-…" }` |
| Plausible | `"plausible": { "domain": "example.com" }` (optional `src` for self-hosted or a custom script URL) |
| GoatCounter | `"goatcounter": { "code": "mysite" }` (or `endpoint` for a self-hosted count URL) |
| Fathom | `"fathom": { "siteId": "…" }` |
| Umami | `"umami": { "websiteId": "<uuid>" }` (optional `src` for self-hosted) |
| Simple Analytics | `"simpleAnalytics": {}` |
| Anything else | `"custom": { "head": "<raw html>", "body": "<raw html>" }` |

- Snippets are written between `<!-- colvmn:analytics -->` markers and rebuilt on every regen, so changing or removing a provider takes effect cleanly.
- A page opts out with `analytics: false` in its frontmatter / `_index.json`.
- A browser opts out by opening any page with `?analytics=off` (e.g. the site owner's own browsers, so their visits aren't counted). It's remembered in that browser's `localStorage` for the whole site; `?analytics=on` undoes it. The snippets sit in an inert `<template>` and a small inline loader starts them only for browsers that haven't opted out.
- IDs are validated before being written into HTML, and an unknown provider or field fails the build. `custom` is passed through as-is.
- These IDs are public — they ship in every page — so `colvmn.json` is safe to commit. Never put an account id or API token here.
- Google Analytics sets cookies, which may require a consent banner for EU visitors; colvmn doesn't provide one. The other built-in providers are cookie-free.

## License

MIT.
