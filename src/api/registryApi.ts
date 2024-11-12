import axios, { AxiosError } from 'axios';
import 'dotenv/config';
import { Network } from '../types';

const SCOPE = process.env.SCOPE || 'mainnet';
const REGISTRY_API_URL = process.env.REGISTRY_API_URL || 'https://registry.noders.services';
const REGISTRY_API_TOKEN = process.env.REGISTRY_API_TOKEN || '';

async function getNetworks(): Promise<Network[]> {
  try {
    const response = await axios.get(`${REGISTRY_API_URL}/api/projects`, {
      headers: {
        Authorization: `Bearer ${REGISTRY_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      params: {
        populate: ['validator', 'explorer', 'endpoints'],
        'filters[architecture][$eq]': 'cosmos',
        'filters[scope][$eq]': SCOPE,
        'pagination[limit]': '1000',
        sort: 'name:asc',
      },
    });

    const networks: Network[] = await response.data.data;
    for (const network of networks) {
      if (!network.endpoints?.api || !network.endpoints?.rpc) {
        console.error(`Error: API or RPC endpoint not found for network ${network.prettyName} (${network.chainId})`);
      }
    }

    return networks.filter((network) => {
      return network.endpoints?.api && network.endpoints?.rpc;
    });
  } catch (error: AxiosError | any) {
    console.error(`Error fetching proposals from ${REGISTRY_API_URL}:`, error.message);
    return [];
  }
}

export { getNetworks };
