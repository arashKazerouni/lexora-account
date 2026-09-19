# LEXORA Account

LEXORA is a Soroban custom contract account designed to become the authorization layer for the LEXORA token-security ecosystem.

## Current milestone

- Single Ed25519 owner key
- Soroban `CustomAccountInterface`
- Signature verification inside `__check_auth`
- Host-side tests for valid and invalid signatures
- Ready for the next milestone: policy-aware authorization and XEVA integration

## Development

```sh
cargo test
stellar contract build
```

Mainnet deployment is now guarded by a dedicated deployment script. The deployment script requires both the expected deployer and the expected LEXORA owner, passes that owner as the constructor argument, and requires an explicit confirmation flag.\n\nNever reuse the historical mainnet contract `CCV2AE6KK5IA3EWV3VM5FNQC3NZUMVGLQBEMDFEWTAEFTLNRPVWIYSQJA`: it was deployed with the wrong owner and is intentionally rejected by the mainnet configuration scripts.\n\nDeployment order:\n1. `stellar contract build`\n2. `CONFIRM_LEXORA_MAINNET_DEPLOY=YES node deploy-lexora-mainnet.mjs`\n3. `LEXORA_MAINNET_CONTRACT=<new-contract> node verify-lexora-owner-mainnet.mjs`\n4. Only after owner verification passes, configure the XRP262 policy and SAC.\n\nThe XRP262 native SAC remains separate and deterministic; LEXORA is the policy/controller layer.


## XRP262 mainnet milestone

XRP262 is deployed and controlled by LEXORA on Stellar mainnet. The XRP262 SAC admin is LEXORA, with minting enabled, paused=false, clawback disabled, registry status Active, and current minted supply 0.

Verified mainnet identities:

- LEXORA: `CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542`
- XRP262 issuer: `GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP`
- XRP262 SAC: `CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6`

Controlled mint workflow:

1. Set `XRP262_MINT_AMOUNT` and run `npm run xrp262:pre-mint`.
2. Review the read-only PASS output.
3. Set `XRP262_MINT_RECIPIENT` and `CONFIRM_XRP262_MAINNET_MINT=YES`, then run `npm run xrp262:mint`.
4. Record the returned transaction hash.
5. Run `npm run xrp262:post-mint` with the same amount/recipient and optionally `XRP262_MINT_TX_HASH`.
6. Run `npm run xrp262:final` for the final control-state check.

No XRP262 mint transaction is executed by repository automation; the guarded mint command is intentionally run by the operator with the required secrets present locally.
