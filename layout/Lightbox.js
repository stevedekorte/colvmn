// Page-global click-to-zoom (lightbox) behavior.
//
// Any <img class="colvmn-zoomable-image"> — and any inline diagram <svg> inside a
// .section-body — becomes click-to-enlarge: clicking it opens a full-viewport
// overlay showing the element; clicking the overlay or pressing Escape returns to
// normal. This is a runtime behavior pass (see colvmn/CLAUDE.md, "Rendering
// model"): the markup ships from the build, this only attaches interactivity on top.
//
// It is registered from layout.js rather than a content block because zooming is
// page-global and not tied to any one block type. Event delegation means it works
// for elements from any source — markdown {.colvmn-zoomable-image}, raw HTML in a
// ContentText body, inline SVG diagrams, etc. — regardless of which blocks are
// present. With no JS the element still renders normally; pure progressive enhancement.

const ZOOM_SELECTOR = "img.colvmn-zoomable-image, .section-body svg";

const isSvg = (el) => el.namespaceURI === "http://www.w3.org/2000/svg";

// Accessible label for a zoomable element: an <svg>'s <title>, an <img>'s alt,
// then a sensible default per type.
const labelFor = (el) => {
    if (isSvg(el)) {
        const title = el.querySelector("title");
        const text = title && title.textContent.trim();
        return (text ? text + " — " : "") + "enlarge diagram";
    }
    return (el.alt ? el.alt + " — " : "") + "enlarge image";
};

export function initLightbox (doc = document) {
    if (typeof doc === "undefined" || !doc.body) return;

    let overlay = null;

    const ensureOverlay = () => {
        if (overlay) return overlay;
        overlay = doc.createElement("div");
        overlay.className = "colvmn-lightbox-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.addEventListener("click", close);
        doc.body.appendChild(overlay);
        return overlay;
    };

    const open = (el) => {
        const o = ensureOverlay();
        let full;
        if (isSvg(el)) {
            // Clone the inline SVG node — it has no src. The viewBox is preserved,
            // so the diagram scales crisply to fill the overlay.
            full = el.cloneNode(true);
            ["tabindex", "role", "aria-label"].forEach((a) => full.removeAttribute(a));
        } else {
            full = doc.createElement("img");
            full.src = el.currentSrc || el.src;
            full.alt = el.alt || "";
        }
        o.replaceChildren(full);
        o.classList.add("open");
        doc.body.classList.add("colvmn-lightbox-active");
    };

    function close () {
        if (overlay) {
            overlay.classList.remove("open");
            overlay.replaceChildren();
        }
        doc.body.classList.remove("colvmn-lightbox-active");
    }

    const targetZoomable = (e) => {
        const el = e.target;
        if (!el || !el.closest) return null;
        const target = el.closest(ZOOM_SELECTOR);
        // Leave elements that are themselves links alone — the link wins.
        if (!target || target.closest("a")) return null;
        return target;
    };

    doc.addEventListener("click", (e) => {
        const target = targetZoomable(e);
        if (!target) return;
        e.preventDefault();
        open(target);
    });

    doc.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { close(); return; }
        if (e.key === "Enter" || e.key === " ") {
            const target = targetZoomable(e);
            if (target) { e.preventDefault(); open(target); }
        }
    });

    // Make zoomable elements keyboard-focusable and announce them to assistive tech.
    doc.querySelectorAll(ZOOM_SELECTOR).forEach((el) => {
        if (el.closest("a")) return;
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        if (!el.hasAttribute("aria-label")) {
            el.setAttribute("aria-label", labelFor(el));
        }
    });
}
