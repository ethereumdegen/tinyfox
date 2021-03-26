# tinyfox
Simple lightweight data aggregator for Transfer events of ERC20 and ERC721 tokens 



### How to use (In NodeJS) (Requires a MongoDB to be installed on the local machine) 

       this.tinyFox = new TinyFox({suffix: 'development'})


        let tinyfoxConfig = {
            contractType: 'ERC20',
            contractAddress: '0xab89a7742cb10e7bce98540fd05c7d731839cf9f' ,
            startBlock: 1316824 
        } 

        this.tinyFox.startIndexing( this.web3, tinyfoxConfig )  
        
