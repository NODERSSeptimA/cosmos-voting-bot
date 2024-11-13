import axios, { AxiosError } from 'axios';
import { DirectSecp256k1HdWallet, parseCoins } from '@cosmjs/proto-signing';
import { VoteOption } from 'cosmjs-types/cosmos/gov/v1beta1/gov';
import { getVoteMessageType, getVoteOptionByString } from '../proposalUtils';
import { DeliverTxResponse, SigningStargateClient } from '@cosmjs/stargate';
import { MsgVote } from 'cosmjs-types/cosmos/gov/v1/tx';
import { getVoteOptionText } from '../keyboardBuilder';

const MNEMONIC = process.env.MNEMONIC!;

async function vote(
  validatorWalletAddress: string,
  rpcEndpoint: string,
  prefix: string,
  proposalId: number,
  voteOption: VoteOption,
  cosmosSdkVersion: string,
  coinType: number,
  fees: string,
) {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, { prefix });
  const [account] = await wallet.getAccounts();
  const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet);

  console.log(
    `Voting for proposal #${proposalId} with option "${getVoteOptionText(voteOption)}" from account ${
      account.address
    } using rpc: ${rpcEndpoint}`,
  );

  const messageType = getVoteMessageType(cosmosSdkVersion);
  const voteMsg = {
    typeUrl: messageType,
    value: MsgVote.encode(
      MsgVote.fromPartial({
        proposalId: proposalId as any,
        voter: validatorWalletAddress,
        option: voteOption,
      }),
    ).finish(),
  };

  const execMsg = {
    typeUrl: '/cosmos.authz.v1beta1.MsgExec',
    value: {
      grantee: account.address,
      msgs: [voteMsg],
    },
  };

  const gasEstimation = await client.simulate(account.address, [execMsg], undefined);
  const adjustedGas = Math.floor(gasEstimation * 2);
  try {
    const result = await client.signAndBroadcast(account.address, [execMsg], {
      amount: parseCoins(fees),
      gas: adjustedGas.toString(),
    });
    console.log('Transaction result:', result.rawLog);
    return result;
  } catch (error: any) {
    console.error('Error signing and broadcasting vote:', error.message);
    return {
      code: 1,
      rawLog: error.message,
    } as DeliverTxResponse;
  }
}

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
): Promise<VoteOption> {
  let errorMessage;
  try {
    const response = await axios.get(`${apiEndpoint}/cosmos/gov/v1/proposals/${proposalId}/votes/${walletAddress}`);
    return getVoteOptionByString(response.data.vote.options[0].option);
  } catch (error: AxiosError | any) {
    errorMessage = error.message;
  }

  try {
    const response = await axios.get(
      `${apiEndpoint}/cosmos/gov/v1beta1/proposals/${proposalId}/votes/${walletAddress}`,
    );
    return getVoteOptionByString(response.data.vote.options[0].option);
  } catch (error: AxiosError | any) {
    errorMessage = error.message;
  }

  console.error(`Error fetching vote for proposal ${proposalId} from ${apiEndpoint}:`, errorMessage);
  return VoteOption.UNRECOGNIZED;
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

export {
  vote,
  getActiveProposals,
  getCosmosSdkVersion,
  getWalletAddress,
  getVoteOptionForProposal,
  getVotePermissionGrant,
};
