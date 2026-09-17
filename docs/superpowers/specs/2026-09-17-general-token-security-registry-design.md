# LEXORA General Token-Security Registry Design

**Date:** 2026-09-17
**Status:** Approved architectural direction; implementation not started

## Goal

Define LEXORA as a general-purpose Soroban contract-account authorization and token-policy layer for Stellar assets. XEVA is the first registered asset, but the security model must not contain XEVA-specific assumptions.

## Problem

A Stellar asset can exist independently of LEXORA. LEXORA therefore must not claim that it changes an asset's issuer or makes the underlying token intrinsically safe. Its value is a verifiable authorization and policy boundary around supported asset operations.

The current contract already establishes the basic contract-account pattern: an owner public key is stored in instance storage and `CustomAccountInterface::__check_auth` verifies an Ed25519 signature. The registry architecture extends this foundation with explicit ownership, token registration, policy state, and deny-by-default authorization.

## Architecture

```text
                         LEXORA
                           |
              +------------+------------+
              |                         |
        Owner / Authority         Token Registry
              |                         |
              |              +----------+----------+
              |              |                     |
              |             XEVA                Future assets
              |              |                     |
              +-------- Authorization + Policy ----+
```

### 1. Contract account and owner

LEXORA is a Soroban contract account. A designated owner/authority controls administrative registry operations through Soroban authorization.

The owner is represented by a public key stored by the contract. Authentication must be performed through the Soroban custom-account authorization interface rather than through an ad-hoc application-level signature scheme.

The initial implementation must not introduce an unsafe owner replacement path. Owner rotation is a separate controlled capability and must require authorization from the current owner.

### 2. General token registry

The registry is asset-agnostic. A token entry is identified by the Stellar asset identity, including its code and issuer, rather than by code alone.

Each registered asset has at minimum:

- asset identity
- registration status
- policy state
- registration metadata needed for deterministic contract behavior

The first supported entry is XEVA. XEVA is test data for the generic mechanism, not a special case in contract logic.

### 3. Deny-by-default policy

The contract must treat unknown assets as unauthorized.

```text
Unregistered asset -> DENIED
Registered + active -> evaluated against policy
Registered + disabled -> DENIED
```

No token operation may implicitly become authorized merely because an asset exists on Stellar.

### 4. Policy layer

The first policy layer should be intentionally small. It establishes whether an asset is active and therefore eligible for the relevant LEXORA-controlled operation.

The architecture must leave room for future policy dimensions such as:

- operation-specific permissions
- spending limits
- additional authorization requirements
- emergency disable controls
- timelocks or delegated authorization

These are future extensions, not requirements for the first registry milestone.

### 5. Security boundary

LEXORA does not modify an existing classic Stellar asset's issuer. A classic asset with a `G...` issuer remains that asset. LEXORA's `C...` contract account provides an independent authorization and policy layer around supported interactions.

The implementation must avoid language or behavior implying that registry membership guarantees token safety, solvency, liquidity, or issuer trustworthiness.

## Core invariants

1. Only the authorized owner can perform registry administration.
2. An unregistered asset is never treated as approved by default.
3. A disabled asset is never treated as active.
4. Asset identity must include issuer information; code-only identification is insufficient.
5. XEVA must use the same registry path as every future token.
6. Authentication must use Soroban's custom account authorization mechanism.
7. Owner rotation, once introduced, cannot be initiated by an unauthorized party.
8. Registry state must be deterministic and persist in contract storage.

## Required security tests

Before connecting real asset operations, tests must demonstrate at least:

- valid owner authorization succeeds
- invalid/unauthorized signer fails
- unregistered asset is rejected
- registered active asset is accepted by the registry policy
- disabled asset is rejected
- asset identity distinguishes the same code issued by different issuers
- unauthorized owner rotation fails, once rotation is implemented
- authorized owner rotation succeeds, once rotation is implemented

Tests should exercise the actual contract authorization path and should not rely solely on helper functions that bypass it.

## Scope of first implementation milestone

The first milestone consists of:

1. a stable owner/authority model
2. a generic asset registry
3. active/disabled registry state
4. deny-by-default checks
5. XEVA registration through the generic path
6. security-focused unit tests

Actual XEVA transfers, trading, AMM integration, discovery UI, reputation scoring, and richer risk analysis are outside this milestone.

## Non-goals

- changing XEVA's Stellar issuer
- declaring any token universally safe
- implementing a token exchange
- implementing a price oracle
- automatically trusting arbitrary Stellar assets
- building a frontend before the contract security boundary is established

## Success criteria

The milestone is successful when the contract can prove, through tests, that LEXORA distinguishes authorized administration, registered assets, active policy state, and denied/default state without any XEVA-specific security shortcut.

Only after this contract boundary is tested should real XEVA operations be added.
