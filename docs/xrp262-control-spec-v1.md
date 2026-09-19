# XRP262 Control Specification v1

## Status
Approved architecture. SAC integration is implemented in the LEXORA policy layer. No XRP262 mainnet admin transfer is authorized by this phase.

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
- minted: accounting counter updated only after a successful SAC mint.
- burned: accounting counter updated only after a successful SAC burn from the LEXORA contract balance.
- minting_enabled: global mint switch.
- clawback_enabled: defaults to false and is not exposed as an active control.
- paused: emergency protocol pause for new mint execution.

## SAC integration
LEXORA now stores a one-time configured XRP262 SAC address and uses the official Soroban StellarAssetClient to call:
- mint(to, amount) for policy-controlled issuance.
- burn(lexora, amount) for burning XRP262 held by the LEXORA contract.

The mint path requires LEXORA authorization, checks the policy ceiling before the SAC call, invokes the SAC, and updates accounting only after the SAC call succeeds.

The burn path requires LEXORA authorization, checks accounting limits, invokes the SAC burn against the LEXORA contract address, and updates accounting only after the SAC call succeeds.

The configured SAC is sanity-checked against an explicitly supplied expected asset code during configuration. LEXORA compares the SAC symbol to that expected code before storing the address. This is a configuration guard, not a cryptographic proof of asset provenance; the owner-controlled configuration and on-chain SAC verification remain part of deployment/testing.

## Strategy permissions
Each strategy has an active/inactive state, maximum XRP262 allocation, and spending limit. Strategies are registered and disabled by LEXORA administrative authority. Strategy execution against the SAC is still deliberately deferred until the direct mint/burn path is tested on testnet.

## Security invariants
1. No arbitrary user can mint through LEXORA.
2. Mint authorization is denied while paused or minting is disabled.
3. Proposed minting cannot exceed max_supply after accounting for burns.
4. Policy and SAC configuration are one-time initialization steps.
5. Negative supply and strategy limits are rejected.
6. Strategy addresses must be explicitly authorized.
7. Clawback is disabled by default.
8. SAC admin transfer is deferred until testnet integration and adversarial tests pass.
9. No mainnet XRP262 state-changing transaction is part of this phase.

## Deferred phases
1. Deploy the integration to testnet.
2. Exercise real testnet SAC mint/burn flows.
3. Add treasury controls.
4. Add strategy execution and accounting updates.
5. Test SAC admin transfer on testnet.
6. Security review and failure-mode testing.
7. Only then consider mainnet SAC admin transfer.
