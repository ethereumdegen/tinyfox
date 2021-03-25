
 
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

    constructor(mongoOptions)
    {
        if(!mongoOptions.suffix){
            mongoOptions.suffix = 'development'
        }

        this.mongoInterface = new MongoInterface( 'tinyfox_'.concat(mongoOptions.suffix) , mongoOptions) 
        
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
 


        this.currentEventFilterBlock = indexingConfig.startBlock;

        this.maxBlockNumber = await Web3Helper.getBlockNumber(web3)

 

        this.indexUpdater = setInterval(this.indexData.bind(this), indexingConfig.indexRate)

        this.blockNumberUpdater = setInterval(this.updateBlockNumber.bind(this), indexingConfig.updateBlockNumberRate)
    }

    stopIndexing(){
        clearInterval(this.indexUpdater)
        clearInterval(this.blockNumberUpdater)
    }

    async updateBlockNumber(){
        this.maxBlockNumber = await Web3Helper.getBlockNumber(web3)
    }

    async indexData(){    

        if(this.currentEventFilterBlock + this.indexingConfig.courseBlockGap < this.maxBlockNumber){

            if(this.indexingConfig.contractType.toLowerCase() == 'ERC721'){
                await this.indexERC721Data( this.indexingConfig.courseBlockGap )
            }else{
                await this.indexERC20Data( this.indexingConfig.courseBlockGap )
            }
    
    
            this.currentEventFilterBlock = this.currentEventFilterBlock + this.indexingConfig.courseBlockGap
     
        }else if( this.currentEventFilterBlock + this.indexingConfig.fineBlockGap < this.maxBlockNumber ){
         
            if(this.indexingConfig.contractType.toLowerCase() == 'ERC721'){
                await this.indexERC721Data( this.indexingConfig.fineBlockGap )
            }else{
                await this.indexERC20Data( this.indexingConfig.fineBlockGap )
            } 
    
            this.currentEventFilterBlock = this.currentEventFilterBlock + this.indexingConfig.fineBlockGap
     
        }

    }


    async indexERC20Data( blockGap ){

        let contractAddress = this.indexingConfig.contractAddress

        let contract = Web3Helper.getCustomContract(ERC20ABI,contractAddress, this.web3  )
        
        //let transferEvent = contract.events.Transfer 

        let startBlock = this.currentEventFilterBlock
        let endBlock = this.currentEventFilterBlock + blockGap

        let events = await this.getContractEvents( contract, 'Transfer', startBlock, endBlock )

        console.log('events', events)

        //save in mongo 

    }

    async indexERC721Data( blockGap ){

        let contractAddress = this.indexingConfig.contractAddress

        let contract = Web3Helper.getCustomContract(ERC721ABI,contractAddress, this.web3  )
        
        //let transferEvent = contract.events.OwnershipTransferred 

        let startBlock = this.currentEventFilterBlock
        let endBlock = this.currentEventFilterBlock + blockGap

        let events = await this.getContractEvents( contract, 'OwnershipTransferred' , startBlock, endBlock )

        console.log('events', events)

        //save in mongo 

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
 


 