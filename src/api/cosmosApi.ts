import axios, { AxiosError } from 'axios';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';

async function getActiveProposals(apiEndpoint: string): Promise<any[]> {
  let response;
  let errorMessage;
  try {
    response = await axios.get(`${apiEndpoint}/cosmos/gov/v1/proposals?proposal_status=2`);
    return response.data.proposals;
  } catch (error: AxiosError | any) {
    errorMessage = error.message;
  }

  try {
    response = await axios.get(`${apiEndpoint}/cosmos/gov/v1beta1/proposals?proposal_status=2`);
    return response.data.proposals;
  } catch (error: AxiosError | any) {
    errorMessage = error.message;
  }

  console.error(`Error fetching proposals from ${apiEndpoint}:`, errorMessage);
  return [];
}

async function getCosmosSdkVersion(apiEndpoint: string): Promise<string> {
  let errorMessage;
  try {
    const response = await axios.get(`${apiEndpoint}/cosmos/base/tendermint/v1beta1/node_info`);
    return response.data.application_version.cosmos_sdk_version;
  } catch (error: AxiosError | any) {
    errorMessage = error.message;
  }

  console.error(`Error fetching version from ${apiEndpoint}:`, errorMessage);
  return 'Unknown';
}

async function getWalletAddress(mnemonic: string, prefix: string, coinType: number): Promise<string> {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix });
  const [account] = await wallet.getAccounts();
  return account.address;
}

async function getVoteOptionForProposal(
  apiEndpoint: string,
  proposalId: number,
  walletAddress: string,
): Promise<string> {
  let errorMessage;
  try {
    const response = await axios.get(`${apiEndpoint}/cosmos/gov/v1/proposals/${proposalId}/votes/${walletAddress}`);
    return response.data.vote.options[0].option;
  } catch (error: AxiosError | any) {
    errorMessage = error.message;
  }

  try {
    const response = await axios.get(
      `${apiEndpoint}/cosmos/gov/v1beta1/proposals/${proposalId}/votes/${walletAddress}`,
    );
    return response.data.vote.options[0].option;
  } catch (error: AxiosError | any) {
    errorMessage = error.message;
  }

  console.error(`Error fetching vote for proposal ${proposalId} from ${apiEndpoint}:`, errorMessage);
  return 'Unknown';
}

async function getVotePermissionGrant(
  apiEndpoint: string,
  validatorWalletAddress: string,
  voterAddress: string,
  voteMessageType: string,
): Promise<any[]> {
  let errorMessage;
  try {
    const response = await axios.get(`${apiEndpoint}/cosmos/authz/v1beta1/grants`, {
      headers: {
        'Content-Type': 'application/json',
      },
      params: {
        granter: validatorWalletAddress,
        grantee: voterAddress,
        msg_type_url: voteMessageType,
      },
    });
    return response.data.grants;
  } catch (error: AxiosError | any) {
    errorMessage = error.message;
  }

  console.error(`Error fetching vote permission for ${voterAddress} from ${apiEndpoint}:`, errorMessage);
  return [];
}

export { getActiveProposals, getCosmosSdkVersion, getWalletAddress, getVoteOptionForProposal, getVotePermissionGrant };
