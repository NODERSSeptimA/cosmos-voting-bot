interface Network {
  name: string;
  prettyName: string;
  scope: string;
  daemonName: string;
  prefix: string;
  denom: string;
  fees: string;
  gasPrice: string;
  chainId: string;
  coinType?: number;
  validator: {
    walletAddress: string;
    validatorAddress: string;
  };
  endpoints: {
    api: string;
    rpc: string;
  };
  explorer: {
    accountUrl: string;
    blockUrl: string;
    txUrl: string;
    proposalUrl: string;
  };
}

interface UpgradeInfo {
  name: string;
  height: string;
}

export { Network, UpgradeInfo };
