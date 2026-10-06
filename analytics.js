// Analytics snippets for static-gen.js.
//
// Configured by the "analytics" section of the site's colvmn.json, one key per
// provider; several providers may be enabled at once:
//
//   "analytics": {
//     "cloudflare":      { "token": "<site token from the Web Analytics snippet>" },
//     "googleAnalytics": { "measurementId": "G-XXXXXXX" },
//     "plausible":       { "domain": "example.com", "src": "<optional script URL>" },
//     "goatcounter":     { "code": "mysite", "endpoint": "<optional count URL>" },
//     "fathom":          { "siteId": "ABCDEFG" },
//     "umami":           { "websiteId": "<uuid>", "src": "<optional script URL>" },
//     "simpleAnalytics": {},
//     "custom":          { "head": "<raw html>", "body": "<raw html>" }
//   }
//
// Every value is checked against a strict pattern before it is written into
// HTML; "custom" is the one unchecked escape hatch. All of these IDs are public
// (they ship in every page) — never put an account id or API token here.

const ID = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAINS = /^[A-Za-z0-9.-]+(,[A-Za-z0-9.-]+)*$/;
const URL = /^https:\/\/[^\s"'<>]+$/;

// Each provider: fields (name -> [pattern, required]), placement, and html().
const PROVIDERS = {
    cloudflare: {
        fields: { token: [ID, true] },
        placement: "body",
        html: c => `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${c.token}"}'></script>`,
    },
    googleAnalytics: {
        fields: { measurementId: [/^G-[A-Z0-9]+$/, true] },
        placement: "head",
        html: c => [
            `<script async src="https://www.googletagmanager.com/gtag/js?id=${c.measurementId}"></script>`,
            `<script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag("js", new Date()); gtag("config", "${c.measurementId}");</script>`,
        ].join("\n"),
    },
    plausible: {
        fields: { domain: [DOMAINS, true], src: [URL, false] },
        placement: "head",
        html: c => `<script defer data-domain="${c.domain}" src="${c.src || "https://plausible.io/js/script.js"}"></script>`,
    },
    goatcounter: {
        fields: { code: [ID, false], endpoint: [URL, false] },
        placement: "body",
        validate: c => c.code || c.endpoint ? null : "needs \"code\" or \"endpoint\"",
        html: c => `<script data-goatcounter="${c.endpoint || `https://${c.code}.goatcounter.com/count`}" async src="https://gc.zgo.at/count.js"></script>`,
    },
    fathom: {
        fields: { siteId: [ID, true] },
        placement: "head",
        html: c => `<script src="https://cdn.usefathom.com/script.js" data-site="${c.siteId}" defer></script>`,
    },
    umami: {
        fields: { websiteId: [UUID, true], src: [URL, false] },
        placement: "head",
        html: c => `<script defer src="${c.src || "https://cloud.umami.is/script.js"}" data-website-id="${c.websiteId}"></script>`,
    },
    simpleAnalytics: {
        fields: {},
        placement: "body",
        html: () => `<script async src="https://scripts.simpleanalyticscdn.com/latest.js"></script>`,
    },
    custom: {
        fields: { head: [null, false], body: [null, false] },
        placement: null,
    },
};

// Turn the "analytics" config section into { head, body } HTML strings.
// Throws with a readable message on unknown providers or bad values.
export function buildAnalyticsHtml (analytics) {
    const out = { head: [], body: [] };
    if (!analytics) return { head: "", body: "" };
    if (typeof analytics !== "object" || Array.isArray(analytics)) {
        throw new Error(`"analytics" must be an object keyed by provider`);
    }
    for (const [name, raw] of Object.entries(analytics)) {
        const provider = PROVIDERS[name];
        if (!provider) {
            throw new Error(`unknown analytics provider "${name}" (supported: ${Object.keys(PROVIDERS).join(", ")})`);
        }
        const c = raw === true ? {} : raw;
        if (!c || typeof c !== "object") throw new Error(`analytics.${name} must be an object`);
        for (const key of Object.keys(c)) {
            if (!(key in provider.fields)) throw new Error(`analytics.${name} has unknown field "${key}"`);
        }
        for (const [key, [pattern, required]] of Object.entries(provider.fields)) {
            const v = c[key];
            if (v === undefined || v === "") {
                if (required) throw new Error(`analytics.${name} needs "${key}"`);
                continue;
            }
            if (typeof v !== "string") throw new Error(`analytics.${name}.${key} must be a string`);
            if (pattern && !pattern.test(v)) throw new Error(`analytics.${name}.${key} "${v}" doesn't look valid`);
        }
        const problem = provider.validate && provider.validate(c);
        if (problem) throw new Error(`analytics.${name} ${problem}`);

        if (name === "custom") {
            if (c.head) out.head.push(c.head);
            if (c.body) out.body.push(c.body);
        } else {
            out[provider.placement].push(provider.html(c));
        }
    }
    return { head: out.head.join("\n"), body: out.body.join("\n") };
}

// Replace the marked analytics blocks in a page. Each build strips whatever
// is between the markers and writes it fresh, so adding, changing or removing
// a provider takes effect on regen. Pass empty strings to just strip.
const BLOCK_RE = /[ \t]*<!-- colvmn:analytics -->[\s\S]*?<!-- \/colvmn:analytics -->\n?/g;

function block (content) {
    const indented = content.split("\n").map(l => `  ${l}`).join("\n");
    return `  <!-- colvmn:analytics -->\n${indented}\n  <!-- /colvmn:analytics -->\n`;
}

export function applyAnalytics (html, { head, body }) {
    html = html.replace(BLOCK_RE, "");
    // Function replacers so "$" in custom HTML isn't read as a backreference.
    if (head) html = html.replace(/<\/head>/i, m => block(head) + m);
    if (body) html = html.replace(/<\/body>/i, m => block(body) + m);
    return html;
}
