CLEAN RIDE — automatische aanvraagmails

Wat dit doet:
1. Klant vult het formulier in.
2. Clean Ride krijgt een e-mail met alle gegevens.
3. In die e-mail staan ACCEPTEREN en WEIGEREN.
4. Klik op ACCEPTEREN -> klant krijgt automatisch de bevestigingsmail.
5. Klik op WEIGEREN -> klant krijgt automatisch de vriendelijke weigermail.
6. Bij accepteren staat expliciet dat betaling achteraf gebeurt als de klant tevreden is.

INSTALLATIE
1. Installeer Node.js.
2. Open deze map in een terminal.
3. Run: npm install
4. Kopieer .env.example naar .env.
5. Vul de SMTP-gegevens van je mailprovider in.
6. Zet BASE_URL op het echte adres van je website.
7. Kies een lange ACTION_SECRET.
8. Run: npm start

BELANGRIJK
De SMTP-gegevens zijn nodig om echt mails te versturen. Zet wachtwoorden nooit in index.html en deel je .env-bestand niet publiek.
