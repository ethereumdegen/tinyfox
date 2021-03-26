
 
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
        updateBlockNumberRate:60000


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
        if(existingState){
            this.tinyfoxState = existingState
        }else{
            this.tinyfoxState = {  currentEventFilterBlock: indexingConfig.startBlock   }
            await this.mongoInterface.insertOne('tinyfox_state', this.tinyfoxState)
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

    async updateBlockNumber(){
        this.maxBlockNumber = await Web3Helper.getBlockNumber(this.web3)
    }

    async indexData(){    

         

        let currentEventFilterBlock = parseInt(this.tinyfoxState.currentEventFilterBlock)

        console.log('index data starting at ', currentEventFilterBlock)

        if(currentEventFilterBlock + this.indexingConfig.courseBlockGap < this.maxBlockNumber){

            if(this.indexingConfig.contractType.toLowerCase() == 'ERC721'){
                await this.indexERC721Data(currentEventFilterBlock, this.indexingConfig.courseBlockGap )
            }else{
                await this.indexERC20Data(currentEventFilterBlock, this.indexingConfig.courseBlockGap )
            }
    
    
             
            await this.mongoInterface.updateCustomAndFindOne('tinyfox_state', {}, { $inc: { currentEventFilterBlock: parseInt(this.indexingConfig.courseBlockGap)    }   } )
    

        }else if( currentEventFilterBlock + this.indexingConfig.fineBlockGap < this.maxBlockNumber ){
         
            if(this.indexingConfig.contractType.toLowerCase() == 'ERC721'){
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
        
        

         
        let endBlock = startBlock + blockGap

        let results = await this.getContractEvents( contract, 'Transfer', startBlock, endBlock )

         

        //save in mongo  
        await this.mongoInterface.upsertOne('event_data', {contractAddress: results.contractAddress, startBlock: results.startBlock }, results    )
    

    }

    async indexERC721Data(startBlock, blockGap ){

        let contractAddress = this.indexingConfig.contractAddress

        let contract = Web3Helper.getCustomContract(ERC721ABI,contractAddress, this.web3  )
        
           

         
        let endBlock = startBlock + blockGap

        let results = await this.getContractEvents( contract, 'OwnershipTransferred' , startBlock, endBlock )

        //save in mongo 
        await this.mongoInterface.upsertOne('event_data', {contractAddress: results.contractAddress, startBlock: results.startBlock }, results    )
    

        

    }

    async getContractEvents(contract, eventName, startBlock, endBlock  ){

        
            return new Promise ((resolve, reject) => {
                contract.getPastEvents(eventName, { fromBlock: startBlock, toBlock: endBlock }) 
                .then(function(events){
                    resolve({contractAddress: contract.options.address , startBlock: startBlock, endBlock: endBlock, events:events}) // same results as the optional callback above
                });
            })
         
 

    }


}
 


 