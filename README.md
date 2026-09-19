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
