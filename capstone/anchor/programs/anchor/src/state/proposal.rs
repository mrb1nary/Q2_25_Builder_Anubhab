use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    //Metadata
    #[max_len(50)]
    pub title: String, //32 bytes
    #[max_len(250)]
    pub abstract_text: String, //128 bytes
    pub researcher: Pubkey,      //32 bytes
    pub contributors_count: u32, //4 bytes

    //Funding
    pub initial_security_deposit: u64, //8 bytes
    pub current_security_deposit: u64, //8 bytes
    pub amount_asked: u64,             //8 bytes
    pub amount_raised: u64,            //8 bytes
    pub funds_escrow: Pubkey,          //32 bytes

    //Milestones
    pub total_milestones: u8,  //1 byte
    pub current_milestone: u8, //1 byte

    //Storage
    #[max_len(128)]
    pub ipfs_hash: String, //128 bytes
    pub ip_nft_mint: Option<Pubkey>, //33 bytes(1+32)

    //Timestamps
    pub created_at: i64, //8 bytes
    pub updated_at: i64, //8 bytes

    //State of proposal
    pub status: ProposalStatus, //1 byte

    //Penalty counter
    pub penalty_counter: u8, //Penalize researcher
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum ProposalStatus {
    Draft,
    Pending,
    Active,
    Completed,
    Failed,
}
