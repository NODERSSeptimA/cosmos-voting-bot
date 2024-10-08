interface Network {
  name: string;
  apiEndpoint: string;
  rpcEndpoint: string;
  prefix: string;
  denom: string;
  gasPrice: string;
  chainId: string;
  coinType?: number;
}

interface UpgradeInfo {
  name: string;
  height: string;
}

export { Network, UpgradeInfo };
