import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tasks = process.argv.slice(2);
if (
  !tasks.length ||
  tasks.some(
    (task) =>
      ![
        "assembleDebug",
        "lintDebug",
        "bundleRelease",
        "assembleRelease",
      ].includes(task),
  )
) {
  console.error(
    "Specify assembleDebug, lintDebug, bundleRelease, or assembleRelease.",
  );
  process.exit(1);
}
const windows = process.platform === "win32";
const child = spawn(
  windows ? "gradlew.bat" : "./gradlew",
  [...tasks, "--no-daemon", "--max-workers=2", "--console=plain"],
  { cwd: path.join(root, "android"), stdio: "inherit", shell: windows },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
