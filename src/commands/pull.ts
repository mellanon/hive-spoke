import { Command } from "commander";
import { join } from "path";
import { readdirSync, existsSync } from "fs";
import { $ } from "bun";
import { withErrorHandling } from "../utils/errors";
import { loadYaml } from "../utils/yaml";
import { ManifestSchema, type Manifest } from "../schemas/manifest";
import { StatusSchema, type SpokeStatus } from "../schemas/status";
import { formatJson, success, warning, fail, header, result } from "../utils/output";

interface SpokeEntry {
  project: string;
  repo: string;
  maintainer: string;
  phase: string;
  tests: { passing: number; failing: number };
  dirty: boolean;
  behindRemote: number;
  lastCommit: string;
  generatedAt: string;
  license: string;
  reflexes: {
    signing: boolean;
    secretScanning: boolean;
    sandboxEnforcer: boolean;
    contentFilter: boolean;
  };
  stale: boolean;
}

interface ProjectYaml {
  name: string;
  maintainer: string;
  status: string;
  source?: {
    repo: string;
    branch?: string;
  };
}

interface PullOptions {
  json?: boolean;
}

function isStale(generatedAt: string, thresholdDays: number = 7): boolean {
  const generated = new Date(generatedAt);
  const now = new Date();
  const diffMs = now.getTime() - generated.getTime();
  return diffMs > thresholdDays * 24 * 60 * 60 * 1000;
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

export function registerPullCommand(
  parent: Command,
  getJsonMode: () => boolean
): void {
  parent
    .command("pull")
    .description(
      "Fetch spoke statuses from spoke repos (reads .collab/ via GitHub API)"
    )
    .action(
      withErrorHandling(async (_opts: PullOptions) => {
        const json = getJsonMode();
        const cwd = process.cwd();
        const projectsDir = join(cwd, "projects");

        if (!existsSync(projectsDir)) {
          throw new Error(
            "No projects/ directory found. Run this from the hub repo root."
          );
        }

        header("Fetching spoke statuses from repos...\n");

        const projects = readdirSync(projectsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort();

        const spokes: SpokeEntry[] = [];
        let fetched = 0;
        let noRepo = 0;
        let noCollab = 0;

        for (const project of projects) {
          const projectYamlPath = join(
            projectsDir,
            project,
            "PROJECT.yaml"
          );

          if (!existsSync(projectYamlPath)) {
            if (!json) console.log(`  - ${project} (no PROJECT.yaml)`);
            noRepo++;
            continue;
          }

          const projectYaml = loadYaml<ProjectYaml>(projectYamlPath);

          if (!projectYaml.source?.repo) {
            if (!json) console.log(`  - ${project} (no source repo)`);
            noRepo++;
            continue;
          }

          const repo = projectYaml.source.repo;
          const branch = projectYaml.source.branch ?? "main";

          // Fetch manifest.yaml from spoke repo
          const manifestContent = await fetchFileFromRepo(
            repo,
            ".collab/manifest.yaml",
            branch
          );

          if (!manifestContent) {
            if (!json) console.log(`  - ${project} (no .collab/ in ${repo})`);
            noCollab++;
            continue;
          }

          // Fetch status.yaml from spoke repo
          const statusContent = await fetchFileFromRepo(
            repo,
            ".collab/status.yaml",
            branch
          );

          try {
            const { load } = await import("js-yaml");
            const rawManifest = load(manifestContent);
            const manifest = ManifestSchema.parse(rawManifest);

            let status: SpokeStatus | null = null;
            if (statusContent) {
              const rawStatus = load(statusContent);
              status = StatusSchema.parse(rawStatus);
            }

            const stale = status ? isStale(status.generatedAt) : true;

            const entry: SpokeEntry = {
              project: manifest.project,
              repo,
              maintainer: manifest.maintainer,
              phase: status?.phase ?? "unknown",
              tests: status?.tests ?? { passing: 0, failing: 0 },
              dirty: status?.git?.dirty ?? false,
              behindRemote: status?.git?.behindRemote ?? 0,
              lastCommit: status?.git?.lastCommit ?? "unknown",
              generatedAt: status?.generatedAt ?? "never",
              license: manifest.license,
              reflexes: {
                signing: manifest.security?.reflexes?.signing ?? false,
                secretScanning:
                  manifest.security?.reflexes?.secretScanning ?? false,
                sandboxEnforcer:
                  manifest.security?.reflexes?.sandboxEnforcer ?? false,
                contentFilter:
                  manifest.security?.reflexes?.contentFilter ?? false,
              },
              stale,
            };

            spokes.push(entry);
            fetched++;

            if (!json) {
              const staleTag = stale ? " [STALE]" : "";
              const testStr = status
                ? `${status.tests.passing}P/${status.tests.failing}F`
                : "—";
              const dirtyTag = entry.dirty ? " [dirty]" : "";
              const behindTag =
                entry.behindRemote > 0
                  ? ` [${entry.behindRemote} behind]`
                  : "";

              console.log(
                `  ${manifest.project} | ${entry.phase} | ${testStr} | @${manifest.maintainer} | ${repo}${dirtyTag}${behindTag}${staleTag}`
              );
            }
          } catch (err) {
            if (!json) {
              fail(
                `${project}: invalid .collab/ in ${repo} — ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
        }

        if (json) {
          console.log(
            formatJson({ spokes, fetched, noRepo, noCollab })
          );
        } else {
          console.log(
            `\n  ${fetched} spoke(s) fetched, ${noCollab} repo(s) without .collab/, ${noRepo} project(s) without source repo`
          );

          const staleCount = spokes.filter((s) => s.stale).length;
          if (staleCount > 0) {
            warning(
              `${staleCount} spoke(s) have stale status (>7 days old)`
            );
          }

          const failingCount = spokes.filter(
            (s) => s.tests.failing > 0
          ).length;
          if (failingCount > 0) {
            warning(`${failingCount} spoke(s) have failing tests`);
          }

          result(true, "Spoke status fetch complete");
        }
      }, getJsonMode)
    );
}
