import { $ } from "bun";

export interface GitState {
  branch: string;
  lastCommit: string;
  dirty: boolean;
  behindRemote: number;
}

export async function isGitRepo(cwd?: string): Promise<boolean> {
  try {
    const result = await $`git rev-parse --is-inside-work-tree`
      .cwd(cwd ?? process.cwd())
      .quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function getGitState(cwd?: string): Promise<GitState> {
  const dir = cwd ?? process.cwd();

  const branchResult = await $`git rev-parse --abbrev-ref HEAD`.cwd(dir).text();
  const branch = branchResult.trim();

  const lastCommitResult =
    await $`git log -1 --format=%aI`.cwd(dir).text();
  const lastCommit = lastCommitResult.trim();

  const dirtyResult = await $`git status --porcelain`.cwd(dir).text();
  const dirty = dirtyResult.trim().length > 0;

  let behindRemote = 0;
  try {
    const remote = await $`git rev-parse --abbrev-ref @{upstream}`.cwd(dir).quiet().text();
    if (remote.trim()) {
      await $`git fetch --quiet`.cwd(dir).quiet();
      const behind =
        await $`git rev-list --count HEAD..@{upstream}`.cwd(dir).quiet().text();
      behindRemote = parseInt(behind.trim(), 10) || 0;
    }
  } catch {
    // No upstream configured — behindRemote stays 0
  }

  return { branch, lastCommit, dirty, behindRemote };
}

export async function getGitUserName(cwd?: string): Promise<string | null> {
  try {
    const result = await $`git config user.name`.cwd(cwd ?? process.cwd()).text();
    return result.trim() || null;
  } catch {
    return null;
  }
}

export async function getGitUserEmail(cwd?: string): Promise<string | null> {
  try {
    const result = await $`git config user.email`.cwd(cwd ?? process.cwd()).text();
    return result.trim() || null;
  } catch {
    return null;
  }
}

export interface SigningConfig {
  format: string | null;
  signingKey: string | null;
  gpgSign: boolean;
  publicKey: string | null;
  fingerprint: string | null;
}

export async function getGitHubHandle(): Promise<string | null> {
  try {
    const result = await $`gh api user --jq .login`.quiet().text();
    return result.trim() || null;
  } catch {
    return null;
  }
}

export async function getSigningConfig(
  cwd?: string
): Promise<SigningConfig> {
  const dir = cwd ?? process.cwd();

  const getConfig = async (key: string): Promise<string | null> => {
    try {
      const result = await $`git config ${key}`.cwd(dir).quiet().text();
      return result.trim() || null;
    } catch {
      return null;
    }
  };

  const format = await getConfig("gpg.format");
  const signingKey = await getConfig("user.signingKey");
  const gpgSign = (await getConfig("commit.gpgSign")) === "true";

  let publicKey: string | null = null;
  let fingerprint: string | null = null;

  if (signingKey) {
    // Resolve the actual key file path
    const keyPath = signingKey.replace("~", process.env.HOME ?? "");
    try {
      const keyContent = await Bun.file(keyPath).text();
      publicKey = keyContent.trim();
    } catch {
      // Key file not readable
    }

    // Get fingerprint
    try {
      const privKeyPath = keyPath.replace(".pub", "");
      const result =
        await $`ssh-keygen -l -f ${privKeyPath}`.quiet().text();
      const match = result.match(/(SHA256:[A-Za-z0-9+/=]+)/);
      if (match) {
        fingerprint = match[1];
      }
    } catch {
      // Can't compute fingerprint
    }
  }

  return { format, signingKey, gpgSign, publicKey, fingerprint };
}
