'use strict';
// Definicje obsługiwanych walut i sieci. Żadna nie jest aktywna domyślnie —
// każdą trzeba skonfigurować i przetestować w panelu (Ustawienia → Płatności).

const ASSETS = {
  BTC: {
    code: 'BTC', symbol: 'BTC', name: 'Bitcoin', network: 'Bitcoin', kind: 'utxo', decimals: 8,
    coingecko: 'bitcoin', utxoNet: 'btc', apiBase: 'https://mempool.space/api', defaultConfirmations: 2,
    explorerTx: 'https://mempool.space/tx/', nowpayments: 'btc', uri: 'bitcoin', icon: 'btc',
  },
  LTC: {
    code: 'LTC', symbol: 'LTC', name: 'Litecoin', network: 'Litecoin', kind: 'utxo', decimals: 8,
    coingecko: 'litecoin', utxoNet: 'ltc', apiBase: 'https://litecoinspace.org/api', defaultConfirmations: 4,
    explorerTx: 'https://litecoinspace.org/tx/', nowpayments: 'ltc', uri: 'litecoin', icon: 'ltc',
  },
  ETH: {
    code: 'ETH', symbol: 'ETH', name: 'Ethereum', network: 'Ethereum (ERC-20)', kind: 'evm-native', decimals: 18,
    coingecko: 'ethereum', chainId: 1, rpc: 'https://ethereum-rpc.publicnode.com', defaultConfirmations: 12,
    explorerTx: 'https://etherscan.io/tx/', nowpayments: 'eth', tagDecimals: 8, roundDecimals: 4, icon: 'eth',
  },
  USDT_ERC20: {
    code: 'USDT_ERC20', symbol: 'USDT', name: 'Tether', network: 'Ethereum (ERC-20)', kind: 'evm-token', decimals: 6,
    coingecko: 'tether', chainId: 1, rpc: 'https://ethereum-rpc.publicnode.com',
    contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', defaultConfirmations: 12,
    explorerTx: 'https://etherscan.io/tx/', nowpayments: 'usdterc20', tagDecimals: 6, roundDecimals: 2, icon: 'usdt',
  },
  USDC_ERC20: {
    code: 'USDC_ERC20', symbol: 'USDC', name: 'USD Coin', network: 'Ethereum (ERC-20)', kind: 'evm-token', decimals: 6,
    coingecko: 'usd-coin', chainId: 1, rpc: 'https://ethereum-rpc.publicnode.com',
    contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', defaultConfirmations: 12,
    explorerTx: 'https://etherscan.io/tx/', nowpayments: 'usdc', tagDecimals: 6, roundDecimals: 2, icon: 'usdc',
  },
  USDT_TRC20: {
    code: 'USDT_TRC20', symbol: 'USDT', name: 'Tether', network: 'Tron (TRC-20)', kind: 'tron-token', decimals: 6,
    coingecko: 'tether', apiBase: 'https://api.trongrid.io', contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    defaultConfirmations: 1, explorerTx: 'https://tronscan.org/#/transaction/', nowpayments: 'usdttrc20',
    tagDecimals: 6, roundDecimals: 2, icon: 'usdt',
  },
  USDT_BEP20: {
    code: 'USDT_BEP20', symbol: 'USDT', name: 'Tether', network: 'BNB Smart Chain (BEP-20)', kind: 'evm-token', decimals: 18,
    coingecko: 'tether', chainId: 56, rpc: 'https://bsc-rpc.publicnode.com',
    contract: '0x55d398326f99059fF775485246999027B3197955', defaultConfirmations: 15,
    explorerTx: 'https://bscscan.com/tx/', nowpayments: 'usdtbsc', tagDecimals: 6, roundDecimals: 2, icon: 'usdt',
  },
  USDT_POLYGON: {
    code: 'USDT_POLYGON', symbol: 'USDT', name: 'Tether', network: 'Polygon', kind: 'evm-token', decimals: 6,
    coingecko: 'tether', chainId: 137, rpc: 'https://polygon-bor-rpc.publicnode.com',
    contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', defaultConfirmations: 64,
    explorerTx: 'https://polygonscan.com/tx/', nowpayments: 'usdtmatic', tagDecimals: 6, roundDecimals: 2, icon: 'usdt',
  },
  USDC_POLYGON: {
    code: 'USDC_POLYGON', symbol: 'USDC', name: 'USD Coin', network: 'Polygon', kind: 'evm-token', decimals: 6,
    coingecko: 'usd-coin', chainId: 137, rpc: 'https://polygon-bor-rpc.publicnode.com',
    contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', defaultConfirmations: 64,
    explorerTx: 'https://polygonscan.com/tx/', nowpayments: 'usdcmatic', tagDecimals: 6, roundDecimals: 2, icon: 'usdc',
  },
  BTC_TESTNET: {
    code: 'BTC_TESTNET', symbol: 'tBTC', name: 'Bitcoin Testnet4', network: 'Testnet4 — tylko do testów', kind: 'utxo',
    decimals: 8, coingecko: 'bitcoin', utxoNet: 'btc-test', apiBase: 'https://mempool.space/testnet4/api',
    defaultConfirmations: 1, explorerTx: 'https://mempool.space/testnet4/tx/', testnet: true, uri: 'bitcoin', icon: 'btc',
    directOnly: true,
  },
};

// Domyślna konfiguracja każdej sieci (zapisywana w ustawieniach jako asset.<KOD>)
function defaultConfig(asset) {
  return {
    enabled: false,
    provider: asset.directOnly ? 'direct' : 'direct',
    xpub: '',
    scriptType: 'auto',
    address: '',
    confirmations: asset.defaultConfirmations,
    apiBase: asset.apiBase || '',
    rpc: asset.rpc || '',
    verifiedAt: null,
    verifiedFingerprint: null,
  };
}

module.exports = { ASSETS, defaultConfig, list: () => Object.values(ASSETS) };
