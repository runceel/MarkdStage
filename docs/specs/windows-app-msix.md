# Windows MSIX cross-surface specification

- Status: Implemented
- Target: MarkdStage Desktop v4

The implementation described by the former draft specification has shipped.
Current component boundaries and invariants are documented in
[`docs/architecture.md`](../architecture.md). The decisions that produced them
remain in [ADR 0001](../adr/0001-windows-native-app-packaging-and-runtime-hosting.md),
[ADR 0002](../adr/0002-cli-current-directory-workspace.md), and
[ADR 0003](../adr/0003-packaged-cli-native-app-activation.md).

## 7. CLI execution model

The current packaged CLI execution model is documented in
[`docs/architecture.md`](../architecture.md#windows-execution-model) and the
[CLI user guide](../user-guide/cli.md).
