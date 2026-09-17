#![no_std]

use soroban_sdk::{
    contract, contractimpl, BytesN, Env, Vec,
};

#[contract]
pub struct LexoraAccount;

const OWNER: &str = "OWNER";

#[contractimpl]
impl LexoraAccount {
    pub fn __constructor(env: Env, public_key: BytesN<32>) {
        env.storage().instance().set(&OWNER, &public_key);
    }

    pub fn owner(env: Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&OWNER)
            .unwrap()
    }

    #[allow(non_snake_case)]
    pub fn __check_auth(
        env: Env,
        signature_payload: BytesN<32>,
        signature: BytesN<64>,
        _auth_context: Vec<soroban_sdk::auth::Context>,
    ) {
        let public_key: BytesN<32> = env
            .storage()
            .instance()
            .get(&OWNER)
            .unwrap();

        env.crypto()
            .ed25519_verify(&public_key, &signature_payload, &signature);
    }
}

#[cfg(test)]
mod test;
