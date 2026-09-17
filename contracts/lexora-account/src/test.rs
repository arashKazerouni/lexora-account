#![cfg(test)]

extern crate std;

use crate::{
    registry_key, token_status, AssetId, Error, LexoraAccount, LexoraAccountArgs,
    LexoraAccountClient, TokenStatus,
};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, MockAuth, MockAuthInvoke},
    Address, BytesN, Env, IntoVal, String,
};

fn generate_keypair() -> SigningKey { SigningKey::generate(&mut OsRng) }
fn public_key(env: &Env, signer: &SigningKey) -> BytesN<32> { signer.verifying_key().to_bytes().into_val(env) }
fn asset(env: &Env, code: &str, issuer: &Address) -> AssetId { AssetId { code: String::from_str(env, code), issuer: issuer.clone() } }

#[test]
fn valid_signature_is_accepted() {
    let env = Env::default(); let signer = generate_keypair(); let signer_public_key = public_key(&env, &signer);
    let contract_id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key)); let payload = BytesN::<32>::random(&env);
    let signature: BytesN<64> = signer.sign(payload.to_array().as_slice()).to_bytes().into_val(&env);
    env.try_invoke_contract_check_auth::<Error>(&contract_id, &payload, signature.into_val(&env), &soroban_sdk::vec![&env]).unwrap();
}

#[test]
fn invalid_signature_is_rejected() {
    let env = Env::default(); let signer = generate_keypair(); let attacker = generate_keypair(); let signer_public_key = public_key(&env, &signer);
    let contract_id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key)); let payload = BytesN::<32>::random(&env);
    let signature: BytesN<64> = attacker.sign(payload.to_array().as_slice()).to_bytes().into_val(&env);
    assert!(env.try_invoke_contract_check_auth::<Error>(&contract_id, &payload, signature.into_val(&env), &soroban_sdk::vec![&env]).is_err());
}

#[test]
fn same_code_with_different_issuers_are_distinct_registry_keys() {
    let env = Env::default(); let signer = generate_keypair(); let signer_public_key = public_key(&env, &signer);
    let contract_id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key)); let issuer_a = Address::generate(&env); let issuer_b = Address::generate(&env);
    let asset_a = asset(&env, "XEVA", &issuer_a); let asset_b = asset(&env, "XEVA", &issuer_b);
    assert_ne!(env.as_contract(&contract_id, || registry_key(&asset_a)), env.as_contract(&contract_id, || registry_key(&asset_b)));
}

#[test]
fn unregistered_asset_is_denied() {
    let env = Env::default(); let signer = generate_keypair(); let signer_public_key = public_key(&env, &signer);
    let contract_id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key)); let unknown_asset = asset(&env, "UNKNOWN", &Address::generate(&env));
    assert_eq!(env.as_contract(&contract_id, || token_status(env.clone(), unknown_asset)), None);
}

#[test]
fn attacker_signature_cannot_authorize_owner_action() {
    let env = Env::default(); let owner = generate_keypair(); let attacker = generate_keypair(); let owner_public_key = public_key(&env, &owner);
    let contract_id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&owner_public_key)); let payload = BytesN::<32>::random(&env);
    let attacker_signature: BytesN<64> = attacker.sign(payload.to_array().as_slice()).to_bytes().into_val(&env);
    assert!(env.try_invoke_contract_check_auth::<Error>(&contract_id, &payload, attacker_signature.into_val(&env), &soroban_sdk::vec![&env]).is_err());
}

#[test]
fn registration_requires_lexora_authorization() {
    let env = Env::default(); let signer = generate_keypair(); let signer_public_key = public_key(&env, &signer);
    let contract_id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key)); let asset = asset(&env, "XEVA", &Address::generate(&env)); let client = LexoraAccountClient::new(&env, &contract_id);
    env.mock_auths(&[]); assert!(client.try_register_token(&asset).is_err());
}

#[test]
fn authorized_registration_succeeds() {
    let env = Env::default(); let signer = generate_keypair(); let signer_public_key = public_key(&env, &signer);
    let contract_id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key)); let asset = asset(&env, "XEVA", &Address::generate(&env)); let client = LexoraAccountClient::new(&env, &contract_id);
    env.mock_all_auths(); client.register_token(&asset); assert_eq!(client.token_status(&asset), Some(TokenStatus::Active));
}

#[test]
fn authorized_disabling_succeeds() {
    let env = Env::default(); let signer = generate_keypair(); let signer_public_key = public_key(&env, &signer);
    let contract_id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key)); let asset = asset(&env, "XEVA", &Address::generate(&env)); let client = LexoraAccountClient::new(&env, &contract_id);
    env.mock_all_auths(); client.register_token(&asset); client.disable_token(&asset); assert_eq!(client.token_status(&asset), Some(TokenStatus::Disabled));
}

#[test]
fn registry_administration_requires_authorization() {
    let env = Env::default(); let signer = generate_keypair(); let signer_public_key = public_key(&env, &signer);
    let contract_id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key)); let asset = asset(&env, "XEVA", &Address::generate(&env)); let client = LexoraAccountClient::new(&env, &contract_id);
    env.mock_auths(&[]); assert!(client.try_register_token(&asset).is_err()); assert!(client.try_disable_token(&asset).is_err());
}
