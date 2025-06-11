
export enum RiskType {
  NONE = "NONE",
  FALL = "FALL",
  FIRE = "FIRE",
  UNKNOWN = "UNKNOWN"
}

export interface DetectedRisk {
  detected_risk: RiskType;
  description: string;
  confidence_score: number;
}

export interface Alert {
  id: string;
  type: RiskType;
  message: string;
  timestamp: Date;
  details?: string;
}

export interface GeminiAnalysisResponse {
  detected_risk: RiskType;
  description: string;
  confidence_score: number;
}
