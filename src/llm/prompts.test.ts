import { describe, expect, it } from "vitest";
import {
  buildExtractionMessages,
  buildKnownContext,
  buildMemoryContext,
  buildProfileContext,
  buildStyleContext,
  buildSummaryMessages,
  buildSummaryTranscript,
  buildSystemPrompt,
  QUICK_PROMPTS,
  SUMMARY_PROMPT,
} from "./prompts";
import type { Message } from "../db/repositories/chat";
import { MAX_CUSTOM_INSTRUCTIONS } from "../domain/settings";
import type { Profile } from "../db/repositories/profile";

const profile: Profile = {
  first_name: "Julien",
  last_name: "Doe",
  job_title: null,
  financial_goals: null,
  birth_date: null,
  tax_residence: null,
  monthly_expenses_minor: null,
  dependants_count: null,
  dependant_ages: null,
  employment_status: null,
  currency: "CHF",
  timezone: "Europe/Zurich",
  date_format: "%d.%m.%Y",
  salary_minor: 12000000,
  monthly_savings_target_minor: 150000,
  risk_profile: "growth",
  ai_tone: "direct",
  ai_verbosity: "concise",
  ai_expertise: "expert",
};

describe("prompt sections", () => {
  it("summarises the profile in one line", () => {
    expect(buildProfileContext(profile, [])).toBe(
      "## User financial context\nname: Julien Doe; annual salary: 120,000.00 CHF; risk profile: growth; monthly savings target: 1,500.00\n",
    );
  });

  it("states the age computed from the birth date", () => {
    const text = buildProfileContext(
      { ...profile, salary_minor: null, monthly_savings_target_minor: null, risk_profile: null, birth_date: "1990-03-15" },
      [],
      "2026-11-01",
    );
    expect(text).toContain("age: 36");
    // Age leads the paragraph, before the name.
    expect(text.indexOf("age:")).toBeLessThan(text.indexOf("name:"));
  });

  it("includes the job title and the free-text aspirations", () => {
    const text = buildProfileContext(
      {
        ...profile,
        salary_minor: null,
        monthly_savings_target_minor: null,
        risk_profile: null,
        job_title: "Senior SRE",
        financial_goals: "Retire comfortably, buy a house.",
      },
      [],
    );
    expect(text).toContain("job: Senior SRE");
    expect(text).toContain("financial goals: Retire comfortably, buy a house.");
    // Order: name, job, salary, risk profile, financial goals, savings.
    expect(text.indexOf("job:")).toBeLessThan(text.indexOf("financial goals:"));
  });

  it("lists goals with amount, date and extras", () => {
    const text = buildProfileContext({ ...profile, salary_minor: null }, [
      { id: 1, label: "House", target_amount_minor: 10000000, target_date: "2029-01-01", priority: "high", category: "housing", created_at: "", updated_at: "" },
    ]);
    expect(text).toContain("- House \u2014 100,000 CHF \u2014 by 2029-01-01 (high, housing)");
  });

  it("is empty without any profile field", () => {
    expect(buildProfileContext({ ...profile, first_name: null, salary_minor: null, monthly_savings_target_minor: null, risk_profile: null }, [])).toBe("");
  });

  it("states the style and memories", () => {
    expect(buildStyleContext(profile)).toBe(
      "## Response style\nTone: direct. Verbosity: concise. Financial expertise level: expert.\n",
    );
    expect(buildMemoryContext([])).toBe("");
    expect(
      buildMemoryContext([{ id: 1, category: "goal", key: "k", content: "Saving for a house", source: "manual", conversation_id: null, importance: 5, created_at: "", updated_at: "" }]),
    ).toBe("## What I know about the user (from past conversations)\n- [goal] Saving for a house\n");
  });

  it("assembles the system prompt with date, currency and sections", () => {
    const prompt = buildSystemPrompt({
      today: "2026-10-31",
      baseCurrency: "CHF",
      profile,
      goals: [],
      memories: [],
    });
    expect(prompt).toContain("Today is 2026-10-31.");
    expect(prompt).toContain("base currency is CHF");
    expect(prompt).toContain("## Response style");
    expect(prompt).not.toContain("{date}");
    expect(prompt).toContain("never invent numbers");
    // The rule that stops a model from inventing a currency symbol of its own.
    expect(prompt).toContain("Copy those strings verbatim");
    // Tax residence is context for jurisdiction-dependent answers.
    expect(prompt).toContain("Tax residence");
    expect(prompt).toContain("Never substitute a currency symbol");
  });

  it("adds the standing instructions between style and memories, and nothing when empty", () => {
    const base = { today: "2026-11-05", baseCurrency: "CHF", profile, goals: [], memories: [] };

    const withText = buildSystemPrompt({
      ...base,
      customInstructions: "Show three risk categories for every suggestion.",
    });
    expect(withText).toContain("## Standing instructions");
    expect(withText).toContain("Show three risk categories for every suggestion.");
    // Order matters: after the profile and style, before what it remembers.
    expect(withText.indexOf("## Response style")).toBeLessThan(
      withText.indexOf("## Standing instructions"),
    );

    // Unset adds no heading at all, not an empty one.
    for (const empty of ["", "   ", null, undefined]) {
      const prompt = buildSystemPrompt({ ...base, customInstructions: empty });
      expect(prompt).not.toContain("## Standing instructions");
      expect(prompt).not.toContain("{instructions_section}");
    }
  });

  it("caps the standing instructions at the stored maximum", () => {
    const prompt = buildSystemPrompt({
      today: "2026-11-05",
      baseCurrency: "CHF",
      profile,
      goals: [],
      memories: [],
      customInstructions: "x".repeat(MAX_CUSTOM_INSTRUCTIONS + 500),
    });
    expect(prompt).toContain("x".repeat(MAX_CUSTOM_INSTRUCTIONS));
    expect(prompt).not.toContain("x".repeat(MAX_CUSTOM_INSTRUCTIONS + 1));
  });

  it("forbids the model from doing arithmetic itself", () => {
    const prompt = buildSystemPrompt({
      today: "2026-11-05",
      baseCurrency: "CHF",
      profile,
      goals: [],
      memories: [],
    });
    // Without this the model called `calculate` for the hard sums and did
    // 418,446.13 x 80% in prose.
    expect(prompt).toContain("never work out a percentage");
    expect(prompt).toContain("Call `calculate`");
    // Retyping 421,135.48 as 421,135 changed the answer by 0.69.
    expect(prompt).toContain("do not retype a rounded version");
    // 1,533 EUR divided by 418,446 CHF is not a share.
    expect(prompt).toContain("Never divide or add amounts in different currencies");
    // Runway had three answers because "liquid" was never defined.
    expect(prompt).toContain("For runway, use the liquid figure");
    expect(prompt).toContain("cash and emergency fund, not the whole portfolio");
    // A zero liquid figure has two causes and they mean opposite things.
    expect(prompt).toContain("never tell the user they have no cash");
  });

  it("bounds the assistant to money questions without refusing adjacent ones", () => {
    const prompt = buildSystemPrompt({
      today: "2026-10-31",
      baseCurrency: "CHF",
      profile,
      goals: [],
      memories: [],
    });
    // Off-topic questions are declined in one line...
    expect(prompt).toContain("Stay in scope");
    expect(prompt).toContain("If a question is unrelated to their finances");
    // ...but tax, insurance and pensions are explicitly in scope. A guard that
    // refused those would be a worse bug than the one it fixes, so the boundary
    // and its exception are asserted together.
    expect(prompt).toContain("Never refuse a money question");
    for (const topic of ["tax", "insurance", "property", "pension", "inheritance"]) {
      expect(prompt).toContain(topic);
    }
  });

  it("states the planning facts the assistant needs", () => {
    const text = buildProfileContext(
      {
        ...profile,
        salary_minor: null,
        monthly_savings_target_minor: null,
        risk_profile: null,
        monthly_expenses_minor: 420000,
        dependants_count: 2,
        dependant_ages: "4, 7",
        employment_status: "self_employed",
      },
      [],
    );
    expect(text).toContain("monthly living expenses: 4,200.00 CHF");
    expect(text).toContain("employment: self-employed");
    expect(text).toContain("dependants: 2 (ages 4, 7)");
  });

  it("says 'none' only when the count is explicit, and omits an unset field", () => {
    const none = buildProfileContext({ ...profile, salary_minor: null, monthly_savings_target_minor: null, risk_profile: null, dependants_count: 0 }, []);
    expect(none).toContain("dependants: none");

    const unset = buildProfileContext({ ...profile, salary_minor: null, monthly_savings_target_minor: null, risk_profile: null, dependants_count: null }, []);
    expect(unset).not.toContain("dependants");
    expect(unset).not.toContain("monthly living expenses");
  });

  it("puts the country of tax residence in the profile context", () => {
    const context = buildProfileContext({ ...profile, tax_residence: "CH" }, []);
    expect(context).toContain("tax residence: Switzerland (CH)");
    // An unknown or unset code adds nothing rather than a stray label.
    expect(buildProfileContext({ ...profile, tax_residence: null }, [])).not.toContain("tax residence");
  });

  it("labels the extraction transcript by role", () => {
    const [system, user] = buildExtractionMessages([
      { role: "user", content: "I have two kids" },
      { role: "assistant", content: "Noted" },
    ]);

    // Two turns, never a system-only request: Gemini answers that with
    // "500 no user query found in messages".
    expect(system.role).toBe("system");
    expect(system.content).toContain("Only extract facts explicitly stated");
    expect(user.role).toBe("user");
    expect(user.content).toBe("[User]: I have two kids\n[Assistant]: Noted");
  });

  it("tells the extraction model what it already knows", () => {
    const known = buildKnownContext({
      profile: { ...profile, job_title: "SRE", tax_residence: "CH" },
      goals: [{ id: 1, label: "House", target_amount_minor: 5000000, target_date: "2030-01-01", priority: "high", category: null, created_at: "", updated_at: "" }],
      memories: [{ key: "kids", content: "User has two children" }],
      assets: ["UBS - Compte (Cash)", "Boursorama - PEA"],
    });

    expect(known).toContain("## Already known");
    expect(known).toContain("job: SRE");
    expect(known).toContain("tax residence: Switzerland (CH)");
    expect(known).toContain("- UBS - Compte (Cash)");
    expect(known).toContain("## Financial goals");
    expect(known).toContain("- kids: User has two children");
  });

  it("says nothing when the app knows nothing yet", () => {
    expect(buildKnownContext({ profile: null, goals: [], memories: [], assets: [] })).toBe("");
  });

  it("puts the known context and the no-repeat rule in the system turn", () => {
    const [system] = buildExtractionMessages(
      [{ role: "user", content: "hello" }],
      "## Already known\nname: Julien\n\n",
    );
    expect(system.content).toContain("Do not propose anything already listed");
    expect(system.content).toContain("## Already known");
  });

  it("ships the suggested prompts, including the two advisory ones", () => {
    expect(QUICK_PROMPTS.map((p) => p.id)).toEqual([
      "portfolio-review",
      "allocation-risk",
      "performance",
      "priorities",
      "stress-test",
      "retirement-plan",
      "succession",
    ]);
    // Every entry needs the four fields the rail renders, or a button is blank.
    for (const prompt of QUICK_PROMPTS) {
      expect(prompt.label.length).toBeGreaterThan(0);
      expect(prompt.hint.length).toBeGreaterThan(0);
      expect(prompt.icon.startsWith("bi-")).toBe(true);
      expect(prompt.prompt.length).toBeGreaterThan(80);
    }
  });

  it("asks for succession facts instead of inventing them", () => {
    const succession = QUICK_PROMPTS.find((p) => p.id === "succession");
    // The profile has no heirs, marital regime or will, so the prompt has to ask.
    expect(succession?.prompt).toContain("do not assume them");
    expect(succession?.prompt).toContain("ask me for whatever you need");
    // And it stays advisory rather than drafting a will.
    expect(succession?.prompt).toContain("notary");
  });

  it("labels the retirement projection as assumptions", () => {
    const retirement = QUICK_PROMPTS.find((p) => p.id === "retirement-plan");
    expect(retirement?.prompt).toContain("monthly living expenses");
    expect(retirement?.prompt).toContain("assumption rather than a fact");
  });
});


describe("conversation summary", () => {
  const msg = (id: number, role: Message["role"], content: string, toolCalls: string | null = null): Message => ({
    id,
    conversation_id: 5,
    role,
    content,
    tool_calls: toolCalls,
    tool_call_id: role === "tool" ? "c1" : null,
    created_at: "",
    updated_at: "",
  });

  it("keeps the words and drops the plumbing", () => {
    const transcript = buildSummaryTranscript([
      msg(1, "user", "How is my portfolio doing?"),
      msg(2, "assistant", "Let me look that up.", '[{"id":"c1","function":{"name":"get_portfolio_summary"}}]'),
      msg(3, "tool", '{"total":"1,000 CHF"}'),
      msg(4, "assistant", "It is up 4% this year."),
    ]);
    expect(transcript).toContain("User: How is my portfolio doing?");
    expect(transcript).toContain("Assistant: It is up 4% this year.");
    // A preamble that led to a tool call is not conversation, and the tool
    // result would make the summary read like a log.
    expect(transcript).not.toContain("Let me look that up.");
    expect(transcript).not.toContain("1,000 CHF");
  });

  it("truncates from the front, so the newest exchange survives", () => {
    const transcript = buildSummaryTranscript(
      [msg(1, "user", "oldest ".repeat(200)), msg(2, "user", "newest question")],
      100,
    );
    expect(transcript).toContain("newest question");
    expect(transcript).not.toContain("oldest");
    expect(transcript.length).toBeLessThanOrEqual(100);
  });

  it("is empty when there is nothing but plumbing", () => {
    expect(buildSummaryTranscript([msg(3, "tool", "{}")])).toBe("");
  });

  it("sends the instruction and the transcript as two turns", () => {
    const messages = buildSummaryMessages("User: hello");
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[0].content).toBe(SUMMARY_PROMPT);
    expect(messages[1].content).toBe("User: hello");
  });

  it("forbids the summariser from adding advice of its own", () => {
    expect(SUMMARY_PROMPT).toContain("Do not give new advice");
    expect(SUMMARY_PROMPT).toContain("not add anything that is not in the transcript");
  });
});
