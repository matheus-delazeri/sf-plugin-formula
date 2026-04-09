# sf-plugin-formula

[![NPM](https://img.shields.io/npm/v/sf-plugin-formula.svg?label=sf-plugin-formula)](https://www.npmjs.com/package/sf-plugin-formula) [![Downloads/week](https://img.shields.io/npm/dw/sf-plugin-formula.svg)](https://npmjs.org/package/sf-plugin-formula) [![License](https://img.shields.io/badge/License-BSD%203--Clause-brightgreen.svg)](https://raw.githubusercontent.com/salesforcecli/sf-plugin-formula/main/LICENSE.txt)

Evaluates a Salesforce formula against one or more records and returns the result for each - entirely offline, no org connection required.

Built on top of these great open-source projects:

- [Formulon](https://github.com/leifg/formulon)
- [SFDX Hardis](https://github.com/hardisgroupcom/sfdx-hardis)

## Installation

```shell
sf plugins install sf-plugin-formula
```

## Features

- **Multi-record evaluation** - evaluate the same formula against multiple records in one run.
- **Flexible input** - pass the formula and records as CLI flags, or point to a JSON file containing both.
- **Per-record error reporting** - type mismatches, wrong argument counts, and other Formulon errors are reported per record instead of aborting the whole run.

## Usage

```shell
sf formula evaluate --formula 'IF(IsActive__c, Amount__c * 1.1, Amount__c)' --records '[...]'
sf formula evaluate --inputfile ./my-formula.json
```

## Flags

| Flag          | Summary                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `--formula`   | Salesforce formula to evaluate. Ignored when `--inputfile` is provided.                                         |
| `--records`   | JSON array of record variable maps. Each element represents one record. Ignored when `--inputfile` is provided. |
| `--inputfile` | Path to a JSON file containing `formula` and `records`. When supplied, `--formula` and `--records` are ignored. |
| `--debug`     | Enable debug mode for verbose logging.                                                                          |

## Examples

Evaluate a formula with no variables:

```shell
sf formula:evaluate --formula 'IF(TRUE, "Yes", "No")'
```

Evaluate a formula with variables across multiple records:

```shell
sf formula:evaluate \
  --formula 'Amount__c * 2' \
  --records '[{"Amount__c":{"dataType":"number","value":100,"options":{"length":6,"scale":2}}}]'
```

Evaluate a formula from a JSON file:

```shell
sf formula:evaluate --inputfile ./my-formula.json
```

## Input file format

When using `--inputfile`, the file must be a JSON object with this shape:

```json
{
  "formula": "IF(IsActive__c, Amount__c * 1.1, Amount__c)",
  "records": [
    {
      "IsActive__c": { "dataType": "checkbox", "value": true },
      "Amount__c": { "dataType": "number", "value": 200, "options": { "length": 6, "scale": 2 } }
    },
    {
      "IsActive__c": { "dataType": "checkbox", "value": false },
      "Amount__c": { "dataType": "number", "value": 150, "options": { "length": 6, "scale": 2 } }
    }
  ]
}
```

Each entry in `records` is a map of **field API name → Formulon variable descriptor**:

| Property   | Required | Description                                                                              |
| ---------- | -------- | ---------------------------------------------------------------------------------------- |
| `dataType` | Yes      | One of: `text`, `number`, `checkbox`, `date`, `time`, `datetime`, `geolocation`, `null`. |
| `value`    | Yes      | The field's value as a native JS type.                                                   |
| `options`  | No       | Additional type options (e.g. `length`, `scale` for numbers). Defaults to `{}`.          |
