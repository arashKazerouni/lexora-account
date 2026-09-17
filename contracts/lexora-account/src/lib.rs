#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    BytesN, Env, Vec,
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
        env.storage().instance().get(&OWNER).unwrap()
    }
}

#[contractimpl]
impl CustomAccountInterface for LexoraAccount {
    type Error = Error;
    type Signature = BytesN<64>;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: BytesN<64>,
        _auth_context: Vec<Context>,
    ) -> Result<(), Error> {
        let public_key: BytesN<32> = env.storage().instance().get(&OWNER).unwrap();

        env.crypto().ed25519_verify(
            &public_key,
            &signature_payload.into(),
            &signature,
        );

        Ok(())
    }
}

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    InvalidSignature = 1,
}

#[cfg(test)]
mod test;
