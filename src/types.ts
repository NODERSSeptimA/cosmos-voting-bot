export interface Network {
  name: string;
  rpcEndpoint: string;
  prefix: string;
  denom: string;
  gasPrice: string;
  chainId: string;
  coinType?: number;
}
