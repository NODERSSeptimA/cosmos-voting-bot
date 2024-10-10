import axios, { AxiosError } from "axios";

async function getActiveProposals(apiEndpoint: string): Promise<any[]> {
  let response;
  let errorMessage;
  try {
    response = await axios.get(`${apiEndpoint}/cosmos/gov/v1/proposals?proposal_status=2`);
    return response.data.proposals;
  } catch (error: AxiosError | any) {
    errorMessage = error.message;
  }

  try {
    response = await axios.get(`${apiEndpoint}/cosmos/gov/v1beta1/proposals?proposal_status=2`);
    return response.data.proposals;
  } catch (error: AxiosError | any) {
    errorMessage = error.message;
  }

  console.error(`Error fetching proposals from ${apiEndpoint}:`, errorMessage);
  return [];
}

export { getActiveProposals };
