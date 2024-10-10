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

function isCosmosSdkNewerOrEqual(a: string, b: string): boolean {
  const parseVersion = (version: string) => {
    const [main] = version.replace(/^v/, '').split('-');
    const [major, minor, patch] = main.split('.').map((x) => parseInt(x, 10));
    return { major, minor, patch };
  };

  const versionA = parseVersion(a);
  const versionB = parseVersion(b);

  if (versionA.major !== versionB.major) {
    return versionA.major > versionB.major;
  }

  if (versionA.minor !== versionB.minor) {
    return versionA.minor > versionB.minor;
  }

  return versionA.patch >= versionB.patch;
}

export { getTxUrl, getBlockUrl, getProposalUrl, isCosmosSdkNewerOrEqual };
