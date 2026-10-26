/**
 * Port of `app/utils/constants.py` (`SystemCategory`).
 *
 * Fixed taxonomy used by the Résumé view to compute Cash, Emergency Fund and
 * standardised breakdowns independently of user-defined categories. The labels
 * stay French because the Résumé screen is French in the source.
 */

export const SYSTEM_ROLES = {
  CASH: "cash",
  EMERGENCY_FUND: "emergency_fund",
  BONDS: "bonds",
  STOCKS: "stocks",
  REAL_ESTATE: "real_estate",
  RETIREMENT: "retirement",
  ALTERNATIVE: "alternative",
  OTHER: "other",
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export const SYSTEM_ROLE_CHOICES: Array<{ value: SystemRole; label: string }> = [
  { value: SYSTEM_ROLES.CASH, label: "Liquidités" },
  { value: SYSTEM_ROLES.EMERGENCY_FUND, label: "Fonds d'urgence" },
  { value: SYSTEM_ROLES.BONDS, label: "Obligations" },
  { value: SYSTEM_ROLES.STOCKS, label: "Actions / ETF" },
  { value: SYSTEM_ROLES.REAL_ESTATE, label: "Immobilier" },
  { value: SYSTEM_ROLES.RETIREMENT, label: "Retraite / Prévoyance" },
  { value: SYSTEM_ROLES.ALTERNATIVE, label: "Or / Crypto / Matières premières" },
  { value: SYSTEM_ROLES.OTHER, label: "Autre" },
];

export const SYSTEM_ROLE_LABELS: Record<string, string> = Object.fromEntries(
  SYSTEM_ROLE_CHOICES.map((choice) => [choice.value, choice.label]),
);

export function isSystemRole(value: string | null | undefined): value is SystemRole {
  return !!value && value in SYSTEM_ROLE_LABELS;
}
