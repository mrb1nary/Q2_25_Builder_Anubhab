use crate::{Milestone, MilestoneStatus, Proposal, ProposalStatus};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

#[derive(Accounts)]
pub struct ApplyPenalty<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"proposal",
            proposal.researcher.as_ref(),
            proposal.title.as_bytes()
        ],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        mut,
        has_one = proposal,
        constraint = milestone.status == MilestoneStatus::Failed,
    )]
    pub milestone: Account<'info, Milestone>,

    #[account(
        mut,
        seeds = [b"escrow", proposal.key().as_ref()],
        bump,
        constraint = escrow.key() == proposal.funds_escrow @ ErrorCode::InvalidEscrow,
    )]
    pub escrow: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury.mint == escrow.mint @ ErrorCode::InvalidMint,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn apply_penalty_handler(ctx: Context<ApplyPenalty>) -> Result<()> {
    let clock = Clock::get()?;
    
    // Get account_info before mutable borrow
    let proposal_info = ctx.accounts.proposal.to_account_info();
    let researcher = ctx.accounts.proposal.researcher.clone();
    let title = ctx.accounts.proposal.title.clone();
    
    // Now get mutable references
    let proposal = &mut ctx.accounts.proposal;
    let milestone = &mut ctx.accounts.milestone;

    // Calculate penalty percentage based on counter
    let penalty_percent = match proposal.penalty_counter {
        0 => 5,
        1 => 10,
        2 => 15,
        3 => 100,
        _ => return Err(ErrorCode::MaxPenaltiesReached.into()),
    };

    // Calculate penalty amount
    let penalty_amount = if proposal.penalty_counter == 3 {
        proposal.current_security_deposit
    } else {
        proposal
            .initial_security_deposit
            .checked_mul(penalty_percent as u64)
            .and_then(|v| v.checked_div(100))
            .ok_or(ErrorCode::MathOverflow)?
    };

    require!(
        proposal.current_security_deposit >= penalty_amount,
        ErrorCode::InsufficientSecurityDeposit
    );

    // Apply penalty to security deposit
    proposal.current_security_deposit = proposal
        .current_security_deposit
        .checked_sub(penalty_amount)
        .ok_or(ErrorCode::MathOverflow)?;

    // Log transfer details
    msg!(
        "Transferring {} tokens to treasury at {}",
        penalty_amount,
        ctx.accounts.treasury.key()
    );

    let seeds = &[
        b"proposal".as_ref(),
        researcher.as_ref(),
        title.as_bytes(),
        &[ctx.bumps.proposal],
    ];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.escrow.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
                authority: proposal_info,
            },
            &[seeds],
        ),
        penalty_amount,
    )?;

    // Update counters
    proposal.penalty_counter += 1;

    if proposal.penalty_counter >= 4 {
        proposal.status = ProposalStatus::Failed;
        proposal.current_security_deposit = 0;
    }

    proposal.updated_at = clock.unix_timestamp;
    milestone.updated_at = clock.unix_timestamp;

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Proposal is not in Active state")]
    ProposalNotActive,
    #[msg("Maximum penalties (4) already applied")]
    MaxPenaltiesReached,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Insufficient security deposit")]
    InsufficientSecurityDeposit,
    #[msg("Invalid escrow account")]
    InvalidEscrow,
    #[msg("Invalid mint")]
    InvalidMint,
}
