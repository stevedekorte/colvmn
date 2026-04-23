import { ContentBase } from "./ContentBase.js";
import { slugify } from "./MarkdownParser.js";

// Language-agnostic class/proto/struct documentation block.
//
// Schema:
//   { type: "ContentClassDoc",
//     sections: [
//       { name: "Slots",          // language-specific section label
//         categories: [
//           { name: "access",     // optional category label
//             members: [
//               { name, signature?, description? }
//             ]}]}]}
//
// Rendering degrades cleanly:
//   single unnamed section   → section heading hidden
//   single unnamed category  → category heading hidden
//   missing descriptions     → member shown as name + signature only
//
// Produces a nested <nav class="classdoc-toc"> followed by a flat
// <div class="classdoc"> content body. Slug IDs are stable across
// sections so in-page anchors survive schema evolution.

function memberSlug (sectionName, categoryName, memberName) {
    return [sectionName, categoryName, memberName]
        .filter(Boolean)
        .map(slugify)
        .join("--");
}

export class ContentClassDoc extends ContentBase {
    computeHtml () {
        const sections = this.json.sections || [];

        // Single section with no name collapses to just its categories.
        const hideSectionHeadings = sections.length === 1;

        // TOC
        let tocHtml = '<nav class="classdoc-toc">';
        tocHtml += renderToc(sections, hideSectionHeadings);
        tocHtml += "</nav>";

        // Body
        let bodyHtml = '<div class="classdoc">';
        for (const section of sections) {
            bodyHtml += renderSection(section, hideSectionHeadings);
        }
        bodyHtml += "</div>";

        return tocHtml + bodyHtml;
    }
}

function renderToc (sections, hideSectionHeadings) {
    // The <ul> that directly contains member <li>s gets the
    // classdoc-toc-members class so CSS can put it in columns.
    const allCategoriesHidden = sections.every(s => {
        const cats = s.categories || [];
        return cats.length === 1 && !cats[0].name;
    });
    const outerIsMemberList = hideSectionHeadings && allCategoriesHidden;
    let html = outerIsMemberList ? '<ul class="classdoc-toc-members">' : "<ul>";

    for (const section of sections) {
        const categories = section.categories || [];
        const hideCategoryHeadings = categories.length === 1 && !categories[0].name;

        const sectionItems = renderTocCategories(
            section, categories, hideCategoryHeadings
        );

        if (hideSectionHeadings) {
            html += sectionItems;
        } else {
            const slug = slugify(section.name);
            html += `<li><a href="#${slug}">${section.name}</a>`;
            if (sectionItems) {
                const innerClass = hideCategoryHeadings ? ' class="classdoc-toc-members"' : "";
                html += `<ul${innerClass}>${sectionItems}</ul>`;
            }
            html += "</li>";
        }
    }
    html += "</ul>";
    return html;
}

function renderTocCategories (section, categories, hideCategoryHeadings) {
    let html = "";
    for (const category of categories) {
        const members = category.members || [];
        const memberItems = members.map(m => {
            const slug = memberSlug(section.name, category.name, m.name);
            return `<li><a href="#${slug}">${m.name}</a></li>`;
        }).join("");

        if (hideCategoryHeadings) {
            html += memberItems;
        } else {
            const slug = slugify(`${section.name || ""}-${category.name}`);
            html += `<li><a href="#${slug}">${category.name}</a>`;
            if (memberItems) {
                html += `<ul class="classdoc-toc-members">${memberItems}</ul>`;
            }
            html += "</li>";
        }
    }
    return html;
}

function renderSection (section, hideSectionHeading) {
    let html = "";
    if (!hideSectionHeading && section.name) {
        const slug = slugify(section.name);
        html += `<h2 id="${slug}" class="classdoc-section">${section.name}</h2>`;
    }

    const categories = section.categories || [];
    const hideCategoryHeadings = categories.length === 1 && !categories[0].name;

    for (const category of categories) {
        html += renderCategory(section, category, hideCategoryHeadings);
    }
    return html;
}

function renderCategory (section, category, hideCategoryHeading) {
    let html = "";
    if (!hideCategoryHeading && category.name) {
        const slug = slugify(`${section.name || ""}-${category.name}`);
        html += `<h3 id="${slug}" class="classdoc-category">${category.name}</h3>`;
    }

    const members = category.members || [];
    for (const member of members) {
        html += renderMember(section, category, member);
    }
    return html;
}

function renderMember (section, category, member) {
    const slug = memberSlug(section.name, category.name, member.name);
    let html = `<div class="classdoc-member" id="${slug}">`;
    html += '<div class="classdoc-member-head">';
    html += `<span class="classdoc-member-name">${member.name}</span>`;
    if (member.signature) {
        html += `<span class="classdoc-member-sig">${member.signature}</span>`;
    }
    html += "</div>";
    if (member.description) {
        html += `<div class="classdoc-member-body">${wrapParagraphs(member.description)}</div>`;
    }
    html += "</div>";
    return html;
}

// Doc descriptions are a mix of plain text (with single-line wraps) and
// embedded HTML (<pre>, <em>, <code>, <tt>, <p>). Treat blank lines as
// paragraph breaks; leave lines that already start with a block-level
// tag alone so pre/examples render as authored.
function wrapParagraphs (text) {
    const blocks = text.split(/\n\s*\n/);
    return blocks.map(b => {
        const trimmed = b.trim();
        if (!trimmed) return "";
        if (/^<(p|pre|ul|ol|table|blockquote|div|h[1-6])\b/i.test(trimmed)) {
            return trimmed;
        }
        return `<p>${trimmed}</p>`;
    }).join("");
}
