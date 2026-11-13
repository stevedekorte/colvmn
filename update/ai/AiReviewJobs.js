/**
 * The job colvmn adds when a site's colvmn.json has "aiReviews", with no
 * update file: <section>, running reviews.js on the aiReviews "schedule"
 * (monthly by default). Each run first chooses each provider's latest top
 * model, then reviews only the providers whose docs or model changed; it
 * publishes directly.
 * It is given the providers' keys that have a value: the standard names, or
 * those aiReviews' "keys" gives. Its state file sits in the section folder.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AiReviews, MODELS_FOLDER } from "../../layout/AiReviews.js";
import { UpdateFile } from "../UpdateFile.js";
import { Credentials } from "../Credentials.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The site's built-in AI Reviews update file, or [] without "aiReviews". */
export function aiReviewUpdateFiles (siteRoot, env = process.env) {
    const reviews = AiReviews.forSiteRoot(siteRoot);
    if (!reviews) {
        return [];
    }
    const credentials = new Credentials(siteRoot, env);
    const names = reviews.producible().map(p => p.key);
    const keys = names.filter(k => !credentials.resolve(k, reviews.sectionDir()).problem);
    const problems = keys.length ? [] : [`no AI provider key has a value: set one of ${names.join(", ")}`];
    const section = reviews.folder;
    const writes = [`${section}/*`, `${section}/${MODELS_FOLDER}/**`, ...reviews.providers.map(p => `${section}/${p.name}/**`)];
    if (reviews.about) {
        writes.push(`${section}/${reviews.about}/**`);
    }
    const reviewsJob = UpdateFile.builtIn({
        siteRoot,
        folder: reviews.sectionDir(),
        script: join(HERE, "reviews.js"),
        problems,
        fields: {
            schedule: reviews.schedule,
            run: "colvmn/update/ai/reviews.js",
            writes,
            publish: "direct",
            secrets: keys
        }
    });
    return [reviewsJob];
}
