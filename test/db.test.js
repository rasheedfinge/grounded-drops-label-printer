'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { test, describe, before } = require('node:test');
const assert = require('node:assert');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gd-test-')), 'test.db');
const store = require('../db');

describe('displayName', () => {
  test('first name + surname initial', () => {
    assert.equal(store.displayName('Jamie Oliver-Smith', 'x@y.com'), 'Jamie O.');
    assert.equal(store.displayName('Sam Lee', 'x@y.com'), 'Sam L.');
  });
  test('single name passes through', () => {
    assert.equal(store.displayName('Cher', 'x@y.com'), 'Cher');
  });
  test('falls back to masked email initial', () => {
    assert.equal(store.displayName('', 'noname@example.com'), 'N***');
  });
});

describe('enrollment and referrals', () => {
  let g;
  before(() => {
    g = store.createGiveaway({ title: 'Test Drop', prize: 'Beans', period: '2020-01' });
  });

  test('new entrant gets one signup ticket and a referral code', () => {
    const { participant, isNew } = store.enroll({ giveawayId: g.id, email: 'a@x.com', name: 'Ada Lovelace' });
    assert.equal(isNew, true);
    assert.match(participant.referral_code, /^[A-Z0-9]+$/);
    assert.equal(store.participantTicketCount(participant.id), 1);
  });

  test('re-entering is idempotent', () => {
    const first = store.enroll({ giveawayId: g.id, email: 'a@x.com' });
    assert.equal(first.isNew, false);
    assert.equal(store.participantTicketCount(first.participant.id), 1);
  });

  test('referrer earns a bonus ticket when a new friend joins', () => {
    const ada = store.getParticipantByEmail(g.id, 'a@x.com');
    store.enroll({ giveawayId: g.id, email: 'b@x.com', refCode: ada.referral_code });
    assert.equal(store.participantTicketCount(ada.id), 2);
  });

  test('an existing entrant re-entering with a ref code credits nothing', () => {
    const ada = store.getParticipantByEmail(g.id, 'a@x.com');
    store.enroll({ giveawayId: g.id, email: 'b@x.com', refCode: ada.referral_code });
    assert.equal(store.participantTicketCount(ada.id), 2);
  });
});

describe('purchases', () => {
  let g;
  before(() => {
    g = store.createGiveaway({ title: 'Purchase Drop', prize: 'Mug', period: '2020-02' });
  });

  test('an order grants the configured tickets', () => {
    const r = store.recordPurchase({ giveawayId: g.id, email: 'buyer@x.com', name: 'Bo Buyer', orderId: 'ord-1', tickets: 5 });
    assert.equal(r.duplicate, false);
    // 1 signup + 5 purchase
    assert.equal(store.participantTicketCount(r.participant.id), 6);
  });

  test('the same order id is never counted twice', () => {
    const r = store.recordPurchase({ giveawayId: g.id, email: 'buyer@x.com', name: 'Bo Buyer', orderId: 'ord-1', tickets: 5 });
    assert.equal(r.duplicate, true);
    assert.equal(store.participantTicketCount(r.participant.id), 6);
  });
});

describe('import', () => {
  test('imports valid rows once, skips invalid and duplicates', () => {
    const g = store.createGiveaway({ title: 'Import Drop', prize: '', period: '2020-03' });
    const rows = [
      { email: 'one@x.com', name: 'One' },
      { email: 'two@x.com' },
      { email: 'one@x.com', name: 'One Again' },
      { email: 'not-an-email' },
    ];
    const r = store.importEntrants(g.id, rows);
    assert.deepEqual(r, { added: 2, skipped: 2 });
  });
});

describe('draw', () => {
  test('drawing records winner, discount code, and both email drafts', () => {
    const g = store.createGiveaway({ title: 'Draw Drop', prize: 'Grinder', period: '2020-04' });
    store.enroll({ giveawayId: g.id, email: 'w@x.com', name: 'Wynn Winner' });
    const winner = store.drawWinner(g.id, { baseUrl: 'https://example.com' });
    assert.equal(winner.email, 'w@x.com');
    assert.match(winner.discount_code, /^GD/);
    assert.equal(store.getGiveaway(g.id).status, 'drawn');

    const types = store.listDrafts(g.id).map((d) => d.type).sort();
    assert.deepEqual(types, ['announcement', 'winner']);
    const ann = store.listDrafts(g.id).find((d) => d.type === 'announcement');
    assert.ok(ann.subject.includes('Wynn W.'), 'announcement uses the public display name');
    assert.ok(ann.body.includes('unsubscribe'), 'list email carries a compliance footer');
  });

  test('cannot draw twice or with no entries', () => {
    const g = store.createGiveaway({ title: 'Empty Drop', prize: '', period: '2020-05' });
    assert.throws(() => store.drawWinner(g.id), /No entries/);
    store.enroll({ giveawayId: g.id, email: 'z@x.com' });
    store.drawWinner(g.id);
    assert.throws(() => store.drawWinner(g.id), /already been drawn/);
  });

  test('publicWinners exposes only display names', () => {
    const w = store.publicWinners().find((x) => x.title === 'Draw Drop');
    assert.equal(w.winner, 'Wynn W.');
    assert.equal(w.prize, 'Grinder');
    assert.ok(!JSON.stringify(w).includes('w@x.com'));
  });
});

describe('monthly auto cycle', () => {
  test('draws expired months, opens the new month with an invite draft, then no-ops', () => {
    // Close out anything open from earlier tests so this test controls state.
    store.autoDrawTick({ autoCreate: false, now: new Date('2030-01-15') });

    const g = store.createGiveaway({ title: 'March Drop', prize: 'Kit', period: '2030-03' });
    store.enroll({ giveawayId: g.id, email: 'm@x.com', name: 'Mo Marchers' });

    const actions = store.autoDrawTick({ baseUrl: 'https://example.com', now: new Date('2030-04-02') });
    const kinds = actions.map((a) => a.action);
    assert.ok(kinds.includes('drew_winner'));
    assert.ok(kinds.includes('created_giveaway'));

    const current = store.getCurrentOpenGiveaway();
    assert.equal(current.period, '2030-04');
    assert.deepEqual(store.listDrafts(current.id).map((d) => d.type), ['invite']);

    const again = store.autoDrawTick({ baseUrl: '', now: new Date('2030-04-02') });
    assert.deepEqual(again, []);
  });

  test('closes an expired giveaway that had no entries', () => {
    const g = store.createGiveaway({ title: 'Ghost Drop', prize: '', period: '2030-05' });
    const actions = store.autoDrawTick({ autoCreate: false, now: new Date('2030-06-10') });
    assert.ok(actions.some((a) => a.action === 'closed_empty' && a.giveawayId === g.id));
    assert.equal(store.getGiveaway(g.id).status, 'closed');
  });
});
