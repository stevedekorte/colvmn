import { ContentBase } from "./ContentBase.js";
import { ContentText } from "./ContentText.js";
import { ContentCards } from "./ContentCards.js";
import { ContentKeyValue } from "./ContentKeyValue.js";
import { ContentUnorderedList } from "./ContentUnorderedList.js";
import { ContentOrderedList } from "./ContentOrderedList.js";
import { ContentTable } from "./ContentTable.js";
import { ContentImage } from "./ContentImage.js";
import { ContentTimeline } from "./ContentTimeline.js";
import { ContentToc } from "./ContentToc.js";
import { ContentFAQ } from "./ContentFAQ.js";
import { ContentClassDoc } from "./ContentClassDoc.js";
import { ContentComparisonTable } from "./ContentComparisonTable.js";
import { PageIndex } from "./PageIndex.js";
import { initLightbox } from "./Lightbox.js";

ContentBase.typeMap = {
    ContentText,
    ContentCards,
    ContentKeyValue,
    ContentUnorderedList,
    ContentOrderedList,
    ContentTable,
    ContentImage,
    ContentTimeline,
    ContentToc,
    ContentFAQ,
    ContentClassDoc,
    ContentComparisonTable,
};

// Browser bootstrap. PageIndex.init() runs the runtime pass (loadPage + render);
// on built pages render() only attaches behavior, it does not rebuild the HTML —
// see PageIndex and colvmn/CLAUDE.md ("Rendering model"). Page-global runtime
// behavior that isn't tied to a single content block (e.g. a delegated lightbox
// handler) belongs here, alongside the init() call.
document.addEventListener("DOMContentLoaded", () => {
    new PageIndex().init();
    initLightbox();
});
