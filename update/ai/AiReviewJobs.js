/**
 * The job colvmn adds when a site's colvmn.json has "aiReviews", with no
 * update file: <folder> at the site root, running reviews.js on the aiReviews
 * "schedule" (monthly by default). Each run first chooses each provider's
 * latest top model, then, for every opted-in page, reviews only the
 * providers whose content or model changed; it publishes directly.
 * It is given the providers' keys that have a value: the standard names, or
 * those aiReviews' "keys" gives. It may write each opted-in page's reviews
 * folder and the shared model choice; its state file sits in the root's
 * reviews folder.
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
    const keys = names.filter(k => !credentials.resolve(k, reviews.jobDir()).problem);
    const problems = keys.length ? [] : [`no AI provider key has a value: set one of ${names.join(", ")}`];
    const scopes = reviews.scopes();
    if (scopes.length === 0) {
        problems.push("no page opts in: add \"aiReviews\": true to the root page, or to any page whose folder should be reviewed");
    }
    const writes = [`${reviews.folder}/${MODELS_FOLDER}/**`];
    for (const scope of scopes) {
        const section = scope.rel ? `${scope.rel}/${reviews.folder}` : reviews.folder;
        writes.push(`${section}/*`, ...reviews.providers.map(p => `${section}/${p.name}/**`));
    }
    const reviewsJob = UpdateFile.builtIn({
        siteRoot,
        folder: reviews.jobDir(),
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
