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

Do not deploy this contract to Mainnet yet. The authentication layer must be tested and security-reviewed before holding or controlling real assets.
