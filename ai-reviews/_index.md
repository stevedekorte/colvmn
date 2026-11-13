---
title: AI Reviews
subtitle: Claude, ChatGPT, Gemini and Grok review your site from its own docs. One setting and an API key; colvmn does the rest.
---

An AI Reviews section shows what the major AI models make of whatever your site is about: one page per model, its first answer published unedited, redone when your docs or the model change. colvmn finds the models, asks them, writes the pages and keeps the history.

## Setting it up

Add this to the site's `colvmn.json`:

```json
"aiReviews": {
    "folder": "AI Reviews",
    "about": "Review Process",
    "homeCard": true
}
```

Then give the runner at least one key, as an environment variable or in `_credentials/NAME.secret.txt` at the site root, and run it on a schedule (see [Scheduled Updates](../scheduled-updates/index.html)). The keys are the providers' standard ones, shared with any other job that uses them:

| Key | Provider |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google |
| `XAI_API_KEY` | xAI |

To keep the reviews' spending apart, give them keys of their own with `keys`: `"keys": { "Claude": "CLAUDE_REVIEW_KEY" }`. A provider without a key is skipped, and its card says it hasn't been reviewed yet.

## What happens

The runner adds a job of its own. It runs when `llms-full.txt` has changed, at most once every 30 days, and each run has two steps:

1. **Choose the models.** For each provider with a key, colvmn reads the provider's model list from its API. Claude, with web search, then reads the providers' own announcements and chooses each one's newest, most capable model from that list. Names alone can't tell: they change shape between generations (Gemini 4 is "Argon", "Carbon" and "Hydrogen"). Only an ID from the provider's own list is accepted, and a provider Claude can't choose for is skipped, never guessed. The choices, with the page each is based on, are recorded in `AI Reviews/_models/models.json`. This needs the Claude key, and costs a few cents.
2. **Review.** A provider whose current review was made from the same docs, model and prompt is skipped. Otherwise its model is sent the prompt with `llms-full.txt` attached, and its answer is published as written: the previous review moves to the archive and the new one is committed.

To check before paying for reviews, run the first step alone, or one provider: `node colvmn/update/ai/reviews.js --models`, or `--only Gemini`. Each review sends the whole of `llms-full.txt`, so its cost grows with your docs: for a site of about 200,000 tokens, roughly one to three dollars per model.

The first time, the section page and the about page are written with default text. Edit them as you like.

## The pages

- **The section page.** "AI reviews of this site's content on {date}", where `{date}` becomes the latest review's date. Then one card per model: its full name and its one-sentence verdict. Then a card for the about page.
- **A review page.** The model and date, a link that opens the same prompt in that model's own app, the review, then **Details**: the model ID, the build stamp the model quoted, the exact prompt, and a line saying it isn't an endorsement by the provider. Then earlier reviews.
- **The about page.** How the reviews are made, then the prompt.
- **The home page,** with `homeCard`. A card for the section, added to the root page's last card grid.

The whole section is left out of `llms.txt` and `llms-full.txt`, so a model reviewing the site never reads earlier reviews.

## The prompt

By default the prompt asks the model to read the site's `llms.txt` and the pages it links, ignore the AI Reviews section, and evaluate the site's subject: what it is, its strengths, weaknesses and risks, who should and shouldn't use it, and how it compares to alternatives. Set your own with `prompt`.

colvmn adds two lines asking the answer to begin with the build stamp the model saw and a verdict of at most 20 words. It reads both from the answer: the stamp shows which version of the docs was reviewed (and whether the model read them at all), and the verdict is the model's card text.

## Settings

| Setting | Meaning |
| --- | --- |
| `folder` | The section's folder. The only one required. |
| `prompt` | The review prompt, before the two lines colvmn adds. |
| `providers` | Default `["Claude", "ChatGPT", "Gemini", "Grok"]`. `{ "name": "Claude", "model": "<id>" }` pins a model instead of having it chosen. Another provider is `{ "name", "company", "app", "ask" }` (`ask` is a URL with `{prompt}`); it can be shown, not produced. |
| `about` | A subfolder explaining how the reviews are made. It gets the prompt and a card at the end of the grid. |
| `homeCard` | `true` adds a card for the section to the root page. |
| `every` | The least time between reviews: `30d` by default. |
| `keys` | A key name per provider, instead of its standard one: `{ "Claude": "CLAUDE_REVIEW_KEY" }`. |

## Corrections

A review is never edited. To correct a fact, add an `## Author's note` section after it; it stays until that review is replaced. A review page's frontmatter also takes `share`, a link to the same prompt answered in the model's own app, shown as "View the original conversation".
