export type ModelSelection = {providerId: string; model: string};
export type ModelRoles = {standard: ModelSelection; deep: ModelSelection};
export type ModelDefinition = {id: string; smart: boolean; contextWindow: number; maxTokens: number; reasoning: boolean; vision: boolean};
export type ModelSettings = ModelRoles & {
  version: string;
  providers: {id: string; name: string; baseUrl: string; api: string; configured: boolean; models: string[]; enabled: boolean; compatibility?: string; definitions: ModelDefinition[]}[];
};
