import { Type } from '@mikro-orm/core';
import { InfrastructureErrorCode } from '../constants/errors';

/** MikroORM's default DecimalType compares using floating point. This type never converts money to number. */
export class DecimalStringType extends Type<string, string> {
  private validate(value: string): string {
    if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value))
      throw new Error(InfrastructureErrorCode.INVALID_PERSISTED_DECIMAL);

    return value;
  }

  override convertToDatabaseValue(value: string): string {
    return this.validate(value);
  }

  override convertToJSValue(value: string): string {
    return this.validate(value);
  }

  override getColumnType(): string {
    return 'numeric(20,2)';
  }

  override compareAsType(): string {
    return 'string';
  }

  override compareValues(a: string, b: string): boolean {
    return a === b;
  }
}
