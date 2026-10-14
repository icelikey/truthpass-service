import { PRODUCTION_STAGES, type ProductCategory, type ProductionStage } from "../data/model.js";

export interface PolicySnapshot {
  schemaVersion: "policy.snapshot.v1";
  policyId: string;
  version: string;
  productCategory: ProductCategory;
  source: string;
  dataMode: "demo/synthetic" | "external";
  thresholds: {
    minEpaDhaPercent: number;
    maxPeroxideValue: number;
    maxTotox: number;
    maxLogisticsGapHours: number;
  };
  requiredEvidence: ["inspection", "cold_chain"];
}

export interface ProductionPolicySnapshot {
  schemaVersion: "production.policy.snapshot.v1";
  policyId: "fish-oil-production";
  version: "v1";
  productCategory: ProductCategory;
  source: string;
  dataMode: "demo/synthetic" | "external";
  requiredStages: ProductionStage[];
}

export const FISH_OIL_POLICY_V1: PolicySnapshot = {
  schemaVersion: "policy.snapshot.v1",
  policyId: "fish-oil-quality",
  version: "v1",
  productCategory: "fish-oil",
  source: "team-approved-demo-rule",
  dataMode: "demo/synthetic",
  thresholds: {
    minEpaDhaPercent: 70,
    maxPeroxideValue: 5,
    maxTotox: 20,
    maxLogisticsGapHours: 6,
  },
  requiredEvidence: ["inspection", "cold_chain"],
};

export const FISH_OIL_PRODUCTION_POLICY_V1: ProductionPolicySnapshot = {
  schemaVersion: "production.policy.snapshot.v1",
  policyId: "fish-oil-production",
  version: "v1",
  productCategory: "fish-oil",
  source: "team-approved-demo-process-coverage-rule",
  dataMode: "demo/synthetic",
  requiredStages: [...PRODUCTION_STAGES],
};

Object.freeze(FISH_OIL_POLICY_V1.thresholds);
Object.freeze(FISH_OIL_POLICY_V1.requiredEvidence);
Object.freeze(FISH_OIL_POLICY_V1);
Object.freeze(FISH_OIL_PRODUCTION_POLICY_V1.requiredStages);
Object.freeze(FISH_OIL_PRODUCTION_POLICY_V1);

const policies = new Map([[`${FISH_OIL_POLICY_V1.policyId}:${FISH_OIL_POLICY_V1.version}`, FISH_OIL_POLICY_V1]]);
const productionPolicies = new Map([[FISH_OIL_PRODUCTION_POLICY_V1.policyId + ":" + FISH_OIL_PRODUCTION_POLICY_V1.version, FISH_OIL_PRODUCTION_POLICY_V1]]);

export function getPolicySnapshot(policyId: string, policyVersion: string): PolicySnapshot {
  const policy = policies.get(`${policyId}:${policyVersion}`);
  if (!policy) throw new Error(`未知或未批准的 policy: ${policyId}@${policyVersion}`);
  return structuredClone(policy);
}

export function getProductionPolicySnapshot(policyId: string, policyVersion: string): ProductionPolicySnapshot {
  const policy = productionPolicies.get(policyId + ":" + policyVersion);
  if (!policy) throw new Error("未知或未批准的 production policy: " + policyId + "@" + policyVersion);
  return structuredClone(policy);
}
