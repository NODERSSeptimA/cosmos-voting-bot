import TelegramBot, { ParseMode } from 'node-telegram-bot-api';
import { DeliverTxResponse, SigningStargateClient } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet, parseCoins, Registry } from '@cosmjs/proto-signing';
import dedent from 'dedent';
import 'dotenv/config';
import { Network } from './types';
import {
  getProposalId,
  getProposalTitle,
  getProposalType,
  getUpgradeInfo,
  getVotingEndTime,
  isUpgradeProposal,
} from './proposalUtils';
import { getUrlFromTemplate, getVoteMessageType } from './utils';
import { getActiveProposals, getCosmosSdkVersion, getVoteOptionForProposal } from './api/cosmosApi';
import { checkProposalExists, connectDb, saveProposal } from './database';
import { getNetworks } from './api/registryApi';
import { registerCommandHandlers } from './commandHandler';

import { MsgVote } from 'cosmjs-types/cosmos/gov/v1/tx';
import { MsgExec } from 'cosmjs-types/cosmos/authz/v1beta1/tx';
import { VoteOption } from 'cosmjs-types/cosmos/gov/v1beta1/gov';

const MNEMONIC = process.env.MNEMONIC!;
const FETCH_INTERVAL_MS = parseInt(process.env.FETCH_INTERVAL_MS || '60000');

// Telegram Bot configuration
const BOT_TOKEN = process.env.BOT_TOKEN!;
const CHAT_ID = process.env.CHAT_ID!;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const registry = new Registry();
registry.register('/cosmos.authz.v1beta1.MsgExec', MsgExec);
registry.register('/cosmos.gov.v1.MsgVote', MsgVote);

enum VoteOptions {
  VOTE_OPTION_YES = 'VOTE_OPTION_YES',
  VOTE_OPTION_NO = 'VOTE_OPTION_NO',
  VOTE_OPTION_NO_WITH_VETO = 'VOTE_OPTION_NO_WITH_VETO',
  VOTE_OPTION_ABSTAIN = 'VOTE_OPTION_ABSTAIN',
}

enum VoteButtons {
  VOTE_OPTION_YES = '👍 Yes',
  VOTE_OPTION_NO = '👎 No',
  VOTE_OPTION_NO_WITH_VETO = '❌ No with Veto',
  VOTE_OPTION_ABSTAIN = '🤷‍♂️ Abstain',
}

function getInlineKeyboardMarkup(
  chainId: string,
  proposalId: number,
  option: string,
): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text:
            option === VoteOptions.VOTE_OPTION_YES
              ? `✅ VOTED: ${VoteButtons.VOTE_OPTION_YES}`
              : VoteButtons.VOTE_OPTION_YES,
          callback_data: `vote__${chainId}__${VoteOptions.VOTE_OPTION_YES}__${proposalId}`,
        },
        {
          text:
            option === VoteOptions.VOTE_OPTION_NO
              ? `✅ VOTED: ${VoteButtons.VOTE_OPTION_NO}`
              : VoteButtons.VOTE_OPTION_NO,
          callback_data: `vote__${chainId}__${VoteOptions.VOTE_OPTION_NO}__${proposalId}`,
        },
      ],
      [
        {
          text:
            option === VoteOptions.VOTE_OPTION_NO_WITH_VETO
              ? `✅ VOTED: ${VoteButtons.VOTE_OPTION_NO_WITH_VETO}`
              : VoteButtons.VOTE_OPTION_NO_WITH_VETO,
          callback_data: `vote__${chainId}__${VoteOptions.VOTE_OPTION_NO_WITH_VETO}__${proposalId}`,
        },
        {
          text:
            option === VoteOptions.VOTE_OPTION_ABSTAIN
              ? `✅ VOTED: ${VoteButtons.VOTE_OPTION_ABSTAIN}`
              : VoteButtons.VOTE_OPTION_ABSTAIN,
          callback_data: `vote__${chainId}__${VoteOptions.VOTE_OPTION_ABSTAIN}__${proposalId}`,
        },
      ],
    ],
  };
}

async function vote(
  validatorWalletAddress: string,
  rpcEndpoint: string,
  prefix: string,
  proposalId: number,
  option: string,
  cosmosSdkVersion: string,
  coinType: number,
  fees: string,
) {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, { prefix });
  const [account] = await wallet.getAccounts();
  const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet);

  console.log(
    `Voting for proposal #${proposalId} with option "${option}" from account ${account.address} using rpc: ${rpcEndpoint}`,
  );

  let voteOption;
  switch (option) {
    case VoteOptions.VOTE_OPTION_YES:
      voteOption = VoteOption.VOTE_OPTION_YES;
      break;
    case VoteOptions.VOTE_OPTION_ABSTAIN:
      voteOption = VoteOption.VOTE_OPTION_ABSTAIN;
      break;
    case VoteOptions.VOTE_OPTION_NO:
      voteOption = VoteOption.VOTE_OPTION_NO;
      break;
    case VoteOptions.VOTE_OPTION_NO_WITH_VETO:
      voteOption = VoteOption.VOTE_OPTION_NO_WITH_VETO;
      break;
  }

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

async function sendProposalMessage(network: Network, proposal: any) {
  const chainId = network.chainId;
  const proposalId = getProposalId(proposal);
  const proposalTitle = getProposalTitle(proposal);
  const proposalType = getProposalType(proposal);
  const proposalUrl = getUrlFromTemplate(network.explorer.proposalUrl, proposalId.toString());
  const option = await getVoteOptionForProposal(network.endpoints.api, proposalId, network.validator.walletAddress);
  const votingEndsTime = getVotingEndTime(proposal);

  let message = dedent(`
    🌐 <b>Network:</b> ${network.prettyName}
    ⚖️ <b>Scope:</b> ${network.scope}
    📜 <b>Proposal ID:</b> <a href="${proposalUrl}">${proposalId}</a>
    🗳 <b>Type:</b> ${proposalType}
    📃 <b>Title:</b> <a href="${proposalUrl}">${proposalTitle}</a>
    🕓 <b>Voting ends:</b> ${votingEndsTime}
    🗳 <b>Your vote:</b> ${option}    
  `);

  if (isUpgradeProposal(proposal)) {
    const upgradeInfo = getUpgradeInfo(proposal);
    const blockUrl = getUrlFromTemplate(network.explorer.blockUrl, upgradeInfo.height);
    const upgradeInfoMessage = dedent(`
      🚀<b>Upgrade Info:</b>
      <b>Name:</b> ${upgradeInfo.name}
      <b>Height:</b> <a href="${blockUrl}">${upgradeInfo.height}</a>
    `);
    message = message + '\n\n' + upgradeInfoMessage;
  }

  const opts = {
    reply_markup: {
      ...getInlineKeyboardMarkup(chainId, proposalId, option),
    },
    parse_mode: 'HTML' as ParseMode,
    disable_web_page_preview: true,
  };

  await bot.sendMessage(CHAT_ID, message, opts);
}

async function handleVoteCommand(callbackQuery: TelegramBot.CallbackQuery, network: Network) {
  const [action, chainId, option, proposalId] = callbackQuery.data!.split('__');

  const inProgressMessage = await bot.sendMessage(
    callbackQuery.message?.chat.id!,
    `⏳ Voting <b>${option}</b> for proposal <b>#${proposalId}</b> in <b>${network.name} (${network.scope})</b>`,
    {
      reply_to_message_id: callbackQuery.message?.message_id,
      parse_mode: 'HTML' as ParseMode,
    },
  );

  const cosmosSdkVersion = await getCosmosSdkVersion(network.endpoints.api);
  const coinType = network.coinType ?? 118; // TODO: add support of coin type

  let result;
  try {
    result = await vote(
      network.validator.walletAddress,
      network.endpoints.rpc,
      network.prefix,
      Number(proposalId),
      option,
      cosmosSdkVersion,
      coinType,
      network.fees,
    );
  } catch (e: any) {
    console.error('Error voting:', e);
    result = {
      code: 1,
      rawLog: e?.message,
    } as DeliverTxResponse;
  }

  if (result && result.code === 0) {
    const opts = {
      chat_id: callbackQuery.message?.chat.id!,
      message_id: callbackQuery.message?.message_id,
      reply_markup: {
        ...getInlineKeyboardMarkup(chainId, Number(proposalId), option),
      },
      parse_mode: 'HTML' as ParseMode,
      disable_web_page_preview: true,
    };

    await bot.editMessageReplyMarkup(opts.reply_markup, opts);
    await bot.deleteMessage(inProgressMessage.chat.id, inProgressMessage.message_id);

    const txUrl = getUrlFromTemplate(network.explorer.txUrl, result.transactionHash);
    const successMessage = dedent(
      `🟩 Voted <b>${option}</b> for proposal <b>#${proposalId}</b> in <b>${network.name} (${network.scope})</b>
        TX hash: <a href="${txUrl}">${result.transactionHash}</a>`,
    );
    await bot.sendMessage(callbackQuery.message?.chat.id!, successMessage, {
      reply_to_message_id: callbackQuery.message?.message_id,
      parse_mode: 'HTML' as ParseMode,
      disable_web_page_preview: true,
    });
  } else {
    await bot.deleteMessage(inProgressMessage.chat.id, inProgressMessage.message_id);
    const errorMessage = dedent(
      `🟥 Error voting for proposal <b>#${proposalId}</b> in <b>${network.name}:</b>
        ${result?.rawLog}`,
    );
    await bot.sendMessage(callbackQuery.message?.chat.id!, errorMessage, {
      reply_to_message_id: callbackQuery.message?.message_id,
      parse_mode: 'HTML' as ParseMode,
    });
  }
}

async function fetchNewActiveProposals() {
  console.log('Fetching active proposals from networks...');
  const networks = await getNetworks();

  console.log('Networks:', networks.map((network) => `${network.name}(${network.scope})`).join(', '));

  for (const network of networks) {
    console.log(`Fetching proposals for ${network.name} (${network.scope}). ChainID: ${network.chainId} ...`);
    const chainId = network.chainId;
    const proposals = await getActiveProposals(network.endpoints.api);
    for (const proposal of proposals) {
      const proposalId = getProposalId(proposal);
      const exists = await checkProposalExists(chainId, proposalId);
      if (!exists) {
        await sendProposalMessage(network, proposal);
        saveProposal(chainId, proposalId);
      }
    }
  }
  console.log('Done. Proposals fetched.');
}

connectDb().then(async () => {
  console.log('Bot is running...');

  setInterval(async () => {
    await fetchNewActiveProposals();
  }, FETCH_INTERVAL_MS);

  registerCommandHandlers(bot);
});

export { bot, handleVoteCommand, sendProposalMessage };
