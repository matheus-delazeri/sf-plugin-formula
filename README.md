# sf-plugin-formula

[![NPM](https://img.shields.io/npm/v/sf-plugin-formula.svg?label=sf-plugin-formula)](https://www.npmjs.com/package/sf-plugin-formula) [![Downloads/week](https://img.shields.io/npm/dw/sf-plugin-formula.svg)](https://npmjs.org/package/sf-plugin-formula) [![License](https://img.shields.io/badge/License-BSD%203--Clause-brightgreen.svg)](https://raw.githubusercontent.com/salesforcecli/sf-plugin-formula/main/LICENSE.txt)

Evaluate, **test**, **analyze**, **scaffold** and **diff** Salesforce formulas from the CLI - entirely offline by default, with an **optional org connection** for type inference, formula import and real-record evaluation.

Built on top of these great open-source projects:

- [Formulon](https://github.com/leifg/formulon) (via [@steedos/formula](https://www.npmjs.com/package/@steedos/formula))
- [SFDX Hardis](https://github.com/hardisgroupcom/sfdx-hardis)

## Installation

```shell
sf plugins install sf-plugin-formula
```

`sfdx-hardis` is used for the VS Code menu integration and rich terminal output. Installing it also lets the plugin's commands appear as cards in the sfdx-hardis VS Code extension.

## Commands

| Command               | What it does                                                                         |
| --------------------- | ------------------------------------------------------------------------------------ |
| `sf formula evaluate` | Evaluate a formula against one or more records (with optional assertions).           |
| `sf formula test`     | Run a suite of formula test cases with assertions - CI friendly (exit codes, JUnit). |
| `sf formula analyze`  | Static analysis: dependencies, complexity, context-aware lint and branch coverage.   |
| `sf formula scaffold` | Generate a ready-to-fill input JSON template for a formula.                          |
| `sf formula diff`     | Evaluate two formulas over the same records and report where they diverge.           |

## Features

- **Multi-record evaluation** - evaluate the same formula against many records in one run.
- **Rich assertions** - `_expected` can assert a value (type-aware, with numeric `tolerance`), the result `assertDataType`, or that the formula errors (`errorType`).
- **Org integration (optional)** - with `--target-org`:
  - `--sobject` auto-infers each field's type from the org (no manual `dataType`).
  - `--field Object.Field__c` pulls an existing formula field's definition straight from metadata.
  - `--query "SELECT ..."` evaluates against real records.
- **CI-ready** - `--strict` and the `test` command set non-zero exit codes; emit **JUnit** for pipelines, and catch regressions with **snapshots**.
- **Static analysis & lint** - dependency reports, complexity metrics, and context-aware rules (e.g. `ISCHANGED`/`PRIORVALUE`/`REGEX` flagged when used in a formula field).
- **Multiple output formats** - `table` (default), `json`, `csv`, `markdown`, optionally written to `--outputfile`.

---

## `sf formula evaluate`

```shell
sf formula evaluate --formula 'IF(IsActive__c, Amount__c * 1.1, Amount__c)' --records '[...]'
sf formula evaluate --inputfile ./my-formula.json
sf formula evaluate --inputfile ./my-formula.json --watch
```

| Flag              | Summary                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `--formula`       | Salesforce formula to evaluate. Ignored when `--inputfile` or `--field` is provided.     |
| `--records`       | JSON array of record variable maps. Ignored when `--inputfile` or `--query` is provided. |
| `--inputfile`     | Path to a JSON file containing `formula` and `records`.                                  |
| `--field`         | Pull the formula from an org formula field (`Object.Field__c`). Requires `--target-org`. |
| `--sobject`       | sObject API name used to auto-infer field types. Requires `--target-org`.                |
| `--query`         | SOQL query to pull real records from the org. Requires `--target-org`.                   |
| `--target-org`    | Org alias/username to connect to (standard `sf` flag).                                   |
| `--output-format` | `table` (default), `json`, `csv` or `markdown`.                                          |
| `--outputfile`    | Write the serialized output to this file.                                                |
| `--tolerance`     | Absolute numeric tolerance for value assertions.                                         |
| `--strict`        | Return a non-zero exit code when any record errors (assertion failures always do).       |
| `--watch`         | Re-evaluate automatically whenever `--inputfile` changes.                                |
| `--debug`         | Verbose logging.                                                                         |

### Evaluate an existing org formula field against live records

```shell
sf formula evaluate \
  --field Account.Discounted_Amount__c \
  --sobject Account \
  --query 'SELECT Amount__c, IsActive__c FROM Account LIMIT 10' \
  --target-org myOrg
```

This pulls the formula text from the field's metadata, infers the types of `Amount__c` / `IsActive__c` from the org, evaluates against the 10 queried records, and prints a table.

### Assertions

Add `_expected` to any record to assert the result. Records without `_expected` are still evaluated; their assertion column shows `-`.

```json
{
  "formula": "Amount__c * 1.1",
  "records": [
    {
      "Amount__c": { "dataType": "number", "value": 100, "options": { "scale": 2 } },
      "_expected": { "value": 110 }
    },
    {
      "Amount__c": { "dataType": "number", "value": 100, "options": { "scale": 2 } },
      "_expected": { "value": 110.001, "tolerance": 0.01 }
    },
    {
      "Amount__c": { "dataType": "number", "value": 100, "options": { "scale": 2 } },
      "_expected": { "assertDataType": "number" }
    }
  ]
}
```

The `_expected` descriptor supports:

| Field            | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `value`          | Expected value (type-aware comparison - `110` never equals `"110"`). |
| `tolerance`      | Absolute numeric tolerance applied to `value`.                       |
| `assertDataType` | Assert the result's dataType (e.g. `number`, `text`).                |
| `errorType`      | Assert the formula errors. Use `"*"` to accept any error type.       |

---

## `sf formula test`

Run a suite of test cases and fail the process on any assertion failure, formula error, or snapshot mismatch - ideal for CI.

```shell
sf formula test --suite ./formula-tests                       # a directory of JSON files
sf formula test --suite ./tests.json --output-format junit --outputfile results.xml
sf formula test --suite ./tests.json --snapshot ./tests.snap.json
```

A suite file may be a single `{ "formula", "records" }` object, an array of them, or:

```json
{
  "tests": [
    {
      "name": "10% uplift",
      "formula": "Amount__c * 1.1",
      "records": [
        {
          "Amount__c": { "dataType": "number", "value": 100, "options": { "scale": 2 } },
          "_expected": { "value": 110 }
        }
      ]
    }
  ]
}
```

| Flag                | Summary                                                       |
| ------------------- | ------------------------------------------------------------- |
| `--suite`           | JSON test file or directory of JSON test files (required).    |
| `--output-format`   | `table` (default), `json` or `junit`.                         |
| `--outputfile`      | Write the `json`/`junit` report to this file.                 |
| `--snapshot`        | Compare results against a snapshot file (created if missing). |
| `--update-snapshot` | Overwrite the snapshot with current results.                  |
| `--tolerance`       | Absolute numeric tolerance for value assertions.              |

---

## `sf formula analyze`

Static analysis - no evaluation required (records are only used for branch coverage).

```shell
sf formula analyze --formula 'IF(ISCHANGED(Status__c), 1, 0)' --context formulaField
sf formula analyze --field Opportunity.Health__c --inputfile ./records.json --target-org myOrg
```

Reports referenced fields (flagging cross-object `__r` references), function usage, nesting depth and other complexity metrics, plus context-aware lint findings. With `--context formulaField`, functions that are not available in formula fields (e.g. `ISCHANGED`, `PRIORVALUE`, `REGEX`) are flagged as errors. When a records file is supplied, `IF()` **branch coverage** shows which branches were exercised.

| Flag          | Summary                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `--formula`   | Formula to analyze.                                                    |
| `--inputfile` | JSON file with `formula` (and optional `records` for branch coverage). |
| `--field`     | Pull the formula from an org formula field. Requires `--target-org`.   |
| `--context`   | `formulaField`, `validationRule`, `flow` or `default`.                 |
| `--strict`    | Non-zero exit code when any error-severity finding is present.         |

---

## `sf formula scaffold`

Generate an input template with one entry per referenced field, ready to fill in and feed to `evaluate`/`test`.

```shell
sf formula scaffold --formula 'IF(IsActive__c, Amount__c * Rate__c, 0)' --records 2
sf formula scaffold --formula 'Amount__c * 2' --sobject Account --target-org myOrg   # infers types
sf formula scaffold --field Account.Discount__c --query 'SELECT Amount__c FROM Account LIMIT 5' --target-org myOrg
```

| Flag           | Summary                                                              |
| -------------- | -------------------------------------------------------------------- |
| `--formula`    | Formula to scaffold input for.                                       |
| `--field`      | Pull the formula from an org formula field. Requires `--target-org`. |
| `--sobject`    | Infer field types from the org. Requires `--target-org`.             |
| `--query`      | Prefill records from real org data. Requires `--target-org`.         |
| `--outputfile` | Output path (default `./formula.json`).                              |
| `--records`    | Number of blank record templates (ignored with `--query`).           |
| `--force`      | Overwrite an existing output file.                                   |

---

## `sf formula diff`

Evaluate two formulas over the same records and show where they diverge - useful to prove a refactor is equivalent.

```shell
sf formula diff \
  --formula 'A__c + B__c' \
  --formula-b 'B__c + A__c' \
  --records '[{"A__c":{"dataType":"number","value":2},"B__c":{"dataType":"number","value":3}}]'

sf formula diff --inputfile ./diff.json --strict
```

With `--strict`, returns a non-zero exit code if any record differs. The `--inputfile` shape is `{ "formula", "formulaB", "records" }`.

---

## Input file & variable format

Each entry in `records` is a map of **field API name → Formulon variable descriptor**:

| Property    | Required | Description                                                                                                           |
| ----------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `dataType`  | Yes\*    | One of: `text`, `number`, `checkbox`, `date`, `time`, `datetime`, `picklist`, `multipicklist`, `geolocation`, `null`. |
| `value`     | Yes\*    | The field's value as a native JS type.                                                                                |
| `options`   | No       | Additional type options (e.g. `length`, `scale` for numbers). Defaults to `{}`.                                       |
| `_expected` | No       | Assertion descriptor (see the evaluate section). Shows a PASS/FAIL column when present.                               |

\* When you connect an org with `--sobject`, `dataType`/`options` are inferred automatically and don't need to be specified.

## Exit codes

`0` = success. `1` = at least one assertion failed, a snapshot mismatched, a `diff` diverged under `--strict`, or (with `--strict`) a formula errored. This makes every command safe to drop into a CI pipeline.

## Development

```shell
yarn install
yarn build
yarn test      # mocha unit tests
yarn lint
```
