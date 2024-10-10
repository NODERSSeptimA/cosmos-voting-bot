import axios, { AxiosError } from "axios";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";

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
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {prefix});
  const [account] = await wallet.getAccounts();
  return account.address;
}

export { getActiveProposals, getCosmosSdkVersion, getWalletAddress };
