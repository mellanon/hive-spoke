import { Command } from "commander";
import { join } from "path";
import { existsSync } from "fs";
import { withErrorHandling } from "../utils/errors";
import { writeYaml } from "../utils/yaml";
import { isGitRepo, getGitUserName, getGitUserEmail, getGitHubHandle, getSigningConfig } from "../utils/git";
import { success, warning, header } from "../utils/output";
import { ACCEPTED_LICENSES } from "../schemas/manifest";
import { version } from "../version";

interface InitOptions {
  hub: string;
  project?: string;
  name?: string;
  overwrite?: boolean;
  json?: boolean;
}

export function registerInitCommand(
  parent: Command,
  getJsonMode: () => boolean
): void {
  parent
    .command("init")
    .description("Scaffold .collab/ directory with spoke contract files")
    .requiredOption("--hub <org/repo>", "Target hive (e.g., mellanon/pai-collab)")
    .option("--project <id>", "Project identifier (default: repo directory name)")
    .option("--name <name>", "Operator display name (default: git config user.name)")
    .option("--overwrite", "Overwrite existing .collab/ files", false)
    .action(
      withErrorHandling(async (opts: InitOptions) => {
        const cwd = process.cwd();
        const collabDir = join(cwd, ".collab");

        // Validate: must be a git repo
        if (!(await isGitRepo(cwd))) {
          throw new Error("Not a git repository. Run 'git init' first.");
        }

        // Validate: hub format
        if (!/^[\w-]+\/[\w.-]+$/.test(opts.hub)) {
          throw new Error(
            `Invalid hub format: "${opts.hub}". Must be org/repo (e.g., mellanon/pai-collab).`
          );
        }

        // Check existing
        if (existsSync(collabDir) && !opts.overwrite) {
          throw new Error(
            ".collab/ already exists. Use --overwrite to replace."
          );
        }

        // Gather defaults from git config, GitHub CLI, and SSH key
        const repoName =
          opts.project ?? cwd.split("/").pop() ?? "unknown";
        const gitName = (await getGitUserName(cwd)) ?? "operator";
        const gitEmail = (await getGitUserEmail(cwd)) ?? "";
        const displayName = opts.name ?? gitName;
        const signing = await getSigningConfig(cwd);

        // Derive handle: GitHub login > git name > email prefix
        const ghHandle = await getGitHubHandle();
        const maintainerHandle = ghHandle ?? gitName ?? gitEmail.split("@")[0] ?? "operator";

        header("Initializing spoke contract...");

        if (ghHandle) {
          success(`Detected GitHub handle: ${ghHandle}`);
        } else {
          warning(
            `Could not detect GitHub handle (gh CLI not installed or not authenticated). Using "${maintainerHandle}" from git config.`
          );
        }

        // manifest.yaml
        const manifest: Record<string, unknown> = {
          schemaVersion: "1.0",
          name: repoName,
          hub: opts.hub,
          project: repoName,
          maintainer: maintainerHandle,
          license: "MIT",
          identity: {
            handle: maintainerHandle,
            publicKey: signing.publicKey ?? "ssh-ed25519 <your-public-key-here>",
            ...(signing.fingerprint
              ? { fingerprint: signing.fingerprint }
              : {}),
          },
          security: {
            reflexes: {
              signing: signing.gpgSign,
              secretScanning: false,
              sandboxEnforcer: false,
              contentFilter: false,
            },
          },
          status: {
            test: "bun test",
          },
        };

        writeYaml(
          join(collabDir, "manifest.yaml"),
          manifest,
          "# Spoke manifest — identity, security reflexes, hub projection\n# See: spoke-protocol.md"
        );
        success("Created .collab/manifest.yaml");

        // status.yaml
        const status = {
          schemaVersion: "1.0",
          generatedAt: new Date().toISOString(),
          generatedBy: `hive-spoke ${version}`,
          phase: "specify",
          tests: { passing: 0, failing: 0 },
          git: {
            branch: "main",
            lastCommit: new Date().toISOString(),
            dirty: false,
            behindRemote: 0,
          },
        };

        writeYaml(
          join(collabDir, "status.yaml"),
          status,
          "# Spoke status snapshot — auto-generated, do not edit manually\n# Regenerate with: hive-spoke status"
        );
        success("Created .collab/status.yaml");

        // operator.yaml (Tier 1 + Tier 2)
        const operator: Record<string, unknown> = {
          schemaVersion: "1.0",
          handle: maintainerHandle,
          name: displayName,
          signing: {
            publicKey: signing.publicKey ?? "ssh-ed25519 <your-public-key-here>",
            ...(signing.fingerprint
              ? { fingerprint: signing.fingerprint }
              : {}),
          },
          identities: ghHandle
            ? [
                {
                  provider: "github",
                  id: ghHandle,
                  verified: true,
                  verified_at: new Date().toISOString(),
                },
              ]
            : [],
          skills: [],
          availability: "open",
          hives: [
            {
              hive: opts.hub,
              role: "contributor",
              trust_zone: "untrusted",
              identity_provider: "github",
              joined: new Date().toISOString(),
              contributions: 0,
              reviews: 0,
              swarms: 0,
            },
          ],
        };

        writeYaml(
          join(collabDir, "operator.yaml"),
          operator,
          "# Operator profile — Tier 1 (public) + Tier 2 (hive-scoped)\n# Tier 3 (private) stays in local blackboard only\n# See: operator-identity.md"
        );
        success("Created .collab/operator.yaml");

        if (!signing.publicKey) {
          warning(
            "No SSH signing key detected. Update identity.publicKey in manifest.yaml and operator.yaml."
          );
          warning(
            "Set up signing: git config --global gpg.format ssh && git config --global user.signingKey ~/.ssh/id_ed25519.pub && git config --global commit.gpgSign true"
          );
        }

        console.log(
          `\nSpoke initialized for ${opts.hub}. Review .collab/ files, then run: hive-spoke validate`
        );
      }, getJsonMode)
    );
}
