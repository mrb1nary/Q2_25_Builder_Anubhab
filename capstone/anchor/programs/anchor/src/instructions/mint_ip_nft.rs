use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token::{spl_token, Mint};
use mpl_token_metadata::instructions::CreateV1Builder;
use mpl_token_metadata::types::{Creator, PrintSupply};

#[derive(Accounts)]
pub struct MintNft<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = payer,
        mint::freeze_authority = payer,
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: Metaplex will create this account
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: Metaplex will create this account
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    /// CHECK: Validated via address constraint
    #[account(address = spl_token::ID)]
    pub token_program: UncheckedAccount<'info>,

    /// CHECK: Metaplex program
    #[account(address = mpl_token_metadata::ID)]
    pub metadata_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    /// CHECK: Instruction sysvar account
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

pub fn mint_ip_nft_handler(
    ctx: Context<MintNft>,
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    let creators = vec![Creator {
        address: ctx.accounts.payer.key(),
        verified: true,
        share: 100,
    }];

    
    let create_ix = CreateV1Builder::new()
        .metadata(ctx.accounts.metadata.key())
        .mint(ctx.accounts.mint.key(), true)
        .authority(ctx.accounts.payer.key())
        .payer(ctx.accounts.payer.key())
        .update_authority(ctx.accounts.payer.key(), true)
        .master_edition(Some(ctx.accounts.master_edition.key()))
        .spl_token_program(Some(spl_token::ID)) // ← REQUIRED BY METAPLEX
        .creators(creators)
        .seller_fee_basis_points(500)
        .is_mutable(true)
        .name(name)
        .symbol(symbol)
        .uri(uri)
        .decimals(0)
        .print_supply(PrintSupply::Zero)
        .token_standard(mpl_token_metadata::types::TokenStandard::NonFungible)
        .instruction();

    let create_infos = vec![
        ctx.accounts.metadata.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
        ctx.accounts.metadata_program.to_account_info(),
        ctx.accounts.master_edition.to_account_info(),
        ctx.accounts.sysvar_instructions.to_account_info(),
    ];

    msg!("Invoking Metaplex CreateV1...");
    invoke(&create_ix, &create_infos)?;

    Ok(())
}
