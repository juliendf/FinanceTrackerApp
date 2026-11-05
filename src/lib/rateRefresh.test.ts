import { describe, expect, it } from "vitest";
import { shouldAutoFetchRates } from "./rateRefresh";

describe("shouldAutoFetchRates", () => {
  it("does nothing while the source is off", () => {
    expect(shouldAutoFetchRates({ enabled: false, fetchedOn: "", today: "2026-11-05" })).toBe(false);
    // Even with a stale date: the toggle is the gate, not the clock.
    expect(shouldAutoFetchRates({ enabled: false, fetchedOn: "2026-01-01", today: "2026-11-05" })).toBe(false);
  });

  it("fetches once a day when the source is on", () => {
    expect(shouldAutoFetchRates({ enabled: true, fetchedOn: "", today: "2026-11-05" })).toBe(true);
    expect(shouldAutoFetchRates({ enabled: true, fetchedOn: "2026-11-04", today: "2026-11-05" })).toBe(true);
  });

  it("stays quiet once today has been attempted", () => {
    // Keyed on the attempt, so a morning launch that received yesterday's file
    // does not fetch again on the next launch.
    expect(shouldAutoFetchRates({ enabled: true, fetchedOn: "2026-11-05", today: "2026-11-05" })).toBe(false);
  });
});
