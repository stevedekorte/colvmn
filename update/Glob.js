/**
 * Glob matching for update files' `writes` lists: "/"-separated paths
 * relative to the site root. `**` matches any number of folders, `*` and `?`
 * stay within one path segment.
 */

const cache = new Map();

/**
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp (glob) {
    if (cache.has(glob)) {
        return cache.get(glob);
    }
    let re = "";
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "*" && glob[i + 1] === "*") {
            const slash = glob[i + 2] === "/";
            re += slash ? "(?:.*/)?" : ".*";
            i += slash ? 2 : 1;
        } else if (c === "*") {
            re += "[^/]*";
        } else if (c === "?") {
            re += "[^/]";
        } else {
            re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    const regExp = new RegExp(`^${re}$`);
    cache.set(glob, regExp);
    return regExp;
}

/**
 * Whether a path matches any of the globs.
 * @param {string} path - "/"-separated, relative to the site root
 * @param {string[]} globs
 */
export function matchesAnyGlob (path, globs) {
    return globs.some(g => globToRegExp(g).test(path));
}
