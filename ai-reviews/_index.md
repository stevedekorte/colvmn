---
title: AI Reviews
subtitle: Claude, ChatGPT, Gemini and Grok review your site, or any section of it, from its own docs. One setting per page and an API key; colvmn does the rest.
---

AI Reviews show what the major AI models make of a page and everything below it: the whole site from its root page, or one guide, tutorial or reference from its own page. Each model's first answer is published unedited, redone when those docs or the model change. colvmn finds the models, asks them, writes the pages and keeps the history.

## Setting it up

Add this to the site's `colvmn.json`:

```json
"aiReviews": {
    "folder": "AI Reviews",
    "homeCard": true
}
```

Then opt in each page whose folder should be reviewed, in its frontmatter (or `"aiReviews": true` in its `_index.json`):

```markdown
---
aiReviews: true
---
```

The root is a page like any other: opt it in to review the whole site. Opting in isn't inherited, so a page under an opted-in page has reviews of its own only if it opts in too. Reviewing a folder of one short page says little; the root and a few big sections are where reviews are worth having.

Give the runner at least one key, as an environment variable or in `_credentials/NAME.secret.txt` at the site root, and run it on a schedule (see [Scheduled Updates](../scheduled-updates/index.html)). The keys are the providers' standard ones, shared with any other job that uses them:

| Key | Provider |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google |
| `XAI_API_KEY` | xAI |

To keep the reviews' spending apart, give them keys of their own with `keys`: `"keys": { "Claude": "CLAUDE_REVIEW_KEY" }`. A provider without a key is skipped, and its card says it hasn't been reviewed yet.

Turn on `buildStamp` too: each review then quotes the stamp of the docs it read, which shows which version it reviewed, and whether it read them at all.

## What gets reviewed

A page's reviews cover its folder and everything below it, minus every reviews folder in it:

- **The root** is reviewed from the site's `llms-full.txt`.
- **Any other page** is reviewed from its own `llms-full.txt`, which the build writes next to it with only that folder's pages. With `buildStamp`, it carries its own stamp: the last commit that touched a page in that folder.

A parent's review therefore also covers its opted-in children's content. Each review says which build it read, and each page's reviews sit with that page.

## What happens

The runner adds a job of its own. It runs once a month (set `schedule` to change that), and each run has two steps:

1. **Choose the models.** For each provider with a key, colvmn reads the provider's model list from its API. Claude, with web search, then reads the providers' own announcements and chooses each one's newest, most capable model from that list. Names alone can't tell: they change shape between generations (Gemini 4 is "Argon", "Carbon" and "Hydrogen"). Only an ID from the provider's own list is accepted, and a provider Claude can't choose for is skipped, never guessed. The choice is made once per run and shared by every page; it is recorded, with the page each choice is based on, in `AI Reviews/_models/models.json` at the site root. This needs the Claude key, and costs a few cents.
2. **Review, page by page.** A provider whose current review of a page was made from the same docs, model and prompt is skipped, so editing one guide re-reviews only that guide and the pages above it, and a month with no new docs and no new model costs only the model check. Otherwise its model is sent the prompt with that page's `llms-full.txt` attached, and its answer is published as written: the previous review moves to the archive and the new one is committed.

To check before paying for reviews, run the first step alone, one provider, or one page: `node colvmn/update/ai/reviews.js --models`, `--only Gemini`, or `--scope docs/Guide` (`.` for the root). Each review sends the whole of that page's `llms-full.txt`, so its cost grows with its docs: for about 200,000 tokens, roughly one to three dollars per model.

The first time, each reviews page is written with default text. Edit it as you like.

## The pages

- **The page itself.** A footer link to its reviews: **AI reviews →**.
- **The reviews page** (`<page>/AI Reviews/`). "AI reviews of this section's content on {date}", where `{date}` becomes the latest review's date. Then one card per model: its full name and its one-sentence verdict.
- **A review page.** The model, date and verdict, the review, then **Details**, closed until clicked: the model ID, the build stamp the model quoted, the exact prompt with a link that opens it in that model's own app, and a line saying it isn't an endorsement by the provider. Then earlier reviews.
- **The home page,** with `homeCard` and an opted-in root. A card for the root's reviews, added to the root page's last card grid.

Every reviews folder is left out of `llms.txt` and every `llms-full.txt`, so a model reviewing the site never reads earlier reviews.

## The prompt

A page's own `prompt` (in its frontmatter) comes first, then the site's `prompt` in `colvmn.json`, then a default:

- **The root** asks the model to read the site's `llms.txt` and the pages it links, ignore the AI Reviews, and evaluate the site's subject: what it is, its strengths, weaknesses and risks, who should and shouldn't use it, and how it compares to alternatives.
- **Any other page** asks it to read that page's `llms-full.txt` and evaluate that section the same way.

A section often deserves its own question: `prompt: Evaluate this guide: is it accurate, clear and complete, and who is it for?`

colvmn adds two lines asking the answer to begin with the build stamp the model saw and a verdict of at most 20 words. It reads both from the answer: the stamp shows which version of the docs was reviewed (and whether the model read them at all), and the verdict is the model's card text.

## Settings

On a page:

| Setting | Meaning |
| --- | --- |
| `aiReviews` | `true` has this page's folder reviewed. Not inherited. |
| `prompt` | This page's review prompt, before the two lines colvmn adds. |

In `colvmn.json`'s `aiReviews`:

| Setting | Meaning |
| --- | --- |
| `folder` | The reviews subfolder's name in each opted-in folder. The only one required. |
| `prompt` | The default prompt for every opted-in page. |
| `providers` | Default `["Claude", "ChatGPT", "Gemini", "Grok"]`. `{ "name": "Claude", "model": "<id>" }` pins a model instead of having it chosen. Another provider is `{ "name", "company", "app", "ask" }` (`ask` is a URL with `{prompt}`); it can be shown, not produced. |
| `homeCard` | `true` adds a card for the root's reviews to the root page. |
| `schedule` | How often the job runs: `monthly` by default, or `weekly`, `daily` or a cron string. A run with nothing new costs only the model check. |
| `keys` | A key name per provider, instead of its standard one: `{ "Claude": "CLAUDE_REVIEW_KEY" }`. |

`about` is no longer used, since each review's Details show its prompt. The build warns while it is set, and while no page opts in.

## Moving from a site-wide section

A site set up before reviews were per page has its section at `AI Reviews/` in the root, which is where the root's reviews now live. Add `aiReviews: true` to the root page; the reviews, archives and URLs stay where they are. If `colvmn.json` sets `about`, remove it and delete that page and its folder.

## Corrections

A review is never edited. To correct a fact, add an `## Author's note` section after it; it stays until that review is replaced. A review page's frontmatter also takes `share`, a link to the same prompt answered in the model's own app, shown as "View the original conversation".
