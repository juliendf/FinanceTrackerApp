/**
 * The profile query and the profile shape must agree.
 *
 * The bug this pins: `saveProfile` wrote `job_title`, `financial_goals` and
 * `birth_date`, but `getProfile` never selected them. The form therefore loaded
 * them as empty — and the next save wrote `NULL` back over what was stored. The
 * fields were not "not saving"; they were being erased on the next edit.
 *
 * The chat prompt reads the profile through the same function, so those three
 * fields were missing from the assistant's context as well.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const select = vi.hoisted(() => vi.fn());
const executeWrite = vi.hoisted(() => vi.fn());
const runTransaction = vi.hoisted(() => vi.fn());

vi.mock("../client", () => ({
  getDb: async () => ({ select }),
  executeWrite: (...a: unknown[]) => executeWrite(...a),
}));
vi.mock("../transaction", () => ({ runTransaction: (...a: unknown[]) => runTransaction(...a) }));

import { EMPTY_PROFILE, getProfile, saveProfile, type Profile } from "./profile";

/** The row a fully filled profile would produce. */
const ROW: Profile = {
  first_name: "Julien",
  last_name: "S",
  job_title: "Cloud engineer",
  financial_goals: "Buy a house; learn to sail",
  birth_date: "1988-04-12",
  currency: "CHF",
  timezone: "Europe/Zurich",
  date_format: "DD.MM.YYYY",
  salary_minor: 900000,
  monthly_savings_target_minor: 200000,
  risk_profile: "balanced",
  ai_tone: "encouraging",
  ai_verbosity: "concise",
  ai_expertise: "advanced",
};

describe("getProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects every column the Profile interface declares", async () => {
    select.mockResolvedValue([]);
    await getProfile();

    const sql = String(select.mock.calls[0][0]);
    const missing = Object.keys(EMPTY_PROFILE).filter(
      (column) => !new RegExp(`\\b${column}\\b`).test(sql),
    );
    expect(missing).toEqual([]);
  });

  it("returns the fields the form edits, including job title and aspirations", async () => {
    select.mockResolvedValue([ROW]);
    const profile = await getProfile();

    expect(profile.job_title).toBe("Cloud engineer");
    expect(profile.financial_goals).toBe("Buy a house; learn to sail");
    expect(profile.birth_date).toBe("1988-04-12");
  });

  it("falls back to the empty profile when no row exists", async () => {
    select.mockResolvedValue([]);
    expect(await getProfile()).toEqual(EMPTY_PROFILE);
  });
});

describe("saveProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runTransaction.mockResolvedValue(1);
  });

  it("writes the same columns the reader selects", async () => {
    await saveProfile(ROW);

    const [columns, values] = runTransaction.mock.calls[0] as [string[], unknown];
    const colText = String(columns);
    const missing = Object.keys(ROW).filter(
      (column) => column !== "salary" && !new RegExp(`\\b${column}\\b`).test(colText),
    );
    expect(missing).toEqual([]);
    void values;

    // The two free-text fields that were being erased.
    expect(colText).toContain("'Cloud engineer'");
    expect(colText).toContain("'Buy a house; learn to sail'");
  });

  it("stores an empty field as NULL, not as an empty string", async () => {
    await saveProfile({ ...ROW, job_title: null });
    const colText = String((runTransaction.mock.calls[0] as [string[]])[0]);
    expect(colText).toContain("NULL");
  });
});
