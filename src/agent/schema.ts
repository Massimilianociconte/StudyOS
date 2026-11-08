export type SchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object";

export interface JsonSchema {
  type?: SchemaType | SchemaType[];
  description?: string;
  enum?: readonly (string | number | boolean)[];
  const?: string | number | boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: "date" | "date-time";
  default?: unknown;
  items?: JsonSchema;
  maxItems?: number;
  minItems?: number;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: false;
}

export type SchemaResult<T> = { ok: true; data: T } | { ok: false; error: string };

const isType = (value: unknown, type: SchemaType) => {
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
};

const matchesType = (value: unknown, type: JsonSchema["type"]) => {
  if (!type) return true;
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => isType(value, item));
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const validateSchema = (schema: JsonSchema, value: unknown, path = "input"): SchemaResult<unknown> => {
  if (value === undefined) {
    if (schema.default !== undefined) return validateSchema({ ...schema, default: undefined }, schema.default, path);
    return { ok: false, error: `Manca ${path}.` };
  }
  if (schema.const !== undefined && value !== schema.const) {
    return { ok: false, error: `${path} deve essere ${JSON.stringify(schema.const)}.` };
  }
  if (!matchesType(value, schema.type)) {
    return { ok: false, error: `${path} ha un tipo non valido.` };
  }
  if (schema.enum && !schema.enum.includes(value as string | number | boolean)) {
    return { ok: false, error: `${path} deve essere uno di: ${schema.enum.join(", ")}.` };
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return { ok: false, error: `${path} è troppo corto.` };
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return { ok: false, error: `${path} supera ${schema.maxLength} caratteri.` };
    if (schema.pattern && value !== "" && !new RegExp(schema.pattern).test(value)) return { ok: false, error: `${path} ha un formato non valido.` };
    if (value !== "" && schema.format === "date" && (!DATE_RE.test(value) || !Number.isFinite(Date.parse(value)))) {
      return { ok: false, error: `${path} deve essere una data YYYY-MM-DD.` };
    }
    if (value !== "" && schema.format === "date-time" && !Number.isFinite(Date.parse(value))) {
      return { ok: false, error: `${path} deve essere una data ISO.` };
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return { ok: false, error: `${path} è sotto il minimo (${schema.minimum}).` };
    if (schema.maximum !== undefined && value > schema.maximum) return { ok: false, error: `${path} è sopra il massimo (${schema.maximum}).` };
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return { ok: false, error: `${path} ha troppi pochi elementi.` };
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return { ok: false, error: `${path} ha troppi elementi (max ${schema.maxItems}).` };
    if (schema.items) {
      const items: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const checked = validateSchema(schema.items, value[index], `${path}[${index}]`);
        if (!checked.ok) return checked;
        items.push(checked.data);
      }
      return { ok: true, data: items };
    }
  }
  if (schema.type === "object" || schema.properties) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: `${path} deve essere un oggetto.` };
    const source = value as Record<string, unknown>;
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      const extra = Object.keys(source).filter((key) => !allowed.has(key));
      if (extra.length) return { ok: false, error: `${path} contiene campi non ammessi: ${extra.join(", ")}.` };
    }
    const output: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      if (source[key] === undefined) {
        if (property.default !== undefined) {
          const filled = validateSchema({ ...property, default: undefined }, property.default, `${path}.${key}`);
          if (!filled.ok) return filled;
          output[key] = filled.data;
        } else if (schema.required?.includes(key)) {
          return { ok: false, error: `Manca ${path}.${key}.` };
        }
        continue;
      }
      const checked = validateSchema(property, source[key], `${path}.${key}`);
      if (!checked.ok) return checked;
      output[key] = checked.data;
    }
    return { ok: true, data: output };
  }
  return { ok: true, data: value };
};

export const parseToolArgs = (schema: JsonSchema, value: unknown): SchemaResult<Record<string, unknown>> => {
  const parsed = validateSchema(schema, value ?? {}, "argomenti");
  if (!parsed.ok) return parsed;
  if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    return { ok: false, error: "Gli argomenti devono essere un oggetto." };
  }
  return { ok: true, data: parsed.data as Record<string, unknown> };
};
