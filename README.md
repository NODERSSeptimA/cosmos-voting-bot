# Cosmos Voting Bot

This project is a bot that monitors proposals on various blockchain networks and sends notifications when new proposals
are detected.

## Installation

1. Clone the repository:
    ```sh
    git clone https://github.com/yourusername/proposal-monitoring-bot.git
    cd proposal-monitoring-bot
    ```

2. Install the dependencies:
    ```sh
    npm install
    ```

## Usage

1. Start the bot:
    ```sh
    npm run dev
    ```

2. The bot will create a SQLite database, start monitoring proposals, and log messages to the console.

## Configuration

1. Copy the `networks.json.example` file to `networks.json`:
    ```sh
    cp networks.json.example networks.json
    ```

2. Edit the `networks.json` file to include the blockchain networks you want to monitor.

3. Create a `.env` file in the root directory and add the following environment variables:
    ```env
   MNEMONIC=your_wallet_mnemonic_here
   
   # fetch interval (optional). Default is 60000 ms (1 minute)
   FETCH_INTERVAL_MS=60000
   
   # bot
   BOT_TOKEN=your_telegram_bot_token_here
   CHAT_ID=your_telegram_chat_id_here
   ```
