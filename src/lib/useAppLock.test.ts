// @vitest-environment jsdom
/**
 * The lock's state machine, without the screen.
 *
 * The two timers are the feature: a lock that only appears at launch is a
 * different (and much weaker) feature than one that comes back when the user walks
 * away, and neither is covered by the gate's rendering tests.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  lockStatus: vi.fn(),
  verifyLockPin: vi.fn(),
  setLockPin: vi.fn(),
  clearLockPin: vi.fn(),
}));
vi.mock("./appLockApi", () => ({
  lockStatus: () => api.lockStatus(),
  verifyLockPin: (...args: unknown[]) => api.verifyLockPin(...args),
  setLockPin: (...args: unknown[]) => api.setLockPin(...args),
  clearLockPin: (...args: unknown[]) => api.clearLockPin(...args),
}));

import { useAppLock } from "./useAppLock";
import { clearPinProof, markPinProved } from "./appLock";

const SAMPLE_PIN = "1234";

/** Let the pending promises settle without any timer. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  api.lockStatus.mockResolvedValue(true);
  api.verifyLockPin.mockResolvedValue({
    unlocked: true,
    retryAfterSeconds: 0,
    blocked: false,
  });
  clearPinProof();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useAppLock", () => {
  it("starts locked when a PIN is stored", async () => {
    const { result } = renderHook(() => useAppLock({ enabled: true, idleMinutes: 1 }));
    await settle();

    expect(result.current.phase).toBe("locked");
    expect(result.current.pinSet).toBe(true);
  });

  it("stays out of the way when the lock is off", async () => {
    const { result } = renderHook(() => useAppLock({ enabled: false, idleMinutes: 1 }));
    await settle();

    expect(result.current.phase).toBe("unlocked");
    expect(api.lockStatus).not.toHaveBeenCalled();
  });

  it("unlocks on the right PIN and reports the wrong one", async () => {
    const { result } = renderHook(() => useAppLock({ enabled: true, idleMinutes: 1 }));
    await settle();

    api.verifyLockPin.mockResolvedValueOnce({
      unlocked: false,
      retryAfterSeconds: 0,
      blocked: false,
    });
    await act(async () => {
      expect(await result.current.unlock("9999")).toBe(false);
    });
    expect(result.current.error).toBe("That PIN is not right.");
    expect(result.current.phase).toBe("locked");

    await act(async () => {
      expect(await result.current.unlock(SAMPLE_PIN)).toBe(true);
    });
    expect(result.current.phase).toBe("unlocked");
  });

  it("does not claim the PIN was wrong when the wait refused the attempt", async () => {
    const { result } = renderHook(() => useAppLock({ enabled: true, idleMinutes: 1 }));
    await settle();

    api.verifyLockPin.mockResolvedValueOnce({
      unlocked: false,
      retryAfterSeconds: 32,
      blocked: true,
    });
    await act(async () => {
      await result.current.unlock(SAMPLE_PIN);
    });

    expect(result.current.error).toBe("Too many attempts. Wait before trying again.");
    expect(result.current.retryAfterSeconds).toBe(32);
  });

  it("locks again after the idle delay", async () => {
    const { result } = renderHook(() => useAppLock({ enabled: true, idleMinutes: 1 }));
    await settle();
    await act(async () => {
      await result.current.unlock(SAMPLE_PIN);
    });
    expect(result.current.phase).toBe("unlocked");

    // Any input re-arms the timer.
    act(() => {
      window.dispatchEvent(new Event("keydown"));
      vi.advanceTimersByTime(59_000);
    });
    expect(result.current.phase).toBe("unlocked");

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.phase).toBe("locked");
  });

  it("locks after the window has been unfocused that long", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderHook(() => useAppLock({ enabled: true, idleMinutes: 1 }));
    await settle();
    await act(async () => {
      await result.current.unlock(SAMPLE_PIN);
    });

    // Output does not stop the clock: nothing is being typed, and the window is
    // not focused.
    hasFocus.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(61_000);
    });

    expect(result.current.phase).toBe("locked");
    hasFocus.mockRestore();
  });

  it("never auto-locks when the delay is zero", async () => {
    const { result } = renderHook(() => useAppLock({ enabled: true, idleMinutes: 0 }));
    await settle();
    await act(async () => {
      await result.current.unlock(SAMPLE_PIN);
    });

    act(() => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });

    expect(result.current.phase).toBe("unlocked");
  });

  it("locks on request, from the settings page or the shortcut", async () => {
    const { result } = renderHook(() => useAppLock({ enabled: true, idleMinutes: 1 }));
    await settle();
    await act(async () => {
      await result.current.unlock(SAMPLE_PIN);
    });

    act(() => {
      result.current.lock();
    });

    expect(result.current.phase).toBe("locked");
  });

  it("lets a PIN proved a moment ago turn the lock on without asking again", async () => {
    // The Settings flow: the PIN was just typed twice, then `lock_enabled` flipped
    // on. The Keychain has it, and the gate must not bounce the user back.
    markPinProved();

    const { result } = renderHook(() => useAppLock({ enabled: true, idleMinutes: 5 }));
    await settle();

    expect(result.current.phase).toBe("unlocked");
  });

  it("does not honour a proof that is older than a minute", async () => {
    markPinProved();
    vi.advanceTimersByTime(61_000);

    const { result } = renderHook(() => useAppLock({ enabled: true, idleMinutes: 5 }));
    await settle();

    expect(result.current.phase).toBe("locked");
  });
});
