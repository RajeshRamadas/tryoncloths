import { readFile } from "node:fs/promises";

export function parseWorkerMemory(value) {
  if (!value) return null;
  const { currentBytes, peakBytes, limitBytes } = value;
  if (
    ![currentBytes, peakBytes, limitBytes].every(Number.isSafeInteger) ||
    currentBytes < 0 ||
    peakBytes < currentBytes ||
    limitBytes <= 0
  )
    return null;
  return { currentBytes, peakBytes, limitBytes };
}

export async function readWorkerMemory({
  expectedLimit = Number(process.env.TRYON_READER_MEMORY_LIMIT_BYTES),
  read = readFile,
} = {}) {
  if (!Number.isSafeInteger(expectedLimit) || expectedLimit <= 0) return null;
  const counter = async (name) => {
    const value = (await read(`/sys/fs/cgroup/memory.${name}`, "utf8")).trim();
    return /^\d+$/.test(value) ? Number(value) : NaN;
  };
  try {
    // A private cgroup v2 namespace places this limited container at the mount root.
    // Never report host-wide memory from a non-private or unlimited cgroup.
    if ((await read("/proc/self/cgroup", "utf8")).trim() !== "0::/") return null;
    const limitBytes = await counter("max");
    // Some rootless runtimes expose an outer cgroup even in a private namespace.
    if (limitBytes !== expectedLimit) return null;
    const currentBytes = await counter("current");
    const peakBytes = await counter("peak");
    return parseWorkerMemory({ currentBytes, peakBytes, limitBytes });
  } catch {
    return null;
  }
}
