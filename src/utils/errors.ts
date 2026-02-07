import { formatJson } from "./output";

export class SpokeError extends Error {
  constructor(
    message: string,
    public readonly code: string = "SPOKE_ERROR"
  ) {
    super(message);
    this.name = "SpokeError";
  }
}

export function withErrorHandling(
  handler: (...args: unknown[]) => Promise<void>,
  jsonMode: () => boolean
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    try {
      await handler(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (jsonMode()) {
        console.log(formatJson({ error: message }, false));
      } else {
        console.error(`Error: ${message}`);
      }
      process.exitCode = 1;
    }
  };
}
