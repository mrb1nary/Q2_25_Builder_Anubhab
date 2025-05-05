use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub proposal: Pubkey,
    pub total_funds: u64,
    pub bump: u8,
}
