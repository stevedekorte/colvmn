/**
 * AI Reviews: a section of pages in which AI models review the site, set up
 * by colvmn.json's "aiReviews". Used by static-gen.js only (not bundled for
 * the browser, which doesn't re-render statically generated pages).
 *
 *   "aiReviews": {
 *       "folder": "AI Reviews",
 *       "prompt": "Read https://example.com/llms.txt and ... Evaluate ...",
 *       "providers": ["Claude", "ChatGPT", "Gemini", "Grok"],
 *       "about": "How These Are Made"
 *   }
 *
 * "about" (optional) names a subfolder whose page explains how the reviews
 * are made; it gets a card at the end of the grid and the prompt. Without
 * it, the prompt goes on the section page.
 *
 * Each provider is a subfolder of the section. Known providers get their
 * company, app and prefilled-prompt link from PROVIDERS below; others, or
 * overrides, are given as objects: { "name": "Mistral", "company": "Mistral AI",
 * "app": "https://chat.mistral.ai", "ask": "https://chat.mistral.ai/chat?q={prompt}" }.
 *
 * A review is a provider folder's _index.md, written by the site's own
 * reviews job. colvmn knows nothing about producing one; it reads these
 * frontmatter fields:
 *
 *   modelName   "Claude Opus 5.5"      model       "claude-opus-5-5"
 *   reviewed    "2026-11-20"           stamp       the build stamp the model quoted
 *   share       a link to the original conversation, when there is one
 *
 * and the body is the review, published as written. A hand-written
 * "## Author's note" section after it is shown like any other section.
 * Replaced reviews live in <provider>/archive/<date>/, newest first.
 *
 * What the generator adds:
 *   section page   one card per provider (model and date) and the about
 *                  card, then the page's own text (and the prompt, when
 *                  there's no about page)
 *   about page     its own text, then the prompt
 *   review pages   a header: model, date, quoted stamp, "Ask <provider>
 *                  yourself", the original conversation, and the not-an-
 *                  endorsement line; then "Earlier reviews"
 *   archive pages  the same header, and a link to the current review
 *
 * The whole section is left out of llms.txt and llms-full.txt (and so out of
 * the build stamp): later reviews mustn't read earlier ones.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseMarkdown } from "./MarkdownParser.js";
import { ContentCards } from "./ContentCards.js";

const PROVIDERS = {
    Claude: { company: "Anthropic", app: "https://claude.ai/new", ask: "https://claude.ai/new?q={prompt}" },
    ChatGPT: { company: "OpenAI", app: "https://chatgpt.com/", ask: "https://chatgpt.com/?q={prompt}" },
    Gemini: { company: "Google", app: "https://gemini.google.com/app" },
    Grok: { company: "xAI", app: "https://grok.com/", ask: "https://grok.com/?q={prompt}" },
};

const ARCHIVE = "archive";

export class AiReviews {

    /** The section for a site's config, or null when it has none. */
    static forConfig (siteRoot, config) {
        if (!config || !config.folder || !config.prompt) {
            return null;
        }
        return new AiReviews(siteRoot, config);
    }

    constructor (siteRoot, config) {
        this.siteRoot = siteRoot;
        this.folder = config.folder.replace(/\/+$/, "");
        this.prompt = config.prompt;
        this.about = config.about ? config.about.replace(/\/+$/, "") : null;
        this.providers = (config.providers || Object.keys(PROVIDERS)).map(p => {
            const own = typeof p === "string" ? { name: p } : p;
            return { company: own.name, ...PROVIDERS[own.name], ...own };
        });
    }

    sectionDir () {
        return join(this.siteRoot, this.folder);
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
        const content = json.content || [];
        if (role.kind === "section") {
            json.content = this.about ? [this.providerCards(), ...content] : [this.providerCards(), ...content, this.promptEntry()];
        } else if (role.kind === "about") {
            json.content = [...content, this.promptEntry()];
        } else if (role.kind === "review") {
            const earlier = this.archiveEntry(role.provider);
            json.content = [this.headerEntry(role.provider, json, false), ...content, ...(earlier ? [earlier] : [])];
        } else if (role.kind === "archived") {
            json.content = [this.headerEntry(role.provider, json, true), ...content];
        }
    }

    // --- section page ---

    providerCards () {
        const items = this.providers.map(p => {
            const meta = this.reviewMeta(join(this.sectionDir(), p.name));
            if (!meta) {
                return { title: p.name, subtitle: "Not reviewed yet.", link: false };
            }
            return { title: p.name, folder: p.name, subtitle: escapeHtml(describeModelAndDate(meta)), arrow: "Read" };
        });
        const about = this.aboutCard();
        if (about) {
            items.push(about);
        }
        return { type: "ContentCards", items, columns: this.providers.length % 2 === 0 ? 2 : undefined };
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
            + `<blockquote class="review-prompt">${escapeHtml(this.prompt)}</blockquote>`
            + "<p>Answers vary with the account, plan and settings they're asked from.</p>";
        return { type: "ContentText", title: "The prompt", body };
    }

    // --- review pages ---

    headerEntry (provider, meta, archived) {
        const lines = [];
        lines.push(`<p class="review-model">${escapeHtml(describeModelAndDate(meta) || provider.name)}</p>`);
        lines.push(meta.stamp
            ? `<p class="review-stamp">Quoted build stamp: ${escapeHtml(meta.stamp)}</p>`
            : `<p class="review-stamp">${meta.reviewed ? "It didn't quote the site's build stamp." : ""}</p>`);
        const links = [];
        const ask = this.askLink(provider);
        if (ask) {
            const label = provider.ask ? `Ask ${provider.name} yourself` : `Open ${provider.name} and paste the prompt below`;
            links.push(`<a href="${escapeHtml(ask)}">${escapeHtml(label)} &rarr;</a>`);
        }
        if (meta.share) {
            links.push(`<a href="${escapeHtml(meta.share)}">View the original conversation &rarr;</a>`);
        }
        if (archived) {
            links.push(`<a href="../../index.html">The current review &rarr;</a>`);
        }
        if (links.length) {
            lines.push(`<p class="review-links">${links.join(" ")}</p>`);
        }
        if (!provider.ask && provider.app) {
            lines.push(`<blockquote class="review-prompt">${escapeHtml(this.prompt)}</blockquote>`);
        }
        if (meta.reviewed) {
            lines.push(`<p class="review-disclaimer">Generated by ${escapeHtml(meta.modelName || meta.model || provider.name)} on ${escapeHtml(meta.reviewed)}; not an endorsement by ${escapeHtml(provider.company)}.${archived ? " An earlier review, since replaced." : ""}</p>`);
        } else {
            lines.push("<p class=\"review-disclaimer\">Not reviewed yet.</p>");
        }
        return { type: "ContentText", body: `<div class="review-header">${lines.join("")}</div>` };
    }

    /** The prefilled-prompt link, or the app when there's no prefill. */
    askLink (provider) {
        if (provider.ask) {
            return provider.ask.replace("{prompt}", encodeURIComponent(this.prompt));
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

function escapeHtml (s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
