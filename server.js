/*
 * Grounded Drops label printer — serves the label editor and renders real,
 * scannable QR codes for discount labels.
 *
 *   npm install
 *   npm start          → http://localhost:3000
 */
'use strict';

const express = require('express');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// GET /qr?data=<text> → PNG QR code (used by the label preview & print).
app.get('/qr', async (req, res) => {
  const data = String(req.query.data || '').slice(0, 2048);
  if (!data) return res.status(400).send('Missing ?data=');
  try {
    const png = await QRCode.toBuffer(data, {
      type: 'png',
      errorCorrectionLevel: 'M',
      width: 300,
      margin: 1,
    });
    res.type('png').send(png);
  } catch (err) {
    res.status(500).send('QR generation failed');
  }
});

app.get('/healthz', (req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log(`Label editor running on http://localhost:${PORT}`);
});
