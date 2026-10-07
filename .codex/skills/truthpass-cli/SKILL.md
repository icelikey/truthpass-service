---
name: truthpass-cli
description: Use the TruthPass CLI to inspect the fish-oil demo, run deterministic verification, and create a safe offline chain-anchor plan.
---

# TruthPass CLI

Use the repository CLI as the single scripted entry point for the fish-oil demo.

## Start safely

Run `npm install` once, then check the local runtime:

```bash
npm run truthpass -- doctor --json
```

The doctor output must be treated as the source of truth for fixture mode, JEV availability, and chain submission status. The current CLI uses `demo/synthetic` data and does not submit transactions.

## Read and verify

```bash
npm run truthpass -- discover --batch FO-2026-001 --json
npm run truthpass -- verify --batch FO-2026-001 --json
npm run truthpass -- explain --batch FO-2026-001
```

`verify` reuses the repository `ServiceRegistry` and deterministic verifier. Do not replace an `accepted` result with a model-generated conclusion. Read `reasons`, `ranking`, `dataClass`, and `nextAction` together.

## Chain boundary

Only create an offline plan until a deployed TruthPass contract, role addresses, and a trusted signer have been recorded:

```bash
npm run truthpass -- anchor --batch FO-2026-001 --dry-run --network testnet --json
```

The plan status `prepared_offline_not_submitted` is expected before deployment. Do not remove `--dry-run` or add secrets to the repository. Once a real chain writer is implemented, require receipt and event verification before showing `anchored`.

