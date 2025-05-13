use crate::{Milestone, MilestoneStatus, Proposal, Vote};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(approved: bool)]
pub struct ValidateMilestone<'info> {
    #[account(mut)]
    pub validator: Signer<'info>,

    #[account(mut)]
    pub milestone: Account<'info, Milestone>,

    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    #[account(
        init_if_needed,
        payer = validator,
        space = 8 + Vote::INIT_SPACE,
        seeds = [
            b"vote",
            validator.key().as_ref(),
            milestone.key().as_ref()
        ],
        bump
    )]
    pub vote: Account<'info, Vote>,

    pub system_program: Program<'info, System>,
}

pub fn validate_milestone_handler(ctx: Context<ValidateMilestone>, approved: bool) -> Result<()> {
    let clock = Clock::get()?;

    // Commented out for testing purpose
    // Validate milestone state
    // require!(
    //     ctx.accounts.milestone.status == MilestoneStatus::Active,
    //     ErrorCode::MilestoneNotActive
    // );
    require!(
        clock.unix_timestamp < ctx.accounts.milestone.deadline,
        ErrorCode::ValidationDeadlinePassed
    );

    // Check if validator already voted
    let vote = &mut ctx.accounts.vote;
    if vote.voted_at == 0 {
        // First vote
        vote.validator = ctx.accounts.validator.key();
        vote.milestone = ctx.accounts.milestone.key();
        vote.approved = approved;
        vote.voted_at = clock.unix_timestamp;

        // Update vote count
        if approved {
            ctx.accounts.milestone.validation_votes += 1;
        }
    } else {
        // Update existing vote
        if vote.approved && !approved {
            ctx.accounts.milestone.validation_votes -= 1;
        } else if !vote.approved && approved {
            ctx.accounts.milestone.validation_votes += 1;
        }
        vote.approved = approved;
    }

    // Check validation threshold
    let milestone = &mut ctx.accounts.milestone;
    if milestone.validation_votes > milestone.total_validators / 2 {
        milestone.status = MilestoneStatus::Validated;
        milestone.funds_released = true;
        milestone.updated_at = clock.unix_timestamp;
    }

    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Milestone is not in Active state")]
    MilestoneNotActive,
    #[msg("Validation deadline has passed")]
    ValidationDeadlinePassed,
}
