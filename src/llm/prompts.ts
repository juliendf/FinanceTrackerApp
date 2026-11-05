/**
 * System prompt construction: the profile, style and memories sections and the
 * wording around them.
 *
 * The sections are assembled in order (profile, style, memories) so the model
 * sees one stable prompt.
 */

import type { Goal, Memory, Profile } from "../db/repositories/profile";
import type { Message } from "../db/repositories/chat";
import { MAX_CUSTOM_INSTRUCTIONS } from "../domain/settings";
import { ageFromBirthDate } from "../domain/age";
import { formatNumber } from "../domain/format";
import { fromMinorUnits } from "../domain/money";
import { countryLabel } from "../domain/countries";
import { todayIso } from "../domain/dates";
import Decimal from "decimal.js";

export const SYSTEM_PROMPT_TEMPLATE =
  "You are a finance assistant inside a personal finance tracking app. " +
  "Today is {date}. The user's base currency is {base_currency}; all " +
  "converted totals use it.\n" +
  // Scope is stated before the data so it frames everything that follows. It
  // states the boundary and the exception in the same breath: a guard that also
  // refuses tax or pension questions would be a worse bug than the one it fixes.
  "Stay in scope: discuss this user's money — their assets, snapshots, goals, " +
  "profile and the planning around them. If a question is unrelated to their " +
  "finances, say so in one line and offer the finance angle when there is one. " +
  "Never refuse a money question because it touches tax, insurance, property, " +
  "pension, inheritance or currencies: those are in scope.\n" +
  "{profile_section}" +
  "{style_section}" +
  "{instructions_section}" +
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
  // Money is where small models improvise: a CHF portfolio came back as
  // "₫ 578’865", a symbol and a digit grouping nothing in the app produces.
  "Planning facts: when the profile gives monthly living expenses, use them for " +
  "savings rates, runway and affordability instead of the savings target, which " +
  "is an intention rather than a measurement. A dependant or a self-employed " +
  "income means a longer emergency buffer than the usual three to six months. " +
  "Never assume a figure the profile does not give. " +
  "Tax residence: the profile above gives the country the user pays tax in. Use " +
  "it when an answer depends on jurisdiction — tax-advantaged accounts, " +
  "contribution limits, withholding tax, products that only exist in some " +
  "countries — and say plainly that rules vary and that they should check the " +
  "current local rules for anything that matters. " +
  // The model used `calculate` for the hard sums and did the easy ones itself,
  // which is exactly backwards: 418,446.13 x 80% came back as 334,757.00. It also
  // retyped 421,135.48 as 421,135 and divided euros by francs.
  "Arithmetic: never work out a percentage, a share, a difference, a projection " +
  "or a runway yourself, however trivial it looks. Call `calculate` and copy its " +
  "`*_display` strings. Pass the figures a tool gave you unchanged — do not retype " +
  "a rounded version. Never divide or add amounts in different currencies: convert " +
  "to the base currency first. For runway, use the liquid figure " +
  "`get_portfolio_summary` returns — cash and emergency fund, not the whole " +
  "portfolio. A liquid figure of zero with `liquid_note` means the categories " +
  "are unclassified: say that, and never tell the user they have no cash. " +
  "If `calculate` refuses, relay what it said instead of " +
  "finding another way to the number. " +
  "Money: every tool result carries a `*_display` string (for example " +
  "`CHF 12,345.00`) and a currency code. Copy those strings verbatim. Never " +
  "substitute a currency symbol of your own, never translate the currency, and " +
  "never reformat the digits — if you need an amount the tools did not format, " +
  "use its currency code followed by a space and the number with two decimals. " +
  "Format responses using Markdown where appropriate (bold, lists, etc).";

/** `"100,000"` — `{:,.0f}`, used for goal targets. */
function formatWhole(minor: number): string {
  const value = (fromMinorUnits(minor) ?? new Decimal(0)).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
  return value.toNumber().toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** `"12,345.67"` — two decimals, grouped. */
const money = (minor: number | null): string =>
  formatNumber(fromMinorUnits(minor ?? 0) ?? new Decimal(0));

/** `self_employed` → `self-employed`, and the same for the rest of the list. */
const EMPLOYMENT_LABELS: Record<string, string> = {
  employed: "employed",
  self_employed: "self-employed",
  retired: "retired",
  student: "student",
  between_jobs: "between jobs",
  other: "other",
};

const employmentLabel = (value: string): string => EMPLOYMENT_LABELS[value] ?? value;

/** `participation_aux_acquets` → `participation aux acquêts`, for the prompt. */
const MARITAL_REGIME_LABELS: Record<string, string> = {
  participation_aux_acquets: "gain sharing",
  separation_de_biens: "separation of property",
  communaute_de_biens: "community of property",
  unknown: "not sure",
};

const MARITAL_STATUS_LABELS: Record<string, string> = {
  single: "single",
  married: "married",
  registered_partnership: "registered partnership",
  divorced: "divorced",
  widowed: "widowed",
};

/** `_build_profile_context`: one paragraph plus a structured goals list. */
export function buildProfileContext(profile: Profile, goals: readonly Goal[], today = todayIso()): string {
  const parts: string[] = [];
  const age = ageFromBirthDate(profile.birth_date, today);
  if (age !== null) parts.push(`age: ${age}`);
  if (profile.first_name) {
    const name = profile.last_name ? `${profile.first_name} ${profile.last_name}` : profile.first_name;
    parts.push(`name: ${name}`);
  }
  if (profile.job_title) {
    parts.push(`job: ${profile.job_title}`);
  }
  if (profile.salary_minor !== null) {
    parts.push(`annual salary: ${money(profile.salary_minor)} ${profile.currency}`);
  }
  const residence = countryLabel(profile.tax_residence);
  if (residence) {
    parts.push(`tax residence: ${residence}`);
  }
  if (profile.risk_profile) {
    parts.push(`risk profile: ${profile.risk_profile}`);
  }
  if (profile.financial_goals) {
    parts.push(`financial goals: ${profile.financial_goals}`);
  }
  if (profile.monthly_savings_target_minor !== null) {
    parts.push(`monthly savings target: ${money(profile.monthly_savings_target_minor)}`);
  }
  // `!= null`, not `!== null`: an undefined value (an older row shape, or a test
  // fixture) is "not set", not "zero".
  if (profile.monthly_expenses_minor != null) {
    parts.push(`monthly living expenses: ${money(profile.monthly_expenses_minor)} ${profile.currency}`);
  }
  if (profile.employment_status) {
    parts.push(`employment: ${employmentLabel(profile.employment_status)}`);
  }
  // Succession and tax both hang off these, and neither can be inferred from the
  // portfolio. Only emitted when set: an absent field is a question to ask, not
  // a default to assume.
  if (profile.marital_status) {
    const regime = profile.marital_regime
      ? ` (${MARITAL_REGIME_LABELS[profile.marital_regime] ?? profile.marital_regime})`
      : "";
    parts.push(`marital status: ${MARITAL_STATUS_LABELS[profile.marital_status] ?? profile.marital_status}${regime}`);
  }
  if (profile.has_will != null) {
    parts.push(`will: ${profile.has_will ? "yes" : "no"}`);
  }
  if (profile.dependants_count != null) {
    const ages = (profile.dependant_ages ?? "").trim();
    parts.push(
      profile.dependants_count === 0
        ? "dependants: none"
        : `dependants: ${profile.dependants_count}${ages ? ` (ages ${ages})` : ""}`,
    );
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
/**
 * Standing instructions the user wrote for the assistant.
 *
 * Empty returns an empty string, never an empty heading: an unset field has to
 * add nothing at all to the prompt. The length is capped here as well as in the
 * form, because a backup or an older build can write the setting directly.
 */
export function buildInstructionsContext(instructions: string | null | undefined): string {
  const text = (instructions ?? "").trim();
  if (!text) return "";
  return `## Standing instructions\n${text.slice(0, MAX_CUSTOM_INSTRUCTIONS)}\n`;
}

export function buildSystemPrompt(input: {
  today: string;
  baseCurrency: string;
  profile: Profile;
  goals: readonly Goal[];
  memories: readonly Memory[];
  /** The user's standing instructions; absent adds no section. */
  customInstructions?: string | null;
}): string {
  return SYSTEM_PROMPT_TEMPLATE.replace("{date}", input.today)
    .replace("{base_currency}", input.baseCurrency)
    .replace("{profile_section}", buildProfileContext(input.profile, input.goals, input.today))
    .replace("{style_section}", buildStyleContext(input.profile))
    .replace("{instructions_section}", buildInstructionsContext(input.customInstructions))
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
  // The app already knows a lot. Asking for it again produced "proposals" for the
  // user's own name, their existing goals and the assets in the table.
  "Do not propose anything already listed under \"Already known\" below: not the " +
  "profile, not the assets, not the goals, not an existing memory. A fact that " +
  "merely restates one of those is not a memory. Only propose what is genuinely " +
  "new, or a real change to what is known (then keep the existing key).\n\n";

/** The facts this app already holds, rendered for the extraction prompt. */
export interface KnownFacts {
  profile: Profile | null;
  goals: readonly Goal[];
  memories: ReadonlyArray<{ key: string; content: string }>;
  /** Asset labels, e.g. "UBS - Compte (Cash)". */
  assets: readonly string[];
  today?: string;
  /** At most this many memories are quoted, the most important first. */
  memoryLimit?: number;
}

/**
 * What the app already knows, as a compact block.
 *
 * The extraction model is not asked to rediscover this — it is given, so the only
 * things it can propose are the ones that are actually new.
 */
export function buildKnownContext(facts: KnownFacts): string {
  const sections: string[] = [];

  if (facts.profile) {
    const profile = buildProfileContext(facts.profile, facts.goals, facts.today).trim();
    if (profile) sections.push(profile);
  }

  if (facts.assets.length > 0) {
    sections.push(`## Assets\n${facts.assets.map((name) => `- ${name}`).join("\n")}`);
  }

  const limit = facts.memoryLimit ?? 40;
  if (facts.memories.length > 0) {
    const lines = facts.memories.slice(0, limit).map((memory) => {
      const content = memory.content.length > 160 ? `${memory.content.slice(0, 157)}…` : memory.content;
      return `- ${memory.key}: ${content}`;
    });
    sections.push(`## Existing memories\n${lines.join("\n")}`);
  }

  return sections.length > 0 ? `## Already known\n${sections.join("\n\n")}\n\n` : "";
}

/** The conversation, labelled by speaker, as the user turn of the request. */
export function buildExtractionTranscript(
  messages: ReadonlyArray<{ role: string; content: string }>,
): string {
  return messages
    .map((message) => `[${message.role === "user" ? "User" : "Assistant"}]: ${message.content}`)
    .join("\n");
}

/**
 * The extraction request, as two turns.
 *
 * It used to be a single **system** message, and Gemini's OpenAI-compatible
 * endpoint answers that with `500 no user query found in messages`: a request with
 * no user turn is not a chat. The instruction is the system turn, the transcript is
 * the user turn, which every provider accepts. `known` is what the app already
 * holds, so the model proposes only new facts.
 */
export function buildExtractionMessages(
  messages: ReadonlyArray<{ role: string; content: string }>,
  known = "",
): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: EXTRACTION_PROMPT_PREFIX + known },
    { role: "user", content: buildExtractionTranscript(messages) },
  ];
}

/** Suggested questions offered under the composer. */
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
  {
    id: "retirement-plan",
    label: "Retirement plan",
    hint: "Will my capital cover my costs?",
    icon: "bi-piggy-bank",
    prompt:
      "Build my retirement picture from what the app already knows: my " +
      "age, my monthly living expenses, the value of my portfolio and my " +
      "goals. Estimate the capital my expenses would need, compare it " +
      "with what I hold and what I add each year, and show the gap. State " +
      "every assumption you use — return, inflation, retirement age — and " +
      "label it as an assumption rather than a fact.",
  },
  {
    // Succession has no data behind it: the profile carries no heirs, marital
    // regime or will. The prompt therefore has to ask instead of inventing them.
    id: "succession",
    label: "Succession",
    hint: "What should I prepare?",
    icon: "bi-diagram-3",
    prompt:
      "Help me prepare for succession. My marital status, matrimonial regime and " +
      "whether I have a will are in my profile when I have set them — use them, " +
      "and do not assume anything the profile leaves out. There is nowhere to " +
      "record my heirs, so ask about them before analysing. Then outline what should be " +
      "organised: which documents matter, what my tax residence implies, how " +
      "each kind of asset would actually transfer, and what to raise with a " +
      "notary or a tax adviser. Keep it to what I should prepare, and do not " +
      "draft legal wording.",
  },
] as const;


// --- Conversation summary ----------------------------------------------------

/**
 * How much transcript the summariser is given.
 *
 * A summary of a very long chat would otherwise cost more than the chat did. The
 * newest exchanges are kept, because that is what a recap is usually about.
 */
export const SUMMARY_MAX_TRANSCRIPT_CHARS = 24_000;

export const SUMMARY_PROMPT =
  "You summarise a conversation between a user and the finance assistant inside " +
  "this app. Write at most 250 words, in the user's language. Cover, in this " +
  "order: the decisions or conclusions reached, the questions left open, and the " +
  "facts the user stated about themselves or their money. Use short headings and " +
  "bullet points. Do not give new advice, do not repeat the whole conversation, " +
  "and do not add anything that is not in the transcript.";

/**
 * The transcript to summarise: the words exchanged, without the plumbing.
 *
 * `role='tool'` rows and assistant rows carrying `tool_calls` are dropped — they
 * are tool output and preambles, not conversation, and including them makes the
 * summary read like a log. Oldest first, truncated from the front so the most
 * recent exchange always survives.
 */
export function buildSummaryTranscript(
  messages: readonly Message[],
  maxChars: number = SUMMARY_MAX_TRANSCRIPT_CHARS,
): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (message.role === "assistant" && message.tool_calls) continue;
    const text = (message.content ?? "").trim();
    if (!text) continue;
    lines.push(`${message.role === "user" ? "User" : "Assistant"}: ${text}`);
  }

  const kept: string[] = [];
  let total = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    total += lines[index].length + 1;
    if (total > maxChars) break;
    kept.unshift(lines[index]);
  }
  return kept.join("\n");
}

/**
 * Instruction and transcript as two turns.
 *
 * Same reason as the extraction call: a system-only request is not a chat, and
 * Gemini rejects it with a 500.
 */
export function buildSummaryMessages(
  transcript: string,
): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: SUMMARY_PROMPT },
    { role: "user", content: transcript },
  ];
}
