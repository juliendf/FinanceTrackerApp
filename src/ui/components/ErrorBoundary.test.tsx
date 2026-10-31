// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

afterEach(cleanup);

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error("Objects are not valid as a React child");
  return <p>fine</p>;
}

describe("ErrorBoundary", () => {
  it("shows the message instead of a minified stack", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByText("This page hit an error")).toBeTruthy();
    expect(screen.getByText(/Objects are not valid/)).toBeTruthy();
    spy.mockRestore();
  });

  it("recovers when the child stops throwing", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let explode = true;
    function Toggler() {
      return explode ? <Boom explode /> : <Boom explode={false} />;
    }
    render(
      <ErrorBoundary>
        <Toggler />
      </ErrorBoundary>,
    );
    explode = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("fine")).toBeTruthy();
    spy.mockRestore();
  });

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeTruthy();
  });
});
