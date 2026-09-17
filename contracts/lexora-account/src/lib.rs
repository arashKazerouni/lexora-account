#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl, contracttype,
    crypto::Hash,
    Address, BytesN, Env, String, Vec,
};

#[contract]
pub struct LexoraAccount;

const OWNER: &str = "OWNER";

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetId {
    pub code: String,
    pub issuer: Address,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TokenStatus {
    Active,
    Disabled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenRecord {
    pub status: TokenStatus,
    pub registered_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum RegistryKey {
    Token(AssetId),
}

fn registry_key(asset: &AssetId) -> RegistryKey {
    RegistryKey::Token(asset.clone())
}

fn token_status(env: Env, asset: AssetId) -> Option<TokenStatus> {
    env.storage()
        .persistent()
        .get(&registry_key(&asset))
        .map(|record: TokenRecord| record.status)
}

fn require_owner_auth(env: &Env) {
    env.current_contract_address().require_auth();
}

#[contractimpl]
impl LexoraAccount {
    pub fn __constructor(env: Env, public_key: BytesN<32>) {
        env.storage().instance().set(&OWNER, &public_key);
    }

    pub fn owner(env: Env) -> BytesN<32> {
        env.storage().instance().get(&OWNER).unwrap()
    }

    pub fn register_token(env: Env, asset: AssetId) {
        require_owner_auth(&env);

        let record = TokenRecord {
            status: TokenStatus::Active,
            registered_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&registry_key(&asset), &record);
    }

    pub fn disable_token(env: Env, asset: AssetId) {
        require_owner_auth(&env);

        let key = registry_key(&asset);
        let mut record: TokenRecord = env.storage().persistent().get(&key).unwrap();
        record.status = TokenStatus::Disabled;

        env.storage().persistent().set(&key, &record);
    }

    pub fn token_status(env: Env, asset: AssetId) -> Option<TokenStatus> {
        token_status(env, asset)
    }

    pub fn is_token_allowed(env: Env, asset: AssetId) -> bool {
        matches!(token_status(env, asset), Some(TokenStatus::Active))
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
