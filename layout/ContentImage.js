import { ContentBase } from "./ContentBase.js";
import { IMAGE_OPTIONS } from "./MarkdownParser.js";

// One image in an _index.json page, with the same layout options markdown
// gives an image as classes in its attribute list:
//   { "type": "ContentImage", "src": "images/a.png", "alt": "…",
//     "size": "column", "align": "center", "zoomable": true, "width": 480 }
// "size": "natural" (default: its own pixel size, shrunk to fit), "fill" (the
// full width, scaled up if need be) or "column" (no wider than one column).
// "align": "center" (default), "left", "float-left" or "float-right" (text
// wraps beside it). "zoomable" makes it click-to-enlarge; "width" (pixels)
// shows it at that width at most. Styles: style.css, "Image layout options".

// Shared with ContentSlideshow.js (bundle.js joins the layout files into one scope, so a name is declared once).
export const escapeAttr = s => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const SIZES = ["natural", "fill", "column"];
const ALIGNS = ["center", "left", "float-left", "float-right"];

export class ContentImage extends ContentBase {
    computeHtml () {
        const j = this.json;
        const src = j.src || j.href;
        if (!src) return "";
        const classes = [];
        if (SIZES.includes(j.size)) classes.push(`colvmn-image-${j.size}`);
        if (ALIGNS.includes(j.align) && j.align !== "center") classes.push(`colvmn-image-${j.align}`);
        if (j.zoomable) classes.push("colvmn-zoomable-image");
        let attrs = `src="${escapeAttr(src)}" alt="${escapeAttr(j.alt)}"`;
        if (classes.length) attrs += ` class="${classes.join(" ")}"`;
        if (Number.isFinite(Number(j.width)) && j.width) attrs += ` width="${Number(j.width)}"`;
        let html = "";
        if (j.title) html += `<h2>${j.title}</h2>`;
        return html + `<div class="colvmn-image"><img ${attrs}></div>`;
    }
}
