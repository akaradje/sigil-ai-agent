'use strict';
// The trash line is a ratchet, not a colour.
//
// The bar is the gear the hero actually wears. When a better piece is worn the
// bar moves with it, so the gear that used to be worth keeping becomes surplus
// on its own and the bag never fills with the old tier. No rarity name is
// hard coded here: the game data decides which families carry magic damage
// and which recipes make the next tier.

const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const level = s => Number(String(s?.lv || '').match(/\d+/)?.[0] || 0);

// The base gear behind a bag, storage or worn entry.
function gearForName(catalog, text) {
  const value = norm(text);
  if (!value || !catalog?.gear) return null;
  return catalog.gear.filter(g => value.includes(norm(g.name)) || value.includes('/gear/' + g.id + '.png'))
    .sort((a, b) => b.name.length - a.name.length)[0] || null;
}

// A family carries magic damage when its gear has a matk stat. The data says
// which families those are.
function casterFamilies(catalog) {
  const families = new Set();
  for (const gear of catalog?.gear || []) if (gear.fam && (gear.stats || {}).matk) families.add(gear.fam);
  return families;
}

function classProfile(catalog, jobName) {
  const job = catalog?.jobs?.[String(jobName || '').toLowerCase()];
  if (!job) return null;
  return { job, caster: casterFamilies(catalog).has(job.weapon), weaponFamily: job.weapon, line: job.line || [] };
}

// The value the hero actually gains from a piece: the class damage stat for a
// caster, the physical one otherwise, plus the defence and the strength of the
// base. A weapon of another family is worth nothing to this hero.
function gearValue(catalog, gear, profile) {
  if (!gear || !profile) return 0;
  const stats = gear.stats || {};
  if (gear.slot === 'weapon') {
    if (gear.fam && gear.fam !== profile.weaponFamily) return 0;
    if (profile.caster && !(stats.matk > 0)) return 0;
    if (!profile.caster && !(stats.atk > 0)) return 0;
  }
  const primary = profile.caster ? (stats.matk || 0) : (stats.atk || 0);
  const defence = (stats.def || 0) + (stats.mdef || 0);
  const utility = profile.caster ? (stats.int || 0) : (stats.str || 0);
  const power = (gear.tier || 0) * 100 + (gear.lv || 0);
  return primary * 4 + defence + utility * 2 + power;
}

// The worn piece: the base from the catalog plus the refinement it carries.
function wornValue(catalog, wornItem, profile) {
  const gear = gearForName(catalog, wornItem?.text);
  if (!gear) return 0;
  const refine = Number(String(wornItem.text || '').match(/\[(\d+)\]/)?.[1] || 0);
  const bonus = gear.refinement?.[refine]?.bonus || {};
  const stats = { ...(gear.stats || {}) };
  for (const [key, value] of Object.entries(bonus)) stats[key] = (stats[key] || 0) + value;
  return gearValue(catalog, { ...gear, stats }, profile);
}

// A piece stays when it is a material for a recipe that makes something better
// than the hero wears. The catalog is the recipe knowledge. A recipe the hero
// already passed says nothing about the material.
function recipeRetained(catalog, gear, slotValue, profile, heroLevel) {
  if (!gear || !catalog?.gear) return false;
  for (const candidate of catalog.gear) {
    const mats = candidate.craft?.mats;
    if (!mats) continue;
    if (!Object.prototype.hasOwnProperty.call(mats, gear.id)) continue;
    if (candidate.slot !== gear.slot) continue;
    if (candidate.lv <= heroLevel) continue;
    if (gearValue(catalog, candidate, profile) > slotValue) return true;
  }
  return false;
}

// The ratchet: what is surplus right now, what is worth one slot, and what
// should be worn instead.
function ratchet(catalog, state, worn, profile) {
  const active = profile || classProfile(catalog, state?.job);
  const equipped = new Map();
  for (const item of worn || []) equipped.set(item.slot, wornValue(catalog, item, active));
  const trash = [], keep = [], upgrades = [];
  const gated = new Map();
  for (const item of state?.inventoryGear || []) {
    if (item.protected !== false || item.equipped) continue;
    if ((worn || []).some(w => w.uid === item.uid)) continue;
    const gear = gearForName(catalog, item.art || item.text);
    if (!gear) { keep.push({ uid: item.uid, reason: 'unknown gear' }); continue; }
    if (item.better) { keep.push({ uid: item.uid, reason: 'marked better', slot: gear.slot }); continue; }
    const value = gearValue(catalog, gear, active);
    const slotValue = equipped.get(gear.slot) ?? 0;
    if (value <= 0) {
      trash.push({ uid: item.uid, slot: gear.slot, value, reason: gear.slot === 'weapon' ? 'wrong weapon family' : 'no class value' });
      continue;
    }
    // An upgraded piece beats its base, and the base is what the score sees.
    if (gear.slot !== 'weapon' && /\+\d+/.test(item.text || '')) { keep.push({ uid: item.uid, reason: 'upgraded piece', slot: gear.slot }); continue; }
    if (gear.lv > level(state)) {
      const best = gated.get(gear.slot);
      if (!best || value > best.value) { if (best) trash.push({ uid: best.uid, slot: gear.slot, value: best.value, reason: 'redundant future gear' }); gated.set(gear.slot, { uid: item.uid, slot: gear.slot, value }); }
      else trash.push({ uid: item.uid, slot: gear.slot, value, reason: 'redundant future gear' });
      continue;
    }
    if (recipeRetained(catalog, gear, slotValue, active, level(state))) { keep.push({ uid: item.uid, reason: 'recipe material', slot: gear.slot }); continue; }
    if (value <= slotValue) { trash.push({ uid: item.uid, slot: gear.slot, value, reason: 'not better than worn' }); continue; }
    upgrades.push({ uid: item.uid, slot: gear.slot, value, gear });
  }
  for (const [slot, entry] of gated) keep.push({ uid: entry.uid, slot, value: entry.value, reason: 'one future piece per slot' });
  return { trash, keep, upgrades, equipped: [...equipped.entries()].map(([slot, value]) => ({ slot, value })) };
}

module.exports = { gearForName, casterFamilies, classProfile, gearValue, wornValue, recipeRetained, ratchet };
