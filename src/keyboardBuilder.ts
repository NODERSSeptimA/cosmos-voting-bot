import { VoteOption } from 'cosmjs-types/cosmos/gov/v1beta1/gov';
import TelegramBot from 'node-telegram-bot-api';

function getVoteOptionText(voteOption: VoteOption): string {
  switch (voteOption) {
    case VoteOption.VOTE_OPTION_YES:
      return '👍 Yes';
    case VoteOption.VOTE_OPTION_NO:
      return '👎 No';
    case VoteOption.VOTE_OPTION_NO_WITH_VETO:
      return '❌ No with Veto';
    case VoteOption.VOTE_OPTION_ABSTAIN:
      return '🤷‍♂️ Abstain';
    default:
      return '🧻 Unknown';
  }
}

function createVoteButton(
  chainId: string,
  proposalId: number,
  voteOption: VoteOption,
  selectedOption: VoteOption,
): TelegramBot.InlineKeyboardButton {
  const isSelected = voteOption === selectedOption;
  return {
    text: isSelected ? `🟢 VOTED: ${getVoteOptionText(voteOption)}` : getVoteOptionText(voteOption),
    callback_data: `vote_click__${chainId}__${voteOption}__${proposalId}`,
  };
}

function getInlineKeyboardMarkup(
  chainId: string,
  proposalId: number,
  selectedOption: VoteOption,
): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        createVoteButton(chainId, proposalId, VoteOption.VOTE_OPTION_YES, selectedOption),
        createVoteButton(chainId, proposalId, VoteOption.VOTE_OPTION_NO, selectedOption),
      ],
      [
        createVoteButton(chainId, proposalId, VoteOption.VOTE_OPTION_NO_WITH_VETO, selectedOption),
        createVoteButton(chainId, proposalId, VoteOption.VOTE_OPTION_ABSTAIN, selectedOption),
      ],
    ],
  };
}

export { getVoteOptionText, getInlineKeyboardMarkup };
