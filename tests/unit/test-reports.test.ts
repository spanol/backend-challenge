import { expect, test } from 'bun:test';
import { combineJUnitReports } from '../../scripts/test-reports';

test('isolated suite reports retain failures, skipped tests and exact assertion totals', () => {
  const merged = combineJUnitReports([
    '<?xml version="1.0"?><testsuites tests="2" assertions="7" failures="1" skipped="0" time="1.25"><testsuite name="integration"><failure>original failure</failure></testsuite></testsuites>',
    '<testsuites tests="3" assertions="9" failures="0" skipped="1" time="2.5"><testsuite name="concurrency" /></testsuites>',
  ]);

  expect(merged).toContain('tests="5" assertions="16" failures="1" skipped="1" time="3.75"');
  expect(merged).toContain('<failure>original failure</failure>');
  expect(merged).toContain('<testsuite name="concurrency" />');
});

test.each([
  'not XML',
  '<testsuites tests="2" assertions="1" failures="0" skipped="0" time="1">',
  '<testsuites tests="2.5" assertions="1" failures="0" skipped="0" time="1"></testsuites>',
  '<testsuites tests="2" assertions="1" failures="0" skipped="0"></testsuites>',
])('invalid suite reports fail aggregation rather than report a successful gate: %s', (report) => {
  expect(() => combineJUnitReports([report])).toThrow('Invalid JUnit');
});
