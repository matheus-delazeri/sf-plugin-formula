# summary

Evaluates a Salesforce formula against one or more records and returns the result for each.

# description

Evaluates a Salesforce formula against one or more records and returns the result for each.

This command parses and evaluates Salesforce formulas offline. It can also connect to an org (via `--target-org`) to automatically infer field types, pull an existing formula field definition, and evaluate against real records queried with SOQL.

Key features:

- **Multi-record evaluation:** evaluate the same formula against many records in one run.
- **Org-backed type inference:** pass `--sobject` (with `--target-org`) to auto-detect each field's Formulon dataType.
- **Import existing formulas:** pass `--field Object.Field__c` to pull the formula text straight from org metadata.
- **Evaluate against real data:** pass `--query "SELECT ..."` to pull records from the org.
- **Assertions:** add `_expected` to any record to verify the result (value, type, tolerance or expected error).
- **Output formats:** `table` (default), `json`, `csv`, `markdown`, optionally written to `--outputfile`.
- **CI-friendly:** `--strict` returns a non-zero exit code when evaluation errors occur; assertion failures always do.

# flags.formula.summary

Salesforce formula to evaluate. Ignored when --inputfile or --field is provided.

# flags.records.summary

JSON array of record variable maps. Ignored when --inputfile or --query is provided.

# flags.inputfile.summary

Path to a JSON file containing "formula" and "records".

# flags.field.summary

Pull the formula definition from an existing org formula field, in "Object.Field\_\_c" format. Requires --target-org.

# flags.sobject.summary

sObject API name used to auto-infer field types from the org. Requires --target-org.

# flags.query.summary

SOQL query used to pull real records from the org to evaluate against. Requires --target-org.

# flags.output-format.summary

Output format: table (default), json, csv or markdown.

# flags.outputfile.summary

Write the serialized output to this file path.

# flags.tolerance.summary

Absolute numeric tolerance applied to value assertions.

# flags.strict.summary

Return a non-zero exit code when any record fails to evaluate (assertion failures always do).

# flags.watch.summary

Re-evaluate automatically whenever the --inputfile changes.

# flags.debug.summary

Activate debug mode (more logs).

# examples

- Run a formula without variables:

  <%= config.bin %> <%= command.id %> --formula 'IF(TRUE, "Yes", "No")'

- Evaluate an existing org formula field against real records:

  <%= config.bin %> <%= command.id %> --field Account.Discounted_Amount**c --sobject Account --query 'SELECT Amount**c, IsActive\_\_c FROM Account LIMIT 10' --target-org myOrg

- Run a formula from a JSON file and write a markdown report:

  <%= config.bin %> <%= command.id %> --inputfile ./my-formula.json --output-format markdown --outputfile report.md
