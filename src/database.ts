import sqlite3 from 'sqlite3';

let db: sqlite3.Database;

function connectDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      db = new sqlite3.Database('./database.sqlite', (err) => {
        if (err) {
          console.error('Error connecting to the database:', err.message);
          reject(err);
        } else {
          console.log('Connected to the SQLite database');
          initDatabase()
            .then(() => resolve())
            .catch((error) => reject(error));
        }
      });
    } catch (error: any) {
      console.error('Error connecting to the database:', error.message);
      reject(error);
    }
  });
}

function initDatabase(): Promise<void> {
  const query = `
      CREATE TABLE IF NOT EXISTS proposals
      (
          chain_id    TEXT    NOT NULL,
          proposal_id INTEGER NOT NULL,
          PRIMARY KEY (chain_id, proposal_id)
      );
  `;
  return new Promise((resolve, reject) => {
    db.run(query, (err) => {
      if (err) {
        console.error('Error initializing database:', err.message);
        reject(err);
      } else {
        console.log('Database has been initialized');
        resolve();
      }
    });
  });
}

function saveProposal(chainId: string, proposalId: number): void {
  const query = 'INSERT OR IGNORE INTO proposals (chain_id, proposal_id) VALUES (?, ?)';
  db.run(query, [chainId, proposalId], (err) => {
    if (err) {
      console.error('Error saving proposal:', err.message);
    }
  });
}

function checkProposalExists(chainId: string, proposalId: number): Promise<boolean> {
  const query = 'SELECT * FROM proposals WHERE chain_id = ? AND proposal_id = ?';
  return new Promise((resolve) => {
    db.get(query, [chainId, proposalId], (err, row) => {
      if (err) {
        console.error('Error checking proposal:', err.message);
        resolve(false);
      } else {
        resolve(!!row);
      }
    });
  });
}

export { connectDb, saveProposal, checkProposalExists };
