/**
 * Settings tests.
 *
 * The parse/serialize rules are pinned by the expectations below, which cover
 * every casing and digit shape the settings screens can produce.
 */

import { describe, expect, it } from "vitest";
import { ratePairs } from "../db/seed";
import {
  DEFAULT_SETTINGS,
  exportSettingsJson,
  mergeSettings,
  parseSettingValue,
  parseSettingsImport,
  serializeSettingValue,
  settingValue,
  validateSetting,
} from "./settings";

describe("DEFAULT_SETTINGS", () => {
  it("has exactly the shipped keys", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      base_currency: "EUR",
      show_converted_amounts: true,
      items_per_page: "20",
      date_format: "%Y-%m-%d",
      llm_timeout: "120",
      theme: "light",
      enable_animations: true,
      // The AI opt-in and the streaming preference.
      ai_enabled: false,
      chat_streaming: true,
    });
  });
});

describe("parseSettingValue", () => {
  it("parses booleans in any casing", () => {
    expect(parseSettingValue("true")).toBe(true);
    expect(parseSettingValue("false")).toBe(false);
    // The value is lowercased first, so any casing parses.
    expect(parseSettingValue("True")).toBe(true);
    expect(parseSettingValue("TRUE")).toBe(true);
    expect(parseSettingValue("False")).toBe(false);
  });

  it("parses all-digit strings as integers", () => {
    expect(parseSettingValue("20")).toBe(20);
    expect(parseSettingValue("120")).toBe(120);
    expect(parseSettingValue("0")).toBe(0);
  });

  it("parses floats when they are not all digits", () => {
    expect(parseSettingValue("1.5")).toBe(1.5);
    expect(parseSettingValue("-3")).toBe(-3);
  });

  it("leaves everything else as a string", () => {
    expect(parseSettingValue("EUR")).toBe("EUR");
    expect(parseSettingValue("%Y-%m-%d")).toBe("%Y-%m-%d");
    expect(parseSettingValue("")).toBe("");
  });
});

describe("serializeSettingValue", () => {
  it("lowercases booleans", () => {
    expect(serializeSettingValue(true)).toBe("true");
    expect(serializeSettingValue(false)).toBe("false");
  });

  it("stringifies everything else unchanged", () => {
    expect(serializeSettingValue(20)).toBe("20");
    expect(serializeSettingValue("EUR")).toBe("EUR");
  });

  it("round-trips through parse", () => {
    for (const value of [true, false, 20, "EUR", "%Y-%m-%d"]) {
      expect(parseSettingValue(serializeSettingValue(value))).toBe(value);
    }
  });
});

describe("mergeSettings", () => {
  it("lets stored rows override the defaults", () => {
    const merged = mergeSettings([
      { key: "base_currency", value: "CHF" },
      { key: "items_per_page", value: "50" },
    ]);
    expect(merged.base_currency).toBe("CHF");
    expect(merged.items_per_page).toBe(50);
    // Untouched keys keep their default.
    expect(merged.date_format).toBe("%Y-%m-%d");
  });

  it("returns pure defaults for no rows", () => {
    expect(mergeSettings([])).toEqual(DEFAULT_SETTINGS);
  });
});

describe("settingValue", () => {
  it("falls back to the default when a key is missing", () => {
    expect(settingValue({}, "base_currency")).toBe("EUR");
    expect(settingValue({ base_currency: "USD" }, "base_currency")).toBe("USD");
  });
});

describe("ratePairs", () => {
  it("seeds six directional pairs from three one-way rates", () => {
    // DEFAULT_RATES + inverse pairs, with four-decimal rounding
    expect(ratePairs()).toEqual([
      ["EUR", "USD", "1.1"],
      ["USD", "EUR", "0.9091"],
      ["EUR", "CHF", "0.95"],
      ["CHF", "EUR", "1.0526"],
      ["USD", "CHF", "0.86"],
      ["CHF", "USD", "1.1628"],
    ]);
  });
});

describe("settings screen helpers", () => {
  it("only accepts the offered choices", () => {
    expect(validateSetting("base_currency", "CHF")).toBe(true);
    expect(validateSetting("base_currency", "GBP")).toBe(false);
    expect(validateSetting("items_per_page", 50)).toBe(true);
    expect(validateSetting("items_per_page", 25)).toBe(false);
    expect(validateSetting("theme", "auto")).toBe(true);
    expect(validateSetting("theme", "blue")).toBe(false);
    expect(validateSetting("unknown_key", "x")).toBe(false);
    expect(validateSetting("date_format", "%d.%m.%Y")).toBe(true);
  });

  it("exports indented JSON of the merged settings", () => {
    const json = exportSettingsJson({ base_currency: "CHF", show_converted_amounts: true });
    expect(json).toBe('{\n  "base_currency": "CHF",\n  "show_converted_amounts": true\n}');
  });

  it("imports only known keys and reports the rest", () => {
    const result = parseSettingsImport(JSON.stringify({ base_currency: "USD", theme: "dark", auto_backup: "false", items_per_page: 10 }));
    expect(result.error).toBeNull();
    expect(result.values).toEqual({ base_currency: "USD", theme: "dark", items_per_page: 10 });
    expect(result.ignored).toEqual(["auto_backup"]);
  });

  it("rejects non-JSON and non-objects with a readable message", () => {
    expect(parseSettingsImport("nope").error).toBe("That is not valid JSON.");
    expect(parseSettingsImport("[1,2]").error).toBe("Expected a JSON object of setting names to values.");
  });
});
