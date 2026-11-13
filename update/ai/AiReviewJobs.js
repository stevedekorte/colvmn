/**
 * The two jobs colvmn adds when a site's colvmn.json has "aiReviews", with
 * no update files:
 *
 *   <section>/_models   models.js, daily: the providers' latest top models,
 *                       into _models/models.json, published as a pull request
 *   <section>           reviews.js, daily, when llms-full.txt or models.json
 *                       changed, at most once per "every": the reviews,
 *                       published directly
 *
 * Each is given the providers' keys that have a value: the standard names,
 * or those aiReviews' "keys" gives. Their state files sit in
 * those folders like any job's.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AiReviews, MODELS_FOLDER } from "../../layout/AiReviews.js";
import { UpdateFile } from "../UpdateFile.js";
import { Credentials } from "../Credentials.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The site's built-in AI Reviews update files, or [] without "aiReviews". */
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
    const models = UpdateFile.builtIn({
        siteRoot,
        folder: join(reviews.sectionDir(), MODELS_FOLDER),
        script: join(HERE, "models.js"),
        problems,
        fields: { schedule: "daily", run: "colvmn/update/ai/models.js", writes: [`${section}/${MODELS_FOLDER}/**`], publish: "pr", secrets: keys }
    });
    const writes = [`${section}/*`, ...reviews.providers.map(p => `${section}/${p.name}/**`)];
    if (reviews.about) {
        writes.push(`${section}/${reviews.about}/**`);
    }
    const reviewsJob = UpdateFile.builtIn({
        siteRoot,
        folder: reviews.sectionDir(),
        script: join(HERE, "reviews.js"),
        problems,
        fields: {
            schedule: "daily",
            watch: ["llms-full.txt", `${section}/${MODELS_FOLDER}/models.json`],
            minInterval: reviews.every,
            run: "colvmn/update/ai/reviews.js",
            writes,
            publish: "direct",
            secrets: keys
        }
    });
    return [models, reviewsJob];
}
