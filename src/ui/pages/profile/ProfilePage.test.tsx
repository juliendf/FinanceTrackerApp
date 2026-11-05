// @vitest-environment jsdom
/**
 * Profile form behaviour.
 *
 * The regression: the form reseeded itself whenever the profile query refetched
 * (React Query does that on window focus), so half-typed input was replaced by
 * the stored row and a save then wrote the old values back.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  listMemories: vi.fn(),
  listGoals: vi.fn(),
  createMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
}));
vi.mock("../../../db/repositories/profile", () => ({
  getProfile: () => repo.getProfile(),
  saveProfile: (...a: unknown[]) => repo.saveProfile(...a),
  listMemories: () => repo.listMemories(),
  listGoals: () => repo.listGoals(),
  createMemory: (...a: unknown[]) => repo.createMemory(...a),
  updateMemory: (...a: unknown[]) => repo.updateMemory(...a),
  deleteMemory: (...a: unknown[]) => repo.deleteMemory(...a),
  createGoal: (...a: unknown[]) => repo.createGoal(...a),
  updateGoal: (...a: unknown[]) => repo.updateGoal(...a),
  deleteGoal: (...a: unknown[]) => repo.deleteGoal(...a),
  MEMORY_CATEGORIES: [{ value: "personal", label: "Personal" }],
  MARITAL_STATUS_CHOICES: [{ value: "married", label: "Married" }],
  MARITAL_REGIME_CHOICES: [{ value: "separation_de_biens", label: "Separation of property" }],
  HAS_WILL_CHOICES: [
    { value: "", label: "Not stated" },
    { value: "1", label: "Yes" },
    { value: "0", label: "No" },
  ],
  GOAL_PRIORITIES: [{ value: "medium", label: "Medium" }],
  GOAL_CATEGORIES: [{ value: "", label: "-- None --" }],
  EMPTY_PROFILE: {},
}));

import { ProfilePage } from "./ProfilePage";
import { ToastProvider } from "../../layout/Toasts";

const PROFILE = {
  first_name: "Julien",
  last_name: "de Freitas",
  job_title: "SRE",
  financial_goals: "Retire comfortably.",
  birth_date: "1990-03-15",
  currency: "CHF",
  timezone: "Europe/Zurich",
  date_format: "%d.%m.%Y",
  salary_minor: 14000000,
  monthly_savings_target_minor: 300000,
  risk_profile: "moderate",
  ai_tone: "direct",
  ai_verbosity: "concise",
  ai_expertise: "intermediate",
};

function renderProfile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  repo.getProfile.mockResolvedValue(PROFILE);
  repo.listMemories.mockResolvedValue([]);
  repo.listGoals.mockResolvedValue([]);
  repo.saveProfile.mockResolvedValue(undefined);
});

describe("ProfilePage", () => {
  it("keeps what you typed when the profile refetches", async () => {
    const user = userEvent.setup();
    const { client } = renderProfile();

    const job = (await screen.findByLabelText("Job Title")) as HTMLInputElement;
    expect(job.value).toBe("SRE");
    await user.clear(job);
    await user.type(job, "Principal SRE");

    await client.invalidateQueries({ queryKey: ["profile"] });
    await waitFor(() => expect(repo.getProfile).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("Job Title") as HTMLInputElement).value).toBe("Principal SRE");
  });

  it("saves the job title, aspirations and birth date", async () => {
    const user = userEvent.setup();
    renderProfile();

    const goals = (await screen.findByLabelText("Other Aspirations")) as HTMLTextAreaElement;
    await user.clear(goals);
    await user.type(goals, "Retire at 55, buy a house.");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => expect(repo.saveProfile).toHaveBeenCalledTimes(1));
    const saved = repo.saveProfile.mock.calls[0][0] as Record<string, unknown>;
    expect(saved).toMatchObject({
      job_title: "SRE",
      financial_goals: "Retire at 55, buy a house.",
      birth_date: "1990-03-15",
    });
  });

  it("saves monthly expenses, dependants and employment", async () => {
    const user = userEvent.setup();
    renderProfile();

    const expenses = (await screen.findByLabelText("Monthly Living Expenses")) as HTMLInputElement;
    await user.clear(expenses);
    await user.type(expenses, "4200.50");
    const dependants = screen.getByLabelText("Dependants") as HTMLInputElement;
    await user.clear(dependants);
    await user.type(dependants, "2");
    const ages = screen.getByLabelText("Their Ages") as HTMLInputElement;
    await user.type(ages, "4, 7");
    await user.selectOptions(screen.getByLabelText("Employment"), "self_employed");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => expect(repo.saveProfile).toHaveBeenCalledTimes(1));
    const saved = repo.saveProfile.mock.calls[0][0] as Record<string, unknown>;
    expect(saved).toMatchObject({
      monthly_expenses_minor: 420050,
      dependants_count: 2,
      dependant_ages: "4, 7",
      employment_status: "self_employed",
    });
  });

  it("leaves an empty planning field as null, not zero", async () => {
    const user = userEvent.setup();
    renderProfile();

    const dependants = (await screen.findByLabelText("Dependants")) as HTMLInputElement;
    await user.clear(dependants);
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => expect(repo.saveProfile).toHaveBeenCalledTimes(1));
    const saved = repo.saveProfile.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.dependants_count).toBeNull();
    expect(saved.monthly_expenses_minor).toBeNull();
  });

  it("shows the age derived from the birth date", async () => {
    renderProfile();
    await screen.findByLabelText("Job Title");
    expect(screen.getByText(/\d+ years old/)).toBeTruthy();
  });
});
