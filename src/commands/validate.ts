import { Command } from "commander";
import { join } from "path";
import { ZodError } from "zod";
import { withErrorHandling } from "../utils/errors";
import { loadYaml, yamlExists } from "../utils/yaml";
import { getSigningConfig } from "../utils/git";
import { ManifestSchema, type Manifest } from "../schemas/manifest";
import { StatusSchema, type SpokeStatus } from "../schemas/status";
import { OperatorSchema, type Operator } from "../schemas/operator";
import { success, warning, fail, header, result } from "../utils/output";

interface ValidateOptions {
  strict?: boolean;
  json?: boolean;
}

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

function validateManifest(
  collabDir: string,
  results: ValidationResult
): Manifest | null {
  const path = join(collabDir, "manifest.yaml");
  header(".collab/manifest.yaml");

  if (!yamlExists(path)) {
    results.errors.push("manifest.yaml not found");
    fail("File not found");
    return null;
  }

  try {
    const raw = loadYaml(path);
    const manifest = ManifestSchema.parse(raw);
    success("Schema valid");
    success(`Name: ${manifest.name}`);
    success(`Hub: ${manifest.hub}`);
    success(`License: ${manifest.license}`);
    success(`Identity: ${manifest.identity.handle}`);

    if (manifest.identity.publicKey.includes("<your-public-key-here>")) {
      results.warnings.push("manifest.yaml: publicKey is still a placeholder");
      warning("publicKey is a placeholder — update with your Ed25519 key");
    }

    return manifest;
  } catch (err) {
    if (err instanceof ZodError) {
      for (const issue of err.issues) {
        const path = issue.path.join(".");
        const msg = `manifest.yaml: ${path} — ${issue.message}`;
        results.errors.push(msg);
        fail(msg);
      }
    } else {
      const msg = `manifest.yaml: ${err instanceof Error ? err.message : String(err)}`;
      results.errors.push(msg);
      fail(msg);
    }
    return null;
  }
}

function validateStatus(
  collabDir: string,
  results: ValidationResult
): SpokeStatus | null {
  const path = join(collabDir, "status.yaml");
  header(".collab/status.yaml");

  if (!yamlExists(path)) {
    results.warnings.push("status.yaml not found — run 'hive-spoke status' to generate");
    warning("File not found — run 'hive-spoke status' to generate");
    return null;
  }

  try {
    const raw = loadYaml(path);
    const status = StatusSchema.parse(raw);
    success("Schema valid");
    success(`Phase: ${status.phase}`);
    success(`Tests: ${status.tests.passing} passing, ${status.tests.failing} failing`);
    success(`Git: ${status.git.branch}, dirty=${status.git.dirty}`);

    // Check freshness
    const generatedDate = new Date(status.generatedAt);
    const daysSince = (Date.now() - generatedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 7) {
      results.warnings.push(
        `status.yaml: generated ${Math.floor(daysSince)} days ago — consider regenerating`
      );
      warning(
        `Generated ${Math.floor(daysSince)} days ago — run 'hive-spoke status' to refresh`
      );
    }

    return status;
  } catch (err) {
    if (err instanceof ZodError) {
      for (const issue of err.issues) {
        const path = issue.path.join(".");
        const msg = `status.yaml: ${path} — ${issue.message}`;
        results.errors.push(msg);
        fail(msg);
      }
    } else {
      const msg = `status.yaml: ${err instanceof Error ? err.message : String(err)}`;
      results.errors.push(msg);
      fail(msg);
    }
    return null;
  }
}

function validateOperator(
  collabDir: string,
  results: ValidationResult
): Operator | null {
  const path = join(collabDir, "operator.yaml");
  header(".collab/operator.yaml");

  if (!yamlExists(path)) {
    results.warnings.push("operator.yaml not found");
    warning("File not found — optional but recommended");
    return null;
  }

  try {
    const raw = loadYaml(path);
    const operator = OperatorSchema.parse(raw);
    success("Schema valid (Tier 1 + Tier 2)");
    success(`Handle: ${operator.handle}`);
    success(`Skills: ${operator.skills.length > 0 ? operator.skills.join(", ") : "none declared"}`);
    success(`Hives: ${operator.hives.length}`);
    return operator;
  } catch (err) {
    if (err instanceof ZodError) {
      for (const issue of err.issues) {
        const path = issue.path.join(".");
        const msg = `operator.yaml: ${path} — ${issue.message}`;
        results.errors.push(msg);
        fail(msg);
      }
    } else {
      const msg = `operator.yaml: ${err instanceof Error ? err.message : String(err)}`;
      results.errors.push(msg);
      fail(msg);
    }
    return null;
  }
}

async function validateSigning(
  manifest: Manifest | null,
  results: ValidationResult
): Promise<void> {
  header("Signing (Layer 1: Provable)");

  const signing = await getSigningConfig();

  if (signing.format === "ssh") {
    success("gpg.format = ssh");
  } else {
    results.warnings.push("gpg.format is not 'ssh' — commit signing may not work");
    warning(`gpg.format = ${signing.format ?? "not set"}`);
  }

  if (signing.gpgSign) {
    success("commit.gpgSign = true");
  } else {
    results.warnings.push("commit.gpgSign is not true — commits won't be signed automatically");
    warning("commit.gpgSign is not true");
  }

  if (signing.signingKey) {
    success(`Signing key configured: ${signing.signingKey}`);
  } else {
    results.warnings.push("No signing key configured");
    warning("No signing key configured");
  }

  if (signing.fingerprint) {
    success(`Fingerprint: ${signing.fingerprint}`);

    // Cross-check with manifest
    if (manifest?.identity.fingerprint) {
      if (signing.fingerprint === manifest.identity.fingerprint) {
        success("Fingerprint matches manifest.yaml");
      } else {
        results.warnings.push(
          "Signing key fingerprint does not match manifest.yaml identity.fingerprint"
        );
        warning(
          `Mismatch: git key ${signing.fingerprint} vs manifest ${manifest.identity.fingerprint}`
        );
      }
    }
  }
}

function validateCrossFile(
  manifest: Manifest | null,
  operator: Operator | null,
  results: ValidationResult
): void {
  header("Cross-file consistency");

  if (!manifest) {
    warning("Skipped — manifest.yaml not available");
    return;
  }

  if (operator) {
    if (manifest.identity.handle === operator.handle) {
      success(
        `Handle matches: manifest.identity.handle = operator.handle = "${operator.handle}"`
      );
    } else {
      results.errors.push(
        `Handle mismatch: manifest "${manifest.identity.handle}" vs operator "${operator.handle}"`
      );
      fail(
        `Handle mismatch: manifest "${manifest.identity.handle}" vs operator "${operator.handle}"`
      );
    }

    if (manifest.identity.publicKey === operator.signing.publicKey) {
      success("Public key matches between manifest and operator");
    } else {
      results.errors.push("Public key mismatch between manifest.yaml and operator.yaml");
      fail("Public key mismatch between manifest.yaml and operator.yaml");
    }
  }
}

export function registerValidateCommand(
  parent: Command,
  getJsonMode: () => boolean
): void {
  parent
    .command("validate")
    .description("Validate .collab/ files against spoke protocol schemas")
    .option("--strict", "Fail on warnings", false)
    .action(
      withErrorHandling(async (opts: ValidateOptions) => {
        const cwd = process.cwd();
        const collabDir = join(cwd, ".collab");

        console.log("Spoke compliance validation\n");

        const results: ValidationResult = { errors: [], warnings: [] };

        // Layer 4: Structural — schema validation
        const manifest = validateManifest(collabDir, results);
        const status = validateStatus(collabDir, results);
        const operator = validateOperator(collabDir, results);

        // Layer 1: Provable — signing config
        await validateSigning(manifest, results);

        // Layer 3: Attested — reflex claims (just report what manifest claims)
        if (manifest) {
          header("Security reflexes (Layer 3: Attested)");
          const reflexes = manifest.security?.reflexes ?? {};
          const reflexList: [string, boolean][] = [
            ["signing", reflexes.signing ?? false],
            ["secretScanning", reflexes.secretScanning ?? false],
            ["sandboxEnforcer", reflexes.sandboxEnforcer ?? false],
            ["contentFilter", reflexes.contentFilter ?? false],
          ];

          for (const [name, active] of reflexList) {
            if (active) {
              success(`${name}: claimed active`);
            } else {
              warning(`${name}: not active`);
            }
          }
        }

        // Cross-file consistency
        validateCrossFile(manifest, operator, results);

        // Summary
        const hasErrors = results.errors.length > 0;
        const hasWarnings = results.warnings.length > 0;
        const strictFail = opts.strict && hasWarnings;

        if (hasErrors) {
          result(false, `Spoke validation FAILED — ${results.errors.length} error(s)`);
          process.exitCode = 1;
        } else if (strictFail) {
          result(false, `Spoke validation FAILED (strict) — ${results.warnings.length} warning(s)`);
          process.exitCode = 2;
        } else {
          result(
            true,
            hasWarnings
              ? `Spoke is compliant with ${results.warnings.length} warning(s)`
              : "Spoke is compliant and ready to project to hub"
          );
        }
      }, getJsonMode)
    );
}
