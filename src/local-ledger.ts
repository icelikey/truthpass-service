import { sha256Hex } from "./hash.js";

/**
 * A deterministic, in-memory ledger used by the local replay command.
 *
 * It deliberately models an append-only event log rather than pretending to
 * be a blockchain.  Every event commits to its predecessor, and verify()
 * recomputes the event hashes so the CLI can demonstrate the same checks that
 * a chain receipt/indexer would perform after a real deployment.
 */
export type LocalLedgerEventType =
  | "verification_evaluated"
  | "evidence_anchor_planned"
  | "purchase_recorded"
  | "contribution_recorded"
  | "dispute_raised"
  | "evidence_superseded";

export interface LocalLedgerEvent {
  sequence: number;
  eventId: string;
  type: LocalLedgerEventType;
  requestId: string;
  previousEventHash: string;
  eventHash: string;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface LocalLedgerVerification {
  valid: boolean;
  eventCount: number;
  ledgerRoot: string;
  errors: string[];
}

const GENESIS = "0".repeat(64);

export class LocalLedger {
  private readonly entries: LocalLedgerEvent[] = [];

  async append(input: {
    type: LocalLedgerEventType;
    requestId: string;
    data: Record<string, unknown>;
    createdAt?: string;
  }): Promise<LocalLedgerEvent> {
    const sequence = this.entries.length + 1;
    const previousEventHash = this.entries.at(-1)?.eventHash ?? GENESIS;
    const createdAt = input.createdAt ?? "2026-10-06T12:00:00.000Z";
    const body = {
      sequence,
      type: input.type,
      requestId: input.requestId,
      previousEventHash,
      createdAt,
      data: input.data,
    };
    const eventHash = await sha256Hex(JSON.stringify(body));
    const eventId = await sha256Hex(`truthpass:local-ledger:${sequence}:${eventHash}`);
    const event: LocalLedgerEvent = { ...body, eventId, eventHash };
    this.entries.push(event);
    return event;
  }

  list(): LocalLedgerEvent[] {
    return this.entries.map((entry) => ({ ...entry, data: { ...entry.data } }));
  }

  async verify(): Promise<LocalLedgerVerification> {
    const errors: string[] = [];
    let previousEventHash = GENESIS;
    for (let index = 0; index < this.entries.length; index += 1) {
      const event = this.entries[index];
      const expectedSequence = index + 1;
      if (event.sequence !== expectedSequence) {
        errors.push(`sequence mismatch at event ${event.sequence}`);
      }
      if (event.previousEventHash !== previousEventHash) {
        errors.push(`previous hash mismatch at event ${event.sequence}`);
      }
      const expectedHash = await sha256Hex(JSON.stringify({
        sequence: event.sequence,
        type: event.type,
        requestId: event.requestId,
        previousEventHash: event.previousEventHash,
        createdAt: event.createdAt,
        data: event.data,
      }));
      if (event.eventHash !== expectedHash) {
        errors.push(`event hash mismatch at event ${event.sequence}`);
      }
      previousEventHash = event.eventHash;
    }
    return {
      valid: errors.length === 0,
      eventCount: this.entries.length,
      ledgerRoot: previousEventHash,
      errors,
    };
  }
}

