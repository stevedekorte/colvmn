---
modelName: Claude Fable 5.2
model: claude-fable-5-2
reviewed: 2026-11-13
summary: A small, well-guarded static-site engine for LLM-readable docs sites; promising for solo projects, unproven and narrow for anything larger.
stamp: colvmn · 2026-11-13 · b6b227c
inputHash: 1d62050aa13ded2a
---
# Claude

## What it is

colvmn is a small JavaScript layout engine for static sites, MIT-licensed and added to a site as a git submodule. Each page is a directory holding a thin `index.html` shell and a content file (`_index.md` or `_index.json`). A Node script renders the content into the shell at build time, and the same renderer runs again in the browser.

Three features sit on top of that core:

- **LLM outputs:** every build emits `llms.txt`, `llms-full.txt` and `sitemap.xml`.
- **Scheduled updates:** a runner refreshes pages on a schedule or on push, by running a script or a Claude prompt.
- **AI reviews:** Claude, ChatGPT, Gemini and Grok review opted-in pages from their docs, and the reviews are published unedited.

This review is the kind that last feature produces. It rests only on the docs, so it judges what they claim, not how the software behaves.

## Strengths

- **Simple model.** The directory tree is the site, with inherited titles, back-links and auto-populated cards. No framework or templating language is involved.
- **Content without JavaScript.** Pages are pre-rendered, readable from `file://`, and degrade sensibly (slideshows stack, collapsed sections open).
- **Thorough LLM support.** There are per-page and per-folder exclusions, per-folder `llms-full.txt` files, and a build stamp tying the text to a commit.
- **Careful automation guardrails.** The update runner has more safeguards than most hand-written CI jobs:
  - a `writes` allowlist, with any other change failing the run;
  - a hard dollar budget per prompt job;
  - no shell and no job credentials for prompt jobs;
  - a scan of changed files for credential values;
  - a clean working tree required, so a failed run is discarded exactly;
  - pull-request publishing by default.
- **Sound credential handling.** The build fails if a secret file could be committed, and error messages name the credential, never its value.
- **Transparent AI reviews.** Each review shows its prompt, model ID and quoted stamp, keeps an archive, and is corrected only by an appended author's note. Reviews are kept out of the llms files, so no model reads an earlier review.
- **Cost control.** Unchanged docs, model and prompt mean no re-review, and the docs give a rough price.

## Weaknesses and risks

- **Reviews are not independent.** Models see only the site's own docs, and the owner controls the prompt and which pages opt in. Readers may still take the cards as endorsements, since the disclaimer sits in a collapsed Details section.
- **Dependence on Claude.** Model selection for all providers and every prompt job require an Anthropic key.
- **Prompt injection is limited, not removed.** A prompt job reads the web and edits pages, so hostile content can still shape what it writes within `writes`. With `publish: direct`, that goes live unreviewed.
- **One open credential question.** The docs don't say whether prompt jobs can read `_credentials/*.secret.txt` files in the site root.
- **Source and output are mixed.** The build writes into the same `index.html` files authors create, and every page needs its own shell file.
- **Authoring limits.** A frontmatter `content` array replaces the Markdown body, so prose and structured blocks don't mix on one page. `ContentText` bodies are raw HTML.
- **Unexplained double render.** The browser replaces pre-rendered content with an identical copy. The docs don't say what this is for or how "identical output" is verified.
- **Distribution and platform.** It ships only as a submodule, and nested sites must match the root's version exactly. Templates cover GitHub Actions and macOS launchd only, and email goes only through Resend.
- **Documentation gaps.** The docs say nothing about theming, navigation beyond cards, search, feeds, syntax highlighting, i18n, a dev server, tests, releases or adoption. "Tiny" is never quantified.
- **A truncated page.** In the copy I read, Quick Start stops inside an unclosed code block. That is either an unfinished page or a fault in `llms-full.txt` generation.
- **Maintenance risk.** The repository sits under a personal GitHub account, and the docs show no sign of other maintainers or users.

## Who should use it

- Solo developers and small projects that want a docs or project site with little machinery.
- Authors who care about being readable by AI agents and crawlers.
- GitHub-hosted sites with pages that go stale (figures, generated references, competitor tables) and an owner comfortable with Node, git and API keys.

## Who shouldn't

- Large or multi-author sites that need themes, plugins, search, versioned docs or i18n.
- Blogs that need feeds, taxonomies or pagination, since none are documented.
- Non-technical authors.
- Organisations that can't accept AI-written content being published automatically, or that need vendor-neutral automation.

## Compared with alternatives

The docs make no comparisons, so this section draws on my general knowledge, not the source.

- **Hugo, Jekyll, Eleventy, Astro:** these offer templating, themes, separate output directories and large ecosystems. colvmn trades all of that for a fixed layout and near-zero configuration.
- **Docusaurus, MkDocs Material, VitePress:** these are much stronger on docs features such as search, sidebars and versioning. llms.txt output is typically a plugin there, where colvmn builds it in.
- **Hand-rolled GitHub Actions with an LLM agent:** this can do the same refresh work. colvmn's value is the packaged guardrails.
- **AI reviews:** I know of no mainstream equivalent. It is the most distinctive feature and the one that needs the most careful reading.
