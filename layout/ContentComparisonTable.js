import { ContentBase } from "./ContentBase.js";
import { slugify } from "./MarkdownParser.js";

function statusFor (value) {
    if (value === true) return "yes";
    if (value === false) return "no";
    if (typeof value === "string") {
        const v = value.toLowerCase();
        if (v === "partial") return "partial";
        if (v === "unclear") return "unclear";
        if (v.startsWith("yes")) return "yes";
        if (v.startsWith("no")) return "no";
    }
    return "no";
}

function shortSource (src) {
    const lower = src.toLowerCase();
    if (lower.startsWith("closed")) return "closed";
    if (lower.startsWith("source-available")) return "open*";
    if (lower.startsWith("open")) return "open";
    return src.split("(")[0].trim();
}

// Map an open/closed-source string to a dot status: open -> yes (solid),
// source-available -> partial (half), closed -> no (hollow).
function sourceStatus (src) {
    const lower = (src || "").toLowerCase();
    if (lower.startsWith("source-available")) return "partial";
    if (lower.startsWith("open")) return "yes";
    return "no";
}

function shortDate (date) {
    // Founded column shows just the year.
    const main = date.split("(")[0].split(";")[0];
    const m = main.match(/\b(?:19|20)\d{2}\b/);
    return m ? m[0] : main.trim();
}

function splitOnFirstParen (raw) {
    const p = raw.indexOf("(");
    const s = raw.indexOf(";");
    const cut = Math.min(p >= 0 ? p : Infinity, s >= 0 ? s : Infinity);
    if (cut === Infinity) return { main: raw, detail: "" };
    return { main: raw.slice(0, cut).trim(), detail: raw.slice(cut).trim() };
}

// Abbreviate large counts within free text: 1,000 -> 1K, 50,000 -> 50K,
// 1500000 -> 1.5M. Comma-grouped numbers are always treated as counts;
// bare 4-digit integers in the 1900-2099 range are left alone (years).
function abbreviateCounts (s) {
    return s.replace(/\d[\d,]*(?:\.\d+)?/g, m => {
        const hasComma = m.indexOf(",") >= 0;
        const n = parseFloat(m.replace(/,/g, ""));
        if (!isFinite(n) || n < 1000) return m;
        if (!hasComma && Number.isInteger(n) && n >= 1900 && n <= 2099) return m;
        const units = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
        for (const [base, suffix] of units) {
            if (Math.abs(n) >= base) {
                return (Math.round((n / base) * 10) / 10) + suffix;
            }
        }
        return m;
    });
}

// Parse a sortable numeric magnitude from a free-text count like
// "~150K (...)" or "~3M installs" -> 150000 / 3000000. Non-numeric values
// (e.g. "pre-launch") return 0.
function parseCount (s) {
    const main = (s || "").split("(")[0].split(";")[0];
    const m = main.match(/([\d,.]+)\s*([KMB])?/i);
    if (!m) return 0;
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (!isFinite(n)) return 0;
    const unit = (m[2] || "").toUpperCase();
    return n * (unit === "B" ? 1e9 : unit === "M" ? 1e6 : unit === "K" ? 1e3 : 1);
}

// Render a "main (detail)" value, optionally transforming the text first.
function renderMainDetail (raw, transform) {
    const t = transform || (x => x);
    const { main, detail } = splitOnFirstParen(raw);
    const mainHtml = escapeHtml(t(main));
    return detail
        ? `${mainHtml}<span class="comp-detail">${escapeHtml(t(detail))}</span>`
        : mainHtml;
}

let dotIdSeq = 0;
function nextDotId () {
    return "comp-n" + (++dotIdSeq).toString(36);
}

function escapeHtml (s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export class ContentComparisonTable extends ContentBase {
    constructor () {
        super();
        this.entities = [];
    }

    async resolve () {
        const items = this.json.items || this.json.competitors || [];
        const infoFile = this.json.infoFile || "_info.json";

        this.entities = await Promise.all(items.map(async (name) => {
            const encoded = name.split("/").map(s => encodeURIComponent(s)).join("/");
            try {
                const resp = await ContentBase.asyncFetch(`${encoded}/${infoFile}`);
                if (resp.ok) {
                    const info = await resp.json();
                    info._name = name;
                    return info;
                }
            } catch (e) {
                /* fall through */
            }
            return { _name: name, features: {} };
        }));

        // Optional sort of entities (rows). e.g.
        //   "sort": { "field": "guestimatedUserBase", "as": "count", "direction": "desc" }
        const sort = this.json.sort;
        if (sort && sort.field) {
            const dir = sort.direction === "asc" ? 1 : -1;
            const val = c => sort.as === "count"
                ? parseCount(c[sort.field])
                : (c[sort.field] || "");
            this.entities.sort((a, b) => {
                const av = val(a), bv = val(b);
                return av < bv ? -dir : av > bv ? dir : 0;
            });
        }

        await super.resolve();
    }

    isUniversal (key) {
        return this.entities.every(c => {
            const f = c.features && c.features[key];
            return f && f.value === true;
        });
    }

    cellHtml (feature) {
        if (!feature) feature = { value: false };
        const status = statusFor(feature.value);
        let html = `<span class="comp-dot comp-dot-${status}"></span>`;
        if (feature.summary) {
            const id = nextDotId();
            html += `<br><span class="comp-summary" data-toggle="${id}">${escapeHtml(feature.summary)}</span>`;
            if (feature.notes) {
                html += `<div id="${id}" class="comp-notes">${escapeHtml(feature.notes)}</div>`;
            }
        } else if (feature.notes) {
            const id = nextDotId();
            html += `<div id="${id}" class="comp-notes">${escapeHtml(feature.notes)}</div>`;
        }
        return html;
    }

    computeHtml () {
        const title = this.json.title || "";
        const entities = this.entities;
        const featureRows = this.json.featureRows || [];
        const universalFeatures = this.json.universalFeatures || [];
        const entitiesLabel = this.json.itemsLabel || this.json.competitorsLabel || "Competitors";

        if (!entities.length) return "";

        // Per-cell value formatters, selectable per info column via `format`.
        const formatters = {
            link: v => `<a class="comp-arrow" href="${escapeHtml(v)}">&rarr;</a>`,
            date: v => escapeHtml(shortDate(v)),
            source: v => escapeHtml(shortSource(v)),
            detail: v => renderMainDetail(v),
            count: v => renderMainDetail(v, abbreviateCounts),
            sourceDot: v => `<span class="comp-dot comp-dot-${sourceStatus(v)}"></span>`,
            plain: v => escapeHtml(v)
        };

        // Info table columns (one per attribute; entities are rows). Defaults
        // preserve the product/competitor layout; any site can override via
        // an `infoRows` array of { label, field, format } in the JSON.
        const defaultInfoRows = [
            { label: "Website", field: "website", format: "link" },
            { label: "Founded", field: "creationDate", format: "date" },
            { label: "Users", field: "guestimatedUserBase", format: "count" },
            { label: "License", field: "openOrClosedSource", format: "source" }
        ];
        const infoRowDefs = this.json.infoRows || defaultInfoRows;
        const infoRows = infoRowDefs.map(def => ({
            label: def.label,
            render: c => {
                const v = c[def.field];
                if (v === undefined || v === null || v === "") return "";
                return (formatters[def.format] || formatters.plain)(v);
            },
            // Full, untruncated value used as the cell's hover tooltip.
            rawValue: c => {
                const v = c[def.field];
                return (v === undefined || v === null) ? "" : String(v);
            }
        }));

        // Determine which features are universal across all entities
        const universalLabels = [];
        const skipKeys = new Set();
        for (const f of [...universalFeatures, ...featureRows]) {
            if (this.isUniversal(f.key)) {
                universalLabels.push(f.label);
                skipKeys.add(f.key);
            }
        }

        const displayFeatures = featureRows.filter(f => !skipKeys.has(f.key));

        // Single merged table: info columns then feature columns; entities are rows.
        let head = "<tr><th></th>";
        for (const r of infoRows) head += `<th>${escapeHtml(r.label)}</th>`;
        for (const f of displayFeatures) head += `<th>${escapeHtml(f.label)}</th>`;
        head += "</tr>";

        let body = "";
        for (const c of entities) {
            let row = `<tr><td>${escapeHtml(c._name)}</td>`;
            for (const r of infoRows) {
                const raw = r.rawValue(c);
                const titleAttr = raw ? ` title="${escapeHtml(raw)}"` : "";
                row += `<td${titleAttr}>${r.render(c)}</td>`;
            }
            for (const f of displayFeatures) {
                const feat = c.features ? c.features[f.key] : null;
                row += `<td>${this.cellHtml(feat)}</td>`;
            }
            body += row + "</tr>";
        }

        const universalNote = universalLabels.length
            ? `<p class="comp-universal-note">All ${escapeHtml(entitiesLabel.toLowerCase())} also support ${universalLabels.map(escapeHtml).join(" and ")}.</p>`
            : "";

        // The whole content type is wrapped in a .comp-table container so the
        // details toggle scope is local.
        const titleHtml = title
            ? `<h2 id="${slugify(title)}">${title}</h2>`
            : "";

        let html = titleHtml;
        html += '<div class="comp-table hide-details">';

        // Details toggle controls the whole table; sits in a toolbar row above it.
        html += '<div class="comp-section-head-row comp-toolbar">';
        html += '<label class="comp-toggle">';
        html += '<input type="checkbox" class="comp-details-toggle">';
        html += '<span class="comp-toggle-slider"></span>';
        html += '<span class="comp-toggle-label">Details</span>';
        html += "</label>";
        html += "</div>";

        html += '<div class="comp-table-wrap">';
        html += `<table class="comp-info-table comp-feature-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
        html += "</div>";
        html += universalNote;
        html += "</div>";

        return html;
    }

    postRender (page) {
        const root = page.querySelector(".comp-table");
        if (!root) return;

        // Per-summary toggle for notes
        root.querySelectorAll(".comp-summary[data-toggle]").forEach(el => {
            el.addEventListener("click", () => {
                const id = el.getAttribute("data-toggle");
                const target = root.querySelector(`#${CSS.escape(id)}`);
                if (target) target.classList.toggle("open");
            });
        });

        // Master details toggle
        const toggle = root.querySelector(".comp-details-toggle");
        if (toggle) {
            toggle.addEventListener("change", () => {
                root.classList.toggle("hide-details", !toggle.checked);
            });
        }

        // Click/tap a row to toggle its selection highlight. Clicks on a link
        // or a note-summary keep their own behavior and don't toggle the row.
        root.querySelectorAll(".comp-info-table tbody tr, .comp-feature-table tbody tr").forEach(tr => {
            tr.addEventListener("click", (e) => {
                if (e.target.closest("a, .comp-summary")) return;
                tr.classList.toggle("comp-row-selected");
            });
        });

        // Hide the label + content of any column that is only partially visible
        // at the scroll edges (clipped by the wrap edge, or sliding under the
        // sticky first column). The column keeps its width so layout is stable.
        const wrap = root.querySelector(".comp-table-wrap");
        const table = wrap && wrap.querySelector("table");
        if (wrap && table && table.tHead && table.tBodies[0]) {
            const headCells = Array.from(table.tHead.rows[0].cells);
            const bodyRows = Array.from(table.tBodies[0].rows);
            const eps = 1;
            const updateObscured = () => {
                const wrapRect = wrap.getBoundingClientRect();
                const stickyW = headCells[0] ? headCells[0].getBoundingClientRect().width : 0;
                const leftBound = wrapRect.left + stickyW;
                headCells.forEach((th, i) => {
                    if (i === 0) return; // sticky column is always visible
                    const r = th.getBoundingClientRect();
                    const obscured = r.left < leftBound - eps || r.right > wrapRect.right + eps;
                    th.classList.toggle("comp-col-hidden", obscured);
                    bodyRows.forEach(row => {
                        const cell = row.cells[i];
                        if (cell) cell.classList.toggle("comp-col-hidden", obscured);
                    });
                });
            };
            let scheduled = false;
            const onScroll = () => {
                if (scheduled) return;
                scheduled = true;
                requestAnimationFrame(() => { scheduled = false; updateObscured(); });
            };
            wrap.addEventListener("scroll", onScroll, { passive: true });
            window.addEventListener("resize", onScroll);
            if (toggle) toggle.addEventListener("change", onScroll);
            updateObscured();
            requestAnimationFrame(updateObscured);
        }

        super.postRender(page);
    }
}
