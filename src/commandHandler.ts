import { handleVoteCommand, sendProposalMessage } from './index';
import TelegramBot, { ParseMode } from 'node-telegram-bot-api';
import { getActiveProposals, getCosmosSdkVersion, getWalletAddress } from './api/cosmosApi';
import { getProposalStatus } from './proposalUtils';
import { escapeMarkdownV2, getUrlFromTemplate, getVoteMessageType } from './utils';
import dedent from 'dedent';
import { Network } from './types';
import { getNetworks } from './api/registryApi';

const SCOPE = process.env.SCOPE || 'mainnet';
const MNEMONIC = process.env.MNEMONIC!;

const getNetworkDetails = async (network: Network) => {
  const [sdkVersion, voterAddress] = await Promise.all([
    getCosmosSdkVersion(network.endpoints.api),
    getWalletAddress(MNEMONIC, network.prefix, network.coinType ?? 118),
  ]);
  const accountUrl = getUrlFromTemplate(network.explorer.accountUrl, voterAddress);
  const validatorUrl = getUrlFromTemplate(network.explorer.validatorUrl, network.validator.validatorAddress);

  return dedent(`
        🌐 <b>${network.prettyName}</b>
        <b>Chain ID:</b> ${network.chainId}
        <b>SDK Version:</b> ${sdkVersion}
        <b>Valoper Address:</b> <a href="${validatorUrl}">${network.validator.validatorAddress}</a>
        <b>Voter Address:</b> <a href="${accountUrl}">${voterAddress}</a>
    `);
};

export function registerCommandHandlers(bot: TelegramBot) {
  bot.setMyCommands([
    { command: '/networks', description: 'Show list of supported networks' },
    { command: '/active_proposals', description: 'Show active proposals' },
  ]);

  bot.onText(/\/networks/, async (msg: TelegramBot.Message) => {
    const networks = await getNetworks();
    const buttons: TelegramBot.InlineKeyboardButton[][] = [];
    let row: TelegramBot.InlineKeyboardButton[] = [];

    for (const network of networks) {
      row.push({
        text: network.prettyName,
        callback_data: `show_network_details__${network.chainId}`,
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
      🟩 Scope: <b>${SCOPE}</b>
      Supported networks:
    `;

    await bot.sendMessage(msg.chat.id, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  });

  bot.onText(/\/active_proposals/, async (msg: TelegramBot.Message) => {
    const networks = await getNetworks();
    let thereAreActiveProposals = false;

    for (const network of networks) {
      const proposals = await getActiveProposals(network.endpoints.api);
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

  async function handleShowNetworkDetails(chatId: number, network: Network) {
    const cosmosSdkVersion = await getCosmosSdkVersion(network.endpoints.api);
    const voterAddress = await getWalletAddress(MNEMONIC, network.prefix, network.coinType ?? 118);
    const voteMessageType = getVoteMessageType(cosmosSdkVersion);

    const networkDetails = await getNetworkDetails(network);
    await bot.sendMessage(chatId, networkDetails, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    const grantCommand = dedent`
      ${escapeMarkdownV2(`Grant permission to vote for proposals in ${network.prettyName}:`)}
      \`\`\`\n
      ${network.daemonName} tx authz grant ${voterAddress} generic \-\-msg-type=${voteMessageType} \-\-from ${
      network.validator.walletAddress
    } \-\-fees ${network.fees} \-y
       \`\`\`
    `;
    await bot.sendMessage(chatId, grantCommand, { parse_mode: 'MarkdownV2' });
  }

  bot.on('callback_query', async (callbackQuery: TelegramBot.CallbackQuery) => {
    const [action, chainId] = callbackQuery.data!.split('__');
    const networks = await getNetworks();
    const network = networks.find((network) => network.chainId === chainId);

    if (!network) {
      await bot.sendMessage(callbackQuery.message?.chat.id!, 'Network not found for chainId: ' + chainId);
      return;
    }

    switch (action) {
      case 'show_network_details':
        await handleShowNetworkDetails(callbackQuery.message!.chat.id, network);
        break;
      case 'vote':
        await handleVoteCommand(callbackQuery, network);
        break;
      default:
        console.warn('Unknown action:', action);
    }
  });
}
