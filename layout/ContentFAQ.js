import { ContentBase } from "./ContentBase.js";
import { slugify } from "./MarkdownParser.js";

export class ContentFAQ extends ContentBase {
    computeHtml () {
        const title = this.json.title || "";
        const items = this.json.items || [];
        if (!items.length) return "";

        let html = "";
        if (title) html += `<h2 id="${slugify(title)}">${title}</h2>`;
        html += '<div class="section"><div class="section-body">';
        html += '<div class="faq">';
        for (const item of items) {
            const q = item.q || "";
            const a = item.a || "";
            html += "<div class=\"faq-item\">";
            html += `<div class="faq-q">${q}</div>`;
            html += `<div class="faq-a">${a}</div>`;
            html += "</div>";
        }
        html += "</div>";
        html += "</div></div>";
        return html;
    }
}
