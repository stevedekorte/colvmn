---
subtitle: Any page can opt in to AI reviews of its own folder and everything below it. Reviews live in the opted-in folder and are linked from the page's footer.
---
# Page AI Reviews

> Status (2026-11-13): **planned**, not started. Agreed with Steve 2026-11-13, including dropping the Review Process page. Builds on the site-level AI Reviews (`layout/AiReviews.js`, `update/ai/`), which it replaces: the site root becomes one opted-in page among others.

## Why

Today a site has one AI Reviews section, and every review covers the whole site. A big site has parts worth judging on their own: a guide, a tutorial, a reference. A review of the guide should read only the guide, and should sit with it.

## Opting in

A page opts in in its own `_index.md` frontmatter or `_index.json`:

```markdown
---
aiReviews: true
prompt: Evaluate this guide: is it accurate, clear and complete, and who is it for?
---
```

- **Opt-in per page, never inherited.** A page under an opted-in folder has no reviews of its own unless it opts in too. Reviewing every folder would cost every page times every model, and a review of one short page says little.
- **The scope is the page's folder and everything below it**, minus any reviews folders in it (its own and those of opted-in pages below it). A parent's review therefore also covers its opted-in children's content; that is intended, and each review page says what it covers ("Covers: docs/Guide and its 12 pages").
- **The root is just another opted-in page.** There is no site-level section any more.

## The prompt

- `prompt` on the page sets its own.
- Otherwise the site's default from `colvmn.json`, if it sets one.
- Otherwise the "Evaluate" prompt, with the page as its subject: *Read the attached pages. Evaluate {page title}: what it is, its strengths, its weaknesses and risks, who should and shouldn't use it, and how it compares to alternatives.* For the root this is today's prompt.

colvmn still adds its two lines asking for the build stamp and a verdict of at most 20 words.

## Where reviews live

In the opted-in folder, in a reserved subfolder (default `AI Reviews`):

```
docs/Guide/
    _index.md               aiReviews: true
    AI Reviews/
        _index.md           the scope's reviews page: one card per model
        Claude/             the current review, and archive/
        ChatGPT/
        Gemini/
        Grok/
```

A reviews folder is:

- **left out of review content**, for its own scope and for every scope above it, so no review reads another review;
- **left out of `llms.txt` and `llms-full.txt`**, as the section is today;
- **kept in the sitemap**: the reviews are real pages;
- **not listed in the page's cards**. Card grids list pages explicitly, so this needs nothing new.

The model choice (`_models/models.json`) is made once per run and shared by every scope, since the models are the same everywhere. It lives with the site, not with each scope.

## Content and build stamp per scope

- **Content:** `static-gen.js` already builds `llms-full.txt` from a list of pages. A scope's review is sent the same text built from just the pages in its scope.
- **Build stamp:** the last commit that touched a page in the scope, its reviews aside. Each scope's text starts with its own stamp, and the review quotes it.
- **Skipping:** as today, a review is redone only when its scope's content, its model or its prompt changes. Editing one guide re-reviews that scope and the scopes above it, and nothing else.

## The footer

Each opted-in page gets a footer link, **AI reviews of this section**, to its reviews folder. It goes in the existing page footer, beside the optional next-section link. Pages under it don't inherit the link.

`homeCard: true` stays as an option for the root page, which also gets a card for its reviews.

## Settings

Site-wide, in `colvmn.json`; everything per scope is in the page:

```json
"aiReviews": {
    "folder": "AI Reviews",
    "prompt": "…the default prompt for every opted-in page…",
    "providers": ["Claude", "ChatGPT", "Gemini", "Grok"],
    "schedule": "monthly",
    "keys": { "Claude": "CLAUDE_REVIEW_KEY" },
    "homeCard": true
}
```

| Setting | Where | Meaning |
| --- | --- | --- |
| `aiReviews` | page | `true` opts the page in. |
| `prompt` | page | This scope's prompt. |
| `folder` | site | The reserved subfolder's name. Default `AI Reviews`. |
| `prompt` | site | The default prompt for opted-in pages. |
| `providers`, `keys`, `schedule` | site | As today, shared by every scope. |
| `homeCard` | site | A card on the root page for the root's reviews. |

## The job

Still one built-in job, on the site's `schedule`. Each run chooses the models once, then goes through the opted-in pages, reviewing each scope whose content, model or prompt changed. One scope failing doesn't stop the others. Its `writes` are the reviews folders of the opted-in pages and the shared `_models` folder.

`reviews.js --only Gemini` keeps working; `--scope docs/Guide` limits a run to one scope.

## Moving existing sites

A site's current `aiReviews` with `folder: "AI Reviews"` at the root already matches the new layout: its section is the root's reviews folder. Moving means adding `aiReviews: true` to the root page; the reviews, archives and URLs stay where they are. colvmn should warn while a site has `aiReviews` in `colvmn.json` but no opted-in page.

**`about` goes away.** There is no Review Process page: each review's Details already show its exact prompt, the model and the build stamp. Moving a site deletes its about folder (e.g. `AI Reviews/Review Process/`) and its card; colvmn warns while `colvmn.json` still sets `about`.

## Not now

- **A site-wide index of reviewed sections.** The root's reviews page lists only the root's own reviews. Revisit if a site has enough reviewed sections to want one.
