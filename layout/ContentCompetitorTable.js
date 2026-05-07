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

function shortUrl (url) {
    return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

function shortSource (src) {
    const lower = src.toLowerCase();
    if (lower.startsWith("closed")) return "Closed source";
    if (lower.startsWith("source-available")) return "Source-available";
    if (lower.startsWith("open")) return "Open source";
    return src.split("(")[0].trim();
}

function shortDate (date) {
    return date.split("(")[0].split(";")[0].trim();
}

function splitOnFirstParen (raw) {
    const p = raw.indexOf("(");
    const s = raw.indexOf(";");
    const cut = Math.min(p >= 0 ? p : Infinity, s >= 0 ? s : Infinity);
    if (cut === Infinity) return { main: raw, detail: "" };
    return { main: raw.slice(0, cut).trim(), detail: raw.slice(cut).trim() };
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

export class ContentCompetitorTable extends ContentBase {
    constructor () {
        super();
        this.competitors = [];
    }

    async resolve () {
        const items = this.json.competitors || this.json.items || [];
        const infoFile = this.json.infoFile || "_info.json";

        this.competitors = await Promise.all(items.map(async (name) => {
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

        await super.resolve();
    }

    isUniversal (key) {
        return this.competitors.every(c => {
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
        const competitors = this.competitors;
        const featureRows = this.json.featureRows || [];
        const universalFeatures = this.json.universalFeatures || [];
        const competitorsLabel = this.json.competitorsLabel || "Competitors";
        const featuresLabel = this.json.featuresLabel || "Feature Comparison";

        if (!competitors.length) return "";

        let head = "<tr><th></th>";
        for (const c of competitors) head += `<th>${escapeHtml(c._name)}</th>`;
        head += "</tr>";

        // Info table rows
        const infoRows = [];
        infoRows.push({
            label: "Website",
            render: c => c.website
                ? `<a href="${escapeHtml(c.website)}">${escapeHtml(shortUrl(c.website))}</a>`
                : ""
        });
        infoRows.push({
            label: "Founded",
            render: c => c.creationDate ? escapeHtml(shortDate(c.creationDate)) : ""
        });
        infoRows.push({
            label: "Users",
            render: c => {
                if (!c.guestimatedUserBase) return "";
                const { main, detail } = splitOnFirstParen(c.guestimatedUserBase);
                if (detail) {
                    return `${escapeHtml(main)}<br><span class="comp-detail">${escapeHtml(detail)}</span>`;
                }
                return escapeHtml(main);
            }
        });
        infoRows.push({
            label: "License",
            render: c => c.openOrClosedSource ? escapeHtml(shortSource(c.openOrClosedSource)) : ""
        });

        let infoBody = "";
        for (const r of infoRows) {
            let row = `<tr><td>${r.label}</td>`;
            for (const c of competitors) row += `<td>${r.render(c)}</td>`;
            infoBody += row + "</tr>";
        }

        // Determine which features are universal across all competitors
        const universalLabels = [];
        const skipKeys = new Set();
        for (const f of [...universalFeatures, ...featureRows]) {
            if (this.isUniversal(f.key)) {
                universalLabels.push(f.label);
                skipKeys.add(f.key);
            }
        }

        const displayRows = featureRows.filter(f => !skipKeys.has(f.key));

        let featBody = "";
        for (const f of displayRows) {
            let row = `<tr><td>${escapeHtml(f.label)}</td>`;
            for (const c of competitors) {
                const feat = c.features ? c.features[f.key] : null;
                row += `<td>${this.cellHtml(feat)}</td>`;
            }
            featBody += row + "</tr>";
        }

        const universalNote = universalLabels.length
            ? `<p class="comp-universal-note">All competitors also support ${universalLabels.map(escapeHtml).join(" and ")}.</p>`
            : "";

        // Build sectioned output. The whole content type is wrapped in a
        // .comp-table container so the details toggle scope is local.
        const titleHtml = title
            ? `<h2 id="${slugify(title)}">${title}</h2>`
            : "";

        let html = titleHtml;
        html += '<div class="comp-table hide-details">';

        html += `<h3 class="comp-section-head">${escapeHtml(competitorsLabel)}</h3>`;
        html += '<div class="comp-table-wrap">';
        html += `<table class="comp-info-table"><thead>${head}</thead><tbody>${infoBody}</tbody></table>`;
        html += "</div>";

        html += '<div class="comp-section-head-row">';
        html += `<h3 class="comp-section-head">${escapeHtml(featuresLabel)}</h3>`;
        html += '<label class="comp-toggle">';
        html += '<input type="checkbox" class="comp-details-toggle">';
        html += '<span class="comp-toggle-slider"></span>';
        html += '<span class="comp-toggle-label">Details</span>';
        html += "</label>";
        html += "</div>";

        html += '<div class="comp-table-wrap">';
        html += `<table class="comp-feature-table"><thead>${head}</thead><tbody>${featBody}</tbody></table>`;
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

        super.postRender(page);
    }
}
