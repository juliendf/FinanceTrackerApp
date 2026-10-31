/**
 * System prompt construction — port of `chat_service.py`'s template and its
 * `_build_*_context` helpers, with the text kept verbatim.
 *
 * The sections are assembled in the same order (profile, style, memories) so
 * the model sees the same prompt the web app sent.
 */

import type { Goal, Memory, Profile } from "../db/repositories/profile";
import { formatNumber } from "../domain/format";
import Decimal from "decimal.js";

export const SYSTEM_PROMPT_TEMPLATE =
  "You are a finance assistant inside a personal finance tracking app. " +
  "Today is {date}. The user's base currency is {base_currency}; all " +
  "converted totals use it.\n" +
  "{profile_section}" +
  "{style_section}" +
  "{memory_section}" +
  "When the user asks about themselves, their profile, or what you know " +
  "about them, always reference the User financial context, Response style, " +
  "and What I know sections above before querying any tools. Always use the provided tools " +
  "to look up data — never invent numbers. When the user names an asset " +
  "ambiguously, use `list_assets` to find candidates and ask which one they " +
  "meant. To record a value, use `propose_snapshot` and tell the user to " +
  "confirm the card shown in the UI — you cannot save data yourself. If you " +
  "learn something important about the user that would be useful to remember " +
  "for future conversations, use the `remember_fact` tool. Be concise. " +
  "Amounts are formatted with the user's currency. " +
  "Format responses using Markdown where appropriate (bold, lists, etc).";

/** `"100,000"` — `{:,.0f}`, used for goal targets. */
function formatWhole(minor: number): string {
  const value = new Decimal(minor).dividedBy(100).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
  return value.toNumber().toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** `"12,345.67"` — the `{:,.2f}` the source builds its salary line with. */
const money = (minor: number | null): string =>
  formatNumber(new Decimal(minor ?? 0).dividedBy(100));

/** `_build_profile_context`: one paragraph plus a structured goals list. */
export function buildProfileContext(profile: Profile, goals: readonly Goal[]): string {
  const parts: string[] = [];
  if (profile.first_name) {
    const name = profile.last_name ? `${profile.first_name} ${profile.last_name}` : profile.first_name;
    parts.push(`name: ${name}`);
  }
  if (profile.salary_minor !== null) {
    parts.push(`annual salary: ${money(profile.salary_minor)} ${profile.currency}`);
  }
  if (profile.risk_profile) {
    parts.push(`risk profile: ${profile.risk_profile}`);
  }
  if (profile.monthly_savings_target_minor !== null) {
    parts.push(`monthly savings target: ${money(profile.monthly_savings_target_minor)}`);
  }

  const sections: string[] = [];
  if (parts.length > 0) {
    sections.push("## User financial context\n" + parts.join("; "));
  }

  if (goals.length > 0) {
    const lines = goals.map((goal) => {
      const head = [`- ${goal.label}`];
      if (goal.target_amount_minor !== null) {
        head.push(`${formatWhole(goal.target_amount_minor)} ${profile.currency}`);
      }
      if (goal.target_date) head.push(`by ${goal.target_date}`);
      const extras = [goal.priority, goal.category].filter((value): value is string => !!value);
      let line = head.join(" \u2014 ");
      if (extras.length > 0) line += ` (${extras.join(", ")})`;
      return line;
    });
    sections.push("## Financial goals\n" + lines.join("\n"));
  }

  return sections.length > 0 ? sections.join("\n") + "\n" : "";
}

/** `_build_style_context`. */
export function buildStyleContext(profile: Profile): string {
  return (
    "## Response style\n" +
    `Tone: ${profile.ai_tone || "encouraging"}. Verbosity: ${profile.ai_verbosity || "balanced"}. ` +
    `Financial expertise level: ${profile.ai_expertise || "intermediate"}.\n`
  );
}

/** `_build_memory_context`, top `limit` memories by importance. */
export function buildMemoryContext(memories: readonly Memory[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map((memory) => `- [${memory.category}] ${memory.content}`);
  return "## What I know about the user (from past conversations)\n" + lines.join("\n") + "\n";
}

/** The full prompt for one turn. */
export function buildSystemPrompt(input: {
  today: string;
  baseCurrency: string;
  profile: Profile;
  goals: readonly Goal[];
  memories: readonly Memory[];
}): string {
  return SYSTEM_PROMPT_TEMPLATE.replace("{date}", input.today)
    .replace("{base_currency}", input.baseCurrency)
    .replace("{profile_section}", buildProfileContext(input.profile, input.goals))
    .replace("{style_section}", buildStyleContext(input.profile))
    .replace("{memory_section}", buildMemoryContext(input.memories));
}

/** `extract_memories`: the whole conversation, verbatim prompt. */
export const EXTRACTION_PROMPT_PREFIX =
  "You are analyzing a conversation between a user and their financial " +
  "assistant. Extract any facts about the user that would be useful to " +
  "remember for future conversations: personal details, financial situation, " +
  "goals, preferences, life events. Only extract facts explicitly stated by " +
  "the user — do not infer or assume.\n\n" +
  "For each fact, provide:\n" +
  "- category: personal|financial|goal|preference|life_event\n" +
  "- key: short label (max 200 chars)\n" +
  "- content: the fact in third person, e.g. 'User has...'\n" +
  "- importance: 1-5 (1=trivial, 5=critical)\n\n" +
  'Return a JSON array: [{"category": "...", "key": "...", ' +
  '"content": "...", "importance": 3}, ...]\n' +
  "If no facts worth remembering, return [].\n\n" +
  "Conversation:\n\n";

export function buildExtractionPrompt(messages: ReadonlyArray<{ role: string; content: string }>): string {
  let prompt = EXTRACTION_PROMPT_PREFIX;
  for (const message of messages) {
    prompt += `[${message.role === "user" ? "User" : "Assistant"}]: ${message.content}\n`;
  }
  return prompt;
}

/** Suggested questions, ported from `routes/chat.py`'s `QUICK_PROMPTS`. */
export const QUICK_PROMPTS = [
  {
    id: "portfolio-review",
    label: "Portfolio review",
    hint: "Am I on track vs my goals?",
    icon: "bi-clipboard2-pulse",
    prompt:
      "Act as my personal financial advisor. Review my portfolio against " +
      "my financial goals and my investor profile. For each goal, tell me " +
      "whether I'm on track, at risk, or off track, and quantify the gap " +
      "when possible. Then rank the three actions that would most improve " +
      "my situation.",
  },
  {
    id: "allocation-risk",
    label: "Allocation & risk",
    hint: "Concentration and risk check",
    icon: "bi-pie-chart",
    prompt:
      "Analyse my asset allocation by category, institution and currency. " +
      "Flag over-concentration (single asset, institution or currency), " +
      "compare my overall risk level with my risk profile, and propose " +
      "concrete rebalancing moves with target percentages.",
  },
  {
    id: "performance",
    label: "Performance",
    hint: "Last 12 months, movers",
    icon: "bi-graph-up-arrow",
    prompt:
      "Review how my portfolio performed over the last 12 months: total " +
      "evolution, biggest contributors and detractors, and the main " +
      "drivers. Give me a short summary table followed by 2-3 key " +
      "takeaways.",
  },
  {
    id: "priorities",
    label: "Priorities",
    hint: "Top 3 for the next 6 months",
    icon: "bi-list-check",
    prompt:
      "Based on my profile, my goals and my current portfolio, give me my " +
      "top 3 priorities for the next 6 months, ranked by impact. For each " +
      "one: why it matters, the concrete next step, and how I'll know it " +
      "worked.",
  },
  {
    id: "stress-test",
    label: "Stress test",
    hint: "What if markets drop 20%?",
    icon: "bi-shield-exclamation",
    prompt:
      "Stress-test my portfolio: what happens if markets drop 20%? Show " +
      "the impact on my total net worth and on each goal, tell me which " +
      "goals would be at risk or delayed, and what I could do today to " +
      "reduce that exposure.",
  },
] as const;
