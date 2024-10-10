interface Network {
  name: string;
  scope: string;
  apiEndpoint: string;
  rpcEndpoint: string;
  prefix: string;
  denom: string;
  gasPrice: string;
  chainId: string;
  validatorWalletAddress: string;
  coinType?: number;
  explorer: {
    blockUrl: string;
    txUrl: string;
    proposalUrl: string;
  }
}

interface UpgradeInfo {
  name: string;
  height: string;
}

export { Network, UpgradeInfo };
