/**
 * Prefix root-absolute links with the site's base path.
 *
 * The guide links to other pages as `/data/assets/`, because that is how a reader
 * thinks about the site. GitHub Pages serves the project at `/FinanceTrackerApp/`,
 * so those hrefs have to be rewritten at build time. Relative links would do it
 * too, but they break when a page moves.
 *
 * This is a Sätteri HAST plugin (Astro 7's default Markdown processor), not a
 * rehype transformer: the plugin is a visitor object, and the transform happens
 * through `ctx.setProperty`. Returning a function here compiles without error but
 * never runs, which is how the links silently stayed unprefixed once already.
 *
 * Only anchor hrefs that start with a single `/` are touched: protocol-relative
 * URLs, external URLs, fragments and already-prefixed paths are left alone.
 */
export function baseLinks(base) {
  const prefix = base.replace(/\/$/, "");

  return {
    name: "base-links",
    ...(prefix
      ? {
          element: {
            filter: ["a"],
            visit(node, ctx) {
              const href = node.properties?.href;
              if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return;
              if (href === prefix || href.startsWith(`${prefix}/`)) return;
              ctx.setProperty(node, "href", `${prefix}${href}`);
            },
          },
        }
      : {}),
  };
}
