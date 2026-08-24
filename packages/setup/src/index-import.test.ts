import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commandCalls = vi.hoisted(() => ({
  dispatch: vi.fn(),
  parse: vi.fn(),
}));

vi.mock("commander", () => ({
  Command: class {
    name() {
      return this;
    }

    version() {
      return this;
    }

    description() {
      return this;
    }

    option() {
      return this;
    }

    action() {
      return this;
    }

    parse() {
      commandCalls.parse();
      commandCalls.dispatch();
      return this;
    }
  },
}));

const originalArgv = [...process.argv];

describe("setup CLI entrypoint", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.argv.splice(0, process.argv.length, ...originalArgv);
  });

  afterEach(() => {
    process.argv.splice(0, process.argv.length, ...originalArgv);
    vi.restoreAllMocks();
  });

  it("does not parse, dispatch commands, or terminate the process when imported", async () => {
    process.argv[1] = fileURLToPath(import.meta.url);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    await import("./index.js");

    expect(commandCalls.parse).not.toHaveBeenCalled();
    expect(commandCalls.dispatch).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("parses and dispatches commands when executed directly", async () => {
    process.argv[1] = fileURLToPath(new URL("./index.ts", import.meta.url));

    await import("./index.js");

    expect(commandCalls.parse).toHaveBeenCalledOnce();
    expect(commandCalls.dispatch).toHaveBeenCalledOnce();
  });
});
