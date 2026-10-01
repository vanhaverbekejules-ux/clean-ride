const express = require('express');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'Vanhaverbeke.jules@hotmail.com';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SECRET = process.env.ACTION_SECRET || 'CHANGE-ME';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

function token(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(t) {
  const [body, sig] = String(t).split('.');
  if (!body || !sig) throw new Error('Ongeldige link');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Ongeldige link');
  return JSON.parse(Buffer.from(body, 'base64url').toString());
}
function esc(s='') { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

app.post('/api/request', async (req,res)=>{
  try {
    const {name,email,phone,service,message=''} = req.body || {};
    if (!name || !email || !phone || !service) return res.status(400).json({error:'Vul alle verplichte velden in.'});
    const payload = {name,email,phone,service,message,createdAt:Date.now()};
    const t = token(payload);
    const accept = `${BASE_URL}/api/decision?action=accept&token=${encodeURIComponent(t)}`;
    const reject = `${BASE_URL}/api/decision?action=reject&token=${encodeURIComponent(t)}`;
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: OWNER_EMAIL,
      replyTo: email,
      subject: `Nieuwe Clean Ride aanvraag — ${name}`,
      html: `<h2>Nieuwe Clean Ride aanvraag</h2><p><b>Naam:</b> ${esc(name)}<br><b>E-mail:</b> ${esc(email)}<br><b>Telefoon:</b> ${esc(phone)}<br><b>Service:</b> ${esc(service)}<br><b>Opmerking:</b> ${esc(message)||'—'}</p><p><a href="${accept}" style="display:inline-block;padding:12px 18px;background:#7cff00;color:#000;text-decoration:none;font-weight:bold;border-radius:8px">ACCEPTEREN</a> &nbsp; <a href="${reject}" style="display:inline-block;padding:12px 18px;background:#ff3b7a;color:#fff;text-decoration:none;font-weight:bold;border-radius:8px">WEIGEREN</a></p>`
    });
    res.json({ok:true});
  } catch(e) { console.error(e); res.status(500).json({error:'Mail kon niet worden verstuurd.'}); }
});

app.get('/api/decision', async (req,res)=>{
  try {
    const data = verify(req.query.token);
    const accepted = req.query.action === 'accept';
    if (!accepted && req.query.action !== 'reject') return res.status(400).send('Ongeldige keuze.');
    const subject = accepted ? 'Je aanvraag bij Clean Ride is bevestigd 🚲' : 'Update over je aanvraag bij Clean Ride';
    const html = accepted
      ? `<h2>Bedankt om voor Clean Ride te kiezen! 🚲</h2><p>Hallo ${esc(data.name)},</p><p>We hebben je aanvraag voor <b>${esc(data.service)}</b> ontvangen en aanvaard.</p><p>We kijken ernaar uit om je fiets weer helemaal netjes te maken. De <b>betaling gebeurt achteraf</b>, nadat de reiniging is uitgevoerd en je tevreden bent met het resultaat.</p><p>Tot binnenkort!<br><b>Team Clean Ride</b></p>`
      : `<h2>Bedankt voor je aanvraag bij Clean Ride</h2><p>Hallo ${esc(data.name)},</p><p>Helaas kunnen we je aanvraag momenteel niet aannemen omdat het op dit moment te druk is.</p><p>We hopen je op een later moment wel te kunnen helpen. Bedankt voor je begrip!</p><p>Groeten,<br><b>Team Clean Ride</b></p>`;
    await transporter.sendMail({from:process.env.MAIL_FROM || process.env.SMTP_USER,to:data.email,subject,html});
    res.send(`<meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:Arial;padding:40px;text-align:center"><h1>Clean Ride</h1><h2>${accepted?'Aanvraag geaccepteerd ✅':'Aanvraag geweigerd ✅'}</h2><p>De klant heeft automatisch een e-mail ontvangen.</p></div>`);
  } catch(e) { console.error(e); res.status(400).send('Deze actie-link is ongeldig of verlopen.'); }
});

app.listen(PORT,()=>console.log(`Clean Ride draait op ${BASE_URL}`));
