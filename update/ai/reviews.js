#!/usr/bin/env node

/**
 * The AI Reviews job: asks each provider's confirmed top model (from
 * <section>/_models/models.json) to review the site, and publishes each
 * answer as written. A built-in job: the runner adds it when colvmn.json has
 * "aiReviews", runs it when llms-full.txt or models.json changed, at most
 * once per "every" (default 30d), and commits what it writes.
 *
 * For each provider with a key and a model: the review is made from
 * llms-full.txt (stamp line aside), the model and the prompt; when those are
 * what the current review was made from, the provider is skipped. Otherwise
 * the model is sent the prompt with llms-full.txt attached, its answer is
 * read (build stamp, verdict, review), the current review moves to the
 * archive and the new one is written. One provider failing doesn't stop the
 * others. The section page and the about page get default text when the
 * site hasn't written them.
 *
 * Exits 0 when it wrote a review, 3 when every provider was up to date (no
 * trace), 1 when nothing was written and a provider failed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AiReviews } from "../../layout/AiReviews.js";
import { providerFor } from "./Providers.js";
import { archiveReview, buildStampOf, defaultAboutMarkdown, defaultSectionMarkdown, frontmatterValue, inputHash, parseAnswer, reviewMarkdown, reviewMessage, writePage } from "./ReviewPages.js";

const NOTHING_TO_DO = 3;
const UNITS = { m: "minute", h: "hour", d: "day", w: "week" };

export async function main (env = process.env, today = new Date().toISOString().slice(0, 10)) {
    const reviews = AiReviews.forSiteRoot(env.COLVMN_SITE_ROOT);
    const llmsPath = join(env.COLVMN_SITE_ROOT, "llms-full.txt");
    if (!existsSync(llmsPath)) {
        console.log("no llms-full.txt; build the site first");
        return 1;
    }
    const llmsFull = readFileSync(llmsPath, "utf8");
    const models = existsSync(reviews.modelsPath()) ? JSON.parse(readFileSync(reviews.modelsPath(), "utf8")) : {};
    const due = reviews.producible().filter(p => env[p.key] && models[p.name] && providerFor(p.name, env));
    if (due.length === 0) {
        console.log("no provider has both a key and a confirmed model (run the models job and merge its pull request)");
        return NOTHING_TO_DO;
    }
    const outcomes = await Promise.all(due.map(p => reviewOne(reviews, p, models[p.name], llmsFull, env, today)));
    outcomes.forEach(o => console.log(`${o.provider}: ${o.message}`));
    const written = outcomes.filter(o => o.written).length;
    if (written > 0) {
        writeDefaultPages(reviews);
        return 0;
    }
    return outcomes.some(o => o.failed) ? 1 : NOTHING_TO_DO;
}

async function reviewOne (reviews, provider, model, llmsFull, env, today) {
    const dir = join(reviews.sectionDir(), provider.name);
    const hash = inputHash(llmsFull, model.id, reviews.fullPrompt());
    const currentPath = join(dir, "_index.md");
    if (existsSync(currentPath) && frontmatterValue(readFileSync(currentPath, "utf8"), "inputHash") === hash) {
        return { provider: provider.name, message: "up to date" };
    }
    try {
        const answer = await providerFor(provider.name, env).review(env[provider.key], model.id, reviewMessage(reviews.fullPrompt(), llmsFull));
        const parsed = parseAnswer(answer.text);
        if (!parsed.body) {
            throw new Error(`${model.id} gave an empty answer`);
        }
        const archived = archiveReview(dir);
        writePage(dir, reviewMarkdown(provider.name, { ...parsed, modelName: model.name, model: model.id, reviewed: today, inputHash: hash }));
        const tokens = answer.usage?.input ? ` (${answer.usage.input} tokens in, ${answer.usage.output} out)` : "";
        return { provider: provider.name, written: true, message: `reviewed by ${model.id}${tokens}${archived ? `; the previous review is in archive/${archived}` : ""}${parsed.stamp ? "" : "; it didn't quote the build stamp"}` };
    } catch (e) {
        return { provider: provider.name, failed: true, message: `failed: ${e.message}` };
    }
}

/** The section and about pages, when the site hasn't written its own. */
function writeDefaultPages (reviews) {
    const section = reviews.sectionDir();
    writePage(section, existsSync(join(section, "_index.md")) ? null : defaultSectionMarkdown(reviews.folder.split("/").pop()));
    if (reviews.about) {
        const about = join(section, reviews.about);
        writePage(about, existsSync(join(about, "_index.md")) ? null : defaultAboutMarkdown(reviews.about, humanInterval(reviews.every)));
    }
}

function humanInterval (every) {
    const m = String(every).match(/^(\d+)\s*([mhdw])$/);
    return m ? `${m[1]} ${UNITS[m[2]]}${m[1] === "1" ? "" : "s"}` : every;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await main();
}
