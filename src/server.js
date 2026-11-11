require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});


const uploadStatut = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const types = [
            "image/jpeg", "image/png", "image/webp",
            "video/mp4", "video/webm", "video/quicktime"
        ];
        if (!types.includes(file.mimetype)) {
            return cb(new Error("Format refusé. Utilise JPG, PNG, WebP, MP4 ou WebM."));
        }
        cb(null, true);
    }
});

const fichierStatuts = path.join(__dirname, "..", "data", "statuts.json");

function lireStatutsJJM() {
    try {
        if (!fs.existsSync(fichierStatuts)) return [];
        const donnees = JSON.parse(fs.readFileSync(fichierStatuts, "utf8"));
        return Array.isArray(donnees) ? donnees : [];
    } catch (e) {
        console.error("Lecture des statuts impossible.");
        return [];
    }
}

function sauvegarderStatutsJJM(statuts) {
    const dossier = path.dirname(fichierStatuts);
    fs.mkdirSync(dossier, { recursive: true });
    const temporaire = fichierStatuts + ".tmp";
    fs.writeFileSync(temporaire, JSON.stringify(statuts, null, 2), "utf8");
    fs.renameSync(temporaire, fichierStatuts);
}

const uploadPhoto = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const typesAutorises = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];
        if (!typesAutorises.includes(file.mimetype)) {
            return cb(new Error("Format refusé. Utilise JPG, PNG ou WebP."));
        }
        cb(null, true);
    }
});

const {
    creerUtilisateur,
    verifierConnexion,
    trouverUtilisateurParNumero,
    trouverUtilisateurParEmail,
    trouverUtilisateurParIdentifiant,
    creerCodeVerification,
    verifierCodeVerification,
    mettreAJourPhotoProfil,
    normaliserNumero,
    numeroValide
} = require("./users");

const {
    ajouterMessage,
    chargerMessages,
    messagesPourUtilisateur,
    marquerCommeLivre
} = require("./messages");

const app = express();
const serveur = http.createServer(app);

const PORT = process.env.PORT || 8080;

const demandesInscriptionJJM = new Map();

const connexionsJJM = new Map();

function utilisateurConnecteJJM(identifiant) {

    const socket =
        connexionsJJM.get(
            identifiant
        );

    return (
        socket != null
        && socket.readyState
            === WebSocket.OPEN
    );
}

function nombreUtilisateursConnectesJJM() {

    let nombre = 0;

    for (
        const socket
        of connexionsJJM.values()
    ) {

        if (
            socket.readyState
                === WebSocket.OPEN
        ) {
            nombre++;
        }
    }

    return nombre;
}


function diffuserPresenceJJM(
    type,
    identifiant
) {

    const message =
        JSON.stringify({
            type: type,
            identifiant: identifiant
        });

    for (
        const socket
        of connexionsJJM.values()
    ) {

        if (
            socket.readyState
                === WebSocket.OPEN
        ) {

            socket.send(message);
        }
    }
}

app.use(cors());
app.use(express.json());


// ======================================================
// INSCRIPTION JJMWHATSAPP AVEC VERIFICATION BREVO
// ======================================================

const codesInscriptionEmailJJM = new Map();
const demandesInscriptionEmailJJM = new Map();

function emailInscriptionValide(email) {
    return email.length <= 254
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.post("/api/inscription/demander-code", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const numero = normaliserNumero(req.body.numero || "");

        if (!emailInscriptionValide(email) || !numeroValide(numero)) {
            return res.status(400).json({
                ok: false,
                message: "Adresse e-mail ou numéro de téléphone invalide."
            });
        }

        if (trouverUtilisateurParNumero(numero)) {
            return res.status(409).json({
                ok: false,
                message: "Ce numéro possède déjà un compte JJM."
            });
        }

        if (trouverUtilisateurParEmail(email)) {
            return res.status(409).json({
                ok: false,
                message: "Cette adresse e-mail possède déjà un compte JJM."
            });
        }

        const apiKey = process.env.BREVO_API_KEY;
        const senderEmail = process.env.BREVO_SENDER_EMAIL;
        const senderName = process.env.BREVO_SENDER_NAME || "JJMWHATSAPP";

        if (!apiKey || !senderEmail || !process.env.JJM_JWT_SECRET) {
            return res.status(503).json({
                ok: false,
                message: "Le service de vérification e-mail n'est pas configuré."
            });
        }

        const maintenant = Date.now();
        const derniereDemande =
            demandesInscriptionEmailJJM.get(email) || 0;

        if (maintenant - derniereDemande < 60000) {
            return res.status(429).json({
                ok: false,
                message: "Attends 60 secondes avant de demander un autre code."
            });
        }

        const code = String(crypto.randomInt(100000, 1000000));

        const resultat = await fetch(
            "https://api.brevo.com/v3/smtp/email",
            {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "api-key": apiKey,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    sender: {
                        name: senderName,
                        email: senderEmail
                    },
                    to: [{ email }],
                    subject: "Ton code de vérification JJMWHATSAPP",
                    textContent:
                        "Ton code JJMWHATSAPP est : " + code
                        + ". Il expire dans 10 minutes.",
                    htmlContent:
                        "<div style='font-family:Arial,sans-serif'>"
                        + "<h2>JJMWHATSAPP</h2>"
                        + "<p>Voici ton code de vérification :</p>"
                        + "<h1 style='letter-spacing:8px'>" + code + "</h1>"
                        + "<p>Ce code expire dans 10 minutes.</p>"
                        + "<p>Si tu n'es pas à l'origine de cette demande, ignore cet e-mail.</p>"
                        + "</div>"
                })
            }
        );

        const donnees = await resultat.json().catch(() => ({}));

        if (!resultat.ok) {
            console.error(
                "Brevo refus :",
                resultat.status,
                donnees.message || donnees.code || "erreur"
            );

            return res.status(502).json({
                ok: false,
                message: "Brevo n'a pas pu envoyer l'e-mail. Vérifie l'expéditeur dans Brevo."
            });
        }

        demandesInscriptionEmailJJM.set(email, maintenant);
        codesInscriptionEmailJJM.set(email, {
            code,
            numero,
            expiration: maintenant + 10 * 60 * 1000,
            tentatives: 0
        });

        return res.json({
            ok: true,
            message: "Code de vérification envoyé par e-mail."
        });

    } catch (e) {
        console.error("Erreur demande code e-mail :", e.message);
        return res.status(500).json({
            ok: false,
            message: "Impossible d'envoyer le code par e-mail."
        });
    }
});


app.post("/api/inscription/verifier-code", async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const numero = normaliserNumero(req.body.numero || "");
        const code = String(req.body.code || "").trim();
        const secret = process.env.JJM_JWT_SECRET;

        if (!emailInscriptionValide(email)
                || !numeroValide(numero)
                || !/^\d{6}$/.test(code)) {
            return res.status(400).json({
                ok: false,
                message: "E-mail, numéro ou code à six chiffres invalide."
            });
        }

        if (!secret) {
            return res.status(503).json({
                ok: false,
                message: "Service de vérification non configuré."
            });
        }

        const verification = codesInscriptionEmailJJM.get(email);

        if (!verification || verification.numero !== numero) {
            return res.status(401).json({
                ok: false,
                message: "Code absent ou expiré. Demande un nouveau code."
            });
        }

        if (Date.now() > verification.expiration) {
            codesInscriptionEmailJJM.delete(email);
            return res.status(401).json({
                ok: false,
                message: "Code expiré. Demande un nouveau code."
            });
        }

        verification.tentatives++;

        const attendu = Buffer.from(verification.code);
        const recu = Buffer.from(code);

        const correct = attendu.length === recu.length
            && crypto.timingSafeEqual(attendu, recu);

        if (!correct) {
            if (verification.tentatives >= 5) {
                codesInscriptionEmailJJM.delete(email);
                return res.status(401).json({
                    ok: false,
                    message: "Trop de tentatives. Demande un nouveau code."
                });
            }

            return res.status(401).json({
                ok: false,
                message: "Code incorrect. Vérifie les six chiffres."
            });
        }

        codesInscriptionEmailJJM.delete(email);

        const inscriptionToken = jwt.sign(
            {
                purpose: "jjm_inscription_email",
                numero,
                email
            },
            secret,
            { expiresIn: "10m" }
        );

        return res.json({
            ok: true,
            message: "Adresse e-mail vérifiée.",
            inscriptionToken
        });

    } catch (e) {
        console.error("Erreur vérification e-mail :", e.message);
        return res.status(500).json({
            ok: false,
            message: "Impossible de vérifier le code."
        });
    }
});


app.post("/api/inscription/creer-compte", async (req, res) => {
    try {
        const nom = String(req.body.nom || "").trim();
        const inscriptionToken = String(req.body.inscriptionToken || "");
        const secret = process.env.JJM_JWT_SECRET;

        if (!secret) {
            return res.status(503).json({
                ok: false,
                message: "Le service d'inscription n'est pas configuré."
            });
        }

        if (nom.length < 2 || nom.length > 60 || !inscriptionToken) {
            return res.status(400).json({
                ok: false,
                message: "Nom et autorisation de vérification obligatoires."
            });
        }

        let autorisation;

        try {
            autorisation = jwt.verify(inscriptionToken, secret);
        } catch (e) {
            return res.status(401).json({
                ok: false,
                message: "Vérification expirée. Recommence l'inscription."
            });
        }

        if (
            autorisation.purpose !== "jjm_inscription_email"
            || !numeroValide(autorisation.numero)
            || !emailInscriptionValide(String(autorisation.email || ""))
        ) {
            return res.status(401).json({
                ok: false,
                message: "Autorisation d'inscription invalide."
            });
        }

        const numero = normaliserNumero(autorisation.numero);
        const email = String(autorisation.email).trim().toLowerCase();

        if (trouverUtilisateurParNumero(numero)) {
            return res.status(409).json({
                ok: false,
                message: "Ce numéro possède déjà un compte JJM."
            });
        }

        if (trouverUtilisateurParEmail(email)) {
            return res.status(409).json({
                ok: false,
                message: "Cette adresse e-mail possède déjà un compte JJM."
            });
        }

        const motDePasseAleatoire = crypto.randomBytes(48).toString("hex");

        const utilisateur = await creerUtilisateur(
            nom,
            numero,
            motDePasseAleatoire,
            email
        );

        const token = jwt.sign(
            {
                sub: utilisateur.id,
                identifiant: utilisateur.identifiant
            },
            secret,
            { expiresIn: "30d" }
        );

        return res.status(201).json({
            ok: true,
            token,
            utilisateur: {
                id: utilisateur.id,
                identifiant: utilisateur.identifiant,
                nom: utilisateur.nom,
                numero: utilisateur.numero,
                email: utilisateur.email
            }
        });

    } catch (e) {
        console.error("Erreur création compte vérifié :", e.message);
        return res.status(409).json({
            ok: false,
            message: e.message || "Création du compte impossible."
        });
    }
});

// FIN INSCRIPTION JJMWHATSAPP AVEC VERIFICATION BREVO




app.post(
    "/api/demander-code",
    async (req, res) => {

        try {

            const numero =
                String(
                    req.body.numero || ""
                ).trim();

            if (!numero) {
                return res.status(400).json({
                    ok: false,
                    message:
                        "Numéro obligatoire."
                });
            }

            const utilisateur =
                trouverUtilisateurParNumero(
                    numero
                );

            if (!utilisateur) {
                return res.status(404).json({
                    ok: false,
                    message:
                        "Numéro non enregistré dans JJM."
                });
            }

            const code =
                creerCodeVerification(
                    numero
                );

            console.log(
                "CODE JJM POUR "
                + numero
                + " : "
                + code
            );

            res.json({
                ok: true,
                message:
                    "Code de vérification généré."
            });

        } catch (e) {

            console.error(
                "Erreur demande code JJM :",
                e
            );

            res.status(500).json({
                ok: false,
                message:
                    "Erreur interne du serveur."
            });
        }
    }
);

app.post("/api/verifier-code", (req, res) => {

    try {

        const numero =
            String(
                req.body.numero || ""
            ).trim();

        const code =
            String(
                req.body.code || ""
            ).trim();

        if (!numero || !code) {
            return res.status(400).json({
                ok: false,
                message:
                    "Numéro et code obligatoires."
            });
        }

        const utilisateur =
            trouverUtilisateurParNumero(
                numero
            );

        if (!utilisateur) {
            return res.status(404).json({
                ok: false,
                message:
                    "Ce numéro n'est pas enregistré sur JJM."
            });
        }

        const valide =
            verifierCodeVerification(
                numero,
                code
            );

        if (!valide) {
            return res.status(401).json({
                ok: false,
                message:
                    "Code incorrect ou expiré."
            });
        }

        const secret =
            process.env.JJM_JWT_SECRET;

        if (!secret) {
            return res.status(500).json({
                ok: false,
                message:
                    "JJM_JWT_SECRET n'est pas configuré."
            });
        }

        const token =
            jwt.sign(
                {
                    sub: utilisateur.id,
                    identifiant:
                        utilisateur.identifiant
                },
                secret,
                {
                    expiresIn: "30d"
                }
            );

        res.json({
            ok: true,
            token,
            utilisateur: {
                id: utilisateur.id,
                identifiant:
                    utilisateur.identifiant,
                nom:
                    utilisateur.nom,
                numero:
                    utilisateur.numero
            }
        });

    } catch (e) {

        console.error(
            "Erreur vérification code JJM :",
            e
        );

        res.status(500).json({
            ok: false,
            message:
                "Erreur interne du serveur."
        });
    }
});

app.post("/api/register", async (req, res) => {

    try {

        const nom =
            String(req.body.nom || "").trim();

        const numero =
            String(req.body.numero || "").trim();

        const motDePasse =
            String(req.body.motDePasse || "");

        if (
            !nom ||
            !numero ||
            !motDePasse
        ) {
            return res.status(400).json({
                ok: false,
                message:
                    "Nom, numéro et mot de passe obligatoires."
            });
        }

        if (motDePasse.length < 6) {
            return res.status(400).json({
                ok: false,
                message:
                    "Le mot de passe doit contenir au moins 6 caractères."
            });
        }

        const utilisateur =
            await creerUtilisateur(
                nom,
                numero,
                motDePasse
            );

        res.status(201).json({
            ok: true,
            utilisateur: {
                id: utilisateur.id,
                identifiant:
                    utilisateur.identifiant,
                nom: utilisateur.nom,
                numero: utilisateur.numero
            }
        });

    } catch (e) {

        res.status(409).json({
            ok: false,
            message: e.message
        });
    }
});

app.post("/api/login", async (req, res) => {

    try {

        const numero =
            String(req.body.numero || "").trim();

        const motDePasse =
            String(req.body.motDePasse || "");

        const utilisateur =
            await verifierConnexion(
                numero,
                motDePasse
            );

        if (!utilisateur) {
            return res.status(401).json({
                ok: false,
                message:
                    "Numéro ou mot de passe incorrect."
            });
        }

        const secret =
            process.env.JJM_JWT_SECRET;

        if (!secret) {
            return res.status(500).json({
                ok: false,
                message:
                    "JJM_JWT_SECRET n'est pas configuré."
            });
        }

        const token =
            jwt.sign(
                {
                    sub: utilisateur.id,
                    identifiant:
                        utilisateur.identifiant
                },
                secret,
                {
                    expiresIn: "30d"
                }
            );

        res.json({
            ok: true,
            token,
            utilisateur: {
                id: utilisateur.id,
                identifiant:
                    utilisateur.identifiant,
                nom: utilisateur.nom,
                numero: utilisateur.numero
            }
        });

    } catch (e) {

        res.status(500).json({
            ok: false,
            message:
                "Erreur interne du serveur."
        });
    }
});

function authentifierJJM(req, res, next) {

    const autorisation =
        req.headers.authorization || "";

    if (!autorisation.startsWith("Bearer ")) {
        return res.status(401).json({
            ok: false,
            message: "Token d'authentification manquant."
        });
    }

    const token =
        autorisation.substring(7).trim();

    const secret =
        process.env.JJM_JWT_SECRET;

    if (!secret) {
        return res.status(500).json({
            ok: false,
            message: "JJM_JWT_SECRET n'est pas configuré."
        });
    }

    try {

        const contenu =
            jwt.verify(
                token,
                secret
            );

        req.utilisateurJJM = contenu;

        next();

    } catch (e) {

        return res.status(401).json({
            ok: false,
            message: "Token invalide ou expiré."
        });
    }
}


app.post(
    "/api/profil/photo",
    authentifierJJM,
    (req, res, next) => {
        uploadPhoto.single("photo")(req, res, (erreur) => {
            if (erreur) {
                const statut = erreur.code === "LIMIT_FILE_SIZE" ? 413 : 400;
                return res.status(statut).json({
                    ok: false,
                    message: erreur.message || "Photo invalide."
                });
            }
            next();
        });
    },
    (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                ok: false,
                message: "Aucune photo reçue."
            });
        }

        if (
            !process.env.CLOUDINARY_CLOUD_NAME ||
            !process.env.CLOUDINARY_API_KEY ||
            !process.env.CLOUDINARY_API_SECRET
        ) {
            return res.status(503).json({
                ok: false,
                message: "Le stockage des photos n'est pas configuré."
            });
        }

        const identifiant = req.utilisateurJJM.identifiant;

        const flux = cloudinary.uploader.upload_stream(
            {
                folder: "jjmwhatsapp/profils",
                public_id: identifiant + "_profil",
                overwrite: true,
                resource_type: "image",
                transformation: [
                    { width: 800, height: 800, crop: "limit" }
                ]
            },
            (erreur, resultat) => {
                if (erreur) {
                    console.error("Erreur Cloudinary :", erreur.message);
                    return res.status(502).json({
                        ok: false,
                        message: "Impossible d'enregistrer la photo."
                    });
                }

                const compte = mettreAJourPhotoProfil(
                    identifiant,
                    resultat.secure_url,
                    resultat.public_id
                );

                if (!compte) {
                    return res.status(404).json({
                        ok: false,
                        message: "Compte JJM introuvable."
                    });
                }

                return res.json({
                    ok: true,
                    photoProfil: compte.photoProfil,
                    message: "Photo de profil mise à jour."
                });
            }
        );

        flux.end(req.file.buffer);
    }
);

app.get("/api/me", authentifierJJM, (req, res) => {

    const utilisateur =
        trouverUtilisateurParIdentifiant(
            req.utilisateurJJM.identifiant
        );

    if (!utilisateur) {
        return res.status(404).json({
            ok: false,
            message:
                "Utilisateur introuvable."
        });
    }

    res.json({
        ok: true,
        utilisateur: {
            id: utilisateur.id,
            identifiant:
                utilisateur.identifiant,
            nom: utilisateur.nom,
            numero: utilisateur.numero,
                photoProfil: utilisateur.photoProfil || ""
        }
    });
});

app.get(
    "/api/utilisateur-par-numero",
    authentifierJJM,
    (req, res) => {

        const numero =
            String(
                req.query.numero || ""
            ).trim();

        if (!numero) {
            return res.status(400).json({
                ok: false,
                message:
                    "Numéro obligatoire."
            });
        }

        const utilisateur =
            require("./users")
                .trouverUtilisateurParNumero(
                    numero
                );

        if (!utilisateur) {
            return res.status(404).json({
                ok: false,
                message:
                    "Utilisateur JJM introuvable."
            });
        }

        res.json({
            ok: true,
            utilisateur: {
                identifiant:
                    utilisateur.identifiant,
                nom:
                    utilisateur.nom,
                numero:
                    utilisateur.numero,
                photoProfil: utilisateur.photoProfil || ""
            }
        });
    }
);

app.post(
    "/api/utilisateurs-par-numeros",
    authentifierJJM,
    (req, res) => {

        const numeros =
            Array.isArray(req.body.numeros)
                ? req.body.numeros
                : [];

        if (numeros.length === 0) {
            return res.json({
                ok: true,
                utilisateurs: []
            });
        }

        const users =
            require("./users");

        const utilisateurs = [];

        for (const numero of numeros) {

            const utilisateur =
                users.trouverUtilisateurParNumero(
                    numero
                );

            if (utilisateur) {
                utilisateurs.push({
                    identifiant:
                        utilisateur.identifiant,
                    nom:
                        utilisateur.nom,
                    numero:
                        utilisateur.numero,
                photoProfil: utilisateur.photoProfil || ""
                });
            }
        }

        res.json({
            ok: true,
            utilisateurs
        });
    }
);

app.post(
    "/api/statuts-utilisateurs",
    authentifierJJM,
    (req, res) => {

        const identifiants =
            Array.isArray(req.body.identifiants)
                ? req.body.identifiants
                : [];

        const statuts = {};

        for (const identifiant of identifiants) {

            const id =
                String(identifiant || "").trim();

            if (!id) {
                continue;
            }

            statuts[id] =
                utilisateurConnecteJJM(id);
        }

        res.json({
            ok: true,
            statuts
        });
    }
);


app.post(
    "/api/statuts",
    authentifierJJM,
    (req, res, next) => {
        uploadStatut.single("media")(req, res, (erreur) => {
            if (erreur) {
                const code = erreur.code === "LIMIT_FILE_SIZE" ? 413 : 400;
                return res.status(code).json({
                    ok: false,
                    message: erreur.message || "Média invalide."
                });
            }
            next();
        });
    },
    async (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                ok: false,
                message: "Aucune photo ou vidéo reçue."
            });
        }

        if (
            !process.env.CLOUDINARY_CLOUD_NAME ||
            !process.env.CLOUDINARY_API_KEY ||
            !process.env.CLOUDINARY_API_SECRET
        ) {
            return res.status(503).json({
                ok: false,
                message: "Le stockage Cloudinary n'est pas configuré."
            });
        }

        const identifiant = req.utilisateurJJM.identifiant;
        const compte = trouverUtilisateurParIdentifiant(identifiant);

        if (!compte) {
            return res.status(404).json({
                ok: false,
                message: "Compte JJM introuvable."
            });
        }

        const typeMedia = req.file.mimetype.startsWith("video/")
            ? "video"
            : "image";

        try {
            const resultat = await new Promise((resolve, reject) => {
                const flux = cloudinary.uploader.upload_stream({
                    folder: "jjmwhatsapp/statuts",
                    public_id: crypto.randomUUID(),
                    resource_type: "auto",
                    overwrite: false
                }, (erreur, resultatCloudinary) => {
                    if (erreur) return reject(erreur);
                    resolve(resultatCloudinary);
                });
                flux.end(req.file.buffer);
            });

            const maintenant = Date.now();
            const statut = {
                id: crypto.randomUUID(),
                identifiant,
                nom: compte.nom || identifiant,
                photoProfil: compte.photoProfil || "",
                mediaUrl: resultat.secure_url,
                mediaType: typeMedia,
                texte: String(req.body.texte || "").trim().slice(0, 500),
                creeLe: maintenant,
                expireLe: maintenant + 24 * 60 * 60 * 1000,
                vues: []
            };

            const statuts = lireStatutsJJM().filter(
                element => Number(element.expireLe) > maintenant
            );
            statuts.push(statut);
            sauvegarderStatutsJJM(statuts);

            return res.status(201).json({
                ok: true,
                statut,
                message: "Statut publié."
            });
        } catch (erreur) {
            console.error("Publication statut Cloudinary :", erreur.message);
            return res.status(502).json({
                ok: false,
                message: "Impossible de publier ce statut."
            });
        }
    }
);

app.get(
    "/api/statuts",
    authentifierJJM,
    (req, res) => {
        const maintenant = Date.now();
        const statuts = lireStatutsJJM().filter(
            element => Number(element.expireLe) > maintenant
        );
        res.json({ ok: true, statuts });
    }
);

app.post(
    "/api/statuts/:id/vue",
    authentifierJJM,
    (req, res) => {
        const maintenant = Date.now();
        const identifiant = req.utilisateurJJM.identifiant;
        const statuts = lireStatutsJJM().filter(
            element => Number(element.expireLe) > maintenant
        );
        const statut = statuts.find(element => element.id === req.params.id);

        if (!statut) {
            return res.status(404).json({
                ok: false,
                message: "Ce statut n'existe plus."
            });
        }

        if (statut.identifiant !== identifiant && !statut.vues.includes(identifiant)) {
            statut.vues.push(identifiant);
            sauvegarderStatutsJJM(statuts);
        }

        res.json({ ok: true });
    }
);

app.post(
    "/api/historique-conversation",
    authentifierJJM,
    (req, res) => {

        const autreUtilisateur =
            String(
                req.body.autreUtilisateur || ""
            ).trim();

        if (!autreUtilisateur) {
            return res.status(400).json({
                ok: false,
                erreur: "Utilisateur destinataire manquant"
            });
        }

        const messages =
            chargerMessages();

        const identifiantConnecte =
            req.utilisateurJJM.identifiant;

        const historique =
            messages.filter(
                message =>
                    (
                        message.expediteur ===
                            identifiantConnecte
                        &&
                        message.destinataire ===
                            autreUtilisateur
                    )
                    ||
                    (
                        message.expediteur ===
                            autreUtilisateur
                        &&
                        message.destinataire ===
                            identifiantConnecte
                    )
            );

        res.json({
            ok: true,
            messages: historique
        });
    }
);

app.get(
    "/api/messages-hors-ligne",
    authentifierJJM,
    (req, res) => {

        const messages =
            messagesPourUtilisateur(
                req.utilisateurJJM.identifiant
            );

        res.json({
            ok: true,
            nombre: messages.length,
            messages
        });
    }
);

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        service: "JJMWHATSAPP",
        message: "Serveur JJM opérationnel",
        websocket: {
            actif: true,
            utilisateursConnectes:
                nombreUtilisateursConnectesJJM()
        }
    });
});

const wss = new WebSocket.Server({
    server: serveur
});

wss.on("connection", (socket, req) => {

    const url =
        new URL(
            req.url,
            "http://" + req.headers.host
        );

    const token =
        url.searchParams.get("token");

    const secret =
        process.env.JJM_JWT_SECRET;

    if (!token || !secret) {

        socket.close(
            1008,
            "Authentification requise"
        );

        return;
    }

    try {

        const contenu =
            jwt.verify(
                token,
                secret
            );

        socket.utilisateurJJM = contenu;

        connexionsJJM.set(
            contenu.identifiant,
            socket
        );

        console.log(
            "WebSocket authentifié :",
            contenu.identifiant
        );

        console.log(
            "Utilisateurs WebSocket connectés :",
            nombreUtilisateursConnectesJJM()
        );

        diffuserPresenceJJM(
            "utilisateur_en_ligne",
            contenu.identifiant
        );

        socket.send(
            JSON.stringify({
                type: "connexion",
                ok: true,
                message:
                    "Connexion WebSocket JJM réussie",
                identifiant:
                    contenu.identifiant
            })
        );

        const messagesEnAttente =
            messagesPourUtilisateur(
                contenu.identifiant
            );

        for (
            const messageEnAttente
            of messagesEnAttente
        ) {

            socket.send(
                JSON.stringify(
                    messageEnAttente
                )
            );
        }

        if (
            messagesEnAttente.length > 0
        ) {

            const nombreLivres =
                marquerCommeLivre(
                    contenu.identifiant
                );

            console.log(
                "Messages hors ligne synchronisés :",
                contenu.identifiant,
                nombreLivres
            );
        }

    } catch (e) {

        socket.close(
            1008,
            "Token invalide ou expiré"
        );

        return;
    }

    socket.on("message", (donnees) => {

        try {

            const message =
                JSON.parse(
                    donnees.toString()
                );

            if (
                message.type !==
                "message"
            ) {
                socket.send(
                    JSON.stringify({
                        type: "erreur",
                        ok: false,
                        message:
                            "Type de message inconnu."
                    })
                );

                return;
            }

            const destinataire =
                String(
                    message.destinataire || ""
                ).trim();

            const texteMessage =
                String(
                    message.texte || ""
                ).trim();

            if (
                !destinataire ||
                !texteMessage
            ) {
                socket.send(
                    JSON.stringify({
                        type: "erreur",
                        ok: false,
                        message:
                            "Destinataire et texte obligatoires."
                    })
                );

                return;
            }

            const messageJJM = {

                type:
                    "nouveau_message",

                id:
                    require("crypto")
                        .randomUUID(),

                expediteur:
                    socket.utilisateurJJM
                        .identifiant,

                destinataire,

                texte:
                    texteMessage,

                date:
                    new Date().toISOString()
            };

            const connexionDestinataire =
                connexionsJJM.get(
                    destinataire
                );

            const destinataireEnLigne =
                utilisateurConnecteJJM(
                    destinataire
                );

            // Tous les messages sont sauvegardés,
            // qu'ils soient envoyés en ligne ou conservés hors ligne.

            messageJJM.livre =
                destinataireEnLigne;

            ajouterMessage(
                messageJJM
            );

            if (
                destinataireEnLigne
            ) {

                connexionDestinataire.send(
                    JSON.stringify(
                        messageJJM
                    )
                );

                console.log(
                    "Message envoyé et sauvegardé :",
                    destinataire
                );

            } else {

                console.log(
                    "Message conservé hors ligne pour :",
                    destinataire
                );
            }

            socket.send(
                JSON.stringify({
                    type:
                        "message_envoye",

                    ok: true,

                    enLigne:
                        destinataireEnLigne,

                    message:
                        messageJJM
                })
            );

            console.log(
                "Message :",
                socket.utilisateurJJM
                    .identifiant,
                "->",
                destinataire
            );

        } catch (e) {

            socket.send(
                JSON.stringify({
                    type: "erreur",
                    ok: false,
                    message:
                        "Message invalide."
                })
            );
        }
    });

    socket.on("close", () => {

        const identifiant =
            socket.utilisateurJJM.identifiant;

        if (
            connexionsJJM.get(identifiant)
            === socket
        ) {
            connexionsJJM.delete(
                identifiant
            );

            diffuserPresenceJJM(
                "utilisateur_hors_ligne",
                identifiant
            );
        }

        console.log(
            "WebSocket déconnecté :",
            identifiant
        );

        console.log(
            "Utilisateurs WebSocket connectés :",
            nombreUtilisateursConnectesJJM()
        );
    });
});

serveur.listen(PORT, "0.0.0.0", () => {

    console.log(
        `Serveur JJM démarré sur le port ${PORT}`
    );

    console.log(
        `http://127.0.0.1:${PORT}/health`
    );
});
