const fs = require("fs");
const path = require("path");

const fichier =
    path.join(
        __dirname,
        "..",
        "data",
        "messages.json"
    );

function chargerMessages() {

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

function sauvegarderMessages(messages) {

    fs.writeFileSync(
        fichier,
        JSON.stringify(
            messages,
            null,
            2
        ),
        "utf8"
    );
}

function ajouterMessage(message) {

    const messages =
        chargerMessages();

    messages.push(message);

    sauvegarderMessages(
        messages
    );

    return message;
}

function messagesPourUtilisateur(
    identifiant
) {

    return chargerMessages().filter(
        message =>
            message.destinataire
            === identifiant
            && message.livre !== true
    );
}

function marquerCommeLivre(
    identifiant
) {

    const messages =
        chargerMessages();

    let nombre = 0;

    for (
        const message
        of messages
    ) {

        if (
            message.destinataire
            === identifiant
            && message.livre !== true
        ) {

            message.livre = true;
            nombre++;
        }
    }

    sauvegarderMessages(
        messages
    );

    return nombre;
}

module.exports = {
    chargerMessages,
    sauvegarderMessages,
    ajouterMessage,
    messagesPourUtilisateur,
    marquerCommeLivre
};
