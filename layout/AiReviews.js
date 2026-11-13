/**
 * AI Reviews: pages in which AI models review a page's folder and everything
 * below it. A page opts in with "aiReviews": true (in its _index.json, or its
 * _index.md frontmatter); its reviews live in a subfolder of its own folder
 * and are linked from its footer. colvmn both produces the reviews (a
 * built-in update job, see update/ai/reviews.js) and renders them (here, from
 * static-gen.js; not bundled for the browser, which doesn't re-render built
 * pages). The site's settings are in colvmn.json:
 *
 *   "aiReviews": {
 *       "folder": "AI Reviews",
 *       "prompt": "...the default prompt for every opted-in page...",
 *       "providers": ["Claude", "ChatGPT", "Gemini", "Grok"],
 *       "homeCard": true,
 *       "schedule": "monthly",
 *       "keys": { "Claude": "CLAUDE_REVIEW_KEY" }
 *   }
 *
 * Only "folder" is needed: the name of the reviews subfolder in each
 * opted-in folder. A page's own "prompt" wins over the site's, which wins
 * over a default "Evaluate" prompt with the page as its subject; colvmn adds
 * the answer format to it (ANSWER_FORMAT), because it reads the quoted build
 * stamp and the verdict from the answer. "homeCard" adds a card for the
 * root's reviews to the root page, when the root opts in. "schedule" is how
 * often the reviews job runs: "monthly" (the default), "weekly", "daily" or a
 * cron string. Each run checks the models once and re-reviews only the
 * scopes whose content, model or prompt changed.
 * Each provider's key is its standard name (ANTHROPIC_API_KEY, OPENAI_API_KEY,
 * GEMINI_API_KEY, XAI_API_KEY), shared with any other job that uses it;
 * "keys" names a separate one, to keep the reviews' spending apart.
 *
 * A scope is an opted-in page's folder and everything below it, minus every
 * reviews folder in it. Its content is the site's llms-full.txt for the root,
 * and <scope>/llms-full.txt (built by static-gen.js) for any other page.
 *
 * Each provider is a subfolder of a scope's reviews folder. The four built in
 * have their company, app, prefilled-prompt link and standard API key name
 * below; another is given as { "name", "company", "app", "ask" } and can be
 * shown but not produced. A provider entry may pin a model: { "name":
 * "Claude", "model": "<API model ID>" }. The models chosen are shared by
 * every scope, recorded in <site>/<folder>/_models/models.json.
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
 *   reviews page   {date} in its subtitle becomes the latest review's date;
 *                  one card per provider (model name and its verdict), then
 *                  the page's own text
 *   review pages   a header: model, date and verdict; after the review,
 *                  "Details" (model ID, quoted stamp, the prompt, "Ask
 *                  <provider> yourself" and the original conversation, the
 *                  not-an-endorsement line); then "Earlier reviews"
 *   archive pages  the same header, and a link to the current review
 *   opted-in page  a footer link to its reviews
 *   root page      with homeCard, a card for the root's reviews
 *
 * Every reviews folder is left out of llms.txt and llms-full.txt (and so out
 * of the build stamps and every scope's content): no review reads another.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseMarkdown } from "./MarkdownParser.js";

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
const DEFAULT_SCHEDULE = "monthly";

export class AiReviews {

    /** The site's AI reviews for its config, or null when it has none. */
    static forConfig (siteRoot, config, site = {}) {
        if (!config || !config.folder) {
            return null;
        }
        return new AiReviews(siteRoot, config, site);
    }

    /** The site's AI reviews, from its own colvmn.json, or null. */
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
     * @param {{ siteUrl?: string, title?: string }} site - for the default prompts
     */
    constructor (siteRoot, config, site = {}) {
        this.siteRoot = siteRoot;
        this.site = site;
        this.folder = config.folder.replace(/\/+$/, "");
        this.prompt = config.prompt || null;
        this.homeCard = config.homeCard === true;
        this.schedule = config.schedule || DEFAULT_SCHEDULE;
        this.about = config.about || null;
        const keys = config.keys || {};
        this.providers = (config.providers || Object.keys(PROVIDERS)).map(p => {
            const own = typeof p === "string" ? { name: p } : p;
            const provider = { company: own.name, ...PROVIDERS[own.name], ...own };
            if (keys[provider.name] && PROVIDERS[provider.name]) {
                provider.key = keys[provider.name];
            }
            return provider;
        });
        this._scopes = null;
    }

    /** Where the shared model choice and the reviews job's state live: the root's reviews folder. */
    jobDir () {
        return join(this.siteRoot, this.folder);
    }

    modelsPath () {
        return join(this.jobDir(), MODELS_FOLDER, "models.json");
    }

    /** The providers colvmn can produce reviews for (an API adapter and a key name). */
    producible () {
        return this.providers.filter(p => p.key);
    }

    /** The opted-in pages, root first, as ReviewScopes. */
    scopes () {
        if (!this._scopes) {
            this._scopes = optedInPages(this.siteRoot, this.folder).map(({ dir, meta }) => new ReviewScope(this, dir, meta));
        }
        return this._scopes;
    }

    /** The scope whose page is this folder, or null. */
    scopeAt (pageDir) {
        return this.scopes().find(s => s.dir === pageDir) || null;
    }

    /** The scope whose reviews folder holds this page folder, or null. */
    scopeContaining (pageDir) {
        return this.scopes().find(s => s.contains(pageDir)) || null;
    }

    /** What a site's settings get wrong, as messages. */
    warnings () {
        const out = [];
        if (this.scopes().length === 0) {
            out.push("aiReviews: no page opts in, so nothing is reviewed. Add \"aiReviews\": true to the root page, or to any page whose folder should be reviewed.");
        }
        if (this.about) {
            out.push(`aiReviews: "about" is no longer used; each review's Details show its prompt. Remove it, and its page (${this.folder}/${this.about}).`);
        }
        return out;
    }

    /** With homeCard, a card for the root's reviews on the root page (mutates json). */
    decorateHome (json) {
        const root = this.scopeAt(this.siteRoot);
        if (this.homeCard && root) {
            root.decorateHome(json);
        }
    }
}

/** One opted-in page: its folder and everything below it, reviewed. */
export class ReviewScope {

    constructor (reviews, dir, meta) {
        this.reviews = reviews;
        this.dir = dir;
        this.meta = meta;
        this.isRoot = dir === reviews.siteRoot;
        /** The page's path from the site root, "/"-separated; "" for the root. */
        this.rel = relative(reviews.siteRoot, dir).split(sep).filter(Boolean).join("/");
        this.folder = reviews.folder;
        this.providers = reviews.providers;
        this.prompt = (typeof meta.prompt === "string" && meta.prompt.trim()) || reviews.prompt
            || (this.isRoot ? defaultPrompt(this.folder, reviews.site) : defaultScopePrompt(this, reviews.site));
    }

    /** The page's title, for prompts and messages. */
    title () {
        return this.meta.title || this.meta.topTitle || this.rel.split("/").pop() || this.reviews.site.title || "";
    }

    sectionDir () {
        return join(this.dir, this.folder);
    }

    /** What the reviews are made from: the site's llms-full.txt for the root, the scope's own otherwise. */
    llmsFullPath () {
        return join(this.dir, "llms-full.txt");
    }

    /** The prompt as sent and shown: the scope's, then the answer format. */
    fullPrompt () {
        return `${this.prompt}\n\n${ANSWER_FORMAT}`;
    }

    /** Whether a page folder is in this scope's reviews folder. */
    contains (pageDir) {
        const dir = this.sectionDir();
        return pageDir === dir || pageDir.startsWith(dir + sep);
    }

    /** The footer link from the page to its reviews, once its reviews page exists; else null. */
    footerLink () {
        if (!this.pageMeta(this.sectionDir())) {
            return null;
        }
        return {
            href: `${this.folder.split("/").map(encodeURIComponent).join("/")}/index.html`,
            label: "<strong>AI reviews →</strong>"
        };
    }

    /** A home-page card for the root's reviews, added to the root page's last card grid (mutates json). */
    decorateHome (json) {
        const meta = this.pageMeta(this.sectionDir());
        if (!meta) {
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

    /** What a page folder is within the reviews folder: { kind, provider, archived }. */
    roleOf (pageDir) {
        const parts = relative(this.sectionDir(), pageDir).split(sep).filter(Boolean);
        if (parts.length === 0) {
            return { kind: "section" };
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

    /** The content entries to add to a reviews page's json (mutates json.content). */
    decorate (pageDir, json) {
        const role = this.roleOf(pageDir);
        if (role.kind === "review" || role.kind === "archived") {
            this.demoteSubtitle(json);
        }
        const content = json.content || [];
        if (role.kind === "section") {
            json.subtitle = this.fillDate(json.subtitle);
            json.content = [this.providerCards(), ...content];
        } else if (role.kind === "review") {
            const earlier = this.archiveEntry(role.provider);
            const details = this.detailsEntry(role.provider, json);
            json.content = withContents([this.headerEntry(role.provider, json, false), ...content, ...[details, earlier].filter(Boolean)]);
        } else if (role.kind === "archived") {
            const details = this.detailsEntry(role.provider, json);
            json.content = withContents([this.headerEntry(role.provider, json, true), ...content, ...(details ? [details] : [])]);
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

    // --- reviews page ---

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
            lines.push("<p class=\"review-note\">An earlier review, since replaced. <a href=\"../../index.html\">The current review &rarr;</a></p>");
        }
        return { type: "ContentText", body: `<div class="review-header">${lines.join("")}</div>` };
    }

    /** The bottom of a review: the model ID, the quoted stamp, the prompt with the links to try it, and the disclaimer. Null without a review. */
    detailsEntry (provider, meta) {
        if (!meta.reviewed) {
            return null;
        }
        const name = meta.modelName || meta.model || provider.name;
        const model = meta.model && meta.modelName ? `${meta.modelName} (${meta.model})` : name;
        const links = [];
        const ask = this.askLink(provider);
        if (ask) {
            const label = provider.ask ? `Ask ${provider.name} yourself` : `Open ${provider.name} and paste the prompt`;
            links.push(`<a href="${escapeHtml(ask)}">${escapeHtml(label)} &rarr;</a>`);
        }
        if (meta.share) {
            links.push(`<a href="${escapeHtml(meta.share)}">View the original conversation &rarr;</a>`);
        }
        const rows = [
            `<p>Model: ${escapeHtml(model)}</p>`,
            `<p>Reviewed: ${escapeHtml(meta.reviewed)}</p>`,
            `<p>${meta.stamp ? `Build stamp it quoted: ${escapeHtml(meta.stamp)}` : "It didn't quote the site's build stamp."}</p>`,
            `<p>The prompt:</p>${promptHtml(this.fullPrompt())}`,
            ...(links.length ? [`<p class="review-links">${links.join(" ")}</p>`] : []),
            `<p>Generated by ${escapeHtml(name)} on ${escapeHtml(meta.reviewed)}; not an endorsement by ${escapeHtml(provider.company)}.</p>`
        ];
        return { type: "ContentText", title: "Details", collapsed: true, body: `<div class="review-details">${rows.join("")}</div>` };
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

/**
 * A review page's entries with a contents list after the header: every
 * titled section, the review's own and Details and Earlier reviews, in place
 * of the one the Markdown parser adds only for longer pages.
 */
function withContents (entries) {
    const [header, ...rest] = entries.filter(e => e.type !== "ContentToc");
    const titles = rest.filter(e => e.title).map(e => e.title);
    return titles.length >= 2 ? [header, { type: "ContentToc", items: titles }, ...rest] : [header, ...rest];
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

/** The default prompt for a page other than the root: its own llms-full.txt, and the page as the subject. */
function defaultScopePrompt (scope, site) {
    const url = site.siteUrl && site.siteUrl !== "/" ? site.siteUrl.replace(/\/?$/, "/") : null;
    const path = scope.rel.split("/").map(encodeURIComponent).join("/") + "/";
    const read = url ? `Read ${url}${path}llms-full.txt.` : "Read this section's llms-full.txt.";
    const of = site.title ? ` of ${site.title}` : "";
    return `${read} Evaluate the "${scope.title()}" section${of}: what it is, its strengths, its weaknesses and risks, who should and shouldn't use it, and how it compares to alternatives.`;
}

/** Folders never searched for pages (as in static-gen.js), and nested sites, which have their own colvmn.json. */
const SKIP_DIRS = new Set(["node_modules", "external-libs", "source", "build", "dist", "vendor", "npm-pkg", "webserver", "resources", "colvmn"]);

/** The pages that opt in ("aiReviews": true), root first, then by path; reviews folders aren't searched. */
function optedInPages (siteRoot, folder) {
    const found = [];
    const reviewsName = folder.split("/")[0];
    const walk = dir => {
        const meta = readPageSource(dir);
        if (meta && meta.aiReviews === true) {
            found.push({ dir, meta });
        }
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
            const sub = join(dir, e.name);
            if (e.name.startsWith(".") || SKIP_DIRS.has(e.name) || e.name === reviewsName || existsSync(join(sub, "colvmn.json"))) {
                continue;
            }
            walk(sub);
        }
    };
    walk(siteRoot);
    return found;
}

/** A folder's page source (_index.json or _index.md), parsed, or null. */
function readPageSource (dir) {
    try {
        if (existsSync(join(dir, "_index.json"))) {
            return JSON.parse(readFileSync(join(dir, "_index.json"), "utf-8"));
        }
        if (existsSync(join(dir, "_index.md"))) {
            return parseMarkdown(readFileSync(join(dir, "_index.md"), "utf-8"));
        }
    } catch {
        return null;
    }
    return null;
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
