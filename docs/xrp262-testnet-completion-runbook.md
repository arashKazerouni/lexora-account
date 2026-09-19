# XRP262 Testnet Completion Runbook

Current testnet LEXORA:
- Contract: CCKK2FG7LZEDCEQZPRGVDEBIYYVIDFYSOZMO24BY54X6HSQUVOKO6UWR
- WASM: ec2c04a1c71b378d7f237bfa0fad08c9556a02f2c53389d562e84cdf6f325985
- Constructor owner public key: 8d8b4a1ee1719716095f0eb8aa25943c6235c0dd0cde03348cb9a1f674308aec

XRP262T testnet SAC:
- SAC: CBQZU2IXARXJVH5HCJ3PBZ7KZUXK3Z3HYJSOEFQWWHS2VJ66CDHOLKQB
- Issuer/current initial admin: GCGYWSQ64FYZOFQJL4HLRKRFSQ6GENOA3UGN4AZURS42D5TUGCFOZLD
- Asset code: XRP262T
- Decimals: 7

## 1. Configure LEXORA policy

The policy is a one-time initialization. The current testnet target is 10,000,000 minimal units.

```bash
LEXORA_TESTNET=CCKK2FG7LZEDCEQZPRGVDEBIYYVIDFYSOZMO24BY54X6HSQUVOKO6UWR node configure-xrp262-policy-testnet.mjs
```

Verify:
```bash
stellar contract invoke --network testnet \
  --source-account xrp262-test-issuer \
  --id CCKK2FG7LZEDCEQZPRGVDEBIYYVIDFYSOZMO24BY54X6HSQUVOKO6UWR -- \
  xrp262_policy
```

## 2. Bind the real XRP262T SAC

```bash
LEXORA_TESTNET=CCKK2FG7LZEDCEQZPRGVDEBIYYVIDFYSOZMO24BY54X6HSQUVOKO6UWR \
node configure-xrp262-sac-testnet.mjs
```

Verify:
```bash
stellar contract invoke --network testnet \
  --source-account xrp262-test-issuer \
  --id CCKK2FG7LZEDCEQZPRGVDEBIYYVIDFYSOZMO24BY54X6HSQUVOKO6UWR -- \
  xrp262_sac
```

Expected SAC:
`CBQZU2IXARXJVH5HCJ3PBZ7KZUXK3Z3HYJSOEFQWWHS2VJ66CDHOLKQB`

## 3. Verify the SAC before admin transfer

```bash
stellar contract invoke --network testnet \
  --source-account xrp262-test-issuer \
  --id CBQZU2IXARXJVH5HCJ3PBZ7KZUXK3Z3HYJSOEFQWWHS2VJ66CDHOLKQB -- \
  symbol

stellar contract invoke --network testnet \
  --source-account xrp262-test-issuer \
  --id CBQZU2IXARXJVH5HCJ3PBZ7KZUXK3Z3HYJSOEFQWWHS2VJ66CDHOLKQB -- \
  admin
```

Expected:
- symbol = XRP262T
- admin = GCGYWSQ64FYZOFQJL4HLRKRFSQ6GENOA3UGN4AZURS42D5TUGCFOZLD

## 4. Transfer SAC admin to LEXORA

This is the first irreversible architecture transition in the testnet flow. It is intentionally NOT automated by GitHub.

After confirming steps 1-3, invoke:

```bash
stellar contract invoke --network testnet \
  --source-account xrp262-test-issuer \
  --id CBQZU2IXARXJVH5HCJ3PBZ7KZUXK3Z3HYJSOEFQWWHS2VJ66CDHOLKQB -- \
  set_admin \
  --new_admin CCKK2FG7LZEDCEQZPRGVDEBIYYVIDFYSOZMO24BY54X6HSQUVOKO6UWR
```

Then verify `admin` equals the LEXORA contract.

## 5. Exercise the real mint path

Use the existing owner-authorization flow, not a weakened auth path.

Required test:
1. Mint a small amount through `mint_xrp262`.
2. Verify the recipient balance on the SAC.
3. Verify LEXORA policy `minted` increased by exactly that amount.
4. Attempt a mint that exceeds the remaining policy ceiling; it must fail.
5. Pause minting and verify mint fails.
6. Re-enable minting.

Amounts are i128 minimal units. Because XRP262T has 7 decimals, 10,000,000 minimal units = 1 XRP262T.

## 6. Exercise the real burn path

After LEXORA has received XRP262T:
1. Burn a small amount through `burn_xrp262`.
2. Verify the LEXORA SAC balance decreased.
3. Verify policy `burned` increased by exactly that amount.
4. Attempt to burn more than `minted`; it must fail.

## 7. Strategy layer

Strategy authorization/disable tests already exist locally. Actual strategy execution is intentionally NOT implemented yet. Do not mark testnet complete until strategy execution semantics are specified and tested.

## 8. Security/failure-mode checks before mainnet

Required:
- invalid owner signature rejected
- non-owner authorization rejected
- policy/SAC initialization cannot repeat
- wrong SAC symbol rejected
- negative limits rejected
- paused mint rejected
- disabled mint rejected
- max-supply ceiling enforced
- mint accounting changes only after successful SAC mint
- burn accounting changes only after successful SAC burn
- unauthorized strategy rejected/disabled
- verify SAC executable is native Stellar Asset Contract
- verify SAC admin is the intended LEXORA contract
- no mainnet admin transfer during this phase

Mainnet admin transfer remains a separate, explicit approval step after the complete testnet/security review.
