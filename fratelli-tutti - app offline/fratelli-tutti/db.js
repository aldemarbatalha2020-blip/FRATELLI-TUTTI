const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const schema = `
CREATE TABLE IF NOT EXISTS avisos (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  texto TEXT NOT NULL DEFAULT '',
  publico BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pastas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cifras (
  id SERIAL PRIMARY KEY,
  pasta_id INTEGER NOT NULL REFERENCES pastas(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  artista TEXT NOT NULL DEFAULT '',
  tom TEXT NOT NULL DEFAULT '',
  texto TEXT NOT NULL DEFAULT '',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS midias (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('foto','reel','video')),
  titulo TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  dados BYTEA NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reacoes (
  midia_id INTEGER NOT NULL REFERENCES midias(id) ON DELETE CASCADE,
  visitante TEXT NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (midia_id, visitante, emoji)
);

CREATE TABLE IF NOT EXISTS comentarios (
  id SERIAL PRIMARY KEY,
  midia_id INTEGER NOT NULL REFERENCES midias(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  texto TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function init() {
  await pool.query(schema);
}

module.exports = { pool, init };
