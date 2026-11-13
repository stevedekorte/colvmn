import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const hasPage = dir => existsSync(join(dir, "_index.json")) || existsSync(join(dir, "_index.md"));

/**
 * The site an engine folder belongs to: usually the folder above it (the
 * engine is a site's colvmn/ folder), or the engine folder itself when it is
 * the site (colvmn.dev, which hosts its own engine) and the folder above
 * isn't a site.
 */
export function defaultSiteRoot (engineDir) {
    const parent = resolve(engineDir, "..");
    if (!hasPage(parent) && hasPage(engineDir)) {
        return resolve(engineDir);
    }
    return parent;
}
