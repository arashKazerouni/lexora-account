# XRP262 Mint Plan

## Mainnet checkpoint

XRP262 is fully configured for controlled minting, but no XRP262 has been minted yet.

Verified state:

- LEXORA: `CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542`
- XRP262 issuer: `GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP`
- XRP262 SAC: `CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6`
- Max supply: 900,000,000,000 XRP262
- Decimals: 7
- SAC admin: LEXORA
- Policy: minting enabled, unpaused, clawback disabled
- Registry: Active / allowed
- Minted: 0
- Burned: 0
- LEXORA XRP262 balance: 0

## Required order

1. Choose the exact genesis mint amount.
2. Choose the exact recipient address.
3. Run the read-only preflight:
   `node verify-xrp262-pre-mint-mainnet.mjs`
4. Review every PASS and the planned recipient/amount.
5. Only then execute the guarded mint script:
   `node mint-xrp262-mainnet.mjs`
6. Verify the resulting transaction, policy accounting, SAC recipient balance, and StellarExpert/indexer state.
7. Record the mint transaction as the next XRP262 checkpoint.

## Environment

Preflight requires:

- `LEXORA_DEPLOYER_SECRET`
- `XRP262_MINT_AMOUNT` in base units

Mint requires:

- `LEXORA_DEPLOYER_SECRET`
- `LEXORA_OWNER_SECRET`
- `XRP262_MINT_AMOUNT` in base units
- `XRP262_MINT_RECIPIENT`
- `CONFIRM_XRP262_MAINNET_MINT=YES`

Never commit secrets.

## Safety properties

The mint script refuses to execute unless:

- the on-chain Lexora owner is the expected owner;
- the supplied owner secret matches that owner;
- the configured SAC is the expected XRP262 SAC;
- SAC admin is Lexora;
- minting is enabled and not paused;
- the genesis policy still has minted=0 and burned=0;
- the amount is within the policy max supply;
- Lexora's `can_mint_xrp262` accepts the amount;
- Soroban simulation succeeds;
- the Lexora authorization entry is signed and ready.

After execution it verifies policy accounting and the recipient's SAC balance.
