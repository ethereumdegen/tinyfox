
 
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
        logging: false,

        eventNames: ["Transfer"] //or "Approval"


    }

*/
let ERC721ABI = require( './config/contracts/ERC721ABI.json' )
let ERC20ABI = require( './config/contracts/SuperERC20ABI.json' )


const SAFE_EVENT_COUNT = 7000
const LOW_EVENT_COUNT = 50

var stepSizeScaleFactor = 1


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

        /*if(!this.indexingConfig.eventNames){
            this.indexingConfig.eventNames = ['Transfer']  //'Approval'
        }*/
 


        //this.currentEventFilterBlock = indexingConfig.startBlock;

        //this.maxBlockNumber = await Web3Helper.getBlockNumber(this.web3)
        await this.updateBlockNumber()

        if(this.maxBlockNumber == null){
            console.error('TinyFox cannot fetch the blocknumber: Stopping Process')
            return 
        }
        
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

        try{ 
            this.maxBlockNumber = await Web3Helper.getBlockNumber(this.web3)
        }catch(e){

            console.error(e)
        }

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
    
    
             
            await this.mongoInterface.updateCustomAndFindOne('tinyfox_state', {}, { $inc: { currentEventFilterBlock: parseInt(this.indexingConfig.courseBlockGap)    } , $set:{synced:false}   } )
    

        }else if( currentEventFilterBlock + this.indexingConfig.fineBlockGap < this.maxBlockNumber ){
         
            if(this.indexingConfig.contractType.toLowerCase() == 'erc721'){
                await this.indexERC721Data(currentEventFilterBlock, this.indexingConfig.fineBlockGap )
            }else{
                await this.indexERC20Data(currentEventFilterBlock, this.indexingConfig.fineBlockGap )
            } 


            await this.mongoInterface.updateCustomAndFindOne('tinyfox_state', {}, { $inc: { currentEventFilterBlock: parseInt(this.indexingConfig.fineBlockGap)    } , $set:{synced:true}  } )
    
            
     
        }

    }


    async indexERC20Data(startBlock, blockGap ){

        let contractAddress = this.indexingConfig.contractAddress

        //let eventNames = this.indexingConfig.eventNames

        let contract = Web3Helper.getCustomContract(ERC20ABI,contractAddress, this.web3  )
        
         
         let scaledBlockGap = parseInt( blockGap / stepSizeScaleFactor  )  
         let endBlock = startBlock + Math.max(scaledBlockGap - 1 , 1)     

        try{
            let results = await this.getContractEvents( contract, "allEvents", startBlock, endBlock )
        }catch(resultsError){
            console.error('Request Error: ', results.error)
        }
        //need better error catch

            if(this.indexingConfig.logging){
                 

                if(results && results.events && results.events.length == 0){
                    console.log('zero results', results)
                }

                if(results && results.events && results.events.length > SAFE_EVENT_COUNT){
                    console.log('excessive results', results)
                } 
                 
            }

          

            if(!results || results.events.length > SAFE_EVENT_COUNT  ){
                    stepSizeScaleFactor  = parseInt(stepSizeScaleFactor * 2)
                    if(this.indexingConfig.logging){
                        console.log('ScaleFactor ',stepSizeScaleFactor)
                    }

            }else{

                console.log('saved event data ', results.startBlock, ":", results.endBlock, ' Count: ' , results.events.length)
               

                //save in mongo  
                await this.mongoInterface.upsertOne('event_data', {contractAddress: results.contractAddress, startBlock: results.startBlock }, results    )
            
                for(let event of results.events){
                    await this.mongoInterface.upsertOne('event_list', {transactionHash: event.transactionHash , logIndex: event.logIndex  },  event   )
                    await this.modifyERC20LedgerByEvent(   event )
                }   

                if(results.events.length < LOW_EVENT_COUNT){
                    stepSizeScaleFactor  = Math.max(  parseInt(stepSizeScaleFactor / 2) , 1)
                    if(this.indexingConfig.logging){
                        console.log('ScaleFactor ',stepSizeScaleFactor)
                    }
                }
                
            }

    
 
        

       
    }

    async indexERC721Data(startBlock, blockGap ){

        let contractAddress = this.indexingConfig.contractAddress

        let contract = Web3Helper.getCustomContract(ERC721ABI,contractAddress, this.web3  )
        
           

        let scaledBlockGap = parseInt( blockGap / stepSizeScaleFactor  )  
        let endBlock = startBlock + Math.max(scaledBlockGap - 1 , 1)     

        try{
            let results = await this.getContractEvents( contract, 'Transfer' , startBlock, endBlock )
        }catch(resultsError){
            console.error('Request Error: ', results.error)
        }

       

        if(!results || results.events.length > SAFE_EVENT_COUNT  ){
            stepSizeScaleFactor  = parseInt(stepSizeScaleFactor * 2)
            if(this.indexingConfig.logging){
                console.log('ScaleFactor ',stepSizeScaleFactor)
            }

        }else{

            if(this.indexingConfig.logging){
                console.log('saved event data ', results.startBlock, ":", results.endBlock, ' Count: ' , results.events.length)
            }

            //save in mongo 
            await this.mongoInterface.upsertOne('event_data', {contractAddress: results.contractAddress, startBlock: results.startBlock }, results    )

            for(let event of results.events){
                await this.mongoInterface.upsertOne('event_list', {transactionHash: event.transactionHash, logIndex: event.logIndex  },  event  )
                await this.modifyERC721LedgerByEvent( event )
            }
        

            if(results.events.length < LOW_EVENT_COUNT){
                stepSizeScaleFactor  = Math.max(  parseInt(stepSizeScaleFactor / 2) , 1)
                if(this.indexingConfig.logging){
                    console.log('ScaleFactor ',stepSizeScaleFactor)
                }
            }

        }
    }

    async getContractEvents(contract, eventName, startBlock, endBlock  ){

        
            return new Promise ((resolve, reject) => {
                contract.getPastEvents(eventName, { fromBlock: startBlock, toBlock: endBlock }) 
                .then(function(events){
                    resolve({contractAddress: contract.options.address , startBlock: startBlock, endBlock: endBlock, events:events}) // same results as the optional callback above
                }).catch(function(error){reject(error)});
            })
         
 

    }

 
   
    async modifyERC20LedgerByEvent(  event){
       // console.log('event', event)

        //let topicZero = event.raw.topics[0]

        //let eventName = this.getEventNameFromTopicZero(topicZero)

         let eventName = event.event 

        let outputs = event.returnValues
 
        let contractAddress = event.address.toLowerCase()
        if(!eventName){

            console.log('WARN: unknown event', event )
            return
        }
        
        if(eventName.toLowerCase() == 'transfer'){

            let from = outputs['0'].toLowerCase()
            let to = outputs['1'].toLowerCase()
            let amount = parseInt(outputs['2']) 



            await this.modifyERC20LedgerBalance(   from ,contractAddress , amount * -1  )
            await this.modifyERC20LedgerBalance(   to ,contractAddress , amount ) 

             
            await this.modifyERC20LedgerApproval(  contractAddress, from ,to  , amount * -1 ) 

        }
        if(eventName.toLowerCase() == 'approval'){

            let from = outputs['0'].toLowerCase()
            let to = outputs['1'].toLowerCase()
            let amount = parseInt(outputs['2']) 

            await this.setERC20LedgerApproval(   contractAddress , from, to,  amount   ) 

        }
        if(eventName.toLowerCase() == 'mint'){

            let to = outputs['0'].toLowerCase() 
            let amount = parseInt(outputs['1']) 

            await this.modifyERC20LedgerBalance(   to ,contractAddress , amount )  

        }
        if(eventName.toLowerCase() == 'deposit'){

            let to = outputs['0'].toLowerCase() 
            let amount = parseInt(outputs['1']) 

            await this.modifyERC20LedgerBalance(   to ,contractAddress , amount )  

        }

        if(eventName.toLowerCase() == 'withdrawal'){

            let from = outputs['0'].toLowerCase() 
            let amount = parseInt(outputs['1']) 

            await this.modifyERC20LedgerBalance(   from ,contractAddress , amount * -1 )  

        }

       
    }

    async modifyERC20LedgerBalance(accountAddress, contractAddress, amountDelta){

        let collectionName = 'erc20_balances' 

        let existingFrom = await this.mongoInterface.findOne(collectionName, {accountAddress: accountAddress, contractAddress: contractAddress }  )

        if(existingFrom){
            await this.mongoInterface.updateCustomAndFindOne(collectionName, {accountAddress: accountAddress, contractAddress: contractAddress } , {  $inc: { amount: amountDelta } } )
        }else{
            await this.mongoInterface.insertOne(collectionName, {accountAddress: accountAddress, contractAddress: contractAddress, amount: amountDelta }   )
        }
    }

    async modifyERC20LedgerApproval( contractAddress, ownerAddress, spenderAddress,   amountDelta){

        let collectionName = 'erc20_approval' 

        let existingFrom = await this.mongoInterface.findOne(collectionName, {ownerAddress: ownerAddress, spenderAddress: spenderAddress, contractAddress: contractAddress }  )

        if(existingFrom){
            await this.mongoInterface.updateCustomAndFindOne(collectionName, {ownerAddress: ownerAddress, spenderAddress: spenderAddress, contractAddress: contractAddress } , {  $inc: { amount: amountDelta } } )
        }else{
            await this.mongoInterface.insertOne(collectionName, {ownerAddress: ownerAddress, spenderAddress: spenderAddress, contractAddress: contractAddress, amount: amountDelta }   )
        }
    }

    async setERC20LedgerApproval( contractAddress, ownerAddress, spenderAddress,   newAmount ){

        let collectionName = 'erc20_approval' 

        let existingFrom = await this.mongoInterface.findOne(collectionName, {ownerAddress: ownerAddress, spenderAddress: spenderAddress, contractAddress: contractAddress }  )

        if(existingFrom){
            await this.mongoInterface.updateCustomAndFindOne(collectionName, {ownerAddress: ownerAddress, spenderAddress: spenderAddress, contractAddress: contractAddress } , {  $set: { amount: newAmount } } )
        }else{
            await this.mongoInterface.insertOne(collectionName, {ownerAddress: ownerAddress, spenderAddress: spenderAddress, contractAddress: contractAddress, amount: newAmount }   )
        }
    }




    async modifyERC721LedgerByEvent(event){
        
        
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
 


 