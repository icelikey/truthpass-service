import test from "node:test";
import assert from "node:assert/strict";

import {
  ExpertAgentCore,
  SagScopedAdapter,
  createFishOilPublicKnowledgePack,
} from "../src/agent-core/core.js";
import { FISH_OIL_STANDARD_PACK_V1 } from "../src/standards/v1_4.js";

test("fish oil public knowledge is searchable without exposing private packs", async () => {
  const core = new ExpertAgentCore();
  core.registerKnowledgePack({
    id: "tenant-a-fish-oil-private",
    tenantId: "tenant-a",
    scope: "tenant_private",
    domain: "fish-oil",
    version: "1.0.0",
    documents: [{ id: "private-sop", title: "商家内部 SOP", text: "只允许 tenant-a 查看", tags: ["内部"], sourceRefs: ["sop-1"] }],
    sourceRefs: ["sop-1"],
    definitions: {},
    interpretationRules: [],
    forbiddenClaims: [],
    effectiveAt: "2026-11-09T00:00:00.000Z",
  });

  const publicHits = await core.searchScopedKnowledge({ tenantId: "tenant-b", productId: "fish-oil", batchId: "FO-2026-001", query: "过氧化值" });
  assert.ok(publicHits.some((hit) => hit.packId === createFishOilPublicKnowledgePack().id));
  assert.equal(publicHits.some((hit) => hit.packId === "tenant-a-fish-oil-private"), false);

  const privateHits = await core.searchScopedKnowledge({ tenantId: "tenant-a", productId: "fish-oil", batchId: "FO-REAL-001", query: "SOP" });
  assert.ok(privateHits.some((hit) => hit.packId === "tenant-a-fish-oil-private"));
  const riceHits = await core.searchScopedKnowledge({ tenantId: "tenant-a", productId: "rice-wuchang", batchId: "RC-2026-001", query: "检测" });
  assert.equal(riceHits.some((hit) => hit.packId === "fish-oil-public-knowledge"), false);
});


test("fish oil standard pack freezes the required fields and decision boundary", () => {
  assert.equal(FISH_OIL_STANDARD_PACK_V1.standardId, "fish-oil-standard");
  assert.equal(FISH_OIL_STANDARD_PACK_V1.policyRef, "fish-oil-quality@v1");
  assert.deepEqual(FISH_OIL_STANDARD_PACK_V1.decisionStates, [
    "recommend_with_scope",
    "review_before_recommendation",
    "do_not_recommend",
  ]);
  assert.ok(FISH_OIL_STANDARD_PACK_V1.requiredProductionStages.includes("脱臭"));
  assert.ok(FISH_OIL_STANDARD_PACK_V1.requiredFields.some((field) => field.key === "inspection.epa_dha" && field.required));
  assert.ok(FISH_OIL_STANDARD_PACK_V1.forbiddenClaims.includes("真实认证"));
});

test("consumer needs become merchant-reviewed product and brand proposals", async () => {
  const core = new ExpertAgentCore();
  const first = await core.recordConsumerNeed({
    anonymousConsumerId: "anon-1",
    tenantId: "tenant-fish-oil-demo",
    productId: "fish-oil",
    batchId: "FO-REAL-001",
    useCase: "日常补充",
    concern: "胶囊有腥味",
    preferredParameters: { capsuleSize: "small", oxidationEvidence: true },
    consentScope: "anonymous_research",
  });
  const second = await core.recordConsumerNeed({
    anonymousConsumerId: "anon-2",
    tenantId: "tenant-fish-oil-demo",
    productId: "fish-oil",
    batchId: "FO-REAL-001",
    useCase: "日常补充",
    concern: "胶囊有腥味",
    preferredParameters: { storage: "cool" },
    consentScope: "anonymous_research",
  });
  const spec = await core.createProductSpec({ tenantId: "tenant-fish-oil-demo", domain: "fish-oil", needIds: [first.id, second.id] });
  assert.equal(spec.status, "merchant_review");
  assert.equal(spec.targetUseCase, "日常补充");
  assert.equal(spec.parameterRequirements.capsuleSize, "small");
  const proposal = await core.createBrandProposal({ tenantId: "tenant-fish-oil-demo", productSpecId: spec.id });
  assert.equal(proposal.status, "merchant_review");
  assert.match(proposal.positioning, /日常补充/);
  const report = core.improvementReport("tenant-fish-oil-demo", "FO-REAL-001");
  assert.equal(report.sampleCount, 2);
  assert.equal(report.concerns[0]?.concern, "胶囊有腥味");
});

test("SAG adapter does not accept an evidence reference without TruthPass resolution", async () => {
  const adapter = new SagScopedAdapter(new ExpertAgentCore());
  const result = await adapter.resolveEvidenceRef("ev-unknown", { tenantId: "tenant-a", productId: "fish-oil", batchId: "FO-REAL-001" });
  assert.deepEqual(result, { evidenceId: "ev-unknown", accepted: false });
});
