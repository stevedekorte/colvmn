#!/usr/bin/env node

/**
 * The AI Reviews job. Each run first finds each provider's latest top model,
 * then, for each opted-in page ("aiReviews": true), asks the ones whose
 * review of that page's folder is out of date to review it, and publishes
 * each answer as written.
 *
 * 1. Models. For each provider with a key, its API's model list; then Claude,
 *    with web search, chooses the top one from each list (ModelChooser.js).
 *    The choice is made once per run, shared by every page, and recorded in
 *    <folder>/_models/models.json at the site root. A provider entry in
 *    colvmn.json with "model" pins it instead.
 * 2. Reviews, page by page. A review is made from the page's llms-full.txt
 *    (the site's for the root, <page>/llms-full.txt otherwise; stamp line
 *    aside), the model and the page's prompt; a provider whose current
 *    review was made from the same is skipped, at no cost. Otherwise its
 *    model is sent the prompt with that llms-full.txt attached, the answer is
 *    read (build stamp, verdict, review), the current review moves to the
 *    archive and the new one is written. One provider or page failing
 *    doesn't stop the others.
 *
 * As a built-in job the runner gives it the keys and commits what it
 * writes. It can also be run by hand from the site root, reading the keys
 * itself, to check before paying for reviews:
 *
 *   node colvmn/update/ai/reviews.js --models          # only choose the models, and show them
 *   node colvmn/update/ai/reviews.js --only Gemini     # one provider (writes; commit it yourself)
 *   node colvmn/update/ai/reviews.js --scope docs/Guide   # one opted-in page ("." for the root)
 *
 * Exits 0 when it wrote something, 3 when nothing changed (no trace), 1 when
 * nothing was written and something failed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AiReviews } from "../../layout/AiReviews.js";
import { Credentials } from "../Credentials.js";
import { defaultSiteRoot } from "../SiteRoot.js";
import { providerFor } from "./Providers.js";
import { askClaude, chooserPrompt, validChoices } from "./ModelChooser.js";
import { archiveReview, defaultSectionMarkdown, frontmatterValue, inputHash, parseAnswer, reviewMarkdown, reviewMessage, writePage } from "./ReviewPages.js";

const NOTHING_TO_DO = 3;
const HERE = dirname(fileURLToPath(import.meta.url));

export function parseArgs (argv) {
    const options = { modelsOnly: false, only: null, scope: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--models") {
            options.modelsOnly = true;
        } else if (argv[i] === "--only") {
            options.only = argv[++i].split(",");
        } else if (argv[i] === "--scope") {
            options.scope = argv[++i].replace(/^\.\/?|\/+$/g, "");
        } else {
            throw new Error(`unknown option ${argv[i]}`);
        }
    }
    return options;
}

/** A date as YYYY-MM-DD in the machine's own time zone (toISOString would give UTC's date). */
export function localDate (date = new Date()) {
    const pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function main (argv = [], env = process.env, today = localDate()) {
    const options = parseArgs(argv);
    const siteRoot = env.COLVMN_SITE_ROOT || defaultSiteRoot(resolve(HERE, "..", ".."));
    const reviews = AiReviews.forSiteRoot(siteRoot);
    if (!reviews) {
        console.log(`no aiReviews in ${siteRoot}/colvmn.json`);
        return 1;
    }
    const scopes = reviews.scopes().filter(s => options.scope === null || s.rel === options.scope);
    if (reviews.scopes().length === 0) {
        console.log("no page opts in to AI reviews: add \"aiReviews\": true to the root page, or to any page whose folder should be reviewed");
        return NOTHING_TO_DO;
    }
    if (scopes.length === 0) {
        console.log(`no opted-in page at ${options.scope}; the opted-in pages are: ${reviews.scopes().map(s => s.rel || ".").join(", ")}`);
        return 1;
    }
    const credentials = new Credentials(siteRoot, env);
    const keyOf = p => env[p.key] || credentials.resolve(p.key, siteRoot).value || null;
    const providers = reviews.producible().filter(p => keyOf(p) && providerFor(p.name, env) && (!options.only || options.only.includes(p.name)));
    if (providers.length === 0) {
        console.log("no provider has a key");
        return NOTHING_TO_DO;
    }
    const claude = reviews.producible().find(p => p.name === "Claude");
    const models = await chooseModels(reviews, providers, claude && keyOf(claude), keyOf, env, today);
    const wroteModels = recordModels(reviews, models);
    if (options.modelsOnly) {
        return 0;
    }
    const due = providers.filter(p => models[p.name]);
    let written = 0, failed = false;
    for (const scope of scopes) {
        // The root's lines read as before; another page's are prefixed with its path.
        const tag = scope.isRoot ? "" : `${scope.rel}: `;
        const llmsPath = scope.llmsFullPath();
        if (!existsSync(llmsPath)) {
            console.log(`${tag}no ${relative(siteRoot, llmsPath)}; build the site first`);
            failed = true;
            continue;
        }
        const llmsFull = readFileSync(llmsPath, "utf8");
        const outcomes = await Promise.all(due.map(p => reviewOne(scope, p, models[p.name], llmsFull, keyOf(p), env, today)));
        outcomes.forEach(o => console.log(`${tag}${o.provider}: ${o.message}`));
        const wroteHere = outcomes.filter(o => o.written).length;
        if (wroteHere > 0) {
            writeDefaultPage(scope);
        }
        written += wroteHere;
        failed = failed || outcomes.some(o => o.failed);
    }
    if (written > 0 || wroteModels) {
        return 0;
    }
    return failed ? 1 : NOTHING_TO_DO;
}

/**
 * Each provider's model: pinned in colvmn.json, else chosen by Claude from
 * the provider's list. A provider with neither isn't reviewed: names alone
 * can't say which model is top (they change shape between generations).
 */
async function chooseModels (reviews, providers, claudeKey, keyOf, env, today) {
    const lists = {}, models = {};
    for (const p of providers) {
        if (p.model) {
            models[p.name] = { id: p.model, name: p.model, source: "pinned in colvmn.json" };
            continue;
        }
        try {
            lists[p.name] = { company: p.company, ids: await providerFor(p.name, env).modelIds(keyOf(p)) };
        } catch (e) {
            console.log(`${p.name}: couldn't list models: ${e.message}`);
        }
    }
    if (Object.keys(lists).length === 0) {
        return models;
    }
    if (!claudeKey) {
        console.log("no Claude key to choose the models with: only pinned models are reviewed");
        return models;
    }
    try {
        const choice = await askClaude(claudeKey, chooserPrompt(lists, today), env);
        const { chosen, rejected } = validChoices(choice, lists);
        if (rejected.length) {
            rejected.forEach(r => console.log(`no model chosen this run: ${r}`));
            console.log(`Claude's answer ended: ${String(choice.answerText || "").slice(-600)}`);
        }
        Object.assign(models, chosen);
    } catch (e) {
        console.log(`couldn't ask Claude to choose the models: ${e.message}`);
    }
    // A provider not chosen this run keeps the model Claude chose last time, if it's still listed; one never chosen is skipped.
    const recorded = existsSync(reviews.modelsPath()) ? JSON.parse(readFileSync(reviews.modelsPath(), "utf8")) : {};
    for (const name of Object.keys(lists).filter(n => !models[n])) {
        const last = recorded[name];
        if (last && last.source && !/guessed/.test(last.source) && lists[name].ids.includes(last.id)) {
            models[name] = last;
            console.log(`${name}: keeping the last choice, ${last.id}`);
        } else {
            console.log(`${name}: skipped (no model chosen)`);
        }
    }
    for (const [name, m] of Object.entries(models)) {
        console.log(`${name}: ${m.id} (${m.name})${m.source ? ` — ${m.source}` : ""}`);
    }
    return models;
}

/** Records the models in models.json; whether it changed. */
function recordModels (reviews, models) {
    const path = reviews.modelsPath();
    const current = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    const next = { ...current, ...models };
    if (JSON.stringify(next) === JSON.stringify(current)) {
        return false;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 4) + "\n");
    return true;
}

async function reviewOne (scope, provider, model, llmsFull, key, env, today) {
    const dir = join(scope.sectionDir(), provider.name);
    const hash = inputHash(llmsFull, model.id, scope.fullPrompt());
    const currentPath = join(dir, "_index.md");
    if (existsSync(currentPath) && frontmatterValue(readFileSync(currentPath, "utf8"), "inputHash") === hash) {
        return { provider: provider.name, message: "up to date" };
    }
    try {
        const answer = await providerFor(provider.name, env).review(key, model.id, reviewMessage(scope.fullPrompt(), llmsFull, scope.isRoot));
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

/** A scope's reviews page, when the site hasn't written its own. */
function writeDefaultPage (scope) {
    const section = scope.sectionDir();
    writePage(section, existsSync(join(section, "_index.md")) ? null : defaultSectionMarkdown(scope.folder.split("/").pop(), scope.isRoot));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        process.exitCode = await main(process.argv.slice(2));
    } catch (e) {
        console.error(e.message);
        process.exitCode = 1;
    }
}
