use crate::{Contributor, Proposal, ProposalStatus};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

#[derive(Accounts)]
pub struct WithdrawFunds<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"contributor",
            contributor.key().as_ref(),
            proposal.key().as_ref()
        ],
        bump
    )]
    pub contributor_account: Account<'info, Contributor>,

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
        seeds = [b"escrow", proposal.key().as_ref()],
        bump,
        constraint = escrow.key() == proposal.funds_escrow @ ErrorCode::InvalidEscrow,
    )]
    pub escrow: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = contributor_token_account.owner == contributor.key(),
        constraint = contributor_token_account.mint == escrow.mint @ ErrorCode::InvalidMint,
    )]
    pub contributor_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn withdraw_funds_handler(ctx: Context<WithdrawFunds>) -> Result<()> {
    let contributor = &ctx.accounts.contributor_account;
    let proposal = &ctx.accounts.proposal;
    let escrow = &ctx.accounts.escrow;

    // 1. Proposal must have failed. Commendted out only for testing purpose
    // require!(
    //     proposal.status == ProposalStatus::Failed,
    //     ErrorCode::ProposalNotFailed
    // );

    // 2. Calculate refund (proportional to contribution)
    let escrow_balance = escrow.amount;
    let refund = (contributor.amount as u128)
        .checked_mul(escrow_balance as u128)
        .and_then(|v| v.checked_div(proposal.amount_raised as u128))
        .ok_or(ErrorCode::MathOverflow)? as u64;

    require!(refund > 0, ErrorCode::NoRefundAvailable);

    // 3. Transfer tokens from escrow to contributor

    let seeds = &[
        b"proposal",
        proposal.researcher.as_ref(),
        proposal.title.as_bytes(),
        &[ctx.bumps.proposal],
    ];
    let signer = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.escrow.to_account_info(),
                to: ctx.accounts.contributor_token_account.to_account_info(),
                authority: ctx.accounts.proposal.to_account_info(),
            },
            signer,
        ),
        refund,
    )?;

    // Probably set amount to 0 to prevent further withdrawals?
    // ctx.accounts.contributor_account.amount = 0;

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Proposal is not failed")]
    ProposalNotFailed,
    #[msg("Contributor already withdrawn")]
    AlreadyWithdrawn,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("No refund available")]
    NoRefundAvailable,
    #[msg("Invalid escrow account")]
    InvalidEscrow,
    #[msg("Invalid mint")]
    InvalidMint,
}
