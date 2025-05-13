use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};

use crate::{Contributor, Proposal, ProposalStatus};

#[derive(Accounts)]
pub struct FundProposal<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(
        mut,
        constraint = proposal.status == ProposalStatus::Active @ ErrorCode::ProposalNotActive,
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        init_if_needed,
        payer = contributor,
        space = 8 + Contributor::INIT_SPACE,
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
        seeds = [b"escrow", proposal.key().as_ref()],
        bump,
        constraint = escrow.key() == proposal.funds_escrow @ ErrorCode::InvalidEscrow,
    )]
    pub escrow: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = contributor_token_account.mint == mint.key() @ ErrorCode::InvalidMint,
        token::authority = contributor
    )]
    pub contributor_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn fund_proposal_handler(ctx: Context<FundProposal>, amount: u64) -> Result<()> {
    // Basic checks
    require!(amount > 0, ErrorCode::InvalidContribution);

    // Transfer tokens from contributor to escrow
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.contributor_token_account.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
                authority: ctx.accounts.contributor.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update contributor's account
    let contributor = &mut ctx.accounts.contributor_account;

    if contributor.amount == 0 {
        contributor.wallet = ctx.accounts.contributor.key();
        contributor.proposal = ctx.accounts.proposal.key();
        contributor.timestamp = Clock::get()?.unix_timestamp;
        contributor.bump = ctx.bumps.contributor_account;
        
        // Increment contributors count on first contribution
        ctx.accounts.proposal.contributors_count += 1;
    }

    contributor.amount = contributor
        .amount
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    contributor.shares = contributor.amount;

    // Update proposal state
    let proposal = &mut ctx.accounts.proposal;
    proposal.amount_raised = proposal
        .amount_raised
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    proposal.updated_at = Clock::get()?.unix_timestamp;

    msg!("Contributed {} tokens to proposal: {}", amount, proposal.title);
    msg!("New total raised: {}", proposal.amount_raised);

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("The research you are trying to fund is not active")]
    ProposalNotActive,

    #[msg("Enter a valid contribution amount")]
    InvalidContribution,

    #[msg("Buffer overflow error")]
    MathOverflow,

    #[msg("Invalid mint")]
    InvalidMint,
    
    #[msg("Invalid escrow account")]
    InvalidEscrow,
}
