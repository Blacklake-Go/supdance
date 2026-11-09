import { z } from "zod";

export class Failure extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryable = false) {
    super(code);
  }
}

export function asFailure(error: unknown) {
  if (error instanceof Failure) return error;
  if (error instanceof z.ZodError) return new Failure(400, "invalid_input");
  if (error instanceof DOMException && error.name === "AbortError") return new Failure(409, "cancelled");
  console.error("supdance_internal_error", error instanceof Error ? error.name : "unknown");
  return new Failure(500, "internal_error");
}
