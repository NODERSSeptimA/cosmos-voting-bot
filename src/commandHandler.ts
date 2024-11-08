import { handleVoteCommand, sendProposalMessage } from './index';
import TelegramBot, { ParseMode } from 'node-telegram-bot-api';
import { getActiveProposals, getCosmosSdkVersion, getWalletAddress } from './api/cosmosApi';
import { getProposalStatus } from './proposalUtils';
import { getUrlFromTemplate, getVoteMessageType } from './utils';
import dedent from 'dedent';
import { Network } from './types';
import { getNetworks } from './api/registryApi';

const MNEMONIC = process.env.MNEMONIC!;

const getNetworkDetails = async (network: Network) => {
  const [sdkVersion, voterAddress] = await Promise.all([
    getCosmosSdkVersion(network.endpoints.api),
    getWalletAddress(MNEMONIC, network.prefix, network.coinType ?? 118),
  ]);
  const accountUrl = getUrlFromTemplate(network.explorer.accountUrl, voterAddress);

  return dedent(`
        🌐 <b>${network.prettyName}</>
        SDK Version: ${sdkVersion}
        Voter Address: <a href="${accountUrl}">${voterAddress}</a>
    `);
};

export function registerCommandHandlers(bot: TelegramBot) {
  bot.setMyCommands([
    { command: '/networks', description: 'Show list of supported networks' },
    { command: '/active_proposals', description: 'Show active proposals' },
    { command: '/grant_permission', description: 'Show grant permission command' },
  ]);

  bot.onText(/\/networks/, async (msg: TelegramBot.Message) => {
    const networks = await getNetworks();
    const details = await Promise.all(networks.map(getNetworkDetails));
    const detailsMessage = details.join('\n\n');

    let message = `Supported networks:\n\n`;
    if (details.length > 0) {
      message += `🟩 Scope: <b>MAINNET</b>\n\n${detailsMessage}`;
    } else {
      message += `No networks found. Please check config`;
    }

    await bot.sendMessage(msg.chat.id, message, {
      parse_mode: 'HTML' as ParseMode,
      disable_web_page_preview: true,
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

  bot.onText(/\/grant_permission/, async (msg: TelegramBot.Message) => {
    const networks = await getNetworks();
    const buttons: TelegramBot.InlineKeyboardButton[][] = [];
    let row: TelegramBot.InlineKeyboardButton[] = [];

    for (const network of networks) {
      row.push({
        text: network.prettyName,
        callback_data: `show_grant_command__${network.chainId}`,
      });
      if (row.length === 3) {
        buttons.push(row);
        row = [];
      }
    }

    if (row.length > 0) {
      buttons.push(row);
    }

    await bot.sendMessage(msg.chat.id, 'Choose network:', {
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  });

  async function handleShowGrantPermissionCommand(chatId: number, network: Network) {
    const cosmosSdkVersion = await getCosmosSdkVersion(network.endpoints.api);
    const voterAddress = await getWalletAddress(MNEMONIC, network.prefix, network.coinType ?? 118);
    const voteMessageType = getVoteMessageType(cosmosSdkVersion);
    const command = dedent`
      Grant permission to vote for proposals in *${network.prettyName}*:
      \`\`\`\n${network.daemonName} tx authz grant ${voterAddress} generic \-\-msg-type=${voteMessageType} \-\-from ${network.validator.validatorAddress} \-\-fees ${network.fees} \-y grant_permission\`\`\`
    `;

    await bot.sendMessage(chatId, command, { parse_mode: 'MarkdownV2' });
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
      case 'show_grant_command':
        await handleShowGrantPermissionCommand(callbackQuery.message!.chat.id, network);
        break;
      case 'vote':
        await handleVoteCommand(callbackQuery, network);
        break;
      default:
        console.warn('Unknown action:', action);
    }
  });
}
