export type ModelSelection = {providerId: string; model: string};
export type ModelRoles = {standard: ModelSelection; deep: ModelSelection};
export type ModelSettings = ModelRoles & {
  version: string;
  providers: {id: string; name: string; baseUrl: string; api: string; configured: boolean; models: string[]}[];
};
