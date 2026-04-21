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

### Optional site config — `llms-config.json`

At the site root:

```json
{
  "siteUrl": "https://example.com/",
  "title": "My Site"
}
```

`siteUrl` (when set and not `/`) enables canonical-URL tags and absolute sitemap entries.

## License

MIT.
