// Converts markdown text to a _index.json-compatible object.

export function slugify (text) {
    return text
        .replace(/<[^>]+>/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
}

// Parse an optional Pandoc-style attribute list that may follow a markdown image,
// e.g. ![alt](src){.colvmn-zoomable-image #id width=480}. Supports .class, #id, and
// key=value (value may be quoted). Returns a string of HTML attributes with a
// leading space, or "" when there is nothing to add.
function imageAttrs (attrs) {
    if (!attrs) return "";
    const classes = [];
    let id = null;
    const pairs = [];
    for (const tok of attrs.trim().split(/\s+/)) {
        if (!tok) continue;
        if (tok[0] === ".") classes.push(tok.slice(1));
        else if (tok[0] === "#") id = tok.slice(1);
        else {
            const eq = tok.indexOf("=");
            if (eq > 0) {
                const key = tok.slice(0, eq);
                const val = tok.slice(eq + 1).replace(/^["']|["']$/g, "");
                pairs.push(`${key}="${val}"`);
            }
        }
    }
    let out = "";
    if (id) out += ` id="${id}"`;
    if (classes.length) out += ` class="${classes.join(" ")}"`;
    for (const p of pairs) out += ` ${p}`;
    return out;
}

function inlineMarkdown (text) {
    return text
        .replace(/!\[([^\]]*)\]\(([^)]+)\)(?:\{([^}]*)\})?/g,
            (m, alt, src, attrs) => `<img src="${src}" alt="${alt}"${imageAttrs(attrs)}>`)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/(^|[^"=])(https?:\/\/[^\s<>"]+)/g, '$1<a href="$2">$2</a>')
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__(.+?)__/g, "<strong>$1</strong>")
        .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<em>$1</em>")
        .replace(/(?<!\w)_(.+?)_(?!\w)/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/&(?!#?\w+;)/g, "&amp;")
        .replace(/\u2014/g, "&mdash;")
        .replace(/\u2013/g, "&ndash;")
        .replace(/\u201c/g, "&ldquo;").replace(/\u201d/g, "&rdquo;")
        .replace(/\u2018/g, "&lsquo;").replace(/\u2019/g, "&rsquo;");
}

function parseBlocks (lines) {
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (line.trim() === "") { i++; continue; }

        // Fenced code block
        if (line.trim().startsWith("```")) {
            const codeLines = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith("```")) {
                codeLines.push(lines[i]);
                i++;
            }
            i++;
            const escaped = codeLines.join("\n")
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            blocks.push({ type: "html", html: `<pre><code>${escaped}</code></pre>` });
            continue;
        }

        // Heading
        const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
            blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2].trim() });
            i++;
            continue;
        }

        // Table
        if (line.trim().startsWith("|") && i + 1 < lines.length && lines[i + 1].match(/^\s*\|[\s:-]+\|/)) {
            const parseRow = (row) =>
                row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => inlineMarkdown(c.trim()));
            const headers = parseRow(line);
            i += 2; // skip header + separator
            const rows = [];
            while (i < lines.length && lines[i].trim().startsWith("|")) {
                rows.push(parseRow(lines[i]));
                i++;
            }
            let html = "<table><thead><tr>";
            html += headers.map(h => `<th>${h}</th>`).join("");
            html += "</tr></thead><tbody>";
            for (const row of rows) {
                html += "<tr>" + row.map(c => `<td>${c}</td>`).join("") + "</tr>";
            }
            html += "</tbody></table>";
            blocks.push({ type: "html", html });
            continue;
        }

        // Unordered list (with nested indent support)
        if (line.match(/^\s*[-*+]\s/)) {
            const parseNestedList = (baseIndent) => {
                const items = [];
                while (i < lines.length && lines[i].match(/^\s*[-*+]\s/)) {
                    const match = lines[i].match(/^(\s*)[-*+]\s/);
                    const indent = match[1].length;
                    if (indent < baseIndent) break;
                    if (indent > baseIndent) {
                        const nested = parseNestedList(indent);
                        if (items.length > 0) {
                            items[items.length - 1] += "<ul>" + nested.map(n => `<li>${n}</li>`).join("") + "</ul>";
                        }
                        continue;
                    }
                    items.push(inlineMarkdown(lines[i].replace(/^\s*[-*+]\s/, "").trim()));
                    i++;
                    while (i < lines.length && lines[i].match(/^\s{2,}/) && !lines[i].match(/^\s*[-*+]\s/) && lines[i].trim() !== "") {
                        items[items.length - 1] += " " + inlineMarkdown(lines[i].trim());
                        i++;
                    }
                }
                return items;
            };
            const baseIndent = line.match(/^(\s*)[-*+]\s/)[1].length;
            const items = parseNestedList(baseIndent);
            blocks.push({ type: "ul", items });
            continue;
        }

        // Ordered list
        if (line.match(/^\s*\d+[.)]\s/)) {
            const items = [];
            while (i < lines.length) {
                if (!lines[i].match(/^\s*\d+[.)]\s/)) break;
                items.push(inlineMarkdown(lines[i].replace(/^\s*\d+[.)]\s/, "").trim()));
                i++;
                // Continuation lines
                while (i < lines.length && lines[i].match(/^\s{2,}/) && !lines[i].match(/^\s*\d+[.)]\s/) && !lines[i].match(/^\s{2,}[-*+]\s/) && lines[i].trim() !== "") {
                    items[items.length - 1] += " " + inlineMarkdown(lines[i].trim());
                    i++;
                }
                // Skip blank lines after item
                const savedI = i;
                while (i < lines.length && lines[i].trim() === "") i++;
                // Indented sub-items (unordered)
                if (i < lines.length && lines[i].match(/^\s{2,}[-*+]\s/)) {
                    const subItems = [];
                    while (i < lines.length && lines[i].match(/^\s{2,}[-*+]\s/)) {
                        subItems.push(inlineMarkdown(lines[i].replace(/^\s*[-*+]\s/, "").trim()));
                        i++;
                    }
                    items[items.length - 1] += "<ul>" + subItems.map(s => `<li>${s}</li>`).join("") + "</ul>";
                    // Skip blank lines before next numbered item
                    while (i < lines.length && lines[i].trim() === "") i++;
                } else if (i < lines.length && !lines[i].match(/^\s*\d+[.)]\s/)) {
                    i = savedI;
                    break;
                }
            }
            blocks.push({ type: "ol", items });
            continue;
        }

        // Horizontal rule
        if (line.match(/^---+\s*$/) || line.match(/^\*\*\*+\s*$/) || line.match(/^___+\s*$/)) {
            i++;
            continue;
        }

        // Blockquote — collect consecutive ">"-prefixed lines, strip the marker,
        // and parse the inner content recursively so nested markdown still works.
        if (line.match(/^>\s?/)) {
            const quoteLines = [];
            while (i < lines.length && lines[i].match(/^>\s?/)) {
                quoteLines.push(lines[i].replace(/^>\s?/, ""));
                i++;
            }
            const inner = blocksToHtml(parseBlocks(quoteLines));
            blocks.push({ type: "html", html: `<blockquote>${inner}</blockquote>` });
            continue;
        }

        // Paragraph
        const paraLines = [];
        while (i < lines.length && lines[i].trim() !== "" &&
           !lines[i].match(/^#{1,6}\s/) &&
           !lines[i].match(/^\s*[-*+]\s/) &&
           !lines[i].match(/^\s*\d+[.)]\s/) &&
           !lines[i].trim().startsWith("```") &&
           !lines[i].match(/^>\s?/) &&
           !lines[i].match(/^---+\s*$/) &&
           !lines[i].match(/^\*\*\*+\s*$/) &&
           !lines[i].match(/^___+\s*$/)) {
            paraLines.push(lines[i]);
            i++;
        }
        if (paraLines.length) {
            blocks.push({ type: "paragraph", text: inlineMarkdown(paraLines.join(" ").trim()) });
        }
    }

    return blocks;
}

function blocksToHtml (blocks) {
    return blocks.map(b => {
        switch (b.type) {
            case "paragraph": return `<p>${b.text}</p>`;
            case "ul": return "<ul>" + b.items.map(i => `<li>${i}</li>`).join("") + "</ul>";
            case "ol": return "<ol>" + b.items.map(i => `<li>${i}</li>`).join("") + "</ol>";
            case "html": return b.html;
            case "heading": return `<h${b.level} id="${slugify(b.text)}">${inlineMarkdown(b.text)}</h${b.level}>`;
            default: return "";
        }
    }).join("");
}

function parseFrontmatter (lines) {
    if (lines.length === 0 || lines[0].trim() !== "---") return { meta: {}, rest: lines };
    let i = 1;
    const meta = {};
    while (i < lines.length && lines[i].trim() !== "---") {
        const m = lines[i].match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
        if (m) {
            let value = m[2].trim();
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            } else if (value === "true") {
                value = true;
            } else if (value === "false") {
                value = false;
            }
            meta[m[1]] = value;
        }
        i++;
    }
    if (i >= lines.length) return { meta: {}, rest: lines };
    return { meta, rest: lines.slice(i + 1) };
}

export function parseMarkdown (text) {
    const rawLines = text.split("\n");
    const { meta, rest: lines } = parseFrontmatter(rawLines);
    const allBlocks = parseBlocks(lines);

    // Extract title from first h1
    let title = "Untitled";
    let startIndex = 0;

    if (allBlocks.length > 0 && allBlocks[0].type === "heading" && allBlocks[0].level === 1) {
        title = allBlocks[0].text;
        startIndex = 1;
    }

    // Split by h2 into sections
    const sections = [];
    let currentSection = null;

    for (let i = startIndex; i < allBlocks.length; i++) {
        const block = allBlocks[i];

        if (block.type === "heading" && block.level === 2) {
            if (currentSection) sections.push(currentSection);
            currentSection = { title: block.text, blocks: [] };
        } else if (block.type === "heading" && block.level >= 3 && currentSection) {
            currentSection.blocks.push({ type: "heading", level: block.level, text: block.text });
        } else if (currentSection) {
            currentSection.blocks.push(block);
        } else {
            if (!currentSection) {
                currentSection = { title: null, blocks: [] };
            }
            currentSection.blocks.push(block);
        }
    }
    if (currentSection) sections.push(currentSection);

    // Build content array
    const content = sections.map(section => {
        const entry = { type: "ContentText" };
        if (section.title) entry.title = section.title;
        const body = blocksToHtml(section.blocks);
        if (body) entry.body = body;
        return entry;
    });

    // Extract subtitle if first section is a single short untitled paragraph
    let subtitle = "";
    if (content.length > 0 && !content[0].title && content[0].body) {
        const body = content[0].body;
        // A paragraph carrying embedded media must not be promoted to the
        // subtitle: stripping tags below measures only text length, so an
        // image-only paragraph reads as "short" (0 chars) and would be
        // silently swallowed, dropping the image from the page body.
        const hasEmbeddedMedia = /<(?:img|video|iframe|picture|svg)\b/i.test(body);
        const isSingleParagraph = body.startsWith("<p>") && body.endsWith("</p>") && !body.includes("</p><") && !hasEmbeddedMedia;
        if (isSingleParagraph) {
            const bodyText = body.replace(/<[^>]+>/g, "");
            if (bodyText.length < 200) {
                subtitle = body.replace(/^<p>/, "").replace(/<\/p>$/, "");
                content.shift();
            }
        }
    }

    // Generate table of contents if there are enough titled sections
    const titledSections = content.filter(c => c.title);
    if (titledSections.length >= 4) {
        const toc = { type: "ContentToc", items: titledSections.map(c => c.title) };
        content.unshift(toc);
    }

    const result = { title };
    if (subtitle) result.subtitle = subtitle;
    result.content = content;
    for (const key of Object.keys(meta)) {
        result[key] = meta[key];
    }
    return result;
}
