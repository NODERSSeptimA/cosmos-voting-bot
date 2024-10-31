import axios, { AxiosError } from 'axios';
import 'dotenv/config';
import { Network } from './types';

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
        'pagination[limit]': '1000',
        sort: 'name:asc',
      },
    });
    return response.data.data;
  } catch (error: AxiosError | any) {
    console.error(`Error fetching proposals from ${REGISTRY_API_URL}:`, error.message);
    return [];
  }
}

export { getNetworks };
