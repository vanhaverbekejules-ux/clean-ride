const express = require('express');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'clean-ride@hotmail.com';
const MAIL_FROM = process.env.MAIL_FROM || 'clean-ride@hotmail.com';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SECRET = process.env.ACTION_SECRET || 'CHANGE-ME';
const BREVO_API_KEY = process.env.BREVO_API_KEY;

function createToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(body)
    .digest('base64url');

  return `${body}.${signature}`;
}

function verifyToken(token) {
  const [body, signature] = String(token).split('.');

  if (!body || !signature) {
    throw new Error('Ongeldige link');
  }

  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(body)
    .digest('base64url');

  if (signature.length !== expected.length) {
    throw new Error('Ongeldige link');
  }

  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )
  ) {
    throw new Error('Ongeldige link');
  }

  return JSON.parse(
    Buffer.from(body, 'base64url').toString()
  );
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

async function sendEmail({ to, subject, html, replyTo }) {
  if (!BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY ontbreekt');
  }

  const response = await fetch(
    'https://api.brevo.com/v3/smtp/email',
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: 'Clean Ride',
          email: MAIL_FROM
        },
        to: [
          {
            email: to
          }
        ],
        ...(replyTo ? {
          replyTo: {
            email: replyTo
          }
        } : {}),
        subject,
        htmlContent: html
      })
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Brevo API ${response.status}: ${responseText}`
    );
  }

  return responseText
    ? JSON.parse(responseText)
    : {};
}


/* NIEUWE AANVRAAG */

app.post('/api/request', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      service,
      message = ''
    } = req.body || {};

    if (!name || !email || !phone || !service) {
      return res.status(400).json({
        error: 'Vul alle verplichte velden in.'
      });
    }

    const payload = {
      name,
      email,
      phone,
      service,
      message,
      createdAt: Date.now()
    };

    const token = createToken(payload);

    const acceptUrl =
      `${BASE_URL}/api/decision?action=accept&token=${encodeURIComponent(token)}`;

    const rejectUrl =
      `${BASE_URL}/api/decision?action=reject&token=${encodeURIComponent(token)}`;

    await sendEmail({
      to: OWNER_EMAIL,
      replyTo: email,
      subject: `Nieuwe Clean Ride aanvraag — ${name}`,
      html: `
        <h2>Nieuwe Clean Ride aanvraag 🚲</h2>

        <p>
          <b>Naam:</b> ${esc(name)}<br>
          <b>E-mail:</b> ${esc(email)}<br>
          <b>Telefoon:</b> ${esc(phone)}<br>
          <b>Service:</b> ${esc(service)}<br>
          <b>Opmerking:</b> ${esc(message) || '—'}
        </p>

        <p>
          <a
            href="${acceptUrl}"
            style="
              display:inline-block;
              padding:12px 18px;
              background:#7cff00;
              color:#000;
              text-decoration:none;
              font-weight:bold;
              border-radius:8px;
            "
          >
            AANVRAAG ACCEPTEREN
          </a>
        </p>

        <p>
          <a
            href="${rejectUrl}"
            style="
              display:inline-block;
              padding:12px 18px;
              background:#ff3b7a;
              color:#fff;
              text-decoration:none;
              font-weight:bold;
              border-radius:8px;
            "
          >
            AANVRAAG WEIGEREN
          </a>
        </p>
      `
    });

    res.json({
      ok: true
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Mail kon niet worden verstuurd.'
    });
  }
});


/* ACCEPTEREN / WEIGEREN */

app.get('/api/decision', async (req, res) => {
  try {
    const data = verifyToken(req.query.token);

    const accepted = req.query.action === 'accept';

    if (
      !accepted &&
      req.query.action !== 'reject'
    ) {
      return res.status(400).send(
        'Ongeldige keuze.'
      );
    }

    let subject;
    let html;

    if (accepted) {
      subject =
        'Je aanvraag bij Clean Ride is bevestigd 🚲';

      html = `
        <h2>Bedankt om voor Clean Ride te kiezen! 🚲</h2>

        <p>
          Hallo ${esc(data.name)},
        </p>

        <p>
          We hebben je aanvraag voor
          <b>${esc(data.service)}</b>
          ontvangen en aanvaard.
        </p>

        <p>
          We kijken ernaar uit om je fiets weer helemaal netjes te maken.
        </p>

        <p>
          <b>De betaling gebeurt achteraf</b>,
          nadat de reiniging is uitgevoerd en je tevreden bent met het resultaat.
        </p>

        <p>
          Tot binnenkort!<br>
          <b>Team Clean Ride</b>
        </p>
      `;

    } else {
      subject =
        'Update over je aanvraag bij Clean Ride';

      html = `
        <h2>Bedankt voor je aanvraag bij Clean Ride</h2>

        <p>
          Hallo ${esc(data.name)},
        </p>

        <p>
          Helaas kunnen we je aanvraag momenteel niet aannemen
          omdat het op dit moment te druk is.
        </p>

        <p>
          We hopen je op een later moment wel te kunnen helpen.
          Bedankt voor je begrip!
        </p>

        <p>
          Groeten,<br>
          <b>Team Clean Ride</b>
        </p>
      `;
    }

    await sendEmail({
      to: data.email,
      subject,
      html
    });

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport"
          content="width=device-width, initial-scale=1">
        <title>Clean Ride</title>
      </head>

      <body
        style="
          font-family:Arial;
          padding:40px;
          text-align:center;
        "
      >
        <h1>Clean Ride 🚲</h1>

        <h2>
          ${
            accepted
              ? 'Aanvraag geaccepteerd ✅'
              : 'Aanvraag geweigerd ✅'
          }
        </h2>

        <p>
          De klant heeft automatisch een e-mail ontvangen.
        </p>
      </body>
      </html>
    `);

  } catch (error) {
    console.error(error);

    res.status(400).send(
      'Deze actie-link is ongeldig of verlopen.'
    );
  }
});


app.listen(PORT, () => {
  console.log(
    `Clean Ride draait op ${BASE_URL}`
  );
});
