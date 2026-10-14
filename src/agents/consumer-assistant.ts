export type ConsumerDecision = "accepted" | "partial" | "rejected" | "review" | "not_assessed";
export type ConsumerEvidenceKind = "production" | "inspection" | "cold_chain" | "shipment" | "purchase" | "consumer_feedback";
export type ConsumerSourceKind = "manufacturer" | "third_party" | "platform_device" | "consumer";
export type ConsumerSignatureState = "verified" | "invalid" | "not_checked" | "missing";

export interface ConsumerEvidenceFact {
  evidenceId: string;
  kind: ConsumerEvidenceKind;
  issuerId: string;
  sourceKind: ConsumerSourceKind;
  status: "submitted" | "revoked";
  dataMode: "demo/synthetic" | "external";
  signature: ConsumerSignatureState;
}

export interface ConsumerEvidenceSnapshot {
  batchId: string;
  dataMode: "demo/synthetic" | "external";
  decision: ConsumerDecision;
  decisionScope?: string;
  decisionReasons: string[];
  evidence: ConsumerEvidenceFact[];
}

export interface ConsumerAnswer {
  batchId: string;
  decision: ConsumerDecision;
  headline: string;
  facts: string[];
  uncertainties: string[];
  nextActions: string[];
  evidenceIds: string[];
  dataMode: ConsumerEvidenceSnapshot["dataMode"];
}

const evidenceLabels: Record<ConsumerEvidenceKind, string> = {
  production: "生产记录",
  inspection: "第三方检测",
  cold_chain: "温控记录",
  shipment: "运输记录",
  purchase: "购买记录",
  consumer_feedback: "消费者反馈",
};

const sourceLabels: Record<ConsumerSourceKind, string> = {
  manufacturer: "厂商",
  third_party: "第三方机构",
  platform_device: "平台设备",
  consumer: "消费者",
};

const expectedEvidence: ConsumerEvidenceKind[] = ["production", "inspection", "cold_chain", "shipment"];

export function answerConsumerQuestion(question: string, snapshot: ConsumerEvidenceSnapshot): ConsumerAnswer {
  const activeEvidence = snapshot.evidence.filter((item) => item.status === "submitted");
  const revokedEvidence = snapshot.evidence.filter((item) => item.status === "revoked");
  const missingKinds = expectedEvidence.filter((kind) => !activeEvidence.some((item) => item.kind === kind));
  const signatureIssues = activeEvidence.filter((item) =>
    (item.sourceKind === "third_party" || item.sourceKind === "platform_device") && item.signature !== "verified",
  );
  const q = question.toLowerCase();
  const asksAboutSignature = /签名|签字|签发|签章/.test(q);
  const asksAboutSource = /机构|来源|谁提供|来自谁|哪里来/.test(q);
  const asksAboutGaps = /缺|链路|证据|覆盖|完整/.test(q);
  const asksForDecision = /能不能买|能买吗|放心买|值得|可信|安全吗|怎么样|如何/.test(q);

  const facts = activeEvidence.map((item) => {
    const source = sourceLabels[item.sourceKind];
    if (item.sourceKind === "manufacturer") return evidenceLabels[item.kind] + "由生产方提交，目前属于厂商自报信息。";
    return evidenceLabels[item.kind] + "来自" + source + "，" + signatureText(item.signature) + "。";
  });
  for (const item of revokedEvidence) facts.push(evidenceLabels[item.kind] + "已撤销，目前不再作为有效依据。");
  for (const kind of missingKinds) facts.push(evidenceLabels[kind] + "：当前批次未登记相关证据");

  const uncertainties: string[] = [];
  if (missingKinds.length) uncertainties.push("未登记的证据表示当前无法核实，不等同于该项已经不合格。");
  if (signatureIssues.length) uncertainties.push("签名缺失、无效或尚未核验时，不能确认签发者身份及内容完整性；不能仅凭报告上的签名文字视为已验证。");
  if (snapshot.dataMode === "demo/synthetic") uncertainties.push("当前数据标记为 demo/synthetic，只能说明演示流程，不能证明真实商品或真实批次。");
  if (snapshot.decision === "not_assessed") uncertainties.push("当前没有可引用的代码验收结论，因此我不会把批次描述为已通过或不合格。");

  const nextActions: string[] = [];
  if (missingKinds.includes("inspection")) nextActions.push("向商家索取与本批次、样品编号一致的完整检测报告；优先选择可独立核验签发方的报告。");
  if (missingKinds.includes("cold_chain") || missingKinds.includes("shipment")) nextActions.push("要求补充带时间、批次关联和来源说明的温控/运输记录；缺记录时不要把“全程冷链”当作已证实事实。");
  if (missingKinds.includes("production")) nextActions.push("要求厂商补充可关联原料批次与成品批次的生产记录，并区分厂商自报和独立验证。");
  if (signatureIssues.length) nextActions.push("请签发机构提供可核验的原始签名材料与公钥信息；无法核验时，可要求独立复检或暂不依赖该报告作购买判断。");
  if (!nextActions.length && snapshot.decision !== "accepted") nextActions.push("可以查看具体证据来源，或要求补充独立证据后再判断。");

  const headline = asksAboutSignature
    ? signatureHeadline(activeEvidence, signatureIssues)
    : asksAboutSource
      ? sourceHeadline(activeEvidence)
    : asksAboutGaps
      ? missingKinds.length ? "这批证据链目前有未覆盖环节，缺失只代表无法核实，不代表自动判定不合格。" : "当前登记的核心证据类型齐全，但来源和签名仍需逐项核验。"
      : decisionHeadline(snapshot, asksForDecision);

  return {
    batchId: snapshot.batchId,
    decision: snapshot.decision,
    headline,
    facts,
    uncertainties,
    nextActions,
    evidenceIds: snapshot.evidence.map((item) => item.evidenceId),
    dataMode: snapshot.dataMode,
  };
}

function signatureText(state: ConsumerSignatureState): string {
  if (state === "verified") return "签名已由系统核验";
  if (state === "invalid") return "签名核验失败";
  if (state === "missing") return "未提供可核验签名";
  return "签名尚未核验";
}

function signatureHeadline(evidence: ConsumerEvidenceFact[], issues: ConsumerEvidenceFact[]): string {
  const signed = evidence.filter((item) => item.sourceKind === "third_party" || item.sourceKind === "platform_device");
  if (!signed.length) return "当前没有第三方或设备证据可供核验签名。";
  if (signed.some((item) => item.signature === "invalid")) return "至少一条第三方/设备证据的签名核验失败，不能当作已验证来源。";
  if (signed.some((item) => item.signature === "missing")) return "至少一条第三方/设备证据未提供可核验签名；现有材料不能确认其签发身份。";
  if (issues.length) return "签名材料尚未经过系统核验；报告上出现签名文字不等于密码学验证通过。";
  return "第三方/设备证据的签名已核验；这只确认签发身份和内容完整性，不单独证明检测结论正确。";
}

function sourceHeadline(evidence: ConsumerEvidenceFact[]): string {
  if (!evidence.length) return "当前没有登记证据，暂时无法确认信息来自谁。";
  const sources = [...new Set(evidence.map((item) => sourceLabels[item.sourceKind]))];
  return "当前登记来源包括：" + sources.join("、") + "。来源标记说明谁提交了记录，不等于记录内容已经独立验证。";
}

function decisionHeadline(snapshot: ConsumerEvidenceSnapshot, asksForDecision: boolean): string {
  if (snapshot.decision === "accepted") return "代码验收结果为通过" + (snapshot.decisionScope ? "（" + snapshot.decisionScope + "）" : "") + "；这不代表对未覆盖证据或未来批次作保证。";
  if (snapshot.decision === "rejected") return "代码验收未通过当前规则" + (snapshot.decisionReasons.length ? "：" + snapshot.decisionReasons.join("；") : "。") ;
  if (snapshot.decision === "partial" || snapshot.decision === "review") return "当前结论仍有未验证范围，需要补证或复核后再作判断。";
  return asksForDecision ? "现有资料不足以给出“可以买”或“安全”的保证；先核实缺口和签名，再决定是否依赖这批证据。" : "我会先按当前批次的证据覆盖、来源和核验状态回答，不把厂商声明当作独立证明。";
}
