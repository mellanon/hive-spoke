import { z } from "zod";

const IdentityEntrySchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
  verified: z.boolean(),
  verified_at: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), "Must be valid ISO 8601")
    .optional(),
});

const HiveEntrySchema = z.object({
  hive: z
    .string()
    .regex(/^[\w-]+\/[\w.-]+$/, "Hive must be in org/repo format"),
  role: z.enum(["contributor", "reviewer", "maintainer"]).optional(),
  trust_zone: z.enum(["untrusted", "trusted", "maintainer"]).optional(),
  identity_provider: z.string().optional(),
  joined: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), "Must be valid ISO 8601")
    .optional(),
  contributions: z.number().int().nonnegative().optional(),
  reviews: z.number().int().nonnegative().optional(),
  swarms: z.number().int().nonnegative().optional(),
});

// Tier 1: Public Identity (visible to all hives)
const OperatorTier1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  handle: z.string().min(1, "Handle is required"),
  name: z.string().optional(),

  signing: z.object({
    publicKey: z
      .string()
      .startsWith("ssh-ed25519 ", "Must be an Ed25519 SSH key"),
    fingerprint: z
      .string()
      .regex(/^SHA256:[A-Za-z0-9+/=]+$/, "Must be SHA256 format")
      .optional(),
  }),

  identities: z.array(IdentityEntrySchema).optional().default([]),
  skills: z.array(z.string()).optional().default([]),
  availability: z.enum(["open", "busy", "offline"]).optional().default("open"),
});

// Tier 2: Hive-Scoped (visible within joined hives)
const OperatorTier2Schema = z.object({
  hives: z.array(HiveEntrySchema).optional().default([]),
});

export const OperatorSchema = OperatorTier1Schema.merge(OperatorTier2Schema);

export type Operator = z.infer<typeof OperatorSchema>;
