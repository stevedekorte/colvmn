/**
 * The AI providers colvmn can get reviews from: for each, how to list its
 * models and how to ask it for a review.
 * Plain HTTPS, no SDKs (colvmn has no dependencies), with a long timeout
 * since a review of a whole site's docs can take minutes.
 *
 * Which listed model is the provider's top one is chosen by Claude with web
 * search (ModelChooser.js), not by its name.
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

class Provider {

    constructor (name, defaultBase, env = process.env) {
        this.name = name;
        this.base = (env[`COLVMN_AI_BASE_${name.toUpperCase()}`] || defaultBase).replace(/\/+$/, "");
    }

    /** The model IDs this provider's API lists for a key. */
    async modelIds (key) {
        return (await this.listModels(key)).map(m => this.idOf(m));
    }

    idOf (m) {
        return m.id;
    }
}

/** Anthropic's Claude. */
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

/** An OpenAI-style API (OpenAI, xAI). */
class ChatCompletionsProvider extends Provider {

    constructor (name, defaultBase, env) {
        super(name, defaultBase, env);
    }

    headers (key) {
        return { authorization: `Bearer ${key}` };
    }

    async listModels (key) {
        return (await requestJson("GET", `${this.base}/v1/models`, this.headers(key))).data || [];
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

/** Google's Gemini. */
class GeminiProvider extends Provider {

    constructor (env) {
        super("Gemini", "https://generativelanguage.googleapis.com", env);
    }

    headers (key) {
        return { "x-goog-api-key": key };
    }

    idOf (m) {
        return String(m.name).replace(/^models\//, "");
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
        case "ChatGPT": return new ChatCompletionsProvider("ChatGPT", "https://api.openai.com", env);
        case "Gemini": return new GeminiProvider(env);
        case "Grok": return new ChatCompletionsProvider("Grok", "https://api.x.ai", env);
        default: return null;
    }
}
