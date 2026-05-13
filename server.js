/**
 * Klaviyo Webhook Handler — Student Discount Email Validation
 *
 * Receives Klaviyo profile events, validates emails against university DB,
 * and adds verified students to a filtered Klaviyo list.
 *
 * Klaviyo API v2023-08-15
 */

import dotenv from 'dotenv';
import express from 'express';
import { isValidEmail, allDomainsSet } from './email-validator.js';

dotenv.config();

const PORT = parseInt(process.env.WEBHOOK_PORT || '3081', 10);
const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
const KLAVIYO_API_BASE = process.env.KLAVIYO_API_BASE || 'https://a.klaviyo.com';
const TARGET_LIST_ID = process.env.KLAVIYO_LIST_ID;

const app = express();
app.use(express.json());

const seenEmails = new Set();

function log(level, msg, meta = {}) {
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}`, meta);
}

// --- Klaviyo API v2023-08-15 ---

async function klaviyoReq(method, path, body = null) {
  const res = await fetch(`${KLAVIYO_API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

/** Find profile by email, return { id, email }. */
async function findProfile(email) {
  // Search endpoint: POST /profiles/search
  const data = await klaviyoReq('POST', '/profiles/search', {
    data: { type: 'profile', attributes: { email } }
  });
  const profiles = data?.data;
  if (profiles && profiles.length > 0) {
    return { id: profiles[0].id, email: profiles[0].attributes?.email };
  }
  return null;
}

/** Create a new profile, return its ID. */
async function createProfile(email) {
  const data = await klaviyoReq('POST', '/profiles', {
    data: {
      type: 'profile',
      attributes: { email, kv: { student_verified: true } }
    }
  });
  return data?.data?.id || null;
}

/** Add a profile to a list. */
async function addToList(profileId, listId) {
  await klaviyoReq('POST', `/lists/${listId}/relationships/profiles`, {
    data: [{ type: 'profile', id: profileId }]
  });
}

/** Ensure the target list exists; create if not. */
async function ensureList() {
  if (TARGET_LIST_ID) return TARGET_LIST_ID;

  const resp = await klaviyoReq('GET', '/lists?fields=list');
  const lists = resp?.data || [];
  for (const item of lists) {
    if (item.attributes?.fullName === 'Verifizierte Studenten') {
      return item.id;
    }
  }

  const created = await klaviyoReq('POST', '/lists', {
    data: { type: 'list', attributes: { name: 'Verifizierte Studenten' } }
  });
  return created?.data?.id;
}

// --- Webhook handler ---

/**
 * Klaviyo webhook body shape:
 * {
 *   "type": "profile",
 *   "specification": { "version": "2023-08-15", "datatype": { "type": "profile" } },
 *   "data": {
 *     "id": "abc123",
 *     "type": "profile",
 *     "attributes": {
 *       "$id": "...",
 *       "email": "student@uni.de",
 *       ...
 *     }
 *   },
 *   "occurred_at": "..."
 * }
 */
app.post('/webhooks/klaviyo/profiles', async (req, res) => {
  try {
    const body = req.body;

    // Extract email — Klaviyo sends it in data.attributes.email
    const email = (body?.data?.attributes?.email || '').trim();

    if (!email) {
      return res.status(400).json({ error: 'No email in event' });
    }

    const emailLower = email.toLowerCase();

    // Dedup
    if (seenEmails.has(emailLower)) {
      return res.status(200).json({ status: 'skipped-duplicate', email });
    }

    // Validate against university DB
    const validation = isValidEmail(email);
    if (!validation.valid) {
      return res.status(200).json({ status: 'invalid-email', email, reason: validation.message });
    }

    seenEmails.add(emailLower);

    // Ensure list exists
    const listId = await ensureList();
    if (!listId) throw new Error('Could not get target list ID');

    // Get or create profile
    const apiProfileId = body?.data?.id;

    let profileId;
    if (apiProfileId) {
      profileId = apiProfileId;
    } else {
      const found = await findProfile(email);
      if (found) {
        profileId = found.id;
      } else {
        profileId = await createProfile(email);
      }
    }

    if (profileId) {
      await addToList(profileId, listId);
    }

    log('info', `✅ ${email} → verified (${validation.university})`, { listId });
    return res.status(200).json({
      status: 'ok',
      email,
      university: validation.university,
      listId,
      profileId
    });

  } catch (err) {
    log('error', `❌ ${err.message}`, { path: req.path });
    return res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_, res) => {
  res.json({ status: 'ok', emailsProcessed: seenEmails.size, uptime: process.uptime() });
});

app.listen(PORT, () => {
  log('info', `🚀 Webhook server on :${PORT}`);
  log('info', `📡 POST /webhooks/klaviyo/profiles`);
  log('info', `🏛️  University domains: ${allDomainsSet.size} loaded`);
  log('info', `⚠️  Klaviyo API Key: ${KLAVIYO_API_KEY ? 'SET' : 'MISSING'}`);
  log('info', `⚠️  Target List ID: ${TARGET_LIST_ID || 'auto-create'}`);
});
