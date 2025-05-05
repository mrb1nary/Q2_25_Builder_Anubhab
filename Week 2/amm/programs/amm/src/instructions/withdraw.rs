use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{burn, transfer, Burn, Mint, Token, TokenAccount, Transfer},
};

use crate::Config;



#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub withdrawer: Signer<'info>,

    pub mint_x: Account<'info, Mint>,
    pub mint_y: Account<'info, Mint>,

    #[account(
        has_one = mint_x,
        has_one = mint_y,
        seeds = [b"config", config.seed.to_le_bytes().as_ref()],
        bump = config.config_bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [b"lp", config.key().as_ref()],
        bump = config.lp_bump,
    )]
    pub mint_lp: Account<'info, Mint>,

    // Vault accounts
    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = config,
    )]
    pub vault_x: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = config,
    )]
    pub vault_y: Account<'info, TokenAccount>,

    // User accounts
    #[account(
        mut,
        associated_token::mint = mint_lp,
        associated_token::authority = withdrawer,
    )]
    pub user_lp: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = withdrawer,
    )]
    pub user_x: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = withdrawer,
    )]
    pub user_y: Account<'info, TokenAccount>,

    // Programs
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Withdraw<'info> {
    pub fn withdraw(&mut self, amount: u64) -> Result<()> {
        // 1. Validate state
        require!(!self.config.locked, ErrorCode::CustomError);
        require!(amount > 0, ErrorCode::CustomError);
        require!(self.user_lp.amount >= amount, ErrorCode::CustomError);

        // 2. Calculate proportional withdrawal amounts
        let total_supply = self.mint_lp.supply;
        let (x_amount, y_amount) = if total_supply == amount {
            (self.vault_x.amount, self.vault_y.amount)
        } else {
            let x_amount = self.vault_x.amount
                .checked_mul(amount)
                .and_then(|v| v.checked_div(total_supply))
                .ok_or(ErrorCode::CustomError)?;

            let y_amount = self.vault_y.amount
                .checked_mul(amount)
                .and_then(|v| v.checked_div(total_supply))
                .ok_or(ErrorCode::CustomError)?;

            (x_amount, y_amount)
        };

        // 3. Validate vault balances
        require!(self.vault_x.amount >= x_amount, ErrorCode::CustomError);
        require!(self.vault_y.amount >= y_amount, ErrorCode::CustomError);

        // 4. Burn LP tokens
        self.burn_lp_tokens(amount)?;

        // 5. Transfer tokens from vault to user
        self.transfer_tokens(true, x_amount)?;
        self.transfer_tokens(false, y_amount)?;

        Ok(())
    }

    fn burn_lp_tokens(&mut self, amount: u64) -> Result<()> {
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = Burn {
            mint: self.mint_lp.to_account_info(),
            from: self.user_lp.to_account_info(),
            authority: self.config.to_account_info(),
        };

        let seeds = &[
            &b"config"[..],
            &self.config.seed.to_le_bytes(),
            &[self.config.config_bump],
        ];

        let signer_seeds = &[&seeds[..]];

        let ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        burn(ctx, amount)
    }

    fn transfer_tokens(&self, is_x: bool, amount: u64) -> Result<()> {
        let (vault, user) = match is_x {
            true => (self.vault_x.to_account_info(), self.user_x.to_account_info()),
            false => (self.vault_y.to_account_info(), self.user_y.to_account_info()),
        };

        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = Transfer {
            from: vault,
            to: user,
            authority: self.config.to_account_info(),
        };

        let seeds = &[
            &b"config"[..],
            &self.config.seed.to_le_bytes(),
            &[self.config.config_bump],
        ];

        let signer_seeds = &[&seeds[..]];

        let ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        transfer(ctx, amount)
    }
}



#[error_code]
pub enum ErrorCode {
    #[msg("Custom error message")]
    CustomError,
}
