/**
 * Markdown for one message, parsed once per distinct content.
 *
 * Two problems this fixes. The plugin arrays were inline in the JSX, so every
 * render handed `react-markdown` brand-new arrays and defeated its own memoisation;
 * and each message was re-parsed whenever the page re-rendered — which during
 * streaming was once per token, for every message in the transcript.
 *
 * Tables are wrapped so a wide one scrolls **inside the bubble** instead of
 * pushing the whole conversation sideways.
 */

import { memo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

// Module-level: `react-markdown` diffs its options, so stable objects mean stable work.
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];

function ScrollableTable({ children, ...props }: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="md-table-scroll" tabIndex={0} role="group" aria-label="Table, scrolls sideways">
      <table {...props}>{children}</table>
    </div>
  );
}

/** Stable: a new object here would re-render every message on each parent render. */
const COMPONENTS = { table: ScrollableTable };

export const MessageMarkdown = memo(function MessageMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
});
