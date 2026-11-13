/**
 * AI Reviews: a section of pages in which AI models review the site, set up
 * by colvmn.json's "aiReviews". colvmn both produces the reviews (a built-in
 * update job, see update/ai/reviews.js) and renders them (here, from static-gen.js;
 * not bundled for the browser, which doesn't re-render built pages).
 *
 *   "aiReviews": {
 *       "folder": "AI Reviews",
 *       "prompt": "Read https://example.com/llms.txt and ... Evaluate ...",
 *       "providers": ["Claude", "ChatGPT", "Gemini", "Grok"],
 *       "about": "Review Process",
 *       "homeCard": true,
 *       "every": "30d",
 *       "keys": { "Claude": "CLAUDE_REVIEW_KEY" }
 *   }
 *
 * Only "folder" is needed. "prompt" defaults to one built from the site's
 * siteUrl and name; colvmn adds the answer format to it (ANSWER_FORMAT),
 * because it reads the quoted build stamp and the verdict from the answer.
 * "about" names a subfolder whose page explains how the reviews are made: it
 * gets a card at the end of the grid and the prompt (without it, the prompt
 * goes on the section page). "homeCard" adds a card for the section to the
 * site's root page. "every" is the least time between reviews (default 30d).
 * Each provider's key is its standard name (ANTHROPIC_API_KEY, OPENAI_API_KEY,
 * GEMINI_API_KEY, XAI_API_KEY), shared with any other job that uses it;
 * "keys" names a separate one, to keep the reviews' spending apart.
 *
 * Each provider is a subfolder of the section. The four built in have their
 * company, app, prefilled-prompt link and standard API key name below; another is
 * given as { "name", "company", "app", "ask" } and can be shown but not
 * produced. A provider entry may pin a model: { "name": "Claude",
 * "model": "<API model ID>" }.
 *
 * A review is a provider folder's _index.md, frontmatter:
 *
 *   modelName   the full model name     model       the API model ID
 *   reviewed    the date                stamp       the build stamp the model quoted
 *   summary     the model's own one-sentence verdict, shown on its card
 *   share       a link to the original conversation, when there is one
 *   inputHash   what the review was made from (docs, model, prompt)
 *
 * and the body is the review, published as written. A hand-written
 * "## Author's note" section after it is shown like any other section.
 * Replaced reviews live in <provider>/archive/<date>/, newest first.
 *
 * What the generator adds:
 *   section page   {date} in its subtitle becomes the latest review's date;
 *                  one card per provider (model name and its verdict) and the
 *                  about card, then the page's own text (and the prompt, when
 *                  there's no about page)
 *   about page     its own text, then the prompt
 *   review pages   a header: model, date, "Ask <provider> yourself" and the
 *                  original conversation; after the review, "Details" (model
 *                  ID, quoted stamp, the prompt, the not-an-endorsement line);
 *                  then "Earlier reviews"
 *   archive pages  the same header, and a link to the current review
 *   root page      with homeCard, a card for the section
 *
 * The whole section is left out of llms.txt and llms-full.txt (and so out of
 * the build stamp): later reviews mustn't read earlier ones.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseMarkdown } from "./MarkdownParser.js";
import { ContentCards } from "./ContentCards.js";

export const PROVIDERS = {
    Claude: { company: "Anthropic", app: "https://claude.ai/new", ask: "https://claude.ai/new?q={prompt}", key: "ANTHROPIC_API_KEY" },
    ChatGPT: { company: "OpenAI", app: "https://chatgpt.com/", ask: "https://chatgpt.com/?q={prompt}", key: "OPENAI_API_KEY" },
    Gemini: { company: "Google", app: "https://gemini.google.com/app", key: "GEMINI_API_KEY" },
    Grok: { company: "xAI", app: "https://grok.com/", ask: "https://grok.com/?q={prompt}", key: "XAI_API_KEY" },
};

/** Added to every prompt: colvmn reads these two lines from the answer. */
export const ANSWER_FORMAT = "Start your answer with these two lines:\n"
    + "Build stamp: <the site build stamp you saw, quoted exactly, or \"none\">\n"
    + "Verdict: <your verdict in one sentence of at most 20 words>\n"
    + "Then write the review in Markdown.";

export const ARCHIVE = "archive";
export const MODELS_FOLDER = "_models";
const DEFAULT_EVERY = "30d";

export class AiReviews {

    /** The section for a site's config, or null when it has none. */
    static forConfig (siteRoot, config, site = {}) {
        if (!config || !config.folder) {
            return null;
        }
        return new AiReviews(siteRoot, config, site);
    }

    /** The section for the site whose root this is, from its own colvmn.json, or null. */
    static forSiteRoot (siteRoot) {
        const path = join(siteRoot, "colvmn.json");
        if (!existsSync(path)) {
            return null;
        }
        const json = JSON.parse(readFileSync(path, "utf-8"));
        return AiReviews.forConfig(siteRoot, json.aiReviews, { siteUrl: json.siteUrl, title: siteTitle(siteRoot) });
    }

    /**
     * @param {string} siteRoot
     * @param {Object} config - colvmn.json's aiReviews
     * @param {{ siteUrl?: string, title?: string }} site - for the default prompt
     */
    constructor (siteRoot, config, site = {}) {
        this.siteRoot = siteRoot;
        this.folder = config.folder.replace(/\/+$/, "");
        this.prompt = config.prompt || defaultPrompt(this.folder, site);
        this.homeCard = config.homeCard === true;
        this.every = config.every || DEFAULT_EVERY;
        this.about = config.about ? config.about.replace(/\/+$/, "") : null;
        const keys = config.keys || {};
        this.providers = (config.providers || Object.keys(PROVIDERS)).map(p => {
            const own = typeof p === "string" ? { name: p } : p;
            const provider = { company: own.name, ...PROVIDERS[own.name], ...own };
            if (keys[provider.name] && PROVIDERS[provider.name]) {
                provider.key = keys[provider.name];
            }
            return provider;
        });
    }

    sectionDir () {
        return join(this.siteRoot, this.folder);
    }

    /** The prompt as sent and shown: the site's, then the answer format. */
    fullPrompt () {
        return `${this.prompt}\n\n${ANSWER_FORMAT}`;
    }

    /** The providers colvmn can produce reviews for (an API adapter and a key name). */
    producible () {
        return this.providers.filter(p => p.key);
    }

    modelsPath () {
        return join(this.sectionDir(), MODELS_FOLDER, "models.json");
    }

    /** A home-page card for the section, added to the root page's last card grid (mutates json). */
    decorateHome (json) {
        const meta = this.pageMeta(this.sectionDir());
        if (!this.homeCard || !meta) {
            return;
        }
        const content = json.content || (json.content = []);
        let cards = [...content].reverse().find(c => c.type === "ContentCards");
        if (!cards) {
            cards = { type: "ContentCards", items: [] };
            content.push(cards);
        }
        cards.items = cards.items || [];
        const linked = cards.items.some(i => (typeof i === "string" ? i : i.folder) === this.folder);
        if (!linked) {
            cards.items.push({
                title: escapeHtml(meta.title || this.folder),
                folder: this.folder,
                subtitle: meta.cardSubtitle || "What AI models make of this site.",
                arrow: "Read"
            });
        }
    }

    /** A page folder's parsed _index.md, or null when it isn't a page. */
    pageMeta (dir) {
        const path = join(dir, "_index.md");
        if (!existsSync(path) || !existsSync(join(dir, "index.html"))) {
            return null;
        }
        return parseMarkdown(readFileSync(path, "utf-8"));
    }

    /** Whether a page folder is in the section (so out of the llms files). */
    contains (pageDir) {
        const dir = this.sectionDir();
        return pageDir === dir || pageDir.startsWith(dir + sep);
    }

    /** What a page folder is within the section: { kind, provider, archived }. */
    roleOf (pageDir) {
        const parts = relative(this.sectionDir(), pageDir).split(sep).filter(Boolean);
        if (parts.length === 0) {
            return { kind: "section" };
        }
        if (parts.length === 1 && parts[0] === this.about) {
            return { kind: "about" };
        }
        const provider = this.providers.find(p => p.name === parts[0]);
        if (!provider) {
            return { kind: "other" };
        }
        if (parts.length === 1) {
            return { kind: "review", provider };
        }
        if (parts.length === 3 && parts[1] === ARCHIVE) {
            return { kind: "archived", provider, date: parts[2] };
        }
        return { kind: "other" };
    }

    /** The content entries to add to a section page's json (mutates json.content). */
    decorate (pageDir, json) {
        const role = this.roleOf(pageDir);
        if (role.kind === "review" || role.kind === "archived") {
            this.demoteSubtitle(json);
        }
        const content = json.content || [];
        if (role.kind === "section") {
            json.subtitle = this.fillDate(json.subtitle);
            json.content = this.about ? [this.providerCards(), ...content] : [this.providerCards(), ...content, this.promptEntry()];
        } else if (role.kind === "about") {
            json.content = [...content, this.promptEntry()];
        } else if (role.kind === "review") {
            const earlier = this.archiveEntry(role.provider);
            const details = this.detailsEntry(role.provider, json);
            json.content = [this.headerEntry(role.provider, json, false), ...content, ...[details, earlier].filter(Boolean)];
        } else if (role.kind === "archived") {
            const details = this.detailsEntry(role.provider, json);
            json.content = [this.headerEntry(role.provider, json, true), ...content, ...(details ? [details] : [])];
        }
    }

    /**
     * The markdown parser makes a short first paragraph the page's intro,
     * which would put the review's opening above its header. On a review it
     * goes back into the review, under the header.
     */
    demoteSubtitle (json) {
        if (json.subtitle) {
            json.content = [{ type: "ContentText", body: `<p>${json.subtitle}</p>` }, ...(json.content || [])];
            delete json.subtitle;
        }
    }

    // --- section page ---

    providerCards () {
        const items = this.providers.map(p => {
            const meta = this.reviewMeta(join(this.sectionDir(), p.name));
            if (!meta) {
                return { title: p.name, subtitle: "Not reviewed yet.", link: false };
            }
            return {
                title: escapeHtml(meta.modelName || meta.model || p.name),
                subtitle: escapeHtml(meta.summary || ""),
                folder: p.name,
                arrow: "Read"
            };
        });
        const about = this.aboutCard();
        if (about) {
            items.push(about);
        }
        return { type: "ContentCards", items, columns: this.providers.length % 2 === 0 ? 2 : undefined };
    }

    /** A section subtitle with {date} as the latest review's date; without a review, " on {date}" (or "{date}") is dropped. */
    fillDate (text) {
        if (typeof text !== "string" || !text.includes("{date}")) {
            return text;
        }
        const dates = this.providers
            .map(p => this.reviewMeta(join(this.sectionDir(), p.name)))
            .filter(Boolean)
            .map(meta => String(meta.reviewed))
            .sort();
        const latest = dates[dates.length - 1];
        return latest ? text.replaceAll("{date}", escapeHtml(latest)) : text.replace(/\s*\bon \{date\}|\{date\}/g, "");
    }

    /** The card for the "how these are made" page, last in the grid; null without one. */
    aboutCard () {
        const dir = join(this.sectionDir(), this.about || "");
        if (!this.about || !existsSync(join(dir, "_index.md")) || !existsSync(join(dir, "index.html"))) {
            return null;
        }
        const meta = parseMarkdown(readFileSync(join(dir, "_index.md"), "utf-8"));
        return { title: meta.title || this.about, folder: this.about, subtitle: ContentCards.cardSubtitle(meta), arrow: "Read" };
    }

    promptEntry () {
        const body = "<p>Every model is given the same prompt. You can ask it yourself:</p>"
            + promptHtml(this.fullPrompt())
            + "<p>Answers vary with the account, plan and settings they're asked from.</p>";
        return { type: "ContentText", title: "The prompt", body };
    }

    // --- review pages ---

    /** The top of a review: model and date, the links, and whether it's been replaced. */
    headerEntry (provider, meta, archived) {
        const lines = [`<p class="review-model">${escapeHtml(describeModelAndDate(meta) || provider.name)}</p>`];
        if (meta.summary) {
            lines.push(`<p class="review-verdict">${escapeHtml(meta.summary)}</p>`);
        }
        if (!meta.reviewed) {
            lines.push("<p class=\"review-note\">Not reviewed yet.</p>");
        } else if (archived) {
            lines.push("<p class=\"review-note\">An earlier review, since replaced.</p>");
        }
        const links = [];
        const ask = this.askLink(provider);
        if (ask) {
            const label = provider.ask ? `Ask ${provider.name} yourself` : `Open ${provider.name} and paste the prompt (under Details)`;
            links.push(`<a href="${escapeHtml(ask)}">${escapeHtml(label)} &rarr;</a>`);
        }
        if (meta.share) {
            links.push(`<a href="${escapeHtml(meta.share)}">View the original conversation &rarr;</a>`);
        }
        if (archived) {
            links.push("<a href=\"../../index.html\">The current review &rarr;</a>");
        }
        if (links.length) {
            lines.push(`<p class="review-links">${links.join(" ")}</p>`);
        }
        return { type: "ContentText", body: `<div class="review-header">${lines.join("")}</div>` };
    }

    /** The bottom of a review: the model ID, the quoted stamp, the prompt, and the disclaimer. Null without a review. */
    detailsEntry (provider, meta) {
        if (!meta.reviewed) {
            return null;
        }
        const name = meta.modelName || meta.model || provider.name;
        const model = meta.model && meta.modelName ? `${meta.modelName} (${meta.model})` : name;
        const rows = [
            `<p>Model: ${escapeHtml(model)}</p>`,
            `<p>Reviewed: ${escapeHtml(meta.reviewed)}</p>`,
            `<p>${meta.stamp ? `Build stamp it quoted: ${escapeHtml(meta.stamp)}` : "It didn't quote the site's build stamp."}</p>`,
            `<p>The prompt:</p>${promptHtml(this.fullPrompt())}`,
            `<p>Generated by ${escapeHtml(name)} on ${escapeHtml(meta.reviewed)}; not an endorsement by ${escapeHtml(provider.company)}.</p>`
        ];
        return { type: "ContentText", title: "Details", body: `<div class="review-details">${rows.join("")}</div>` };
    }

    /** The prefilled-prompt link, or the app when there's no prefill. */
    askLink (provider) {
        if (provider.ask) {
            return provider.ask.replace("{prompt}", encodeURIComponent(this.fullPrompt()));
        }
        return provider.app || null;
    }

    archiveEntry (provider) {
        const dir = join(this.sectionDir(), provider.name, ARCHIVE);
        if (!existsSync(dir)) {
            return null;
        }
        const items = readdirSync(dir, { withFileTypes: true })
            .filter(e => e.isDirectory() && existsSync(join(dir, e.name, "index.html")))
            .map(e => e.name)
            .sort()
            .reverse()
            .map(date => {
                const meta = this.reviewMeta(join(dir, date)) || {};
                const href = `${ARCHIVE}/${encodeURIComponent(date)}/index.html`;
                return `<li><a href="${href}">${escapeHtml(describeModelAndDate(meta) || date)}</a></li>`;
            });
        return items.length ? { type: "ContentText", title: "Earlier reviews", body: `<ul>${items.join("")}</ul>` } : null;
    }

    /** A review folder's frontmatter and title, or null when it has no review. */
    reviewMeta (dir) {
        const path = join(dir, "_index.md");
        if (!existsSync(path) || !existsSync(join(dir, "index.html"))) {
            return null;
        }
        const json = parseMarkdown(readFileSync(path, "utf-8"));
        return json.reviewed ? json : null;
    }
}

function describeModelAndDate (meta) {
    const model = meta.modelName || meta.model;
    return [model, meta.reviewed].filter(Boolean).join(" · ");
}

/** The prompt as a quote, its lines kept. */
function promptHtml (prompt) {
    return `<blockquote class="review-prompt">${escapeHtml(prompt).split("\n").join("<br>")}</blockquote>`;
}

function defaultPrompt (folder, site) {
    const url = site.siteUrl && site.siteUrl !== "/" ? site.siteUrl.replace(/\/?$/, "/") : null;
    const name = site.title || "this site's subject";
    const read = url ? `Read ${url}llms.txt and the pages it links.` : "Read this site's llms.txt and the pages it links.";
    return `${read} Ignore the "${folder}" section. Evaluate ${name}: what it is, its strengths, its weaknesses and risks, who should and shouldn't use it, and how it compares to alternatives.`;
}

/** The site's name: its root page's topTitle or title. */
function siteTitle (siteRoot) {
    for (const name of ["_index.json", "_index.md"]) {
        const path = join(siteRoot, name);
        if (existsSync(path)) {
            const text = readFileSync(path, "utf-8");
            const json = name.endsWith(".json") ? JSON.parse(text) : parseMarkdown(text);
            return json.topTitle || json.title || null;
        }
    }
    return null;
}

export function escapeHtml (s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
