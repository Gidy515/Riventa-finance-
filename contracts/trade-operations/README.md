# Riventa Trade Operations Contract

Implemented source slices: initialization, buyer trade creation, supplier acceptance, buyer cancellation of unfunded trades, read-only trade/config views, and NEP-141 exact-amount funding through `ft_on_transfer`.

The receiver accepts only the configured token contract, the trade buyer, the exact fixed amount, an `Accepted` trade, an unexpired funding deadline, and a bounded JSON message containing only `trade_id`. Rejected transfers return the full amount as unused rather than panicking.

This is not the complete escrow contract. Document workflows, inspection, disputes, outgoing settlement transfers, callbacks and global liability accounting remain unimplemented.

## Build

```bash
rustup toolchain install 1.99.1 --profile minimal --component rustfmt --component clippy
rustup target add wasm32-unknown-unknown --toolchain 1.99.1
cargo +1.99.1 fmt --all -- --check
cargo +1.99.1 test -p riventa-trade-operations
cargo +1.99.1 check -p riventa-trade-operations --target wasm32-unknown-unknown
```

Slice 1 passed native tests and a WASM target check on the developer machine. Slice 2 source is authored but has not yet been compiled or tested there. Do not deploy until Slice 2 tests, sandbox transfer-resolution tests, all remaining contract tests and a security review pass.
