import { z } from "zod";

export const LIFECYCLE_PHASES = [
  "specify",
  "build",
  "harden",
  "contrib-prep",
  "review",
  "shipped",
  "evolving",
] as const;

export const StatusSchema = z.object({
  schemaVersion: z.literal("1.0"),
  generatedAt: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    "generatedAt must be a valid ISO 8601 timestamp"
  ),
  generatedBy: z.string().min(1, "generatedBy is required"),

  phase: z.enum(LIFECYCLE_PHASES, {
    errorMap: () => ({
      message: `Phase must be one of: ${LIFECYCLE_PHASES.join(", ")}`,
    }),
  }),

  tests: z.object({
    passing: z.number().int().nonnegative(),
    failing: z.number().int().nonnegative(),
  }),

  git: z.object({
    branch: z.string().min(1, "Branch name is required"),
    lastCommit: z.string().refine(
      (val) => !isNaN(Date.parse(val)),
      "lastCommit must be a valid date"
    ),
    dirty: z.boolean(),
    behindRemote: z.number().int().nonnegative(),
  }),
});

export type SpokeStatus = z.infer<typeof StatusSchema>;
