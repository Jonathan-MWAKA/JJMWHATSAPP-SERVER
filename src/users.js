const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const fichier =
    path.join(__dirname, "..", "data", "users.json");

function chargerUtilisateurs() {

    if (!fs.existsSync(fichier)) {
        return [];
    }

    try {
        return JSON.parse(
            fs.readFileSync(
                fichier,
                "utf8"
            )
        );
    } catch (e) {
        return [];
    }
}

function sauvegarderUtilisateurs(utilisateurs) {

    fs.writeFileSync(
        fichier,
        JSON.stringify(
            utilisateurs,
            null,
            2
        ),
        "utf8"
    );
}

function genererIdentifiant() {

    return (
        "JJM-" +
        crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()
    );
}

async function creerUtilisateur(
    nom,
    numero,
    motDePasse
) {

    const utilisateurs =
        chargerUtilisateurs();

    const existe =
        utilisateurs.find(
            utilisateur =>
                utilisateur.numero === numero
        );

    if (existe) {
        throw new Error(
            "Ce numéro est déjà enregistré."
        );
    }

    const motDePasseHash =
        await bcrypt.hash(
            motDePasse,
            12
        );

    const utilisateur = {

        id: crypto
            .randomUUID(),

        identifiant:
            genererIdentifiant(),

        nom,
        numero,

        motDePasseHash,

        creeLe:
            new Date().toISOString()
    };

    utilisateurs.push(
        utilisateur
    );

    sauvegarderUtilisateurs(
        utilisateurs
    );

    return utilisateur;
}

async function verifierConnexion(
    numero,
    motDePasse
) {

    const utilisateurs =
        chargerUtilisateurs();

    const utilisateur =
        utilisateurs.find(
            utilisateur =>
                utilisateur.numero === numero
        );

    if (!utilisateur) {
        return null;
    }

    const valide =
        await bcrypt.compare(
            motDePasse,
            utilisateur.motDePasseHash
        );

    if (!valide) {
        return null;
    }

    return utilisateur;
}

const codesVerification = new Map();

function genererCodeVerification() {

    return String(
        crypto.randomInt(
            100000,
            1000000
        )
    );
}

function creerCodeVerification(numero) {

    const code =
        genererCodeVerification();

    const expiration =
        Date.now()
        + (5 * 60 * 1000);

    codesVerification.set(
        numero,
        {
            code,
            expiration
        }
    );

    return code;
}

function verifierCodeVerification(
    numero,
    code
) {

    const verification =
        codesVerification.get(
            numero
        );

    if (!verification) {
        return false;
    }

    if (
        Date.now()
        > verification.expiration
    ) {
        codesVerification.delete(
            numero
        );

        return false;
    }

    if (
        verification.code
        !== String(code).trim()
    ) {
        return false;
    }

    codesVerification.delete(
        numero
    );

    return true;
}

function trouverUtilisateurParNumero(numero) {

    const utilisateurs =
        chargerUtilisateurs();

    return utilisateurs.find(
        utilisateur =>
            utilisateur.numero === numero
    ) || null;
}


function trouverUtilisateurParIdentifiant(identifiant) {
    const utilisateurs = chargerUtilisateurs();

    return utilisateurs.find(
        utilisateur =>
            utilisateur.identifiant === identifiant
    ) || null;
}

module.exports = {
    creerUtilisateur,
    verifierConnexion,
    trouverUtilisateurParNumero,
    trouverUtilisateurParIdentifiant,
    creerCodeVerification,
    verifierCodeVerification
};
