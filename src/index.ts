import TelegramBot from 'node-telegram-bot-api';
import { Registry } from '@cosmjs/proto-signing';
import 'dotenv/config';
import { getProposalId } from './proposalUtils';
import { getActiveProposals } from './api/cosmosApi';
import { checkProposalExists, connectDb, saveProposal } from './database';
import { getNetworks } from './api/registryApi';
import { registerCommandHandlers, sendProposalMessage } from './commandHandler';

import { MsgVote } from 'cosmjs-types/cosmos/gov/v1/tx';
import { MsgExec } from 'cosmjs-types/cosmos/authz/v1beta1/tx';

const registry = new Registry();
registry.register('/cosmos.authz.v1beta1.MsgExec', MsgExec);
registry.register('/cosmos.gov.v1.MsgVote', MsgVote);

const BOT_TOKEN = process.env.BOT_TOKEN!;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const FETCH_INTERVAL_MS = parseInt(process.env.FETCH_INTERVAL_MS || '60000');

async function fetchNewActiveProposals() {
  console.log('Fetching active proposals from networks...');
  const networks = await getNetworks();

  console.log('Networks:', networks.map((network) => `${network.prettyName}(${network.scope})`).join(', '));

  for (const network of networks) {
    console.log(`Fetching proposals for ${network.prettyName} (${network.scope}). ChainID: ${network.chainId} ...`);
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

export { bot };
