import { ContentBase } from "./ContentBase.js";
import { ContentCards } from "./ContentCards.js";

// Folder listings: cards built from what is in the page's own folder, so a
// folder of records (one subfolder per job, say, or a folder of PDFs) stays a
// folder on disk and its page lists whatever is in it.
//
// - ContentFolderCards: one card per subfolder that is a page (has _index.md
//   or _index.json), titled and subtitled from that page, like ContentCards.
// - ContentFileCards: one card per file, linking to the file, with its type
//   and size; images show a thumbnail.
//
// In _index.md they are turned on by frontmatter (MarkdownParser appends the
// blocks after the page's text): `folderCards: true` (or `newest-first`) and
// `fileCards: true`; `folderCardsTitle` / `fileCardsTitle` give them headings.
//
// The listing needs the filesystem, so it is made at build time: static-gen
// sets ContentBase.listDirFn for each page. In the browser the built markup is
// already on the page (see CLAUDE.md, "Rendering model"), so no listing is needed.

// Names never listed: the page's own files, hidden files, and _-prefixed files
// (notes and tools kept beside a page but not part of it).
function folderIsListed (name) {
    return !(name.startsWith(".") || name.startsWith("_") || name === "index.html");
}

function folderCompareNames (a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function folderEscapeHtml (s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function folderListDir () {
    const fn = ContentBase.listDirFn;
    if (!fn) return [];
    try {
        return await fn();
    } catch {
        return [];
    }
}

export class ContentFolderCards extends ContentCards {
    async resolve () {
        const entries = await folderListDir();
        const names = [];
        for (const e of entries) {
            if (!e.isDir || !folderIsListed(e.name) || !e.isPage) continue;
            if (Array.isArray(this.json.exclude) && this.json.exclude.includes(e.name)) continue;
            names.push(e.name);
        }
        names.sort(folderCompareNames);
        if (this.json.order === "newest-first" || this.json.order === "desc") names.reverse();
        const first = Array.isArray(this.json.first) ? this.json.first.filter(n => names.includes(n)) : [];
        if (first.length) names.splice(0, names.length, ...first, ...names.filter(n => !first.includes(n)));
        this.json = { ...this.json, items: names, listing: true };
        // `withFiles`: the folder's files share this grid, after the folders.
        if (this.json.withFiles) {
            const files = new ContentFileCards();
            files.setJson({ type: "ContentFileCards" });
            await files.resolve();
            this.extraCardsHtml = files.files.map(f => files.cardHtml(f));
            // In a table, each file is a row: its name (linked), then its type and size.
            this.extraRows = files.files.map(f => ({ title: folderEscapeHtml(f.title), href: f.href, link: true, lines: [f.detail] }));
        }
        await super.resolve();
    }
}

const FOLDER_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"]);
const FOLDER_TYPE_NAMES = {
    pdf: "PDF", jpg: "JPEG", jpeg: "JPEG", png: "PNG", gif: "GIF", webp: "WebP", svg: "SVG",
    txt: "Text", md: "Text", rtf: "Rich text", doc: "Word", docx: "Word", xls: "Excel", xlsx: "Excel",
    zip: "Zip archive", dwg: "AutoCAD drawing", obj: "3D model (OBJ)", skp: "SketchUp model",
    mov: "Video", mp4: "Video", json: "JSON",
};

// File types opened in a viewer page (viewers/<name>.html) rather than directly.
const FOLDER_VIEWERS = { obj: "model", dwg: "drawing", dxf: "drawing" };

export function folderFormatSize (bytes) {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class ContentFileCards extends ContentBase {
    constructor () {
        super();
        this.files = [];
    }

    async resolve () {
        const entries = await folderListDir();
        this.files = entries
            .filter(e => !e.isDir && folderIsListed(e.name))
            .sort((a, b) => folderCompareNames(a.name, b.name))
            .map(e => {
                const dot = e.name.lastIndexOf(".");
                const ext = dot > 0 ? e.name.slice(dot + 1).toLowerCase() : "";
                const title = dot > 0 ? e.name.slice(0, dot) : e.name;
                const type = FOLDER_TYPE_NAMES[ext] || (ext ? ext.toUpperCase() : "File");
                // Files a browser can't show itself open in one of the engine's viewers.
                const viewer = FOLDER_VIEWERS[ext];
                const viewerHref = viewer && ContentBase.viewerHrefFn ? ContentBase.viewerHrefFn(viewer, e.name) : null;
                return {
                    title,
                    href: viewerHref || encodeURIComponent(e.name),
                    arrow: viewerHref ? "View" : "Open",
                    detail: `${type} · ${folderFormatSize(e.size)}`,
                    image: FOLDER_IMAGE_EXTS.has(ext),
                    drawing: ext === "svg",
                };
            });
    }

    computeHtml () {
        if (!this.files.length) return "";
        let html = "";
        if (this.json.title) html += `<h2>${this.json.title}</h2>`;
        const colsClass = ContentBase.listingColumns(this.files.length) === 2 ? " cols-2" : "";
        html += `<div class="card-grid file-cards listing${colsClass}">`;
        for (const f of this.files) html += this.cardHtml(f);
        html += "</div>";
        return html;
    }

    cardHtml (f) {
        let html = `<a class="card file-card" href="${f.href}">`;
        if (f.image) html += `<img class="file-card-thumb${f.drawing ? " drawing" : ""}" src="${f.href}" alt="" loading="lazy">`;
        html += `<h3>${folderEscapeHtml(f.title)}</h3>`;
        html += `<p>${f.detail}</p>`;
        html += `<span class="arrow">${f.arrow} &rarr;</span>`;
        html += "</a>";
        return html;
    }
}
