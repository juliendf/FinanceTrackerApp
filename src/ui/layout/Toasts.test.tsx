// @vitest-environment jsdom
/**
 * A toast stack is a queue of *distinct* messages. The same sentence arriving
 * twice is one notice, not two — pressing a button that changes nothing used to
 * build a wall of identical alerts.
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "./Toasts";

afterEach(cleanup);

function Harness({ messages }: { messages: Array<{ type: "success" | "info"; text: string }> }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => messages.forEach((m) => toast[m.type](m.text))}>
      fire
    </button>
  );
}

describe("Toasts", () => {
  it("keeps one notice per distinct message", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness messages={[{ type: "success", text: "Nothing to update." }]} />
      </ToastProvider>,
    );
    const fire = screen.getByRole("button", { name: "fire" });
    await user.click(fire);
    await user.click(fire);
    await user.click(fire);
    expect(screen.getAllByText("Nothing to update.")).toHaveLength(1);
  });

  it("still shows two different messages", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness
          messages={[
            { type: "success", text: "Nothing to update." },
            { type: "info", text: "Rates as of 2026-11-04." },
          ]}
        />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "fire" }));
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });
});
