# XRP262 Control Specification v1

## Status
Approved architecture. Implementation phase. No XRP262 mainnet admin transfer is authorized by this phase.

## Scope
LEXORA is the policy/controller layer for XRP262. The native XRP262 Stellar Asset Contract remains the token primitive.

## Components
- XRP262 classic Stellar asset
- XRP262 native SAC: CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6
- LEXORA Policy Core
- Strategy Registry
- Treasury module (future)
- Emergency controls
- Governance (future)

## v1 policy state
- max_supply: hard policy ceiling; numerical value is configured explicitly, not hard-coded.
- minted: accounting counter reserved for future SAC mint integration.
- burned: accounting counter reserved for future SAC burn integration.
- minting_enabled: global mint switch.
- clawback_enabled: defaults to false.
- paused: emergency protocol pause for new mint authorization.

## Strategy permissions
Each strategy has an active/inactive state, maximum XRP262 allocation, and spending limit. Strategies are registered and disabled by LEXORA administrative authority. Strategy execution against the SAC is deliberately deferred until the policy layer is tested.

## Security invariants
1. No arbitrary user can mint through LEXORA.
2. Mint authorization is denied while paused or minting is disabled.
3. Proposed minting cannot exceed max_supply after accounting for burns.
4. Negative supply and strategy limits are rejected.
5. Strategy addresses must be explicitly authorized.
6. Clawback is disabled by default.
7. SAC admin transfer is deferred until testnet integration and adversarial tests pass.
8. No mainnet XRP262 state-changing transaction is part of this phase.

## Deferred phases
1. Connect policy authorization to the XRP262 SAC.
2. Add treasury controls.
3. Add strategy execution and accounting updates.
4. Test SAC admin transfer on testnet.
5. Security review and failure-mode testing.
6. Only then consider mainnet SAC admin transfer.
