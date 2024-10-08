function splitCamelCaseWithSpaces(messageType: string): string {
  const lastPart = messageType.split('.').pop();
  return lastPart!.replace(/([A-Z])/g, ' $1').trim();
}

function getProposalType(proposal: any): string {
  if (proposal.proposal_type) {
    return  splitCamelCaseWithSpaces(proposal.proposal_type);
  }

  if (proposal.messages && proposal.messages[0]["@type"]) {
    return splitCamelCaseWithSpaces(proposal.messages[0]["@type"]);
  }

  return 'Unknown';
}

export { getProposalType };
