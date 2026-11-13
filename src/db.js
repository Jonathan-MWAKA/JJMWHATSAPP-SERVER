const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL absente : PostgreSQL non connecté.");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL
        ? { rejectUnauthorized: false }
        : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    keepAlive: true
});

pool.on("error", (erreur) => {
    console.error(
        "Erreur inattendue PostgreSQL :",
        erreur.message
    );
});

async function testerConnexionPostgres() {
    const resultat = await pool.query(
        "SELECT NOW() AS date_serveur"
    );

    return resultat.rows[0];
}

module.exports = {
    pool,
    testerConnexionPostgres
};
