export function combineJUnitReports(reports: readonly string[]): string {
  const totals = { tests: 0, assertions: 0, failures: 0, skipped: 0, time: 0 };
  const attributes = ['tests', 'assertions', 'failures', 'skipped', 'time'] as const;
  const suites: string[] = [];

  for (const report of reports) {
    const match = /^\s*(?:<\?xml[^>]*>\s*)?<testsuites\b([^>]*)>([\s\S]*)<\/testsuites>\s*$/.exec(
      report,
    );

    if (!match) throw new Error('Invalid JUnit report');

    for (const attribute of attributes) {
      const value = new RegExp(`\\b${attribute}="([0-9]+(?:\\.[0-9]+)?)"`).exec(match[1]!);
      const count = Number(value?.[1]);

      if (!value || !Number.isFinite(count) || (attribute !== 'time' && !Number.isInteger(count)))
        throw new Error(`Invalid JUnit ${attribute}`);

      totals[attribute] += count;
    }

    suites.push(match[2]!);
  }

  const summary = attributes.map((attribute) => `${attribute}="${totals[attribute]}"`).join(' ');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="isolated suites" ${summary}>${suites.join('\n')}</testsuites>\n`;
}
