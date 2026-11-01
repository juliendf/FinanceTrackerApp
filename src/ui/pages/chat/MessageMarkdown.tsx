/**
 * Markdown for one message, parsed once per distinct content.
 *
 * Two problems this fixes. The plugin arrays were inline in the JSX, so every
 * render handed `react-markdown` brand-new arrays and defeated its own memoisation;
 * and each message was re-parsed whenever the page re-rendered — which during
 * streaming was once per token, for every message in the transcript.
 */

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

// Module-level: `react-markdown` diffs its options, so stable arrays mean stable work.
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];

export const MessageMarkdown = memo(function MessageMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
      {content}
    </ReactMarkdown>
  );
});
