use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;

pub use instructions::*;
pub use state::*;

use instructions::Make::Make;
use instructions::Refund::Refund;
use instructions::Take::Take;

declare_id!("FwuqmE3HFFSJGj4MoFcAkdnYkD44629ZA61nbjEGSjQZ");
#[program]
pub mod escrow {
    use super::*;

    pub fn init_escrow(ctx: Context<Make>, seed: u64, deposit: u64, receive: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, receive, &ctx.bumps)?;
        ctx.accounts.deposit(deposit)?;
        Ok(())
    }

    pub fn take_offer(ctx: Context<Take>) -> Result<()> {
        ctx.accounts.take_offer()?;
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        ctx.accounts.refund()?;
        Ok(())
    }
}
