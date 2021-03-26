# 🦊 tinyfox 
Simple lightweight data aggregator for Transfer/Approval events of ERC20 and ERC721 tokens 



#### How to use (In NodeJS) 
(Requires a MongoDB to be installed on the local machine) 


        this.tinyFox = new TinyFox()
        await this.tinyFox.init({suffix: 'development'})



        let tinyfoxConfig = {
            contractType: 'ERC20',
            contractAddress: '0xab89a7742cb10e7bce98540fd05c7d731839cf9f' ,
            startBlock: 1316824,
            
            courseBlockGap: 1000, 
            fineBlockGap: 50,
            indexRate: 10000,
            updateBlockNumberRate:60000
        } 

        this.tinyFox.startIndexing( this.web3, tinyfoxConfig )  
        
        this.tinyFox.stopIndexing()   
        
        this.tinyFox.resetState()  
        
        
        
 As tinyfox indexes, it starts at 'startBlock' and is collecting events at a pace of 'courseBlockGap' blocks read per 'indexRate' of time.  
 It stores these events inside of a mongo database named 'tinyfox_{{suffix}}' and inside of a collection named 'event_data'
 
 Once tinyfox synchronizes to the front of the blockchain data (current state) then it will use the 'fineBlockGap' to remain synchronized.  
 
 As tinyfox is scraping chaindata for the ERC20/ERC721 token, it is also building a cache of user balances in the tables named 'erc20_balances' and 'erc721_balances'. 
 
 #### Events Supported
 
        ERC20 Events:  Transfer, Approval, Deposit (weth), Withdrawal (weth), Mint (0xBTC)
 
        ERC721 Events: Transfer
