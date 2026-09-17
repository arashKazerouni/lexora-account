# General Token-Security Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing LEXORA Soroban custom account into a general token-security registry with owner-authorized administration, issuer-aware asset identity, active/disabled policy state, deny-by-default checks, and XEVA registration through the generic path.

**Architecture:** Keep `LexoraAccount` as a Soroban `CustomAccountInterface` contract account. Registry administration will call `require_auth` on the LEXORA contract address so authorization flows through the existing custom-account Ed25519 verifier; registry records will be persisted in contract storage and keyed by an issuer-aware asset identity. The first policy is deliberately binary: registered-and-active versus denied; richer controls remain outside this milestone.

**Tech Stack:** Rust 2021, Soroban SDK 27, Stellar CLI build, host-side Soroban testutils, existing `ed25519-dalek` test dependency.

**Spec:** `docs/superpowers/specs/2026-09-17-general-token-security-registry-design.md`

## Global Constraints

- Keep `soroban-sdk = "27"` unless a verified API incompatibility requires a separately approved migration.
- Preserve `CustomAccountInterface` as the authentication boundary; do not add an application-level signature scheme.
- Asset identity must contain both token code and issuer address; code alone is never a registry key.
- Unknown assets are denied by default.
- Disabled assets are denied.
- XEVA must use the same generic registry functions as future assets; no XEVA-only branch in contract logic.
- Do not implement transfers, AMMs, trading, price oracles, discovery UI, reputation scoring, or owner rotation in this milestone.
- Do not claim registry membership makes an underlying token intrinsically safe.
- Use `cargo test -p lexora-account` for host tests and `stellar contract build --package lexora-account` for the WASM build.
- Do not deploy this milestone to Mainnet.

---

### Task 1: Define registry data types and storage model

**Files:**
- Modify: `contracts/lexora-account/src/lib.rs`
- Test: `contracts/lexora-account/src/test.rs`

**Interfaces:**
- Produce `AssetId { code: String, issuer: Address }` as a Soroban `#[contracttype]` key type.
- Produce `TokenStatus` with `Active` and `Disabled` states as a Soroban contract type.
- Produce `TokenRecord { status: TokenStatus, registered_at: u64 }` as the persisted registry value.
- Produce a deterministic persistent-storage key for each `AssetId`.
- Preserve the existing `owner(env: Env) -> BytesN<32>` interface.

- [ ] **Step 1: Write the failing type/storage tests**

Add tests that construct two `AssetId` values with the same code but different issuer addresses and assert they are treated as distinct registry keys. Add a test that a newly constructed contract has no record for an arbitrary asset and therefore reports it as denied.

The test setup should continue using the existing `Env::default()` and `LexoraAccountArgs::__constructor(...)` pattern from `contracts/lexora-account/src/test.rs`.

- [ ] **Step 2: Run the focused tests**

Run:

```sh
cargo test -p lexora-account
```

Expected: the new tests fail because `AssetId`, registry lookup, and policy-query interfaces do not yet exist.

- [ ] **Step 3: Implement the minimal registry types and storage helpers**

Use `#[contracttype]` for the persisted structures. Use persistent storage for token records so registry entries are independent records rather than one growing instance value. Store the record under a namespaced key containing `AssetId`; do not derive the key from code alone.

- [ ] **Step 4: Run the tests again**

Run:

```sh
cargo test -p lexora-account
```

Expected: the new identity/storage tests pass while the existing signature tests remain passing.

- [ ] **Step 5: Commit**

```sh
git add contracts/lexora-account/src/lib.rs contracts/lexora-account/src/test.rs
git commit -m "feat: define generic token registry types"
```

---

### Task 2: Put registry administration behind the LEXORA authorization boundary

**Files:**
- Modify: `contracts/lexora-account/src/lib.rs`
- Test: `contracts/lexora-account/src/test.rs`

**Interfaces:**
- Produce `register_token(env: Env, asset: AssetId) -> ()`.
- Produce `disable_token(env: Env, asset: AssetId) -> ()`.
- Produce `token_status(env: Env, asset: AssetId) -> TokenStatus` or an equivalent explicit denied/unregistered query result.
- Produce an internal `require_owner_auth(env: &Env)` helper that invokes authorization for `env.current_contract_address()`; it must not accept a caller-supplied signature.

- [ ] **Step 1: Write the failing authorization/administration tests**

Add tests proving that registration and disabling require authorization, while preserving the direct `__check_auth` tests for valid and invalid Ed25519 signatures. Use the Soroban SDK 27 authorization test utilities to exercise contract-account authorization rather than introducing a second signature mechanism. Where policy-only tests need to bypass host authorization setup, use the SDK test mock only for that isolated policy test and keep at least one end-to-end custom-account authorization test.

The tests must specifically distinguish the stored owner key from an attacker key and must fail if an attacker can perform registry administration.

- [ ] **Step 2: Run the tests to verify the new cases fail**

Run:

```sh
cargo test -p lexora-account
```

Expected: the new administration tests fail because registry methods and owner authorization do not exist.

- [ ] **Step 3: Implement owner-gated administration**

Inside `register_token` and `disable_token`, call the internal owner-auth helper before mutating persistent storage. The helper must authorize the LEXORA contract address, allowing the Soroban host to route authentication through `CustomAccountInterface::__check_auth` and the stored Ed25519 owner key.

Do not expose `__check_auth` as an ordinary administrative entry point and do not accept `BytesN<64>` signatures in registry methods.

- [ ] **Step 4: Run the full crate tests**

Run:

```sh
cargo test -p lexora-account
```

Expected: valid owner authorization succeeds, attacker authorization fails, and all existing signature tests remain passing.

- [ ] **Step 5: Commit**

```sh
git add contracts/lexora-account/src/lib.rs contracts/lexora-account/src/test.rs
git commit -m "feat: authorize registry administration through contract account"
```

---

### Task 3: Implement deny-by-default active/disabled policy

**Files:**
- Modify: `contracts/lexora-account/src/lib.rs`
- Test: `contracts/lexora-account/src/test.rs`

**Interfaces:**
- Produce a policy query with explicit semantics: absent record => denied, `Active` => allowed, `Disabled` => denied.
- Keep registration and disabling owner-gated.

- [ ] **Step 1: Write the policy behavior tests**

Add tests for these exact cases:

```text
unregistered asset -> denied
registered active asset -> allowed
registered disabled asset -> denied
```

Add a same-code/different-issuer test showing that registering issuer A does not authorize issuer B.

- [ ] **Step 2: Run the focused policy tests**

Run:

```sh
cargo test -p lexora-account
```

Expected: the new policy tests fail until the lookup semantics are implemented.

- [ ] **Step 3: Implement the minimal policy lookup**

Read the persistent `TokenRecord` by the complete `AssetId`. Treat missing records as denied without creating storage. Treat only `TokenStatus::Active` as allowed. Treat `Disabled` as denied.

Do not make policy depend on token code, issuer reputation, price, liquidity, or any external source.

- [ ] **Step 4: Run all host tests**

Run:

```sh
cargo test -p lexora-account
```

Expected: all authorization and policy tests pass.

- [ ] **Step 5: Commit**

```sh
git add contracts/lexora-account/src/lib.rs contracts/lexora-account/src/test.rs
git commit -m "feat: add deny-by-default token policy"
```

---

### Task 4: Register XEVA through the generic registry path

**Files:**
- Modify: `contracts/lexora-account/src/test.rs`
- Modify: `README.md` only if the implementation changes the documented milestone wording

**Interfaces:**
- No XEVA-specific contract function is permitted.
- XEVA is represented only as an `AssetId { code: "XEVA", issuer: <XEVA issuer address> }` passed to the generic registration/query functions.

- [ ] **Step 1: Add the XEVA generic-path test**

Use the known XEVA issuer address from the project requirements and construct an `AssetId` with code `XEVA`. Register it through `register_token`, then assert the generic policy query returns active. Also construct a different issuer with the same `XEVA` code and assert it remains denied.

- [ ] **Step 2: Run the test**

Run:

```sh
cargo test -p lexora-account xeva
```

Expected: the test passes without any contract code containing an XEVA-specific conditional.

- [ ] **Step 3: Review the contract for XEVA-specific branches**

Search the implementation for `XEVA` and verify that any occurrence is confined to tests/documentation. The production contract must contain no special issuer, code, or behavior for XEVA.

- [ ] **Step 4: Run the full test suite**

Run:

```sh
cargo test -p lexora-account
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add contracts/lexora-account/src/test.rs README.md
git commit -m "test: register XEVA through generic registry"
```

---

### Task 5: Build verification and security-boundary review

**Files:**
- Modify: `README.md` only if needed to accurately describe the completed milestone.
- No contract behavior changes are allowed during this verification task unless a failing build/test identifies a concrete defect from Tasks 1-4.

**Interfaces:**
- Final contract exports remain limited to the generic owner/registry/policy interfaces defined above plus the required Soroban custom-account hook.

- [ ] **Step 1: Run the complete host test suite**

Run:

```sh
cargo test
```

Expected: every workspace test passes.

- [ ] **Step 2: Build the contract using the required Stellar CLI path**

Run:

```sh
stellar contract build --package lexora-account
```

Expected: the contract builds successfully for the Stellar WASM target.

- [ ] **Step 3: Review the security invariants manually**

Confirm all of the following from the final code:

1. registry administration calls owner authorization;
2. `__check_auth` remains the Soroban custom-account authentication boundary;
3. missing registry entries are denied;
4. disabled entries are denied;
5. registry keys contain both code and issuer;
6. XEVA has no production-code special case;
7. no owner rotation endpoint was introduced accidentally;
8. no real asset transfer/trading capability was added in this milestone.

- [ ] **Step 4: Verify CI configuration still runs the crate tests**

Confirm `.github/workflows/test.yml` still executes `cargo test -p lexora-account` on pushes to `main` and pull requests.

- [ ] **Step 5: Commit any documentation-only correction**

If README wording is stale, update it and commit:

```sh
git add README.md
git commit -m "docs: describe token registry milestone"
```

Otherwise, make no unnecessary commit.

---

## Plan self-review

**Spec coverage:** owner authorization, generic issuer-aware registry, active/disabled state, deny-by-default policy, XEVA through the generic path, and security-focused tests are covered by Tasks 1-5. Transfers, trading, AMMs, discovery, reputation, oracle logic, and owner rotation remain outside scope.

**Type consistency:** `AssetId`, `TokenStatus`, and `TokenRecord` are introduced in Task 1 and consumed by Tasks 2-4. Registry functions are defined in Task 2 and consumed by the policy and XEVA tests in Tasks 3-4.

**Security review constraint:** the plan deliberately does not create an owner-rotation method. The specification requires rotation to be safe once introduced; implementing it is a separate milestone with its own design and tests.

**No placeholders:** each task identifies files, interfaces, test/build commands, expected outcomes, and concrete implementation constraints.
