import { createPublicKey, verify } from "node:crypto";
import { canonicalJson } from "../data/canonical.js";
import type { EvidenceAttestation, EvidenceRecord } from "../data/model.js";
import type { ExecutionEvidence } from "../types.js";

export type TrustedIssuerKeyResolver = (issuerId: string, keyId: string) => string | undefined;

export interface ReplayGuard {
  reserve(key: string): boolean | Promise<boolean>;
}

export class InMemoryReplayGuard implements ReplayGuard {
  #used = new Set<string>();

  reserve(key: string): boolean {
    if (this.#used.has(key)) return false;
    this.#used.add(key);
    return true;
  }
}

export interface TrustedIssuerPublicKey {
  issuerId: string;
  keyId: string;
  publicKeyPem: string;
  revoked?: boolean;
}

export class TrustedIssuerKeyRegistry {
  #keys = new Map<string, { publicKeyPem: string; revoked: boolean }>();

  constructor(entries: readonly TrustedIssuerPublicKey[]) {
    for (const entry of entries) {
      if (!entry.issuerId.trim() || !entry.keyId.trim()) throw new Error("issuerId 和 keyId 不能为空");
      const key = createPublicKey(entry.publicKeyPem);
      if (key.asymmetricKeyType !== "ed25519") throw new Error("签发方公钥必须是 Ed25519");
      const id = this.id(entry.issuerId, entry.keyId);
      if (this.#keys.has(id)) throw new Error("issuerId/keyId 重复");
      this.#keys.set(id, { publicKeyPem: key.export({ type: "spki", format: "pem" }).toString(), revoked: entry.revoked === true });
    }
  }

  resolve: TrustedIssuerKeyResolver = (issuerId, keyId) => {
    const entry = this.#keys.get(this.id(issuerId, keyId));
    return entry && !entry.revoked ? entry.publicKeyPem : undefined;
  };

  revoke(issuerId: string, keyId: string): boolean {
    const id = this.id(issuerId, keyId);
    const entry = this.#keys.get(id);
    if (!entry || entry.revoked) return false;
    entry.revoked = true;
    return true;
  }

  private id(issuerId: string, keyId: string): string {
    return JSON.stringify([issuerId, keyId]);
  }
}

type AttestationClaims = Pick<EvidenceAttestation, "keyId" | "nonce" | "expiresAt">;

function validFreshClaims(claims: AttestationClaims): boolean {
  const expiresAt = Date.parse(claims.expiresAt);
  return /^[a-f0-9]{32}$/.test(claims.nonce) && Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function attestationReplayKey(scope: string, claims: AttestationClaims): string {
  return `${scope}:${claims.keyId}:${claims.nonce}`;
}

export function evidenceSigningPayload(evidence: Pick<EvidenceRecord, "schemaVersion" | "evidenceId" | "batchId" | "kind" | "issuerId" | "sourceKind" | "occurredAt" | "payload" | "dataMode">, claims: AttestationClaims): string {
  return canonicalJson({
    schemaVersion: evidence.schemaVersion,
    evidenceId: evidence.evidenceId,
    batchId: evidence.batchId,
    kind: evidence.kind,
    issuerId: evidence.issuerId,
    sourceKind: evidence.sourceKind,
    occurredAt: evidence.occurredAt,
    payload: evidence.payload,
    dataMode: evidence.dataMode,
    keyId: claims.keyId,
    nonce: claims.nonce,
    expiresAt: claims.expiresAt,
  });
}

export function verifyEvidenceAttestation(evidence: EvidenceRecord, resolveTrustedKey: TrustedIssuerKeyResolver): boolean {
  const attestation = evidence.attestation;
  if (!attestation || attestation.algorithm !== "Ed25519" || !attestation.keyId || !validFreshClaims(attestation)) return false;

  try {
    const publicKey = resolveTrustedKey(evidence.issuerId, attestation.keyId);
    if (!publicKey) return false;
    return verify(
      null,
      Buffer.from(evidenceSigningPayload(evidence, attestation)),
      createPublicKey(publicKey),
      Buffer.from(attestation.signature, "base64"),
    );
  } catch {
    return false;
  }
}

export function executionEvidenceSigningPayload(evidence: ExecutionEvidence, claims: AttestationClaims): string {
  return canonicalJson({
    schemaVersion: "execution.evidence.v1",
    evidenceMode: "external",
    serviceId: evidence.serviceId,
    taskId: evidence.taskId,
    batchId: evidence.batchId,
    reportBatchId: evidence.reportBatchId,
    productionTime: evidence.productionTime,
    reportTime: evidence.reportTime,
    logisticsGapHours: evidence.logisticsGapHours,
    epaDhaPercent: evidence.epaDhaPercent,
    peroxideValue: evidence.peroxideValue,
    totox: evidence.totox,
    coldChainGapHours: evidence.coldChainGapHours,
    payload: evidence.payload,
    keyId: claims.keyId,
    nonce: claims.nonce,
    expiresAt: claims.expiresAt,
  });
}

export function verifyExecutionEvidenceAttestation(evidence: ExecutionEvidence, resolveTrustedKey: TrustedIssuerKeyResolver): boolean {
  const attestation = evidence.attestation;
  if (!attestation || attestation.algorithm !== "Ed25519" || !attestation.keyId || !validFreshClaims(attestation)) return false;

  try {
    const publicKey = resolveTrustedKey(evidence.serviceId, attestation.keyId);
    if (!publicKey) return false;
    return verify(
      null,
      Buffer.from(executionEvidenceSigningPayload(evidence, attestation)),
      createPublicKey(publicKey),
      Buffer.from(attestation.signature, "base64"),
    );
  } catch {
    return false;
  }
}
