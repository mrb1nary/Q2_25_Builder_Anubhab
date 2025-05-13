use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::{Milestone, MilestoneStatus, Proposal, ProposalStatus};

#[derive(Accounts)]
pub struct ReleaseFunds<'info> {
    #[account(mut)]
    pub researcher: Signer<'info>,

    #[account(
        mut,
        has_one = researcher,
        seeds = [
            b"proposal", 
            researcher.key().as_ref(), 
            proposal.title.as_bytes()
        ],
        bump,
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        mut,
        seeds = [b"escrow", proposal.key().as_ref()],
        bump,
        constraint = escrow.key() == proposal.funds_escrow @ ErrorCode::InvalidEscrow,
    )]
    pub escrow: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = milestone.status == MilestoneStatus::Validated @ ErrorCode::MilestoneNotValidated,
        constraint = milestone.funds_released == false @ ErrorCode::FundsAlreadyReleased,
        constraint = milestone.proposal == proposal.key() @ ErrorCode::InvalidMilestone,
    )]
    pub milestone: Account<'info, Milestone>,

    #[account(
        mut,
        constraint = researcher_token_account.owner == researcher.key(),
    )]
    pub researcher_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn release_funds_handler(ctx: Context<ReleaseFunds>) -> Result<()> {
    let clock = Clock::get()?;
    
    // Calculate payment amount per milestone
    let amount_per_milestone = ctx.accounts.proposal.amount_asked
        .checked_div(ctx.accounts.proposal.total_milestones as u64)
        .ok_or(ErrorCode::MathOverflow)?;

    // Check if escrow has enough tokens
    require!(
        ctx.accounts.escrow.amount >= amount_per_milestone,
        ErrorCode::InsufficientFunds
    );

    // Transfer tokens from escrow to researcher
    // Fixed PDA signer derivation
    let binding = ctx.accounts.researcher.key();
    let seeds = &[
        b"proposal",
        binding.as_ref(),
        ctx.accounts.proposal.title.as_bytes(),
        &[ctx.bumps.proposal]
    ];
    let signer = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.escrow.to_account_info(),
                to: ctx.accounts.researcher_token_account.to_account_info(),
                authority: ctx.accounts.proposal.to_account_info(),
            },
            signer,
        ),
        amount_per_milestone,
    )?;

    // Update milestone state
    let milestone = &mut ctx.accounts.milestone;
    milestone.funds_released = true;
    milestone.updated_at = clock.unix_timestamp;

    // Update proposal state
    let proposal = &mut ctx.accounts.proposal;
    proposal.updated_at = clock.unix_timestamp;

    // Check if all milestones completed
    if proposal.current_milestone == proposal.total_milestones {
        proposal.status = ProposalStatus::Completed;
    }

    msg!("Released {} tokens for milestone {}", amount_per_milestone, ctx.accounts.milestone.milestone_number);

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Insufficient funds in escrow")]
    InsufficientFunds,

    #[msg("Milestone not validated")]
    MilestoneNotValidated,
    
    #[msg("Funds already released")]
    FundsAlreadyReleased,
    
    #[msg("Arithmetic overflow")]
    MathOverflow,
    
    #[msg("Invalid escrow account")]
    InvalidEscrow,
    
    #[msg("Invalid milestone for this proposal")]
    InvalidMilestone,
}
