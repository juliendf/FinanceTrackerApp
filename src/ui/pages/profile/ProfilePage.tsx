/**
 * Profile: port of `templates/auth/profile.html`, minus the account/password
 * parts (there is no account here).
 *
 * Three sections: the profile itself (identity, financial context, AI response
 * style), the memories the assistant can use, and the structured goals that are
 * fed into its prompt.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GOAL_CATEGORIES,
  GOAL_PRIORITIES,
  MEMORY_CATEGORIES,
  createGoal,
  createMemory,
  deleteGoal,
  deleteMemory,
  getProfile,
  listGoals,
  listMemories,
  saveProfile,
  updateGoal,
  updateMemory,
  type Goal,
  type Memory,
  type Profile,
} from "../../../db/repositories/profile";
import { fromMinorUnits, toMinorUnits } from "../../../domain/money";
import { CURRENCY_CHOICES } from "../../../domain/settings";
import { formatDate } from "../../../domain/format";
import { deriveMemoryKey } from "../../../domain/memoryKey";
import { DeleteConfirmModal } from "../../components/DeleteConfirmModal";
import { PageHeader } from "../../components/FormCard";
import { useToast } from "../../layout/Toasts";

const RISK_CHOICES = [
  { value: "", label: "-- Select --" },
  { value: "conservative", label: "Conservative" },
  { value: "moderate", label: "Moderate" },
  { value: "growth", label: "Growth" },
  { value: "aggressive", label: "Aggressive" },
] as const;

const TONE_CHOICES = [
  { value: "encouraging", label: "Encouraging — supportive and positive" },
  { value: "neutral", label: "Neutral — factual and balanced" },
  { value: "direct", label: "Direct — straight to the point, no sugar-coating" },
] as const;

const VERBOSITY_CHOICES = [
  { value: "concise", label: "Concise — short answers, bullet points" },
  { value: "balanced", label: "Balanced — moderate detail" },
  { value: "detailed", label: "Detailed — explain reasoning and context" },
] as const;

const EXPERTISE_CHOICES = [
  { value: "beginner", label: "Beginner — explain terms and concepts" },
  { value: "intermediate", label: "Intermediate — assume basic financial knowledge" },
  { value: "expert", label: "Expert — use financial jargon, skip basics" },
] as const;

const IMPORTANCE_CHOICES = [1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: `${n}${n === 1 ? " - Low" : n === 3 ? " - Medium" : n === 5 ? " - High" : ""}`,
}));

interface Draft extends Profile {
  salary: string;
  savings: string;
}

const toDraft = (profile: Profile): Draft => ({
  ...profile,
  salary: profile.salary_minor === null ? "" : String(fromMinorUnits(profile.salary_minor) ?? ""),
  savings:
    profile.monthly_savings_target_minor === null
      ? ""
      : String(fromMinorUnits(profile.monthly_savings_target_minor) ?? ""),
});

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <div className="form-section">
      <h5 className="mb-3">
        <i className={`bi ${icon} me-2`} aria-hidden="true" />
        {title}
      </h5>
      {children}
    </div>
  );
}

export function ProfilePage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  const memories = useQuery({ queryKey: ["memories"], queryFn: listMemories });
  const goals = useQuery({ queryKey: ["goals"], queryFn: listGoals });

  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (profile.data) setDraft(toDraft(profile.data));
  }, [profile.data]);

  const refresh = () => {
    for (const key of ["profile", "memories", "goals", "settings"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const save = useMutation({
    mutationFn: (values: Draft) =>
      saveProfile({
        ...values,
        salary_minor: values.salary.trim() === "" ? null : toMinorUnits(values.salary),
        monthly_savings_target_minor:
          values.savings.trim() === "" ? null : toMinorUnits(values.savings),
      }),
    onSuccess: () => {
      refresh();
      toast.success("Profile updated successfully.");
    },
    onError: (error: unknown) =>
      toast.error(`Error saving profile: ${error instanceof Error ? error.message : String(error)}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    if (!draft.first_name?.trim()) {
      toast.error("First name is required.");
      return;
    }
    save.mutate(draft);
  };

  if (!draft) return <p className="text-muted">Loading…</p>;

  return (
    <>
      <PageHeader
        title="Profile"
        subtitle="Your financial context, and what the assistant knows about you"
        icon="person-gear"
        showDate={false}
      />

      <form onSubmit={submit} noValidate>
        <Section title="Identity" icon="bi-person">
          <div className="row">
            <div className="col-md-6 mb-3">
              <label htmlFor="first_name" className="form-label">First Name</label>
              <input
                id="first_name"
                className="form-control"
                maxLength={50}
                value={draft.first_name ?? ""}
                onChange={(e) => setDraft({ ...draft, first_name: e.target.value })}
              />
            </div>
            <div className="col-md-6 mb-3">
              <label htmlFor="last_name" className="form-label">Last Name</label>
              <input
                id="last_name"
                className="form-control"
                maxLength={50}
                value={draft.last_name ?? ""}
                onChange={(e) => setDraft({ ...draft, last_name: e.target.value })}
              />
            </div>
          </div>
        </Section>

        <Section title="Financial context" icon="bi-cash-coin">
          <div className="row">
            <div className="col-md-4 mb-3">
              <label htmlFor="currency" className="form-label">Currency</label>
              <select
                id="currency"
                className="form-select"
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
              >
                {CURRENCY_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.value}</option>
                ))}
              </select>
            </div>
            <div className="col-md-4 mb-3">
              <label htmlFor="job_title" className="form-label">Job Title</label>
              <input
                id="job_title"
                className="form-control"
                maxLength={100}
                value={draft.job_title ?? ""}
                placeholder="Senior SRE"
                onChange={(e) => setDraft({ ...draft, job_title: e.target.value || null })}
              />
            </div>
            <div className="col-md-4 mb-3">
              <label htmlFor="salary" className="form-label">Annual Salary</label>
              <input
                id="salary"
                type="number"
                step="0.01"
                min="0"
                className="form-control"
                value={draft.salary}
                placeholder="0.00"
                onChange={(e) => setDraft({ ...draft, salary: e.target.value })}
              />
            </div>
            <div className="col-md-4 mb-3">
              <label htmlFor="savings" className="form-label">Monthly Savings Target</label>
              <input
                id="savings"
                type="number"
                step="0.01"
                min="0"
                className="form-control"
                value={draft.savings}
                placeholder="0.00"
                onChange={(e) => setDraft({ ...draft, savings: e.target.value })}
              />
            </div>
            <div className="col-md-4 mb-3">
              <label htmlFor="risk_profile" className="form-label">Risk Profile</label>
              <select
                id="risk_profile"
                className="form-select"
                value={draft.risk_profile ?? ""}
                onChange={(e) => setDraft({ ...draft, risk_profile: e.target.value || null })}
              >
                {RISK_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mb-1">
            <label htmlFor="financial_goals" className="form-label">Other Aspirations</label>
            <textarea
              id="financial_goals"
              className="form-control"
              rows={4}
              maxLength={2000}
              value={draft.financial_goals ?? ""}
              placeholder="Anything that does not fit in a structured goal: life aspirations, vague plans, ideas you are exploring."
              onChange={(e) => setDraft({ ...draft, financial_goals: e.target.value || null })}
            />
            <div className="form-text">
              Free text, shared with the assistant alongside the structured goals below.
            </div>
          </div>
        </Section>

        <Section title="AI response style" icon="bi-chat-quote">
          <div className="row">
            <div className="col-md-4 mb-3">
              <label htmlFor="ai_tone" className="form-label">AI Tone</label>
              <select
                id="ai_tone"
                className="form-select"
                value={draft.ai_tone}
                onChange={(e) => setDraft({ ...draft, ai_tone: e.target.value })}
              >
                {TONE_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </select>
            </div>
            <div className="col-md-4 mb-3">
              <label htmlFor="ai_verbosity" className="form-label">AI Verbosity</label>
              <select
                id="ai_verbosity"
                className="form-select"
                value={draft.ai_verbosity}
                onChange={(e) => setDraft({ ...draft, ai_verbosity: e.target.value })}
              >
                {VERBOSITY_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </select>
            </div>
            <div className="col-md-4 mb-3">
              <label htmlFor="ai_expertise" className="form-label">Financial Expertise</label>
              <select
                id="ai_expertise"
                className="form-select"
                value={draft.ai_expertise}
                onChange={(e) => setDraft({ ...draft, ai_expertise: e.target.value })}
              >
                {EXPERTISE_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </select>
            </div>
          </div>
          <p className="text-muted small mb-0">
            These lines are added to the assistant's system prompt verbatim, so its answers match the style you pick.
          </p>
        </Section>

        <div className="d-flex flex-wrap gap-2 mt-4 pt-3 border-top">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            <i className="bi bi-check-lg me-2" aria-hidden="true" />
            Save Profile
          </button>
        </div>
      </form>

      <GoalsSection goals={goals.data ?? []} onChange={refresh} currency={draft.currency} />
      <MemoriesSection memories={memories.data ?? []} onChange={refresh} />
    </>
  );
}

// --- memories ----------------------------------------------------------------------

function MemoriesSection({ memories, onChange }: { memories: Memory[]; onChange: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Memory | "new" | null>(null);
  const [form, setForm] = useState({ category: "personal", content: "", importance: "3" });
  const [pendingDelete, setPendingDelete] = useState<Memory | null>(null);

  const open = (memory: Memory | "new") => {
    setEditing(memory);
    setForm(
      memory === "new"
        ? { category: "personal", content: "", importance: "3" }
        : { category: memory.category, content: memory.content, importance: String(memory.importance) },
    );
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.content.trim()) {
      toast.error("Write the fact to remember.");
      return;
    }
    try {
      const payload = {
        category: form.category,
        // New memories get a key derived from their text; editing keeps the one
        // that is already there so references stay stable.
        key:
          editing === "new"
            ? deriveMemoryKey(form.content, memories.map((memory) => memory.key))
            : (editing?.key ?? deriveMemoryKey(form.content)),
        content: form.content.trim(),
        importance: Number(form.importance),
      };
      if (editing === "new") await createMemory(payload);
      else if (editing) await updateMemory(editing.id, payload);
      setEditing(null);
      onChange();
      toast.success("Memory saved.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <div className="form-section mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="mb-0"><i className="bi bi-lightbulb me-2" aria-hidden="true" />What I know about you</h5>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => open("new")}>
          <i className="bi bi-plus-lg" aria-hidden="true" />
          Add memory
        </button>
      </div>
      <p className="text-muted small">
        Facts the assistant carries into every conversation; the ten most important are in its prompt. They arrive two
        ways: <strong>from chat</strong>, where the assistant proposes one and it lands here only after you confirm the
        card, or <strong>by hand</strong> with the button above.
      </p>

      {memories.length === 0 ? (
        <p className="text-muted mb-0">
          Nothing remembered yet. Ask the assistant to remember something, or add it yourself.
        </p>
      ) : (
        <div className="table-container">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Category</th><th>What the assistant knows</th><th>Importance</th><th>Source</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {memories.map((memory) => (
                  <tr key={memory.id}>
                    <td><span className="chip">{memory.category}</span></td>
                    <td>{memory.content}</td>
                    <td>{memory.importance}/5</td>
                    <td>
                      {memory.source === "ai_extracted" ? (
                        <span className="text-muted small">
                          <i className="bi bi-stars me-1" aria-hidden="true" />
                          AI
                        </span>
                      ) : (
                        <span className="text-muted small">Manual</span>
                      )}
                    </td>
                    <td className="text-end">
                      <div className="row-actions d-inline-flex">
                        <button type="button" className="btn btn-icon" aria-label={`Edit memory ${memory.key}`} onClick={() => open(memory)}>
                          <i className="bi bi-pencil" aria-hidden="true" />
                        </button>
                        <button type="button" className="btn btn-icon btn-icon-danger" aria-label={`Delete memory ${memory.key}`} onClick={() => setPendingDelete(memory)}>
                          <i className="bi bi-trash" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing ? (
        <form className="card card-finance mt-3" onSubmit={(event) => void save(event)}>
          <div className="card-body">
            <h6 className="card-title">{editing === "new" ? "New memory" : "Edit memory"}</h6>
            <div className="row">
              <div className="col-md-4 mb-3">
                <label htmlFor="memory_category" className="form-label">Category</label>
                <select id="memory_category" className="form-select" value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {MEMORY_CATEGORIES.map((choice) => (
                    <option key={choice.value} value={choice.value}>{choice.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-4 mb-3">
                <label htmlFor="memory_importance" className="form-label">Importance</label>
                <select id="memory_importance" className="form-select" value={form.importance}
                  onChange={(e) => setForm({ ...form, importance: e.target.value })}>
                  {IMPORTANCE_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>{choice.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-12 mb-3">
                <label htmlFor="memory_content" className="form-label">Content</label>
                <textarea id="memory_content" className="form-control" rows={3} maxLength={5000} value={form.content}
                  placeholder="User has 2 children, ages 5 and 7"
                  onChange={(e) => setForm({ ...form, content: e.target.value })} />
                <div className="form-text">Write in third person: "User has…".</div>
              </div>
            </div>
            <div className="d-flex gap-2">
              <button type="submit" className="btn btn-primary btn-sm">Save memory</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </form>
      ) : null}

      <DeleteConfirmModal
        show={pendingDelete !== null}
        title="Delete memory"
        message={pendingDelete ? `Delete "[${pendingDelete.category}] ${pendingDelete.content}"?` : ""}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteMemory(pendingDelete.id);
          setPendingDelete(null);
          onChange();
          toast.success("Memory deleted.");
        }}
      />
    </div>
  );
}

// --- goals ---------------------------------------------------------------------------

function GoalsSection({ goals, onChange, currency }: { goals: Goal[]; onChange: () => void; currency: string }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [form, setForm] = useState({ label: "", amount: "", date: "", priority: "medium", category: "" });
  const [pendingDelete, setPendingDelete] = useState<Goal | null>(null);

  const open = (goal: Goal | "new") => {
    setEditing(goal);
    setForm(
      goal === "new"
        ? { label: "", amount: "", date: "", priority: "medium", category: "" }
        : {
            label: goal.label,
            amount: goal.target_amount_minor === null ? "" : String(fromMinorUnits(goal.target_amount_minor) ?? ""),
            date: goal.target_date ?? "",
            priority: goal.priority,
            category: goal.category ?? "",
          },
    );
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.label.trim()) {
      toast.error("A goal needs a label.");
      return;
    }
    const payload = {
      label: form.label.trim(),
      target_amount_minor: form.amount.trim() === "" ? null : toMinorUnits(form.amount),
      target_date: form.date || null,
      priority: form.priority,
      category: form.category || null,
    };
    try {
      if (editing === "new") await createGoal(payload);
      else if (editing) await updateGoal(editing.id, payload);
      setEditing(null);
      onChange();
      toast.success("Goal saved.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <div className="form-section mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="mb-0"><i className="bi bi-bullseye me-2" aria-hidden="true" />Financial goals</h5>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => open("new")}>
          <i className="bi bi-plus-lg" aria-hidden="true" />
          Add goal
        </button>
      </div>
      <p className="text-muted small">Goals appear in the assistant's prompt as a list, with their amounts and dates.</p>

      {goals.length === 0 ? (
        <p className="text-muted mb-0">No structured goals yet.</p>
      ) : (
        <div className="table-container">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Goal</th><th className="num">Target</th><th>Date</th><th>Priority</th><th>Category</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {goals.map((goal) => (
                  <tr key={goal.id}>
                    <td><span className="cell-title">{goal.label}</span></td>
                    <td className="num">
                      {goal.target_amount_minor === null
                        ? "—"
                        : `${fromMinorUnits(goal.target_amount_minor)?.toFixed(2)} ${currency}`}
                    </td>
                    <td>{goal.target_date ? formatDate(goal.target_date) : "—"}</td>
                    <td><span className="chip">{goal.priority}</span></td>
                    <td>{goal.category ?? "—"}</td>
                    <td className="text-end">
                      <div className="row-actions d-inline-flex">
                        <button type="button" className="btn btn-icon" aria-label={`Edit goal ${goal.label}`} onClick={() => open(goal)}>
                          <i className="bi bi-pencil" aria-hidden="true" />
                        </button>
                        <button type="button" className="btn btn-icon btn-icon-danger" aria-label={`Delete goal ${goal.label}`} onClick={() => setPendingDelete(goal)}>
                          <i className="bi bi-trash" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing ? (
        <form className="card card-finance mt-3" onSubmit={(event) => void save(event)}>
          <div className="card-body">
            <h6 className="card-title">{editing === "new" ? "New goal" : "Edit goal"}</h6>
            <div className="row">
              <div className="col-md-6 mb-3">
                <label htmlFor="goal_label" className="form-label">Goal Label</label>
                <input id="goal_label" className="form-control" maxLength={200} value={form.label}
                  placeholder="House downpayment" onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div className="col-md-3 mb-3">
                <label htmlFor="goal_amount" className="form-label">Target Amount</label>
                <input id="goal_amount" type="number" step="0.01" min="0" className="form-control" value={form.amount}
                  placeholder="0.00" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="col-md-3 mb-3">
                <label htmlFor="goal_date" className="form-label">Target Date</label>
                <input id="goal_date" type="date" className="form-control" value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="col-md-6 mb-3">
                <label htmlFor="goal_priority" className="form-label">Priority</label>
                <select id="goal_priority" className="form-select" value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {GOAL_PRIORITIES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                </select>
              </div>
              <div className="col-md-6 mb-3">
                <label htmlFor="goal_category" className="form-label">Category</label>
                <select id="goal_category" className="form-select" value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {GOAL_CATEGORIES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                </select>
              </div>
            </div>
            <div className="d-flex gap-2">
              <button type="submit" className="btn btn-primary btn-sm">Save goal</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </form>
      ) : null}

      <DeleteConfirmModal
        show={pendingDelete !== null}
        title="Delete goal"
        message={pendingDelete ? `Delete the goal "${pendingDelete.label}"?` : ""}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteGoal(pendingDelete.id);
          setPendingDelete(null);
          onChange();
          toast.success("Goal deleted.");
        }}
      />
    </div>
  );
}
