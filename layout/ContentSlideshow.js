import { ContentBase } from "./ContentBase.js";
import { slideshowHtml, slideshowMaxHeight } from "./MarkdownParser.js";
import { escapeAttr } from "./ContentImage.js";

// A slideshow in an _index.json page, the same one markdown builds from
// images marked {.slideshow}:
//   { "type": "ContentSlideshow", "autoplay": true, "controls": false, "inset": true,
//     "images": [{ "src": "images/a.jpg", "alt": "…", "caption": "…" }, …] }
// "autoplay" (default false) advances by itself; "controls": false hides the
// arrows and count; "inset" sets the images in a frame pressed into the page.
// An image's optional "caption" is shown under it. "maxHeight" ("70vh", or 600
// for pixels) caps how tall the images are shown. Behavior: layout/Slideshow.js.

export class ContentSlideshow extends ContentBase {
    computeHtml () {
        const images = this.json.images || [];
        if (images.length === 0) return "";
        const options = [this.json.autoplay ? "autoplay" : "", this.json.controls === false ? "no-controls" : "", this.json.inset ? "inset" : ""].filter(Boolean);
        const maxHeight = slideshowMaxHeight(this.json.maxHeight);
        const imgs = images.map((im, k) => `<img src="${escapeAttr(im.src)}" alt="${escapeAttr(im.alt)}"${im.caption ? ` title="${escapeAttr(im.caption)}"` : ""}${k === 0 && maxHeight ? ` max-height="${maxHeight}"` : ""} class="${["slideshow", ...(k === 0 ? options : [])].join(" ")}">`);
        let html = "";
        if (this.json.title) html += `<h2>${this.json.title}</h2>`;
        return html + slideshowHtml(imgs);
    }
}
