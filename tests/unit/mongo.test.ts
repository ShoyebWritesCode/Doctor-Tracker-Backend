import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectMongo } from "../../src/database/mongo.js";
import { createTestLogger } from "../helpers/logger.js";

const mongoState = vi.hoisted(() => ({ readyState: 0 }));

vi.mock("mongoose", () => ({
  default: {
    STATES: { connected: 1, disconnected: 0 },
    connection: mongoState,
    set: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  mongoState.readyState = 0;
});

describe("serverless MongoDB pool", () => {
  const options = { uri: "mongodb://fictional.test/doctor_tracker", logger: createTestLogger() };

  it("shares one in-flight connection and reuses a warm connection", async () => {
    let finish: (value: typeof mongoose) => void = () => {};
    vi.mocked(mongoose.connect).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = connectMongo(options);
    const second = connectMongo(options);
    expect(mongoose.connect).toHaveBeenCalledTimes(1);
    finish(mongoose);
    await Promise.all([first, second]);
    mongoState.readyState = 1;
    await connectMongo(options);
    expect(mongoose.connect).toHaveBeenCalledTimes(1);
    expect(mongoose.connect).toHaveBeenCalledWith(
      options.uri,
      expect.objectContaining({ maxPoolSize: 5, minPoolSize: 0, serverSelectionTimeoutMS: 10_000 }),
    );
  });

  it("retries after a failed cold start instead of caching a rejected promise", async () => {
    vi.mocked(mongoose.connect).mockRejectedValueOnce(new Error("Fictional outage"));
    await expect(connectMongo(options)).rejects.toThrow("Fictional outage");
    vi.mocked(mongoose.connect).mockResolvedValueOnce(mongoose);
    await expect(connectMongo(options)).resolves.toBeUndefined();
    expect(mongoose.connect).toHaveBeenCalledTimes(2);
  });
});
