// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { satteri } from "@astrojs/markdown-satteri";
import { baseLinks } from "./base-links.mjs";

/**
 * Where the site is served from.
 *
 * Defaults to the GitHub Pages project URL, which needs the repository name as
 * a base path. Set SITE_URL and SITE_BASE (SITE_BASE="" for a root domain) to
 * move to a custom domain without touching this file; the deploy workflow passes
 * them through from repository variables.
 */
const site = process.env.SITE_URL || "https://juliendf.github.io";
const base = process.env.SITE_BASE === undefined ? "/FinanceTrackerApp" : process.env.SITE_BASE || "/";

const repo = "https://github.com/juliendf/FinanceTrackerApp";

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  markdown: {
    // The guide writes links as `/data/assets/`; this adds the base path.
    processor: satteri({ hastPlugins: [baseLinks(base)] }),
  },
  integrations: [
    starlight({
      title: "FinanceTracker",
      description:
        "A native macOS app for tracking assets and their value over time. Local-first, single user, no account.",
      logo: { src: "./src/assets/logo.svg", alt: "FinanceTracker" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/site/` },
      customCss: ["./src/styles/starlight.css"],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Why I built this", slug: "start/why" },
            { label: "What FinanceTracker is", slug: "start/what-it-is" },
            { label: "Install and first launch", slug: "start/install" },
            { label: "Your first hour", slug: "start/first-hour" },
            { label: "A tour of the app", slug: "start/tour" },
          ],
        },
        {
          label: "Your data",
          items: [
            { label: "Assets", slug: "data/assets" },
            { label: "Snapshots", slug: "data/snapshots" },
            { label: "Recording many values at once", slug: "data/bulk-entry" },
            { label: "Institutions, categories and tags", slug: "data/reference" },
            { label: "Currencies and exchange rates", slug: "data/currencies" },
            { label: "Backup, import and reset", slug: "data/backup" },
            { label: "Where your data lives", slug: "data/privacy" },
          ],
        },
        {
          label: "Reading the numbers",
          items: [
            { label: "Dashboard", slug: "numbers/dashboard" },
            { label: "Performance", slug: "numbers/performance" },
            { label: "Charts", slug: "numbers/charts" },
          ],
        },
        {
          label: "AI assistant",
          items: [
            { label: "Setting it up", slug: "assistant/setup" },
            { label: "Chatting", slug: "assistant/chat" },
            { label: "What it can see and do", slug: "assistant/what-it-knows" },
            { label: "Profile, goals and memories", slug: "assistant/profile" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Settings", slug: "reference/settings" },
            { label: "Updates", slug: "reference/updates" },
            { label: "Troubleshooting", slug: "reference/troubleshooting" },
            { label: "FAQ", slug: "reference/faq" },
          ],
        },
      ],
      head: [
        { tag: "meta", attrs: { name: "theme-color", content: "#0f1419" } },
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: `${site}${base === "/" ? "" : base}/shots/dashboard.png`,
          },
        },
      ],
    }),
  ],
});
