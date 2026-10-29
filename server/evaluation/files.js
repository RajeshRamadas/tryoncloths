import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(value).digest('hex');

export async function readJson(file) {
  const bytes = await readFile(file);
  if (bytes.length > 1024 * 1024) throw new Error('Manifest or report exceeds 1 MB.');
  return JSON.parse(bytes.toString('utf8'));
}

export async function newReportDirectory(directory) {
  // Never overwrite a previous run, customer data, or a partially reviewed run.
  await mkdir(directory, { mode: 0o700 });
}

export async function privateJson(file, data) {
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}

export function options(args, allowed, switches = []) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw new Error('Unknown or repeated command option.');
    if (switches.includes(key)) result[key] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing command option value.');
      result[key] = args[++i];
    }
  }
  return result;
}
