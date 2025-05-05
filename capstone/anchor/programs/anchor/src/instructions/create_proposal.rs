use anchor_lang::prelude::*;

use crate::{Escrow, Proposal, ProposalStatus};

#[derive(Accounts)]
#[instruction(title: String)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub researcher: Signer<'info>,

    #[account(
        init,
        payer = researcher,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [b"proposal", researcher.key().as_ref(), title.as_bytes()],
        bump,
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        init,
        payer=researcher,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", proposal.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    pub system_program: Program<'info, System>,
}

pub fn create_proposal_handler(
    ctx: Context<CreateProposal>,
    title: String,
    abstract_text: String,
    ipfs_hash: String,
    amount_asked: u64,
    total_milestones: u8,
    security_deposit: u64,
) -> Result<()> {
    //Let's get the current timestamp
    let clock = Clock::get()?;

    //Validate inputs
    require!(amount_asked > 0, ErrorCode::InvalidAmount);
    require!(total_milestones > 0, ErrorCode::InvalidMilestone);

    //Let's calculate required deposit amount
    let required_deposit = amount_asked.checked_div(10).ok_or(ErrorCode::MathOverflow);
    require!(
        security_deposit >= required_deposit?,
        ErrorCode::MoreSecurityDeposit
    );

    let proposal = &mut ctx.accounts.proposal;

    proposal.title = title;
    proposal.abstract_text = abstract_text;
    proposal.researcher = ctx.accounts.researcher.key();
    proposal.initial_security_deposit = security_deposit;
    proposal.current_security_deposit = security_deposit;
    proposal.amount_asked = amount_asked;
    proposal.amount_raised = 0;
    proposal.total_milestones = total_milestones;
    proposal.current_milestone = 0;
    proposal.ipfs_hash = ipfs_hash;
    proposal.ip_nft_mint = None;
    proposal.created_at = clock.unix_timestamp;
    proposal.updated_at = clock.unix_timestamp;
    proposal.status = ProposalStatus::Active;
    proposal.penalty_counter = 0;

    proposal.funds_escrow = ctx.accounts.escrow.key();

    let escrow = &mut ctx.accounts.escrow;
    escrow.proposal = proposal.key();
    escrow.total_funds = 0;

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Enter valid amount!")]
    InvalidAmount,

    #[msg("Enter valid milestone!")]
    InvalidMilestone,

    #[msg("Overflow Error")]
    MathOverflow,

    #[msg("Security Deposit Amount is less than expected")]
    MoreSecurityDeposit,
}
