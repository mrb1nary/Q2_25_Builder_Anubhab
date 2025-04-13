use anchor_lang::prelude::*;

use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Token},
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::state::Escrow::*;

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Take<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,

    #[account(
        mint::token_program = token_program
    )]
    pub mint_a: InterfaceAccount<'info, Mint>,

    #[account(
        mint::token_program = token_program
    )]
    pub mint_b: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = taker,
        associated_token::token_program = token_program,
    )]
    pub taker_ata_a: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = taker,
        associated_token::token_program = token_program
    )]
    pub taker_ata_b: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = escrow.maker,
        associated_token::token_program = token_program
    )]
    pub maker_ata_b: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"escrow",escrow.maker.as_ref(), &seed.to_le_bytes()],
        bump = escrow.bump,

    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = escrow,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> Take<'info> {
    pub fn take_offer(&mut self) -> Result<()> {
        //We have to make two transfers
        //1. Transfer from taker_ata_b to maker_ata_b
        let cpi_program = self.token_program.to_account_info();

        let transfer_from_taker_to_maker_accounts = TransferChecked {
            from: self.taker_ata_b.to_account_info(),
            to: self.maker_ata_b.to_account_info(),
            mint: self.mint_b.to_account_info(),
            authority: self.taker.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, transfer_from_taker_to_maker_accounts);
        transfer_checked(cpi_ctx, self.escrow.required, self.mint_b.decimals)?;

        //2. Transfer from vault to taker_ata_a

        let cpi_program = self.token_program.to_account_info();

        let transfer_from_vault_to_taker_accounts = TransferChecked {
            from: self.vault.to_account_info(),
            to: self.taker_ata_a.to_account_info(),
            mint: self.mint_a.to_account_info(),
            authority: self.escrow.to_account_info(),
        };

        let seeds = &[
            b"escrow",
            self.escrow.maker.as_ref(),
            &self.escrow.seed.to_le_bytes(),
            &[self.escrow.bump],
        ];

        let signer_seeds: &[&[&[u8]]] = &[seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            cpi_program,
            transfer_from_vault_to_taker_accounts,
            signer_seeds,
        );

        transfer_checked(cpi_ctx, self.escrow.required, self.mint_a.decimals)?;

        Ok(())
    }
}
