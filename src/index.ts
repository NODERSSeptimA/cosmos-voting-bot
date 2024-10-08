import TelegramBot, { ParseMode } from 'node-telegram-bot-api';
import { GasPrice, makeCosmoshubPath, SigningStargateClient } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import axios, { AxiosError } from 'axios';
import dedent from 'dedent';
import 'dotenv/config';
import * as fs from 'fs';
import { Network } from './types';
import { checkProposalExists, connectDb, getVoteOptionForProp, saveProposal, saveVote } from "./database";
import { getProposalDescription, getProposalId, getProposalStatus, getProposalTitle, getProposalType } from "./utils";

const MNEMONIC = process.env.MNEMONIC!;
const FETCH_INTERVAL_MS = 60000;

// Telegram Bot configuration
const BOT_TOKEN = process.env.BOT_TOKEN!;
const CHAT_ID = process.env.CHAT_ID!;
const bot = new TelegramBot(BOT_TOKEN, {polling: true});

// Load network configuration from networks.json
const networks: Network[] = JSON.parse(fs.readFileSync('networks.json', 'utf-8'));

enum VoteButtons {
  YES = '👍 Yes',
  NO = '👎 No',
  NO_WITH_VETO = '❌ No with Veto',
  ABSTAIN = '🤷‍♂️ Abstain'
}

function getInlineKeyboardMarkup(chainId: string, proposalId: number, option: string | undefined): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: option === 'yes' ? `VOTED: ${VoteButtons.YES}` : VoteButtons.YES,
          callback_data: `vote__yes__${chainId}__${proposalId}`
        },
        {
          text: option === 'no' ? `VOTED: ${VoteButtons.NO}` : VoteButtons.NO,
          callback_data: `vote__no__${chainId}__${proposalId}`
        },
      ],
      [
        {
          text: option === 'veto' ? `VOTED: ${VoteButtons.NO_WITH_VETO}` : VoteButtons.NO_WITH_VETO,
          callback_data: `vote__veto__${chainId}__${proposalId}`
        },
        {
          text: option === 'abstain' ? `VOTED: ${VoteButtons.ABSTAIN}` : VoteButtons.ABSTAIN,
          callback_data: `vote__abstain__${chainId}__${proposalId}`
        },
      ],
    ],
  };
}

async function fetchProposals(apiEndpoint: string): Promise<any[]> {
  let response;
  let errorMessage;
  try {
    response = await axios.get(`${apiEndpoint}/cosmos/gov/v1/proposals`);
    return response.data.proposals;
  } catch (error: AxiosError | any) {
    errorMessage = error.message;
  }

  try {
    response = await axios.get(`${apiEndpoint}/cosmos/gov/v1beta1/proposals`);
    return response.data.proposals;
  } catch (error: AxiosError | any) {
    errorMessage = error.message;
  }

  console.error('Error fetching proposals:', errorMessage);
  return [];
}

async function vote(rpcEndpoint: string, prefix: string, gasPriceString: string, proposalId: number, option: string, coinType: number) {
  const hdPath = makeCosmoshubPath(coinType);
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, {prefix});
  const [account] = await wallet.getAccounts();
  const gasPrice = GasPrice.fromString(gasPriceString);
  const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet, {gasPrice});

  console.log(`Voting for proposal #${proposalId} with option "${option}" from account ${account.address} using rpc: ${rpcEndpoint}`);

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

  const voteMsg = {
    typeUrl: '/cosmos.gov.v1beta1.MsgVote',
    value: {
      proposalId: proposalId,
      voter: account.address,
      option: voteOption,
    },
  };

  try {
    const result = await client.signAndBroadcast(account.address, [voteMsg], 'auto');
    console.log('Transaction result:', result);
    return result;
  } catch (error: any) {
    console.error('Error signing and broadcasting vote:', error.message);
    return {
      code: 1,
      rawLog: error.message,
    };
  }
}

async function sendProposalMessage(network: Network, proposal: any) {
  const chainId = network.chainId;
  const proposalId = getProposalId(proposal);
  const proposalTitle = getProposalTitle(proposal);
  const proposalDescription = getProposalDescription(proposal).slice(0, 400);
  const proposalType = getProposalType(proposal);
  const option = await getVoteOptionForProp(chainId, proposalId);

  const message = dedent(`
    🌐<b>Network:</b> ${network.name}
    📜<b>Proposal ID:</b> ${proposalId}
    🗳<b>Type:</b> ${proposalType}
    📃<b>Title:</b> ${proposalTitle}
    📚<b>Description:</b> ${proposalDescription}
  `);

  const opts = {
    reply_markup: {
      ...getInlineKeyboardMarkup(chainId, proposalId, option),
    },
    parse_mode: 'HTML' as ParseMode,
    disable_web_page_preview: true
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

    const coinType = network.coinType ?? 118;
    const result = await vote(network.rpcEndpoint, network.prefix, network.gasPrice, Number(proposalId), option, coinType);
    if (result && result.code === 0) {
      const opts = {
        chat_id: callbackQuery.message?.chat.id!,
        message_id: callbackQuery.message?.message_id,
        reply_markup: {
          ...getInlineKeyboardMarkup(chainId, Number(proposalId), option),
        },
        parse_mode: 'HTML' as ParseMode,
        disable_web_page_preview: true
      };

      await bot.editMessageReplyMarkup(opts.reply_markup, opts);
      await saveVote(chainId, Number(proposalId), option);
    } else {
      const errorMessage = `🟥 Error voting for proposal #${proposalId} in network ${network.name}: ${result.rawLog}`;
      await bot.sendMessage(callbackQuery.message?.chat.id!, errorMessage);
    }
  }
});

// Handler for utility commands
bot.setMyCommands([
  {command: '/networks', description: 'Show list of supported networks'},
  {command: '/active_proposals', description: 'show active proposals'},
]);

bot.onText(/\/networks/, async (msg: TelegramBot.Message) => {
  const networkList = networks.map((network) => `- ${network.name}`).join('\n');
  await bot.sendMessage(msg.chat.id, dedent(`
    Supported networks:
    ${networkList}
  `));
});

bot.onText(/\/active_proposals/, async (msg: TelegramBot.Message) => {
  let thereAreActiveProposals = false;

  for (const network of networks) {
    const proposals = await fetchProposals(network.apiEndpoint);
    const activeProposals = proposals.filter((proposal: any) => getProposalStatus(proposal) === 'PROPOSAL_STATUS_VOTING_PERIOD');

    if (activeProposals.length > 0) {
      thereAreActiveProposals = true;
      await bot.sendMessage(msg.chat.id, `List of active proposals in ${network.name}:`);
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
  setInterval(async () => {

    for (const network of networks) {
      const chainId = network.chainId;
      const proposals = await fetchProposals(network.apiEndpoint);

      for (const proposal of proposals) {
        const proposalId = getProposalId(proposal);
        const exists = await checkProposalExists(chainId, proposalId);
        if (!exists) {
          await sendProposalMessage(network, proposal);
          await saveProposal(chainId, proposalId);
        }
      }
    }
  }, FETCH_INTERVAL_MS);
}

connectDb()
  .then(() => {
    monitorProposals();
    console.log('Bot is running and monitoring new proposals...');
  });
