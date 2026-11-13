// Slideshows: consecutive images marked {.slideshow} in markdown, built by
// MarkdownParser.slideshowHtml as one .colvmn-slideshow. The images crossfade
// slowly in one frame. This attaches the behavior (see colvmn/CLAUDE.md,
// "Rendering model"), registered from layout.js like Lightbox.js:
//
// - previous and next buttons, with "n / total" between them;
// - the image's sides: with a mouse, arrows appear at its left and right
//   edges on hover, and a click there moves; on a touch screen, a tap on
//   the left or right half moves (style.css sizes the zones);
// - left and right arrow keys while the slideshow has focus;
// - a swipe (finger or mouse drag) or a two-finger trackpad swipe moves either way;
// - a click on the middle of the image enlarges it (Lightbox.js), with a
//   mouse; a swipe never does;
// - with .autoplay ({.slideshow .autoplay}), it advances by itself every few
//   seconds while it's on screen, and pauses while the pointer is over it, it
//   has focus, the tab is hidden, an image is enlarged, or the reader prefers
//   reduced motion;
// - .no-controls hides the buttons and count (CSS); the rest still works.

const DWELL = 6500;

function initOne (root, win) {
    const slides = [...root.querySelectorAll(".slide")];
    if (slides.length < 2) {
        root.classList.add("single");
        return;
    }
    const counter = root.querySelector(".slideshow-count");
    const live = root.querySelector(".slideshow-live");
    const frame = root.querySelector(".slideshow-frame");
    const reduce = win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const doc = root.ownerDocument;
    const autoplay = root.classList.contains("autoplay");
    let i = 0, timer = null, hovering = false, visible = false;

    const show = (n, announce) => {
        i = (n + slides.length) % slides.length;
        slides.forEach((s, k) => {
            const on = k === i;
            s.classList.toggle("is-active", on);
            if (on) s.removeAttribute("aria-hidden");
            else s.setAttribute("aria-hidden", "true");
            // Only the shown image takes focus (Lightbox makes zoomable images focusable).
            const img = s.querySelector("img");
            if (img) img.setAttribute("tabindex", on ? "0" : "-1");
        });
        // Start loading the next image before it's needed.
        const next = slides[(i + 1) % slides.length].querySelector("img[loading=lazy]");
        if (next) next.loading = "eager";
        if (counter) counter.textContent = `${i + 1} / ${slides.length}`;
        if (announce && live) {
            const alt = slides[i].querySelector("img")?.alt;
            live.textContent = `${alt ? alt + ", " : ""}image ${i + 1} of ${slides.length}`;
        }
    };

    const enlarged = () => doc.body.classList.contains("colvmn-lightbox-active");
    const stop = () => { clearInterval(timer); timer = null; };
    const play = () => {
        stop();
        if (!autoplay || reduce || hovering || !visible || doc.hidden) return;
        timer = setInterval(() => { if (!enlarged()) show(i + 1, false); }, DWELL);
    };
    const step = d => { show(i + d, true); play(); };

    root.querySelector(".slideshow-prev").addEventListener("click", () => step(-1));
    root.querySelector(".slideshow-next").addEventListener("click", () => step(1));
    // The image's own sides: arrows on hover; on touch screens, a tap on either half.
    root.querySelector(".slideshow-edge-prev")?.addEventListener("click", () => step(-1));
    root.querySelector(".slideshow-edge-next")?.addEventListener("click", () => step(1));
    root.addEventListener("keydown", e => {
        if (enlarged()) return;
        if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
        if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    });

    // Pause while someone is looking closely.
    root.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") { hovering = true; stop(); } });
    root.addEventListener("pointerleave", () => { hovering = false; play(); });
    root.addEventListener("focusin", () => { hovering = true; stop(); });
    root.addEventListener("focusout", e => { if (!root.contains(e.relatedTarget)) { hovering = false; play(); } });
    doc.addEventListener("visibilitychange", play);

    // A swipe moves either way; the click that ends it doesn't enlarge.
    let x0 = null, y0 = 0, swiped = false;
    frame.addEventListener("pointerdown", e => { x0 = e.clientX; y0 = e.clientY; swiped = false; });
    frame.addEventListener("pointerup", e => {
        if (x0 === null) return;
        const dx = e.clientX - x0, dy = e.clientY - y0;
        x0 = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { swiped = true; step(dx < 0 ? 1 : -1); }
    });
    frame.addEventListener("pointercancel", () => { x0 = null; });
    frame.addEventListener("click", e => {
        if (swiped) { swiped = false; e.stopPropagation(); e.preventDefault(); }
    }, true);
    frame.addEventListener("dragstart", e => e.preventDefault());

    // A two-finger trackpad swipe: one step per gesture.
    let acc = 0, quietUntil = 0, idle = null;
    frame.addEventListener("wheel", e => {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        e.preventDefault(); // keep the browser's back/forward gesture out of it
        clearTimeout(idle);
        idle = setTimeout(() => { acc = 0; }, 220);
        if (win.performance.now() < quietUntil) return;
        acc += e.deltaX;
        if (Math.abs(acc) > 60) { step(acc > 0 ? 1 : -1); acc = 0; quietUntil = win.performance.now() + 700; }
    }, { passive: false });

    // Only advance while on screen.
    if (win.IntersectionObserver) {
        new win.IntersectionObserver(([en]) => { visible = en.isIntersecting; play(); }, { threshold: 0.25 }).observe(root);
    }

    show(0, false);
}

export function initSlideshows (doc = document) {
    if (typeof doc === "undefined" || !doc.body) return;
    doc.querySelectorAll(".colvmn-slideshow").forEach(root => initOne(root, doc.defaultView));
}
