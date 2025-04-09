use anchor_lang::prelude::*;


pub mod instructions;
pub mod state;

pub use instructions::*;
pub use state::*;
declare_id!("4jgzJnuUTTuU4HcgP9xCGkKeVTbzs2CrGxdTS8b7LzAe");

#[program]
pub mod escrow_class {
    use super::*;

    pub fn make(ctx: Context<Make>, seed:u64, deposit: u64, receive:u64) -> Result<()> {
        ctx.accounts.deposit(deposit);
        ctx.accounts.init_escrow(seed, receive, bumps);
        
    }
}

#[derive(Accounts)]
pub struct Initialize {

}
