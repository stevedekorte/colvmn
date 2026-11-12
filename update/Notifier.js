/**
 * Optional email after a runner invocation: one email summarizing the jobs
 * that matched. Off unless the site's colvmn.json turns it on:
 *
 *   "updates": {
 *       "notify": {
 *           "on": ["failure", "changed"],          // or "nothing", or "all"
 *           "to": "NOTIFY_EMAIL_TO",               // credential names, not addresses,
 *           "from": "NOTIFY_EMAIL_FROM",           //   so no address is in the repo
 *           "key": "RESEND_API_KEY"                // the sending service's key
 *       }
 *   }
 *
 * The names shown are the defaults. They are credentials like any other
 * (described in the site root's _credentials/), but they belong to the
 * runner: no job is given them. A job can override `on` with `notify:` in
 * its update file. Mail is sent through Resend's API. The email holds each
 * job's folder, result, message, cost, changed files and links, never page
 * content, and is withheld if it contains any credential value handed out in
 * the run. A failure to send is logged and changes nothing else.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Credentials } from "./Credentials.js";

const DEFAULTS = { on: ["failure", "changed"], to: "NOTIFY_EMAIL_TO", from: "NOTIFY_EMAIL_FROM", key: "RESEND_API_KEY" };
const EVENT_FOR_RESULT = { failed: "failure", changed: "changed", nothing: "nothing" };
const RESEND_URL = "https://api.resend.com/emails";

export class Notifier {

    /** The site's notifier, or null when colvmn.json doesn't turn notifications on. */
    static forSite (siteRoot, env = process.env, fetchFn = globalThis.fetch) {
        const path = join(siteRoot, "colvmn.json");
        if (!existsSync(path)) {
            return null;
        }
        const notify = JSON.parse(readFileSync(path, "utf8")).updates?.notify;
        return notify ? new Notifier({ siteRoot, config: { ...DEFAULTS, ...notify }, env, fetchFn }) : null;
    }

    constructor ({ siteRoot, config, env = process.env, fetchFn = globalThis.fetch }) {
        this.siteRoot = siteRoot;
        this.config = config;
        this.credentials = new Credentials(siteRoot, env);
        this.env = env;
        this.fetchFn = fetchFn;
    }

    /** The results this notifier reports: each job's own `notify:`, else the site's `on`. */
    matching (results) {
        return results.filter(r => {
            const events = r.job.updateFile.fields.notify ?? this.config.on;
            const list = Array.isArray(events) ? events : [events];
            return list.includes("all") || list.includes(EVENT_FOR_RESULT[r.result]);
        });
    }

    /** The email for these results, or null when none match. */
    compose (results, handedOut = new Set()) {
        const matched = this.matching(results);
        if (matched.length === 0) {
            return null;
        }
        const failedCount = matched.filter(r => r.result === "failed").length;
        const subject = `colvmn updates: ${matched.length} job${matched.length === 1 ? "" : "s"}${failedCount ? `, ${failedCount} failed` : ""}`;
        let text = matched.map(r => this.describe(r)).join("\n\n");
        const runUrl = this.runUrl();
        if (runUrl) {
            text += `\n\nRun log: ${runUrl}`;
        }
        if ([...handedOut].some(v => v.length >= 8 && text.includes(v))) {
            text = "This summary was withheld: it contained a credential value. See the run log.";
        }
        return { subject, text };
    }

    describe (r) {
        const lines = [`${r.job.folderName()}: ${r.result}`, `  ${r.message}`];
        if (typeof r.cost === "number") {
            lines.push(`  cost: $${r.cost.toFixed(2)}`);
        }
        if (r.files && r.files.length) {
            lines.push(`  changed: ${r.files.join(", ")}`);
        }
        if (r.commit) {
            lines.push(`  commit: ${r.commit}`);
        }
        return lines.join("\n");
    }

    /** The GitHub Actions run's page, when running there. */
    runUrl () {
        const e = this.env;
        return e.GITHUB_SERVER_URL && e.GITHUB_REPOSITORY && e.GITHUB_RUN_ID
            ? `${e.GITHUB_SERVER_URL}/${e.GITHUB_REPOSITORY}/actions/runs/${e.GITHUB_RUN_ID}`
            : null;
    }

    /**
     * Sends the email for a run, if any results match.
     * @returns {Promise<string>} what happened, for the log
     */
    async send (results, handedOut) {
        const email = this.compose(results, handedOut);
        if (!email) {
            return "no notification (no matching results)";
        }
        const names = { to: this.config.to, from: this.config.from, key: this.config.key };
        const values = {};
        for (const [field, name] of Object.entries(names)) {
            const r = this.credentials.resolve(name, this.siteRoot);
            if (r.problem) {
                return `notification not sent: ${r.problem}`;
            }
            values[field] = r.value;
        }
        try {
            const response = await this.fetchFn(RESEND_URL, {
                method: "POST",
                headers: { "Authorization": `Bearer ${values.key}`, "Content-Type": "application/json" },
                body: JSON.stringify({ from: values.from, to: values.to.split(",").map(s => s.trim()), subject: email.subject, text: email.text })
            });
            return response.ok ? "notification sent" : `notification not sent: the email service answered ${response.status}`;
        } catch (e) {
            return `notification not sent: ${e.message}`;
        }
    }
}
