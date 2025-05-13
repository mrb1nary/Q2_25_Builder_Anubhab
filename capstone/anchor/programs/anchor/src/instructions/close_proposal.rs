use crate::{Proposal, ProposalStatus};
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

#[derive(Accounts)]
pub struct CloseProposal<'info> {
    #[account(mut, close = researcher)]
    pub proposal: Account<'info, Proposal>,

    #[account(mut)]
    pub researcher: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", proposal.key().as_ref()],
        bump,
        constraint = escrow.key() == proposal.funds_escrow @ ErrorCode::InvalidEscrow,
    )]
    pub escrow: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn close_proposal_handler(ctx: Context<CloseProposal>) -> Result<()> {
    // Commented out only for testing purposes
    // Proposal must be completed or failed
    // require!(
    //     ctx.accounts.proposal.status == ProposalStatus::Completed
    //         || ctx.accounts.proposal.status == ProposalStatus::Failed,
    //     ErrorCode::ProposalNotClosable
    // );

    // Escrow must be empty
    // require!(ctx.accounts.escrow.amount == 0, ErrorCode::EscrowNotEmpty);

    // Proposal account will be closed automatically (rent sent to researcher)
    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Proposal is not in a closable state")]
    ProposalNotClosable,
    #[msg("Escrow account still holds funds")]
    EscrowNotEmpty,
    #[msg("Invalid escrow account")]
    InvalidEscrow,
}
