const merkletree = require('./MerkleTree');
const tx = require('ethereumjs-tx')
const util = require('ethereumjs-util')
const sjcl = require('sjcl-all');
const rlp = require('rlp');
const abi = require("ethereumjs-abi");
const message = require('message');


class LockWithSecret extends message.Lock{
  constructor(lock,secret){
    super(lock);
    this.secret = secret;
  }
}
//Channel Endpoint state may not be updated directly, you must apply the appropriate message types
//on the endstate.  The Ch
class ChannelStateSync{
  constructor(options){
    this.proof = new ProofMessage(options.proof);
    //dictionary of locks ordered by hashLock key
    this.pendingLocks = {};
    this.openLocks = {};
    this.merkleTree = new merkletree.MerkleTree();
    //the amount the user has put into the channel
    this.depositBalance = options.depositBalance || new util.BN(0);
  }


  applyLockedTransfer(lockedTransfer){
    if(!lockedTransfer instanceof message.LockedTransfer){
      throw new Error("Invalid Message Type: DirectTransfer expected");
    }
    var proof = lockedTransfer.toProof();
    var lock = lockedTransfer.lock;
    //TODO check if lock is already contained
    //throw new Error("Lock already applied");
    var hashLockKey = lock.hashLock.toString('hex');
    if(this.pendingLocks.hasOwnProperty(hashLockKey) || this.openLocks.hasOwnProperty(hashLockKey)){
      throw new Error("Invalid Lock: lock already registered");
    }
    var mt = _computeMerkleTreeWithHashlock(lock);

    if(mt.getRoot().compare(proof.hashLockRoot)!= 0){
        throw new Error("Invalid hashLockRoot");
    };
    this.pendingLocks[hashLockKey] = lock;
    this.proof = proof;
    this.merkleTree = mt;
  }

  applyDirectTransfer(directTransfer){
    if(!directTransfer instanceof message.DirectTransfer){
      throw new Error("Invalid Message Type: DirectTransfer expected");
    }
    if(this.merkleTree.getRoot().compare(directTransfer.hashLockRoot)==0){
      throw new Error("Invalid hashLockRoot");
    }
    this.proof = directTransfer.toProof();
  }

  applyRevealSecret(revealSecret){
    if(!revealSecret instanceof message.RevealSecret){
      throw new Error("Invalid Message Type: RevealSecret expected");
    }
    var hashLock = util.sha3(revealSecret.secret);
    var hashLockKey = hashLock.toString('hex');
    var pendingLock = null;
    if(!(this.pendingLocks.hasOwnProperty(hashLockKey) || this.openLocks.hasOwnProperty(hashLockKey))){
      throw new Error("Invalid Lock: uknown lock secret received");
    }
    if((this.pendingLocks.hasOwnProperty(hashLockKey)){
      //TODO this must be atomic operation, you will have to sanity check on restart
      //if we crash here, we will have the same lock twice...
      pendingLock = this.pendingLocks[hashLockKey];
      this.openLocks[hashLockKey] = new LockWithSecret(pendingLock,secret);
      delete this.pendingLocks[hashLockKey];
    }
  }

  applySecretToProof(secretToProof){
    if(secretToProof instanceof message.SecretToProof){
      throw new Error("Invalid Message Type: SecretToProof expected");
    }
    var proof = secretToProof.toProof();
    var secret = secretToProof.secret;
    var hashLock = util.sha3(secret);
    var hashLockKey = hashLock.toString('hex');

    var pendingLock = null;
    if(this.pendingLocks.hasOwnProperty(hashLockKey)){
      pendingLock = this.pendingLocks[hashLockKey];
    }else if(this.openLocks.hasOwnProperty(hashLockKey)){
      pendingLock = this.openLocks[hashLockKey];
    }
    if(!pendingLock){
      throw new Error("Invalid Lock: uknown lock secret received");
    }

    var mt = _computeMerkleTreeWithoutHashlock(pendingLock.hashLock.toString('hex'));
    if(!mt.getRoot().compare(proof.hashLockRoot) ==0){
      throw new Error("Invalid hashLockRoot in SecretToProof");
    }

    //we compare this fundamental assumption in the Channel
    // if(!(proof.transferredAmount == pendingLock.amount + this.proof.transferredAmount){
    //   throw new Error("Invalid transferredAmount in SecretToProof");
    // }

    //remove the secret from lock states, always use local copies of variables
    if(this.pendingLocks.hasOwnProperty(pendingLock.hashLock.toString('hex'))){
      delete this.pendingLocks[pendingLock.hashLock.toString('hex')];
    }else if(this.openLocks.hasOwnProperty(pendingLock.hashLock.toString('hex'))){
      delete this.openLocks[pendingLock.hashLock.toString('hex')];
    }
    this.proof = proof;
    this.merkleTree = mt;
  }

   _computeMerkleTreeWithHashlock(lock){
      var mt = new merkletree.MerkleTree(map(Object.values(Object.assign({},this.pendingLocks, this.openLocks)).concat(lock)
        ,function (l) {
        return l.getMessageHash();
      }));

      mt.generateHashTree();
      return mt;
    }

    _computeMerkleTreeWithoutHashlock(hashLockKey){
      var locks = Object.assign({}, this.pendingLocks, this.openLocks);
      delete locks[hashLockKey];

       var mt = new merkletree.MerkleTree(map(Object.values(locks)
        ,function (l) {
        return l.getMessageHash();
      }));

      mt.generateHashTree();
      return mt;
    }

    get lockedAmount(){
      return _lockAmount(Object.values(this.pendingLocks));
    }

    get unlockedAmount(){
       return _lockAmount(Object.values(this.openLocks));
    }

    _lockAmount(locksArray){
       return reduce(locksArray,function(sum,lock){
        return sum.add(lock.amount);
      }, new util.BN(0));
    }

    balance(peerState){
      throw new Error("not implemented");
    }

    transferrable(peerState){
      throw new Error("not implemented");
      this.balance(peerState).sub(this.lockedAmount);
    }

    generateLockProof(lock){
     var lockProof = this.merkleTree.generateProof(lock.getMessageHash());
     verified = merkletree.checkMerkleProof(lockProof,this.merkleTree.getRoot(),lock.hashLock);
     if(!verified){
      throw new Error("Error creating lock proof");
     }
     return lockProof;
    }

}

module.exports= {
  ChannelStateSync
};


// function ChannelState(options){
//   this.proof = options.proofMessage || new message.ProofMessage();
//   this.contractBalance = options.contractBalance || new util.BN(0);
//   this.openLocks = options.openLocks || [];
//   this.pendingLocks = options.pendingLocks || [];
//   this.merkleTree = options.merkleTree || null;

// }

// ChannelState.prototype.lockedAmount = function() {
//   return reduce(this.pendingLocks.concat(this.openLocks), function(lockedAmount,r){
//     return r.amount + lockedAmount;
//   })
// };

// ChannelState.prototype.balance = function(self, peerState){
//   return this.contractBalance - this.transferredAmount + peerState.transferredAmount;
// }

// ChannelState.prototype.merkleRootWithLock = function(lock){
//   var mt = new MerkleTree(map(this.pendingLocks.concat(this.openLocks).push(lock), function(lock){
//     return lock.pack();
//   }));
//   mt.generateHashTree();
//   return mt.getRoot();
// }

// ChannelState.prototype.merkleRootWithoutLock = function(hashLock){
//   throw new Error("Not yet implemented: merkletreeWithoutLock");
// }

// //Handle State Transitions by updating our state
// ChannelState.prototype.registerLockTransfer = function(lockTransfer){
//   var root = this.merkleRootWithLock(lock.pack());
//   assert(hashLockRoot == root);
//   this.pendingLocks.push(lock);

//   var mt = new MerkleTree(map(this.pendingLocks.concat(this.openLocks), function(lock){
//     return lock.pack();
//   }));
//   mt.generateHashTree();
//   this.merkleTree = mt;

//   this.hashLockRoot = root;
// }

// //updated transferred amount directly
// ChannelState.prototype.registerDirectTransfer = function(directTransfer){
//   assert(this.transferredAmount < transferredAmount);
//   this.transferredAmount = transferredAmount;
//   this.nonce = this.nonce + 1;
// }

// //unlocks a pending lock if it known
// ChannelState.prototype.registerSecret = function(secret){
//   var hashLock = util.sha3(secret);
//   var index = -1;
//   for(var i =0; i < this.pendingLocks.length; i++){
//     var lock = this.pendingLocks[i];
//     if(lock.hashLock === hashLock){
//       index = i;
//       break;
//     }
//   }

//   if(!index){
//     throw new Error("uknown lock secret transmitted");
//   }
//   //updates array in place returns array of popped elements
//   var pendingLock = this.pendingLocks.splice(i,1)[0];
//   pendingLocks.secret = secret;
//   this.openLocks.push(pendingLocks);
// }


// ChannelState.prototype.generateLockProof = function(hashLock){
//   var mt = new MerkleTree(map(this.pendingLocks.concat(this.openLocks), function(lock){
//     return lock.pack();
//   }));
//   mt.generateHashTree();
//   assert(mt.getRoot().eq(this.hashLockRoot));
//   //returns an array buffer to construct the proof
//   return mt.generateProof(hashLock);
// }


// /**
//  * determines a valid amount of payment that is transferrable between two endpoints of a channel.
//  * @param {ChannelState} peerState
//  */
// ChannelState.prototype.transferrable = function(self, peerState){
//   return this.balance(peerState) - this.lockedAmount();
// }



// module.exports = {ChannelState};



