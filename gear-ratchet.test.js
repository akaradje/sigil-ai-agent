'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Ratchet = require('./gear-ratchet');

const catalog = {
  jobs: {
    starweaver: { name: 'Starweaver', weapon: 'staff', line: ['starweaver', 'mage', 'novice'] },
    warrior: { name: 'Warrior', weapon: 'blade', line: ['warrior', 'novice'] },
  },
  gear: [
    { id: 'staff5', name: 'Void Scepter', slot: 'weapon', fam: 'staff', tier: 5, lv: 55, stats: { atk: 11, matk: 53, int: 3 }, refinement: Array.from({ length: 16 }, (_, r) => ({ bonus: { atk: r * 2, matk: r * 2 } })) },
    { id: 'blade5', name: 'Abyssal Edge', slot: 'weapon', fam: 'blade', tier: 5, lv: 55, stats: { atk: 53, str: 3 } },
    { id: 'oldblade', name: 'Rimecall Blade', slot: 'weapon', fam: 'blade', tier: 3, lv: 25, stats: { atk: 31, str: 1 } },
    { id: 'hood5', name: 'Abyssal Hood', slot: 'head', tier: 5, lv: 55, stats: { def: 18, mdef: 6, dex: 2, int: 1 } },
    { id: 'hood7', name: 'Void Hood', slot: 'head', tier: 7, lv: 70, stats: { def: 30, mdef: 9, dex: 3, int: 2 } },
    { id: 'hood8', name: 'Eclipse Hood', slot: 'head', tier: 8, lv: 75, stats: { def: 40, mdef: 12, dex: 4, int: 3 } },
    { id: 'plate5', name: 'Abyssal Plate', slot: 'armor', tier: 5, lv: 55, stats: { def: 56, hp: 360, vit: 3 } },
    { id: 'plate6', name: 'Void Plate', slot: 'armor', tier: 6, lv: 50, stats: { def: 70, hp: 420, vit: 3 } },
    { id: 'plate8', name: 'Eclipse Plate', slot: 'armor', tier: 8, lv: 80, stats: { def: 88, hp: 520, vit: 4 }, craft: { mats: { plate5: 1 } } },
  ],
};
const hero = { lv: 57, job: 'Starweaver' };
const wornCaster = [
  { uid: 'w1', slot: 'weapon', text: '+8 Void Scepter [2] 59 ATK' },
  { uid: 'w2', slot: 'head', text: '+5 Abyssal Hood [1] 40 DEF' },
  { uid: 'w3', slot: 'armor', text: '+5 Abyssal Plate [1] 63 DEF' },
];
const item = (uid, text, extra = {}) => ({ uid, text, protected: false, equipped: false, better: false, ...extra });

test('a weapon of another family is surplus for a caster however rare it is', () => {
  const state = { ...hero, inventoryComplete: true, inventoryGear: [item('x', 'Abyssal Edge', { rarity: 3 })] };
  const verdict = Ratchet.ratchet(catalog, state, wornCaster);
  assert.equal(verdict.trash.length, 1);
  assert.equal(verdict.trash[0].uid, 'x');
  assert.equal(verdict.trash[0].reason, 'wrong weapon family');
});

test('the same piece is trash for a caster and an upgrade for a warrior', () => {
  const blade = item('x', 'Abyssal Edge', { rarity: 3 });
  const warrior = Ratchet.ratchet(catalog, { ...hero, job: 'Warrior', inventoryComplete: true, inventoryGear: [blade] }, [{ uid: 'w', slot: 'weapon', text: 'Rimecall Blade' }]);
  assert.equal(warrior.trash.length, 0);
  assert.equal(warrior.upgrades.length, 1);
  const caster = Ratchet.ratchet(catalog, { ...hero, inventoryComplete: true, inventoryGear: [blade] }, wornCaster);
  assert.equal(caster.trash.length, 1);
  assert.equal(caster.trash[0].reason, 'wrong weapon family');
});

test('a piece that is not better than the worn one is surplus even when it is legendary', () => {
  const state = { ...hero, inventoryComplete: true, inventoryGear: [item('x', 'Abyssal Hood', { rarity: 3 })] };
  const verdict = Ratchet.ratchet(catalog, state, wornCaster);
  assert.equal(verdict.trash.length, 1);
  assert.equal(verdict.trash[0].reason, 'not better than worn');
});

test('the bar follows the worn gear: the same piece is worth keeping against a weaker one', () => {
  const weak = [{ uid: 'w2', slot: 'head', text: 'Rimecall Hood' }];
  const state = { ...hero, inventoryComplete: true, inventoryGear: [item('x', 'Abyssal Hood', { rarity: 3 })] };
  const verdict = Ratchet.ratchet(catalog, state, weak);
  assert.equal(verdict.trash.length, 0);
  assert.equal(verdict.upgrades.length, 1);
});

test('a better piece in the same slot is an upgrade, not surplus', () => {
  const state = { ...hero, inventoryComplete: true, inventoryGear: [item('x', 'Void Plate', { rarity: 2 })] };
  const verdict = Ratchet.ratchet(catalog, state, wornCaster);
  assert.equal(verdict.trash.length, 0);
  assert.equal(verdict.upgrades.length, 1);
  assert.equal(verdict.upgrades[0].slot, 'armor');
});

test('only one future piece per slot is kept', () => {
  const state = { ...hero, inventoryComplete: true, inventoryGear: [item('a', 'Void Hood', { rarity: 2 }), item('b', 'Eclipse Hood', { rarity: 2 })] };
  const verdict = Ratchet.ratchet(catalog, state, wornCaster);
  assert.equal(verdict.keep.length, 1);
  assert.equal(verdict.keep[0].uid, 'b');
  assert.equal(verdict.trash.length, 1);
  assert.equal(verdict.trash[0].uid, 'a');
  assert.equal(verdict.trash[0].reason, 'redundant future gear');
});

test('a material for a recipe above the worn tier is kept, the same material without that recipe is not', () => {
  const withRecipe = { ...catalog, gear: catalog.gear.map(g => g.id === 'plate5' ? { ...g, craft: { mats: { plate5: 1 } } } : g) };
  const state = { ...hero, inventoryComplete: true, inventoryGear: [item('x', 'Abyssal Plate', { rarity: 2 })] };
  const kept = Ratchet.ratchet(withRecipe, state, wornCaster);
  assert.equal(kept.trash.length, 0);
  assert.equal(kept.keep[0].reason, 'recipe material');
});

test('protected, equipped and unknown gear are never surplus', () => {
  const state = { ...hero, inventoryComplete: true, inventoryGear: [item('p', 'Abyssal Edge', { protected: true }), item('e', 'Abyssal Edge', { equipped: true }), item('u', 'Mystery Thing')] };
  const verdict = Ratchet.ratchet(catalog, state, wornCaster);
  assert.equal(verdict.trash.length, 0);
});

test('the class profile reads the caster families from the data, not from a name', () => {
  const profile = Ratchet.classProfile(catalog, 'Starweaver');
  assert.equal(profile.caster, true);
  assert.equal(profile.weaponFamily, 'staff');
  assert.equal(Ratchet.classProfile(catalog, 'Warrior').caster, false);
});
