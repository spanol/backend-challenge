import { expect, test } from 'bun:test';
import { DecimalStringType } from '../../src/infrastructure/persistence/decimal-string';

test('ORM type compares high precision decimals exactly and rejects monetary numbers', () => {
  const type = new DecimalStringType();

  expect(type.compareValues('900719925474099.01', '900719925474099.02')).toBe(false);
  expect(type.convertToJSValue('900719925474099.01')).toBe('900719925474099.01');
  expect(() => type.convertToJSValue(1 as unknown as string)).toThrow('INVALID_PERSISTED_DECIMAL');
});
