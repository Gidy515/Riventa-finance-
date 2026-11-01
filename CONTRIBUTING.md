# Contributing

1. Read `docs/DECISION-REGISTER.md` and the relevant architecture/specification before changing behavior.
2. Treat contract state as authoritative. Never implement financial authorization in the frontend or backend.
3. Every state-changing method must map to a documented transition and invariant.
4. Add unit, sandbox and adversarial tests for every authorization/accounting change.
5. Update diagrams, ADRs and decision register in the same change as any approved design change.
6. Pin dependencies and commit lockfiles. Do not commit secrets, private keys, seed phrases, document contents or production credentials.
7. No production deployment or real-value transfer is permitted under this baseline.
