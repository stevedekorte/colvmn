/**
 * The AI providers colvmn can get reviews from: for each, how to list its
 * models, which one is its latest top model, and how to ask it for a review.
 * Plain HTTPS, no SDKs (colvmn has no dependencies), with a long timeout
 * since a review of a whole site's docs can take minutes.
 *
 * Picking the "latest top model" is a guess, because a model list says what
 * exists, not what is top: the newest model of the provider's flagship
 * family, leaving out smaller, faster and dated variants. The models job
 * publishes its guess as a pull request, so a person confirms it before any
 * review uses it.
 *
 * COLVMN_AI_BASE_<NAME> (e.g. COLVMN_AI_BASE_CLAUDE) replaces a provider's
 * API address; the tests use it to talk to a local stand-in.
 */

import http from "node:http";
import https from "node:https";

const REVIEW_TIMEOUT_MS = 25 * 60 * 1000;
const LIST_TIMEOUT_MS = 60 * 1000;
const MAX_OUTPUT_TOKENS = 32000;

/**
 * One JSON request. Errors name the status and the service's message, never
 * the request's headers (which hold the key).
 * @returns {Promise<Object>}
 */
export function requestJson (method, url, headers, body = null, timeoutMs = LIST_TIMEOUT_MS) {
    const u = new URL(url);
    const transport = u.protocol === "http:" ? http : https;
    const payload = body === null ? null : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = transport.request(u, {
            method,
            headers: { ...headers, ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) },
            timeout: timeoutMs
        }, res => {
            const chunks = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                let json = null;
                try {
                    json = JSON.parse(text);
                } catch {
                    // not JSON; reported below
                }
                if (res.statusCode >= 200 && res.statusCode < 300 && json) {
                    resolve(json);
                } else {
                    const message = json?.error?.message || json?.message || text.slice(0, 200);
                    reject(new Error(`${u.host} answered ${res.statusCode}: ${message}`));
                }
            });
        });
        req.on("timeout", () => req.destroy(new Error(`${u.host} didn't answer within ${Math.round(timeoutMs / 60000)} minutes`)));
        req.on("error", reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

/** Compares "5.1" and "5" as version numbers. */
export function compareVersions (a, b) {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) {
            return d;
        }
    }
    return 0;
}

/** The entry with the highest version, from entries with a `version`. */
function highestVersion (entries) {
    return entries.reduce((best, e) => (!best || compareVersions(e.version, best.version) > 0 ? e : best), null);
}

class Provider {

    constructor (name, defaultBase, env = process.env) {
        this.name = name;
        this.base = (env[`COLVMN_AI_BASE_${name.toUpperCase()}`] || defaultBase).replace(/\/+$/, "");
    }

    /** The latest top model: { id, name }, or null when none is found. */
    async latestTopModel (key) {
        return this.pickTop(await this.listModels(key));
    }
}

/** Anthropic's Claude: the newest Fable model, else the newest Opus. */
class ClaudeProvider extends Provider {

    constructor (env) {
        super("Claude", "https://api.anthropic.com", env);
    }

    headers (key) {
        return { "x-api-key": key, "anthropic-version": "2023-06-01" };
    }

    async listModels (key) {
        const models = [];
        let after = null;
        do {
            const page = await requestJson("GET", `${this.base}/v1/models?limit=1000${after ? "&after_id=" + encodeURIComponent(after) : ""}`, this.headers(key));
            models.push(...(page.data || []));
            after = page.has_more ? page.last_id : null;
        } while (after);
        return models;
    }

    pickTop (models) {
        for (const family of ["fable", "opus"]) {
            const found = models
                .filter(m => new RegExp(`^claude-${family}-`).test(m.id))
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            if (found.length) {
                return { id: found[0].id, name: found[0].display_name || found[0].id };
            }
        }
        return null;
    }

    async review (key, model, text) {
        const r = await requestJson("POST", `${this.base}/v1/messages`, this.headers(key), {
            model,
            max_tokens: MAX_OUTPUT_TOKENS,
            output_config: { effort: "high" },
            messages: [{ role: "user", content: text }]
        }, REVIEW_TIMEOUT_MS);
        if (r.stop_reason === "refusal") {
            throw new Error(`${model} declined to answer${r.stop_details?.category ? ` (${r.stop_details.category})` : ""}`);
        }
        if (r.stop_reason === "max_tokens") {
            throw new Error(`${model}'s answer was cut off at ${MAX_OUTPUT_TOKENS} tokens`);
        }
        const answer = (r.content || []).filter(b => b.type === "text").map(b => b.text).join("");
        return { text: answer, usage: { input: r.usage?.input_tokens, output: r.usage?.output_tokens } };
    }
}

/** An OpenAI-style API (OpenAI, xAI): models named "<prefix>-<version>", the highest version without a suffix. */
class ChatCompletionsProvider extends Provider {

    constructor (name, defaultBase, idPattern, displayName, env) {
        super(name, defaultBase, env);
        this.idPattern = idPattern;
        this.displayName = displayName;
    }

    headers (key) {
        return { authorization: `Bearer ${key}` };
    }

    async listModels (key) {
        return (await requestJson("GET", `${this.base}/v1/models`, this.headers(key))).data || [];
    }

    pickTop (models) {
        const best = highestVersion(models
            .map(m => ({ id: m.id, match: m.id.match(this.idPattern) }))
            .filter(m => m.match)
            .map(m => ({ id: m.id, version: m.match[1] })));
        return best ? { id: best.id, name: this.displayName(best.version) } : null;
    }

    async review (key, model, text) {
        const r = await requestJson("POST", `${this.base}/v1/chat/completions`, this.headers(key), {
            model,
            messages: [{ role: "user", content: text }],
            max_completion_tokens: MAX_OUTPUT_TOKENS
        }, REVIEW_TIMEOUT_MS);
        const choice = r.choices?.[0];
        if (!choice) {
            throw new Error(`${model} returned no answer`);
        }
        if (choice.message?.refusal) {
            throw new Error(`${model} declined to answer`);
        }
        if (choice.finish_reason === "length") {
            throw new Error(`${model}'s answer was cut off at ${MAX_OUTPUT_TOKENS} tokens`);
        }
        return { text: choice.message?.content || "", usage: { input: r.usage?.prompt_tokens, output: r.usage?.completion_tokens } };
    }
}

/** Google's Gemini: the highest-numbered Pro model, a stable one over a preview of the same version. */
class GeminiProvider extends Provider {

    constructor (env) {
        super("Gemini", "https://generativelanguage.googleapis.com", env);
    }

    headers (key) {
        return { "x-goog-api-key": key };
    }

    async listModels (key) {
        const models = [];
        let token = null;
        do {
            const page = await requestJson("GET", `${this.base}/v1beta/models?pageSize=1000${token ? "&pageToken=" + encodeURIComponent(token) : ""}`, this.headers(key));
            models.push(...(page.models || []));
            token = page.nextPageToken || null;
        } while (token);
        return models;
    }

    pickTop (models) {
        const candidates = models
            .filter(m => (m.supportedGenerationMethods || ["generateContent"]).includes("generateContent"))
            .map(m => ({ m, id: String(m.name).replace(/^models\//, "") }))
            .map(c => ({ ...c, match: c.id.match(/^gemini-(\d+(?:\.\d+)?)-pro(-preview)?$/) }))
            .filter(c => c.match)
            .map(c => ({ ...c, version: c.match[1], preview: Boolean(c.match[2]) }));
        const top = highestVersion(candidates);
        if (!top) {
            return null;
        }
        const best = candidates.find(c => c.version === top.version && !c.preview) || top;
        return { id: best.id, name: best.m.displayName || best.id };
    }

    async review (key, model, text) {
        const r = await requestJson("POST", `${this.base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, this.headers(key), {
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS }
        }, REVIEW_TIMEOUT_MS);
        const candidate = r.candidates?.[0];
        if (!candidate) {
            throw new Error(`${model} returned no answer${r.promptFeedback?.blockReason ? ` (blocked: ${r.promptFeedback.blockReason})` : ""}`);
        }
        if (candidate.finishReason === "MAX_TOKENS") {
            throw new Error(`${model}'s answer was cut off at ${MAX_OUTPUT_TOKENS} tokens`);
        }
        const answer = (candidate.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
        return { text: answer, usage: { input: r.usageMetadata?.promptTokenCount, output: r.usageMetadata?.candidatesTokenCount } };
    }
}

/** The adapter for a built-in provider, by name, or null. */
export function providerFor (name, env = process.env) {
    switch (name) {
        case "Claude": return new ClaudeProvider(env);
        case "ChatGPT": return new ChatCompletionsProvider("ChatGPT", "https://api.openai.com", /^gpt-(\d+(?:\.\d+)?)$/, v => `GPT-${v}`, env);
        case "Gemini": return new GeminiProvider(env);
        case "Grok": return new ChatCompletionsProvider("Grok", "https://api.x.ai", /^grok-(\d+(?:\.\d+)?)$/, v => `Grok ${v}`, env);
        default: return null;
    }
}
