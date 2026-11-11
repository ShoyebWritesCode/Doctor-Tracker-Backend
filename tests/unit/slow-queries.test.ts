import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/config/logger.js";
import { monitorSlowQueries } from "../../src/database/slow-queries.js";

describe("privacy-safe slow-query monitoring", () => {
  it("records only operation, duration and outcome; detaches listeners cleanly", () => {
    const client = new mongoose.mongo.MongoClient("mongodb://127.0.0.1:27017");
    let output = "";
    const logger = createLogger(
      { nodeEnv: "production", level: "info" },
      {
        write: (line) => {
          output += line;
        },
      },
    );
    const stop = monitorSlowQueries(client, logger, 250);
    const secret = "FictionalPrivatePayload";
    const event = {
      address: secret,
      databaseName: secret,
      connectionId: 1,
      serverConnectionId: null,
      requestId: 1,
      duration: 300,
      commandName: "find",
      reply: { name: secret },
      failure: new Error(secret),
      hasServiceId: false,
    };
    client.emit("commandSucceeded", { ...event, duration: 100 });
    client.emit("commandSucceeded", { ...event, commandName: "saslStart" });
    expect(output).toBe("");
    client.emit("commandSucceeded", event);
    client.emit("commandFailed", { ...event, commandName: "aggregate", duration: 450 });
    expect(output).not.toContain(secret);
    const entries = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ operation: "find", durationMs: 300, failed: false });
    expect(entries[1]).toMatchObject({ operation: "aggregate", durationMs: 450, failed: true });
    stop();
    expect(client.listenerCount("commandSucceeded")).toBe(0);
    expect(client.listenerCount("commandFailed")).toBe(0);
  });
});
