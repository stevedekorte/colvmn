#!/usr/bin/env node

/**
 * The AI Reviews models job: finds each provider's latest top model and,
 * when one differs from <section>/_models/models.json, updates it. The
 * runner publishes the change as a pull request, so a person confirms the
 * guess before the reviews job uses it. A built-in job: the runner adds it
 * when colvmn.json has "aiReviews" (see UpdateJobs.js).
 *
 * Gets the providers' keys it has (ANTHROPIC_API_KEY, ..., or the names
 * aiReviews' "keys" gives) and COLVMN_SITE_ROOT.
 * A provider without a key is left as it is. A provider entry in colvmn.json
 * with "model" pins that model instead of looking.
 * Exits 0 when models.json changed, 3 when nothing did, 1 when every
 * provider it tried failed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { AiReviews } from "../../layout/AiReviews.js";
import { providerFor } from "./Providers.js";

const NOTHING_TO_DO = 3;

export async function main (env = process.env) {
    const reviews = AiReviews.forSiteRoot(env.COLVMN_SITE_ROOT);
    const path = reviews.modelsPath();
    const current = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    const next = { ...current };
    let tried = 0, failed = 0;
    for (const p of reviews.producible()) {
        const key = env[p.key];
        const adapter = providerFor(p.name, env);
        if (!key || !adapter) {
            continue;
        }
        tried++;
        try {
            const top = p.model ? { id: p.model, name: current[p.name]?.id === p.model ? current[p.name].name : p.model } : await adapter.latestTopModel(key);
            if (!top) {
                console.log(`${p.name}: no model matched; left as it is`);
            } else if (current[p.name]?.id !== top.id) {
                console.log(`${p.name}: ${current[p.name]?.id || "(none)"} -> ${top.id} (${top.name})`);
                next[p.name] = top;
            }
        } catch (e) {
            failed++;
            console.log(`${p.name}: couldn't list models: ${e.message}`);
        }
    }
    if (tried > 0 && failed === tried) {
        return 1;
    }
    if (JSON.stringify(next) === JSON.stringify(current)) {
        return NOTHING_TO_DO;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 4) + "\n");
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await main();
}
