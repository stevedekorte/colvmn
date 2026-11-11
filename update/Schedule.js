/**
 * When an update job is due. A schedule is "daily", "weekly", "monthly", or
 * a five-field cron string ("30 7 * * 1" = 07:30 UTC on Mondays). All times
 * are UTC.
 *
 * The runner is started about once a day, at no exact minute, so the named
 * schedules count calendar days rather than exact hours: a daily job that
 * last ran yesterday is due today, whatever the clock says. A cron job is due
 * when one of its times has passed since its last run.
 *
 * A job that has never run is due.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const CRON_LOOKBACK_DAYS = 366;

export class Schedule {

    /**
     * @param {string} text - "daily" | "weekly" | "monthly" | a cron string
     */
    constructor (text) {
        this.text = String(text || "").trim();
        this.cron = NAMED.has(this.text) ? null : CronExpression.parse(this.text);
    }

    /** Whether the text is a schedule this runner understands. */
    isValid () {
        return NAMED.has(this.text) || this.cron !== null;
    }

    /**
     * Whether a job with this schedule should run now.
     * @param {Date|null} lastRun - when it last ran, or null if never
     * @param {Date} now
     * @returns {boolean}
     */
    isDue (lastRun, now) {
        if (!this.isValid()) {
            return false;
        }
        if (!lastRun) {
            return true;
        }
        if (NAMED.has(this.text)) {
            return NAMED.get(this.text)(lastRun, now);
        }
        return this.cron.hasTimeBetween(lastRun, now);
    }
}

function utcDayNumber (date) {
    return Math.floor(date.getTime() / DAY_MS);
}

const NAMED = new Map([
    ["daily", (last, now) => utcDayNumber(now) > utcDayNumber(last)],
    ["weekly", (last, now) => utcDayNumber(now) - utcDayNumber(last) >= 7],
    ["monthly", (last, now) => now.getUTCFullYear() * 12 + now.getUTCMonth() > last.getUTCFullYear() * 12 + last.getUTCMonth()]
]);

/**
 * A five-field cron expression: minute hour day-of-month month day-of-week.
 * Each field is "*", a number, a range "1-5", a list "1,15", or a step
 * "*\/15" / "0-30/10". Day of week is 0–6 from Sunday (7 is Sunday too). As in
 * cron, when both day fields are restricted, either matching is enough.
 */
export class CronExpression {

    /**
     * @param {string} text
     * @returns {CronExpression|null} null when the text is not a cron string
     */
    static parse (text) {
        const parts = text.split(/\s+/);
        if (parts.length !== 5) {
            return null;
        }
        const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
        const fields = parts.map((p, i) => parseCronField(p, ranges[i][0], ranges[i][1]));
        if (fields.some(f => f === null)) {
            return null;
        }
        if (fields[4].has(7)) {
            fields[4].add(0);
        }
        return new CronExpression(fields, parts);
    }

    constructor (fields, parts) {
        [this.minutes, this.hours, this.days, this.months, this.weekdays] = fields;
        this.dayIsRestricted = parts[2] !== "*";
        this.weekdayIsRestricted = parts[4] !== "*";
    }

    /** Whether the expression fires at this minute (UTC). */
    matches (date) {
        return this.minutes.has(date.getUTCMinutes())
            && this.hours.has(date.getUTCHours())
            && this.months.has(date.getUTCMonth() + 1)
            && this.dayMatches(date);
    }

    dayMatches (date) {
        const day = this.days.has(date.getUTCDate());
        const weekday = this.weekdays.has(date.getUTCDay());
        if (this.dayIsRestricted && this.weekdayIsRestricted) {
            return day || weekday;
        }
        return day && weekday;
    }

    /**
     * Whether the expression fires at some minute after `start` and at or
     * before `end`. Looks back at most a year, so a job last run long ago is
     * still found due.
     */
    hasTimeBetween (start, end) {
        const floor = Math.max(start.getTime(), end.getTime() - CRON_LOOKBACK_DAYS * DAY_MS);
        const t = new Date(Math.floor(floor / 60000) * 60000 + 60000);
        for (; t.getTime() <= end.getTime(); t.setTime(t.getTime() + 60000)) {
            if (this.matches(t)) {
                return true;
            }
        }
        return false;
    }
}

function parseCronField (text, min, max) {
    const values = new Set();
    for (const part of text.split(",")) {
        const range = parseCronPart(part, min, max);
        if (!range) {
            return null;
        }
        for (let v = range.from; v <= range.to; v += range.step) {
            values.add(v);
        }
    }
    return values;
}

function parseCronPart (part, min, max) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) {
        return null;
    }
    const step = m[2] ? Number(m[2]) : 1;
    let from = min, to = max;
    if (m[1] !== "*") {
        const [a, b] = m[1].split("-").map(Number);
        from = a;
        to = (b === undefined) ? (m[2] ? max : a) : b;
    }
    const ok = step > 0 && from >= min && to <= max && from <= to;
    return ok ? { from, to, step } : null;
}
