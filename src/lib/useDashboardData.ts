/** Loads what every dashboard needs and builds the converter once per data change. */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAssetCurrencies, listFacts } from "../db/repositories/dashboard";
import { listExchangeRates } from "../db/repositories/exchangeRates";
import { CurrencyConverter, RateTable, type ConversionWarning } from "../domain/currency";
import { todayIso } from "../domain/dates";
import type { Fact } from "../domain/dashboard";
import { useSettings } from "./useSettings";

export interface DashboardData {
  facts: Fact[];
  assetCurrencies: string[];
  baseCurrency: string;
  today: string;
  /** A fresh converter; its `warnings` fill as results are computed from it. */
  makeConverter: () => CurrencyConverter;
  isLoading: boolean;
  error: unknown;
}

export function useDashboardData(): DashboardData {
  const { baseCurrency, isLoading: settingsLoading } = useSettings();
  const facts = useQuery({ queryKey: ["dashboard-facts"], queryFn: listFacts });
  const currencies = useQuery({ queryKey: ["asset-currencies"], queryFn: listAssetCurrencies });
  const rates = useQuery({ queryKey: ["exchange-rates"], queryFn: listExchangeRates });

  const table = useMemo(() => new RateTable(rates.data ?? []), [rates.data]);
  const today = todayIso();

  return {
    facts: facts.data ?? [],
    assetCurrencies: currencies.data ?? [],
    baseCurrency,
    today,
    makeConverter: () => new CurrencyConverter(table, baseCurrency),
    isLoading: settingsLoading || facts.isLoading || currencies.isLoading || rates.isLoading,
    error: facts.error ?? currencies.error ?? rates.error,
  };
}

export function describeUnconverted(warnings: readonly ConversionWarning[]): string {
  return warnings.map((w) => `${w.from} to ${w.to}`).join(", ");
}
