# sf-plugin-formula

[![NPM](https://img.shields.io/npm/v/sf-plugin-formula.svg?label=sf-plugin-formula)](https://www.npmjs.com/package/sf-plugin-formula) [![Downloads/week](https://img.shields.io/npm/dw/sf-plugin-formula.svg)](https://npmjs.org/package/sf-plugin-formula) [![License](https://img.shields.io/badge/License-BSD%203--Clause-brightgreen.svg)](https://raw.githubusercontent.com/salesforcecli/sf-plugin-formula/main/LICENSE.txt)

# summary

Evaluates a Salesforce formula against one or more records and returns the result for each.

This extension is only possible because of the following awesome opensource projects:

- [Formulon](https://github.com/leifg/formulon)
- [SFDX Hardis](https://github.com/hardisgroupcom/sfdx-hardis)

# description

Evaluates a Salesforce formula against one or more records and returns the result for each.

This command uses [Formulon](https://github.com/leifg/formulon) to parse and evaluate Salesforce formulas entirely offline, no org connection required.

Key features:

- **Multi-record evaluation:** Supply multiple records (each as a variable map) to evaluate the same formula against all of them in one shot.
- **Inline or file input:** Provide the formula and records directly as CLI flags, or point to a JSON file that contains both.
- **Error transparency:** Formulon errors (wrong argument count, type mismatches, etc.) are surfaced per record rather than aborting the whole run.

### Input JSON file format

When using \`--inputfile\`, the file must be a JSON object with the following shape:

```json
{
  "formula": "IF(IsActive**c, Amount**c * 1.1, Amount**c)",
  "records": [
    {
      "IsActive**c": { "type": "literal", "dataType": "checkbox", "value": true },
      "Amount**c": { "type": "literal", "dataType": "number", "value": 200, "options": { "length": 6, "scale": 2 } }
    },
    {
      "IsActive**c": { "type": "literal", "dataType": "checkbox", "value": false },
      "Amount__c": { "type": "literal", "dataType": "number", "value": 150, "options": { "length": 6, "scale": 2 } }
    }
  ]
}
```

Each entry in \`records\` is a map of **field API name → Formulon variable descriptor**.  
The variable descriptor shape is:

```json
{
"type": "literal",
"dataType": "<text|number|checkbox|date|time|datetime|geolocation|null>",
"value": <js-native-value>,
"options": { }
}
```

# flags.formula.summary

Salesforce formula to evaluate.

# flags.formula.description

Ignored when --inputfile is provided.

# flags.records.summary

JSON array of record variable maps.

# flags.records.description

Each element represents one record. Ignored when --inputfile is provided.

# flags.inputfile.summary

Path to a JSON file containing "formula" and "records".

# flags.inputfile.description

When supplied, --formula and --records are ignored.

# flags.debug.summary

Activate debug mode (more logs)

# examples

- Run a formula without variables:

  ```shell
  sf formula evaluate --formula 'IF(TRUE, "Yes", "No")'
  ```
- Run a formula with variables and multiple records:
  ```shell
  sf formula evaluate --formula 'Amount\_\_c \* 2' --records '[{"Amount**c":{"type":"literal" "dataType":"number","value":100,"options":{"length":6,"scale":2}}}]
  ```
- Run a formula from a JSON file:
  ```shell
  sf formula evaluate --inputfile ./my-formula.json
  ```
