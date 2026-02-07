import { expect, test, describe } from "bun:test";
import { ManifestSchema } from "../src/schemas/manifest";
import { StatusSchema } from "../src/schemas/status";
import { OperatorSchema } from "../src/schemas/operator";

describe("ManifestSchema", () => {
  const validManifest = {
    schemaVersion: "1.0",
    name: "the-hive",
    hub: "mellanon/pai-collab",
    project: "the-hive",
    maintainer: "mellanon",
    license: "CC-BY-4.0",
    identity: {
      handle: "mellanon",
      publicKey:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO6xYoY3NSCNkCSiS4GU+EhZPQFh098vsiUh6KggOg1a",
      fingerprint: "SHA256:+sgg04W+IN7//6af+CaRDn5PIG6p3adMkbMHa5zWTGk",
    },
    security: {
      reflexes: {
        signing: true,
        secretScanning: true,
        sandboxEnforcer: true,
        contentFilter: true,
      },
    },
    status: {
      test: "bun test",
      healthCheck: "bun run validate",
    },
  };

  test("accepts valid manifest", () => {
    expect(() => ManifestSchema.parse(validManifest)).not.toThrow();
  });

  test("accepts minimal manifest (no optional fields)", () => {
    const minimal = {
      schemaVersion: "1.0",
      name: "test-project",
      hub: "org/repo",
      project: "test",
      maintainer: "testuser",
      license: "MIT",
      identity: {
        handle: "testuser",
        publicKey: "ssh-ed25519 AAAA_test_key",
      },
    };
    expect(() => ManifestSchema.parse(minimal)).not.toThrow();
  });

  test("accepts AGPL-3.0 license", () => {
    const agpl = { ...validManifest, license: "AGPL-3.0" };
    expect(() => ManifestSchema.parse(agpl)).not.toThrow();
  });

  test("rejects missing hub", () => {
    const { hub, ...noHub } = validManifest;
    expect(() => ManifestSchema.parse(noHub)).toThrow();
  });

  test("rejects invalid hub format", () => {
    const bad = { ...validManifest, hub: "not-a-valid-hub" };
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  test("rejects invalid license", () => {
    const bad = { ...validManifest, license: "GPL-3.0" };
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  test("rejects non-Ed25519 key", () => {
    const bad = {
      ...validManifest,
      identity: { ...validManifest.identity, publicKey: "ssh-rsa AAAA..." },
    };
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });
});

describe("StatusSchema", () => {
  const validStatus = {
    schemaVersion: "1.0",
    generatedAt: "2026-02-07T00:00:00Z",
    generatedBy: "hive-spoke 0.1.0",
    phase: "build",
    tests: { passing: 10, failing: 0 },
    git: {
      branch: "main",
      lastCommit: "2026-02-07T00:00:00Z",
      dirty: false,
      behindRemote: 0,
    },
  };

  test("accepts valid status", () => {
    expect(() => StatusSchema.parse(validStatus)).not.toThrow();
  });

  test("rejects invalid phase", () => {
    const bad = { ...validStatus, phase: "invalid-phase" };
    expect(() => StatusSchema.parse(bad)).toThrow();
  });

  test("rejects negative test count", () => {
    const bad = { ...validStatus, tests: { passing: -1, failing: 0 } };
    expect(() => StatusSchema.parse(bad)).toThrow();
  });

  test("rejects invalid date", () => {
    const bad = { ...validStatus, generatedAt: "not-a-date" };
    expect(() => StatusSchema.parse(bad)).toThrow();
  });

  test("accepts all lifecycle phases", () => {
    const phases = [
      "specify",
      "build",
      "harden",
      "contrib-prep",
      "review",
      "shipped",
      "evolving",
    ];
    for (const phase of phases) {
      expect(() =>
        StatusSchema.parse({ ...validStatus, phase })
      ).not.toThrow();
    }
  });
});

describe("OperatorSchema", () => {
  const validOperator = {
    schemaVersion: "1.0",
    handle: "mellanon",
    name: "Andreas",
    signing: {
      publicKey:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO6xYoY3NSCNkCSiS4GU+EhZPQFh098vsiUh6KggOg1a",
      fingerprint: "SHA256:+sgg04W+IN7//6af+CaRDn5PIG6p3adMkbMHa5zWTGk",
    },
    identities: [
      {
        provider: "github",
        id: "mellanon",
        verified: true,
        verified_at: "2026-02-07T00:00:00Z",
      },
    ],
    skills: ["protocol-design", "specflow"],
    availability: "open",
    hives: [
      {
        hive: "mellanon/pai-collab",
        role: "maintainer",
        trust_zone: "maintainer",
        identity_provider: "github",
        joined: "2025-01-01T00:00:00Z",
        contributions: 96,
        reviews: 5,
        swarms: 0,
      },
    ],
  };

  test("accepts valid operator with Tier 1 + Tier 2", () => {
    expect(() => OperatorSchema.parse(validOperator)).not.toThrow();
  });

  test("accepts minimal operator (Tier 1 only)", () => {
    const minimal = {
      schemaVersion: "1.0",
      handle: "testuser",
      signing: {
        publicKey: "ssh-ed25519 AAAA_test_key",
      },
    };
    expect(() => OperatorSchema.parse(minimal)).not.toThrow();
  });

  test("rejects missing handle", () => {
    const { handle, ...noHandle } = validOperator;
    expect(() => OperatorSchema.parse(noHandle)).toThrow();
  });

  test("rejects invalid availability", () => {
    const bad = { ...validOperator, availability: "unknown" };
    expect(() => OperatorSchema.parse(bad)).toThrow();
  });

  test("rejects invalid hive role", () => {
    const bad = {
      ...validOperator,
      hives: [{ ...validOperator.hives[0], role: "admin" }],
    };
    expect(() => OperatorSchema.parse(bad)).toThrow();
  });
});
