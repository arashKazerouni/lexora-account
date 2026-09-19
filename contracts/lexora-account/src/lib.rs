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


const XRP262_POLICY: &str = "XRP262_POLICY";

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Xrp262Policy {
    pub max_supply: i128,
    pub minted: i128,
    pub burned: i128,
    pub minting_enabled: bool,
    pub clawback_enabled: bool,
    pub paused: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyRecord {
    pub active: bool,
    pub max_allocation: i128,
    pub spending_limit: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum PolicyKey {
    Strategy(Address),
}

fn strategy_key(address: &Address) -> PolicyKey {
    PolicyKey::Strategy(address.clone())
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
    pub fn configure_xrp262_policy(env: Env, max_supply: i128) {
        require_owner_auth(&env);
        if max_supply < 0 { panic!("invalid max supply"); }
        let policy = Xrp262Policy {
            max_supply, minted: 0, burned: 0,
            minting_enabled: true, clawback_enabled: false, paused: false,
        };
        env.storage().instance().set(&XRP262_POLICY, &policy);
    }

    pub fn xrp262_policy(env: Env) -> Option<Xrp262Policy> {
        env.storage().instance().get(&XRP262_POLICY)
    }

    pub fn set_xrp262_minting_enabled(env: Env, enabled: bool) {
        require_owner_auth(&env);
        let mut policy: Xrp262Policy = env.storage().instance().get(&XRP262_POLICY).unwrap();
        policy.minting_enabled = enabled;
        env.storage().instance().set(&XRP262_POLICY, &policy);
    }

    pub fn set_xrp262_paused(env: Env, paused: bool) {
        require_owner_auth(&env);
        let mut policy: Xrp262Policy = env.storage().instance().get(&XRP262_POLICY).unwrap();
        policy.paused = paused;
        env.storage().instance().set(&XRP262_POLICY, &policy);
    }

    pub fn authorize_strategy(env: Env, strategy: Address, max_allocation: i128, spending_limit: i128) {
        require_owner_auth(&env);
        if max_allocation < 0 || spending_limit < 0 { panic!("invalid strategy limits"); }
        let record = StrategyRecord { active: true, max_allocation, spending_limit };
        env.storage().persistent().set(&strategy_key(&strategy), &record);
    }

    pub fn disable_strategy(env: Env, strategy: Address) {
        require_owner_auth(&env);
        let key = strategy_key(&strategy);
        let mut record: StrategyRecord = env.storage().persistent().get(&key).unwrap();
        record.active = false;
        env.storage().persistent().set(&key, &record);
    }

    pub fn strategy_record(env: Env, strategy: Address) -> Option<StrategyRecord> {
        env.storage().persistent().get(&strategy_key(&strategy))
    }

    pub fn can_mint_xrp262(env: Env, amount: i128) -> bool {
        if amount < 0 { return false; }
        let policy: Xrp262Policy = match env.storage().instance().get(&XRP262_POLICY) {
            Some(value) => value,
            None => return false,
        };
        policy.minting_enabled && !policy.paused
            && policy.minted.saturating_add(amount).saturating_sub(policy.burned) <= policy.max_supply
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
