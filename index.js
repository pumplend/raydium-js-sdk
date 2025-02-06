
'use strict';

const { Connection, TransactionInstruction, PublicKey, Transaction, Keypair } = require('@solana/web3.js');
const raydium = require("@raydium-io/raydium-sdk-v2");
const { publicKey } = require('@project-serum/borsh')
var { bits, Blob, Layout, u32, UInt,blob, seq, struct, u8 } = require('buffer-layout');
var BN  = require('bn.js');
var connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const WSOL_ADDRESS =  new PublicKey("So11111111111111111111111111111111111111112") //Default devnet
class Zeros extends Blob {
  decode(b, offset) {
    const slice = super.decode(b, offset);
    if (!slice.every((v) => v === 0)) {
      throw new Error('nonzero padding bytes');
    }
    return slice;
  }
}
const zeros = function zeros(length) {
  return new Zeros(length);
}

class PublicKeyLayout extends Blob {
  constructor(property) {
    super(32, property);
  }

  decode(b, offset) {
    return new PublicKey(super.decode(b, offset));
  }

  encode(src, b, offset) {
    return super.encode(src.toBuffer(), b, offset);
  }
}
const publicKeyLayout = function publicKeyLayout(property) {
  return new PublicKeyLayout(property);
}

class BNLayout extends Blob {
  decode(b, offset) {
    return new BN(super.decode(b, offset), 10, 'le');
  }

  encode(src, b, offset) {
    return super.encode(src.toArrayLike(Buffer, 'le', this.span), b, offset);
  }
}
const u64 = function u64(property) {
  return new BNLayout(8, property);
}
const u128 = function u128(property) {
  return new BNLayout(16, property);
}

class WideBits extends Layout {
  constructor(property) {
    super(8, property);
    this._lower = bits(u32(), false);
    this._upper = bits(u32(), false);
  }

  addBoolean(property) {
    if (this._lower.fields.length < 32) {
      this._lower.addBoolean(property);
    } else {
      this._upper.addBoolean(property);
    }
  }

  decode(b, offset = 0) {
    const lowerDecoded = this._lower.decode(b, offset);
    const upperDecoded = this._upper.decode(b, offset + this._lower.span);
    return { ...lowerDecoded, ...upperDecoded };
  }

  encode(src, b, offset = 0) {
    return (
      this._lower.encode(src, b, offset) +
      this._upper.encode(src, b, offset + this._lower.span)
    );
  }
}

const VersionedLayout = class VersionedLayout extends Layout {
  constructor(version, inner, property) {
    super(inner.span > 0 ? inner.span + 1 : inner.span, property);
    this.version = version;
    this.inner = inner;
  }

  decode(b, offset = 0) {
    // if (b.readUInt8(offset) !== this._version) {
    //   throw new Error('invalid version');
    // }
    return this.inner.decode(b, offset + 1);
  }

  encode(src, b, offset = 0) {
    b.writeUInt8(this.version, offset);
    return 1 + this.inner.encode(src, b, offset + 1);
  }

  getSpan(b, offset = 0) {
    return 1 + this.inner.getSpan(b, offset + 1);
  }
}

class EnumLayout extends UInt {
  constructor(values, span, property) {
    super(span, property);
    this.values = values;
  }

  encode(src, b, offset) {
    if (this.values[src] !== undefined) {
      return super.encode(this.values[src], b, offset);
    }
    throw new Error('Invalid ' + this.property);
  }

  decode(b, offset) {
    const decodedValue = super.decode(b, offset);
    const entry = Object.entries(this.values).find(
      ([, value]) => value === decodedValue,
    );
    if (entry) {
      return entry[0];
    }
    throw new Error('Invalid ' + this.property);
  }
}
const sideLayout =  function sideLayout(property) {
  return new EnumLayout({ buy: 0, sell: 1 }, 4, property);
}
const orderTypeLayout =  function orderTypeLayout(property) {
  return new EnumLayout({ limit: 0, ioc: 1, postOnly: 2 }, 4, property);
}
const selfTradeBehaviorLayout =  function selfTradeBehaviorLayout(property) {
  return new EnumLayout(
    { decrementTake: 0, cancelProvide: 1, abortTransaction: 2 },
    4,
    property,
  );
}

const ACCOUNT_FLAGS_LAYOUT = new WideBits();
ACCOUNT_FLAGS_LAYOUT.addBoolean('initialized');
ACCOUNT_FLAGS_LAYOUT.addBoolean('market');
ACCOUNT_FLAGS_LAYOUT.addBoolean('openOrders');
ACCOUNT_FLAGS_LAYOUT.addBoolean('requestQueue');
ACCOUNT_FLAGS_LAYOUT.addBoolean('eventQueue');
ACCOUNT_FLAGS_LAYOUT.addBoolean('bids');
ACCOUNT_FLAGS_LAYOUT.addBoolean('asks');
const accountFlagsLayout = function accountFlagsLayout(property = 'accountFlags') {
  return ACCOUNT_FLAGS_LAYOUT.replicate(property);
}
const setLayoutDecoder = function setLayoutDecoder(layout, decoder) {
  const originalDecode = layout.decode;
  layout.decode = function decode(b, offset = 0) {
    return decoder(originalDecode.call(this, b, offset));
  };
}
const setLayoutEncoder = function setLayoutEncoder(layout, encoder) {
  const originalEncode = layout.encode;
  layout.encode = function encode(src, b, offset) {
    return originalEncode.call(this, encoder(src), b, offset);
  };
  return layout;
}

const TokenSwapLayout = struct([
  u8('version'),
  u8('isInitialized'),
  u8('bumpSeed'),
  publicKey('tokenProgramId'),
  publicKey('tokenAccountA'),
  publicKey('tokenAccountB'),
  publicKey('tokenPool'),
  publicKey('mintA'),
  publicKey('mintB'),
  publicKey('feeAccount'),
  u64('tradeFeeNumerator'),
  u64('tradeFeeDenominator'),
  u64('ownerTradeFeeNumerator'),
  u64('ownerTradeFeeDenominator'),
  u64('ownerWithdrawFeeNumerator'),
  u64('ownerWithdrawFeeDenominator'),
  u64('hostFeeNumerator'),
  u64('hostFeeDenominator'),
  u8('curveType'),
  // Bufferblob(32, 'curveParameters'),
]);

const AMM_INFO_LAYOUT_V4 = struct([
  u64('status'),
  u64('nonce'),
  u64('orderNum'),
  u64('depth'),
  u64('coinDecimals'),
  u64('pcDecimals'),
  u64('state'),
  u64('resetFlag'),
  u64('minSize'),
  u64('volMaxCutRatio'),
  u64('amountWaveRatio'),
  u64('coinLotSize'),
  u64('pcLotSize'),
  u64('minPriceMultiplier'),
  u64('maxPriceMultiplier'),
  u64('systemDecimalsValue'),
  // Fees
  u64('minSeparateNumerator'),
  u64('minSeparateDenominator'),
  u64('tradeFeeNumerator'),
  u64('tradeFeeDenominator'),
  u64('pnlNumerator'),
  u64('pnlDenominator'),
  u64('swapFeeNumerator'),
  u64('swapFeeDenominator'),
  // OutPutData
  u64('needTakePnlCoin'),
  u64('needTakePnlPc'),
  u64('totalPnlPc'),
  u64('totalPnlCoin'),
  u128('poolTotalDepositPc'),
  u128('poolTotalDepositCoin'),
  u128('swapCoinInAmount'),
  u128('swapPcOutAmount'),
  u64('swapCoin2PcFee'),
  u128('swapPcInAmount'),
  u128('swapCoinOutAmount'),
  u64('swapPc2CoinFee'),

  publicKey('poolCoinTokenAccount'),
  publicKey('poolPcTokenAccount'),
  publicKey('coinMintAddress'),
  publicKey('pcMintAddress'),
  publicKey('lpMintAddress'),
  publicKey('ammOpenOrders'),
  publicKey('serumMarket'),
  publicKey('serumProgramId'),
  publicKey('ammTargetOrders'),
  publicKey('poolWithdrawQueue'),
  publicKey('poolTempLpTokenAccount'),
  publicKey('ammOwner'),
  publicKey('pnlOwner')
])

const MARKET_STATE_LAYOUT_V3 = struct([
    blob(5),
  
    accountFlagsLayout('accountFlags'),
  
    publicKeyLayout('ownAddress'),
  
    u64('vaultSignerNonce'),
  
    publicKeyLayout('baseMint'),
    publicKeyLayout('quoteMint'),
  
    publicKeyLayout('baseVault'),
    u64('baseDepositsTotal'),
    u64('baseFeesAccrued'),
  
    publicKeyLayout('quoteVault'),
    u64('quoteDepositsTotal'),
    u64('quoteFeesAccrued'),
  
    u64('quoteDustThreshold'),
  
    publicKeyLayout('requestQueue'),
    publicKeyLayout('eventQueue'),
  
    publicKeyLayout('bids'),
    publicKeyLayout('asks'),
  
    u64('baseLotSize'),
    u64('quoteLotSize'),
  
    u64('feeRateBps'),
  
    u64('referrerRebatesAccrued'),
  
    publicKeyLayout('authority'),
    publicKeyLayout('pruneAuthority'),
  
    blob(1024),
  
    blob(7),
  ]);


async function getAMMInfo(AmmId) {
    var ammIdAccounts = await connection.getAccountInfo(AmmId);
    var AccountInfoDecode = AMM_INFO_LAYOUT_V4.decode(Buffer.from(ammIdAccounts.data))
    return AccountInfoDecode
  }
async function getMarketInfo(SerumMarket) {
    var getMarket = await connection.getAccountInfo(SerumMarket);
    var marketDecode = MARKET_STATE_LAYOUT_V3.decode(Buffer.from(getMarket.data))
    return marketDecode
  }


async function example() {
  
  const AmmId = new PublicKey('885XNKURTvUzw8CcrM6oGnjP2wht5VgA4U7P44ExHvc9')
  return  await addressFetch(AmmId , new PublicKey(0), new PublicKey(0), new PublicKey(0),connection)
}





async function addressFetch(AmmId , UserOwner , inTokenAccount ,outTokenAccount, connections = connection ,network = "devnet" , ProgramId = null) {
  connection = connections
  let Amm_Authority = new PublicKey('DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC')  
  if(network == "devnet")
  {
    Amm_Authority = new PublicKey('DbQqP6ehDYmeYjcBaMRuA8tAJY1EjDUz9DpwSLjaQqfC')
  }else{
    Amm_Authority = new PublicKey('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1')
  }
  var AccountInfoDecode = await getAMMInfo(AmmId)
  var AmmAuthority = Amm_Authority
  var AmmOpenOrders = AccountInfoDecode.ammOpenOrders
  var AmmTargetOrders = AccountInfoDecode.ammTargetOrders
  var PoolCoinTokenAccount = AccountInfoDecode.poolCoinTokenAccount
  var PoolPcTokenAccount = AccountInfoDecode.poolPcTokenAccount

  var SerumProgramId = new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin')
  if(ProgramId)
    {
      SerumProgramId = ProgramId
    }
  var SerumMarket = AccountInfoDecode.serumMarket
  var MarketInfoDecode = await getMarketInfo(SerumMarket)
  var SerumBids = MarketInfoDecode.bids
  var SerumAsks = MarketInfoDecode.asks
  var SerumEventQueue = MarketInfoDecode.eventQueue
  var SerumCoinVaultAccount = MarketInfoDecode.baseVault
  var SerumPcVaultAccount = MarketInfoDecode.quoteVault
  var SerumVaultSigner = UserOwner
  var UserOwner = UserOwner

  var UserSourceTokenAccount = inTokenAccount
  var UserDestTokenAccount = outTokenAccount

  return     {
    AmmId,
    AmmAuthority,
    AmmOpenOrders,
    AmmTargetOrders,
    PoolCoinTokenAccount,
    PoolPcTokenAccount,
    SerumProgramId,
    SerumMarket,
    SerumBids,
    SerumAsks,
    SerumEventQueue,
    SerumCoinVaultAccount,
    SerumPcVaultAccount,
    SerumVaultSigner,
    UserSourceTokenAccount,
    UserDestTokenAccount
}
}

async function fetchPoolByMintsMainnet(mintA, mintB) {
  const r = await raydium.Raydium.load(
    {
        connection:connection,
        cluster: "mainnet",
        disableFeatureCheck: true,
        disableLoadToken: true,
        blockhashCommitment: "confirmed",
    }
  )
  try {
    const poolData = await r.api.fetchPoolByMints({
      mint1: mintA,
      mint2: mintB
    });

    if (poolData) {
      return poolData;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Failed to fetch pools", error);
    throw error;
  }
}

async function getPoolsForToken(targetMintAddress,poolProgramId = new PublicKey("HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8"),network = "devnet")
{
  if(network == "devnet")
  {
    let target = [];
    try {
      const accounts = await connection.getProgramAccounts(poolProgramId);
      const targetPools = accounts.filter(account => {
        const poolData = account.account.data;
        return poolData.includes(targetMintAddress.toBuffer());
      });
      
      if (targetPools.length > 0) {
        targetPools.forEach(pool => {
          target.push(pool.pubkey)
        });
      } 
    } catch (error) {
      return false;
    }
    return target
  }else{
    
    //Do it via mainnet
    try{
      return await fetchPoolByMintsMainnet(WSOL_ADDRESS, targetMintAddress)
    }catch(e)
    {
      return false;
    }
  }
};
async function getDefaultPool(targetMintAddress,poolProgramId = new PublicKey("HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8"),network = "devnet")
{
  const find = await getPoolsForToken(targetMintAddress,poolProgramId,network)
  if(network == "devnet")
  {
    return find
  }else{
    if(!find || !find?.data || find.data?.length == 0)
    {
      return false;
    }
    let final ; 
    const tmp = []
    find.data.forEach(ele => {
      if(ele.type == "Standard")
      {
        //Find the max tvl standard pool
        tmp.push(ele)
        if(!final || ele.tvl >= final?.tvl)
        {
          final = tmp[0]
        }
      }
    });

    if(!final)
    {
      return false;
    }
    return [
      new PublicKey(final.id)
    ];
  }

}


module.exports = 
{
  example,
  addressFetch,
  getPoolsForToken,
  getDefaultPool
}