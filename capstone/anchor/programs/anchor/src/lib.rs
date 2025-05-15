use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("34ZvY6k6iKFRYhcimjjr57hzc31u5vK9GbfPimSBg9W9");


#[program]
pub mod anchor {
    use super::*;

    // 1. Create Proposal
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        title: String,
        abstract_text: String,
        ipfs_hash: String,
        amount_asked: u64,
        total_milestones: u8,
        security_deposit: u64,
    ) -> Result<()> {
        create_proposal_handler(
            ctx,
            title,
            abstract_text,
            ipfs_hash,
            amount_asked,
            total_milestones,
            security_deposit,
        )
    }

    // 2. Fund Proposal
    pub fn fund_proposal(ctx: Context<FundProposal>, amount: u64) -> Result<()> {
        fund_proposal_handler(ctx, amount)
    }

    // 3. Submit Milestone
    pub fn submit_milestone(
        ctx: Context<SubmitMilestone>,
        milestone_number: u8,
        evidence_hash: String,
    ) -> Result<()> {
        submit_milestone_handler(ctx, milestone_number, evidence_hash)
    }

    // 4. Validate Milestone
    pub fn validate_milestone(ctx: Context<ValidateMilestone>, approved: bool) -> Result<()> {
        validate_milestone_handler(ctx, approved)
    }

    // 5. Release Funds
    pub fn release_funds(ctx: Context<ReleaseFunds>) -> Result<()> {
        release_funds_handler(ctx)
    }

    // 6. Apply Penalty
    pub fn apply_penalty(ctx: Context<ApplyPenalty>) -> Result<()> {
        apply_penalty_handler(ctx)
    }

    // 7. Withdraw Funds
    pub fn withdraw_funds(ctx: Context<WithdrawFunds>) -> Result<()> {
        withdraw_funds_handler(ctx)
    }

    // 8. Mint IP-NFT
    pub fn mint_ip_nft(
        ctx: Context<MintNft>,
        name: String,
        symbol: String,
        metadata_uri: String,
    ) -> Result<()> {
        mint_ip_nft_handler(ctx, name, symbol, metadata_uri)
    }

    // 9. Close Proposal
    pub fn close_proposal(ctx: Context<CloseProposal>) -> Result<()> {
        close_proposal_handler(ctx)
    }
}
