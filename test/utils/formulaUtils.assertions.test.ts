import { expect } from 'chai';
import {
  valuesMatch,
  evaluateAssertion,
  exitCodeFor,
  summaryPassed,
  evaluateFormulaForRecords,
  extractExpected,
  type FormulaLiteralResult,
  type FormulaErrorResult,
} from '../../src/utils/formulaUtils.js';

describe('valuesMatch', () => {
  it('matches equal numbers', () => {
    expect(valuesMatch(110, 110)).to.be.true;
  });

  it('honours numeric tolerance', () => {
    expect(valuesMatch(110.0001, 110, 0.01)).to.be.true;
    expect(valuesMatch(110.5, 110, 0.01)).to.be.false;
  });

  it('does NOT coerce number vs string (fixes the == foot-gun)', () => {
    expect(valuesMatch(110, '110')).to.be.false;
  });

  it('matches equal strings', () => {
    expect(valuesMatch('Yes', 'Yes')).to.be.true;
    expect(valuesMatch('Yes', 'No')).to.be.false;
  });

  it('compares dates by timestamp', () => {
    expect(valuesMatch(new Date('2024-01-01'), new Date('2024-01-01'))).to.be.true;
  });
});

describe('evaluateAssertion', () => {
  const lit = (value: unknown, dataType = 'number'): FormulaLiteralResult => ({
    type: 'literal',
    value,
    dataType: dataType as FormulaLiteralResult['dataType'],
    options: {},
  });
  const err = (errorType: string): FormulaErrorResult => ({ type: 'error', errorType, message: 'boom' });

  it('passes a matching value assertion', () => {
    const a = evaluateAssertion(lit(110), false, { hasValue: true, value: 110 });
    expect(a.passed).to.be.true;
  });

  it('fails a mismatching value assertion with a reason', () => {
    const a = evaluateAssertion(lit(220), false, { hasValue: true, value: 999 });
    expect(a.passed).to.be.false;
    expect(a.reason).to.include('expected 999');
  });

  it('checks the result dataType when assertDataType is set', () => {
    const a = evaluateAssertion(lit(110, 'number'), false, { assertDataType: 'text' });
    expect(a.passed).to.be.false;
    expect(a.reason).to.include('expected result type');
  });

  it('passes an expected-error assertion with a wildcard', () => {
    const a = evaluateAssertion(err('DivideByZero'), true, { errorType: '*' });
    expect(a.passed).to.be.true;
  });

  it('fails an expected-error assertion when the formula succeeds', () => {
    const a = evaluateAssertion(lit(1), false, { errorType: '*' });
    expect(a.passed).to.be.false;
  });

  it('flags an unexpected error when no error was expected', () => {
    const a = evaluateAssertion(err('X'), true, { hasValue: true, value: 1 });
    expect(a.passed).to.be.false;
    expect(a.reason).to.include('unexpected error');
  });
});

describe('extractExpected', () => {
  it('splits _expected out of the record and reads rich fields', () => {
    const { expected, clean } = extractExpected({
      A__c: { type: 'literal', dataType: 'number', value: 1 },
      // eslint-disable-next-line camelcase
      _expected: { value: 110, tolerance: 0.5, assertDataType: 'number' } as never,
    });
    expect(clean).to.have.property('A__c');
    expect(clean).to.not.have.property('_expected');
    expect(expected?.hasValue).to.be.true;
    expect(expected?.value).to.equal(110);
    expect(expected?.tolerance).to.equal(0.5);
    expect(expected?.assertDataType).to.equal('number');
  });
});

describe('assertions end-to-end + exit codes', () => {
  it('counts assertion failures and passes exitCodeFor', () => {
    const summary = evaluateFormulaForRecords('Amount__c * 1.1', [
      {
        Amount__c: { type: 'literal', dataType: 'number', value: 100, options: { scale: 2 } },
        _expected: { value: 999 } as never,
      },
    ]);
    expect(summary.assertionFailures).to.equal(1);
    expect(summaryPassed(summary)).to.be.false;
    expect(exitCodeFor(summary, false)).to.equal(1);
  });

  it('returns exit 0 for a clean run and 1 under strict with errors', () => {
    const ok = evaluateFormulaForRecords('1 + 1', [{}]);
    expect(exitCodeFor(ok, false)).to.equal(0);
    const bad = evaluateFormulaForRecords('IF(TRUE)', [{}]);
    expect(exitCodeFor(bad, false)).to.equal(0);
    expect(exitCodeFor(bad, true)).to.equal(1);
  });
});
