---
title: Authoring
---

Every page is a directory with two files: a thin `index.html` shell and a content file. The content file is either Markdown (`_index.md`) or JSON (`_index.json`) — both compile to the same page model, so the choice is about convenience, not capability.

## Markdown or JSON

Reach for `_index.md` on prose-heavy pages: YAML frontmatter for metadata, then ordinary markdown. The parser turns each `##` section into a `ContentText` block, so a markdown page is really just a convenient way to write a sequence of text blocks.

Reach for `_index.json` when a page needs structure markdown can't express — a card grid, a table, a two-column layout, or a specific mix of blocks. The same blocks are also available from a `content` array in markdown frontmatter, but that array *replaces* the markdown body rather than merging with it, so pick one authoring path per page.

## Page metadata

The same top-level keys work in markdown frontmatter and at the top of `_index.json`:

| Key | Purpose |
| --- | --- |
| `title` | The page heading. An empty string hides it — useful on the root, where only the brand shows. |
| `topTitle` | The brand shown at the top of every page; inherited down the directory tree when unset. |
| `subtitle` | A tagline rendered just under the header. |
| `content` | An array of content blocks. In JSON this is the body; in markdown frontmatter it replaces the body. |

## Content blocks

A block is an object with a `type` and its own fields. Any block may also carry a `content` array of nested child blocks.

| Block | Purpose |
| --- | --- |
| `ContentText` | Headings, paragraphs, prose sections |
| `ContentCards` | Grid of linked cards |
| `ContentTable` | Tables with headers, rows, and an optional note |
| `ContentUnorderedList` | Bulleted lists |
| `ContentOrderedList` | Numbered lists |
| `ContentKeyValue` | Key/value pairs |
| `ContentTimeline` | Dated entries on a horizontal timeline |
| `ContentFAQ` | Question/answer entries |
| `ContentToc` | Table of contents (usually generated automatically) |

Markdown pages produce `ContentText` blocks automatically; the rest are written in JSON or a frontmatter `content` array. Images use markdown image syntax — append `{.colvmn-zoomable-image}` to make one open in a lightbox.

### ContentText

The default block. `body` is raw HTML; markdown sections compile to exactly this.

```json
{
  "type": "ContentText",
  "title": "Overview",
  "body": "<p>Plain HTML, with <code>inline code</code> and <a href=\"#\">links</a>.</p>"
}
```

Set `"layout": "2 column"` to render the title as a left-hand label beside the body.

### ContentCards

A grid of cards. `columns` is optional (it defaults to the item count, capped at 3). Items come in three forms:

```json
{
  "type": "ContentCards",
  "columns": 2,
  "items": [
    "quick-start",
    { "folder": "how-it-works", "title": "How It Works", "subtitle": "The build and runtime model." },
    { "href": "https://github.com/stevedekorte/colvmn", "title": "GitHub", "subtitle": "Source code.", "arrow": "Visit" }
  ]
}
```

- A bare string is a **folder card**; its title and subtitle are read from that subfolder's own `_index`.
- An object with `folder` is a folder card with an explicit `title` and `subtitle`.
- An object with `href` is a **link card** to any URL; `arrow` sets the call-to-action label (it defaults to "View").

### ContentTable

```json
{
  "type": "ContentTable",
  "columns": ["Block", "Purpose"],
  "rows": [
    ["ContentText", "Prose sections"],
    ["ContentCards", "Grid of linked cards"]
  ],
  "note": "An optional italic footnote."
}
```

A cell may itself be an array of strings, which renders as a bulleted list inside the cell.

### Lists, key/value, FAQ, timeline

```json
{ "type": "ContentUnorderedList", "title": "Features", "items": ["First", "Second"] }
```
```json
{ "type": "ContentKeyValue", "items": { "License": "MIT", "Language": "JavaScript" } }
```
```json
{ "type": "ContentFAQ", "items": [ { "q": "Why colvmn?", "a": "Small, pre-rendered, no build framework." } ] }
```
```json
{ "type": "ContentTimeline", "items": [ { "date": "2024-01", "title": "First release", "href": "..." } ] }
```

## Adding a block type

New block types drop in by extending `ContentBase` and registering them in `layout.js` and `static-gen.js`.
