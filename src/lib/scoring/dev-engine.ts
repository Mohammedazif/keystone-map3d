import { DEV_SCHEMA } from './dev.schema';
import evaluateSchema, { ItemResult, EngineOutput } from './schema-engine';

export function evaluateDevSchema(results: Record<string, ItemResult | undefined>): EngineOutput {
  return evaluateSchema(DEV_SCHEMA as any, results);
}

export default evaluateDevSchema;
