/**
 * Choosing each provider's latest top model: Claude, with web search, reads
 * the model IDs each provider's API lists for its key and the providers' own
 * announcements, and names the most capable one per provider. Model names
 * change shape between generations (Gemini 4 is "Argon", "Carbon",
 * "Hydrogen"), so no fixed rule can tell; a model that can read the
 * announcements can.
 *
 * Only IDs from a provider's own list are accepted, so a mistaken or
 * invented ID can't get through. A provider Claude can't choose for is
 * skipped, never guessed.
 */

import { requestJson } from "./Providers.js";

const CHOOSER_MODEL = "claude-opus-5-5";
const CHOOSER_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CONTINUATIONS = 6;

/**
 * The question Claude is asked.
 * @param {Object<string, {company: string, ids: string[]}>} lists - per provider
 * @param {string} today - YYYY-MM-DD
 */
export function chooserPrompt (lists, today) {
    const sections = Object.entries(lists).map(([name, l]) => `## ${name} (${l.company})\n${l.ids.join("\n")}`).join("\n\n");
    return `Today is ${today}. For each AI provider below, choose its most capable model for writing a careful, long-form evaluation of a software project: the model the provider itself presents as its newest, strongest frontier model.

Use web search to check each provider's own announcements and documentation; don't rely on what you remember, since models change often. Prefer generally available models; a preview counts only when the provider has nothing more capable that is generally available. Leave out models made for a narrower job: image, audio, video, embedding, transcription, robotics, computer use, deep research agents, custom-tools variants, and smaller, faster or cheaper tiers.

Choose only from the model IDs listed for that provider: they are what its API offers this account. If you can't tell, say so rather than guess.

Answer with one JSON object and nothing after it:
{"<provider>": {"id": "<an ID from its list, or null>", "name": "<the model's full public name>", "source": "<URL of the provider's page that supports the choice>", "why": "<one sentence>"}}

${sections}`;
}

/** The JSON object at the end of Claude's answer. */
export function parseChoice (text) {
    const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]);
    const candidates = fenced.length ? fenced.reverse() : [text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
    for (const c of candidates) {
        try {
            return JSON.parse(c);
        } catch {
            // try the next
        }
    }
    throw new Error("Claude's answer had no JSON choice in it");
}

/**
 * Asks Claude to choose. Continues the turn while the API pauses it (long
 * web searches return stop_reason "pause_turn").
 * @returns {Promise<Object>} the parsed choice
 */
export async function askClaude (key, prompt, env = process.env) {
    const base = (env.COLVMN_AI_BASE_CLAUDE || "https://api.anthropic.com").replace(/\/+$/, "");
    const headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
    const messages = [{ role: "user", content: prompt }];
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
        const r = await requestJson("POST", `${base}/v1/messages`, headers, {
            model: CHOOSER_MODEL,
            max_tokens: 16000,
            output_config: { effort: "medium" },
            tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 30 }],
            messages
        }, CHOOSER_TIMEOUT_MS);
        if (r.stop_reason === "pause_turn") {
            messages.push({ role: "assistant", content: r.content });
            continue;
        }
        if (r.stop_reason === "refusal") {
            throw new Error("Claude declined to choose");
        }
        const text = (r.content || []).filter(b => b.type === "text").map(b => b.text).join("");
        const choice = parseChoice(text);
        Object.defineProperty(choice, "answerText", { value: text });   // for the log when a choice is missing
        return choice;
    }
    throw new Error("Claude didn't finish choosing");
}

/**
 * Keeps only choices whose ID is in that provider's list.
 * @returns {{ chosen: Object<string, {id, name, source, why}>, rejected: string[] }}
 */
export function validChoices (choice, lists) {
    const chosen = {}, rejected = [];
    const keyFor = name => Object.keys(choice).find(k => k.toLowerCase().startsWith(name.toLowerCase()));
    for (const [name, l] of Object.entries(lists)) {
        const c = choice[keyFor(name)];
        if (!c || !c.id) {
            rejected.push(`${name}: no choice${c?.why ? ` (${c.why})` : ""}`);
        } else if (!l.ids.includes(c.id)) {
            rejected.push(`${name}: ${c.id} isn't in its model list`);
        } else {
            chosen[name] = { id: c.id, name: c.name || c.id, source: c.source || null, why: c.why || null };
        }
    }
    return { chosen, rejected };
}
