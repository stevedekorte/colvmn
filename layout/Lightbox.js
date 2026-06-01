// Page-global click-to-zoom (lightbox) behavior.
//
// Any <img class="colvmn-zoomable-image"> becomes click-to-enlarge: clicking it
// opens a full-viewport overlay showing the image; clicking the overlay or
// pressing Escape returns to normal. This is a runtime behavior pass (see
// colvmn/CLAUDE.md, "Rendering model"): the markup ships from the build, this
// only attaches interactivity on top.
//
// It is registered from layout.js rather than a content block because zooming is
// page-global and not tied to any one block type. Event delegation means it works
// for images from any source — markdown {.colvmn-zoomable-image}, raw HTML in a
// ContentText body, etc. — regardless of which blocks are present. With no JS the
// image still renders normally; this is pure progressive enhancement.

const ZOOM_SELECTOR = "img.colvmn-zoomable-image";

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

    const open = (img) => {
        const o = ensureOverlay();
        const full = doc.createElement("img");
        full.src = img.currentSrc || img.src;
        full.alt = img.alt || "";
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

    const targetImage = (e) => {
        const el = e.target;
        if (!el || !el.closest) return null;
        const img = el.closest(ZOOM_SELECTOR);
        // Leave images that are themselves links alone — the link wins.
        if (!img || img.closest("a")) return null;
        return img;
    };

    doc.addEventListener("click", (e) => {
        const img = targetImage(e);
        if (!img) return;
        e.preventDefault();
        open(img);
    });

    doc.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { close(); return; }
        if (e.key === "Enter" || e.key === " ") {
            const img = targetImage(e);
            if (img) { e.preventDefault(); open(img); }
        }
    });

    // Make zoomable images keyboard-focusable and announce them to assistive tech.
    doc.querySelectorAll(ZOOM_SELECTOR).forEach((img) => {
        if (img.closest("a")) return;
        if (!img.hasAttribute("tabindex")) img.setAttribute("tabindex", "0");
        img.setAttribute("role", "button");
        if (!img.hasAttribute("aria-label")) {
            img.setAttribute("aria-label", (img.alt ? img.alt + " — " : "") + "enlarge image");
        }
    });
}
