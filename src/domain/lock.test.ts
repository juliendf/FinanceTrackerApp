import { describe, expect, it } from "vitest";
import {
  PIN_LENGTH,
  acceptPinInput,
  confirmPin,
  idleDelayMs,
  isIdle,
  retryMessage,
  validateNewPin,
} from "./lock";

describe("validateNewPin", () => {
  it("accepts exactly four digits", () => {
    for (const pin of ["0000", "1234", "9999"]) {
      expect(validateNewPin(pin)).toBeNull();
    }
  });

  it("refuses anything that is not four digits", () => {
    for (const refused of ["", "123", "12345", "12a4", "abcd", " 123", "12 4", "-123", "12.4", "١٢٣٤"]) {
      expect(validateNewPin(refused), refused).toContain(`${PIN_LENGTH} digits`);
    }
  });
});

describe("confirmPin", () => {
  it("wants the same PIN twice", () => {
    expect(confirmPin("1234", "1235")).toContain("do not match");
    expect(confirmPin("1234", "1234")).toBeNull();
  });

  it("still applies the length rule when the two match", () => {
    expect(confirmPin("123", "123")).toContain(`${PIN_LENGTH} digits`);
  });
});

describe("acceptPinInput", () => {
  it("drops everything that is not a digit", () => {
    expect(acceptPinInput("12a4")).toBe("124");
    expect(acceptPinInput("12 34")).toBe("1234");
    expect(acceptPinInput("-1-2")).toBe("12");
  });

  it("stops at the PIN length", () => {
    expect(acceptPinInput("123456")).toBe("1234");
    expect(acceptPinInput("1234")).toBe("1234");
  });
});

describe("idleDelayMs", () => {
  it("turns minutes into milliseconds", () => {
    expect(idleDelayMs(1)).toBe(60_000);
    expect(idleDelayMs(5)).toBe(300_000);
  });

  it("treats zero, negative and nonsense as never", () => {
    for (const never of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(idleDelayMs(never)).toBe(0);
    }
  });
});

describe("isIdle", () => {
  const now = 1_000_000_000;

  it("is false before the delay has elapsed", () => {
    expect(isIdle(now, now - 59_000, 1)).toBe(false);
    expect(isIdle(now, now - 299_000, 5)).toBe(false);
  });

  it("is true at the delay and after it", () => {
    expect(isIdle(now, now - 60_000, 1)).toBe(true);
    expect(isIdle(now, now - 900_000, 5)).toBe(true);
  });

  it("never fires when auto-lock is off", () => {
    expect(isIdle(now, 0, 0)).toBe(false);
  });
});

describe("retryMessage", () => {
  it("says nothing when there is no wait", () => {
    expect(retryMessage(0)).toBe("");
    expect(retryMessage(-3)).toBe("");
  });

  it("reads naturally for one second and for more", () => {
    expect(retryMessage(1)).toBe("Try again in 1 second.");
    expect(retryMessage(32)).toBe("Try again in 32 seconds.");
  });
});
