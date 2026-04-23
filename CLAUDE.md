# colvmn - Layout Engine

A minimal static-site layout engine. Pages are described by `_index.md` (with YAML frontmatter) or `_index.json`; the engine renders them to static HTML at build time and to live DOM in the browser.

## Key Rule

**Do not edit `index.html` files directly.** These are generated output. Edit the `_index.md` (or `_index.json`) source file instead, then regenerate:

```bash
node colvmn/static-gen.js
```

This walks the site tree and rewrites every `index.html`, plus `sitemap.xml`, `llms.txt`, and `llms-full.txt`.

## Structure

- `style.css` — base framework CSS (typography, page, cards, tables, timeline, hero, FAQ, mobile)
- `static-gen.js` — Node.js generator that walks the site tree and rewrites each `index.html`
- `layout/layout.js` — browser bootstrap (live rendering)
- `layout/PageIndex.js` — page-level builder
- `layout/ContentBase.js` — base class for content blocks
- `layout/Content*.js` — content block renderers (Text, Cards, Table, Image, Timeline, Toc, KeyValue, UnorderedList, OrderedList)
- `layout/MarkdownParser.js` — frontmatter + markdown to page JSON

## Markdown Features

The markdown parser supports:
- Standard markdown (headings, bold, italic, links, images, code blocks, lists)
- Tables (standard `| col | col |` pipe syntax)
- Raw HTML blocks (passed through as-is)
- YAML frontmatter for page metadata
