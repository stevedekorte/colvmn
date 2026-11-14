// Columns: setting a page's sections side by side on wide viewports.
//
// PageIndex wraps each titled top-level section in a .col-group, with its
// heading and first subsection together in a .col-keep, and marks the page
// .has-cols; style.css sets --cols to the number of columns the viewport and
// the page allow (1 below 1200px). This runtime pass (see colvmn/CLAUDE.md,
// "Rendering model") builds those columns itself, the same in every browser:
//
// - the units are each section's .col-keep and each later subsection;
// - they are split, in order, into --cols columns, every column getting at
//   least one and the tallest as short as it can be;
// - a section split across columns continues in a fragment (.col-group) at
//   the top of the next column, and a subsection that starts a column
//   without its heading gets the space a heading takes (.col-continued).
//
// The page gets .js-columns, which turns off style.css's fallback (the
// browser's own columns, used without JavaScript). It re-lays out on resize,
// when fonts or images load, and after a collapsed section opens or closes;
// below two columns it puts the page back as it was built.

const GAP = 60;     // px between sections in a column (style.css .col-set .col-group)

const SLACK = 1.15;  // how much taller the columns may be to avoid continuing a section in the next column

/**
 * Splits units, in order, into at most k non-empty columns. Each unit is
 * { height, keep, last }: keep when it starts its section (heading and first
 * subsection), last when it ends it. A column's height is its units'
 * heights, a GAP after each section that ends inside it, and `space` above
 * it when it starts with a continued subsection. Among the splits whose
 * tallest column is within SLACK of the shortest possible, it takes the one
 * that continues the fewest sections in a next column, then the shortest.
 * Returns the index where each column after the first starts.
 */
export function planColumns (units, k, space = 0) {
    const n = units.length;
    k = Math.min(k, n);
    if (k < 2) return [];
    const cost = (i, j) => {
        let h = units[i].keep ? 0 : space;
        for (let t = i; t < j; t++) {
            h += units[t].height + (units[t].last && t < j - 1 ? GAP : 0);
        }
        return h;
    };
    // split(limit): the best split with no column taller than limit, by
    // [sections continued, tallest column]; null when there is none.
    const split = (limit) => {
        const best = [], cut = [];
        for (let c = 0; c <= k; c++) {
            best.push(new Array(n + 1).fill(null));
            cut.push(new Array(n + 1).fill(0));
        }
        best[0][0] = [0, 0];
        const better = (a, b) => !b || a[0] < b[0] || (a[0] === b[0] && a[1] < b[1] - 0.5);
        for (let c = 1; c <= k; c++) {
            for (let j = c; j <= n; j++) {
                for (let i = c - 1; i < j; i++) {
                    const prev = best[c - 1][i];
                    const h = cost(i, j);
                    if (!prev || h > limit) continue;
                    const v = [prev[0] + (i > 0 && !units[i].keep ? 1 : 0), Math.max(prev[1], h)];
                    if (better(v, best[c][j])) {
                        best[c][j] = v;
                        cut[c][j] = i;
                    }
                }
            }
        }
        if (!best[k][n]) return null;
        const starts = [];
        for (let c = k, j = n; c > 1; c--) {
            j = cut[c][j];
            starts.unshift(j);
        }
        return { starts, tallest: best[k][n][1] };
    };
    const shortest = split(Infinity);
    // The shortest possible tallest column: the least limit that still splits.
    let lo = 0, hi = shortest.tallest;
    for (let t = 0; t < 30 && hi - lo > 0.5; t++) {
        const mid = (lo + hi) / 2;
        if (split(mid)) hi = mid; else lo = mid;
    }
    return split(hi * SLACK).starts;
}

export function initColumns (doc = document) {
    if (typeof doc === "undefined" || !doc.body) return;
    const page = doc.querySelector(".page.has-cols");
    if (!page) return;
    const win = doc.defaultView;

    // Runs of consecutive sections; anything else between them spans the page.
    const runs = [];
    let run = null;
    for (const el of [...page.children]) {
        if (el.classList.contains("col-group")) {
            if (!run) runs.push(run = []);
            run.push(el);
        } else {
            run = null;
        }
    }
    const layouts = runs.map(groups => runLayout(doc, page, groups));
    page.classList.add("js-columns");

    let timer = null;
    const relayout = () => {
        clearTimeout(timer);
        timer = win.setTimeout(() => {
            const cols = parseInt(win.getComputedStyle(page).getPropertyValue("--cols"), 10) || 1;
            layouts.forEach(l => l(cols));
        }, 60);
    };
    win.addEventListener("resize", relayout);
    win.addEventListener("load", relayout);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(relayout);
    // A collapsed section opening or closing changes heights; lay out after its animation.
    doc.addEventListener("click", e => {
        if (e.target.closest && e.target.closest(".collapsible-toggle")) win.setTimeout(relayout, 360);
    });
    relayout();
}

/** The layout function for one run of sections: lays it out in n columns (n < 2 restores it). */
function runLayout (doc, page, groups) {
    const marker = doc.createComment("columns");
    page.insertBefore(marker, groups[0]);
    const original = groups.map(g => ({ group: g, children: [...g.children] }));
    let set = null;

    const restore = () => {
        if (!set) return;
        for (const { group, children } of original) {
            group.replaceChildren(...children);
            page.insertBefore(group, marker);
        }
        original.forEach(o => o.children.forEach(el => el.classList.remove("col-continued")));
        set.remove();
        set = null;
    };

    return (cols) => {
        restore();
        // At most one column per unit: a section's heading-and-first-subsection, and each later subsection.
        const unitCount = original.reduce((sum, { children }) => {
            const parts = children.filter(el => el.tagName !== "NOSCRIPT");
            return sum + (parts[0] && parts[0].classList.contains("col-keep") ? parts.length : 1);
        }, 0);
        const n = Math.min(cols, unitCount);
        if (n < 2) return;

        set = doc.createElement("div");
        set.className = `col-set cols-${n}`;
        const columns = [];
        for (let c = 0; c < n; c++) {
            const col = doc.createElement("div");
            col.className = "col";
            set.appendChild(col);
            columns.push(col);
        }
        page.insertBefore(set, marker);

        // Measure every unit at column width, in the first column.
        groups.forEach(g => columns[0].appendChild(g));
        const units = [];
        for (const { group, children } of original) {
            const parts = children.filter(el => el.tagName !== "NOSCRIPT");
            const keep = parts[0] && parts[0].classList.contains("col-keep") ? 1 : parts.length;
            const head = parts.slice(0, keep);
            const pieces = [head, ...parts.slice(keep).map(el => [el])];
            pieces.forEach((els, i) => units.push({
                group,
                els,
                keep: i === 0,
                last: i === pieces.length - 1,
                height: els.reduce((h, el) => h + el.getBoundingClientRect().height, 0)
            }));
        }
        const h2 = groups[0].querySelector(".col-keep > h2, :scope > h2");
        const space = h2 ? h2.getBoundingClientRect().height + parseFloat(doc.defaultView.getComputedStyle(h2).marginBottom || "0") : 0;
        page.style.setProperty("--col-heading-space", `${space}px`);

        // Place them: a section's units go into its own element in its first
        // column, and into a fragment of it in each column it continues in.
        const starts = planColumns(units, n, space);
        let c = 0, current = null;
        groups.forEach(g => g.replaceChildren());
        units.forEach((u, i) => {
            const newColumn = starts.includes(i);
            if (newColumn) c++;
            if (!current || current.source !== u.group || newColumn) {
                const el = current && current.source === u.group ? u.group.cloneNode(false) : u.group;
                columns[c].appendChild(el);
                current = { source: u.group, el };
            }
            u.els.forEach(e => current.el.appendChild(e));
            if (newColumn && !u.keep) u.els[0].classList.add("col-continued");
            else u.els[0].classList.remove("col-continued");
        });
    };
}
