export function renderList (json, tag, depth) {
    const title = json.title || "";
    const items = json.items || [];

    function renderItems (itemList, listTag) {
        let html = `<${listTag}>`;
        for (const item of itemList) {
            if (typeof item === "string") {
                html += `<li>${item}</li>`;
            } else {
                html += `<li>${item.text || ""}`;
                if (Array.isArray(item.content)) {
                    for (const child of item.content) {
                        const node = ContentBase.fromJson(child, depth + 1);
                        html += node.computeHtml();
                    }
                }
                html += "</li>";
            }
        }
        html += `</${listTag}>`;
        return html;
    }

    const listHtml = renderItems(items, tag);

    if (depth >= 1) {
        let html = '<div class="section">';
        if (title) html += `<div class="section-head">${title}</div>`;
        html += `<div class="section-body">${listHtml}</div>`;
        html += "</div>";
        return html;
    }

    let html = "";
    if (title) html += `<h2>${title}</h2>`;
    html += `<div class="section"><div class="section-body">${listHtml}</div></div>`;
    return html;
}


export class ContentBase {
    static typeMap = {};

    static _fetchFn = null;
    static _prefetchCache = null;

    static setFetchFn (fn) {
        ContentBase._fetchFn = fn;
    }

    /**
     * Browser-side: load the inline prefetch cache (if any) injected by
     * static-gen into <script id="colvmn-prefetch">. Returned object maps
     * URL → { ok, status, content }. Memoised after first read.
     */
    static _loadPrefetchCache () {
        if (ContentBase._prefetchCache !== null) return ContentBase._prefetchCache;
        if (typeof document === "undefined") {
            ContentBase._prefetchCache = {};
            return ContentBase._prefetchCache;
        }
        const el = document.getElementById("colvmn-prefetch");
        if (el && el.textContent.trim()) {
            try {
                ContentBase._prefetchCache = JSON.parse(el.textContent);
            } catch (e) {
                ContentBase._prefetchCache = {};
            }
        } else {
            ContentBase._prefetchCache = {};
        }
        return ContentBase._prefetchCache;
    }

    static asyncFetch (url) {
        if (ContentBase._fetchFn) {
            return ContentBase._fetchFn(url);
        }
        const cache = ContentBase._loadPrefetchCache();
        if (url in cache) {
            const entry = cache[url];
            if (entry.ok) {
                const text = entry.content;
                return Promise.resolve({
                    ok: true,
                    status: entry.status || 200,
                    json: async () => JSON.parse(text),
                    text: async () => text,
                });
            }
            return Promise.resolve({
                ok: false,
                status: entry.status || 404,
            });
        }
        return fetch(url, { cache: "no-store" });
    }

    // A row of 5 completion dots (filled-of-5), shown under a card/page title.
    // `completion` is 0-5; absent/invalid → "".
    static completionDots (completion) {
        if (completion === undefined || completion === null || completion === "") return "";
        const n = Math.max(0, Math.min(5, Math.round(Number(completion))));
        if (Number.isNaN(n)) return "";
        let dots = "";
        for (let i = 0; i < 5; i++) {
            dots += `<span class="cd${i < n ? " on" : ""}"></span>`;
        }
        return `<div class="completion-dots" title="${n}/5 complete">${dots}</div>`;
    }

    constructor () {
        this.json = null;
        this.children = [];
        this.depth = 0;
    }

    setJson (json, depth = 0) {
        this.json = json;
        this.depth = depth;
        if (Array.isArray(json.content)) {
            this.children = json.content.map(c => ContentBase.fromJson(c, depth + 1));
        }
    }

    async resolve () {
        for (const child of this.children) {
            await child.resolve();
        }
    }

    // Build-time markup. This is what actually ships: static-gen calls it under
    // Node and writes the result into index.html. Override to emit a block's HTML.
    computeHtml () {
        return this.children.map(c => c.computeHtml()).join("");
    }

    // Runtime behavior hook. Runs in the browser after the (already-built) HTML is
    // present — see PageIndex.render and colvmn/CLAUDE.md ("Rendering model").
    // Override to attach event listeners / interactivity for a block. Default is a
    // no-op pass-through to children.
    postRender (page) {
        this.children.forEach(c => c.postRender(page));
    }

    static fromJson (json, depth = 0) {
        const Cls = ContentBase.typeMap[json.type];
        if (!Cls) {
            console.warn(`Unknown content type: ${json.type}`);
            return new ContentBase();
        }
        const instance = new Cls();
        instance.setJson(json, depth);
        return instance;
    }
}
