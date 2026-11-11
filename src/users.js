const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const dossierData =
    path.join(__dirname, "..", "data");

if (!fs.existsSync(dossierData)) {
    fs.mkdirSync(
        dossierData,
        { recursive: true }
    );
}

const fichier =
    path.join(
        dossierData,
        "users.json"
    );


function normaliserNumero(numero) {

    let valeur =
        String(numero || "").trim();

    valeur =
        valeur.replace(/[\s().-]/g, "");

    if (valeur.startsWith("+")) {
        valeur = valeur.substring(1);
    }

    if (valeur.startsWith("00")) {
        valeur = valeur.substring(2);
    }

    if (valeur.startsWith("0")) {
        valeur = "243" + valeur.substring(1);
    }

    return valeur;
}

function numeroValide(numero) {

    // Format international E.164 sans le signe + :
    // 8 à 15 chiffres, sans zéro initial.
    return /^[1-9]\d{7,14}$/.test(
        normaliserNumero(numero)
    );
}

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
    motDePasse,
    email = null
) {

    numero = normaliserNumero(numero);

    email = email ? String(email).trim().toLowerCase() : "";

    if (email && (
        email.length > 254
        || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)
    )) {
        throw new Error("Adresse e-mail invalide.");
    }

    const utilisateurs =
        chargerUtilisateurs();

    if (email && utilisateurs.some(
        utilisateur =>
            String(utilisateur.email || "").toLowerCase() === email
    )) {
        throw new Error("Cette adresse e-mail possède déjà un compte JJM.");
    }

    const existe =
        utilisateurs.find(
            utilisateur =>
                normaliserNumero(utilisateur.numero) === numero
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

        ...(email ? { email } : {}),

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

    numero = normaliserNumero(numero);

    const utilisateurs =
        chargerUtilisateurs();

    const utilisateur =
        utilisateurs.find(
            utilisateur =>
                normaliserNumero(utilisateur.numero) === numero
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

    const numeroNormalise =
        normaliserNumero(numero);

    const utilisateurs =
        chargerUtilisateurs();

    return utilisateurs.find(
        utilisateur =>
            normaliserNumero(utilisateur.numero)
            === numeroNormalise
    ) || null;
}


function trouverUtilisateurParEmail(email) {
    const valeur = String(email || "").trim().toLowerCase();
    if (!valeur) return null;

    return chargerUtilisateurs().find(
        utilisateur =>
            String(utilisateur.email || "").toLowerCase() === valeur
    ) || null;
}


function trouverUtilisateurParIdentifiant(identifiant) {
    const utilisateurs = chargerUtilisateurs();

    return utilisateurs.find(
        utilisateur =>
            utilisateur.identifiant === identifiant
    ) || null;
}


function mettreAJourPhotoProfil(identifiant, photoProfil, photoProfilPublicId) {
    const utilisateurs = chargerUtilisateurs();
    const utilisateur = utilisateurs.find(
        element => element.identifiant === identifiant
    );

    if (!utilisateur) {
        return null;
    }

    utilisateur.photoProfil = photoProfil;
    utilisateur.photoProfilPublicId = photoProfilPublicId;

    sauvegarderUtilisateurs(utilisateurs);

    return {
        identifiant: utilisateur.identifiant,
        photoProfil: utilisateur.photoProfil
    };
}

module.exports = {
    creerUtilisateur,
    mettreAJourPhotoProfil,
    verifierConnexion,
    trouverUtilisateurParNumero,
    trouverUtilisateurParEmail,
    trouverUtilisateurParIdentifiant,
    creerCodeVerification,
    verifierCodeVerification,
    normaliserNumero,
    numeroValide
};
