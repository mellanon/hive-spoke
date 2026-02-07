import { Command } from "commander";
import { join } from "path";
import { readdirSync, existsSync, readFileSync } from "fs";
import { $ } from "bun";
import { withErrorHandling } from "../utils/errors";
import { loadYaml } from "../utils/yaml";
import { ManifestSchema, type Manifest } from "../schemas/manifest";
import { formatJson, success, warning, fail, header, result } from "../utils/output";

interface VerifyResult {
  project: string;
  repo: string;
  handle: string;
  fingerprint: string | null;
  inAllowedSigners: boolean;
  keyMatch: boolean;
  issues: string[];
}

interface ProjectYaml {
  name: string;
  source?: {
    repo: string;
    branch?: string;
  };
}

interface VerifyOptions {
  allowedSigners?: string;
  json?: boolean;
}

async function fetchFileFromRepo(
  repo: string,
  path: string,
  branch: string = "main"
): Promise<string | null> {
  try {
    const result =
      await $`gh api repos/${repo}/contents/${path}?ref=${branch} --jq .content`
        .quiet()
        .text();
    const base64 = result.trim();
    if (!base64) return null;
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function parseAllowedSigners(
  filePath: string
): Map<string, { email: string; keyType: string; publicKey: string }> {
  const signers = new Map<
    string,
    { email: string; keyType: string; publicKey: string }
  >();

  if (!existsSync(filePath)) return signers;

  const content = readFileSync(filePath, "utf-8");

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length >= 3) {
      const [email, keyType, publicKey] = parts;
      const fullKey = `${keyType} ${publicKey}`;
      signers.set(email, { email, keyType, publicKey: fullKey });
    }
  }

  return signers;
}

export function registerVerifyCommand(
  parent: Command,
  getJsonMode: () => boolean
): void {
  parent
    .command("verify")
    .description(
      "Cross-reference spoke signing keys against hub allowed-signers"
    )
    .option(
      "--allowed-signers <path>",
      "Path to allowed-signers file",
      ".hive/allowed-signers"
    )
    .action(
      withErrorHandling(async (opts: VerifyOptions) => {
        const json = getJsonMode();
        const cwd = process.cwd();
        const projectsDir = join(cwd, "projects");
        const signersPath = join(
          cwd,
          opts.allowedSigners ?? ".hive/allowed-signers"
        );

        if (!existsSync(projectsDir)) {
          throw new Error(
            "No projects/ directory found. Run this from the hub repo root."
          );
        }

        if (!existsSync(signersPath)) {
          throw new Error(
            `allowed-signers file not found at ${signersPath}. Use --allowed-signers to specify path.`
          );
        }

        header("Verifying spoke identity claims...\n");

        const allowedSigners = parseAllowedSigners(signersPath);
        success(
          `Loaded ${allowedSigners.size} signer(s) from ${opts.allowedSigners ?? ".hive/allowed-signers"}`
        );
        console.log("");

        const projects = readdirSync(projectsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort();

        const results: VerifyResult[] = [];

        for (const project of projects) {
          const projectYamlPath = join(
            projectsDir,
            project,
            "PROJECT.yaml"
          );
          if (!existsSync(projectYamlPath)) continue;

          const projectYaml = loadYaml<ProjectYaml>(projectYamlPath);
          if (!projectYaml.source?.repo) continue;

          const repo = projectYaml.source.repo;
          const branch = projectYaml.source.branch ?? "main";

          const manifestContent = await fetchFileFromRepo(
            repo,
            ".collab/manifest.yaml",
            branch
          );
          if (!manifestContent) continue;

          let manifest: Manifest;
          try {
            const { load } = await import("js-yaml");
            const raw = load(manifestContent);
            manifest = ManifestSchema.parse(raw);
          } catch {
            results.push({
              project,
              repo,
              handle: "unknown",
              fingerprint: null,
              inAllowedSigners: false,
              keyMatch: false,
              issues: ["Invalid manifest.yaml"],
            });
            continue;
          }

          const issues: string[] = [];
          const spokeKey = manifest.identity.publicKey;
          const spokeFingerprint = manifest.identity.fingerprint ?? null;

          let inAllowedSigners = false;
          let keyMatch = false;

          for (const [_email, signer] of allowedSigners) {
            const spokeKeyParts = spokeKey.split(/\s+/);
            const signerKeyParts = signer.publicKey.split(/\s+/);
            if (
              spokeKeyParts.length >= 2 &&
              signerKeyParts.length >= 2 &&
              spokeKeyParts[0] === signerKeyParts[0] &&
              spokeKeyParts[1] === signerKeyParts[1]
            ) {
              inAllowedSigners = true;
              keyMatch = true;
              break;
            }
          }

          if (!inAllowedSigners) {
            issues.push(
              "Public key NOT in allowed-signers — operator not registered on hub"
            );
          }

          if (!spokeFingerprint) {
            issues.push(
              "No fingerprint in manifest — cannot verify key binding"
            );
          }

          const verifyResult: VerifyResult = {
            project,
            repo,
            handle: manifest.identity.handle,
            fingerprint: spokeFingerprint,
            inAllowedSigners,
            keyMatch,
            issues,
          };

          results.push(verifyResult);

          if (!json) {
            const icon = issues.length === 0 ? "\u2713" : "\u2717";
            console.log(
              `  ${icon} ${project} | @${manifest.identity.handle} | ${repo} | ${spokeFingerprint ?? "no fingerprint"}`
            );
            if (inAllowedSigners) {
              success("  Key found in allowed-signers");
            } else {
              fail("  Key NOT in allowed-signers");
            }
            for (const issue of issues) {
              console.log(`    ! ${issue}`);
            }
          }
        }

        if (json) {
          const verified = results.filter(
            (r) => r.issues.length === 0
          ).length;
          console.log(
            formatJson({
              total: results.length,
              verified,
              unverified: results.length - verified,
              results,
            })
          );
          return;
        }

        const verified = results.filter(
          (r) => r.issues.length === 0
        ).length;
        const unverified = results.length - verified;

        console.log(
          `\n  ${results.length} spoke(s) checked, ${verified} verified, ${unverified} with issues`
        );

        if (unverified > 0) {
          warning(
            "Unverified spokes should add their key to .hive/allowed-signers via signed PR"
          );
        }

        result(
          unverified === 0,
          unverified === 0
            ? "All spoke identities verified"
            : `${unverified} spoke(s) need identity verification`
        );
      }, getJsonMode)
    );
}
