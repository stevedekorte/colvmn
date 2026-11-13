import { ContentBase } from "./ContentBase.js";
import { slugify } from "./MarkdownParser.js";

export class ContentText extends ContentBase {
    computeHtml () {
        const title = this.json.title || "";
        const body = this.json.body || "";
        const layout = this.json.layout;
        const childHtml = super.computeHtml();

        if (layout === "2 column") {
            let html = '<div class="section-two-col">';
            html += `<div class="section-label">${title}</div>`;
            html += '<div class="section-body">';
            if (body) html += body;
            html += "</div></div>";
            if (childHtml) html += childHtml;
            return html;
        }

        if (this.depth === 0 && title && this.json.collapsed) {
            return this.collapsedHtml(title, body, childHtml);
        }

        if (this.depth === 0) {
            let html = "";
            if (title) html += `<h2 id="${slugify(title)}">${title}</h2>`;
            if (body) {
                html += '<div class="section"><div class="section-body">';
                html += body;
                html += "</div></div>";
            }
            if (childHtml) html += childHtml;
            return html;
        }

        let html = '<div class="section">';
        if (title) html += `<div class="section-head">${title}</div>`;
        html += '<div class="section-body">';
        if (body) html += body;
        html += "</div></div>";
        if (childHtml) html += childHtml;
        return html;
    }

    /**
     * A top-level section ("collapsed": true, or "## Title {.collapsed}"),
     * shown closed: its heading is a button that opens it (layout/Collapsible.js).
     * Without JavaScript the noscript style shows it open.
     */
    collapsedHtml (title, body, childHtml) {
        const slug = slugify(title);
        const panel = `${slug}-panel`;
        let html = `<h2 id="${slug}" class="collapsible-head">`;
        html += `<button type="button" class="collapsible-toggle" aria-expanded="false" aria-controls="${panel}">`;
        html += `<span class="collapsible-title">${title}</span><span class="collapsible-mark" aria-hidden="true"></span>`;
        html += "</button></h2>";
        html += `<noscript><style>#${panel}{grid-template-rows:1fr;visibility:visible;opacity:1}#${slug} .collapsible-mark{display:none}</style></noscript>`;
        html += `<div id="${panel}" class="collapsible-panel"><div class="collapsible-inner">`;
        if (body) html += `<div class="section"><div class="section-body">${body}</div></div>`;
        if (childHtml) html += childHtml;
        html += "</div></div>";
        return html;
    }
}
