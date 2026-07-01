import { Connection } from '@salesforce/core';
import type { FormulaDataType, FormulaVariable, FormulaVariableMap } from './formulaUtils.js';

export type FieldTypeInfo = {
  dataType: FormulaDataType;
  options: Record<string, unknown>;
};

export type PulledFormula = {
  sobject: string;
  fieldName: string;
  formula: string;
  returnType?: string;
};

/** Map a Salesforce field "type" (from describe) to a Formulon dataType. */
export function mapSalesforceFieldType(sfType: string): FormulaDataType {
  switch (sfType) {
    case 'boolean':
      return 'checkbox';
    case 'int':
    case 'double':
    case 'currency':
    case 'percent':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'time':
      return 'time';
    case 'picklist':
      return 'picklist';
    case 'multipicklist':
      return 'multipicklist';
    case 'location':
      return 'geolocation';
    case 'string':
    case 'textarea':
    case 'phone':
    case 'email':
    case 'url':
    case 'id':
    case 'reference':
    case 'encryptedstring':
    default:
      return 'text';
  }
}

/** Describe an sObject and return a map of field API name -> inferred Formulon type. */
export async function describeSObjectFieldTypes(
  conn: Connection,
  sobject: string
): Promise<Map<string, FieldTypeInfo>> {
  const described = await conn.describe(sobject);
  const map = new Map<string, FieldTypeInfo>();
  for (const field of described.fields) {
    const dataType = mapSalesforceFieldType(field.type);
    const options: Record<string, unknown> = {};
    if (dataType === 'number') {
      options.scale = field.scale ?? 0;
      options.length = (field.precision ?? 18) - (field.scale ?? 0) || 18;
    }
    map.set(field.name, { dataType, options });
  }
  return map;
}

type CustomFieldMeta = { formula?: string; type?: string; fullName?: string };

/** Pull an existing formula field definition (formula text + return type) from the org. */
export async function pullFormulaField(conn: Connection, objectDotField: string): Promise<PulledFormula> {
  const [sobject, fieldName] = objectDotField.split('.');
  if (!sobject || !fieldName) {
    throw new Error(`--field must be in "Object.Field__c" format, got "${objectDotField}"`);
  }
  const meta = (await conn.metadata.read('CustomField', objectDotField)) as unknown as
    | CustomFieldMeta
    | CustomFieldMeta[];
  const readMeta: CustomFieldMeta | undefined = Array.isArray(meta) ? meta[0] : meta;
  if (!readMeta?.formula) {
    throw new Error(`No formula found on ${objectDotField}. Is it a formula field?`);
  }
  return { sobject, fieldName, formula: readMeta.formula, returnType: readMeta.type };
}

function coerceOrgValue(value: unknown, dataType: FormulaDataType): unknown {
  if (value === null || value === undefined) return null;
  switch (dataType) {
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'checkbox':
      return value === true || value === 'true';
    case 'date':
    case 'datetime':
    case 'time':
      return new Date(value as string);
    default:
      return value;
  }
}

/** Convert a single queried record into a Formulon variable map, limited to referenced fields. */
export function recordToVariableMap(
  record: Record<string, unknown>,
  typeMap: Map<string, FieldTypeInfo>,
  referencedFields: string[]
): FormulaVariableMap {
  const out: FormulaVariableMap = {};
  for (const fieldName of referencedFields) {
    const info = typeMap.get(fieldName);
    const rawValue = record[fieldName];
    const dataType: FormulaDataType = info?.dataType ?? 'text';
    const variable: FormulaVariable = {
      type: 'literal',
      dataType: rawValue === null || rawValue === undefined ? 'null' : dataType,
      value: coerceOrgValue(rawValue, dataType),
      options: info?.options ?? {},
    };
    out[fieldName] = variable;
  }
  return out;
}

/** Run a SOQL query and map each row into a Formulon variable map. */
export async function queryRecordVariableMaps(
  conn: Connection,
  soql: string,
  typeMap: Map<string, FieldTypeInfo>,
  referencedFields: string[]
): Promise<FormulaVariableMap[]> {
  const res = await conn.query(soql);
  const records = (res.records ?? []) as Array<Record<string, unknown>>;
  return records.map((rec) => recordToVariableMap(rec, typeMap, referencedFields));
}

/** Build a type map restricted to the fields a formula actually references. */
export function pickReferencedTypes(
  typeMap: Map<string, FieldTypeInfo>,
  referencedFields: string[]
): Map<string, FieldTypeInfo> {
  const out = new Map<string, FieldTypeInfo>();
  for (const f of referencedFields) {
    const info = typeMap.get(f);
    if (info) out.set(f, info);
  }
  return out;
}
