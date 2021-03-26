
 
const MongoInterface = require('./lib/mongo-interface')
const Web3Helper = require('./lib/web3-helper')

let envmode = process.env.NODE_ENV

/*
    indexingConfig:{
        contractType: 'ERC20','ERC721,
        contractAddress: 0x..... ,

        startBlock: 0, 
        courseBlockGap: 1000, 
        fineBlockGap: 50,
        indexRate: 10000,
        updateBlockNumberRate:60000,
        logging: false


    }

*/
let ERC721ABI = require( './config/contracts/ERC721ABI.json' )
let ERC20ABI = require( './config/contracts/ERC20ABI.json' )
//let ERC721ABI = FileHelper.readJSONFile('config/contracts/ERC721ABI.json')
//let ERC20ABI = FileHelper.readJSONFile('config/contracts/ERC20ABI.json')


module.exports =  class TinyFox {

    constructor(  )
    {
       
    }

    async init( mongoOptions ){
        if(!mongoOptions.suffix){
            mongoOptions.suffix = 'development'
        }

        this.mongoInterface = new MongoInterface( ) 
        await this.mongoInterface.init( 'tinyfox_'.concat(mongoOptions.suffix) , mongoOptions )
        
    }

    async startIndexing( web3, indexingConfig ){

        this.web3 = web3
        this.indexingConfig = indexingConfig

        if(!indexingConfig.indexRate){
            indexingConfig.indexRate = 10*1000;
        }

        if(!indexingConfig.updateBlockNumberRate){
            indexingConfig.updateBlockNumberRate = 60*1000;
        }

      
        if(!indexingConfig.startBlock){
            indexingConfig.startBlock = 0;
        }

        if(!indexingConfig.courseBlockGap){
            indexingConfig.courseBlockGap =  1000;
        }

        if(!indexingConfig.fineBlockGap){
            indexingConfig.fineBlockGap = 50;
        }
 


        //this.currentEventFilterBlock = indexingConfig.startBlock;

        this.maxBlockNumber = await Web3Helper.getBlockNumber(this.web3)

        
        let existingState = await this.mongoInterface.findOne('tinyfox_state', {})
        if(!existingState){ 
            let tinyfoxState = {  currentEventFilterBlock: indexingConfig.startBlock   }
            await this.mongoInterface.insertOne('tinyfox_state', tinyfoxState)
        } 

        this.indexUpdater = setInterval(this.indexData.bind(this), indexingConfig.indexRate)

        this.blockNumberUpdater = setInterval(this.updateBlockNumber.bind(this), indexingConfig.updateBlockNumberRate)
    }

    stopIndexing(){
        clearInterval(this.indexUpdater)
        clearInterval(this.blockNumberUpdater)
    }

    async resetState(){
        let deleted = await this.mongoInterface.deleteOne('tinyfox_state', {})
    }

    async dropDatabase(){
        let deleted = await this.mongoInterface.dropDatabase( )
    }

    async updateBlockNumber(){
        this.maxBlockNumber = await Web3Helper.getBlockNumber(this.web3)
    }

    async indexData(){    

        let tinyfoxState = await this.mongoInterface.findOne('tinyfox_state', {})

        let currentEventFilterBlock = parseInt(tinyfoxState.currentEventFilterBlock)

        if(this.indexingConfig.logging){
            console.log('index data starting at ', currentEventFilterBlock)
        }
        

        if(currentEventFilterBlock + this.indexingConfig.courseBlockGap < this.maxBlockNumber){

            if(this.indexingConfig.contractType.toLowerCase() == 'erc721'){
                await this.indexERC721Data(currentEventFilterBlock, this.indexingConfig.courseBlockGap )
            }else{
                await this.indexERC20Data(currentEventFilterBlock, this.indexingConfig.courseBlockGap )
            }
    
    
             
            await this.mongoInterface.updateCustomAndFindOne('tinyfox_state', {}, { $inc: { currentEventFilterBlock: parseInt(this.indexingConfig.courseBlockGap)    }   } )
    

        }else if( currentEventFilterBlock + this.indexingConfig.fineBlockGap < this.maxBlockNumber ){
         
            if(this.indexingConfig.contractType.toLowerCase() == 'erc721'){
                await this.indexERC721Data(currentEventFilterBlock, this.indexingConfig.fineBlockGap )
            }else{
                await this.indexERC20Data(currentEventFilterBlock, this.indexingConfig.fineBlockGap )
            } 


            await this.mongoInterface.updateCustomAndFindOne('tinyfox_state', {}, { $inc: { currentEventFilterBlock: parseInt(this.indexingConfig.fineBlockGap)    }   } )
    
            
     
        }

    }


    async indexERC20Data(startBlock, blockGap ){

        let contractAddress = this.indexingConfig.contractAddress

        let contract = Web3Helper.getCustomContract(ERC20ABI,contractAddress, this.web3  )
        
        

         
        let endBlock = startBlock + blockGap - 1

        let results = await this.getContractEvents( contract, 'Transfer', startBlock, endBlock )

        if(this.indexingConfig.logging){
            console.log('saved event data ', results.startBlock, ":", results.endBlock, ' Count: ' , results.events.length)
        }

        //save in mongo  
        await this.mongoInterface.upsertOne('event_data', {contractAddress: results.contractAddress, startBlock: results.startBlock }, results    )
    
        for(let event of results.events){
            await this.mongoInterface.upsertOne('event_list', {transactionHash: event.transactionHash  },  event   )
            await this.modifyERC20LedgerByEvent( event )
        }   
    }

    async indexERC721Data(startBlock, blockGap ){

        let contractAddress = this.indexingConfig.contractAddress

        let contract = Web3Helper.getCustomContract(ERC721ABI,contractAddress, this.web3  )
        
           

         
        let endBlock = startBlock + blockGap - 1

        let results = await this.getContractEvents( contract, 'Transfer' , startBlock, endBlock )


        if(this.indexingConfig.logging){
            console.log('saved event data ', results.startBlock, ":", results.endBlock, ' Count: ' , results.events.length)
        }

        //save in mongo 
        await this.mongoInterface.upsertOne('event_data', {contractAddress: results.contractAddress, startBlock: results.startBlock }, results    )

        for(let event of results.events){
            await this.mongoInterface.upsertOne('event_list', {transactionHash: event.transactionHash  },  event  )
            await this.modifyERC721LedgerByEvent( event )
        }
     

    }

    async getContractEvents(contract, eventName, startBlock, endBlock  ){

        
            return new Promise ((resolve, reject) => {
                contract.getPastEvents(eventName, { fromBlock: startBlock, toBlock: endBlock }) 
                .then(function(events){
                    resolve({contractAddress: contract.options.address , startBlock: startBlock, endBlock: endBlock, events:events}) // same results as the optional callback above
                });
            })
         
 

    }




    async modifyERC20LedgerByEvent(event){

        let outputs = event.returnValues
 
        let contractAddress = event.address.toLowerCase()
        let from = outputs.from.toLowerCase()
        let to = outputs.to.toLowerCase()
        let amount = parseInt(outputs.value) 
 

        await this.modifyERC20LedgerBalance( from ,contractAddress , amount * -1  )
        await this.modifyERC20LedgerBalance( to ,contractAddress , amount ) 

    }

    async modifyERC20LedgerBalance( accountAddress, contractAddress, amountDelta){
        let existingFrom = await this.mongoInterface.findOne('erc20_balances', {accountAddress: accountAddress, contractAddress: contractAddress }  )

        if(existingFrom){
            await this.mongoInterface.updateCustomAndFindOne('erc20_balances', {accountAddress: accountAddress, contractAddress: contractAddress } , {  $inc: { amount: amountDelta } } )
        }else{
            await this.mongoInterface.insertOne('erc20_balances', {accountAddress: accountAddress, contractAddress: contractAddress, amount: amountDelta }   )
        }
    }


    async modifyERC721LedgerByEvent(event){
        console.log(event)
        
        let outputs = event.returnValues
 
        let contractAddress = event.address.toLowerCase()
        let from = outputs.from.toLowerCase()
        let to = outputs.to.toLowerCase()
        let tokenId =  outputs.tokenId 

        await this.removeERC721TokenFromAccount( from ,contractAddress , tokenId  )
        await this.addERC721TokenToAccount( to ,contractAddress , tokenId ) 

    }

    async removeERC721TokenFromAccount( accountAddress ,contractAddress , tokenId ){
        let existingAccount = await this.mongoInterface.findOne('erc721_balances', {accountAddress: accountAddress, contractAddress: contractAddress }  )

        if(existingAccount){
            let tokenIdsArray = existingAccount.tokenIds

            let index = tokenIdsArray.indexOf( tokenId );
            if (index > -1) {
                tokenIdsArray.splice(index, 1);
            }

            await this.mongoInterface.updateOne('erc721_balances', {accountAddress: accountAddress, contractAddress: contractAddress}, {tokenIds: tokenIdsArray} )
        }else{
            await this.mongoInterface.insertOne('erc721_balances', {accountAddress: accountAddress, contractAddress: contractAddress, tokenIds: [] }   )
        }
    }

    async addERC721TokenToAccount( accountAddress ,contractAddress , tokenId ){
        let existingAccount = await this.mongoInterface.findOne('erc721_balances', {accountAddress: accountAddress, contractAddress: contractAddress }  )

        if(existingAccount){
            let tokenIdsArray = existingAccount.tokenIds

            tokenIdsArray.push(tokenId)

            await this.mongoInterface.updateOne('erc721_balances', {accountAddress: accountAddress, contractAddress: contractAddress}, {tokenIds: tokenIdsArray} )
        }else{
            await this.mongoInterface.insertOne('erc721_balances', {accountAddress: accountAddress, contractAddress: contractAddress, tokenIds: [tokenId] }   )
        }
    }


}
 


 