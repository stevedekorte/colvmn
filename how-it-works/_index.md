---
title: How It Works
---

Each page is a directory containing two files: a thin `index.html` shell and an `_index.md` or `_index.json` holding the content. Nesting these directories builds the site tree — a `ContentCards` block auto-populates from subfolders, back-links point at the parent page, and `topTitle` is inherited down the tree. (See Authoring for the content formats and block types.)

At build time, `static-gen.js` walks the site tree, finds every directory that has both `index.html` and an `_index.md` (or `_index.json`), runs the layout engine against each one, and writes the rendered HTML back into `index.html`. At runtime, `layout.js` does the same thing in the browser, replacing the pre-rendered content with a freshly rendered copy. The two paths produce identical output.

The generator also writes:

- `sitemap.xml` — every page URL
- `llms.txt` — a curated index for LLM agents
- `llms-full.txt` — the full site content as markdown, one page per section

When the optional `llms-config.json` at the site root sets `siteUrl`, canonical `<link>` tags and absolute sitemap entries are emitted.

## Generating

Regenerate the static HTML, `sitemap.xml`, `llms.txt`, and `llms-full.txt` from the site root:

```
node colvmn/static-gen.js
```

colvmn can also render its own pages without being a submodule of itself, by passing the site root explicitly:

```
node static-gen.js .
```

In that case the root `index.html` references `./style.css` and `./layout/layout.js` directly instead of `/colvmn/...`.
