#![cfg(test)]

extern crate std;

use crate::{
    registry_key, token_status, AssetId, Error, LexoraAccount, LexoraAccountArgs,
    TokenStatus,
};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use crate::LexoraAccountClient;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, BytesN as _},
    Address, BytesN, Env, IntoVal, String,
};

fn generate_keypair() -> SigningKey {
    SigningKey::generate(&mut OsRng)
}

fn public_key(env: &Env, signer: &SigningKey) -> BytesN<32> {
    signer.verifying_key().to_bytes().into_val(env)
}

fn asset(env: &Env, code: &str, issuer: &Address) -> AssetId {
    AssetId {
        code: String::from_str(env, code),
        issuer: issuer.clone(),
    }
}

#[contract]
struct MockSac;

#[contractimpl]
impl MockSac {
    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "XRP262")
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = ("BAL", to.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&key, &(current + amount));
    }

    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        let key = ("BAL", from.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        assert!(current >= amount);
        env.storage()
            .persistent()
            .set(&key, &(current - amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&("BAL", id))
            .unwrap_or(0)
    }
}

#[test]
fn valid_signature_is_accepted() {
    let env = Env::default();
    let signer = generate_keypair();
    let signer_public_key = public_key(&env, &signer);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key));
    let payload = BytesN::<32>::random(&env);
    let signature: BytesN<64> = signer
        .sign(payload.to_array().as_slice())
        .to_bytes()
        .into_val(&env);

    env.try_invoke_contract_check_auth::<Error>(
        &contract_id,
        &payload,
        signature.into_val(&env),
        &soroban_sdk::vec![&env],
    )
    .unwrap();
}

#[test]
fn invalid_signature_is_rejected() {
    let env = Env::default();
    let signer = generate_keypair();
    let attacker = generate_keypair();
    let signer_public_key = public_key(&env, &signer);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key));
    let payload = BytesN::<32>::random(&env);
    let signature: BytesN<64> = attacker
        .sign(payload.to_array().as_slice())
        .to_bytes()
        .into_val(&env);

    assert!(
        env.try_invoke_contract_check_auth::<Error>(
            &contract_id,
            &payload,
            signature.into_val(&env),
            &soroban_sdk::vec![&env]
        )
        .is_err()
    );
}

#[test]
fn same_code_with_different_issuers_are_distinct_registry_keys() {
    let env = Env::default();
    let signer = generate_keypair();
    let signer_public_key = public_key(&env, &signer);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key));
    let issuer_a = Address::generate(&env);
    let issuer_b = Address::generate(&env);
    let asset_a = asset(&env, "XEVA", &issuer_a);
    let asset_b = asset(&env, "XEVA", &issuer_b);

    assert_ne!(
        env.as_contract(&contract_id, || registry_key(&asset_a)),
        env.as_contract(&contract_id, || registry_key(&asset_b))
    );
}

#[test]
fn unregistered_asset_is_denied() {
    let env = Env::default();
    let signer = generate_keypair();
    let signer_public_key = public_key(&env, &signer);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key));
    let unknown_asset = asset(&env, "UNKNOWN", &Address::generate(&env));

    assert_eq!(
        env.as_contract(&contract_id, || token_status(env.clone(), unknown_asset)),
        None
    );
}

#[test]
fn attacker_signature_cannot_authorize_owner_action() {
    let env = Env::default();
    let owner = generate_keypair();
    let attacker = generate_keypair();
    let owner_public_key = public_key(&env, &owner);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&owner_public_key));
    let payload = BytesN::<32>::random(&env);
    let attacker_signature: BytesN<64> = attacker
        .sign(payload.to_array().as_slice())
        .to_bytes()
        .into_val(&env);

    assert!(
        env.try_invoke_contract_check_auth::<Error>(
            &contract_id,
            &payload,
            attacker_signature.into_val(&env),
            &soroban_sdk::vec![&env]
        )
        .is_err()
    );
}

#[test]
fn registration_requires_lexora_authorization() {
    let env = Env::default();
    let signer = generate_keypair();
    let signer_public_key = public_key(&env, &signer);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key));
    let asset = asset(&env, "XEVA", &Address::generate(&env));
    let client = LexoraAccountClient::new(&env, &contract_id);

    env.mock_auths(&[]);
    assert!(client.try_register_token(&asset).is_err());
}

#[test]
fn authorized_registration_succeeds() {
    let env = Env::default();
    let signer = generate_keypair();
    let signer_public_key = public_key(&env, &signer);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key));
    let asset = asset(&env, "XEVA", &Address::generate(&env));
    let client = LexoraAccountClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.register_token(&asset);
    assert_eq!(client.token_status(&asset), Some(TokenStatus::Active));
}

#[test]
fn authorized_disabling_succeeds() {
    let env = Env::default();
    let signer = generate_keypair();
    let signer_public_key = public_key(&env, &signer);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key));
    let asset = asset(&env, "XEVA", &Address::generate(&env));
    let client = LexoraAccountClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.register_token(&asset);
    client.disable_token(&asset);
    assert_eq!(client.token_status(&asset), Some(TokenStatus::Disabled));
}

#[test]
fn registry_administration_requires_authorization() {
    let env = Env::default();
    let signer = generate_keypair();
    let signer_public_key = public_key(&env, &signer);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key));
    let asset = asset(&env, "XEVA", &Address::generate(&env));
    let client = LexoraAccountClient::new(&env, &contract_id);

    env.mock_auths(&[]);
    assert!(client.try_register_token(&asset).is_err());
    assert!(client.try_disable_token(&asset).is_err());
}

#[test]
fn unknown_asset_is_denied() {
    let env = Env::default();
    let signer = generate_keypair();
    let signer_public_key = public_key(&env, &signer);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key));
    let client = LexoraAccountClient::new(&env, &contract_id);
    let asset = asset(&env, "UNKNOWN", &Address::generate(&env));

    assert!(!client.is_token_allowed(&asset));
}

#[test]
fn active_asset_is_allowed() {
    let env = Env::default();
    let signer = generate_keypair();
    let signer_public_key = public_key(&env, &signer);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key));
    let client = LexoraAccountClient::new(&env, &contract_id);
    let asset = asset(&env, "XEVA", &Address::generate(&env));

    env.mock_all_auths();
    client.register_token(&asset);

    assert!(client.is_token_allowed(&asset));
}

#[test]
fn disabled_asset_is_denied() {
    let env = Env::default();
    let signer = generate_keypair();
    let signer_public_key = public_key(&env, &signer);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key));
    let client = LexoraAccountClient::new(&env, &contract_id);
    let asset = asset(&env, "XEVA", &Address::generate(&env));

    env.mock_all_auths();
    client.register_token(&asset);
    client.disable_token(&asset);

    assert!(!client.is_token_allowed(&asset));
}

#[test]
fn xeva_asset_registration_works_through_generic_registry() {
    let env = Env::default();
    let signer = generate_keypair();
    let signer_public_key = public_key(&env, &signer);
    let contract_id =
        env.register(LexoraAccount, LexoraAccountArgs::__constructor(&signer_public_key));
    let client = LexoraAccountClient::new(&env, &contract_id);
    let xeva = asset(&env, "XEVA", &Address::generate(&env));

    env.mock_all_auths();
    client.register_token(&xeva);

    assert_eq!(client.token_status(&xeva), Some(TokenStatus::Active));
    assert!(client.is_token_allowed(&xeva));
}

#[test]
fn xrp262_policy_enforces_supply_ceiling() {
    let env = Env::default();
    let signer = generate_keypair();
    let key = public_key(&env, &signer);
    let id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&key));
    let client = LexoraAccountClient::new(&env, &id);

    env.mock_all_auths();
    client.configure_xrp262_policy(&1_000);

    assert!(client.can_mint_xrp262(&1_000));
    assert!(!client.can_mint_xrp262(&1_001));
}

#[test]
fn xrp262_policy_can_pause_minting() {
    let env = Env::default();
    let signer = generate_keypair();
    let key = public_key(&env, &signer);
    let id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&key));
    let client = LexoraAccountClient::new(&env, &id);

    env.mock_all_auths();
    client.configure_xrp262_policy(&1_000);
    client.set_xrp262_paused(&true);

    assert!(!client.can_mint_xrp262(&1));
}

#[test]
fn strategy_can_be_authorized_and_disabled() {
    let env = Env::default();
    let signer = generate_keypair();
    let key = public_key(&env, &signer);
    let id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&key));
    let client = LexoraAccountClient::new(&env, &id);
    let strategy = Address::generate(&env);

    env.mock_all_auths();
    client.authorize_strategy(&strategy, &500, &100);
    assert!(client.strategy_record(&strategy).unwrap().active);
    client.disable_strategy(&strategy);
    assert!(!client.strategy_record(&strategy).unwrap().active);
}

#[test]
fn xrp262_sac_can_be_configured_once() {
    let env = Env::default();
    let signer = generate_keypair();
    let key = public_key(&env, &signer);
    let id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&key));
    let sac = env.register(MockSac, ());

    let client = LexoraAccountClient::new(&env, &id);
    env.mock_all_auths();
    client.configure_xrp262_sac(&sac);

    assert_eq!(client.xrp262_sac(), Some(sac.clone()));
    assert!(client.try_configure_xrp262_sac(&sac).is_err());
}

#[test]
fn xrp262_sac_mint_is_enforced_and_accounted() {
    let env = Env::default();
    let signer = generate_keypair();
    let key = public_key(&env, &signer);
    let id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&key));
    let sac = env.register(MockSac, ());
    let recipient = Address::generate(&env);
    let client = LexoraAccountClient::new(&env, &id);

    env.mock_all_auths();
    client.configure_xrp262_policy(&1_000);
    client.configure_xrp262_sac(&sac);
    client.mint_xrp262(&recipient, &400);

    let sac_client = MockSacClient::new(&env, &sac);
    assert_eq!(sac_client.balance(&recipient), 400);
    let policy = client.xrp262_policy().unwrap();
    assert_eq!(policy.minted, 400);
    assert_eq!(policy.burned, 0);
}

#[test]
fn xrp262_sac_burn_is_enforced_and_accounted() {
    let env = Env::default();
    let signer = generate_keypair();
    let key = public_key(&env, &signer);
    let id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&key));
    let sac = env.register(MockSac, ());
    let client = LexoraAccountClient::new(&env, &id);

    env.mock_all_auths();
    client.configure_xrp262_policy(&1_000);
    client.configure_xrp262_sac(&sac);

    let lexora = id.clone();
    client.mint_xrp262(&lexora, &600);
    client.burn_xrp262(&250);

    let sac_client = MockSacClient::new(&env, &sac);
    assert_eq!(sac_client.balance(&lexora), 350);

    let policy = client.xrp262_policy().unwrap();
    assert_eq!(policy.minted, 600);
    assert_eq!(policy.burned, 250);
}

#[test]
fn xrp262_policy_cannot_be_reinitialized() {
    let env = Env::default();
    let signer = generate_keypair();
    let key = public_key(&env, &signer);
    let id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&key));
    let client = LexoraAccountClient::new(&env, &id);

    env.mock_all_auths();
    client.configure_xrp262_policy(&1_000);

    assert!(client.try_configure_xrp262_policy(&2_000).is_err());
}
