#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::ed25519::Sign, BytesN, Env};

#[test]
fn valid_signature_is_accepted() {
    let env = Env::default();
    let signer = Sign::generate(&env);
    let public_key: BytesN<32> = signer.public_key().into_val(&env);
    let contract_id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&public_key));

    let payload = BytesN::<32>::random(&env);
    let signature = signer.sign(&payload);

    env.try_invoke_contract_check_auth::<Error>(
        &contract_id,
        &payload,
        signature,
        &soroban_sdk::vec![&env],
    )
    .unwrap();
}

#[test]
fn invalid_signature_is_rejected() {
    let env = Env::default();
    let signer = Sign::generate(&env);
    let attacker = Sign::generate(&env);
    let public_key: BytesN<32> = signer.public_key().into_val(&env);
    let contract_id = env.register(LexoraAccount, LexoraAccountArgs::__constructor(&public_key));

    let payload = BytesN::<32>::random(&env);
    let signature = attacker.sign(&payload);

    assert!(env
        .try_invoke_contract_check_auth::<Error>(
            &contract_id,
            &payload,
            signature,
            &soroban_sdk::vec![&env],
        )
        .is_err());
}
