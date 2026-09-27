require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");

const {
    creerUtilisateur,
    verifierConnexion,
    trouverUtilisateurParNumero,
    trouverUtilisateurParIdentifiant,
    creerCodeVerification,
    verifierCodeVerification
} = require("./users");

const {
    ajouterMessage,
    messagesPourUtilisateur,
    marquerCommeLivre
} = require("./messages");

const app = express();
const serveur = http.createServer(app);

const PORT = process.env.PORT || 8080;

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

app.use(cors());
app.use(express.json());

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
            numero: utilisateur.numero
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
                    utilisateur.numero
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
                        utilisateur.numero
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
