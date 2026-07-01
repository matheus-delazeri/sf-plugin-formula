# summary

Generates a ready-to-fill input JSON template for a formula.

# description

Detects the fields a formula references and writes a JSON input file with one entry per field, ready to be filled in and passed to `formula evaluate --inputfile`. With `--target-org` and `--sobject`, each field's dataType is inferred from the org. With `--query`, the records are prefilled from real org data.

# flags.formula.summary

Salesforce formula to scaffold input for.

# flags.field.summary

Pull the formula from an existing org formula field ("Object.Field\_\_c"). Requires --target-org.

# flags.sobject.summary

sObject API name used to infer field types. Requires --target-org.

# flags.query.summary

SOQL query used to prefill records from real org data. Requires --target-org.

# flags.outputfile.summary

Output file path (default ./formula.json).

# flags.records.summary

Number of blank record templates to generate (ignored when --query is used).

# flags.force.summary

Overwrite the output file if it already exists.

# examples

- Scaffold a blank template for a formula:

  <%= config.bin %> <%= command.id %> --formula 'IF(IsActive**c, Amount**c \* 1.1, Amount\_\_c)'

- Scaffold with org-inferred types and 3 blank records:

  <%= config.bin %> <%= command.id %> --formula 'Amount\_\_c \* 2' --sobject Account --records 3 --target-org myOrg
