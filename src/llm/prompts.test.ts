import { describe, expect, it } from "vitest";
import { buildExtractionMessages, buildKnownContext, buildMemoryContext, buildProfileContext, buildStyleContext, buildSystemPrompt, QUICK_PROMPTS } from "./prompts";
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

  it("ships the five suggested prompts", () => {
    expect(QUICK_PROMPTS.map((p) => p.id)).toEqual([
      "portfolio-review",
      "allocation-risk",
      "performance",
      "priorities",
      "stress-test",
    ]);
  });
});
