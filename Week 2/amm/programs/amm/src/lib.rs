pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("FN4dSy8BDneeYig2mnAf8Mt4TMXZbTVeWtVmdve9aa1U");

#[program]
pub mod amm {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, seed: u64, fee:u16, authority: Option<Pubkey>) -> Result<()> {
        ctx.accounts.init(seed, fee, authority, &ctx.bumps)
    }

    pub fn deposit(ctx:Context<Deposit>, amount:u64, max_x:u64,max_y:u64)->Result<()>{
        ctx.accounts.deposit(amount, max_x, max_y)
    }
}
