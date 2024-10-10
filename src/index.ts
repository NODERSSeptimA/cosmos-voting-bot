import TelegramBot, { ParseMode } from 'node-telegram-bot-api';
import { DeliverTxResponse, GasPrice, makeCosmoshubPath, SigningStargateClient } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import dedent from 'dedent';
import 'dotenv/config';
import * as fs from 'fs';
import { Network } from './types';
import { checkProposalExists, connectDb, getVoteOptionForProp, saveProposal, saveVote } from './database';
import {
  getProposalId,
  getProposalStatus,
  getProposalTitle,
  getProposalType,
  getUpgradeInfo,
  getVotingEndTime,
  isUpgradeProposal,
} from './proposalUtils';
import { getBlockUrl, getProposalUrl, getTxUrl, isCosmosSdkNewerOrEqual } from './utils';
import { getActiveProposals, getCosmosSdkVersion, getWalletAddress } from './cosmosApi';

const MNEMONIC = process.env.MNEMONIC!;
const FETCH_INTERVAL_MS = parseInt(process.env.FETCH_INTERVAL_MS || '60000');

// Telegram Bot configuration
const BOT_TOKEN = process.env.BOT_TOKEN!;
const CHAT_ID = process.env.CHAT_ID!;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let networks: Network[] = [];

enum VoteButtons {
  YES = '👍 Yes',
  NO = '👎 No',
  NO_WITH_VETO = '❌ No with Veto',
  ABSTAIN = '🤷‍♂️ Abstain',
}

function getInlineKeyboardMarkup(
  chainId: string,
  proposalId: number,
  option: string | undefined,
): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: option === 'yes' ? `✅ VOTED: ${VoteButtons.YES}` : VoteButtons.YES,
          callback_data: `vote__yes__${chainId}__${proposalId}`,
        },
        {
          text: option === 'no' ? `✅ VOTED: ${VoteButtons.NO}` : VoteButtons.NO,
          callback_data: `vote__no__${chainId}__${proposalId}`,
        },
      ],
      [
        {
          text: option === 'veto' ? `✅ VOTED: ${VoteButtons.NO_WITH_VETO}` : VoteButtons.NO_WITH_VETO,
          callback_data: `vote__veto__${chainId}__${proposalId}`,
        },
        {
          text: option === 'abstain' ? `✅ VOTED: ${VoteButtons.ABSTAIN}` : VoteButtons.ABSTAIN,
          callback_data: `vote__abstain__${chainId}__${proposalId}`,
        },
      ],
    ],
  };
}

async function vote(
  validatorWalletAddress: string,
  rpcEndpoint: string,
  prefix: string,
  gasPriceString: string,
  proposalId: number,
  option: string,
  cosmosSdkVersion: string,
  coinType: number,
) {
  const hdPath = makeCosmoshubPath(coinType);
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, { prefix });
  const [account] = await wallet.getAccounts();
  const gasPrice = GasPrice.fromString(gasPriceString);
  const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet, { gasPrice });

  console.log(
    `Voting for proposal #${proposalId} with option "${option}" from account ${account.address} using rpc: ${rpcEndpoint}`,
  );

  let voteOption;
  switch (option) {
    case 'yes':
      voteOption = 1;
      break;
    case 'no':
      voteOption = 3;
      break;
    case 'veto':
      voteOption = 4;
      break;
    case 'abstain':
      voteOption = 2;
      break;
  }

  const messageType = isCosmosSdkNewerOrEqual(cosmosSdkVersion, 'v0.47.0')
    ? '/cosmos.gov.v1.MsgVote'
    : '/cosmos.gov.v1beta1.MsgVote';
  const voteMsg = {
    typeUrl: messageType,
    value: {
      proposalId: proposalId,
      voter: validatorWalletAddress,
      option: voteOption,
    },
  };

  const execMsg = {
    typeUrl: '/cosmos.authz.v1beta1.MsgExec',
    value: {
      grantee: account.address,
      msgs: [voteMsg],
    },
  };

  try {
    const result = await client.signAndBroadcast(account.address, [execMsg], 'auto');
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
  const proposalUrl = getProposalUrl(network, proposalId);
  const option = await getVoteOptionForProp(chainId, proposalId);
  const votingEndsTime = getVotingEndTime(proposal);

  let message = dedent(`
    🌐 <b>Network:</b> ${network.name}
    ⚖️ <b>Scope:</b> ${network.scope}
    📜 <b>Proposal ID:</b> <a href="${proposalUrl}">${proposalId}</a>
    🗳 <b>Type:</b> ${proposalType}
    📃 <b>Title:</b> <a href="${proposalUrl}">${proposalTitle}</a>
    🕓 <b>Voting ends:</b> ${votingEndsTime}
  `);

  if (isUpgradeProposal(proposal)) {
    const upgradeInfo = getUpgradeInfo(proposal);
    const blockUrl = getBlockUrl(network, upgradeInfo.height);
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

// Button click handler
bot.on('callback_query', async (callbackQuery: TelegramBot.CallbackQuery) => {
  const [action, option, chainId, proposalId] = callbackQuery.data!.split('__');

  if (action === 'vote') {
    const network = networks.find((network) => network.chainId === chainId);
    if (!network) {
      await bot.sendMessage(callbackQuery.message?.chat.id!, 'Network not found for chainId: ' + chainId);
      return;
    }

    const inProgressMessage = await bot.sendMessage(
      callbackQuery.message?.chat.id!,
      `⏳ Voting <b>${option}</b> for proposal <b>#${proposalId}</b> in <b>${network.name} (${network.scope})</b>`,
      {
        reply_to_message_id: callbackQuery.message?.message_id,
        parse_mode: 'HTML' as ParseMode,
      },
    );

    const cosmosSdkVersion = await getCosmosSdkVersion(network.apiEndpoint);
    const coinType = network.coinType ?? 118; // TODO: add support of coin type
    const result = await vote(
      network.validatorWalletAddress,
      network.rpcEndpoint,
      network.prefix,
      network.gasPrice,
      Number(proposalId),
      option,
      cosmosSdkVersion,
      coinType,
    );
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

      const txUrl = getTxUrl(network, result.transactionHash);
      const successMessage = dedent(
        `🟩 Voted <b>${option}</b> for proposal <b>#${proposalId}</b> in <b>${network.name} (${network.scope})</b>
        TX hash: <a href="${txUrl}">${result.transactionHash}</a>`,
      );
      await bot.sendMessage(callbackQuery.message?.chat.id!, successMessage, {
        reply_to_message_id: callbackQuery.message?.message_id,
        parse_mode: 'HTML' as ParseMode,
        disable_web_page_preview: true,
      });

      await saveVote(chainId, Number(proposalId), option);
    } else {
      await bot.deleteMessage(inProgressMessage.chat.id, inProgressMessage.message_id);
      const errorMessage = dedent(
        `🟥 Error voting for proposal <b>#${proposalId}</b> in <b>${network.name}:</b>
        ${result.rawLog}`,
      );
      await bot.sendMessage(callbackQuery.message?.chat.id!, errorMessage, {
        reply_to_message_id: callbackQuery.message?.message_id,
        parse_mode: 'HTML' as ParseMode,
      });
    }
  }
});

// Handler for utility commands
bot.setMyCommands([
  { command: '/networks', description: 'Show list of supported networks' },
  { command: '/active_proposals', description: 'show active proposals' },
]);

const fetchNetworkDetails = async (network: Network) => {
  const [sdkVersion, walletAddress] = await Promise.all([
    getCosmosSdkVersion(network.apiEndpoint),
    getWalletAddress(MNEMONIC, network.prefix, network.coinType ?? 118),
  ]);

  return dedent(`
        🌐 <b>${network.name}</>
        SDK Version: ${sdkVersion}
        Address: ${walletAddress}
    `);
};

bot.onText(/\/networks/, async (msg: TelegramBot.Message) => {
  const mainnetNetworks = networks.filter((network) => network.scope === 'mainnet');
  const mainnetDetails = await Promise.all(mainnetNetworks.map(fetchNetworkDetails));
  const mainnetDetailsMessage = mainnetDetails.join('\n\n');

  const testnetNetworks = networks.filter((network) => network.scope === 'testnet');
  const testnetDetails = await Promise.all(testnetNetworks.map(fetchNetworkDetails));
  const testnetDetailsMessage = testnetDetails.join('\n\n');

  let message = `Supported networks:\n\n`;
  if (mainnetNetworks.length > 0) {
    message += `🟩 <b>MAINNET:</b>\n${mainnetDetailsMessage}\n\n`;
  }
  if (testnetNetworks.length > 0) {
    message += `🟨 <b>TESTNET:</b>\n${testnetDetailsMessage}`;
  }

  await bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' as ParseMode });
});

bot.onText(/\/active_proposals/, async (msg: TelegramBot.Message) => {
  let thereAreActiveProposals = false;

  for (const network of networks) {
    const proposals = await getActiveProposals(network.apiEndpoint);
    const activeProposals = proposals.filter(
      (proposal: any) => getProposalStatus(proposal) === 'PROPOSAL_STATUS_VOTING_PERIOD',
    );

    if (activeProposals.length > 0) {
      thereAreActiveProposals = true;
      await bot.sendMessage(msg.chat.id, `List of active proposals in <b>${network.name}:</b>`, {
        parse_mode: 'HTML' as ParseMode,
      });
      for (const proposal of activeProposals) {
        await sendProposalMessage(network, proposal);
      }
    }
  }

  if (!thereAreActiveProposals) {
    await bot.sendMessage(msg.chat.id, 'There are no active proposals in any network.');
  }
});

async function monitorProposals() {
  networks = JSON.parse(fs.readFileSync('networks.json', 'utf-8'));
  console.log('Fetching proposals from networks...');
  console.log('Networks:', networks.map((network) => `${network.name}(${network.scope})`).join(', '));

  for (const network of networks) {
    const chainId = network.chainId;
    const proposals = await getActiveProposals(network.apiEndpoint);

    for (const proposal of proposals) {
      const proposalId = getProposalId(proposal);
      const exists = await checkProposalExists(chainId, proposalId);
      if (!exists) {
        await sendProposalMessage(network, proposal);
        await saveProposal(chainId, proposalId);
      }
    }
  }
}

connectDb().then(async () => {
  console.log('Bot is running...');
  await monitorProposals();
  setInterval(async () => {
    await monitorProposals();
  }, FETCH_INTERVAL_MS);
});
