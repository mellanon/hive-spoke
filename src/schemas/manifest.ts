import { z } from "zod";

export const ACCEPTED_LICENSES = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "AGPL-3.0",
] as const;

export const ManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  name: z.string().min(1, "Project name is required"),
  hub: z
    .string()
    .regex(/^[\w-]+\/[\w.-]+$/, "Hub must be in org/repo format"),
  project: z.string().min(1, "Project identifier is required"),
  maintainer: z
    .string()
    .regex(/^[a-zA-Z0-9-]+$/, "Maintainer must be a valid GitHub handle"),
  license: z.enum(ACCEPTED_LICENSES, {
    errorMap: () => ({
      message: `License must be one of: ${ACCEPTED_LICENSES.join(", ")}`,
    }),
  }),

  identity: z.object({
    handle: z.string().min(1, "Identity handle is required"),
    publicKey: z
      .string()
      .startsWith("ssh-ed25519 ", "Public key must be an Ed25519 SSH key"),
    fingerprint: z
      .string()
      .regex(/^SHA256:[A-Za-z0-9+/=]+$/, "Fingerprint must be SHA256 format")
      .optional(),
  }),

  security: z
    .object({
      reflexes: z
        .object({
          signing: z.boolean().optional().default(false),
          secretScanning: z.boolean().optional().default(false),
          sandboxEnforcer: z.boolean().optional().default(false),
          contentFilter: z.boolean().optional().default(false),
        })
        .optional()
        .default({}),
    })
    .optional()
    .default({}),

  status: z
    .object({
      test: z.string().min(1).optional(),
      healthCheck: z.string().min(1).optional(),
    })
    .optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
