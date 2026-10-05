const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');
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

// Team Clean Ride wachtwoord komt uit Render Environment Variables
const TEAM_PASSWORD = process.env.TEAM_PASSWORD || '';

/* =========================
   DATABASE
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn('WAARSCHUWING: DATABASE_URL ontbreekt.');
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      request_token TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      service TEXT NOT NULL,
      message TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS costs (
      id SERIAL PRIMARY KEY,
      supplier TEXT NOT NULL,
      description TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log('Database klaar.');
}

/* =========================
   PRIJZEN
========================= */

function getAmount(service = '') {
  const value = service.toLowerCase();

  if (value.includes('ultimate')) {
    return 15;
  }

  if (
    value.includes('grondige') ||
    value.includes('grondig')
  ) {
    return 11;
  }

  if (value.includes('basic')) {
    return 7;
  }

  if (
    value.includes('abonnement') ||
    value.includes('subscription')
  ) {
    return 100;
  }

  return 0;
}

/*
  Als je formulier bijvoorbeeld
  "Grondige Reiniging + €2 modder"
  verstuurt, rekenen we automatisch €13.
*/
function getAmountWithMud(service = '') {
  const base = getAmount(service);

  const mud =
    service.toLowerCase().includes('modder') ||
    service.toLowerCase().includes('mud');

  return base + (mud ? 2 : 0);
}

/* =========================
   TOKEN
========================= */

function createToken(payload) {
  const body = Buffer.from(
    JSON.stringify(payload)
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(body)
    .digest('base64url');

  return `${body}.${signature}`;
}

function verifyToken(token) {
  const [body, signature] =
    String(token).split('.');

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

/* =========================
   HTML ESCAPE
========================= */

function esc(value = '') {
  return String(value).replace(
    /[&<>"']/g,
    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char])
  );
}

/* =========================
   BREVO
========================= */

async function sendEmail({
  to,
  subject,
  html,
  replyTo
}) {
  if (!BREVO_API_KEY) {
    throw new Error(
      'BREVO_API_KEY ontbreekt'
    );
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
        ...(replyTo
          ? {
              replyTo: {
                email: replyTo
              }
            }
          : {}),
        subject,
        htmlContent: html
      })
    }
  );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Brevo API ${response.status}: ${responseText}`
    );
  }

  return responseText
    ? JSON.parse(responseText)
    : {};
}

/* =========================
   NIEUWE AANVRAAG
========================= */

app.post('/api/request', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      service,
      message = ''
    } = req.body || {};

    if (
      !name ||
      !email ||
      !phone ||
      !service
    ) {
      return res.status(400).json({
        error:
          'Vul alle verplichte velden in.'
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

    /*
      Aanvraag eerst in database zetten.
      Bedrag wordt pas echte omzet wanneer
      de aanvraag geaccepteerd wordt.
    */
    if (process.env.DATABASE_URL) {
      await pool.query(
        `
        INSERT INTO requests
        (
          request_token,
          name,
          email,
          phone,
          service,
          message,
          status,
          amount
        )
        VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
        ON CONFLICT (request_token)
        DO NOTHING
        `,
        [
          token,
          name,
          email,
          phone,
          service,
          message,
          getAmountWithMud(service)
        ]
      );
    }

    await sendEmail({
      to: OWNER_EMAIL,
      replyTo: email,
      subject:
        `Nieuwe Clean Ride aanvraag — ${name}`,
      html: `
        <h2>Nieuwe Clean Ride aanvraag 🚲</h2>

        <p>
          <b>Naam:</b> ${esc(name)}<br>
          <b>E-mail:</b> ${esc(email)}<br>
          <b>Telefoon:</b> ${esc(phone)}<br>
          <b>Service:</b> ${esc(service)}<br>
          <b>Opmerking:</b> ${
            esc(message) || '—'
          }
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
      error:
        'Mail kon niet worden verstuurd.'
    });
  }
});

/* =========================
   ACCEPTEREN / WEIGEREN
========================= */

app.get('/api/decision', async (req, res) => {
  try {
    const data =
      verifyToken(req.query.token);

    const accepted =
      req.query.action === 'accept';

    if (
      !accepted &&
      req.query.action !== 'reject'
    ) {
      return res.status(400).send(
        'Ongeldige keuze.'
      );
    }

    const amount =
      getAmountWithMud(data.service);

    /*
      DATABASE:
      Alleen de eerste beslissing telt.

      Hierdoor kan iemand niet per ongeluk
      twee keer op "Accepteren" drukken en
      de omzet verdubbelen.
    */
    let previousStatus = null;

    if (process.env.DATABASE_URL) {
      const result = await pool.query(
        `
        SELECT status
        FROM requests
        WHERE request_token = $1
        `,
        [req.query.token]
      );

      if (result.rows.length > 0) {
        previousStatus =
          result.rows[0].status;
      }

      if (
        previousStatus === 'accepted' ||
        previousStatus === 'rejected'
      ) {
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta name="viewport"
              content="width=device-width, initial-scale=1">
            <title>Clean Ride</title>
          </head>

          <body style="
            font-family:Arial;
            padding:40px;
            text-align:center;
          ">

            <h1>Clean Ride 🚲</h1>

            <h2>
              Deze aanvraag is al verwerkt.
            </h2>

            <p>
              De beslissing is al eerder geregistreerd.
            </p>

          </body>
          </html>
        `);
      }

      await pool.query(
        `
        UPDATE requests
        SET
          status = $1,
          amount = $2,
          decided_at = NOW()
        WHERE request_token = $3
        `,
        [
          accepted
            ? 'accepted'
            : 'rejected',
          amount,
          req.query.token
        ]
      );
    }

    let subject;
    let html;

    if (accepted) {
      subject =
        'Je aanvraag bij Clean Ride is bevestigd 🚲';

      html = `
        <h2>
          Bedankt om voor Clean Ride te kiezen! 🚲
        </h2>

        <p>
          Hallo ${esc(data.name)},
        </p>

        <p>
          We hebben je aanvraag voor
          <b>${esc(data.service)}</b>
          ontvangen en aanvaard.
        </p>

        <p>
          We kijken ernaar uit om je fiets
          weer helemaal netjes te maken.
        </p>

        <p>
          <b>De betaling gebeurt achteraf</b>,
          nadat de reiniging is uitgevoerd
          en je tevreden bent met het resultaat.
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
        <h2>
          Bedankt voor je aanvraag bij Clean Ride
        </h2>

        <p>
          Hallo ${esc(data.name)},
        </p>

        <p>
          Helaas kunnen we je aanvraag momenteel
          niet aannemen omdat het op dit moment
          te druk is.
        </p>

        <p>
          We hopen je op een later moment wel
          te kunnen helpen.
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

      <body style="
        font-family:Arial;
        padding:40px;
        text-align:center;
      ">

        <h1>Clean Ride 🚲</h1>

        <h2>
          ${
            accepted
              ? 'Aanvraag geaccepteerd ✅'
              : 'Aanvraag geweigerd ✅'
          }
        </h2>

        <p>
          De klant heeft automatisch
          een e-mail ontvangen.
        </p>

        ${
          accepted
            ? `
              <p>
                <b>€${amount.toFixed(2)}</b>
                is toegevoegd aan de omzet.
              </p>
            `
            : ''
        }

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

/* =========================
   TEAM CLEAN RIDE LOGIN
========================= */

function requireTeamPassword(req, res, next) {
  const password =
    req.headers['x-team-password'];

  if (
    !TEAM_PASSWORD ||
    password !== TEAM_PASSWORD
  ) {
    return res.status(401).json({
      error: 'Niet ingelogd.'
    });
  }

  next();
}

/* =========================
   TEAM STATS
========================= */

app.get(
  '/api/team/stats',
  requireTeamPassword,
  async (req, res) => {
    try {
      if (!process.env.DATABASE_URL) {
        return res.status(500).json({
          error:
            'DATABASE_URL ontbreekt.'
        });
      }

      const totals =
        await pool.query(`
          SELECT
            COUNT(*) FILTER (
              WHERE status = 'accepted'
            ) AS accepted_count,

            COUNT(*) FILTER (
              WHERE status = 'rejected'
            ) AS rejected_count,

            COALESCE(
              SUM(amount) FILTER (
                WHERE status = 'accepted'
              ),
              0
            ) AS revenue

          FROM requests
        `);

      const costs =
        await pool.query(`
          SELECT
            COALESCE(SUM(amount), 0) AS costs
          FROM costs
        `);

      const customers =
        await pool.query(`
          SELECT
            name,
            email,

            COUNT(*) FILTER (
              WHERE status = 'accepted'
            ) AS cleanings,

            COALESCE(
              SUM(amount) FILTER (
                WHERE status = 'accepted'
              ),
              0
            ) AS revenue,

            MAX(decided_at) FILTER (
              WHERE status = 'accepted'
            ) AS last_visit

          FROM requests

          GROUP BY name, email

          HAVING COUNT(*) FILTER (
            WHERE status = 'accepted'
          ) > 0

          ORDER BY last_visit DESC
        `);

      const requests =
        await pool.query(`
          SELECT
            name,
            email,
            phone,
            service,
            amount,
            status,
            created_at,
            decided_at
          FROM requests
          ORDER BY created_at DESC
          LIMIT 100
        `);

      const costList =
        await pool.query(`
          SELECT
            id,
            supplier,
            description,
            amount,
            created_at
          FROM costs
          ORDER BY created_at DESC
          LIMIT 100
        `);

      const revenue =
        Number(totals.rows[0].revenue);

      const totalCosts =
        Number(costs.rows[0].costs);

      const profit =
        revenue - totalCosts;

      res.json({
        financial: {
          revenue,
          costs: totalCosts,
          profit,
          margin:
            revenue > 0
              ? (profit / revenue) * 100
              : 0
        },

        counts: {
          accepted:
            Number(
              totals.rows[0].accepted_count
            ),

          rejected:
            Number(
              totals.rows[0].rejected_count
            )
        },

        customers:
          customers.rows.map(customer => ({
            name: customer.name,
            email: customer.email,
            cleanings:
              Number(customer.cleanings),
            revenue:
              Number(customer.revenue),
            lastVisit:
              customer.last_visit
          })),

        requests:
          requests.rows.map(request => ({
            ...request,
            amount:
              Number(request.amount)
          })),

        costs:
          costList.rows.map(cost => ({
            ...cost,
            amount:
              Number(cost.amount)
          }))
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          'Teamgegevens konden niet worden geladen.'
      });
    }
  }
);

/* =========================
   KOST TOEVOEGEN
========================= */

app.post(
  '/api/team/cost',
  requireTeamPassword,
  async (req, res) => {
    try {
      const {
        supplier,
        description,
        amount
      } = req.body || {};

      const numericAmount =
        Number(amount);

      if (
        !supplier ||
        !description ||
        !Number.isFinite(numericAmount) ||
        numericAmount <= 0
      ) {
        return res.status(400).json({
          error:
            'Vul leverancier, beschrijving en een geldig bedrag in.'
        });
      }

      await pool.query(
        `
        INSERT INTO costs
        (
          supplier,
          description,
          amount
        )
        VALUES ($1,$2,$3)
        `,
        [
          supplier,
          description,
          numericAmount.toFixed(2)
        ]
      );

      res.json({
        ok: true
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          'Kost kon niet worden toegevoegd.'
      });
    }
  }
);

/* =========================
   SERVER START
========================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `Clean Ride draait op ${BASE_URL}`
      );
    });

  } catch (error) {
    console.error(
      'Database/server kon niet starten:',
      error
    );

    process.exit(1);
  }
}

startServer();
