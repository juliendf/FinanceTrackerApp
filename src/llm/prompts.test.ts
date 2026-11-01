import { describe, expect, it } from "vitest";
import { buildExtractionPrompt, buildMemoryContext, buildProfileContext, buildStyleContext, buildSystemPrompt, QUICK_PROMPTS } from "./prompts";
import type { Profile } from "../db/repositories/profile";

const profile: Profile = {
  first_name: "Julien",
  last_name: "Doe",
  job_title: null,
  financial_goals: null,
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
  it("summarises the profile in the source's wording", () => {
    expect(buildProfileContext(profile, [])).toBe(
      "## User financial context\nname: Julien Doe; annual salary: 120,000.00 CHF; risk profile: growth; monthly savings target: 1,500.00\n",
    );
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
    // Source order: name, job, salary, risk profile, financial goals, savings.
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
  });

  it("labels the extraction transcript by role", () => {
    const prompt = buildExtractionPrompt([
      { role: "user", content: "I have two kids" },
      { role: "assistant", content: "Noted" },
    ]);
    expect(prompt).toContain("[User]: I have two kids");
    expect(prompt).toContain("[Assistant]: Noted");
    expect(prompt).toContain("Only extract facts explicitly stated");
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
