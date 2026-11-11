/** Settings read through TanStack Query, with the shipped defaults as fallbacks. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllSettings, setSetting } from "../db/repositories/settings";
import { DEFAULT_SETTINGS, type SettingValue } from "../domain/settings";

const KEY = ["settings"] as const;

export function useSettings() {
  const query = useQuery({ queryKey: KEY, queryFn: getAllSettings });

  const settings = { ...DEFAULT_SETTINGS, ...(query.data ?? {}) };

  return {
    settings,
    isLoading: query.isLoading,
    /** Whether any row was ever read: a failed refetch is not a cold start. */
    hasData: query.data !== undefined,
    error: query.error,
    baseCurrency: String(settings.base_currency ?? "EUR"),
    itemsPerPage: Number(settings.items_per_page ?? 20),
    dateFormat: String(settings.date_format ?? "%Y-%m-%d"),
  };
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: SettingValue }) =>
      setSetting(key, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}
