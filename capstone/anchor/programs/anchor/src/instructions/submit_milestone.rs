use anchor_lang::prelude::*;
use crate::{Milestone, MilestoneStatus, Proposal, ProposalStatus};

#[derive(Accounts)]
#[instruction(milestone_number: u8, evidence_hash: String)]
pub struct SubmitMilestone<'info>{

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
        init,
        payer = researcher,
        space = 8 + Milestone::INIT_SPACE,
        seeds = [
            b"milestone",
            proposal.key().as_ref(),
            &milestone_number.to_le_bytes()
        ],
        bump
    )]
    pub milestone: Account<'info, Milestone>,

    pub system_program: Program<'info, System>,

}


pub fn submit_milestone_handler(
    ctx: Context<SubmitMilestone>,
    milestone_number: u8,
    evidence_hash: String,
) -> Result<()> {
    let clock = Clock::get()?;
    
    // Validate proposal state
    // require!(
    //     ctx.accounts.proposal.status == ProposalStatus::Active,
    //     ErrorCode::ProposalNotActive
    // );

    // Validate milestone sequence
    require!(
        milestone_number == ctx.accounts.proposal.current_milestone + 1,
        ErrorCode::InvalidMilestoneOrder
    );
    require!(
        milestone_number <= ctx.accounts.proposal.total_milestones,
        ErrorCode::ExceedsTotalMilestones
    );

    // Initialize milestone
    let milestone = &mut ctx.accounts.milestone;
    milestone.proposal = ctx.accounts.proposal.key();
    milestone.milestone_number = milestone_number;
    milestone.evidence_hash = evidence_hash;
    milestone.validation_votes = 0;
    milestone.total_validators = 3;     //TEST: This is only for testing purposes 
    milestone.funds_released = false;
    milestone.deadline = clock.unix_timestamp + 14 * 86400; 
    milestone.status = MilestoneStatus::Pending;
    milestone.created_at = clock.unix_timestamp;
    milestone.updated_at = clock.unix_timestamp;

    // Update proposal
    let proposal = &mut ctx.accounts.proposal;
    proposal.current_milestone = milestone_number;
    proposal.updated_at = clock.unix_timestamp;

    Ok(())
}


#[error_code]
pub enum ErrorCode {
    #[msg("Proposal is not in Active state")]
    ProposalNotActive,
    
    #[msg("Milestone number must follow sequence")]
    InvalidMilestoneOrder,
    
    #[msg("Milestone exceeds total allowed milestones")]
    ExceedsTotalMilestones,
    
}
