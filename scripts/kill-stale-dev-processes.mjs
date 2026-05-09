import { execFileSync } from "node:child_process";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ownPid = process.pid;

function listProcesses() {
  const output = execFileSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
  });

  return output
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3],
      };
    })
    .filter(Boolean);
}

function isStaleDevProcess(proc) {
  if (proc.pid === ownPid) return false;
  if (!proc.command.includes(repoRoot)) return false;

  return (
    proc.command.includes("/node_modules/.bin/electron-vite") ||
    proc.command.includes("/node_modules/electron/dist/Electron.app/")
  );
}

function signal(pid, value) {
  try {
    process.kill(pid, value);
    return true;
  } catch {
    return false;
  }
}

const targets = listProcesses().filter(isStaleDevProcess);

if (targets.length > 0) {
  for (const target of targets) {
    signal(target.pid, "SIGTERM");
  }

  await new Promise((resolveWait) => setTimeout(resolveWait, 1000));

  for (const target of targets) {
    if (signal(target.pid, 0)) {
      signal(target.pid, "SIGKILL");
    }
  }

  console.log(
    `[dev] Stopped stale 1Code dev process${targets.length === 1 ? "" : "es"}: ${targets
      .map((target) => target.pid)
      .join(", ")}`,
  );
}
