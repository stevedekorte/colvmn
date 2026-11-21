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

// Image layout options (style.css, "Image layout options"): written as
// colvmn-image-<option>, so the framework's styles never touch a class a page
// already gives its images for its own reasons.
export const IMAGE_OPTIONS = ["natural", "fill", "column", "center", "left", "float-left", "float-right"];

// Table column options: a header cell ending in {.nowrap} gives every cell in
// its column the class colvmn-table-nowrap. Other classes pass through as-is.
export const TABLE_COLUMN_OPTIONS = ["nowrap"];

function tableColumnClass (list) {
    return list.split(/\s+/).filter(Boolean).map(tok => {
        const c = tok.replace(/^\./, "");
        return TABLE_COLUMN_OPTIONS.includes(c) ? `colvmn-table-${c}` : c;
    }).join(" ");
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
        if (tok[0] === ".") {
            const c = tok.slice(1);
            classes.push(IMAGE_OPTIONS.includes(c) ? `colvmn-image-${c}` : c);
        }
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

// Element names inline markdown passes through as markup: every HTML element,
// and every SVG element (pages embed inline diagrams). Any other <word> in
// prose is text — a placeholder like "<stableId>", a token like <think> — and
// is escaped, since a browser would otherwise open it as an unknown element,
// hide it, and wrap the rest of the block in it.
const htmlElementNames = new Set((
    "a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption " +
    "cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset " +
    "figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins " +
    "kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option " +
    "output p param picture pre progress q rp rt ruby s samp script search section select slot small " +
    "source span strong style sub summary sup table tbody td template textarea tfoot th thead time " +
    "title tr track u ul var video wbr " +
    "svg animate animatemotion animatetransform circle clippath defs desc ellipse feblend fecolormatrix " +
    "fecomponenttransfer fecomposite feconvolvematrix fediffuselighting fedisplacementmap " +
    "fedistantlight fedropshadow feflood fefunca fefuncb fefuncg fefuncr fegaussianblur feimage " +
    "femerge femergenode femorphology feoffset fepointlight fespecularlighting fespotlight fetile " +
    "feturbulence filter foreignobject g image line lineargradient marker mask metadata mpath path " +
    "pattern polygon polyline radialgradient rect set stop switch symbol text textpath tspan use view"
).split(" "));

function escapeNonHtmlTags (text) {
    return text.replace(/<(\/?)([A-Za-z][\w:-]*)/g, (m, slash, name) =>
        htmlElementNames.has(name.toLowerCase()) ? m : `&lt;${slash}${name}`);
}

// US phone numbers in table cells link to the phone app (tel:), at build
// time, so they work without JS: (415) 435-3266, 415-435-3266, 1-866-743-0335,
// +1 415 435 3266, and a cell that is just 911. Text already inside a link is
// left alone, as are tags and their attributes. Dates (2017 11 21), permit and
// parcel numbers (2011-050, 060-201-03) and ZIP+4 codes don't match.
const PHONE_RE = /(?<![\w/+-])(?:\+?1[-. ])?(?:\(\d{3}\)\s?|\d{3}[-. ])\d{3}[-. ]\d{4}(?![\w-])/g;

export function linkPhoneNumbers (html) {
    let inLink = 0;
    return String(html ?? "").split(/(<[^>]*>)/).map(part => {
        if (part.startsWith("<")) {
            if (/^<a[\s>]/i.test(part)) inLink++;
            else if (/^<\/a\s*>/i.test(part)) inLink = Math.max(0, inLink - 1);
            return part;
        }
        if (inLink) return part;
        if (part.trim() === "911") return part.replace("911", '<a class="colvmn-tel" href="tel:911">911</a>');
        return part.replace(PHONE_RE, m => {
            const digits = m.replace(/\D/g, "");
            return `<a class="colvmn-tel" href="tel:+${digits.length === 11 ? digits : "1" + digits}">${m}</a>`;
        });
    }).join("");
}

function inlineMarkdown (text) {
    // Code spans are extracted first so their content is HTML-escaped verbatim
    // and never processed by the link/emphasis rules (a URL in backticks must
    // not be autolinked, `<think>` must render as text, etc.).
    const codeSpans = [];
    const withoutCode = text.replace(/`([^`]+)`/g, (m, code) => {
        const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        codeSpans.push(`<code>${escaped}</code>`);
        return `\u0000${codeSpans.length - 1}\u0000`;
    });
    return escapeNonHtmlTags(withoutCode)
        .replace(/!\[([^\]]*)\]\(([^)]+?)(?:\s+"([^"]*)")?\)(?:\{([^}]*)\})?/g,
            (m, alt, src, title, attrs) => `<img src="${src}" alt="${alt}"${title === undefined ? "" : ` title="${title}"`}${imageAttrs(attrs)}>`)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/(^|[^"=])(https?:\/\/[^\s<>"]+)/g, '$1<a href="$2">$2</a>')
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__(.+?)__/g, "<strong>$1</strong>")
        .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<em>$1</em>")
        .replace(/(?<!\w)_(.+?)_(?!\w)/g, "<em>$1</em>")
        .replace(/&(?!#?\w+;)/g, "&amp;")
        .replace(/\u2014/g, "&mdash;")
        .replace(/\u2013/g, "&ndash;")
        .replace(/\u201c/g, "&ldquo;").replace(/\u201d/g, "&rdquo;")
        .replace(/\u2018/g, "&lsquo;").replace(/\u2019/g, "&rsquo;")
        .replace(/\u0000(\d+)\u0000/g, (m, i) => codeSpans[i]);
}

function parseBlocks (lines) {
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (line.trim() === "") { i++; continue; }

        // Raw HTML / SVG block element (e.g., <svg>, <div>, <object>, <figure>, <picture>, etc.)
        const rawHtmlBlockMatch = line.trim().match(/^<([A-Za-z][\w-]*)\b/);
        if (rawHtmlBlockMatch) {
            const tagName = rawHtmlBlockMatch[1].toLowerCase();
            const inlineFormattingTags = new Set(["a", "span", "b", "i", "em", "strong", "code", "sub", "sup", "small", "mark", "del", "ins", "abbr", "cite", "kbd"]);
            if (htmlElementNames.has(tagName) && !inlineFormattingTags.has(tagName)) {
                const htmlLines = [line];
                i++;
                const closingTag = `</${tagName}>`;
                const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
                const isSingleLineSelfClosed = voidElements.has(tagName) || line.toLowerCase().includes(closingTag) || line.trim().endsWith("/>");
                if (!isSingleLineSelfClosed) {
                    while (i < lines.length) {
                        htmlLines.push(lines[i]);
                        if (lines[i].toLowerCase().includes(closingTag)) {
                            i++;
                            break;
                        }
                        i++;
                    }
                }
                blocks.push({ type: "html", html: htmlLines.join("\n") });
                continue;
            }
        }

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
            const splitRow = (row) =>
                row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
            const parseRow = (row) => splitRow(row).map(c => inlineMarkdown(c));
            // A header cell may end in a class list, e.g. "| Phone {.nowrap} |",
            // which applies to every cell in that column (see TABLE_COLUMN_OPTIONS).
            const columnClasses = [];
            const headers = splitRow(line).map((h, col) => {
                const m = h.match(/\s*\{((?:\s*\.[\w-]+)+)\s*\}$/);
                columnClasses[col] = m ? tableColumnClass(m[1]) : "";
                return inlineMarkdown(m ? h.slice(0, m.index) : h);
            });
            i += 2; // skip header + separator
            const rows = [];
            while (i < lines.length && lines[i].trim().startsWith("|")) {
                rows.push(parseRow(lines[i]));
                i++;
            }
            const cls = (col) => columnClasses[col] ? ` class="${columnClasses[col]}"` : "";
            let html = "<table><thead><tr>";
            html += headers.map((h, col) => `<th${cls(col)}>${h}</th>`).join("");
            html += "</tr></thead><tbody>";
            for (const row of rows) {
                html += "<tr>" + row.map((c, col) => `<td${cls(col)}>${linkPhoneNumbers(c)}</td>`).join("") + "</tr>";
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

        // Ordered list — numbered from its first item's number (a plan's
        // steps may start at 0), not always from 1
        if (line.match(/^\s*\d+[.)]\s/)) {
            const start = parseInt(line.match(/^\s*(\d+)[.)]\s/)[1], 10);
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
            blocks.push({ type: "ol", items, start });
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

// A paragraph holding only one image (perhaps in a link), marked
// .colvmn-image: centered by default (style.css, "Image layout options");
// an image beside text stays inline.
const LONE_IMAGE_PARAGRAPH = /^\s*(?:<a\b[^>]*>\s*<img\b[^>]*>\s*<\/a>|<img\b[^>]*>)\s*$/;

// A paragraph holding only images marked {.slideshow}.
const SLIDESHOW_PARAGRAPH = /^(?:\s*<img\b[^>]*\bclass="(?:[^"]*\s)?slideshow(?:\s[^"]*)?"[^>]*>\s*)+$/;

/**
 * Consecutive images marked {.slideshow} (in one paragraph or several in a
 * row) as one slideshow: the images crossfade in one frame, with previous and
 * next buttons and a counter (layout/Slideshow.js). Each image is zoomable.
 * Options, as classes on any of its images: .autoplay (advance by itself),
 * .no-controls (hide the arrows and count) and .inset (a frame pressed into
 * the page). An image's markdown title (![Alt](a.jpg "Caption")) becomes its
 * caption, shown under it and crossfading with it; images without one have none.
 * Without JavaScript the noscript style shows them stacked.
 */
const SLIDESHOW_OPTIONS = ["autoplay", "no-controls", "inset"];

export function slideshowHtml (imgs) {
    const n = imgs.length;
    // Options, as classes on any of its images: .autoplay advances by itself; .no-controls hides the arrows and count;
    // .inset sets the images in a frame pressed into the page.
    const options = new Set();
    const slides = imgs.map((img, k) => {
        let caption = "";
        let tag = img.replace(/\s*\btitle="([^"]*)"/, (m, t) => { caption = t; return ""; });
        tag = tag.replace(/\bclass="([^"]*)"/, (m, c) => {
            const classes = c.split(/\s+/).filter(x => x && x !== "slideshow");
            classes.filter(x => SLIDESHOW_OPTIONS.includes(x)).forEach(x => options.add(x));
            return `class="${classes.filter(x => !SLIDESHOW_OPTIONS.includes(x)).concat("colvmn-zoomable-image").join(" ")}"`;
        });
        if (k > 0 && !/\bloading=/.test(tag)) tag = tag.replace(/^<img\b/, '<img loading="lazy"');
        const active = k === 0 ? " is-active" : "";
        const hidden = k === 0 ? "" : ' aria-hidden="true"';
        const figcaption = caption ? `<figcaption>${caption}</figcaption>` : "";
        return `<figure class="slide${active}" aria-roledescription="slide" aria-label="${k + 1} of ${n}"${hidden}>${tag}${figcaption}</figure>`;
    }).join("");
    const optionClasses = SLIDESHOW_OPTIONS.filter(o => options.has(o)).map(o => ` ${o}`).join("");
    return `<div class="colvmn-slideshow${optionClasses}" role="region" aria-roledescription="carousel" aria-label="Images" tabindex="0">`
        + `<div class="slideshow-frame">${slides}`
        + '<button class="slideshow-edge slideshow-edge-prev" type="button" tabindex="-1" aria-label="Previous image"><span>&lsaquo;</span></button>'
        + '<button class="slideshow-edge slideshow-edge-next" type="button" tabindex="-1" aria-label="Next image"><span>&rsaquo;</span></button></div>'
        + '<div class="slideshow-controls"><button class="slideshow-btn slideshow-prev" type="button" aria-label="Previous image">&lsaquo;</button>'
        + `<span class="slideshow-count">1 / ${n}</span>`
        + '<button class="slideshow-btn slideshow-next" type="button" aria-label="Next image">&rsaquo;</button></div>'
        + '<p class="slideshow-live" aria-live="polite"></p>'
        + "<noscript><style>.colvmn-slideshow .slideshow-frame{display:block}.colvmn-slideshow .slide{opacity:1;margin-bottom:20px}.colvmn-slideshow .slideshow-controls,.colvmn-slideshow .slideshow-edge{display:none}</style></noscript>"
        + "</div>";
}

// A paragraph holding only images marked {.row}.
const IMAGE_ROW_PARAGRAPH = /^(?:\s*<img\b[^>]*\bclass="(?:[^"]*\s)?row(?:\s[^"]*)?"[^>]*>\s*)+$/;

/**
 * Consecutive images marked {.row} (in one paragraph or several in a row) as
 * one row of figures, side by side with a column gutter between them, each
 * no wider than one of the page's columns, bottoms aligned; they wrap onto
 * more lines when the page is too narrow. An image's markdown title
 * (![Alt](a.png "Caption")) becomes its caption.
 */
export function imageRowHtml (imgs) {
    const figures = imgs.map(img => {
        let caption = "";
        let tag = img.replace(/\s*\btitle="([^"]*)"/, (m, t) => { caption = t; return ""; });
        tag = tag.replace(/\s*\bclass="([^"]*)"/, (m, c) => {
            const classes = c.split(/\s+/).filter(x => x && x !== "row");
            return classes.length ? ` class="${classes.join(" ")}"` : "";
        });
        return `<figure>${tag}${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
    }).join("");
    return `<div class="colvmn-image-row">${figures}</div>`;
}

function blocksToHtml (blocks) {
    // Gather consecutive slideshow (and image row) paragraphs into one block first.
    const grouped = [];
    for (const b of blocks) {
        const kind = b.type !== "paragraph" ? null
            : SLIDESHOW_PARAGRAPH.test(b.text) ? "slideshow"
            : IMAGE_ROW_PARAGRAPH.test(b.text) ? "imageRow" : null;
        if (kind) {
            const imgs = b.text.match(/<img\b[^>]*>/g);
            const last = grouped[grouped.length - 1];
            if (last && last.type === kind) last.imgs.push(...imgs);
            else grouped.push({ type: kind, imgs });
        } else {
            grouped.push(b);
        }
    }
    return grouped.map(b => {
        switch (b.type) {
            case "paragraph": return LONE_IMAGE_PARAGRAPH.test(b.text) ? `<p class="colvmn-image">${b.text}</p>` : `<p>${b.text}</p>`;
            case "ul": return "<ul>" + b.items.map(i => `<li>${i}</li>`).join("") + "</ul>";
            case "ol": return (b.start === 1 ? "<ol>" : `<ol start="${b.start}">`) + b.items.map(i => `<li>${i}</li>`).join("") + "</ol>";
            case "html": return b.html;
            case "slideshow": return slideshowHtml(b.imgs);
            case "imageRow": return imageRowHtml(b.imgs);
            case "heading": return `<h${b.level} id="${slugify(b.text)}">${inlineMarkdown(b.text)}</h${b.level}>`;
            default: return "";
        }
    }).join("");
}

// Frontmatter is one-line `key: value` settings. Anything else (a YAML list or
// nested block, say) is an error rather than silently dropped, so a page never
// ships without something its author wrote. Blank lines and # comments are fine.
function parseFrontmatter (lines) {
    if (lines.length === 0 || lines[0].trim() !== "---") return { meta: {}, rest: lines };
    let i = 1;
    const meta = {};
    while (i < lines.length && lines[i].trim() !== "---") {
        const m = lines[i].match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
        if (!m && lines[i].trim() !== "" && !lines[i].trim().startsWith("#") && lines.slice(i + 1).some(l => l.trim() === "---")) {
            throw new Error(`frontmatter line ${i + 1} ("${lines[i].trim()}") is not a one-line "key: value" setting. ` +
                "Frontmatter takes one-line settings only (no YAML lists or nested blocks); write content blocks in an _index.json page.");
        }
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

/** A markdown page's frontmatter settings and the text after them. */
export function splitFrontmatter (text) {
    const { meta, rest } = parseFrontmatter(text.split("\n"));
    return { meta, body: rest.join("\n") };
}

// A paragraph that is just "{listing: some/folder}" embeds that subfolder's
// folder listing (ContentFolderCards with `folder`), set up by its own page.
const LISTING_RE = /^\{listing:\s*([^{}]+)\}$/;
// "{listing: .}": the page's own folder and file listings go here, instead of
// after the text (or before the first titled section with cardsFirst).
const OWN_LISTINGS = "_ownListings";

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
            // "## Details {.collapsed}": a section shown closed, opened by its heading.
            const collapsed = /\s*\{\.collapsed\}\s*$/.test(block.text);
            currentSection = { title: block.text.replace(/\s*\{\.collapsed\}\s*$/, ""), blocks: [] };
            if (collapsed) currentSection.collapsed = true;
        } else if (block.type === "heading" && block.level >= 3 && currentSection) {
            currentSection.blocks.push({ type: "heading", level: block.level, text: block.text });
        } else if (currentSection && block.type === "paragraph" && LISTING_RE.test(block.text.trim())) {
            // "{listing: proposals}" alone in a paragraph: that subfolder's
            // listing (as its own page sets it up) goes after this section.
            (currentSection.listings ||= []).push(LISTING_RE.exec(block.text.trim())[1].trim());
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
    const content = sections.flatMap(section => {
        const entry = { type: "ContentText" };
        if (section.title) entry.title = section.title;
        if (section.collapsed) entry.collapsed = true;
        const body = blocksToHtml(section.blocks);
        if (body) entry.body = body;
        // "{listing: .}" marks where the page's own listings go (placed below).
        const embedded = (section.listings || []).map(folder =>
            folder === "." ? { type: OWN_LISTINGS } : { type: "ContentFolderCards", folder });
        return [entry, ...embedded];
    });

    // Extract subtitle if first section is a single short untitled paragraph
    // (Not when the frontmatter gives a subtitle: that one wins, and the
    // paragraph stays in the body rather than being dropped.)
    let subtitle = "";
    if (typeof meta.subtitle !== "string" && content.length > 0 && !content[0].title && content[0].body) {
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

    // Generate table of contents if there are enough titled sections (`toc: false` turns it off)
    const titledSections = content.filter(c => c.title);
    if (titledSections.length >= 4 && meta.toc !== false) {
        const toc = { type: "ContentToc", items: titledSections.map(c => c.title) };
        content.unshift(toc);
    }

    // Folder listings (ContentFolder.js), after the page's text, or with
    // `cardsFirst: true` before its first titled section:
    // `folderCards: true | newest-first` and `fileCards: true`.
    const listings = [];
    if (meta.folderCards) {
        const entry = { type: "ContentFolderCards" };
        if (meta.folderCards === "newest-first") entry.order = "newest-first";
        // `folderOrder: overview, history, photos`: these folders first, in this order; the rest follow sorted.
        if (meta.folderOrder) entry.first = String(meta.folderOrder).split(",").map(n => n.trim()).filter(Boolean);
        // `folderExclude: drafts, design-ideas`: subfolders left out of the cards (link them from the text instead).
        if (meta.folderExclude) entry.exclude = String(meta.folderExclude).split(",").map(n => n.trim()).filter(Boolean);
        if (meta.folderCardsTitle) entry.title = meta.folderCardsTitle;
        // `folderLayout: table`: one table row per folder instead of a card grid.
        if (meta.folderLayout) entry.layout = String(meta.folderLayout).trim();
        // `folderColumns: Date=line1, Record=title, Summary=line2`: the table's columns (ContentCards.tableColumns).
        // `folderSort: Date desc`: order the listing by a column or frontmatter key (ContentFolderCards.sortItems).
        if (meta.folderSort) entry.sort = String(meta.folderSort).trim();
        if (meta.folderColumns) entry.tableColumns = String(meta.folderColumns).split(",").map(n => n.trim()).filter(Boolean);
        listings.push(entry);
    }
    // `fileExclude: *.skp, notes.txt`: files left out of the file cards (names, or patterns with *).
    const fileExclude = meta.fileExclude ? String(meta.fileExclude).split(",").map(n => n.trim()).filter(Boolean) : undefined;
    // `fileTitles: model.obj=3D Model, model.dwg=2D Drawings`: a file's card title (its detail becomes format and size).
    const fileTitles = meta.fileTitles ? Object.fromEntries(String(meta.fileTitles).split(",").map(n => n.split("=").map(x => x.trim())).filter(kv => kv.length === 2 && kv[0] && kv[1])) : undefined;
    // Both on and neither titled: one grid, the folder cards then the file cards.
    if (meta.folderCards && meta.fileCards && !meta.folderCardsTitle && !meta.fileCardsTitle) {
        listings[listings.length - 1].withFiles = true;
        if (fileExclude) listings[listings.length - 1].fileExclude = fileExclude;
        if (fileTitles) listings[listings.length - 1].fileTitles = fileTitles;
    } else if (meta.fileCards) {
        const entry = { type: "ContentFileCards" };
        if (meta.fileCardsTitle) entry.title = meta.fileCardsTitle;
        // `fileLayout: table`: one table row per file instead of a card grid.
        if (meta.fileLayout) entry.layout = String(meta.fileLayout).trim();
        if (meta.fileCards === "newest-first") entry.order = "newest-first";
        if (fileExclude) entry.exclude = fileExclude;
        if (fileTitles) entry.titles = fileTitles;
        listings.push(entry);
    }
    const marked = content.findIndex(c => c.type === OWN_LISTINGS);
    if (marked !== -1) {
        content.splice(marked, 1, ...listings);
        for (let i = content.length - 1; i >= 0; i--) if (content[i].type === OWN_LISTINGS) content.splice(i, 1);
    } else if (meta.cardsFirst === true) {
        let at = content.findIndex(c => c.title && c.type === "ContentText");
        if (at === -1) at = content.length;
        content.splice(at, 0, ...listings);
    } else {
        content.push(...listings);
    }

    const result = { title };
    if (subtitle) result.subtitle = subtitle;
    result.content = content;
    for (const key of Object.keys(meta)) {
        result[key] = meta[key];
    }
    // A subtitle is HTML wherever it lands (intro, cards), like one taken from
    // the body above, so frontmatter markdown in it is rendered the same way.
    if (typeof meta.subtitle === "string") result.subtitle = inlineMarkdown(meta.subtitle);
    return result;
}
