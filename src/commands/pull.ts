import { Command } from "commander";
import { join } from "path";
import { readdirSync, existsSync } from "fs";
import { withErrorHandling } from "../utils/errors";
import { loadYaml } from "../utils/yaml";
import { ManifestSchema, type Manifest } from "../schemas/manifest";
import { StatusSchema, type SpokeStatus } from "../schemas/status";
import { formatJson, success, warning, fail, header, result } from "../utils/output";

interface SpokeEntry {
  project: string;
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

interface PullOptions {
  json?: boolean;
}

function isStale(generatedAt: string, thresholdDays: number = 7): boolean {
  const generated = new Date(generatedAt);
  const now = new Date();
  const diffMs = now.getTime() - generated.getTime();
  return diffMs > thresholdDays * 24 * 60 * 60 * 1000;
}

export function registerPullCommand(
  parent: Command,
  getJsonMode: () => boolean
): void {
  parent
    .command("pull")
    .description("Aggregate spoke statuses from hub projects/ directory")
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

        header("Aggregating spoke statuses...\n");

        const projects = readdirSync(projectsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort();

        const spokes: SpokeEntry[] = [];
        let withCollab = 0;
        let withoutCollab = 0;

        for (const project of projects) {
          const collabDir = join(projectsDir, project, ".collab");
          const manifestPath = join(collabDir, "manifest.yaml");
          const statusPath = join(collabDir, "status.yaml");

          if (!existsSync(collabDir) || !existsSync(manifestPath)) {
            withoutCollab++;
            if (!json) {
              console.log(`  - ${project} (no .collab/)`);
            }
            continue;
          }

          withCollab++;

          try {
            const rawManifest = loadYaml(manifestPath);
            const manifest = ManifestSchema.parse(rawManifest);

            let status: SpokeStatus | null = null;
            if (existsSync(statusPath)) {
              const rawStatus = loadYaml(statusPath);
              status = StatusSchema.parse(rawStatus);
            }

            const stale = status
              ? isStale(status.generatedAt)
              : true;

            const entry: SpokeEntry = {
              project: manifest.project,
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

            if (!json) {
              const staleTag = stale ? " [STALE]" : "";
              const testStr =
                status
                  ? `${status.tests.passing}P/${status.tests.failing}F`
                  : "—";
              const dirtyTag = entry.dirty ? " [dirty]" : "";
              const behindTag =
                entry.behindRemote > 0
                  ? ` [${entry.behindRemote} behind]`
                  : "";

              console.log(
                `  ${manifest.project} | ${entry.phase} | ${testStr} | @${manifest.maintainer}${dirtyTag}${behindTag}${staleTag}`
              );
            }
          } catch (err) {
            if (!json) {
              fail(
                `${project}: invalid .collab/ data — ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
        }

        if (json) {
          console.log(formatJson({ spokes, withCollab, withoutCollab }));
        } else {
          console.log(
            `\n  ${withCollab} spoke(s) reporting, ${withoutCollab} project(s) without .collab/`
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

          result(true, "Hub status aggregation complete");
        }
      }, getJsonMode)
    );
}
