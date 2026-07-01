import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect } from 'chai';
import { evaluateFormulaForRecords } from '../../src/utils/formulaUtils.js';
import { toJUnitXml, toCsv, toMarkdown } from '../../src/utils/reportUtils.js';
import { loadTestCases, runTestCases, buildSnapshot, diffSnapshots } from '../../src/utils/testRunner.js';

const sampleSummary = () =>
  evaluateFormulaForRecords('IF(Active__c, "Y", "N")', [
    { Active__c: { type: 'literal', dataType: 'checkbox', value: true }, _expected: { value: 'Y' } as never },
    { Active__c: { type: 'literal', dataType: 'checkbox', value: false }, _expected: { value: 'WRONG' } as never },
  ]);

describe('reportUtils', () => {
  it('produces JUnit XML with a failure element for a failing assertion', () => {
    const xml = toJUnitXml([sampleSummary()]);
    expect(xml).to.include('<testsuites');
    expect(xml).to.include('<testcase');
    expect(xml).to.include('<failure');
  });

  it('produces CSV with a header row and one row per record', () => {
    const csv = toCsv(sampleSummary()).split('\n');
    expect(csv[0]).to.include('record');
    expect(csv).to.have.length(3);
  });

  it('produces a markdown table', () => {
    const md = toMarkdown(sampleSummary());
    expect(md).to.include('| Record |');
    expect(md).to.include('Formula:');
  });
});

describe('testRunner', () => {
  it('loads cases from a JSON file and runs them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'suite-'));
    const file = join(dir, 'a.json');
    writeFileSync(
      file,
      JSON.stringify({
        tests: [
          {
            name: 'uplift',
            formula: 'Amount__c * 2',
            records: [
              {
                Amount__c: { type: 'literal', dataType: 'number', value: 5, options: { scale: 0 } },
                // eslint-disable-next-line camelcase
                _expected: { value: 10 },
              },
            ],
          },
        ],
      })
    );
    const cases = loadTestCases(file);
    expect(cases).to.have.length(1);
    const run = runTestCases(cases);
    expect(run.passed).to.be.true;
    expect(run.totalAssertionFailures).to.equal(0);
  });

  it('builds and diffs snapshots', () => {
    const s1 = buildSnapshot([sampleSummary()]);
    const s2 = buildSnapshot([sampleSummary()]);
    expect(diffSnapshots(s1, s2)).to.have.length(0);

    const mutated = JSON.parse(JSON.stringify(s2)) as typeof s2;
    const key = Object.keys(mutated)[0];
    mutated[key][0] = 'CHANGED';
    expect(diffSnapshots(s1, mutated).length).to.be.greaterThan(0);
  });
});
