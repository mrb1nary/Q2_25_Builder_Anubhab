use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Vote {
    pub validator: Pubkey, // 32 bytes
    pub milestone: Pubkey, // 32 bytes
    pub voted_at: i64,     // 8 bytes
    pub approved: bool,    // 1 byte
}
