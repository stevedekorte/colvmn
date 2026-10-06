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
- IDs are validated before being written into HTML, and an unknown provider or field fails the build. `custom` is passed through as-is.
- These IDs are public — they ship in every page — so `colvmn.json` is safe to commit. Never put an account id or API token here.
- Google Analytics sets cookies, which may require a consent banner for EU visitors; colvmn doesn't provide one. The other built-in providers are cookie-free.

## License

MIT.
