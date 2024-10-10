import { Network } from "./types";

function getTxUrl(network: Network, txHash: string): string {
  return network.explorer.txUrl.replace('{item}', txHash);
}

function getBlockUrl(network: Network, height: string): string {
  return network.explorer.blockUrl.replace('{item}', height);
}

function getProposalUrl(network: Network, proposalId: number): string {
  return network.explorer.proposalUrl.replace('{item}', `${proposalId}`);
}

export { getTxUrl, getBlockUrl, getProposalUrl };
