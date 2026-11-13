import { ContentBase } from "./ContentBase.js";
import { slideshowHtml } from "./MarkdownParser.js";

// A slideshow in an _index.json page, the same one markdown builds from
// images marked {.slideshow}:
//   { "type": "ContentSlideshow", "autoplay": true, "controls": false,
//     "images": [{ "src": "images/a.jpg", "alt": "…" }, …] }
// "autoplay" (default false) advances by itself; "controls": false hides the
// arrows and count. Behavior: layout/Slideshow.js.

const escapeAttr = s => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export class ContentSlideshow extends ContentBase {
    computeHtml () {
        const images = this.json.images || [];
        if (images.length === 0) return "";
        const options = [this.json.autoplay ? "autoplay" : "", this.json.controls === false ? "no-controls" : ""].filter(Boolean);
        const imgs = images.map((im, k) => `<img src="${escapeAttr(im.src)}" alt="${escapeAttr(im.alt)}" class="${["slideshow", ...(k === 0 ? options : [])].join(" ")}">`);
        let html = "";
        if (this.json.title) html += `<h2>${this.json.title}</h2>`;
        return html + slideshowHtml(imgs);
    }
}
