import { expect } from 'chai';
import {
  splitTopLevelArgs,
  findFunctionCalls,
  analyzeFormula,
  lintFormula,
  computeBranchCoverage,
} from '../../src/utils/analyzeUtils.js';

describe('splitTopLevelArgs', () => {
  it('splits simple arguments', () => {
    expect(splitTopLevelArgs('A, B, C')).to.deep.equal(['A', 'B', 'C']);
  });

  it('respects nested parentheses', () => {
    expect(splitTopLevelArgs('IF(X, 1, 2), B')).to.deep.equal(['IF(X, 1, 2)', 'B']);
  });

  it('respects commas inside string literals', () => {
    expect(splitTopLevelArgs('"a, b", C')).to.deep.equal(['"a, b"', 'C']);
  });
});

describe('findFunctionCalls', () => {
  it('finds functions and their nesting depth', () => {
    const calls = findFunctionCalls('IF(AND(A__c, B__c), 1, 0)');
    const names = calls.map((c) => c.name);
    expect(names).to.include('IF');
    expect(names).to.include('AND');
    const and = calls.find((c) => c.name === 'AND');
    expect(and?.depth).to.equal(1);
  });

  it('does not treat mixed-case field tokens as functions', () => {
    const calls = findFunctionCalls('My_Field__c + 1');
    expect(calls).to.have.length(0);
  });
});

describe('analyzeFormula', () => {
  it('reports referenced fields, functions and nesting', () => {
    const a = analyzeFormula('IF(ISCHANGED(Status__c), Amount__c * 2, Amount__c)');
    expect(a.referencedFields).to.include('Status__c');
    expect(a.referencedFields).to.include('Amount__c');
    expect(a.functions).to.have.property('IF', 1);
    expect(a.functions).to.have.property('ISCHANGED', 1);
    expect(a.maxNestingDepth).to.be.greaterThan(0);
    expect(a.branchCount).to.equal(1);
  });

  it('detects cross-object references', () => {
    const a = analyzeFormula('Account__r.Name');
    expect(a.crossObjectFields.length).to.be.greaterThan(0);
  });

  it('flags unbalanced parentheses', () => {
    const a = analyzeFormula('IF(TRUE, 1, 0');
    expect(a.balancedParens).to.be.false;
  });
});

describe('lintFormula', () => {
  it('flags context-only functions used in a formula field', () => {
    const a = analyzeFormula('IF(ISCHANGED(Status__c), 1, 0)');
    const findings = lintFormula(a, 'formulaField');
    expect(findings.some((f) => f.rule === 'context-function' && f.severity === 'error')).to.be.true;
  });

  it('does not flag ISCHANGED in a validation rule', () => {
    const a = analyzeFormula('IF(ISCHANGED(Status__c), 1, 0)');
    const findings = lintFormula(a, 'validationRule');
    expect(findings.some((f) => f.rule === 'context-function')).to.be.false;
  });

  it('errors on unbalanced parentheses', () => {
    const a = analyzeFormula('IF(TRUE, 1, 0');
    const findings = lintFormula(a);
    expect(findings.some((f) => f.rule === 'balanced-parens')).to.be.true;
  });
});

describe('computeBranchCoverage', () => {
  it('tallies which side of an IF each record takes', () => {
    const coverage = computeBranchCoverage('IF(Active__c, 1, 0)', [
      { Active__c: { type: 'literal', dataType: 'checkbox', value: true } },
      { Active__c: { type: 'literal', dataType: 'checkbox', value: false } },
    ]);
    expect(coverage.branches).to.have.length(1);
    expect(coverage.branches[0].trueHits).to.equal(1);
    expect(coverage.branches[0].falseHits).to.equal(1);
    expect(coverage.uncoveredCount).to.equal(0);
  });

  it('reports a branch that is never exercised both ways', () => {
    const coverage = computeBranchCoverage('IF(Active__c, 1, 0)', [
      { Active__c: { type: 'literal', dataType: 'checkbox', value: true } },
    ]);
    expect(coverage.uncoveredCount).to.equal(1);
  });
});
