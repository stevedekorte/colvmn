#!/usr/bin/env node

/**
 * The AI Reviews job. Each run first finds each provider's latest top model,
 * then asks the ones whose review is out of date to review the site, and
 * publishes each answer as written.
 *
 * 1. Models. For each provider with a key, its API's model list; then Claude,
 *    with web search, chooses the top one from each list (ModelChooser.js).
 *    The choice is recorded in <section>/_models/models.json. A provider
 *    entry in colvmn.json with "model" pins it instead.
 * 2. Reviews. A review is made from llms-full.txt (stamp line aside), the
 *    model and the prompt; a provider whose current review was made from the
 *    same is skipped, at no cost. Otherwise its model is sent the prompt with
 *    llms-full.txt attached, the answer is read (build stamp, verdict,
 *    review), the current review moves to the archive and the new one is
 *    written. One provider failing doesn't stop the others.
 *
 * As a built-in job the runner gives it the keys and commits what it
 * writes. It can also be run by hand from the site root, reading the keys
 * itself, to check before paying for reviews:
 *
 *   node colvmn/update/ai/reviews.js --models          # only choose the models, and show them
 *   node colvmn/update/ai/reviews.js --only Gemini     # one provider (writes; commit it yourself)
 *
 * Exits 0 when it wrote something, 3 when nothing changed (no trace), 1 when
 * nothing was written and something failed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AiReviews } from "../../layout/AiReviews.js";
import { Credentials } from "../Credentials.js";
import { providerFor } from "./Providers.js";
import { askClaude, chooserPrompt, validChoices } from "./ModelChooser.js";
import { archiveReview, defaultAboutMarkdown, defaultSectionMarkdown, frontmatterValue, inputHash, parseAnswer, reviewMarkdown, reviewMessage, writePage } from "./ReviewPages.js";

const NOTHING_TO_DO = 3;
const UNITS = { m: "minute", h: "hour", d: "day", w: "week" };
const HERE = dirname(fileURLToPath(import.meta.url));

export function parseArgs (argv) {
    const options = { modelsOnly: false, only: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--models") {
            options.modelsOnly = true;
        } else if (argv[i] === "--only") {
            options.only = argv[++i].split(",");
        } else {
            throw new Error(`unknown option ${argv[i]}`);
        }
    }
    return options;
}

export async function main (argv = [], env = process.env, today = new Date().toISOString().slice(0, 10)) {
    const options = parseArgs(argv);
    const siteRoot = env.COLVMN_SITE_ROOT || resolve(HERE, "..", "..", "..");
    const reviews = AiReviews.forSiteRoot(siteRoot);
    if (!reviews) {
        console.log(`no aiReviews in ${siteRoot}/colvmn.json`);
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
    const llmsPath = join(siteRoot, "llms-full.txt");
    if (!existsSync(llmsPath)) {
        console.log("no llms-full.txt; build the site first");
        return 1;
    }
    const llmsFull = readFileSync(llmsPath, "utf8");
    const due = providers.filter(p => models[p.name]);
    const outcomes = await Promise.all(due.map(p => reviewOne(reviews, p, models[p.name], llmsFull, keyOf(p), env, today)));
    outcomes.forEach(o => console.log(`${o.provider}: ${o.message}`));
    const written = outcomes.filter(o => o.written).length;
    if (written > 0) {
        writeDefaultPages(reviews);
    }
    if (written > 0 || wroteModels) {
        return 0;
    }
    return outcomes.some(o => o.failed) ? 1 : NOTHING_TO_DO;
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

async function reviewOne (reviews, provider, model, llmsFull, key, env, today) {
    const dir = join(reviews.sectionDir(), provider.name);
    const hash = inputHash(llmsFull, model.id, reviews.fullPrompt());
    const currentPath = join(dir, "_index.md");
    if (existsSync(currentPath) && frontmatterValue(readFileSync(currentPath, "utf8"), "inputHash") === hash) {
        return { provider: provider.name, message: "up to date" };
    }
    try {
        const answer = await providerFor(provider.name, env).review(key, model.id, reviewMessage(reviews.fullPrompt(), llmsFull));
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
    try {
        process.exitCode = await main(process.argv.slice(2));
    } catch (e) {
        console.error(e.message);
        process.exitCode = 1;
    }
}
