/**
 * The fixed system taxonomy for categories.
 *
 * Used by the Summary view to compute Cash, Emergency Fund and standardised
 * breakdowns independently of user-defined categories, and by the assistant for
 * its liquid-assets figure. The labels are English like the rest of the app; the
 * stored value is the key, so translating them touches no data.
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
  { value: SYSTEM_ROLES.CASH, label: "Cash" },
  { value: SYSTEM_ROLES.EMERGENCY_FUND, label: "Emergency fund" },
  { value: SYSTEM_ROLES.BONDS, label: "Bonds" },
  { value: SYSTEM_ROLES.STOCKS, label: "Stocks / ETF" },
  { value: SYSTEM_ROLES.REAL_ESTATE, label: "Real estate" },
  { value: SYSTEM_ROLES.RETIREMENT, label: "Retirement / Pension" },
  { value: SYSTEM_ROLES.ALTERNATIVE, label: "Gold / Crypto / Commodities" },
  { value: SYSTEM_ROLES.OTHER, label: "Other" },
];

export const SYSTEM_ROLE_LABELS: Record<string, string> = Object.fromEntries(
  SYSTEM_ROLE_CHOICES.map((choice) => [choice.value, choice.label]),
);

export function isSystemRole(value: string | null | undefined): value is SystemRole {
  return !!value && value in SYSTEM_ROLE_LABELS;
}
