/** Reject invalid tuning rather than silently starting unbounded workers. */
export function workerSetting(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid worker setting: ${name}`);
  return value;
}
