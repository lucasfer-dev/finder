export type SourceIntegrationType = "official_api" | "open_data" | "open_source" | "public_page" | "reference";

export interface SourceCapabilities {
  historicalSearch: boolean;
  monitoring: boolean;
  confirmsOpenDeadline: boolean;
}

export interface SourceAdapter {
  id: string;
  name: string;
  integrationType: SourceIntegrationType;
  capabilities: SourceCapabilities;
  knownRestrictions: string[];
}
