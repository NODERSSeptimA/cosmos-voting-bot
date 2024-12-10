import { bot } from './index';
import TelegramBot, { ParseMode } from 'node-telegram-bot-api';
import {
  getActiveProposals,
  getCosmosSdkVersion,
  getVoteOptionForProposal,
  getVotePermissionGrant,
  getWalletAddress,
  vote,
} from './api/cosmosApi';
import {
  getProposalId,
  getProposalStatus,
  getProposalTitle,
  getProposalType,
  getUpgradeInfo,
  getVoteMessageType,
  getVoteOptionByNumber,
  getVotingEndTime,
  isUpgradeProposal,
} from './proposalUtils';
import { escapeMarkdownV2, getUrlFromTemplate } from './utils';
import dedent from 'dedent';
import { Network } from './types';
import { getNetworks } from './api/registryApi';
import { VoteOption } from 'cosmjs-types/cosmos/gov/v1beta1/gov';
import { DeliverTxResponse } from '@cosmjs/stargate';
import { getInlineKeyboardMarkup, getVoteOptionText } from './keyboardBuilder';

const SCOPE = process.env.SCOPE || 'mainnet';
const MNEMONIC = process.env.MNEMONIC!;
const CHAT_ID = process.env.CHAT_ID!;

function registerCommandHandlers(bot: TelegramBot) {
  bot.setMyCommands([
    { command: '/networks', description: 'Show list of supported networks' },
    { command: '/active_proposals', description: 'Show active proposals' },
  ]);

  bot.onText(/\/networks/, handleNetworksCommand);
  bot.onText(/\/active_proposals/, handleActiveProposalsCommand);
  bot.on('callback_query', async (callbackQuery: TelegramBot.CallbackQuery) => {
    const [action, chainId] = callbackQuery.data!.split('__');
    const networks = await getNetworks();
    const network = networks.find((network) => network.chainId === chainId);

    if (!network) {
      await bot.sendMessage(callbackQuery.message?.chat.id!, 'Network not found for chainId: ' + chainId);
      return;
    }

    switch (action) {
      case 'network_click':
        await handleNetworkClick(callbackQuery.message!.chat.id, network);
        break;
      case 'vote_click':
        await handleVoteClick(callbackQuery, network);
        break;
      default:
        console.warn('Unknown action:', action);
    }
  });
}

async function handleNetworksCommand(msg: TelegramBot.Message) {
  const networks = await getNetworks();
  const buttons: TelegramBot.InlineKeyboardButton[][] = [];
  let row: TelegramBot.InlineKeyboardButton[] = [];

  for (const network of networks) {
    row.push({
      text: network.prettyName,
      callback_data: `network_click__${network.chainId}`,
    });
    if (row.length === 3) {
      buttons.push(row);
      row = [];
    }
  }

  if (row.length > 0) {
    buttons.push(row);
  }

  const message = dedent`
      🟢 Scope: <b>${SCOPE}</b>
      Supported networks:
    `;

  await bot.sendMessage(msg.chat.id, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

async function handleActiveProposalsCommand(msg: TelegramBot.Message) {
  const networks = await getNetworks();
  let thereAreActiveProposals = false;

  for (const network of networks) {
    const proposals = await getActiveProposals(network.endpoints.api);
    if (proposals.length > 0) {
      thereAreActiveProposals = true;
      await bot.sendMessage(msg.chat.id, `List of active proposals in <b>${network.prettyName}:</b>`, {
        parse_mode: 'HTML' as ParseMode,
      });
      for (const proposal of proposals) {
        await sendProposalMessage(network, proposal);
      }
    }
  }

  console.log('Proposals fetched.');

  if (!thereAreActiveProposals) {
    await bot.sendMessage(msg.chat.id, 'There are no active proposals in any network.');
  }
}

async function handleNetworkClick(chatId: number, network: Network) {
  const cosmosSdkVersion = await getCosmosSdkVersion(network.endpoints.api);
  const voterAddress = await getWalletAddress(MNEMONIC, network.prefix, network.coinType ?? 118);
  const voteMessageType = getVoteMessageType(cosmosSdkVersion);

  const networkDetails = await getNetworkDetails(network);
  await bot.sendMessage(chatId, networkDetails, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  const daemon = network.daemonName;
  const validatorWallet = network.validator.walletAddress;
  const grantCommand = dedent`
      ${escapeMarkdownV2(`Grant permission to vote for proposals in ${network.prettyName}:`)}
      \`\`\`\n
      ${daemon} tx authz grant ${voterAddress} generic \-\-msg-type=${voteMessageType} \-\-from ${validatorWallet} \-\-fees ${
    network.fees
  } \-y
      \`\`\`
       
      Send 1 token to voter address to pay for the fee:
      \`\`\`\n
      ${daemon} tx bank send ${validatorWallet} ${voterAddress} 1000000${
    network.denom
  } \-\-from ${validatorWallet} \-\-fees ${network.fees} \-y
      \`\`\`
    `;
  await bot.sendMessage(chatId, grantCommand, { parse_mode: 'MarkdownV2' });
}

async function getNetworkDetails(network: Network) {
  const [sdkVersion, voterAddress] = await Promise.all([
    getCosmosSdkVersion(network.endpoints.api),
    getWalletAddress(MNEMONIC, network.prefix, network.coinType ?? 118),
  ]);
  const voteMessageType = getVoteMessageType(sdkVersion);
  const votePermissionGrant = await getVotePermissionGrant(
    network.endpoints.api,
    network.validator.walletAddress,
    voterAddress,
    voteMessageType,
  );
  const accountUrl = getUrlFromTemplate(network.explorer.accountUrl, voterAddress);
  const validatorUrl = getUrlFromTemplate(network.explorer.validatorUrl, network.validator.validatorAddress);

  return dedent(`
        🌐 <b>${network.prettyName}</b>
        <b>Chain ID:</b> ${network.chainId}
        <b>SDK Version:</b> ${sdkVersion}
        <b>Valoper Address:</b> <a href="${validatorUrl}">${network.validator.validatorAddress}</a>
        <b>Voter Address:</b> <a href="${accountUrl}">${voterAddress}</a>
        <b>Vote Permission:</b> ${votePermissionGrant.length > 0 ? '🟢 Granted' : '🔴 Not granted'}
    `);
}

async function handleVoteClick(callbackQuery: TelegramBot.CallbackQuery, network: Network) {
  const [_, chainId, option, proposalId] = callbackQuery.data!.split('__');

  const voteOption = getVoteOptionByNumber(Number(option));
  const voteOptionString = getVoteOptionText(voteOption);
  const inProgressMessage = await bot.sendMessage(
    callbackQuery.message?.chat.id!,
    `⏳ Voting <b>${voteOptionString}</b> for proposal <b>#${proposalId}</b> in <b>${network.prettyName} (${network.scope})</b>`,
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
      voteOption,
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
        ...getInlineKeyboardMarkup(chainId, Number(proposalId), voteOption),
      },
      parse_mode: 'HTML' as ParseMode,
      disable_web_page_preview: true,
    };

    await bot.editMessageReplyMarkup(opts.reply_markup, opts);
    await bot.deleteMessage(inProgressMessage.chat.id, inProgressMessage.message_id);

    const txUrl = getUrlFromTemplate(network.explorer.txUrl, result.transactionHash);
    const successMessage = dedent(
      `🟢 Voted <b>${voteOptionString}</b> for proposal <b>#${proposalId}</b> in <b>${network.prettyName} (${network.scope})</b>
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
      `🔴 Error voting for proposal <b>#${proposalId}</b> in <b>${network.prettyName}:</b>
        ${result?.rawLog}`,
    );
    await bot.sendMessage(callbackQuery.message?.chat.id!, errorMessage, {
      reply_to_message_id: callbackQuery.message?.message_id,
      parse_mode: 'HTML' as ParseMode,
    });
  }
}

async function sendProposalMessage(network: Network, proposal: any) {
  const chainId = network.chainId;
  const proposalId = getProposalId(proposal);
  const proposalTitle = getProposalTitle(proposal);
  const proposalType = getProposalType(proposal);
  const proposalUrl = getUrlFromTemplate(network.explorer.proposalUrl, proposalId.toString());
  const voteOption = await getVoteOptionForProposal(network.endpoints.api, proposalId, network.validator.walletAddress);
  const votingEndsTime = getVotingEndTime(proposal);

  let message = dedent(`
    🌐 <b>Network:</b> ${network.prettyName}
    ⚖️ <b>Scope:</b> ${network.scope}
    📜 <b>Proposal ID:</b> <a href="${proposalUrl}">${proposalId}</a>
    🗳 <b>Type:</b> ${proposalType}
    📃 <b>Title:</b> <a href="${proposalUrl}">${proposalTitle}</a>
    🕓 <b>Voting ends:</b> ${votingEndsTime}
  `);

  if (isUpgradeProposal(proposal)) {
    const upgradeInfo = getUpgradeInfo(proposal);
    const blockUrl = getUrlFromTemplate(network.explorer.blockUrl, upgradeInfo.height);
    const upgradeInfoMessage = dedent(`
      🚀 <b>Upgrade Info:</b>
      <b>Name:</b> ${upgradeInfo.name}
      <b>Height:</b> <a href="${blockUrl}">${upgradeInfo.height}</a>
    `);
    message = message + '\n\n' + upgradeInfoMessage;
  }

  const opts = {
    reply_markup: {
      ...getInlineKeyboardMarkup(chainId, proposalId, voteOption),
    },
    parse_mode: 'HTML' as ParseMode,
    disable_web_page_preview: true,
  };

  await bot.sendMessage(CHAT_ID, message, opts);
}

export { registerCommandHandlers, sendProposalMessage };
