// Page-global open/close behavior for collapsed sections.
//
// A section marked "collapsed" ("## Details {.collapsed}" in markdown,
// "collapsed": true in JSON) is built by ContentText as an <h2
// class="collapsible-head"> holding a toggle button, followed by its
// .collapsible-panel; style.css shows the panel closed until the heading has
// the class "open". This attaches the behavior (see colvmn/CLAUDE.md,
// "Rendering model"): clicking the heading opens or closes it, and following
// a link to the section, or to anything inside it, opens it first.
//
// It is registered from layout.js and uses event delegation, like Lightbox.js.

const setOpen = (head, open) => {
    head.classList.toggle("open", open);
    const button = head.querySelector(".collapsible-toggle");
    if (button) button.setAttribute("aria-expanded", open ? "true" : "false");
};

// The collapsible heading that holds or owns an element, or null.
const headFor = (el) => {
    if (!el) return null;
    if (el.classList && el.classList.contains("collapsible-head")) return el;
    const panel = el.closest && el.closest(".collapsible-panel");
    const head = panel && panel.previousElementSibling;
    return head && head.classList.contains("collapsible-head") ? head : null;
};

export function initCollapsibles (doc = document) {
    if (typeof doc === "undefined" || !doc.body) return;

    doc.addEventListener("click", (e) => {
        const button = e.target.closest && e.target.closest(".collapsible-toggle");
        if (!button) return;
        const head = button.closest(".collapsible-head");
        if (head) setOpen(head, !head.classList.contains("open"));
    });

    // A link to a closed section (a contents entry, say) opens it.
    const openForHash = () => {
        let id;
        try {
            id = decodeURIComponent(doc.location.hash.slice(1));
        } catch (err) {
            return;
        }
        const head = id && headFor(doc.getElementById(id));
        if (head && !head.classList.contains("open")) {
            setOpen(head, true);
            const target = doc.getElementById(id);
            if (target) target.scrollIntoView();
        }
    };
    doc.defaultView.addEventListener("hashchange", openForHash);
    openForHash();
}
