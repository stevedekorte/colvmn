---
title: Quick Start
---

A two-page site in a few minutes: a home page, a child page, and a build that links them.

## 1. Add colvmn

In your site's git repository, add colvmn as a submodule:

```
git submodule add https://github.com/stevedekorte/colvmn.git colvmn
```

## 2. Make the home page

A page is a folder with two files: `_index.md`, which you write, and `index.html`, which the build writes. Start each `index.html` empty:

```
touch index.html
```

Then write `_index.md` beside it:

```markdown
---
topTitle: My Site
folderCards: true
---
# Welcome

A short tagline for the site.

## About

This site is built with colvmn.
```

`topTitle` is the site's name, shown on every page. A short first paragraph becomes the page's subtitle, and each `##` heading starts a section. `folderCards: true` lists the page's subfolders that are pages as cards, so the home page links to its child pages without you listing them.

## 3. Add a child page

```
mkdir guide
touch guide/index.html
```

and `guide/_index.md`:

```markdown
---
subtitle: How to use the site.
---
# Guide

## First steps

Edit a page's `_index.md`, then rebuild.
```

## 4. Build

From the site root:

```
node colvmn/static-gen.js
```

No npm install is needed. The build renders each page into its `index.html` and writes `sitemap.xml`, `llms.txt` and `llms-full.txt` at the root. Run it again after every edit.

## 5. Open it

Open `index.html` in a browser; no server is needed. The home page shows a **Guide** card with the guide's subtitle. Click it: the guide page has a back link to **Welcome**, and its brand, **My Site**, is inherited from the root. `llms-full.txt` holds both pages as text, for AI agents.

## Next

- [Authoring](../authoring/index.html): page settings, Markdown or JSON, and the content blocks (cards, tables, FAQs, timelines, images).
- [How It Works](../how-it-works/index.html): the build, the runtime, and the generated files.
- [Scheduled Updates](../scheduled-updates/index.html): pages that keep themselves current, by script or Claude prompt, committed directly or as a pull request.
