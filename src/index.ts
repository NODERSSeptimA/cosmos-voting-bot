import TelegramBot from 'node-telegram-bot-api';
import { GasPrice, SigningStargateClient } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import axios from 'axios';
import { Client } from 'pg';
import dedent from 'dedent';
import 'dotenv/config';
import * as fs from 'fs';

// Telegram Bot Token
const BOT_TOKEN = process.env.BOT_TOKEN!;
const CHAT_ID = process.env.CHAT_ID!;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// PostgreSQL client
const dbClient = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432', 10),
});
dbClient.connect();

// Load network configuration from networks.json
const networks: { name: string; rpcEndpoint: string; prefix: string; denom: string; gasPrice: string; chainId: string }[] = JSON.parse(fs.readFileSync('../networks.json', 'utf-8'));

const MNEMONIC = process.env.MNEMONIC!;

// Enum for vote button text
enum VoteButtons {
  Yes = '👍 Yes',
  No = '👎 No',
  NoWithVeto = '❌ No with Veto',
  Abstain = '🤷‍♂️ Abstain'
}

// Function to fetch chain-id
async function fetchChainId(rpcEndpoint: string) {
  try {
    const response = await axios.get(`${rpcEndpoint}/status`);
    return response.data.result.node_info.network;
  } catch (error) {
    console.error('Error fetching chain-id:', error);
    return null;
  }
}

// Function to fetch the list of proposals
async function fetchProposals(rpcEndpoint: string) {
  try {
    const response = await axios.get(`${rpcEndpoint}/gov/proposals`);
    return response.data.result;
  } catch (error) {
    console.error('Error fetching proposals:', error);
    return [];
  }
}

// Function to send a vote transaction
async function vote(rpcEndpoint: string, prefix: string, gasPriceString: string, proposalId: number, option: string) {
  try {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(MNEMONIC, { prefix });
    const [account] = await wallet.getAccounts();
    const gasPrice = GasPrice.fromString(gasPriceString);
    const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet, { gasPrice });

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

    const result = await client.signAndBroadcast(account.address, [voteMsg], 'auto');
    console.log('Transaction result:', result);
    return result;
  } catch (error) {
    console.error('Error voting:', error);
    return { code: 1, error };
  }
}

// Function to handle a new proposal
async function handleNewProposal(network: any, chainId: string, proposal: any) {
  const proposalId = proposal.proposal_id;
  const proposalTitle = proposal.content.title;
  const proposalDescription = proposal.content.description;

  const message = dedent(`
    New proposal in network ${network.name} #${proposalId}

    ${proposalTitle}
    ${proposalDescription}
  `);

  const opts = {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [
          {
            text: VoteButtons.Yes,
            callback_data: JSON.stringify({
              action: 'vote',
              option: 'yes',
              network: network.name,
              proposalId
            })
          },
          {
            text: VoteButtons.No,
            callback_data: JSON.stringify({ action: 'vote', option: 'no', network: network.name, proposalId })
          },
        ],
        [
          {
            text: VoteButtons.NoWithVeto,
            callback_data: JSON.stringify({
              action: 'vote',
              option: 'veto',
              network: network.name,
              proposalId
            })
          },
          {
            text: VoteButtons.Abstain,
            callback_data: JSON.stringify({
              action: 'vote',
              option: 'abstain',
              network: network.name,
              proposalId
            })
          },
        ],
      ],
    })
  };

  bot.sendMessage(CHAT_ID, message, opts);

  // Save proposal to the database
  await dbClient.query(
    'INSERT INTO proposals(chain_id, proposal_id) VALUES($1, $2) ON CONFLICT DO NOTHING',
    [chainId, proposalId]
  );
}

// Button click handler
bot.on('callback_query', async (callbackQuery: TelegramBot.CallbackQuery) => {
  const data = JSON.parse(callbackQuery.data!);
  const { action, option, network: networkName, proposalId } = data;

  if (action === 'vote') {
    const network = networks.find((net) => net.chainId === networkName);
    if (!network) {
      bot.sendMessage(callbackQuery.message?.chat.id!, 'Network not found.');
      return;
    }

    const chainId = network.chainId;

    const result = await vote(network.rpcEndpoint, network.prefix, network.gasPrice, Number(proposalId), option);
    if (result && result.code === 0) {
      const opts = {
        chat_id: callbackQuery.message?.chat.id!,
        message_id: callbackQuery.message?.message_id,
        reply_markup: JSON.stringify({
          inline_keyboard: [
            [
              {
                text: option === 'yes' ? `VOTED: ${VoteButtons.Yes}` : VoteButtons.Yes,
                callback_data: JSON.stringify({
                  action: 'vote',
                  option: 'yes',
                  network: networkName,
                  proposalId
                })
              },
              {
                text: option === 'no' ? `VOTED: ${VoteButtons.No}` : VoteButtons.No,
                callback_data: JSON.stringify({
                  action: 'vote',
                  option: 'no',
                  network: networkName,
                  proposalId
                })
              },
            ],
            [
              {
                text: option === 'veto' ? `VOTED: ${VoteButtons.NoWithVeto}` : VoteButtons.NoWithVeto,
                callback_data: JSON.stringify({
                  action: 'vote',
                  option: 'veto',
                  network: networkName,
                  proposalId
                })
              },
              {
                text: option === 'abstain' ? `VOTED: ${VoteButtons.Abstain}` : VoteButtons.Abstain,
                callback_data: JSON.stringify({
                  action: 'vote',
                  option: 'abstain',
                  network: networkName,
                  proposalId
                })
              },
            ],
          ],
        })
      };

      bot.editMessageReplyMarkup(opts.reply_markup, opts);

      // Save or update voting information in the database
      await dbClient.query(
        'INSERT INTO votes(chain_id, proposal_id, option) VALUES($1, $2, $3) ON CONFLICT (chain_id, proposal_id) DO UPDATE SET option = EXCLUDED.option',
        [chainId, proposalId, option]
      );
    } else {
      bot.sendMessage(callbackQuery.message?.chat.id!, `Error voting for proposal #${proposalId} in network ${network.name}. Please try again.`);
    }
  }
});

// Handler for utility commands
bot.onText(/\/networks/, (msg: TelegramBot.Message) => {
  const networkList = networks.map((network) => `- ${network.name}`).join('\n');
  bot.sendMessage(msg.chat.id, dedent(`
    Supported networks:
    ${networkList}
  `));
});

bot.onText(/\/active_proposals/, async (msg: TelegramBot.Message) => {
  let activeProposalsMessage = 'List of active proposals in all networks:\n';

  for (const network of networks) {
    const proposals = await fetchProposals(network.rpcEndpoint);
    const activeProposals = proposals.filter((proposal: any) => proposal.status === 'PROPOSAL_STATUS_VOTING_PERIOD');
    if (activeProposals.length > 0) {
      activeProposalsMessage += dedent(`
        
        Network: ${network.name}
      `);
      activeProposals.forEach((proposal: any) => {
        activeProposalsMessage += `- #${proposal.proposal_id}: ${proposal.content.title}\n`;
      });
    }
  }

  bot.sendMessage(msg.chat.id, activeProposalsMessage);
});

// Function to monitor new proposals
async function monitorProposals() {
  setInterval(async () => {
    for (const network of networks) {
      const chainId = network.chainId;

      const proposals = await fetchProposals(network.rpcEndpoint);
      for (const proposal of proposals) {
        // Check if the proposal exists in the database
        const res = await dbClient.query(
          'SELECT * FROM proposals WHERE chain_id = $1 AND proposal_id = $2',
          [chainId, proposal.proposal_id]
        );

        if (res.rows.length === 0) {
          await handleNewProposal(network, chainId, proposal);
        }
      }
    }
  }, 60000); // Check every 60 seconds
}

// Start the bot and monitoring
monitorProposals();

console.log('Bot is running and monitoring new proposals...');
