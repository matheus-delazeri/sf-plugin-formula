import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import FormulaEvaluate from '../../../src/commands/formula/evaluate.js';
import {
  evaluateFormulaForRecords,
  buildModelJson,
  formatEvaluationSummary,
  summaryToJson,
  type FormulaEvaluationSummary,
  type FormulaLiteralResult,
  type FormulaErrorResult,
} from '../../../src/utils/formulaUtils.js';

function asSummary(result: unknown): FormulaEvaluationSummary {
  return result as FormulaEvaluationSummary;
}

function makeRecords(data: Array<Record<string, unknown>>): string {
  return JSON.stringify(data);
}

describe('FormulaEvaluate command', () => {
  const $$ = new TestContext();

  beforeEach(() => {
    stubSfCommandUx($$.SANDBOX);
  });

  afterEach(() => {
    $$.restore();
  });

  it('evaluates a constant formula with --formula', async () => {
    const summary = asSummary(await FormulaEvaluate.run(['--formula', 'IF(TRUE, "Yes", "No")']));
    expect(summary.successCount).to.equal(1);
    expect(summary.errorCount).to.equal(0);
    expect((summary.results[0].result as FormulaLiteralResult).value).to.equal('Yes');
  });

  it('evaluates a numeric constant formula', async () => {
    const summary = asSummary(await FormulaEvaluate.run(['--formula', '2 + 2']));
    expect(summary.successCount).to.equal(1);
    expect((summary.results[0].result as FormulaLiteralResult).value).to.equal(4);
  });

  it('defaults to a single empty record when --records is omitted', async () => {
    const summary = asSummary(await FormulaEvaluate.run(['--formula', 'TODAY()']));
    expect(summary.successCount).to.equal(1);
    expect(summary.results).to.have.length(1);
  });

  it('evaluates a checkbox formula against multiple records', async () => {
    const records = makeRecords([
      { IsActive__c: { dataType: 'checkbox', value: true } },
      { IsActive__c: { dataType: 'checkbox', value: false } },
    ]);

    const summary = asSummary(
      await FormulaEvaluate.run(['--formula', 'IF(IsActive__c, "Active", "Inactive")', '--records', records])
    );

    expect(summary.successCount).to.equal(2);
    expect(summary.errorCount).to.equal(0);
    expect((summary.results[0].result as FormulaLiteralResult).value).to.equal('Active');
    expect((summary.results[1].result as FormulaLiteralResult).value).to.equal('Inactive');
  });

  it('evaluates a numeric formula against multiple records', async () => {
    const records = makeRecords([
      { Amount__c: { dataType: 'number', value: 1500, options: { length: 6, scale: 2 } } },
      { Amount__c: { dataType: 'number', value: 800, options: { length: 6, scale: 2 } } },
    ]);

    const summary = asSummary(await FormulaEvaluate.run(['--formula', 'Amount__c * 2', '--records', records]));

    expect(summary.successCount).to.equal(2);
    expect((summary.results[0].result as FormulaLiteralResult).value).to.equal(3000);
    expect((summary.results[1].result as FormulaLiteralResult).value).to.equal(1600);
  });

  it('surfaces formula errors per record without throwing', async () => {
    const records = makeRecords([{ Amount__c: { dataType: 'number', value: 100, options: { length: 6, scale: 2 } } }]);

    const summary = asSummary(await FormulaEvaluate.run(['--formula', 'IF(Amount__c)', '--records', records]));

    expect(summary.errorCount).to.equal(1);
    expect(summary.successCount).to.equal(0);
    expect(summary.results[0].isError).to.be.true;
    expect((summary.results[0].result as FormulaErrorResult).type).to.equal('error');
  });

  it('normalises variable descriptors that omit the "type" field', async () => {
    const records = makeRecords([{ IsActive__c: { dataType: 'checkbox', value: true } }]);

    const summary = asSummary(
      await FormulaEvaluate.run(['--formula', 'IF(IsActive__c, "Yes", "No")', '--records', records])
    );

    expect(summary.successCount).to.equal(1);
    expect((summary.results[0].result as FormulaLiteralResult).value).to.equal('Yes');
  });

  it('throws on invalid --records JSON', async () => {
    try {
      await FormulaEvaluate.run(['--formula', 'IF(TRUE, 1, 0)', '--records', 'not-valid-json']);
      expect.fail('Expected an error to be thrown');
    } catch (err: unknown) {
      expect((err as Error).message).to.include('Failed to parse --records as JSON');
    }
  });

  it('throws when --records is valid JSON but not an array', async () => {
    try {
      await FormulaEvaluate.run(['--formula', 'IF(TRUE, 1, 0)', '--records', '{"key":"value"}']);
      expect.fail('Expected an error to be thrown');
    } catch (err: unknown) {
      expect((err as Error).message).to.include('--records must be a JSON array');
    }
  });

  it('evaluates formula and records from --inputfile', async () => {
    const inputPath = join(tmpdir(), `formula-test-${Date.now()}.json`);
    await writeFile(
      inputPath,
      JSON.stringify({
        formula: 'IF(IsActive__c, "Active", "Inactive")',
        records: [
          { IsActive__c: { type: 'literal', dataType: 'checkbox', value: true } },
          { IsActive__c: { type: 'literal', dataType: 'checkbox', value: false } },
        ],
      })
    );

    const summary = asSummary(await FormulaEvaluate.run(['--inputfile', inputPath]));

    expect(summary.successCount).to.equal(2);
    expect((summary.results[0].result as FormulaLiteralResult).value).to.equal('Active');
    expect((summary.results[1].result as FormulaLiteralResult).value).to.equal('Inactive');
  });

  it('evaluates a complex nested formula from --inputfile', async () => {
    const inputPath = join(tmpdir(), `formula-test-complex-${Date.now()}.json`);
    await writeFile(
      inputPath,
      JSON.stringify({
        formula: 'IF(AND(IsActive__c, Amount__c > 1000), "VIP", IF(IsActive__c, "Standard", "Inactive"))',
        records: [
          {
            IsActive__c: { dataType: 'checkbox', value: true },
            Amount__c: { dataType: 'number', value: 1500, options: { length: 6, scale: 2 } },
          },
          {
            IsActive__c: { dataType: 'checkbox', value: true },
            Amount__c: { dataType: 'number', value: 800, options: { length: 6, scale: 2 } },
          },
          {
            IsActive__c: { dataType: 'checkbox', value: false },
            Amount__c: { dataType: 'number', value: 2000, options: { length: 6, scale: 2 } },
          },
        ],
      })
    );

    const summary = asSummary(await FormulaEvaluate.run(['--inputfile', inputPath]));

    expect(summary.successCount).to.equal(3);
    expect((summary.results[0].result as FormulaLiteralResult).value).to.equal('VIP');
    expect((summary.results[1].result as FormulaLiteralResult).value).to.equal('Standard');
    expect((summary.results[2].result as FormulaLiteralResult).value).to.equal('Inactive');
  });

  it('throws when --inputfile is missing "formula" key', async () => {
    const inputPath = join(tmpdir(), `formula-test-bad-${Date.now()}.json`);
    await writeFile(inputPath, JSON.stringify({ records: [] }));

    try {
      await FormulaEvaluate.run(['--inputfile', inputPath]);
      expect.fail('Expected an error to be thrown');
    } catch (err: unknown) {
      expect((err as Error).message).to.include('"formula" key (string) is required');
    }
  });

  it('throws when --inputfile is missing "records" key', async () => {
    const inputPath = join(tmpdir(), `formula-test-bad2-${Date.now()}.json`);
    await writeFile(inputPath, JSON.stringify({ formula: 'IF(TRUE, 1, 0)' }));

    try {
      await FormulaEvaluate.run(['--inputfile', inputPath]);
      expect.fail('Expected an error to be thrown');
    } catch (err: unknown) {
      expect((err as Error).message).to.include('"records" key (array) is required');
    }
  });

  it('returns the correct shape for --json output', async () => {
    const summary = asSummary(await FormulaEvaluate.run(['--formula', 'IF(TRUE, "Yes", "No")', '--json']));

    expect(summary).to.have.property('formula');
    expect(summary).to.have.property('referencedVariables');
    expect(summary).to.have.property('successCount');
    expect(summary).to.have.property('errorCount');
    expect(summary).to.have.property('results');
    expect(summary.results).to.be.an('array');
  });
});

describe('formulaUtils', () => {
  describe('evaluateFormulaForRecords', () => {
    it('evaluates a constant formula', async () => {
      const summary = evaluateFormulaForRecords('IF(TRUE, "Yes", "No")', [{}]);
      expect(summary.successCount).to.equal(1);
      expect(summary.errorCount).to.equal(0);
      expect((summary.results[0].result as FormulaLiteralResult).value).to.equal('Yes');
    });

    it('returns one result per record', async () => {
      const summary = evaluateFormulaForRecords('IF(IsActive__c, "Active", "Inactive")', [
        { IsActive__c: { type: 'literal', dataType: 'checkbox', value: true } },
        { IsActive__c: { type: 'literal', dataType: 'checkbox', value: false } },
      ]);
      expect(summary.results).to.have.length(2);
      expect(summary.successCount).to.equal(2);
    });

    it('assigns sequential recordIndex values', async () => {
      const summary = evaluateFormulaForRecords('IF(TRUE, "x", "y")', [{}, {}, {}]);
      expect(summary.results.map((r) => r.recordIndex)).to.deep.equal([0, 1, 2]);
    });

    it('extracts referenced variables from the formula', async () => {
      const summary = evaluateFormulaForRecords('IF(IsActive__c, Amount__c, 0)', [
        {
          IsActive__c: { type: 'literal', dataType: 'checkbox', value: true },
          Amount__c: { type: 'literal', dataType: 'number', value: 100 },
        },
      ]);
      expect(summary.referencedVariables).to.include('IsActive__c');
      expect(summary.referencedVariables).to.include('Amount__c');
    });

    it('returns isError=true without throwing on a bad formula', async () => {
      const summary = evaluateFormulaForRecords('IF(TRUE)', [{}]);
      expect(summary.results[0].isError).to.be.true;
      expect(summary.errorCount).to.equal(1);
      expect(summary.successCount).to.equal(0);
    });

    it('returns isError=true on a completely unparseable formula', async () => {
      const summary = evaluateFormulaForRecords('%%%not a formula%%%', [{}]);
      expect(summary.results[0].isError).to.be.true;
    });
  });

  describe('buildModelJson', () => {
    it('includes the formula in the model', () => {
      const model = buildModelJson('IF(Active__c, "Yes", "No")');
      expect(model.formula).to.equal('IF(Active__c, "Yes", "No")');
    });

    it('generates a placeholder record with one key per referenced variable', () => {
      const model = buildModelJson('IF(Active__c, Amount__c, 0)');
      const record = (model.records as Array<Record<string, unknown>>)[0];
      expect(record).to.have.property('Active__c');
      expect(record).to.have.property('Amount__c');
    });

    it('uses "text" as the placeholder dataType', () => {
      const model = buildModelJson('IF(Active__c, "Yes", "No")');
      const record = (model.records as Array<Record<string, { dataType: string }>>)[0];
      expect(record['Active__c']).to.have.property('dataType', 'text');
    });

    it('produces exactly one placeholder record', () => {
      const model = buildModelJson('IF(Active__c, "Yes", "No")');
      expect(model.records as unknown[]).to.have.length(1);
    });

    it('produces an empty placeholder record for a constant formula', () => {
      const model = buildModelJson('IF(TRUE, "Yes", "No")');
      expect(Object.keys((model.records as Array<Record<string, unknown>>)[0])).to.have.length(0);
    });
  });

  describe('summaryToJson', () => {
    it('serialises the summary to the expected shape', async () => {
      const summary = evaluateFormulaForRecords('IF(TRUE, "Yes", "No")', [{}]);
      const json = summaryToJson(summary);

      expect(json).to.have.all.keys(['formula', 'referencedVariables', 'successCount', 'errorCount', 'results']);
      expect(json.results).to.be.an('array');
    });
  });

  describe('formatEvaluationSummary', () => {
    it('includes the formula in the formatted output', async () => {
      const summary = evaluateFormulaForRecords('IF(TRUE, "Yes", "No")', [{}]);
      const output = formatEvaluationSummary(summary);
      expect(output).to.include('IF(TRUE, "Yes", "No")');
    });

    it('marks error records with ERROR in the output', async () => {
      const summary = evaluateFormulaForRecords('IF(TRUE)', [{}]);
      const output = formatEvaluationSummary(summary);
      expect(output).to.include('ERROR');
    });
  });
});
