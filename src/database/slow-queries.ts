import type { mongo } from "mongoose";
import type { Logger } from "pino";

const commands = new Set([
  "find",
  "aggregate",
  "count",
  "distinct",
  "insert",
  "update",
  "delete",
  "findAndModify",
  "commitTransaction",
  "abortTransaction",
]);

/** Never log commandStarted, command documents, replies, failure messages, or namespaces. */
export function monitorSlowQueries(
  client: mongo.MongoClient,
  logger: Logger,
  thresholdMs: number,
): () => void {
  function record(event: mongo.CommandSucceededEvent | mongo.CommandFailedEvent, failed: boolean) {
    if (event.duration < thresholdMs || !commands.has(event.commandName)) return;
    logger.warn(
      { operation: event.commandName, durationMs: event.duration, failed },
      "Slow database operation",
    );
  }
  const succeeded = (event: mongo.CommandSucceededEvent) => record(event, false);
  const failed = (event: mongo.CommandFailedEvent) => record(event, true);
  client.on("commandSucceeded", succeeded);
  client.on("commandFailed", failed);
  return () => {
    client.off("commandSucceeded", succeeded);
    client.off("commandFailed", failed);
  };
}
