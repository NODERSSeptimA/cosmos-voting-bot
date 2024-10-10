import { Client } from 'pg';
import 'dotenv/config';

const dbClient = new Client({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function connectDb(): Promise<void> {
  try {
    await dbClient.connect();
    console.log('Connected to the database');
    await initDatabase();
  } catch (error: any) {
    console.error('Error connecting to the database:', error.message);
  }
}

async function initDatabase(): Promise<void> {
  const query = `
    CREATE TABLE IF NOT EXISTS proposals (
      chain_id VARCHAR(255) NOT NULL,
      proposal_id INTEGER NOT NULL,
      PRIMARY KEY (chain_id, proposal_id)
    );
  `;
  try {
    await dbClient.query(query);
    console.log('Database has been initialized');
  } catch (error: any) {
    console.error('Error initializing database:', error.message);
  }
}

async function saveProposal(chainId: string, proposalId: number): Promise<void> {
  const query = 'INSERT INTO proposals(chain_id, proposal_id) VALUES($1, $2) ON CONFLICT DO NOTHING';
  try {
    await dbClient.query(query, [chainId, proposalId]);
  } catch (error: any) {
    console.error('Error saving proposal:', error.message);
  }
}

async function checkProposalExists(chainId: string, proposalId: number): Promise<boolean> {
  const query = 'SELECT * FROM proposals WHERE chain_id = $1 AND proposal_id = $2';
  try {
    const res = await dbClient.query(query, [chainId, proposalId]);
    return res.rows.length > 0;
  } catch (error: any) {
    console.error('Error checking proposal:', error.message);
    return false;
  }
}

export { connectDb, saveProposal, checkProposalExists };
