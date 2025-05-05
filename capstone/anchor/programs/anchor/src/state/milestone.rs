use anchor_lang::prelude::*;


#[account]
#[derive(InitSpace)]
pub struct Milestone {
    pub proposal: Pubkey,         // Associated proposal
    pub milestone_number: u8,     // 1-based index
    
    // IPFS/Arweave Storage
    #[max_len(128)]
    pub evidence_hash: String,    // Researcher's evidence
    
    // Validation
    pub validation_votes: u32,    // Successful votes (rename from yes_votes)
    pub total_validators: u32,
    pub funds_released: bool,
    pub deadline: i64,           
    
    // State
    pub status: MilestoneStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum MilestoneStatus {
    Pending,
    Active,
    Validated,
    Failed,
}
