    use anchor_lang::prelude::*;

    #[account]
    #[derive(InitSpace)]
    pub struct Contributor {
        pub wallet: Pubkey,   //Wallet key of the contributor             //32 bytes
        pub proposal: Pubkey, //The proposal/research he/she voted for    //32 bytes
        pub amount: u64,      //Amount the contributor contributed        //8 bytes
        pub timestamp: i64,   //When was the contribution made            //8 bytes
        pub shares: u64,      //How much proportion the contributor owns  //8 bytes
        pub bump: u8,
    }
