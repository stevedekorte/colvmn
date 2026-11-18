import { ContentBase } from "./ContentBase.js";
import { parseMarkdown, linkPhoneNumbers } from "./MarkdownParser.js";

export class ContentCards extends ContentBase {
    constructor () {
        super();
        this.resolvedItems = [];
    }

    static encodePath (path) {
        return path.split("/").map(s => encodeURIComponent(s)).join("/");
    }

    static cardSubtitle (meta) {
        if (meta.cardSubtitle) return meta.cardSubtitle;
        const s = meta.subtitle || "";
        const br = s.indexOf("<br");
        return br !== -1 ? s.slice(0, br) : s;
    }

    // A page's subtitle as lines (split at <br>), for listing tables.
    static subtitleLines (meta) {
        return String(meta.subtitle || "").split(/<br\s*\/?>/i).map(l => l.trim()).filter(Boolean);
    }

    async resolve () {
        const items = this.json.items || [];
        this.resolvedItems = [];

        const promises = items.map(async (item) => {
            if (typeof item === "string") {
                const folder = item;
                const encoded = ContentCards.encodePath(folder);
                const displayName = folder.split("/").pop();
                let title = displayName;
                let subtitle = "";
                let lines = [];
                let meta = {};
                let completion;
                try {
                    const resp = await ContentBase.asyncFetch(`${encoded}/_index.json`);
                    if (resp.ok) {
                        meta = await resp.json();
                        title = meta.title || displayName;
                        subtitle = ContentCards.cardSubtitle(meta);
                        lines = ContentCards.subtitleLines(meta);
                        completion = meta.completion;
                    } else {
                        const mdResp = await ContentBase.asyncFetch(`${encoded}/_index.md`);
                        if (mdResp.ok) {
                            meta = parseMarkdown(await mdResp.text());
                            title = meta.title || displayName;
                            subtitle = ContentCards.cardSubtitle(meta);
                            lines = ContentCards.subtitleLines(meta);
                            completion = meta.completion;
                        }
                    }
                } catch (e) {
                    /* fall back to folder name */
                }
                let href = `${encoded}/index.html`;
                // If folder has path separators, add back link to current page
                if (folder.includes("/")) {
                    const depth = folder.split("/").length;
                    const backPath = "../".repeat(depth) + "index.html";
                    href += `?back=${encodeURIComponent(backPath)}`;
                }
                return {
                    folder,
                    title,
                    subtitle,
                    lines,
                    meta,
                    completion,
                    href,
                    arrow: "View",
                    link: true,
                };
            }

            const resolved = { ...item };
            resolved.title = item.title || item.folder || "";
            resolved.subtitle = item.subtitle || "";
            if (item.link === false) {
                resolved.link = false;
            } else if (item.href) {
                resolved.link = true;
            } else if (item.folder) {
                resolved.href = `${ContentCards.encodePath(item.folder)}/index.html`;
                resolved.link = true;
            } else {
                resolved.link = false;
            }
            resolved.arrow = item.arrow || "View";
            return resolved;
        });

        this.resolvedItems = await Promise.all(promises);
        await super.resolve();
    }

    // Listing table columns: `columns` is a list of "Header" or "Header=source",
    // where source is `title` (the page title, linked), `lineN` (line N of the
    // page's subtitle, split at <br>), or any other key in the page's frontmatter
    // (`date`, `type`, `summary`…). Bare headers take title, line1, line2… in
    // turn. With no columns given: Title, then one column per subtitle line.
    tableColumns (rows) {
        let specs = this.json.tableColumns;
        if (!Array.isArray(specs) || !specs.length) {
            const n = Math.max(1, ...rows.map(r => (r.lines || []).length));
            specs = ["Title", ...Array.from({ length: n }, () => "")];
        }
        return specs.map((spec, i) => {
            const eq = String(spec).lastIndexOf("=");
            const header = eq === -1 ? String(spec).trim() : String(spec).slice(0, eq).trim();
            const source = eq === -1 ? (i === 0 ? "title" : `line${i}`) : String(spec).slice(eq + 1).trim();
            return { header, source };
        });
    }

    // A row's value for a column source (see tableColumns), unlinked.
    static rowValue (row, source) {
        if (source.toLowerCase() === "title") return row.title || "";
        const m = /^line(\d+)$/i.exec(source);
        if (m) {
            const lines = row.lines || (row.subtitle ? [row.subtitle] : []);
            return lines[Number(m[1]) - 1] || "";
        }
        const v = row.meta ? row.meta[source] : undefined;
        return v === undefined || v === null ? "" : String(v);
    }

    tableCellHtml (row, source) {
        const value = ContentCards.rowValue(row, source);
        if (source.toLowerCase() === "title" && row.link) return `<a href="${row.href}">${value}</a>`;
        return linkPhoneNumbers(value);
    }

    computeTableHtml () {
        const rows = [...this.resolvedItems, ...(this.extraRows || [])];
        if (!rows.length) return "";
        const columns = this.tableColumns(rows);
        let html = "";
        if (this.json.title) html += `<h2>${this.json.title}</h2>`;
        html += '<div class="section listing-table"><div class="section-body"><table>';
        if (columns.some(c => c.header)) {
            html += "<thead><tr>" + columns.map(c => `<th>${c.header}</th>`).join("") + "</tr></thead>";
        }
        html += "<tbody>";
        for (const row of rows) {
            html += "<tr>" + columns.map(c => `<td class="listing-${c.source.toLowerCase().replace(/[^a-z0-9-]/g, "-")}">${this.tableCellHtml(row, c.source)}</td>`).join("") + "</tr>";
        }
        html += "</tbody></table></div></div>";
        return html;
    }

    computeHtml () {
        if (this.json.layout === "table") return this.computeTableHtml();
        const title = this.json.title || "";
        const items = this.resolvedItems;
        // Folder listings keep every card one column wide (no stretched last
        // card); 2, 4 or 8 cards share the width in two columns, others use three.
        const listing = this.json.listing === true;
        // Cards appended after the items in the same grid (a folder listing's file cards).
        const extra = this.extraCardsHtml || [];
        const columns = this.json.columns || (listing ? ContentBase.listingColumns(items.length + extra.length) : Math.min(items.length, 3));
        const colsClass = (columns === 2 ? " cols-2" : "") + (listing ? " listing" : "");

        let html = "";
        if (title) html += `<h2>${title}</h2>`;
        html += `<div class="card-grid${colsClass}">`;

        for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            const tag = item.link ? "a" : "div";
            const hrefAttr = item.link ? ` href="${item.href}"` : "";

            // Last item spans remaining columns if row is partial
            const isLast = idx === items.length - 1;
            const remainder = items.length % columns;
            const spanClass = (isLast && remainder > 0 && !listing) ? ` card-span-${columns - remainder + 1}` : "";

            html += `<${tag} class="card${spanClass}"${hrefAttr}>`;
            html += `<h3>${item.title}</h3>`;
            html += ContentBase.completionDots(item.completion);
            if (item.date) {
                html += `<div class="card-date">${item.date}</div>`;
            }
            if (item.subtitle) {
                html += `<p>${item.subtitle}</p>`;
            }
            if (item.link) {
                html += `<span class="arrow">${item.arrow} &rarr;</span>`;
            }
            html += `</${tag}>`;
        }
        html += extra.join("");

        html += "</div>";
        return html;
    }
}
