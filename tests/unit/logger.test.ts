import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "../../services/logger";

describe("Logger Service", () => {
  let consoleLogSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.setLevel("info");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should log info messages when level is info", () => {
    logger.info("TestModule", "Hello Info");
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("[INFO] [TestModule] Hello Info"),
      expect.anything(),
    );
  });

  it("should not log info messages when level is warn", () => {
    logger.setLevel("warn");
    logger.info("TestModule", "Should not see this");
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("should log warn messages when level is warn", () => {
    logger.setLevel("warn");
    logger.warn("TestModule", "Hello Warn");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[WARN] [TestModule] Hello Warn"),
      expect.anything(),
    );
  });

  it("should log error messages even when level is error", () => {
    logger.setLevel("error");
    logger.error("TestModule", "Hello Error");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[ERROR] [TestModule] Hello Error"),
      expect.anything(),
    );
  });
});
