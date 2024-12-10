import { UpgradeInfo } from './types';
import { VoteOption } from 'cosmjs-types/cosmos/gov/v1beta1/gov';
import { isCosmosSdkNewerOrEqual } from './utils';

function splitCamelCaseWithSpaces(messageType: string): string {
  const lastPart = messageType.split('.').pop();
  return lastPart!.replace(/([A-Z])/g, ' $1').trim();
}

function getProposalId(proposal: any): number {
  if (proposal.proposal_id) {
    return proposal.proposal_id;
  }

  if (proposal.id) {
    return proposal.id;
  }

  return -1;
}

function getProposalType(proposal: any): string {
  if (proposal.proposal_type) {
    return splitCamelCaseWithSpaces(proposal.proposal_type);
  }

  if (proposal.messages && proposal.messages.length && proposal.messages[0]['@type']) {
    const message = proposal.messages[0];
    let messageType = message['@type'];
    if (messageType.includes('MsgExecLegacyContent')) {
      messageType = message.content?.['@type'] || messageType;
    }
    return splitCamelCaseWithSpaces(messageType);
  }

  if (proposal.content && proposal.content['@type']) {
    return splitCamelCaseWithSpaces(proposal.content['@type']);
  }

  // for sdk v0.45.x
  if (proposal.content && proposal.content.type) {
    const messageType = proposal.content.type.split('/')[1];
    return splitCamelCaseWithSpaces(messageType);
  }

  return 'Unknown';
}

function getProposalStatus(proposal: any): string {
  if (proposal.proposal_status) {
    return proposal.proposal_status;
  }

  if (proposal.status) {
    return proposal.status;
  }

  return 'Unknown';
}

function getProposalTitle(proposal: any): string {
  if (proposal.title) {
    return proposal.title;
  }

  if (proposal.messages && proposal.messages.length) {
    const message = proposal.messages[0];
    if (message.content?.title) {
      return message.content.title;
    }
  }

  if (proposal.content && proposal.content.title) {
    return proposal.content.title;
  }

  // for sdk v0.45.x
  if (proposal.content.value && proposal.content.value.title) {
    return proposal.content.value.title;
  }

  return 'Unknown';
}

function getProposalDescription(proposal: any): string {
  if (proposal.summary) {
    return proposal.summary;
  }

  if (proposal.messages && proposal.messages.length) {
    const message = proposal.messages[0];
    if (message.content?.description) {
      return message.content.description;
    }
  }

  if (proposal.content && proposal.content.description) {
    return proposal.content.description;
  }

  // for sdk v0.45.x
  if (proposal.content.value && proposal.content.value.description) {
    return proposal.content.value.description;
  }

  return 'Unknown';
}

function isUpgradeProposal(proposal: any): boolean {
  return getProposalType(proposal) === 'Software Upgrade';
}

function getUpgradeInfo(proposal: any): UpgradeInfo {
  if (proposal.messages && proposal.messages[0].plan) {
    return proposal.messages[0].plan;
  }

  if (proposal.messages && proposal.messages[0].content?.plan) {
    return proposal.messages[0].content.plan;
  }

  if (proposal.content?.plan) {
    return proposal.content.plan;
  }

  return { name: 'Unknown', height: 'Unknown' };
}

function getVotingEndTime(proposal: any): string {
  if (proposal.voting_start_time && proposal.voting_end_time) {
    const votingEndTime = new Date(proposal.voting_end_time);
    const votingStartTime = new Date(proposal.voting_start_time);
    const durationMs = votingEndTime.getTime() - votingStartTime.getTime();

    const days = Math.floor(durationMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    let durationStr = '';
    if (days > 0) {
      durationStr += `${days} day${days > 1 ? 's' : ''} `;
    }
    if (hours > 0) {
      durationStr += `${hours} hour${hours > 1 ? 's' : ''} `;
    }
    if (minutes > 0 || durationStr === '') {
      durationStr += `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }

    return (
      new Date(proposal.voting_end_time).toLocaleString('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ` UTC (${durationStr.trim()})`
    );
  }

  return 'Unknown';
}

function getVoteMessageType(cosmosSdkVersion: string): string {
  return isCosmosSdkNewerOrEqual(cosmosSdkVersion, 'v0.47.0')
    ? '/cosmos.gov.v1.MsgVote'
    : '/cosmos.gov.v1beta1.MsgVote';
}

function getVoteOptionByString(voteOptionString: string): VoteOption {
  switch (voteOptionString) {
    case 'VOTE_OPTION_YES':
      return VoteOption.VOTE_OPTION_YES;
    case 'VOTE_OPTION_NO':
      return VoteOption.VOTE_OPTION_NO;
    case 'VOTE_OPTION_NO_WITH_VETO':
      return VoteOption.VOTE_OPTION_NO_WITH_VETO;
    case 'VOTE_OPTION_ABSTAIN':
      return VoteOption.VOTE_OPTION_ABSTAIN;
    default:
      return VoteOption.VOTE_OPTION_UNSPECIFIED;
  }
}

function getVoteOptionByNumber(voteOption: number): VoteOption {
  switch (voteOption) {
    case 1:
      return VoteOption.VOTE_OPTION_YES;
    case 2:
      return VoteOption.VOTE_OPTION_ABSTAIN;
    case 3:
      return VoteOption.VOTE_OPTION_NO;
    case 4:
      return VoteOption.VOTE_OPTION_NO_WITH_VETO;
    default:
      return VoteOption.VOTE_OPTION_UNSPECIFIED;
  }
}

export {
  getVoteMessageType,
  getProposalId,
  getProposalType,
  getProposalStatus,
  getProposalTitle,
  getProposalDescription,
  isUpgradeProposal,
  getUpgradeInfo,
  getVotingEndTime,
  getVoteOptionByString,
  getVoteOptionByNumber,
};
