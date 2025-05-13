use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::{Proposal, ProposalStatus};

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
        payer = researcher,
        seeds = [b"escrow", proposal.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = proposal,
    )]
    pub escrow: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = researcher_token_account.mint == mint.key(),
        constraint = researcher_token_account.owner == researcher.key(),
    )]
    pub researcher_token_account: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
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
    // Get current timestamp
    let clock = Clock::get()?;

    // Validate inputs
    require!(amount_asked > 0, ErrorCode::InvalidAmount);
    require!(total_milestones > 0, ErrorCode::InvalidMilestone);

    // Calculate required deposit amount (10% of amount asked)
    let required_deposit = amount_asked
        .checked_div(10)
        .ok_or(ErrorCode::MathOverflow)?;

    require!(
        security_deposit >= required_deposit,
        ErrorCode::MoreSecurityDeposit
    );

    // Initialize proposal fields
    let proposal = &mut ctx.accounts.proposal;
    proposal.title = title.clone();
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
    proposal.contributors_count = 0;

    // Store escrow account address
    proposal.funds_escrow = ctx.accounts.escrow.key();

    // Transfer tokens to escrow as security deposit
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.researcher_token_account.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
                authority: ctx.accounts.researcher.to_account_info(),
            },
        ),
        security_deposit,
    )?;

    msg!("Proposal created with title: {}", title.clone());
    msg!(
        "Security deposit of {} tokens transferred to escrow",
        security_deposit
    );
    msg!("Escrow address: {}", ctx.accounts.escrow.key());

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
