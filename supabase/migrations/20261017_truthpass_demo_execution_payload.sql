-- Complete the synthetic inspection payload required by the deterministic verifier.
update public.evidence
set payload = payload || '{"taskId":"task-fish-oil-2026-001","reportBatchId":"FO-2026-001","logisticsGapHours":2,"signatureValid":true,"coldChainGapHours":2}'::jsonb
where evidence_id = 'ev-inspection-001';
