export type ModelSelection = {providerId: string; model: string};
export type ModelRoles = {standard: ModelSelection; deep: ModelSelection};
export type ModelDefinition = {id: string; smart: boolean; contextWindow: number; maxTokens: number; reasoning: boolean; vision: boolean};
export const MODEL_ID_PATTERN=/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/;
export const PROVIDER_MODEL_LIMIT=100;
export type ProviderModelTestRow = {model:string;status:'queued'|'running'|'succeeded'|'failed'|'unknown';failureCode?:string;elapsedMs?:number};
export type ProviderModelTest = {id:string;providerId:string;version:string;status:'running'|'finished'|'unknown';results:ProviderModelTestRow[]};
export type ModelSettings = ModelRoles & {
  version: string;
  providers: {id: string; name: string; baseUrl: string; api: string; configured: boolean; hasKey?: boolean; models: string[]; enabled: boolean; compatibility?: string; definitions: ModelDefinition[]}[];
};
