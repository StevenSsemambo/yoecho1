/*! echo-music.js — YoEcho generative music (v1)
 *  brief -> composer (seeded, endless, rule-based) -> synth engine (Web Audio, no audio files).
 *  Public API: window.EchoMusic  (see the bottom of this file).
 *  Parts: 1 core+theory+recipes · 2 composer · 3 engine · 4 player+API.  ES5-style on purpose (old Android phones).
 */
(function (global) {
  "use strict";

  /* ═══════════════ 1. helpers ═══════════════ */
  function hashStr(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function makeRng(seed) {
    var a = (typeof seed === "string" ? hashStr(seed) : (seed >>> 0)) >>> 0;
    function r() { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    r.int = function (n) { return Math.floor(r() * n); };
    r.pick = function (arr) { return arr[Math.floor(r() * arr.length)]; };
    r.chance = function (p) { return r() < p; };
    r.range = function (lo, hi) { return lo + (hi - lo) * r(); };
    r.weighted = function (map) {
      var tot = 0, k; for (k in map) tot += Math.max(0, map[k]);
      if (tot <= 0) return Object.keys(map)[0];
      var x = r() * tot, last = null;
      for (k in map) { var w = Math.max(0, map[k]); if (w <= 0) continue; last = k; x -= w; if (x <= 0) return k; }
      return last;
    };
    return r;
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function randomSeed() { return (Math.random() * 4294967296) >>> 0; }
  function seedToStr(n) { return (n >>> 0).toString(36); }
  function strToSeed(s) { var n = parseInt(String(s), 36); return isNaN(n) ? hashStr(String(s)) : (n >>> 0); }
  var NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

  /* ═══════════════ 2. theory ═══════════════ */
  var MODES = {
    ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10]
  };
  var MODE_K = { ionian: 0, dorian: 1, phrygian: 2, lydian: 3, mixolydian: 4, aeolian: 5 };
  var MODE_LABEL = { ionian: "major", dorian: "dorian", phrygian: "phrygian", lydian: "lydian", mixolydian: "mixolydian", aeolian: "minor" };
  function isMinorMode(m) { return m === "aeolian" || m === "dorian" || m === "phrygian"; }
  /* semitones above the root for scale degree d (any integer, 0 = root, 7 = octave) */
  function degSemi(mode, d) { var o = Math.floor(d / 7), i = d - o * 7; return MODES[mode][i] + 12 * o; }
  /* the root that gives the SAME notes in another mode (so a key change is seamless) */
  function relativeRoot(root, fromMode, toMode) {
    var ion = ((root - MODES.ionian[MODE_K[fromMode]]) % 12 + 12) % 12;
    return (ion + MODES.ionian[MODE_K[toMode]]) % 12;
  }
  /* scale degrees that make up a chord built on degree d */
  function chordDegs(d, kind) {
    switch (kind) {
      case "power": return [d, d + 4, d + 7];
      case "7": return [d, d + 2, d + 4, d + 6];
      case "9": return [d, d + 2, d + 4, d + 6, d + 8];
      case "add9": return [d, d + 2, d + 4, d + 8];
      case "sus2": return [d, d + 1, d + 4];
      case "sus4": return [d, d + 3, d + 4];
      default: return [d, d + 2, d + 4];
    }
  }
  /* chord loops as scale-degree indexes (0 = I/i). Qualities fall out of the mode, so every chord is diatonic. */
  var PROGS = {
    ionian: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 3], [5, 3, 0, 4], [0, 2, 3, 4], [1, 4, 0, 5], [0, 4, 3, 0], [3, 0, 4, 5]],
    mixolydian: [[0, 6, 3, 0], [0, 3, 6, 0], [0, 6, 0, 3], [0, 6, 3, 6]],
    lydian: [[0, 1, 0, 1], [0, 1, 4, 0], [0, 4, 1, 0], [0, 1, 5, 4]],
    aeolian: [[0, 5, 2, 6], [0, 3, 6, 2], [0, 6, 5, 6], [0, 3, 4, 0], [0, 5, 3, 6], [5, 6, 0, 2]],
    dorian: [[0, 3, 6, 0], [0, 6, 3, 0], [0, 3, 0, 6], [0, 1, 3, 0]],
    phrygian: [[0, 1, 0, 6], [0, 1, 6, 0], [0, 5, 6, 1], [0, 6, 5, 1]]
  };
  /* chord qualities as semitones above the chord root, for genres that need real chords (dominant 7ths, m7b5, power chords...) */
  var QUAL = { maj: [0, 4, 7], min: [0, 3, 7], "7": [0, 4, 7, 10], "9": [0, 4, 7, 10, 14], "13": [0, 4, 10, 14, 21], "7#9": [0, 4, 7, 10, 15], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14], m11: [0, 3, 7, 10, 14, 17],
               maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], "6": [0, 4, 7, 9], m6: [0, 3, 7, 9], m7b5: [0, 3, 6, 10], dim: [0, 3, 6, 9], "5": [0, 7, 12], sus4: [0, 5, 7], add9: [0, 4, 7, 14], "69": [0, 4, 7, 9, 14] };
  var QUPG = { "7": ["9", "13", "7"], m7: ["m9", "m11", "m7"], maj7: ["maj9", "maj7"], "6": ["69", "6"] };
  /* the scale a soloist plays over each chord quality */
  var QSCALE = { maj: [0, 2, 4, 5, 7, 9, 11], maj7: [0, 2, 4, 5, 7, 9, 11], maj9: [0, 2, 4, 5, 7, 9, 11], "6": [0, 2, 4, 5, 7, 9, 11], "69": [0, 2, 4, 5, 7, 9, 11],
                 "7": [0, 2, 4, 5, 7, 9, 10], "9": [0, 2, 4, 5, 7, 9, 10], "13": [0, 2, 4, 5, 7, 9, 10], "7#9": [0, 2, 4, 5, 7, 9, 10],
                 min: [0, 2, 3, 5, 7, 9, 10], m7: [0, 2, 3, 5, 7, 9, 10], m9: [0, 2, 3, 5, 7, 9, 10], m11: [0, 2, 3, 5, 7, 9, 10], m6: [0, 2, 3, 5, 7, 9, 10],
                 m7b5: [0, 1, 3, 5, 6, 8, 10], dim: [0, 2, 3, 5, 6, 8, 9], "5": [0, 2, 4, 5, 7, 9, 10], sus4: [0, 2, 4, 5, 7, 9, 10], add9: [0, 2, 4, 5, 7, 9, 11] };
  function absChord(rs, q) { return { d: 0, rs: ((rs % 12) + 12) % 12, q: q, kind: q, abs: QUAL[q] || QUAL.maj, degs: null }; }
  /* absolute MIDI notes for a list of degrees, shifted by octaves so their mean sits near `center` */
  function placeNotes(mode, root, degs, center, semis) {
    var n = semis ? semis.map(function (x) { return root + x; }) : degs.map(function (d) { return root + degSemi(mode, d); }), sum = 0, i;
    for (i = 0; i < n.length; i++) sum += n[i];
    var shift = Math.round((center - sum / n.length) / 12) * 12;
    return n.map(function (x) { return x + shift; });
  }
  /* voice-leading: pick the inversion that moves least from the previous chord and stays near `center` */
  function voiceChord(mode, root, degs, center, prev, maxSpread, semis) {
    var base = placeNotes(mode, root, degs, center, semis).sort(function (a, b) { return a - b; });
    var best = null, bestCost = 1e9, inv, i, cand, cost, mean;
    for (inv = 0; inv < base.length; inv++) {
      cand = base.slice();
      for (i = 0; i < inv; i++) cand[i] += 12;
      cand.sort(function (a, b) { return a - b; });
      mean = 0; for (i = 0; i < cand.length; i++) mean += cand[i]; mean /= cand.length;
      cost = Math.abs(mean - center) * 0.6;
      if (cand[cand.length - 1] - cand[0] > (maxSpread || 16)) cost += 20;
      if (prev && prev.length) {
        var m = Math.min(prev.length, cand.length);
        for (i = 0; i < m; i++) cost += Math.abs(cand[i] - prev[i]);
        cost += Math.abs(cand.length - prev.length) * 1.5;
      }
      if (cost < bestCost) { bestCost = cost; best = cand; }
    }
    return best;
  }
  function placeInRange(pc, lo, hi) { var m = lo + (((pc - lo) % 12) + 12) % 12; while (m > hi) m -= 12; return m; }

  /* ═══════════════ 3. recipes: moods, styles, instruments ═══════════════ */
  var MOOD_LIST = ["neutral", "joy", "hope", "sadness", "fear", "anger", "love", "confusion"];
  var RECIPES = {
    neutral:   { modes: ["dorian", "ionian", "aeolian"], bpm: [84, 100], energy: .42, bright: .5, space: .5, density: .45, grit: 0, ext: { "7": .35, tri: .35, add9: .3 }, arc: "wave",
                 styles: { lofi: .3, acoustic: .2, afrobeats: .18, amapiano: .1, house: .1, ambient: .07, rnb: .05, jazz: .1, pop: .1, funk: .06, hiphop: .06, reggae: .05 } },
    joy:       { modes: ["ionian", "mixolydian", "lydian"], bpm: [104, 124], energy: .82, bright: .85, space: .35, density: .7, grit: 0, ext: { tri: .6, add9: .25, "7": .15 }, arc: "groove",
                 styles: { afrobeats: .34, amapiano: .24, house: .2, acoustic: .1, lofi: .07, rnb: .05, rocknroll: .14, country: .06, pop: .16, funk: .1, reggae: .08 } },
    hope:      { modes: ["ionian", "lydian", "dorian"], bpm: [84, 100], energy: .55, bright: .7, space: .6, density: .5, grit: 0, ext: { tri: .45, add9: .35, sus2: .1, "7": .1 }, arc: "story",
                 styles: { cinematic: .3, acoustic: .3, ambient: .08, afrobeats: .1, house: .08, rnb: .1, lofi: .04, pop: .18, rock: .08, reggae: .06 } },
    sadness:   { modes: ["aeolian", "dorian"], bpm: [58, 74], energy: .2, bright: .3, space: .85, density: .28, grit: 0, ext: { "7": .4, add9: .3, tri: .3 }, arc: "drift",
                 styles: { ambient: .3, lofi: .25, cinematic: .2, acoustic: .15, rnb: .1, blues: .15, jazz: .1 } },
    fear:      { modes: ["phrygian", "aeolian"], bpm: [66, 84], energy: .3, bright: .25, space: .8, density: .3, grit: 0, ext: { sus2: .3, tri: .3, "7": .2, sus4: .2 }, arc: "drift",
                 styles: { ambient: .5, cinematic: .35, acoustic: .15 } },
    anger:     { modes: ["phrygian", "aeolian"], bpm: [70, 76], energy: .9, bright: .4, space: .2, density: .8, grit: .6, ext: { power: .6, tri: .4 }, arc: "groove",
                 styles: { trap: .5, house: .2, cinematic: .2, afrobeats: .1, rock: .3, hiphop: .12 } },
    love:      { modes: ["ionian", "mixolydian", "dorian"], bpm: [68, 84], energy: .4, bright: .55, space: .65, density: .4, grit: 0, ext: { "7": .45, "9": .2, add9: .2, tri: .15 }, arc: "wave",
                 styles: { rnb: .4, acoustic: .25, lofi: .15, afrobeats: .1, cinematic: .1, jazz: .12, pop: .12, reggae: .08, blues: .06 } },
    confusion: { modes: ["dorian", "lydian"], bpm: [78, 92], energy: .35, bright: .5, space: .75, density: .4, grit: 0, ext: { sus2: .35, sus4: .25, "7": .2, "9": .2 }, arc: "drift",
                 styles: { ambient: .3, lofi: .3, acoustic: .2, cinematic: .2, jazz: .1 } },
    calm:      { modes: ["ionian", "lydian"], bpm: [56, 68], energy: .16, bright: .45, space: .9, density: .2, grit: 0, ext: { add9: .4, sus2: .3, tri: .3 }, arc: "drift",
                 styles: { ambient: .55, acoustic: .25, cinematic: .2 } }
  };
  var MOOD_WORDS = {
    neutral: [["Open", "Easy", "Plain", "Soft", "Slow"], ["Morning", "Window", "Road", "Table", "Hour"]],
    joy: [["Golden", "Bright", "Sun", "Wild", "Dancing"], ["Streets", "Light", "Parade", "Weekend", "Rhythm"]],
    hope: [["Rising", "First", "New", "Open", "Waking"], ["Light", "Horizon", "Morning", "Roads", "Season"]],
    sadness: [["Quiet", "Blue", "Hollow", "Slow", "Fading"], ["Rain", "Hours", "Letters", "Porch", "Tide"]],
    fear: [["Held", "Thin", "Still", "Low", "Dim"], ["Breath", "Hallway", "Ground", "Lanterns", "Dawn"]],
    anger: [["Iron", "Hard", "Burning", "Heavy", "Red"], ["Pulse", "Engine", "Weight", "Static", "Fire"]],
    love: [["Warm", "Close", "Honey", "Soft", "Slow"], ["Dance", "Evening", "Hands", "Glow", "Letters"]],
    confusion: [["Drifting", "Foggy", "Between", "Loose", "Wandering"], ["Maps", "Echoes", "Rooms", "Threads", "Tides"]],
    calm: [["Still", "Gentle", "Deep", "Soft", "Clear"], ["Water", "Breath", "Evening", "Garden", "Harbor"]]
  };
  /* mood journeys. "lift" starts where the person is and rises; "calm" settles; "match" stays put. */
  var LIFT = { sadness: ["sadness", "hope", "joy"], fear: ["fear", "calm", "hope"], anger: ["anger", "neutral", "hope"], confusion: ["confusion", "neutral", "hope"],
               neutral: ["neutral", "joy"], love: ["love", "joy"], hope: ["hope", "joy"], joy: ["joy"] };
  var CALMJ = { sadness: ["sadness", "calm"], fear: ["fear", "calm"], anger: ["anger", "neutral", "calm"], confusion: ["confusion", "calm"],
                neutral: ["neutral", "calm"], love: ["love", "calm"], hope: ["hope", "calm"], joy: ["joy", "neutral", "calm"] };

  /* instrument metadata: family (so lead and comp never share a timbre), brightness, loudness trim (calibrated by test) */
  var INSTR_META = {
    piano: { fam: "keys", b: .5 }, keys: { fam: "keys", b: .45 }, organ: { fam: "keys", b: .4 },
    guitar: { fam: "pluck", b: .5 }, pluck: { fam: "pluck", b: .5 },
    kalimba: { fam: "mallet", b: .7 }, marimba: { fam: "mallet", b: .55 }, bells: { fam: "mallet", b: .85 }, cowbell: { fam: "pluck", b: .8 }, mbira: { fam: "mallet", b: .7 }, whistle: { fam: "wind", b: .8 }, harmonica: { fam: "reed", b: .5 }, banjo: { fam: "pluck", b: .5 }, mandolin: { fam: "pluck", b: .55 }, steel: { fam: "reed", b: .5 }, fmpiano: { fam: "keys", b: .55 }, balafon: { fam: "mallet", b: .55 },
    strings: { fam: "sus", b: .5 }, pad: { fam: "sus", b: .4 }, choir: { fam: "sus", b: .35 },
    vox: { fam: "vocal", b: .45 }, hum: { fam: "vocal", b: .3 }, ooh: { fam: "sus", b: .3 }, synthchoir: { fam: "sus", b: .4 },
    flute: { fam: "wind", b: .6 }, brass: { fam: "wind", b: .55 }, synth: { fam: "synth", b: .65 },
    sax: { fam: "reed", b: .5 }, violin: { fam: "bowed", b: .6 },
    eguitar: { fam: "pluck", b: .55 }, dguitar: { fam: "dist", b: .4 }, lguitar: { fam: "lead", b: .55 }, hammond: { fam: "keys", b: .4 }, horns: { fam: "wind", b: .6 }, clav: { fam: "keys", b: .7 }, harp: { fam: "pluck", b: .6 }
  };
  /* instrument articulation: how much of the written length a note holds */
  var ARTIC = { vocal: .95, dist: .8, lead: .93, keys: .85, pluck: .5, mallet: .5, sus: .96, wind: .92, synth: .8, reed: .93, bowed: .97 };

  /* styles: the rhythmic skeleton + instrument palette. Patterns are 16 steps (one bar of 16th notes). */
  var STYLE_LIST = ["afrobeats", "afrobeat", "lingala", "amapiano", "lofi", "house", "trap", "phonk", "memphis", "rnb", "ambient", "cinematic", "celtic", "opera", "acoustic", "rocknroll", "rock", "blues", "country", "bluegrass", "irish", "jazz", "reggae", "funk", "pop", "hiphop"];
  var STYLES = {
    afrobeats: { name: "Afrobeats", level: 1.08, lay: .35, bpm: [96, 108], swing: .22, arc: "groove", harm: 1, drums: 2, kit: "afrob", feel: "synco",
      drum: { kick: "x..x..x...x...x.", snare: "", clap: "....x.......x...", hat: "x.xxx.x.x.xxx.x.", open: ".......x.......x", shaker: "xoxoxoxoxoxoxoxo", cLo: "..x...x...x..x..", cHi: "...x.x....x.x...", rim: "..x..x..x..x..x.", rimV: .3 },
      comp: ["x..x..x...x..x..", "..x..x..x..x..x.", "x..x..x..x..x..."], bass: ["r..r..5...r..a..", "r..r..r...5..o..", "r.....r.r..5..a."], bassMax: 3,
      pal: { pad: ["pad", "strings", "choir"], comp: ["eguitar", "keys", "fmpiano", "marimba", "guitar"], lead: ["eguitar", "mbira", "balafon", "keys", "sax", "marimba", "flute"], arp: ["mbira", "kalimba", "pluck", "bells"], bass: ["sub", "808", "ebass"] },
      arp: { rate: 2, kind: "updown", gate: .8 }, duck: .22, delay: .22, tex: { vinyl: 0, rain: 0, air: 0 } },
    afrobeat: { name: "Afrobeat (Fela)", level: 1.05, lay: .3, bpm: [104, 118], swing: .16, arc: "groove", harm: 2, drums: 2, kit: "afrob", feel: "synco",
      drum: { kick: "x..x..x...x.....", snare: "....x.......x...", clap: "", hat: "x.x.x.x.x.x.x.x.", open: "..x...x...x...x.", shaker: "xoxoxoxoxoxoxoxo", cLo: "..x..x..x..x..x.", cHi: "...x..x...x..x..", rim: "..x..x..x..x..x.", rimV: .3 },
      comp: ["x.x..x.x..x.x...", "..x.x..x.x..x.x.", "x..x.x..x..x.x.."], bass: ["r..r.r5.r..r.5a.", "r.r...5.r.r..5o.", "r..r..r.5..r.5.."], bassMax: 5,
      pal: { pad: ["organ", "strings"], comp: ["eguitar", "keys", "hammond"], lead: ["sax", "brass", "eguitar", "balafon", "keys"], arp: ["eguitar", "balafon", "keys"], bass: ["ebass", "upbass"] },
      arp: { rate: 2, kind: "updown", gate: .6 }, duck: .08, delay: .2, tex: { vinyl: .08, rain: 0, air: 0 } },
    /* Lingala (Congolese rumba and soukous): bright interlocking clean guitars (a high lead over a rolling arpeggio and offbeat chops), a melodic electric bass walking root-fifth, horns answering, congas and a driving kit with a busy snare; a slow rumba verse and chorus, then the sebene, the long instrumental dance section where the guitars take over; a piece is either a rumba (about 100-118) or a soukous (about 136-156) */
    lingala: { name: "Lingala (Congolese rumba / soukous)", level: 1.06, lay: .3, bpm: [100, 156], bpmKinds: [[98, 118], [136, 156]], swing: .1, arc: "sebene", harm: 1, drums: 2, kit: "afrob", feel: "synco", keyLift: true,
      drum: { kick: "x..x..x...x.....", snare: "....x.......x...", clap: "", hat: "x.x.x.x.x.x.x.x.", open: "", shaker: "xoxoxoxoxoxoxoxo", cLo: "..x.x...x.x...x.", cHi: "...x...x..x.x...", rim: "..x..x..x..x..x.", rimV: .25 },
      comp: ["..x...x...x...x.", "x..x..x...x..x..", "..x.x...x..x.x.."], compGen: ["pat"], bass: ["r..r..5...r.5...", "r...r.5.r...5.a.", "r.5...r.r.5...5."], bassMax: 4,
      pal: { pad: ["organ", "strings"], comp: ["eguitar", "guitar"], lead: ["eguitar", "guitar", "sax"], arp: ["guitar", "eguitar"], bass: ["ebass"] },
      bands: [ { pad: "organ", comp: "guitar", lead: "eguitar", arp: "eguitar", bass: "ebass", ans: "sax" }, { pad: null, comp: "guitar", lead: "eguitar", arp: "eguitar", bass: "ebass", ans: "horns" },
               { pad: "strings", comp: "eguitar", lead: "sax", arp: "guitar", bass: "ebass", ans: "eguitar" }, { pad: null, comp: "eguitar", lead: "guitar", arp: "eguitar", bass: "ebass", ans: "horns" } ],
      progs: [ { m: "ionian", seq: [[0,"maj"],[5,"maj"],[7,"7"],[0,"maj"]] }, { m: "ionian", seq: [[0,"maj"],[7,"7"],[0,"maj"],[7,"7"]] }, { m: "ionian", seq: [[0,"maj"],[5,"maj"],[0,"maj"],[7,"7"]] },
               { m: "ionian", seq: [[0,"maj"],[2,"7"],[5,"maj"],[7,"7"]] }, { m: "ionian", seq: [[0,"maj"],[9,"min"],[5,"maj"],[7,"7"]] }, { m: "aeolian", seq: [[0,"min"],[5,"min"],[7,"7"],[0,"min"]] } ],
      arp: { rate: 2, kind: "updown", gate: .55 }, duck: .08, delay: .2, tex: { vinyl: 0, rain: 0, air: 0 } },
    amapiano: { name: "Amapiano", level: 1.06, lay: .3, bpm: [110, 115], swing: .2, arc: "groove", harm: 2, drums: 2, kit: "ama", feel: "synco",
      drum: { kick: "x...x...x...x...", snare: "", clap: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", open: "..x...x...x...x.", shaker: "xoxoxoxoxoxoxoxo", cLo: "..x...x...x..x..", cHi: "...x..x.....x...", rim: "...x..x...x..x..", rimV: .3 },
      comp: ["x..x..x...x..x.x", "..x..x..x..x.x..", "x.....x..x.x...."], bass: ["r..r..r...r..5..", "r.....5.r..r.o..", "r..r.....r..a.5."], bassMax: 3,
      pal: { pad: ["pad", "strings"], comp: ["keys", "fmpiano", "piano"], lead: ["marimba", "mbira", "whistle", "keys", "bells", "flute", "piano"], arp: ["mbira", "bells", "marimba"], bass: ["log"] },
      arp: { rate: 2, kind: "alberti", gate: .7 }, duck: .3, delay: .15, tex: { vinyl: 0, rain: 0, air: 0 } },
    lofi: { name: "Lo-fi", level: 1.06, lay: .9, wobble: .0011, bpm: [70, 86], swing: .55, arc: "wave", harm: 1, drums: 2, kit: "lofi", feel: "sparse",
      drum: { kick: "x.....x...x.....", snare: "....x.......x...", clap: "", hat: "x.x.x.x.x.x.x.x.", open: ".......x.......x", shaker: "", cLo: "", cHi: "" },
      comp: ["x.....x...x.....", "x..x....x.......", "x.....x.....x..."], bass: ["r.......r.....5.", "r.....r...5.....", "r.......5.r....."], bassMax: 6,
      pal: { pad: ["pad", "strings"], comp: ["keys", "piano", "guitar"], lead: ["keys", "sax", "guitar", "kalimba", "flute"], arp: ["kalimba", "bells"], bass: ["sub", "pluck"] },
      arp: { rate: 2, kind: "up", gate: .45 }, duck: .12, delay: .3, tex: { vinyl: .35, rain: .08, air: 0 } },
    house: { name: "House", level: 0.85, lay: 0, bpm: [120, 126], swing: .04, arc: "groove", harm: 1, drums: 2, kit: "edm", feel: "straight",
      drum: { kick: "x...x...x...x...", snare: "", clap: "....x.......x...", hat: "xoxoxoxoxoxoxoxo", open: "..x...x...x...x.", shaker: "", cLo: "", cHi: "" },
      comp: ["..x...x...x...x.", "x..x..x...x..x..", "..x...x..x..x..."], bass: ["..r...r...r...r.", "..r...r...r..5r.", ".r..r..r.r..r.5."], bassMax: 2,
      pal: { pad: ["pad", "strings"], comp: ["organ", "piano", "keys", "fmpiano"], lead: ["synth", "bells", "pluck"], arp: ["pluck", "synth"], bass: ["synthbass", "sub"] },
      arp: { rate: 1, kind: "up", gate: .75 }, duck: .5, delay: .25, tex: { vinyl: 0, rain: 0, air: 0 } },
    trap: { name: "Trap", level: 1.25, lay: .15, bpm: [68, 76], swing: 0, arc: "groove", harm: 2, drums: 2, kit: "trap", feel: "sparse",
      drum: { kick: "x.....x..x.x....", snare: "........x.......", clap: "........x.......", hat: "x.x.x.x.x.x.x.x.", open: ".......x.......x", shaker: "", cLo: "", cHi: "" },
      comp: ["x.......x.......", "x.....x.........", "x.......x..x...."], bass: ["r.....r..r.r....", "r.......r.....5.", "r..r......r..a.."], bassMax: 8,
      pal: { pad: ["pad", "choir"], comp: ["keys", "bells", "piano"], lead: ["bells", "flute", "synth", "kalimba"], arp: ["bells", "pluck"], bass: ["808"] },
      arp: { rate: 2, kind: "rand", gate: .5 }, duck: .1, delay: .28, rolls: true, tex: { vinyl: 0, rain: 0, air: .1 } },
    phonk: { name: "Drift Phonk", level: 1.22, lay: .1, bpm: [134, 148], swing: 0, arc: "groove", harm: 2, drums: 2, kit: "phonk", feel: "sparse", grit: .55,
      drum: { kick: "x..x..x...x..x..", snare: "........x.......", clap: "........x.......", hat: "x.x.x.x.x.x.x.x.", open: ".......x.......x", shaker: "", cLo: "", cHi: "", cow: "" },
      comp: ["x.......x.......", "x.....x.........", "x.......x..x...."], bass: ["r..r..r...r.r...", "r.....r..r....5.", "r..r......r..a.."], bassMax: 8,
      pal: { pad: ["choir", "pad", "ooh"], comp: ["keys", "bells", "pad"], lead: ["cowbell", "vox", "bells", "synth"], arp: ["bells", "pluck"], bass: ["808"] },
      arp: { rate: 2, kind: "rand", gate: .45 }, duck: .14, delay: .3, rolls: true, tex: { vinyl: .12, rain: 0, air: .12 } },
    memphis: { name: "Memphis Phonk", level: 1.18, lay: .45, wobble: .0007, bpm: [68, 80], swing: .12, arc: "groove", harm: 2, drums: 2, kit: "phonk", feel: "sparse", grit: .45,
      drum: { kick: "x.....x..x.x....", snare: "........x.......", clap: "........x.......", hat: "x.x.x.x.x.x.x.x.", open: ".......x.......x", shaker: "", cLo: "", cHi: "", cow: "" },
      comp: ["x.......x.......", "x.....x.........", "x.......x..x...."], bass: ["r.....r..r.r....", "r.......r.....5.", "r..r......r..a.."], bassMax: 8,
      pal: { pad: ["choir", "ooh", "pad"], comp: ["keys", "pad", "bells"], lead: ["cowbell", "hum", "vox", "bells"], arp: ["bells", "pluck"], bass: ["808"] },
      arp: { rate: 2, kind: "rand", gate: .4 }, duck: .1, delay: .34, rolls: true, tex: { vinyl: .4, rain: 0, air: .06 } },
    rnb: { name: "R&B", level: 1.24, lay: .8, wobble: .0004, bpm: [68, 84], swing: .35, arc: "wave", harm: 2, drums: 2, kit: "lofi", feel: "smooth",
      drum: { kick: "x.....x...x.....", snare: "........x.......", clap: "........x.......", hat: "x.x.x.x.x.x.x.x.", open: "", shaker: "", cLo: "", cHi: "" },
      comp: ["x.....x.x.......", "x..x....x..x....", "x.......x.x....."], bass: ["r.....r.......5.", "r.......r..5....", "r..r....r......."], bassMax: 6,
      pal: { pad: ["strings", "pad"], comp: ["keys", "fmpiano", "guitar", "piano"], lead: ["guitar", "sax", "keys", "violin", "flute", "strings"], arp: ["bells", "kalimba"], bass: ["sub", "808"] },
      arp: { rate: 2, kind: "up", gate: .4 }, duck: .1, delay: .25, tex: { vinyl: .12, rain: 0, air: 0 } },
    ambient: { name: "Ambient", level: 1.15, lay: .2, bpm: [58, 72], swing: 0, arc: "drift", harm: 2, drums: 0, kit: "heavy", feel: "sparse",
      drum: { kick: "", snare: "", clap: "", hat: "", open: "", shaker: "", cLo: "", cHi: "" },
      comp: ["x...............", "x.......x......."], bass: ["r..............."], bassMax: 16,
      pal: { pad: ["pad", "choir", "strings"], comp: ["piano", "bells", "kalimba"], lead: ["flute", "violin", "bells", "piano"], arp: ["bells", "kalimba", "harp"], bass: ["sub"] },
      arp: { rate: 4, kind: "rand", gate: .45 }, duck: 0, delay: .35, tex: { vinyl: 0, rain: .22, air: .3 } },
    cinematic: { name: "Cinematic", level: 1.16, lay: .2, bpm: [70, 90], swing: 0, arc: "story", harm: 2, drums: 1, kit: "heavy", feel: "sparse",
      drum: { kick: "x...............", snare: "", clap: "", hat: "", open: "", shaker: "", cLo: "", cHi: "", tom: "........x......." },
      comp: ["x...............", "x.......x......."], bass: ["r...............", "r.......r......."], bassMax: 16,
      pal: { pad: ["strings", "choir", "pad"], comp: ["piano", "strings"], lead: ["violin", "strings", "flute", "brass", "piano"], arp: ["piano", "bells", "pluck", "harp"], bass: ["sub", "808"] },
      arp: { rate: 2, kind: "updown", gate: .6 }, duck: 0, delay: .2, tex: { vinyl: 0, rain: 0, air: .3 } },
    /* Celtic / new age in the manner of Enya: slow, modal harmony (i-VI-III-VII, I-vi-IV), a rolling piano or harp arpeggio, warm synth pads, a flute or whistle line, many layered voices
     * singing "aah", a deep drone underneath, almost no drums (a soft timpani on the big beats) and a very large, soft reverb. */
    celtic: { name: "Celtic (Enya-style)", waltz: .4, leadCap: 68, keyLift: true, level: 1.12, lay: .12, wet: 1, rubato: true, bpm: [62, 112], swing: 0, arc: "ethereal", harm: 2, drums: 1, kit: "heavy", feel: "sparse",
      drum: { kick: "", snare: "", clap: "", hat: "", open: "", shaker: "", cLo: "", cHi: "", tom: "x.......x......." },
      comp: ["x...............", "x.......x......."], bass: ["r..............."], bassMax: 16,
      progs: [ { m: "aeolian", seq: [[0,"min"],[8,"maj"],[3,"maj"],[10,"maj"]] }, { m: "aeolian", seq: [[0,"min"],[8,"maj"],[10,"maj"],[3,"maj"]] }, { m: "aeolian", seq: [[0,"min"],[10,"maj"],[8,"maj"],[7,"min"]] },
               { m: "ionian", seq: [[0,"maj"],[9,"min"],[5,"maj"],[5,"maj"]], b: [[9,"min"],[5,"maj"],[7,"maj"],[0,"maj"]] }, { m: "ionian", seq: [[5,"maj"],[9,"min"],[7,"maj"],[2,"min"]], b: [[5,"maj"],[9,"min"],[7,"maj"],[0,"maj"]] }, { m: "ionian", seq: [[0,"maj"],[9,"min"],[5,"maj"],[7,"sus4"]] }, { m: "ionian", seq: [[5,"maj"],[9,"min"],[7,"maj"],[2,"min"]] }, { m: "ionian", seq: [[0,"add9"],[9,"min"],[5,"maj"],[0,"add9"]] },
               { m: "dorian", seq: [[0,"min"],[5,"maj"],[10,"maj"],[0,"min"]] }, { m: "dorian", seq: [[0,"m7"],[10,"maj"],[5,"maj"],[7,"min"]] },
               { m: "lydian", seq: [[0,"maj"],[2,"maj"],[9,"min"],[7,"maj"]] }, { m: "lydian", seq: [[0,"maj7"],[2,"maj"],[11,"min"],[0,"maj7"]] },
               { m: "mixolydian", seq: [[0,"maj"],[10,"maj"],[5,"maj"],[0,"maj"]] }, { m: "mixolydian", seq: [[0,"maj"],[10,"maj"],[5,"maj"],[5,"maj"]] }, { m: "ionian", seq: [[0,"maj"],[4,"min"],[7,"maj"],[0,"maj"]] }, { m: "ionian", seq: [[0,"maj"],[5,"maj"],[7,"maj"],[0,"maj"]] }, { m: "mixolydian", seq: [[0,"maj"],[7,"min"],[10,"maj"],[5,"maj"]] },
               { m: "phrygian", seq: [[0,"min"],[1,"maj"],[8,"maj"],[10,"min"]] } ],
      pal: { pad: ["choir", "pad", "strings"], comp: ["piano", "harp", "strings"], lead: ["flute", "vox", "whistle", "violin", "ooh", "pluck"], arp: ["harp", "piano", "bells", "kalimba", "pluck"], bass: ["sub"] },
      bands: [ { pad: "choir", comp: "piano", lead: "flute", arp: "harp", bass: "sub", ans: "ooh" }, { pad: "pad", comp: "strings", lead: "vox", arp: "piano", bass: "sub", ans: "flute" },
               { pad: "strings", comp: "harp", lead: "whistle", arp: "bells", bass: "sub", ans: "ooh" }, { pad: "choir", comp: "piano", lead: "violin", arp: "harp", bass: "sub", ans: "flute" }, { pad: "strings", comp: "piano", lead: "pluck", arp: "harp", bass: "sub", ans: "ooh" }, { pad: "choir", comp: "strings", lead: "pluck", arp: "pluck", bass: "sub", ans: "ooh" },
               { pad: "strings", comp: "piano", lead: "flute", arp: "pluck", bass: "sub", ans: "ooh" }, { pad: "choir", comp: "harp", lead: "whistle", arp: "piano", bass: "sub", ans: "violin" } ],
      arp: { rate: 2, kind: "updown", gate: .75 }, duck: 0, delay: .3, tex: { vinyl: 0, rain: 0, air: .25 } },
    /* Opera / classical choral: an aria or chorus with orchestra. Slow to moderate, often three in a bar, a soprano-like voice or violin singing the tune over strings, harp and organ,
     * a choir swelling on the big moments, an upright bass, soft timpani, a grand reverb, and a lift of key for the finale. */
    opera: { name: "Opera (Classical choral)", level: 1.14, lay: .15, wet: .9, rubato: true, waltz: .4, keyLift: true, bpm: [52, 96], swing: 0, arc: "aria", harm: 1, drums: 1, kit: "heavy", feel: "sparse",
      drum: { kick: "", snare: "", clap: "", hat: "", open: "", shaker: "", cLo: "", cHi: "", tom: "x.......x......." },
      comp: ["x.......x.......", "x...x...x......."], bass: ["r.......r......."], bassMax: 16,
      progs: [ { m: "aeolian", seq: [[0,"min"],[5,"min"],[7,"maj"],[0,"min"]], b: [[8,"maj"],[3,"maj"],[5,"min"],[7,"maj"]] }, { m: "aeolian", seq: [[0,"min"],[1,"maj"],[7,"maj"],[0,"min"]] },
               { m: "aeolian", seq: [[0,"min"],[2,"m7b5"],[7,"7"],[0,"min"]], b: [[0,"min"],[5,"min"],[7,"7"],[0,"min"]] }, { m: "aeolian", seq: [[0,"min"],[8,"maj"],[5,"min"],[7,"maj"]] },
               { m: "ionian", seq: [[0,"maj"],[5,"maj"],[7,"maj"],[0,"maj"]] }, { m: "ionian", seq: [[0,"maj"],[9,"min"],[2,"min"],[7,"7"]], b: [[5,"maj"],[7,"maj"],[9,"min"],[0,"maj"]] },
               { m: "ionian", seq: [[0,"maj"],[7,"maj"],[9,"min"],[4,"min"],[5,"maj"],[0,"maj"],[5,"maj"],[7,"maj"]] }, { m: "ionian", seq: [[0,"maj"],[5,"maj"],[0,"maj"],[11,"dim"],[0,"maj"]] } ],
      pal: { pad: ["strings", "choir"], comp: ["harp", "piano", "organ"], lead: ["vox", "flute", "violin"], arp: ["harp", "piano"], bass: ["upbass"] },
      bands: [ { pad: "strings", comp: "harp", lead: "vox", arp: "piano", bass: "upbass", ans: "violin" }, { pad: "choir", comp: "harp", lead: "violin", arp: "piano", bass: "upbass", ans: "flute" },
               { pad: "strings", comp: "organ", lead: "vox", arp: "harp", bass: "upbass", ans: "flute" }, { pad: "choir", comp: "piano", lead: "vox", arp: "harp", bass: "upbass", ans: "strings" },
               { pad: "strings", comp: "harp", lead: "flute", arp: "piano", bass: "upbass", ans: "horns" },
               { pad: "organ", comp: "harp", lead: "vox", arp: "piano", bass: "upbass", ans: "choir" }, { pad: "strings", comp: "piano", lead: "violin", arp: "harp", bass: "upbass", ans: "horns" }, { pad: "choir", comp: "organ", lead: "flute", arp: "harp", bass: "upbass", ans: "violin" } ],
      arp: { rate: 2, kind: "updown", gate: .85 }, duck: 0, delay: .12, tex: { vinyl: 0, rain: 0, air: .12 } },
    acoustic: { name: "Acoustic", level: 1.0, lay: .5, bpm: [80, 100], swing: .15, arc: "wave", harm: 1, drums: 1, kit: "lofi", feel: "medium", pick: true,
      drum: { kick: "x.......x.......", snare: "", clap: "", hat: "", open: "", shaker: "x.x.x.x.x.x.x.x.", cLo: "", cHi: "", rim: "....x.......x..." },
      comp: ["0.2.3.2.1.2.3.2.", "0.1.2.3.2.1.2.3.", "0..2.3..1.2.3.2."], bass: ["r.......5.......", "r.....r.5......."], bassMax: 6,
      pal: { pad: ["strings", "pad"], comp: ["guitar", "piano"], lead: ["flute", "violin", "guitar", "kalimba", "piano"], arp: ["guitar", "kalimba", "harp"], bass: ["pluck", "sub"] },
      arp: { rate: 2, kind: "alberti", gate: .6 }, duck: 0, delay: .2, tex: { vinyl: 0, rain: 0, air: .08 } },

    /* ── band genres: real chords, real grooves, instruments that belong together ── */
    rocknroll: { name: "Rock and Roll", firm: 1, level: 1.12, lay: .5, bpm: [138, 152], swing: 0, swing8: .55, arc: "song", harm: 1, drums: 2, kit: "rnr", feel: "shuffle", leadGen: "blues",
      drum: { kick: "x.......x.......", snare: "....x.......x...", clap: "", hat: "x.x.x.x.x.x.x.x.", open: "", shaker: "", cLo: "", cHi: "", tamb: "x...x...x...x..." },
      comp: ["x.x.x.x.x.x.x.x.", "x...x...x...x...", "x..x..x.x..x..x."], compGen: ["chuck", "chuck", "pat"], bass: ["r.......5.......", "r...r...5...r..."], bassGen: ["boogie", "boogie", "walk", "rootfifth"], bassMax: 4,
      pal: { pad: ["hammond"], comp: ["eguitar", "piano"], lead: ["lguitar", "harmonica", "sax", "piano"], arp: ["horns"], bass: ["upbass", "ebass"] },
      bands: [ { pad: "hammond", comp: "eguitar", lead: "lguitar", arp: null, bass: "upbass", ans: "sax" }, { pad: null, comp: "piano", lead: "sax", arp: "horns", bass: "upbass", ans: "lguitar" },
               { pad: "hammond", comp: "eguitar", lead: "piano", arp: "horns", bass: "ebass", ans: "lguitar" }, { pad: null, comp: "piano", lead: "lguitar", arp: null, bass: "upbass", ans: "sax" } ],
      stab: ["x.......x.......", "x..x....x..x....", "x...x...x...x..."],
      progs: [ { m: "mixolydian", seq: [[0,"7"],[0,"7"],[0,"7"],[0,"7"],[5,"7"],[5,"7"],[0,"7"],[0,"7"],[7,"7"],[5,"7"],[0,"7"],[7,"7"]] },
               { m: "mixolydian", seq: [[0,"7"],[5,"7"],[0,"7"],[0,"7"],[5,"7"],[5,"7"],[0,"7"],[0,"7"],[7,"7"],[5,"7"],[0,"7"],[7,"7"]] },
               { m: "mixolydian", seq: [[0,"7"],[7,"7"],[5,"7"],[5,"7"],[0,"7"],[7,"7"],[0,"7"],[7,"7"]] },
               { m: "ionian", seq: [[0,"maj"],[9,"min"],[5,"maj"],[7,"7"]] }, { m: "ionian", seq: [[0,"6"],[5,"maj"],[0,"6"],[7,"7"]] } ],
      scales: { mixolydian: [0, 3, 4, 5, 7, 9, 10], ionian: [0, 2, 3, 4, 7, 9] }, duck: 0, delay: .12, tex: { vinyl: .12, rain: 0, air: 0 } },
    rock: { name: "Rock", firm: 1, level: 1.1, lay: .3, bpm: [112, 138], swing: 0, swing8: 0, arc: "song", harm: 1, drums: 2, kit: "rock", feel: "straight", leadGen: "",
      drum: { kick: "x.......x.x.....", snare: "....x.......x...", clap: "", hat: "x.x.x.x.x.x.x.x.", open: "..............x.", shaker: "", cLo: "", cHi: "" },
      comp: ["x...x...x...x...", "x.xxx.xxx.xxx.xx", "x.x.x.x.x.x.x.x."], compGen: ["power", "riff", "power", "riff"], bass: ["r.r.r.r.r.r.r.r.", "r...r...r...r..."], bassGen: ["root8", "root8", "rootfifth"], bassMax: 2,
      pal: { pad: ["hammond", "strings"], comp: ["dguitar"], lead: ["lguitar"], arp: ["eguitar"], bass: ["ebass"] },
      bands: [ { pad: null, comp: "dguitar", lead: "lguitar", arp: null, bass: "ebass", ans: null }, { pad: "hammond", comp: "dguitar", lead: "lguitar", arp: "eguitar", bass: "ebass", ans: "eguitar" },
               { pad: "strings", comp: "dguitar", lead: "lguitar", arp: null, bass: "ebass", ans: "hammond" }, { pad: null, comp: "eguitar", lead: "lguitar", arp: null, bass: "ebass", ans: "hammond" } ],
      progs: [ { m: "mixolydian", seq: [[0,"5"],[10,"5"],[5,"5"],[0,"5"]] }, { m: "aeolian", seq: [[0,"5"],[8,"5"],[10,"5"],[0,"5"]] }, { m: "aeolian", seq: [[0,"5"],[10,"5"],[8,"5"],[10,"5"]] },
               { m: "ionian", seq: [[0,"5"],[7,"5"],[9,"5"],[5,"5"]] }, { m: "ionian", seq: [[9,"5"],[5,"5"],[0,"5"],[7,"5"]] }, { m: "ionian", seq: [[0,"5"],[5,"5"],[7,"5"],[5,"5"]] },
               { m: "mixolydian", seq: [[0,"5"],[3,"5"],[5,"5"],[0,"5"]] }, { m: "aeolian", seq: [[0,"5"],[3,"5"],[10,"5"],[5,"5"]] } ],
      scales: { mixolydian: [0, 2, 4, 7, 9, 10], ionian: [0, 2, 4, 7, 9], aeolian: [0, 3, 5, 7, 10] }, duck: 0, delay: .15, tex: { vinyl: 0, rain: 0, air: 0 } },
    /* Country: boom-chick with a train-beat backbeat, a walking upright bass, strummed acoustic guitar, banjo and mandolin rolls, fiddle, harmonica and a crying pedal steel; plain major chords (I-IV-V, I-V-vi-IV), 3/4 waltz now and then */
    country: { name: "Country", firm: 1, level: 1.1, lay: .4, bpm: [78, 120], swing: 0, swing8: .3, arc: "song", harm: 1, drums: 2, kit: "rnr", feel: "medium", waltz: .18, leadGen: "",
      drum: { kick: "x.......x.......", snare: "....x.......x...", clap: "", hat: "x.x.x.x.x.x.x.x.", open: "", shaker: "", cLo: "", cHi: "", tamb: "x...x...x...x..." },
      comp: ["x.x.x.x.x.x.x.x.", "x...x...x...x...", "x..x..x.x..x..x."], compGen: ["pat", "chuck", "pat"], bass: ["r.......5.......", "r...r...5...r..."], bassGen: ["walk", "rootfifth", "walk"], bassMax: 4,
      pal: { pad: ["steel", "hammond", "strings"], comp: ["guitar", "banjo"], lead: ["eguitar", "violin", "steel", "harmonica", "mandolin", "banjo"], arp: ["banjo", "mandolin", "guitar"], bass: ["upbass", "ebass"] },
      bands: [ { pad: "steel", comp: "guitar", lead: "eguitar", arp: null, bass: "upbass", ans: "harmonica" }, { pad: "hammond", comp: "guitar", lead: "violin", arp: "banjo", bass: "upbass", ans: "steel" },
               { pad: "steel", comp: "guitar", lead: "mandolin", arp: "banjo", bass: "ebass", ans: "violin" }, { pad: "strings", comp: "piano", lead: "steel", arp: null, bass: "upbass", ans: "harmonica" },
               { pad: null, comp: "guitar", lead: "harmonica", arp: "mandolin", bass: "upbass", ans: "eguitar" } ],
      stab: ["x.......x.......", "x...x...x...x..."],
      progs: [ { m: "ionian", seq: [[0,"maj"],[5,"maj"],[0,"maj"],[7,"7"]] }, { m: "ionian", seq: [[0,"maj"],[7,"maj"],[9,"min"],[5,"maj"]] }, { m: "ionian", seq: [[0,"maj"],[5,"maj"],[7,"7"],[0,"maj"]] },
               { m: "ionian", seq: [[0,"maj"],[0,"maj"],[5,"maj"],[7,"7"]] }, { m: "ionian", seq: [[0,"maj"],[9,"min"],[5,"maj"],[7,"7"]] },
               { m: "mixolydian", seq: [[0,"maj"],[10,"maj"],[5,"maj"],[0,"maj"]] }, { m: "aeolian", seq: [[0,"min"],[8,"maj"],[3,"maj"],[10,"maj"]] } ],
      scales: { ionian: [0, 2, 4, 7, 9], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10] }, duck: 0, delay: .14, tex: { vinyl: 0, rain: 0, air: .04 } },
    /* Bluegrass: fast, no drums, banjo rolls, mandolin chop, fiddle, upright bass; the band is the rhythm section */
    bluegrass: { name: "Bluegrass", firm: 1, level: 1.1, lay: .6, bpm: [118, 168], swing: 0, swing8: 0, arc: "song", harm: 1, drums: 0, kit: "rnr", feel: "medium", leadGen: "",
      drum: { kick: "", snare: "", clap: "", hat: "", open: "", shaker: "", cLo: "", cHi: "" },
      comp: ["x.x.x.x.x.x.x.x.", "..x...x...x...x.", "x...x...x...x..."], compGen: ["chuck", "pat", "pat"], bass: ["r.......5.......", "r...5...r...5..."], bassGen: ["walk", "rootfifth"], bassMax: 4,
      pal: { pad: [], comp: ["guitar", "mandolin"], lead: ["banjo", "mandolin", "violin", "harmonica"], arp: ["banjo", "mandolin"], bass: ["upbass"] },
      bands: [ { pad: null, comp: "guitar", lead: "banjo", arp: "mandolin", bass: "upbass", ans: "violin" }, { pad: null, comp: "mandolin", lead: "violin", arp: "banjo", bass: "upbass", ans: "harmonica" },
               { pad: null, comp: "guitar", lead: "mandolin", arp: "banjo", bass: "upbass", ans: "violin" } ],
      arp: { rate: 2, kind: "alberti", gate: .5 },
      progs: [ { m: "ionian", seq: [[0,"maj"],[5,"maj"],[0,"maj"],[7,"7"]] }, { m: "ionian", seq: [[0,"maj"],[7,"maj"],[9,"min"],[5,"maj"]] }, { m: "ionian", seq: [[0,"maj"],[5,"maj"],[7,"7"],[0,"maj"]] },
               { m: "mixolydian", seq: [[0,"maj"],[10,"maj"],[5,"maj"],[0,"maj"]] }, { m: "aeolian", seq: [[0,"min"],[10,"maj"],[8,"maj"],[7,"maj"]] } ],
      scales: { ionian: [0, 2, 4, 7, 9], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10] }, duck: 0, delay: .1, tex: { vinyl: 0, rain: 0, air: .03 } },
    /* Irish folk: jigs (6/8, two beats of three), reels (fast 4/4 with running eighths) and now and then a slow waltz; whistle, flute and fiddle carry the tune with cuts and grace notes, guitar or mandolin and a light upright bass underneath, a bodhran (frame drum), modal chords (Dorian, Mixolydian) and a lift of key as a new tune begins */
    irish: { name: "Irish Folk", firm: 1, level: 1.1, lay: .55, bpm: [104, 124], swing: 0, swing8: .14, arc: "reel", harm: 1, drums: 1, kit: "heavy", feel: "reel", jig: .4, waltz: .12, keyLift: true, graces: true,
      drum: { kick: "", snare: "", clap: "", hat: "", open: "", shaker: "", cLo: "", cHi: "", tom: "x.....x.x.x...x." },
      comp: ["x.....x.....", "x.x.x.x.x.x.", "x.....x.x.x."], compGen: ["pat"], bass: ["r.....5.....", "r.....r.....", "r...5...r..."], bassGen: [], bassMax: 4,
      pal: { pad: ["organ", "strings"], comp: ["guitar", "mandolin", "piano"], lead: ["whistle", "flute", "violin", "banjo", "mandolin"], arp: ["banjo", "mandolin", "harp", "guitar"], bass: ["upbass"] },
      bands: [ { pad: null, comp: "guitar", lead: "whistle", arp: "banjo", bass: "upbass", ans: "violin" }, { pad: "organ", comp: "guitar", lead: "violin", arp: "mandolin", bass: "upbass", ans: "flute" },
               { pad: null, comp: "mandolin", lead: "flute", arp: "harp", bass: "upbass", ans: "whistle" }, { pad: "organ", comp: "piano", lead: "violin", arp: "banjo", bass: "upbass", ans: "whistle" },
               { pad: "strings", comp: "guitar", lead: "whistle", arp: "harp", bass: "upbass", ans: "violin" } ],
      progs: [ { m: "dorian", seq: [[0,"min"],[10,"maj"],[0,"min"],[10,"maj"]] }, { m: "dorian", seq: [[0,"min"],[10,"maj"],[8,"maj"],[10,"maj"]] }, { m: "dorian", seq: [[0,"min"],[5,"maj"],[10,"maj"],[0,"min"]] },
               { m: "mixolydian", seq: [[0,"maj"],[10,"maj"],[0,"maj"],[10,"maj"]] }, { m: "mixolydian", seq: [[0,"maj"],[10,"maj"],[5,"maj"],[0,"maj"]] },
               { m: "ionian", seq: [[0,"maj"],[5,"maj"],[0,"maj"],[7,"maj"]] }, { m: "ionian", seq: [[0,"maj"],[7,"maj"],[5,"maj"],[0,"maj"]] }, { m: "ionian", seq: [[9,"min"],[7,"maj"],[0,"maj"],[0,"maj"]] },
               { m: "aeolian", seq: [[0,"min"],[10,"maj"],[8,"maj"],[10,"maj"]] }, { m: "aeolian", seq: [[0,"min"],[3,"maj"],[10,"maj"],[0,"min"]] } ],
      scales: { ionian: [0, 2, 4, 5, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10] }, duck: 0, delay: .1, tex: { vinyl: 0, rain: 0, air: .04 } },
    blues: { name: "Blues", firm: 1, level: 1.15, lay: .8, bpm: [68, 94], swing: 0, swing8: .75, arc: "song", harm: 1, drums: 2, kit: "rnr", feel: "shuffle", leadGen: "blues",
      drum: { kick: "x.......x.......", snare: "....x.......x...", clap: "", hat: "x.x.x.x.x.x.x.x.", open: "", shaker: "", cLo: "", cHi: "" },
      comp: ["x.x.x.x.x.x.x.x.", "x.......x.......", "x..x....x..x...."], compGen: ["chuck", "pat", "pat"], bass: ["r.......5.......", "r.....r.5.....5."], bassGen: ["boogie", "boogie", "walk"], bassMax: 4,
      pal: { pad: ["hammond"], comp: ["eguitar", "piano"], lead: ["lguitar", "harmonica", "sax"], arp: [], bass: ["upbass", "ebass"] },
      bands: [ { pad: "hammond", comp: "eguitar", lead: "lguitar", arp: null, bass: "ebass", ans: null }, { pad: null, comp: "piano", lead: "lguitar", arp: null, bass: "upbass", ans: "sax" },
               { pad: "hammond", comp: "eguitar", lead: "sax", arp: null, bass: "upbass", ans: "lguitar" }, { pad: "hammond", comp: "piano", lead: "lguitar", arp: "horns", bass: "ebass", ans: null } ],
      stab: ["x.......x.......", "x..x............"],
      progs: [ { m: "mixolydian", seq: [[0,"7"],[0,"7"],[0,"7"],[0,"7"],[5,"7"],[5,"7"],[0,"7"],[0,"7"],[7,"7"],[5,"7"],[0,"7"],[7,"7"]] },
               { m: "mixolydian", seq: [[0,"9"],[5,"7"],[0,"9"],[0,"7"],[5,"7"],[5,"7"],[0,"9"],[9,"7"],[2,"m7"],[7,"7"],[0,"7"],[7,"7"]] },
               { m: "dorian", seq: [[0,"m7"],[0,"m7"],[0,"m7"],[0,"m7"],[5,"m7"],[5,"m7"],[0,"m7"],[0,"m7"],[8,"7"],[7,"7"],[0,"m7"],[7,"7"]] },
               { m: "mixolydian", seq: [[0,"7"],[7,"7"],[5,"7"],[5,"7"],[0,"7"],[7,"7"],[0,"7"],[7,"7"]] } ],
      scales: { mixolydian: [0, 3, 5, 6, 7, 10], dorian: [0, 3, 5, 6, 7, 10] }, duck: 0, delay: .18, tex: { vinyl: .1, rain: 0, air: 0 } },
    jazz: { name: "Jazz", firm: 1, level: 1.2, lay: .9, wobble: .0004, bpm: [100, 142], swing: 0, swing8: .8, arc: "jazz", harm: 1, drums: 2, kit: "jazz", feel: "swing", leadGen: "bebop", drumGen: "jazz", rootless: true,
      drum: { kick: "x...............", snare: "", clap: "", hat: "", open: "", shaker: "", cLo: "", cHi: "", ride: "x...x.x.x...x.x." },
      comp: ["x.....x.......x.", "..x...x...x...x.", "x..x....x.......", "....x.....x.x...", "x.......x.....x."], compGen: ["pat"], bass: ["r...5...r...5..."], bassGen: ["walk"], bassMax: 4,
      pal: { pad: [], comp: ["piano", "keys", "eguitar"], lead: ["sax", "brass", "marimba", "eguitar", "piano"], arp: [], bass: ["upbass"] },
      bands: [ { pad: null, comp: "piano", lead: "sax", arp: null, bass: "upbass", ans: "brass" }, { pad: null, comp: "piano", lead: "brass", arp: null, bass: "upbass", ans: "sax" },
               { pad: null, comp: "eguitar", lead: "sax", arp: null, bass: "upbass", ans: null }, { pad: null, comp: "piano", lead: "marimba", arp: null, bass: "upbass", ans: "sax" },
               { pad: "strings", comp: "keys", lead: "sax", arp: null, bass: "upbass", ans: null } ],
      progs: [ { m: "ionian", seq: [[2,"m7"],[7,"7"],[0,"maj7"],[0,"6"]] }, { m: "ionian", seq: [[0,"maj7"],[9,"m7"],[2,"m7"],[7,"7"]] }, { m: "ionian", seq: [[4,"m7"],[9,"7"],[2,"m7"],[7,"7"]] },
               { m: "ionian", seq: [[2,"m7"],[7,"7"],[0,"maj7"],[9,"7"]] }, { m: "aeolian", seq: [[2,"m7b5"],[7,"7"],[0,"m7"],[0,"m6"]] }, { m: "ionian", seq: [[0,"maj7"],[5,"maj7"],[4,"m7"],[9,"7"]] },
               { m: "ionian", seq: [[2,"m7"],[7,"7"],[0,"maj7"],[5,"maj7"],[11,"m7b5"],[4,"7"],[9,"m7"],[9,"m7"]] }, { m: "ionian", seq: [[0,"maj7"],[9,"m7"],[2,"m7"],[7,"7"],[4,"m7"],[9,"7"],[2,"m7"],[7,"7"]] } ],
      duck: 0, delay: .2, tex: { vinyl: .06, rain: 0, air: 0 } },
    reggae: { name: "Reggae", firm: 1, level: 1.1, lay: .7, bpm: [70, 84], swing: .18, swing8: 0, arc: "song", harm: 1, drums: 2, kit: "reggae", feel: "smooth", leadGen: "",
      drum: { kick: "........x.......", snare: "", clap: "", hat: "x.x.x.x.x.x.x.x.", open: "..............x.", shaker: "", cLo: "", cHi: "", rim: "........x.......", rimV: .75, tamb: "..x...x...x...x." },
      comp: ["..x...x...x...x."], compGen: ["skank"], chop: 1.2, bass: ["r.....r.5.r...o.", "r..r....5...r.5.", "r.......r..r5..."], bassGen: [], bassMax: 5,
      pal: { pad: ["hammond"], comp: ["eguitar", "clav"], lead: ["keys", "sax", "marimba", "flute"], arp: ["horns"], bass: ["ebass", "upbass"] },
      bands: [ { pad: "hammond", comp: "eguitar", lead: "keys", arp: "horns", bass: "ebass", ans: null }, { pad: "hammond", comp: "eguitar", lead: "sax", arp: null, bass: "ebass", ans: "flute" },
               { pad: null, comp: "clav", lead: "marimba", arp: "horns", bass: "ebass", ans: null }, { pad: "hammond", comp: "eguitar", lead: "flute", arp: null, bass: "upbass", ans: null } ],
      stab: ["..x...x...x...x.", "x...............", "......x......x.."],
      progs: [ { m: "ionian", seq: [[0,"maj"],[7,"maj"],[9,"min"],[5,"maj"]] }, { m: "ionian", seq: [[0,"maj"],[5,"maj"],[0,"maj"],[7,"maj"]] }, { m: "ionian", seq: [[0,"7"],[5,"7"],[0,"7"],[7,"7"]] },
               { m: "aeolian", seq: [[0,"min"],[10,"maj"],[8,"maj"],[10,"maj"]] }, { m: "aeolian", seq: [[0,"m7"],[5,"m7"],[7,"7"],[0,"m7"]] }, { m: "ionian", seq: [[9,"min"],[2,"min"],[7,"maj"],[0,"maj"]] } ],
      scales: { ionian: [0, 2, 4, 7, 9], aeolian: [0, 3, 5, 7, 10] }, duck: 0, delay: .3, tex: { vinyl: 0, rain: 0, air: 0 } },
    funk: { name: "Funk", firm: 1, level: 1.12, lay: .25, bpm: [96, 114], swing: .1, swing8: 0, arc: "song", harm: 2, drums: 2, kit: "funk", feel: "synco", leadGen: "",
      drum: { kick: "x..x...x..x.x...", snare: "....x.......x...", clap: "", hat: "xxxxxxxxxxxxxxxx", open: "......x.......x.", shaker: "", cLo: "", cHi: "", cow: "" },
      comp: ["xx.gx.g.xx.gx.x.", "x.gxgx..x.gxg.x.", "gx.xx.gxx.g.xgx."], compGen: ["pat"], chop: 1.1, bass: ["r..r..b.r.o.r.5.", "r.r...rb..r.o.r.", "r..rr.r.r..5r.b.", "r.....rr.b.r.5.o"], bassGen: [], bassMax: 2,
      pal: { pad: ["hammond"], comp: ["clav", "eguitar"], lead: ["sax", "lguitar", "keys", "horns"], arp: ["horns"], bass: ["ebass", "synthbass"] },
      bands: [ { pad: null, comp: "clav", lead: "sax", arp: "horns", bass: "ebass", ans: null }, { pad: "hammond", comp: "eguitar", lead: "lguitar", arp: "horns", bass: "ebass", ans: null },
               { pad: null, comp: "clav", lead: "keys", arp: "horns", bass: "synthbass", ans: "sax" }, { pad: "hammond", comp: "eguitar", lead: "horns", arp: null, bass: "ebass", ans: "sax" } ],
      stab: ["x.....x...x.....", "..x...x.x.....x.", "x..x......x.x..."],
      progs: [ { m: "mixolydian", seq: [[0,"9"],[0,"9"],[5,"9"],[0,"9"]] }, { m: "dorian", seq: [[0,"m7"],[0,"m7"],[5,"7"],[0,"m7"]] }, { m: "dorian", seq: [[0,"m9"],[5,"9"],[0,"m9"],[7,"7#9"]] },
               { m: "mixolydian", seq: [[0,"9"],[5,"9"],[0,"9"],[7,"9"]] } ],
      scales: { mixolydian: [0, 2, 4, 5, 7, 9, 10], dorian: [0, 2, 3, 5, 7, 9, 10] }, duck: 0, delay: .12, tex: { vinyl: 0, rain: 0, air: 0 } },
    pop: { name: "Pop", firm: 1, level: 1.08, lay: .2, bpm: [100, 124], swing: .05, swing8: 0, arc: "song", harm: 1, drums: 2, kit: "classic", feel: "straight", leadGen: "",
      drum: { kick: "x.......x.x.....", snare: "....x.......x...", clap: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", open: "..x...x...x...x.", shaker: "", cLo: "", cHi: "" },
      comp: ["x..x..x...x..x..", "x.x.x.x.x.x.x.x.", "x...x...x...x..."], compGen: ["pat"], bass: ["r.r.r.r.r.r.r.r.", "r..r..r...r..r..", "r.....r.r.....5."], bassGen: [], bassMax: 3,
      pal: { pad: ["pad", "strings"], comp: ["piano", "eguitar", "keys"], lead: ["synth", "piano", "eguitar", "flute", "bells"], arp: ["pluck", "bells"], bass: ["ebass", "synthbass"] },
      bands: [ { pad: "pad", comp: "piano", lead: "synth", arp: "pluck", bass: "synthbass", ans: "bells" }, { pad: "strings", comp: "eguitar", lead: "piano", arp: "bells", bass: "ebass", ans: "flute" },
               { pad: "pad", comp: "eguitar", lead: "flute", arp: "pluck", bass: "ebass", ans: "keys" }, { pad: "strings", comp: "piano", lead: "eguitar", arp: null, bass: "ebass", ans: "violin" } ],
      progs: [ { m: "ionian", seq: [[0,"add9"],[7,"maj"],[9,"min"],[5,"add9"]] }, { m: "ionian", seq: [[9,"min"],[5,"add9"],[0,"maj"],[7,"sus4"]] }, { m: "ionian", seq: [[0,"maj"],[9,"min"],[5,"maj"],[7,"maj"]] },
               { m: "aeolian", seq: [[0,"min"],[8,"maj"],[3,"maj"],[10,"maj"]] }, { m: "aeolian", seq: [[0,"min"],[10,"maj"],[8,"maj"],[7,"maj"]] }, { m: "ionian", seq: [[5,"maj"],[0,"maj"],[7,"maj"],[9,"min"]] } ],
      scales: { ionian: [0, 2, 4, 5, 7, 9, 11], aeolian: [0, 2, 3, 5, 7, 8, 10] }, duck: .25, delay: .2, tex: { vinyl: 0, rain: 0, air: 0 } },
    hiphop: { name: "Hip-hop", firm: 1, level: 1.2, lay: .9, bpm: [84, 96], swing: .52, swing8: 0, arc: "song", harm: 2, drums: 2, kit: "boombap", feel: "sparse", leadGen: "",
      drum: { kick: "x.....x..x......", snare: "....x.......x...", clap: "", hat: "x.x.x.x.x.x.x.x.", open: "..............x.", shaker: "", cLo: "", cHi: "" },
      comp: ["x.....x...x.....", "x..x....x.......", "x.....x.....x..."], compGen: ["pat"], bass: ["r.....r..r......", "r.......r.....5.", "r..r......r..5.."], bassGen: [], bassMax: 6,
      pal: { pad: ["pad", "strings"], comp: ["piano", "keys", "eguitar"], lead: ["keys", "bells", "sax", "flute"], arp: ["bells", "kalimba"], bass: ["sub", "808"] },
      bands: [ { pad: "pad", comp: "piano", lead: "bells", arp: null, bass: "808", ans: null }, { pad: "strings", comp: "keys", lead: "sax", arp: "kalimba", bass: "sub", ans: null },
               { pad: "pad", comp: "eguitar", lead: "keys", arp: "bells", bass: "808", ans: "flute" } ],
      progs: [ { m: "aeolian", seq: [[0,"m7"],[8,"maj7"],[10,"7"],[0,"m7"]] }, { m: "aeolian", seq: [[0,"m9"],[0,"m9"],[5,"m7"],[7,"7"]] }, { m: "dorian", seq: [[0,"m7"],[5,"7"],[0,"m7"],[10,"maj7"]] },
               { m: "aeolian", seq: [[0,"m7"],[3,"maj7"],[8,"maj7"],[7,"7"]] } ],
      scales: { aeolian: [0, 3, 5, 7, 10], dorian: [0, 3, 5, 7, 9, 10] }, duck: .1, delay: .22, tex: { vinyl: .25, rain: 0, air: 0 } },
    /* solo: one instrument performing; not in STYLE_LIST (only chosen through brief.solo) */
    solo: { name: "Solo", solo: true, level: 1.25, lay: .6, wobble: .0005, bpm: [58, 84], swing: .08, arc: "solo", harm: 2, drums: 0, kit: "lofi", feel: "medium", pick: true,
      drum: { kick: "", snare: "", clap: "", hat: "", open: "", shaker: "", cLo: "", cHi: "" },
      comp: ["0.2.3.2.1.2.3.2.", "0..2..3..1..2.3.", "0.1.2.3.2.1.2.3.", "0...2...3...2..."], bass: ["r.......5.......", "r.......r.....5.", "r...............", "r.....5.r......."], bassMax: 8,
      pal: { pad: ["pad"], comp: ["piano"], lead: ["piano"], arp: ["piano"], bass: ["piano"] },
      arp: { rate: 2, kind: "alberti", gate: .5 }, duck: 0, delay: .24, tex: { vinyl: 0, rain: 0, air: .06 } }
  };
  Object.keys(STYLES).forEach(function (k) { if (!STYLES[k].arp) STYLES[k].arp = { rate: 2, kind: "updown", gate: .6 }; });
  /* what each solo instrument needs: polyphonic ones play melody, chords and bass themselves; single-line ones play the melody over a faint bed */
  var SOLO_SETUP = {
    piano: { poly: true, f: { lead: "piano", comp: "piano", arp: "piano", bass: "piano" } },
    keys: { poly: true, f: { lead: "keys", comp: "keys", arp: "keys", bass: "keys" } },
    guitar: { poly: true, f: { lead: "guitar", comp: "guitar", arp: "guitar", bass: "guitar" } },
    kalimba: { poly: true, f: { lead: "kalimba", comp: "kalimba", arp: "kalimba", bass: "pluck" } },
    marimba: { poly: true, f: { lead: "marimba", comp: "marimba", arp: "marimba", bass: "marimba" } },
    bells: { poly: true, f: { lead: "bells", comp: "bells", arp: "bells", bass: "pluck" } },
    sax: { poly: false, f: { lead: "sax", pad: "pad" } }, violin: { poly: false, f: { lead: "violin", pad: "strings" } },
    flute: { poly: false, f: { lead: "flute", pad: "pad" } }, brass: { poly: false, f: { lead: "brass", pad: "strings" } }
  };
  var SOLO_ALIAS = { saxophone: "sax", keyboard: "keys", rhodes: "keys", acousticguitar: "guitar", guitarist: "guitar", pianist: "piano", violinist: "violin", fiddle: "violin", strings: "violin", cello: "violin", trumpet: "brass", horn: "brass", thumbpiano: "kalimba", mbira: "kalimba", xylophone: "marimba", vibraphone: "marimba", glockenspiel: "bells", chimes: "bells" };


  /* alternative grooves and basslines per genre: each section picks one, so a piece does not loop the same bar all the way through */
  var DRUM_ALT = {
    afrobeats: [{ kick: "x..x..x..x.x....", hat: "x.x.x.xxx.x.x.xx" }, { kick: "x.....x...x..x..", clap: "....x.......x.x.", hat: "xxxxxxxxxxxxxxxx", rim: "x..x..x.x..x.xx." }],
    amapiano: [{ kick: "x...x...x...x..x", hat: "x.xxx.xxx.xxx.xx" }, { kick: "x..x..x...x..x..", clap: "....x.......x...", open: "..x...x.x.x...x." }],
    lofi: [{ kick: "x.....x..x......", snare: "....x.......x..x" }, { kick: "x...x.....x.....", hat: "x.x.x.x.xxx.x.x." }],
    house: [{ hat: "x.xxx.xxx.xxx.xx", open: "..x...x...x...x." }, { clap: "....x.......x..x", hat: "xoxoxoxoxoxoxoxx" }],
    phonk: [{ kick: "x..x..x...x..x..", hat: "x.xxx.x.xxx.x.xx" }, { kick: "x.....x..x.x..x.", hat: "x.x.x.xxx.x.x.x." }],
    memphis: [{ kick: "x.....x...x..x..", hat: "x.x.xxx.x.x.x.x." }, { kick: "x..x..x.....x...", hat: "x.x.x.x.x.x.xxx." }],
    trap: [{ kick: "x.....x...x..x..", hat: "x.xxx.x.xxx.x.xx" }, { kick: "x..x..x.....x...", hat: "x.x.x.xxx.x.x.x." }],
    rnb: [{ kick: "x.....x..x.x....", hat: "x.x.xxx.x.x.xxx." }, { kick: "x...x...x..x....", clap: "........x......x" }],
    acoustic: [{ kick: "x.....x.x.......", rim: "....x.......x..x" }, { kick: "x.......x.x.....", shaker: "xxx.xxx.xxx.xxx." }],
    country: [{ kick: "x.......x.......", snare: "....x.......x..x", tamb: "x.x.x.x.x.x.x.x." }, { kick: "x...x...x...x...", snare: "..x...x...x...x." }, { kick: "x.......x..x....", hat: "x.x.x.x.x.x.xxx." }],
    lingala: [{ kick: "x..x..x...x.....", snare: "....x..x....x...", hat: "x.x.x.x.x.x.x.x." }, { kick: "x..x..x...x..x..", snare: "..x.x...x.x.x..." }, { kick: "x..x....x..x....", snare: "....x.......x.xx" }],
    rocknroll: [{ kick: "x.....x.x.......", tamb: "x.x.x.x.x.x.x.x." }, { kick: "x..x....x.x.....", snare: "....x.......x..x" }, { kick: "x.......x..x....", hat: "x.xxx.xxx.xxx.xx" }],
    rock: [{ kick: "x..x..x.x.......", hat: "x.x.x.x.x.x.x.x." }, { kick: "x.x.....x.x.....", hat: "xxxxxxxxxxxxxxxx" }, { kick: "x.......x..x.x..", open: "..x...x...x...x." }, { kick: "x...x...x...x...", snare: "....x.......x..x" }],
    blues: [{ kick: "x.....x.x.......", hat: "x.x.x.x.x.x.x.x." }, { kick: "x.......x..x....", snare: "....x.......x..x" }],
    reggae: [{ kick: "x...x...x...x...", snare: "", rim: "........x......." }, { kick: "........x.......", rim: "....x...x...x...", hat: "x.xxx.xxx.xxx.xx" }, { kick: "........x...x...", rim: "........x.......", open: "......x.......x." }],
    funk: [{ kick: "x..x..x...x..x..", snare: "....x.......x..x" }, { kick: "x.....x.x..x.x..", hat: "x.xxx.xxx.xxx.xx", cow: "x...x...x...x..." }, { kick: "x..x...x.x..x...", open: "..x...x.....x..." }],
    pop: [{ kick: "x...x...x...x...", hat: "x.x.x.x.x.x.x.x.", clap: "....x.......x..." }, { kick: "x..x....x.x.....", hat: "xxxxxxxxxxxxxxxx" }, { kick: "x.......x..xx...", shaker: "xxxxxxxxxxxxxxxx" }],
    hiphop: [{ kick: "x..x......x.....", snare: "....x.......x..x" }, { kick: "x.....x...x...x.", hat: "x.xxx.x.x.xxx.x." }, { kick: "x.x.....x.......", clap: "....x.......x..." }],
    cinematic: [{ tom: "......x.x......." }, { tom: "........x.x.x..." }]
  };
  var BASS_ALT = {
    reggae: ["r.......r..r5...", "r..5..r.....r.o."], funk: ["r.r..rb.r..5r.o.", "r..r.r..rb.r..5."], pop: ["r.r.r.r.5.5.5.5.", "r...r.5.r...r.5."], hiphop: ["r.....5..r.....", "r..r.....r.r..5."],
    afrobeats: ["r..r.r..5..r..a.", "r.r...5.r..5..o."], amapiano: ["r..r..5..r.r..a.", "r.....r.5..r.o.."], lofi: ["r.....5...r...a.", "r..r....5.....o."],
    house: ["..r..r.r..r..r5.", "r...r...r...r.5."], trap: ["r.....r.r.....5.", "r..r.r....r...5."], phonk: ["r..r..r...r.r.5.", "r.....r.r..r..a."], memphis: ["r.....r.r.....5.", "r..r.r....r...5."], rnb: ["r.....r.....5.a.", "r...r.....r.5..."], acoustic: ["r.....5.o.....5.", "r...5...r...5..."]
  };

  /* section templates per arc. n = phrases of 4 bars; e = energy factor; lead = how the melody behaves. */
  var ARCS = {
    groove: [
      { k: "intro", n: 1, e: .38, lead: "none", arp: .3, drums: 1, bass: false, cut: .55 },
      { k: "verse", n: 2, e: .66, lead: "sparse", arp: .5, drums: 2, bass: true, fill: true },
      { k: "chorus", n: 2, e: .92, lead: "theme", arp: .75, drums: 2, bass: true, fill: true, crash: true },
      { k: "verse", n: 2, e: .7, lead: "call", arp: .5, drums: 2, bass: true, fill: true },
      { k: "break", n: 1, e: .28, lead: "sparse", arp: .6, drums: 0, bass: false, cut: .35 },
      { k: "build", n: 1, e: .75, lead: "none", arp: .8, drums: 3, bass: false, riser: true },
      { k: "drop", n: 2, e: 1.0, lead: "varied", arp: 1, drums: 2, bass: true, fill: true, crash: true, lift: true },
      { k: "bridge", n: 1, e: .5, lead: "call", arp: .5, drums: 1, bass: true }
    ],
    aria: [
      { k: "intro", n: 1, e: .3, lead: "none", arp: .8, drums: 0, bass: false, cut: .55 },
      { k: "verse", n: 2, e: .5, lead: "theme", arp: .7, drums: 0, bass: true },
      { k: "chorus", n: 2, e: .8, lead: "theme", arp: .9, drums: 1, bass: true },
      { k: "bridge", n: 2, e: .42, lead: "call", arp: .6, drums: 0, bass: true },
      { k: "climax", n: 2, e: .97, lead: "varied", arp: 1, drums: 1, bass: true, lift: true, crash: true },
      { k: "outro", n: 1, e: .24, lead: "sparse", arp: .5, drums: 0, bass: false, cut: .5 }
    ],
    reel: [
      { k: "intro", n: 1, e: .35, lead: "none", arp: .7, drums: 0, bass: false, cut: .55 },
      { k: "verse", n: 2, e: .6, lead: "theme", arp: .6, drums: 1, bass: true },
      { k: "verse", n: 2, e: .66, lead: "varied", arp: .7, drums: 1, bass: true },
      { k: "chorus", n: 2, e: .8, lead: "theme", arp: .8, drums: 1, bass: true },
      { k: "chorus", n: 2, e: .86, lead: "varied", arp: .9, drums: 1, bass: true },
      { k: "solo", n: 2, e: .95, lead: "varied", arp: 1, drums: 1, bass: true, lift: true },
      { k: "outro", n: 1, e: .3, lead: "sparse", arp: .5, drums: 0, bass: false, cut: .5 }
    ],
    sebene: [
      { k: "intro", n: 1, e: .4, lead: "sparse", arp: .8, drums: 1, bass: false, cut: .6 },
      { k: "verse", n: 2, e: .6, lead: "theme", arp: .5, drums: 2, bass: true },
      { k: "chorus", n: 2, e: .8, lead: "theme", arp: .7, drums: 2, bass: true, fill: true },
      { k: "solo", n: 4, e: .95, lead: "varied", arp: 1, drums: 2, bass: true, fill: true },
      { k: "verse", n: 1, e: .65, lead: "call", arp: .6, drums: 2, bass: true },
      { k: "chorus", n: 1, e: .85, lead: "theme", arp: .8, drums: 2, bass: true },
      { k: "solo", n: 4, e: 1, lead: "varied", arp: 1, drums: 2, bass: true, fill: true, crash: true, lift: true },
      { k: "outro", n: 1, e: .4, lead: "sparse", arp: .6, drums: 1, bass: false, cut: .55 }
    ],
    aria2: [
      { k: "intro", n: 1, e: .26, lead: "none", arp: .7, drums: 0, bass: false, cut: .5 },
      { k: "verse", n: 2, e: .46, lead: "theme", arp: .6, drums: 0, bass: true },
      { k: "bridge", n: 2, e: .36, lead: "call", arp: .5, drums: 0, bass: false },
      { k: "verse", n: 1, e: .6, lead: "varied", arp: .8, drums: 0, bass: true },
      { k: "chorus", n: 2, e: .82, lead: "theme", arp: .9, drums: 1, bass: true },
      { k: "climax", n: 3, e: .98, lead: "varied", arp: 1, drums: 1, bass: true, lift: true, crash: true },
      { k: "outro", n: 1, e: .22, lead: "sparse", arp: .5, drums: 0, bass: false, cut: .5 }
    ],
    ethereal2: [
      { k: "intro", n: 2, e: .26, lead: "none", arp: .9, drums: 0, bass: false, cut: .45 },
      { k: "verse", n: 2, e: .42, lead: "sparse", arp: .8, drums: 0, bass: true },
      { k: "drift", n: 2, e: .36, lead: "call", arp: .7, drums: 0, bass: true },
      { k: "swell", n: 2, e: .8, lead: "theme", arp: .9, drums: 1, bass: true },
      { k: "drift", n: 1, e: .4, lead: "varied", arp: .7, drums: 0, bass: true },
      { k: "swell", n: 2, e: .95, lead: "varied", arp: 1, drums: 1, bass: true, lift: true },
      { k: "breath", n: 1, e: .22, lead: "sparse", arp: .5, drums: 0, bass: false, cut: .45 }
    ],
    ethereal: [
      { k: "intro", n: 1, e: .3, lead: "none", arp: .85, drums: 0, bass: false, cut: .5 },
      { k: "verse", n: 2, e: .5, lead: "theme", arp: .8, drums: 0, bass: true },
      { k: "swell", n: 2, e: .76, lead: "theme", arp: .9, drums: 1, bass: true },
      { k: "drift", n: 2, e: .42, lead: "call", arp: .7, drums: 0, bass: true },
      { k: "swell", n: 2, e: .92, lead: "varied", arp: 1, drums: 1, bass: true, lift: true },
      { k: "breath", n: 1, e: .24, lead: "sparse", arp: .6, drums: 0, bass: false, cut: .45 }
    ],
    drift: [
      { k: "intro", n: 1, e: .32, lead: "none", arp: .3, drums: 0, bass: false, cut: .5 },
      { k: "drift", n: 2, e: .55, lead: "sparse", arp: .5, drums: 1, bass: true },
      { k: "swell", n: 2, e: .8, lead: "theme", arp: .7, drums: 1, bass: true, crash: true },
      { k: "drift", n: 2, e: .48, lead: "call", arp: .5, drums: 1, bass: true },
      { k: "breath", n: 1, e: .22, lead: "none", arp: .4, drums: 0, bass: false, cut: .45 },
      { k: "drift", n: 2, e: .58, lead: "varied", arp: .6, drums: 1, bass: true },
      { k: "swell", n: 2, e: .85, lead: "theme", arp: .8, drums: 1, bass: true, lift: true }
    ],
    story: [
      { k: "intro", n: 1, e: .32, lead: "none", arp: .3, drums: 0, bass: false, cut: .5 },
      { k: "verse", n: 2, e: .52, lead: "sparse", arp: .5, drums: 1, bass: true },
      { k: "rise", n: 2, e: .72, lead: "theme", arp: .7, drums: 1, bass: true, fill: true },
      { k: "build", n: 1, e: .88, lead: "none", arp: .9, drums: 3, bass: true, riser: true },
      { k: "climax", n: 2, e: 1.0, lead: "theme", arp: 1, drums: 2, bass: true, fill: true, crash: true, lift: true },
      { k: "release", n: 2, e: .45, lead: "varied", arp: .5, drums: 1, bass: true },
      { k: "bridge", n: 1, e: .3, lead: "none", arp: .4, drums: 0, bass: false, cut: .5 }
    ],
    solo: [
      { k: "intro", n: 1, e: .3, lead: "sparse", arp: 0, drums: 0, bass: false, cut: .75 },
      { k: "verse", n: 2, e: .5, lead: "call", arp: .25, drums: 0, bass: true },
      { k: "rise", n: 2, e: .72, lead: "theme", arp: .5, drums: 0, bass: true },
      { k: "bridge", n: 1, e: .38, lead: "sparse", arp: .2, drums: 0, bass: false, cut: .7 },
      { k: "climax", n: 2, e: .95, lead: "varied", arp: .65, drums: 0, bass: true, lift: true },
      { k: "release", n: 2, e: .45, lead: "theme", arp: .3, drums: 0, bass: true }
    ],
    song: [
      { k: "intro", n: 1, e: .5, lead: "sparse", arp: .3, drums: 2, bass: true, cut: .7 },
      { k: "verse", n: 2, e: .62, lead: "call", arp: .4, drums: 2, bass: true, fill: true },
      { k: "chorus", n: 2, e: .9, lead: "theme", arp: .6, drums: 2, bass: true, fill: true, crash: true },
      { k: "verse", n: 2, e: .66, lead: "call", arp: .4, drums: 2, bass: true, fill: true },
      { k: "chorus", n: 2, e: .92, lead: "theme", arp: .6, drums: 2, bass: true, fill: true, crash: true },
      { k: "solo", n: 2, e: .98, lead: "varied", arp: .3, drums: 2, bass: true, fill: true, crash: true, lift: true },
      { k: "bridge", n: 1, e: .46, lead: "sparse", arp: .3, drums: 1, bass: true, cut: .8 },
      { k: "chorus", n: 2, e: 1.0, lead: "theme", arp: .7, drums: 2, bass: true, fill: true, crash: true, lift: true }
    ],
    jazz: [
      { k: "intro", n: 1, e: .4, lead: "none", arp: 0, drums: 1, bass: true, cut: .85 },
      { k: "head", n: 2, e: .6, lead: "theme", arp: 0, drums: 2, bass: true, fill: true },
      { k: "solo", n: 2, e: .78, lead: "varied", arp: 0, drums: 2, bass: true, fill: true },
      { k: "solo", n: 2, e: .92, lead: "varied", arp: 0, drums: 2, bass: true, fill: true, lift: true },
      { k: "trade", n: 1, e: .85, lead: "call", arp: 0, drums: 2, bass: true, fill: true },
      { k: "head", n: 2, e: .66, lead: "theme", arp: 0, drums: 2, bass: true, fill: true, crash: true }
    ],
    drums: [
      { k: "groove", n: 1, e: .5, lead: "none", arp: 0, drums: 2, bass: false, fill: true },
      { k: "verse", n: 2, e: .66, lead: "none", arp: 0, drums: 2, bass: false, fill: true },
      { k: "build", n: 1, e: .8, lead: "none", arp: 0, drums: 3, bass: false },
      { k: "chorus", n: 2, e: .95, lead: "none", arp: 0, drums: 2, bass: false, fill: true, crash: true },
      { k: "break", n: 1, e: .6, lead: "none", arp: 0, drums: 2, bass: false, fill: true },
      { k: "chorus", n: 2, e: 1.0, lead: "none", arp: 0, drums: 2, bass: false, fill: true, crash: true, lift: true }
    ],
    wave: [
      { k: "intro", n: 1, e: .4, lead: "none", arp: .3, drums: 1, bass: false, cut: .55 },
      { k: "verse", n: 2, e: .62, lead: "sparse", arp: .4, drums: 2, bass: true },
      { k: "verse", n: 2, e: .72, lead: "theme", arp: .5, drums: 2, bass: true, fill: true },
      { k: "bridge", n: 1, e: .45, lead: "call", arp: .5, drums: 1, bass: true },
      { k: "verse", n: 2, e: .68, lead: "varied", arp: .5, drums: 2, bass: true, fill: true },
      { k: "break", n: 1, e: .3, lead: "none", arp: .5, drums: 0, bass: false, cut: .4 }
    ]
  };
  /* one-bar melody rhythms (onset steps), by feel and busyness */
  var RHYTHMS = {
    sparse: [[0, 8], [0, 6, 10], [2, 8, 12], [0, 10], [4, 12], [0, 6, 12]],
    medium: [[0, 3, 6, 10, 12], [0, 2, 6, 8, 12], [0, 4, 6, 10, 14], [2, 6, 8, 11, 14], [0, 3, 8, 11]],
    busy: [[0, 2, 4, 7, 8, 10, 12, 15], [0, 3, 4, 6, 8, 11, 12, 14]],
    straight: [[0, 4, 8, 12], [0, 2, 6, 8, 10, 14], [0, 4, 6, 8, 12]],
    shuffle: [[0, 2, 4, 8, 10, 12], [0, 4, 6, 8, 12], [2, 4, 6, 8, 12, 14], [0, 2, 4, 6, 8, 12]],
    swing: [[0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 4, 8, 10, 12], [2, 4, 6, 10, 12, 14]],
    synco: [[0, 3, 6, 10, 13], [3, 6, 10, 12, 15], [0, 3, 7, 10], [0, 3, 6, 8, 11, 14]],
    smooth: [[0, 6, 10], [2, 8, 12], [0, 4, 10, 14], [0, 8, 12]],
    reel: [[0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 4, 8, 10, 12, 14], [0, 4, 6, 8, 12, 14], [0, 2, 4, 6, 8, 12, 14], [0, 2, 6, 8, 10, 12, 14]],
    jig: [[0, 2, 4, 6, 8, 10], [0, 2, 4, 6, 9], [0, 3, 6, 8, 10], [0, 2, 4, 6, 10], [0, 4, 6, 8, 10]]
  };

  /* ═══════════════ taste (what the person liked or skipped; kept in localStorage) ═══════════════ */
  var TASTE_KEY = "yoecho_music_taste";
  var VOX = { amt: 1, lvl: 1 }; try { var vx0 = JSON.parse(global.localStorage.getItem("echo_vox_v1") || "null"); if (vx0) { VOX.amt = clamp(Number(vx0.amt), 0, 2) || 0; VOX.lvl = clamp(Number(vx0.lvl) || 1, .3, 3); } } catch (e) {}
  var TUNE = { busy: 1 };   /* learned from your thumbs up/down: scales how busy the critic lets a part be */
  var taste = { styles: {}, moods: {}, seeds: [], fb: [] };
  function loadTaste() { try { var t = JSON.parse(global.localStorage.getItem(TASTE_KEY) || "null"); if (t && t.styles) taste = { styles: t.styles || {}, moods: t.moods || {}, seeds: t.seeds || [], fb: t.fb || [] }; } catch (e) {} }
  function saveTaste() { try { global.localStorage.setItem(TASTE_KEY, JSON.stringify(taste)); } catch (e) {} }
  loadTaste();
  function mean(a) { var s0 = 0; a.forEach(function (x) { s0 += x; }); return a.length ? s0 / a.length : 0; }
  /* thumbs up/down teach the critic: features of the pieces you liked or skipped move how busy it lets a part be */
  function retune() {
    var ups = taste.fb.filter(function (x) { return x.v > 0 && x.f && x.f.busy != null; }).map(function (x) { return x.f.busy; }), dns = taste.fb.filter(function (x) { return x.v < 0 && x.f && x.f.busy != null; }).map(function (x) { return x.f.busy; }), REF = 30, target = REF;
    if (ups.length >= 2) target = mean(ups); if (dns.length >= 2) target = target - (mean(dns) - target) * .35;
    TUNE.busy = clamp(target / REF, .7, 1.4);
  }
  retune();
  function featuresOf(raw) {
    try {
      var pl = parsePlan(raw); if (!pl) return {}; var sm = [], sb = [], sd = [], st = [], en = [];
      pl.sections.forEach(function (sx) {
        var mb = 0, bb = 0, dh = 0, any = 0; en.push(sx.energy);
        if (sx.mel && sx.mel.length) { var c = 0; sx.mel.forEach(function (b) { c += b.length; }); mb = c / sx.mel.length; sm.push(mb); any++; }
        if (sx.bl && sx.bl.length) { var c2 = 0; sx.bl.forEach(function (b) { c2 += b.length; }); bb = c2 / sx.bl.length; sb.push(bb); any++; }
        if (sx.gv && sx.gv.a) { for (var k in sx.gv.a) dh += sx.gv.a[k].replace(/\./g, "").length; sd.push(dh); any++; }
        if (any >= 2) st.push(mb + bb + dh);
      });
      var r = { style: pl.style || "", bpm: pl.bpm || 0, e: +mean(en).toFixed(2) }; if (sm.length) r.mel = +mean(sm).toFixed(1); if (sb.length) r.bass = +mean(sb).toFixed(1); if (sd.length) r.drum = +mean(sd).toFixed(1); if (st.length) r.busy = +mean(st).toFixed(1);
      return r;
    } catch (e) { return {}; }
  }
  function recordFb(v) {
    var pc = P.piece; if (!pc) return false; var s0 = seedStr(pc), raw = P.lastBrief && (P.lastBrief.planSrc || P.lastBrief.plan), inf = pc.comp.info(), f = raw && typeof raw === "object" ? featuresOf(raw) : {};
    if (!f.style) f.style = inf.style; if (!f.bpm) f.bpm = Math.round(inf.bpm || 0);
    taste.fb = taste.fb.filter(function (x) { return x.s !== s0; }); taste.fb.unshift({ s: s0, v: v, f: f, t: Date.now() }); taste.fb = taste.fb.slice(0, 60); retune(); return true;
  }
  function feedback(v) {
    var pc = P.piece; if (!pc) return false;
    if (v > 0) return like();
    var inf = pc.comp.info(); taste.styles[inf.style] = (taste.styles[inf.style] || 0) - 1; recordFb(-1); saveTaste(); emit("dislike", { info: info() }); return true;
  }
  function tuning() {
    var ups = taste.fb.filter(function (x) { return x.v > 0; }).length, dns = taste.fb.filter(function (x) { return x.v < 0; }).length, notes = [];
    if (TUNE.busy < .92) notes.push("prefers sparser, airier arrangements"); else if (TUNE.busy > 1.08) notes.push("prefers fuller, busier arrangements");
    var dn = taste.fb.filter(function (x) { return x.v < 0; }).slice(0, 3).map(function (x) { return (x.f.style || "?") + (x.f.bpm ? " ~" + x.f.bpm + " bpm" : "") + (x.f.busy ? ", busyness " + Math.round(x.f.busy) : ""); });
    return { up: ups, down: dns, busyScale: +TUNE.busy.toFixed(2), notes: notes, skipped: dn };
  }
  function tasteWeight(style) { var s = taste.styles[style] || 0; return clamp(1 + 0.3 * s, 0.3, 2.2); }


  /* ═══════════════ AI composition plans ═══════════════
   * The chat model can write a plan (key, chords per bar, sections, instruments, feel, motif). parsePlan validates and repairs it;
   * anything wrong is clamped or dropped, and a plan that does not hold together returns null so the normal composer plays instead. */
  var PLAN_KINDS = { intro: 1, verse: 1, chorus: 1, solo: 1, bridge: 1, "break": 1, build: 1, prechorus: 1, drop: 1, outro: 1, head: 1, trade: 1 };
  var PLAN_LEAD = { none: 1, sparse: 1, call: 1, theme: 1, varied: 1 };
  function chordQuality(rest) {
    var r = rest.toLowerCase().replace(/[\s()]/g, "").replace("♭", "b").replace("♯", "#").replace("min", "m").replace("-", "m").replace("ø", "m7b5").replace("°", "dim");
    var map = { "": "maj", maj: "maj", M: "maj", m: "min", "7": "7", m7: "m7", maj7: "maj7", ma7: "maj7", "9": "9", m9: "m9", maj9: "maj9", m11: "m11", "13": "13", "6": "6", m6: "m6", sus4: "sus4", sus: "sus4", sus2: "sus4", dim: "dim", dim7: "dim", m7b5: "m7b5", "5": "5", add9: "add9", "7#9": "7#9", "69": "69", "6/9": "69", "9sus4": "sus4", "7sus4": "sus4", aug: "maj", add: "add9" };
    if (map[r] !== undefined) return map[r];
    if (r.indexOf("maj") === 0) return r.indexOf("9") > 0 ? "maj9" : "maj7";
    if (r.charAt(0) === "m" && r.indexOf("b5") > 0) return "m7b5";
    if (r.charAt(0) === "m") return r.indexOf("9") > 0 ? "m9" : r.indexOf("7") > 0 ? "m7" : "min";
    if (r.indexOf("13") >= 0) return "13";
    if (r.indexOf("9") >= 0) return "9";
    if (r.indexOf("7") >= 0) return "7";
    return "maj";
  }
  function parseChordSym(sym, keyRoot) {
    var m = String(sym || "").trim().split("/")[0].match(/^([A-Ga-g])([#b♯♭]?)(.*)$/); if (!m) return null;
    var base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()], acc = m[2] === "#" || m[2] === "♯" ? 1 : (m[2] === "b" || m[2] === "♭") ? -1 : 0;
    var q = chordQuality(m[3] || ""); return absChord(((base + acc - keyRoot) % 12 + 12) % 12, q);
  }
  /* a written melody: [[bar, sixteenth, degree, length], ...] -> notes grouped by bar. Invalid notes are dropped; overlaps are trimmed. */
  function parseMel(mel, secBars) {
    if (!Array.isArray(mel)) return null;
    var notes = [], i;
    for (i = 0; i < mel.length && notes.length < 96; i++) {
      var n = mel[i]; if (!Array.isArray(n) || n.length < 3) continue;
      var b = Math.round(Number(n[0])), st = Math.round(Number(n[1])), dg = Math.round(Number(n[2])), ln = Math.round(Number(n[3] === undefined ? 2 : n[3]));
      if (!isFinite(b) || !isFinite(st) || !isFinite(dg) || !isFinite(ln)) continue;
      if (b < 0 || b >= Math.min(secBars, 16) || st < 0 || st > 15) continue;
      notes.push({ b: b, s: st, deg: clamp(dg, -4, 14), len: clamp(ln, 1, 16) });
    }
    if (notes.length < 3) return null;
    notes.sort(function (a, c) { return a.b - c.b || a.s - c.s; });
    for (i = 0; i < notes.length; i++) {      /* one voice: a note ends where the next begins */
      var nx = notes[i + 1], abs = notes[i].b * 16 + notes[i].s;
      if (nx) { var gap = nx.b * 16 + nx.s - abs; if (gap <= 0) { notes.splice(i, 1); i--; continue; } if (notes[i].len > gap) notes[i].len = gap; }
    }
    var nb = 0; notes.forEach(function (x) { if (x.b + 1 > nb) nb = x.b + 1; });
    nb = nb <= 1 ? 1 : nb <= 2 ? 2 : nb <= 4 ? 4 : nb <= 8 ? 8 : 16;
    var byBar = []; for (i = 0; i < nb; i++) byBar.push([]);
    notes.forEach(function (x) { if (x.b < nb) byBar[x.b].push({ s: x.s, deg: x.deg, len: x.len }); });
    return { bars: nb, byBar: byBar, n: notes.length };
  }
  /* a written bass line: [[bar, sixteenth, "R"|"3"|"5"|"b7"|"8"|"a"...,  length], ...]. Tones are relative to each bar's chord, so a 1-2 bar groove works over any progression. */
  var BASS_TONES = { R: 0, "1": 0, "2": 2, "b3": 3, "3": 3, "4": 5, "b5": 6, "5": 7, "6": 9, "b7": 10, "7": 11, "8": 12, "9": 14, a: "a", "a-": "a-", "a+": "a+" };
  function parseBassLine(bl, secBars) {
    if (!Array.isArray(bl)) return null;
    var notes = [], i;
    for (i = 0; i < bl.length && notes.length < 64; i++) {
      var n = bl[i]; if (!Array.isArray(n) || n.length < 3) continue;
      var b = Math.round(Number(n[0])), st = Math.round(Number(n[1])), tk = String(n[2]).trim().replace(/^r$/i, "R").replace(/^A/, "a"), ln = Math.round(Number(n[3] === undefined ? 2 : n[3]));
      if (!isFinite(b) || !isFinite(st) || !isFinite(ln) || BASS_TONES[tk] === undefined) continue;
      if (b < 0 || b >= Math.min(secBars, 8) || st < 0 || st > 15) continue;
      notes.push({ b: b, s: st, t: tk, len: clamp(ln, 1, 16) });
    }
    if (notes.length < 2) return null;
    notes.sort(function (a, c) { return a.b - c.b || a.s - c.s; });
    for (i = 0; i < notes.length; i++) {
      var nx = notes[i + 1], abs = notes[i].b * 16 + notes[i].s;
      if (nx) { var gap = nx.b * 16 + nx.s - abs; if (gap <= 0) { notes.splice(i, 1); i--; continue; } if (notes[i].len > gap) notes[i].len = gap; }
    }
    var nb = 0; notes.forEach(function (x) { if (x.b + 1 > nb) nb = x.b + 1; });
    nb = nb <= 1 ? 1 : nb <= 2 ? 2 : nb <= 4 ? 4 : 8;
    var byBar = []; for (i = 0; i < nb; i++) byBar.push([]);
    notes.forEach(function (x) { if (x.b < nb) byBar[x.b].push({ s: x.s, t: x.t, len: x.len }); });
    return { bars: nb, byBar: byBar, n: notes.length };
  }
  /* a written drum groove: {"kick":"x...x...x...x...","snare":"....x.......x...", ...} one 16-step string per voice. x = hit, X = accent, o = ghost, . = rest. */
  var GROOVE_KEYS = { kick: 1, snare: 1, clap: 1, hat: 1, open: 1, ride: 1, rim: 1, tamb: 1, shaker: 1, cow: 1, tom: 1, cLo: 1, cHi: 1 };
  function parseGroove(g) {
    if (!g || typeof g !== "object" || Array.isArray(g)) return null;
    var out = {}, hits = 0, k;
    for (k in g) {
      var kk = k === "conga" || k === "congaLow" ? "cLo" : k === "congaHigh" ? "cHi" : k === "hihat" || k === "hats" ? "hat" : k === "openhat" ? "open" : k === "tambourine" ? "tamb" : k;
      if (!GROOVE_KEYS[kk] || typeof g[k] !== "string") continue;
      var str = g[k].replace(/[^.xXo]/g, "."); if (str.length < 16) str = str + new Array(17 - str.length).join("."); str = str.slice(0, 16);
      out[kk] = str; hits += str.replace(/\./g, "").length;
    }
    if (!out.kick && !out.snare && !out.clap && !out.rim) return null;
    if (hits < 3 || hits > 90) return null;
    return out;
  }
  /* orchestration: a band per section ({pad,comp,lead,arp,bass,ans} -> instrument | "none"), a melody double, and a mix sheet for the whole piece */
  var BAND_ROLES = ["pad", "comp", "lead", "arp", "bass", "ans"];
  function parseBandObj(b) {
    if (!b || typeof b !== "object" || Array.isArray(b)) return null;
    var out = {}, any = false;
    BAND_ROLES.forEach(function (r) {
      if (!(r in b)) return; var v = b[r];
      if (v === null || v === false || v === "none") { out[r] = "none"; any = true; return; }
      var nm = normInstr(v); if (INSTR_META[nm] || (r === "bass" && (BASS_LOW[nm] || INSTR_META[nm]))) { out[r] = nm; any = true; }
    });
    return any ? out : null;
  }
  function parseDouble(d) {
    if (!d || typeof d !== "object") return null; var nm = normInstr(d.inst || d.i); if (!INSTR_META[nm]) return null;
    var o = Number(d.oct !== undefined ? d.oct : d.o); o = o >= 6 ? 12 : o <= -6 ? -12 : 0; return { i: nm, o: o };
  }
  var MIX_ROLES = { drums: 1, hats: 1, bass: 1, pad: 1, comp: 1, lead: 1, arp: 1 };
  function parseMixSheet(m) {
    if (!m || typeof m !== "object") return null; var out = {}, any = false;
    for (var r in m) {
      if (!MIX_ROLES[r] || !m[r] || typeof m[r] !== "object") continue; var x = m[r], o = {};
      if (isFinite(Number(x.lvl))) o.lvl = clamp(Number(x.lvl), .4, 1.7);
      if (isFinite(Number(x.rv))) o.rv = clamp(Number(x.rv), 0, 2.2);
      if (isFinite(Number(x.dy))) o.dy = clamp(Number(x.dy), 0, 2.2);
      if (isFinite(Number(x.tone))) o.tone = clamp(Number(x.tone), -6, 6);
      if (isFinite(Number(x.hp))) o.hp = clamp(Number(x.hp), .5, 3);
      if (isFinite(Number(x.pan)) && (r === "pad" || r === "comp" || r === "lead" || r === "arp")) o.pan = clamp(Number(x.pan), -.6, .6);
      if (Object.keys(o).length) { out[r] = o; any = true; }
    }
    return any ? out : null;
  }
  function parsePlan(p) {
    if (typeof p === "string") { var t = p.replace(/```(?:json)?/gi, ""), a = t.indexOf("{"), z = t.lastIndexOf("}"); try { p = JSON.parse(t.slice(a, z + 1)); } catch (e) { return null; } }
    if (!p || typeof p !== "object" || !Array.isArray(p.sections)) return null;
    var out = { sections: [] }, rawSecs = p.sections.slice(0, 12), i, j;
    var firstChord = null; for (i = 0; i < rawSecs.length && !firstChord; i++) { var cs0 = rawSecs[i] && rawSecs[i].chords; if (Array.isArray(cs0) && cs0.length) firstChord = String(cs0[0]).match(/^([A-Ga-g])([#b]?)/); }
    var key = parseKey(p.key); if (key === null && firstChord) key = parseKey(firstChord[1] + firstChord[2]); if (key === null) return null;
    out.key = key;
    var md = String(p.mode || "").toLowerCase(); if (md === "minor") md = "aeolian"; if (md === "major") md = "ionian";
    out.mode = MODES[md] ? md : "";
    for (i = 0; i < rawSecs.length; i++) {
      var rs = rawSecs[i]; if (!rs || !Array.isArray(rs.chords)) continue;
      var chords = []; for (j = 0; j < rs.chords.length && j < 16; j++) { var c = parseChordSym(rs.chords[j], key); if (c) chords.push(c); }
      if (chords.length < 2) continue;
      var kind = String(rs.kind || "verse").toLowerCase(); if (!PLAN_KINDS[kind]) kind = "verse";
      var lead = String(rs.lead || "theme").toLowerCase(); if (!PLAN_LEAD[lead]) lead = "theme";
      var bars = clamp(Math.round(Number(rs.bars) || chords.length), 4, 24), dr = Number(rs.drums); if (!isFinite(dr)) dr = 2;
      var pm = parseMel(rs.mel, bars), pbs = parseBassLine(rs.bassline, bars), pg = parseGroove(rs.groove), pg2 = pg ? parseGroove(rs.groove2) : null;
      out.sections.push({ src: i, mel: pm ? pm.byBar : null, melBars: pm ? pm.bars : 0, bl: pbs ? pbs.byBar : null, blBars: pbs ? pbs.bars : 0, gv: pg ? { a: pg, b: pg2 } : null, band: parseBandObj(rs.band), dbl: parseDouble(rs.double), kind: kind, chords: chords, bars: bars, energy: clamp(typeof rs.energy === "number" ? rs.energy : .6, .1, 1), lead: lead, drums: clamp(Math.round(dr), 0, 2),
        mod: rs.modulate === undefined ? -1 : clamp(Math.round(Number(rs.modulate) || 0), 0, 4), bass: rs.bass !== false, arp: rs.arp === true, comp: rs.comp !== false, fill: rs.fill !== false && kind !== "intro", crash: kind === "chorus" || kind === "drop" || kind === "solo" || rs.crash === true });
    }
    if (out.sections.length < 2) return null;
    var sig = function (x) { return x.kind + "|" + x.chords.map(function (c) { return c.rs + c.q; }).join(); }, seen = {};   /* a repeated section plays the same written melody */
    out.sections.forEach(function (x) { if (x.mel || x.bl || x.gv) { if (!seen[sig(x)]) seen[sig(x)] = x; } });
    out.sections.forEach(function (x) { var o = seen[sig(x)]; if (!o) return; if (!x.mel && o.mel && x.lead !== "none") { x.mel = o.mel; x.melBars = o.melBars; } if (!x.bl && o.bl && x.bass) { x.bl = o.bl; x.blBars = o.blBars; } if (!x.gv && o.gv && x.drums > 0) x.gv = o.gv; });
    /* song development: the last big section (chorus or drop) can lift the key for the finish. Explicit "modulate" (0-4 semitones) wins; otherwise pop-like styles take a whole step up when there are two or more big sections */
    (function () {
      var big = [], i2; out.sections.forEach(function (x, ix) { if (x.kind === "chorus" || x.kind === "drop") big.push(ix); });
      out.lastBig = big.length >= 2 ? big[big.length - 1] : -1;
      var stl = String(p.style || "").toLowerCase();
      out.sections.forEach(function (x, ix) { if (x.mod < 0) x.mod = (ix === out.lastBig && /^(pop|rnb|acoustic|afrobeats|rock|rocknroll|reggae)$/.test(stl) && x.energy >= .8) ? 2 : 0; });
      for (i2 = 0; i2 < out.sections.length; i2++) if (out.sections[i2].mod > 0 && i2 !== out.lastBig && out.lastBig >= 0) out.sections[i2].mod = 0;
    })();
    if (!out.mode) { var c0 = out.sections[0].chords[0].q; out.mode = (c0 === "min" || c0 === "m7" || c0 === "m9" || c0 === "m11" || c0 === "m6") ? "aeolian" : (c0 === "7" || c0 === "9" || c0 === "13") ? "mixolydian" : "ionian"; }
    var st = String(p.style || "").toLowerCase().replace(/[^a-z]/g, ""); st = ({ rockandroll: "rocknroll", hiphop2: "hiphop" })[st] || st; out.style = STYLES[st] && !STYLES[st].solo ? st : "";
    if (typeof p.bpm === "number" && isFinite(p.bpm)) out.bpm = clamp(Math.round(p.bpm), 50, 150);
    if (typeof p.title === "string") out.title = p.title.replace(/[^\w\s'&,.!?-]/g, "").trim().slice(0, 40);
    if (p.band && typeof p.band === "object") {
      out.band = {};
      ["pad", "comp", "lead", "arp", "bass", "ans"].forEach(function (r) {
        if (!(r in p.band)) return; var v = p.band[r];
        if (v === null || v === false || v === "none") { out.band[r] = "none"; return; }
        var nm = normInstr(v); if (INSTR_META[nm] || (r === "bass" && (BASS_LOW[nm] || INSTR_META[nm]))) out.band[r] = nm;
      });
    }
    out.mix = parseMixSheet(p.mix);
    var mo = p.motif;
    if (mo && Array.isArray(mo.on) && Array.isArray(mo.deg) && mo.on.length === mo.deg.length && mo.on.length >= 2 && mo.on.length <= 10) {
      var on = mo.on.map(function (x) { return clamp(Math.round(Number(x)), 0, 15); }), deg = mo.deg.map(function (x) { return clamp(Math.round(Number(x)), -3, 10); }), ok = true;
      for (i = 1; i < on.length; i++) if (!(on[i] > on[i - 1])) ok = false;
      if (ok && on.every(isFinite) && deg.every(isFinite)) out.motif = { on: on, deg: deg };
    }
    if (out.style) {
      var rej = [];
      if (out.band) { out.band = purgeBand(out.style, out.band, rej, "") || undefined; }
      out.sections.forEach(function (sx, ix) {
        if (sx.band) sx.band = purgeBand(out.style, sx.band, rej, "section " + ix + " ");
        if (sx.dbl && !fits(out.style, sx.dbl.i)) { rej.push("section " + ix + " double: " + sx.dbl.i); sx.dbl = null; }
      });
      if (rej.length) out.rejected = rej;
    }
    return out;
  }


  /* ═══════════════ the critic ═══════════════
   * Reads a plan the way a music teacher reads a lead sheet and returns a score plus short, specific notes the composer can act on.
   * It checks things that are measurable: range, leaps, chord-tone use on the beat, phrase endings, repetition, contrast between sections, form. */
  function critique(src) {
    var pl = parsePlan(src); if (!pl) return { ok: false, score: 0, issues: ["The plan could not be read."], stats: {} };
    var sc = MODES[pl.mode] || MODES.ionian, n = sc.length, issues = [], pen = 0, stats = { sections: pl.sections.length, melodies: 0 };
    function semi(d) { var o = Math.floor(d / n); return sc[d - o * n] + 12 * o; }
    var cur = "plan", parts = { cross: { pen: 0, issues: [] }, orch: { pen: 0, issues: [] }, plan: { pen: 0, issues: [] }, mel: { pen: 0, issues: [] }, bass: { pen: 0, issues: [] }, drums: { pen: 0, issues: [] } };
    function note(msg, w) { issues.push(msg); pen += w; parts[cur].pen += w; parts[cur].issues.push(msg); }
    var sections = pl.sections, avgPitch = {}, melRange = {}, melSeq = {}, i, j;
    var chorusCount = 0, hasContrast = false, uniq = {};
    sections.forEach(function (sx) { if (sx.kind === "chorus" || sx.kind === "drop") chorusCount++; if (/bridge|solo|break|build/.test(sx.kind)) hasContrast = true; sx.chords.forEach(function (c) { uniq[c.rs + c.q] = 1; }); });
    if (Object.keys(uniq).length < 4) note("The harmony is too small: use at least 4 different chords across the piece.", 12);
    if (chorusCount < 1) note("There is no chorus or drop: add a section that is the high point.", 10);
    if (!hasContrast) note("No bridge, solo or break: add one contrasting section so the piece goes somewhere.", 6);
    var en = sections.map(function (x) { return x.energy; }), emax = Math.max.apply(null, en), emin = Math.min.apply(null, en);
    if (emax - emin < .3) note("The energy is flat: make intros and bridges quieter (0.3-0.5) and choruses bigger (0.8-1).", 8);
    var firstChorus = null, firstVerse = null;
    sections.forEach(function (sx) { if (!firstChorus && (sx.kind === "chorus" || sx.kind === "drop")) firstChorus = sx; if (!firstVerse && sx.kind === "verse") firstVerse = sx; });
    if (firstChorus && firstVerse && firstChorus.chords.map(function (c) { return c.rs + c.q; }).join() === firstVerse.chords.map(function (c) { return c.rs + c.q; }).join()) note("The verse and the chorus use the same chords: give the chorus a different progression.", 10);
    var last = sections[sections.length - 1]; if (last && last.kind !== "outro" && last.energy > .8) note("The ending stays at full energy: finish with a softer outro or a held final chord.", 3);
    for (i = 0; i < sections.length; i++) {
      cur = "mel"; var sx = sections[i]; if (!sx.mel) { if ((sx.kind === "chorus" || sx.kind === "verse") && sx.lead !== "none") note("Section " + sx.src + " (" + sx.kind + ") has no written melody.", 6); continue; }
      stats.melodies++;
      var seq = [], bars = sx.mel.length, strong = 0, strongOk = 0, leaps = 0, steps = 0, repeats = 0, total = 0, durs = {}, sumP = 0, bi, k;
      for (bi = 0; bi < bars; bi++) for (k = 0; k < sx.mel[bi].length; k++) { var nt = sx.mel[bi][k]; seq.push({ b: bi, s: nt.s, p: semi(nt.deg), deg: nt.deg, len: nt.len }); }
      var tag = "Section " + sx.src + " (" + sx.kind + "): ";
      if (seq.length < 3) continue;
      var lo = Math.min.apply(null, seq.map(function (x) { return x.p; })), hi = Math.max.apply(null, seq.map(function (x) { return x.p; }));
      if (hi - lo > 19) note(tag + "the melody spans " + (hi - lo) + " semitones; keep it within about an octave and a half so it is singable.", 8);
      if (hi - lo < 4 && seq.length > 6) note(tag + "the melody barely moves (range " + (hi - lo) + " semitones); give it a clear rise and fall.", 8);
      for (j = 0; j < seq.length; j++) {
        sumP += seq[j].p; durs[seq[j].len] = 1;
        if (j > 0) { var iv = Math.abs(seq[j].p - seq[j - 1].p); total++; if (iv === 0) repeats++; else if (iv <= 3) steps++; else if (iv > 5) leaps++; if (iv > 9) note(tag + "a leap of " + iv + " semitones before bar " + (seq[j].b + 1) + " is too large.", 3); }
        if (seq[j].s % 4 === 0) {
          strong++; var ch = sx.chords[(seq[j].b) % sx.chords.length], pcs = ch.abs.map(function (x) { return (ch.rs + x) % 12; });
          if (pcs.indexOf(((seq[j].p % 12) + 12) % 12) >= 0) strongOk++;
        }
      }
      avgPitch[i] = sumP / seq.length; melRange[i] = { lo: lo, hi: hi }; melSeq[i] = { seq: seq, bars: bars };
      if (total) {
        if (leaps / total > .3) note(tag + "too many leaps (" + Math.round(100 * leaps / total) + "%); mostly use steps with an occasional jump.", 7);
        if (repeats / total > .4) note(tag + "too many repeated notes (" + Math.round(100 * repeats / total) + "%); vary the pitches.", 6);
        if (steps / total < .25 && total > 5) note(tag + "very few stepwise moves; a singable tune moves mostly by step.", 4);
      }
      if (strong >= 3 && strongOk / strong < .5) note(tag + "only " + Math.round(100 * strongOk / strong) + "% of the notes on the beat are chord tones; the melody clashes with the chords.", 9);
      var lastN = seq[seq.length - 1], lch = sx.chords[lastN.b % sx.chords.length], lp = lch.abs.map(function (x) { return (lch.rs + x) % 12; });
      if (lp.indexOf(((lastN.p % 12) + 12) % 12) < 0) note(tag + "the melody ends on a note that is not in the final chord; end the phrase on a chord tone (root, 3rd or 5th).", 6);
      var perBar = seq.length / bars; if (perBar > 12 * TUNE.busy) note(tag + "too busy (" + perBar.toFixed(1) + " notes per bar); leave space to breathe.", 5); if (perBar < 1.5 && bars >= 2) note(tag + "very sparse (" + perBar.toFixed(1) + " notes per bar).", 3);
      if (Object.keys(durs).length < 2 && seq.length > 5) note(tag + "every note has the same length; mix long and short notes for a rhythm with character.", 5);
      if (bars >= 4) { var sigs = {}; for (bi = 0; bi < bars; bi++) sigs[sx.mel[bi].map(function (x) { return x.s + ":" + x.deg; }).join()] = 1; if (Object.keys(sigs).length === 1) note(tag + "every bar is identical; develop the idea (answer it, vary the end, go higher).", 7); }
    }
    sections.forEach(function (sx) {
      if (!sx.bl) return; stats.basslines = (stats.basslines || 0) + 1;
      cur = "bass"; var tag = "Bass, section " + sx.src + " (" + sx.kind + "): ", all = [], bi, rootsDown = 0, offb = 0, kinds = {}, durs = {};
      for (bi = 0; bi < sx.bl.length; bi++) { var bn = sx.bl[bi]; if (bn.length && bn[0].s <= 2 && bn[0].t === "R") rootsDown++; bn.forEach(function (x) { all.push(x); kinds[x.t] = 1; durs[x.len] = 1; if (x.s % 4 !== 0) offb++; }); }
      var per = all.length / sx.bl.length;
      if (rootsDown / sx.bl.length < .5) note(tag + "the bass should land on the chord root (\"R\") on beat 1 (step 0) of most bars.", 14);
      if (per > 14 * TUNE.busy) note(tag + "too busy (" + per.toFixed(1) + " notes per bar); a bass line locks in with the drums, leave space.", 5);
      if (per < 1.5 && sx.bl.length >= 2) note(tag + "very sparse; add a pickup or a fifth so the groove moves.", 3);
      if (Object.keys(kinds).length < 2 && all.length > 4) note(tag + "only one tone is used; add the 5th, the octave or an approach note (\"a\") before the chord change.", 6);
      if (!offb && all.length > 5) note(tag + "every note is on the beat; add a syncopated note (steps 2, 6, 10, 14) for groove.", 4);
      if (Object.keys(durs).length < 2 && all.length > 5) note(tag + "every note has the same length; mix short and long notes.", 3);
    });
    sections.forEach(function (sx) {
      if (!sx.gv) return; cur = "drums"; stats.grooves = (stats.grooves || 0) + 1;
      var tag = "Drums, section " + sx.src + " (" + sx.kind + "): ", st = pl.style || "";
      [sx.gv.a, sx.gv.b].forEach(function (g, gi) {
        if (!g) return; var t = tag + (gi ? "second bar " : ""), on = function (k, i) { return g[k] && g[k].charAt(i) !== "."; }, cnt = function (k) { return g[k] ? g[k].replace(/\./g, "").length : 0; }, total = 0, kk;
        for (kk in g) total += cnt(kk);
        var back = on("snare", 4) || on("snare", 12) || on("clap", 4) || on("clap", 12) || on("rim", 4) || on("rim", 12) || on("snare", 8) || on("clap", 8) || on("rim", 8);
        if (!back) note(t + "no backbeat: put the snare or clap on steps 4 and 12 (or step 8 for half-time and one-drop).", 14);
        if (!cnt("kick")) note(t + "no kick drum.", 10);
        else if (!on("kick", 0) && !on("kick", 8) && st !== "reggae") note(t + "the kick should anchor beat 1 (step 0).", 8);
        var time = cnt("hat") + cnt("ride") + cnt("shaker") + cnt("tamb") + cnt("open");
        if (!time && st !== "ambient" && st !== "celtic" && st !== "opera" && st !== "bluegrass" && st !== "irish") note(t + "no timekeeping: add hi-hat, ride, shaker or tambourine so the groove has a pulse.", 8);
        if (total > 64 * TUNE.busy) note(t + "too busy (" + total + " hits in one bar); simplify so the groove can breathe.", 6);
        if (cnt("kick") > 8) note(t + "too many kicks (" + cnt("kick") + "); a bar rarely needs more than 6.", 5);
        if ((on("kick", 4) && on("snare", 4)) || (on("kick", 12) && on("snare", 12))) note(t + "the kick and snare hit together on the backbeat; keep the backbeat for the snare.", 5);
        if ((st === "house" || st === "edm") && !(on("kick", 0) && on("kick", 4) && on("kick", 8) && on("kick", 12))) note(t + "house needs a four-on-the-floor kick (steps 0, 4, 8, 12).", 8);
        if ((st === "funk" || st === "afrobeats" || st === "afrobeat" || st === "hiphop" || st === "trap" || st === "rnb") && g.kick && !/[xXo]/.test(g.kick.replace(/(.)(.)(.)(.)/g, "$2$3$4"))) note(t + "the kick only plays on the beat; add a syncopated kick for groove.", 5);
        if (g.snare && /[xX]/.test(g.snare.slice(0, 1)) && st !== "afrobeats") note(t + "the snare on beat 1 is unusual; the snare belongs on the backbeat.", 4);
      });
      if (sx.gv.b && sx.gv.b === sx.gv.a) note(tag + "the second bar is identical to the first.", 1);
    });
    sections.forEach(function (sx) {
      if (!sx.bl || !sx.gv || !sx.gv.a || !sx.gv.a.kick) return; var st = pl.style || ""; if (st === "house" || st === "edm" || st === "ambient" || st === "celtic" || st === "opera" || st === "bluegrass" || st === "irish") return;
      cur = "bass"; var kk = [], q, on = {}; for (q = 0; q < 16; q++) if (sx.gv.a.kick.charAt(q) !== ".") kk.push(q); if (!kk.length || !sx.bl[0]) return;
      sx.bl[0].forEach(function (x) { on[x.s] = 1; }); var hit = kk.filter(function (k) { return on[k]; }).length;
      if (hit / kk.length < .6) note("Bass, section " + sx.src + " (" + sx.kind + "): the bass and the kick are not locked: only " + hit + " of " + kk.length + " kick hits (steps " + kk.join(",") + ") have a bass note under them; play the bass on the kick hits.", 8);
    });
    /* ── across the parts: does the melody agree with the bass, and is the whole thing too busy or too empty? ── */
    (function () {
      cur = "cross"; var tot = {}, tones = { R: 0, "3": null, b3: 3, "5": 7, b5: 6, b7: 10, "7": 11, "6": 9, "4": 5, "2": 2, "8": 0, "9": 2 };
      sections.forEach(function (sx, si) {
        var ms = melSeq[si], tag = "Section " + sx.src + " (" + sx.kind + "): ", g = sx.gv && sx.gv.a, bl = sx.bl; if (!ms || !bl || !bl.length) return;
        var mb = ms.seq.length / Math.max(1, ms.bars), bc = 0; bl.forEach(function (bn) { bc += bn.length; }); var bb = bc / bl.length, dh = 0;
        if (g) for (var kk in g) dh += g[kk].replace(/\./g, "").length; else dh = -1;
        if (dh >= 0) {
          var sum = mb + bb + dh; tot[sx.kind] = tot[sx.kind] === undefined ? sum : tot[sx.kind];
          if (sum > 50 * TUNE.busy) note(tag + "the whole arrangement is too busy (" + Math.round(sum) + " events per bar: melody " + mb.toFixed(1) + ", bass " + bb.toFixed(1) + ", drums " + dh + "); thin out the busiest part.", 6);
          else if (sum < 14 * TUNE.busy && sx.energy > .6) note(tag + "too empty for a high-energy section (" + Math.round(sum) + " events per bar); give the bass or the drums more to do.", 4);
        }
        var pairs = 0, clash = 0;
        ms.seq.forEach(function (n) {
          var ch = sx.chords[n.b % sx.chords.length], bar = bl[n.b % bl.length], hit = null; if (!bar) return;
          bar.forEach(function (x) { if (x.s <= n.s && n.s < x.s + x.len && x.t !== "a") hit = x; }); if (!hit) return;
          var off = hit.t === "3" ? (ch.abs[1] !== undefined ? ch.abs[1] : 4) : tones[hit.t]; if (off === undefined || off === null) return;
          pairs++; var bp = (ch.rs + off) % 12, mp = ((n.p % 12) + 12) % 12, d = ((mp - bp) % 12 + 12) % 12;
          var inCh = ch.abs.some(function (x) { return (ch.rs + x) % 12 === mp; });
          if (d === 1 || d === 11 || (d === 6 && !inCh)) clash++;
        });
        if (pairs >= 6 && clash / pairs > .2) note(tag + "the melody and the bass clash: " + clash + " of " + pairs + " melody notes sit a half step or a tritone from the bass note under them; move the bass to a chord tone (root, 5th) where the melody is on a tension note.", 7);
      });
      if (tot.chorus !== undefined && tot.verse !== undefined && tot.chorus < tot.verse * .9) note("The chorus is no busier than the verse overall (" + Math.round(tot.chorus) + " vs " + Math.round(tot.verse) + " events per bar); add a part or open the bass and drums up.", 5);
    })();
    cur = "orch";
    (function () {
      if (pl.rejected && pl.rejected.length) {
        var st0 = STYLES[pl.style], ex = st0 && st0.pal ? ["lead", "comp", "pad"].map(function (r) { return r + ": " + (st0.pal[r] || []).slice(0, 4).join("/"); }).join("; ") : "";
        note("These instruments do not belong in " + (st0 ? st0.name : pl.style) + " and were dropped: " + pl.rejected.join(", ") + ". Pick instruments that suit the genre (" + ex + ").", 7);
      }
      var base = pl.band || {}, famOf = function (nm) { return nm && INSTR_META[nm] ? INSTR_META[nm].fam : ""; };
      function eff(sx) { var b = {}, r; BAND_ROLES.forEach(function (k) { b[k] = base[k]; if (sx.band && sx.band[k] !== undefined) b[k] = sx.band[k]; }); return b; }
      function layers(sx) { var b = eff(sx), n = 0; ["pad", "comp", "lead", "arp", "ans"].forEach(function (k) { if (b[k] !== "none" && !(k === "lead" && sx.lead === "none")) n++; }); if (sx.dbl) n++; if (sx.bass !== false && b.bass !== "none") n++; return n; }
      var changed = 0, firstIntro = null, i2;
      sections.forEach(function (sx) { if (sx.band || sx.dbl) changed++; if (!firstIntro && sx.kind === "intro") firstIntro = sx; });
      stats.orchestrated = changed;
      if (sections.length >= 5 && !changed && !pl.mix) note("The arrangement never changes: give some sections their own instruments (e.g. strings join the chorus, a different lead in the bridge) and add a mix sheet.", 6);
      if (firstChorus && firstVerse && layers(firstChorus) <= layers(firstVerse) && !firstChorus.dbl) note("The chorus is not fuller than the verse: bring in an extra instrument or a melody double for the chorus.", 8);
      if (firstIntro && firstChorus && layers(firstIntro) >= layers(firstChorus)) note("The intro is as full as the chorus: strip the intro back to one or two instruments.", 6);
      sections.forEach(function (sx) {
        var b = eff(sx), tag = "Section " + sx.src + " (" + sx.kind + "): ";
        if (b.lead && b.comp && b.lead === b.comp && b.lead !== "none" && sx.lead !== "none") note(tag + "the lead and the chords are the same instrument (" + b.lead + "); give the melody a different timbre so it stands out.", 6);
        var sus = 0; ["pad", "comp", "lead", "arp", "ans"].forEach(function (k) { var f = famOf(b[k]); if (f === "sus" || f === "bowed") sus++; }); if (sx.dbl && /sus|bowed/.test(famOf(sx.dbl.i))) sus++;
        if (sus > 2) note(tag + "too many sustained instruments at once (" + sus + "); it will sound muddy. Keep at most two of strings, pad, choir and violin.", 6);
        if (sx.dbl && sx.dbl.o === 0 && (sx.dbl.i === b.lead)) note(tag + "the melody double is the same instrument at the same pitch; use another instrument or an octave.", 5);
        if (sx.dbl && sx.lead === "none") note(tag + "a melody double needs a lead melody to double.", 3);
        var si = sections.indexOf(sx), mr = melRange[si], ld = b.lead, R = ld && INSTR_RANGE[ld];
        if (mr && R && sx.lead !== "none") {
          var org = placeInRange(pl.key, (LEAD_CENTER[ld] || 70) - 13, (LEAD_CENTER[ld] || 70) - 2), lo = org + mr.lo, hi = org + mr.hi;
          if (lo < R[0] - 1) note(tag + "the melody drops to " + noteName(lo) + ", below the " + ld + "'s range (" + noteName(R[0]) + "-" + noteName(R[1]) + "); choose a lower instrument or a higher melody.", 5);
          if (hi > R[1] + 1) note(tag + "the melody climbs to " + noteName(hi) + ", above the " + ld + "'s range (" + noteName(R[0]) + "-" + noteName(R[1]) + "); choose a higher instrument or a lower melody.", 5);
          var cc2 = b.comp && b.comp !== "none" ? (COMP_CENTER[b.comp] || 62) : 0;
          if (cc2 && lo < cc2 - 6) note(tag + "the lead's lowest note (" + noteName(lo) + ") is far below the chord instrument's centre (" + noteName(cc2) + "); it will be buried in the chords.", 3);
        }
        var crowd = 0; if (b.pad && b.pad !== "none") crowd++; if (b.comp && b.comp !== "none" && (COMP_CENTER[b.comp] || 62) <= 64) crowd++;
        if (sx.dbl && sx.dbl.o <= 0 && /sus|bowed|wind|reed/.test(famOf(sx.dbl.i))) crowd++; if (b.ans && b.ans !== "none") crowd++;
        if (crowd >= 4) note(tag + "four parts crowd the low-mids (C3-E4): pad, chords" + (sx.dbl ? ", the double" : "") + "; move the double up an octave, drop one, or high-pass the pad (mix hp 1.5-2.5).", 4);
        if (sx.kind === "bridge" && !sx.band && !sx.dbl && changed && sections.length >= 6) note(tag + "the bridge should sound different: change the lead or the chords' instrument for it.", 3);
      });
      var m = pl.mix; if (m) {
        if (m.lead && m.comp && m.lead.lvl !== undefined && m.comp.lvl !== undefined && m.lead.lvl < m.comp.lvl * .8) note("Mix: the lead is quieter than the chords; the melody will be buried.", 8);
        if (m.pad && m.pad.lvl > 1.4) note("Mix: the pad is too loud; it will swamp everything.", 5);
        ["pad", "comp", "lead", "arp", "bass", "drums"].forEach(function (r) { if (m[r] && m[r].rv > 1.8) note("Mix: too much reverb on the " + r + "; it will wash out.", 4); });
        if (m.bass && m.bass.rv > .6) note("Mix: reverb on the bass makes it muddy; keep it near zero.", 6);
        if (m.bass && m.bass.hp > 1.4) note("Mix: do not high-pass the bass (hp above 1.4 thins it out); keep it at 1 or less.", 5);
        if (m.lead && m.lead.tone > 4) note("Mix: lead tone above +4 dB will sound harsh.", 3);
        if (m.drums && m.bass && m.bass.lvl > 1.5 && m.drums.lvl < .8) note("Mix: the bass is far louder than the drums.", 4);
      } else if (changed) note("There is no mix sheet: set level, reverb and delay for each part to suit the song.", 3);
    })();
    cur = "mel"; var ci = sections.indexOf(firstChorus), vi = sections.indexOf(firstVerse);
    if (ci >= 0 && vi >= 0 && avgPitch[ci] !== undefined && avgPitch[vi] !== undefined && avgPitch[ci] < avgPitch[vi] + 1) note("The chorus melody should sit higher than the verse melody so it lifts.", 6);
    var score = Math.max(0, Math.min(100, 100 - pen));
    var fin = function (k) { return { score: Math.max(0, 100 - parts[k].pen), issues: parts[k].issues.slice(0, 8) }; };
    return { ok: true, score: score, issues: issues.slice(0, 8), stats: stats, mel: fin("mel"), bass: fin("bass"), drums: fin("drums"), orch: fin("orch"), plan: fin("plan"), cross: fin("cross") };
  }
  /* what a melody writer needs to see: for every chord, which scale degrees are its notes (safe on the beat) */
  function tonesOf(src) {
    var pl = parsePlan(src); if (!pl) return null; var sc = MODES[pl.mode] || MODES.ionian;
    return { key: ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"][pl.key], mode: pl.mode, scale: sc.length,
      sections: pl.sections.map(function (sx) {
        return { src: sx.src, kind: sx.kind, bars: sx.bars, lead: sx.lead, chords: sx.chords.map(function (c) {
          var t = []; c.abs.forEach(function (x) { var i = sc.indexOf((c.rs + x) % 12); if (i >= 0 && t.indexOf(i) < 0) t.push(i); }); return t; }) };
      }) };
  }
  function setPart(map, field, bfield, parse) {
    var pc = P.piece; if (!pc || !pc.comp || !pc.comp.spec || !pc.comp.spec.plan || !map) return 0;
    var plan = pc.comp.spec.plan, raw = P.lastBrief && (P.lastBrief.planSrc || P.lastBrief.plan), done = 0, rf = field === "bl" ? "bassline" : "mel";
    plan.sections.forEach(function (ps) {
      var m = map[ps.src]; if (m === undefined) return;
      var pm = m === null ? null : parse(m, ps.bars); if (m !== null && !pm) return;
      ps[field] = pm ? pm.byBar : null; ps[bfield] = pm ? pm.bars : 0; done++;
      if (raw && typeof raw === "object" && Array.isArray(raw.sections) && raw.sections[ps.src]) { if (m === null) delete raw.sections[ps.src][rf]; else raw.sections[ps.src][rf] = m; }
    });
    var sg = function (x) { return x.kind + "|" + x.chords.map(function (c) { return c.rs + c.q; }).join(); }, sn = {};
    plan.sections.forEach(function (x) { if (x[field] && !sn[sg(x)]) sn[sg(x)] = x; });
    plan.sections.forEach(function (x) { if (!x[field] && sn[sg(x)] && (field === "bl" ? x.bass : x.lead !== "none")) { x[field] = sn[sg(x)][field]; x[bfield] = sn[sg(x)][bfield]; } });
    return done;
  }
  /* live orchestration: per-section bands and doubles, plus the mix sheet; sections take their band at their next start, the mix eases in at the next bar */
  function setOrchestra(o, now) {
    var pc = P.piece; if (!pc || !pc.comp || !pc.comp.spec || !pc.comp.spec.plan || !o) return 0;
    var plan = pc.comp.spec.plan, raw = P.lastBrief && (P.lastBrief.planSrc || P.lastBrief.plan), done = 0, secs = o.sections || {};
    plan.sections.forEach(function (ps) {
      var m = secs[ps.src]; if (!m || typeof m !== "object") return;
      var b = parseBandObj(m.band), d = parseDouble(m.double); if (plan.style) { b = purgeBand(plan.style, b); if (d && !fits(plan.style, d.i)) d = null; } if (!b && !d) return;
      ps.band = b; ps.dbl = d; done++;
      if (raw && typeof raw === "object" && Array.isArray(raw.sections) && raw.sections[ps.src]) { var rs = raw.sections[ps.src]; if (b) rs.band = m.band; else delete rs.band; if (d) rs.double = m.double; else delete rs.double; }
    });
    var mx = parseMixSheet(o.mix); if (mx) { plan.mix = mx; done++; if (raw && typeof raw === "object") raw.mix = o.mix; }
    if (done) { resaveIfLiked(); if (now) refreshNow(); }
    return done;
  }
  function refreshNow() { try { var c = P.piece && P.piece.comp; if (c && c.refresh) c.refresh(); } catch (e) {} }
  function setBass(map, now) { var n = setPart(map, "bl", "blBars", parseBassLine); if (n) { resaveIfLiked(); if (now) refreshNow(); } return n; }
  function setDrums(map, now) {
    var pc = P.piece; if (!pc || !pc.comp || !pc.comp.spec || !pc.comp.spec.plan || !map) return 0;
    var plan = pc.comp.spec.plan, raw = P.lastBrief && (P.lastBrief.planSrc || P.lastBrief.plan), done = 0;
    plan.sections.forEach(function (ps) {
      var m = map[ps.src]; if (m === undefined) return;
      var g = m === null ? null : parseGroove(m.groove || m), g2 = g && m.groove2 ? parseGroove(m.groove2) : null; if (m !== null && !g) return;
      ps.gv = g ? { a: g, b: g2 } : null; done++;
      if (raw && typeof raw === "object" && Array.isArray(raw.sections) && raw.sections[ps.src]) { var rs = raw.sections[ps.src]; if (!g) { delete rs.groove; delete rs.groove2; } else { rs.groove = m.groove || m; if (m.groove2) rs.groove2 = m.groove2; else delete rs.groove2; } }
    });
    var sg = function (x) { return x.kind + "|" + x.chords.map(function (c) { return c.rs + c.q; }).join(); }, sn = {};
    plan.sections.forEach(function (x) { if (x.gv && !sn[sg(x)]) sn[sg(x)] = x; });
    plan.sections.forEach(function (x) { if (!x.gv && sn[sg(x)] && x.drums > 0) x.gv = sn[sg(x)].gv; });
    if (done) { resaveIfLiked(); if (now) refreshNow(); }
    return done;
  }
  /* a piece liked before its written parts arrived is saved again with them */
  function resaveIfLiked() { try { var pc = P.piece; if (!pc) return; var s0 = seedStr(pc); if (taste.seeds.some(function (x) { return x.s === s0; })) saveTaste(); } catch (e) {} }
  /* put (or replace) written melodies into the plan that is playing; they take effect from the next section */
  function setMelodies(map, now) {
    var pc = P.piece; if (!pc || !pc.comp || !pc.comp.spec || !pc.comp.spec.plan || !map) return 0;
    var plan = pc.comp.spec.plan, raw = P.lastBrief && (P.lastBrief.planSrc || P.lastBrief.plan), done = 0;
    plan.sections.forEach(function (ps) {
      var m = map[ps.src]; if (m === undefined) return;
      var pm = m === null ? null : parseMel(m, ps.bars); if (m !== null && !pm) return;
      ps.mel = pm ? pm.byBar : null; ps.melBars = pm ? pm.bars : 0; done++;
      if (raw && typeof raw === "object" && Array.isArray(raw.sections) && raw.sections[ps.src]) { if (m === null) delete raw.sections[ps.src].mel; else raw.sections[ps.src].mel = m; }
    });
    var sg = function (x) { return x.kind + "|" + x.chords.map(function (c) { return c.rs + c.q; }).join(); }, sn = {};
    plan.sections.forEach(function (x) { if (x.mel && !sn[sg(x)]) sn[sg(x)] = x; });
    plan.sections.forEach(function (x) { if (!x.mel && x.lead !== "none" && sn[sg(x)]) { x.mel = sn[sg(x)].mel; x.melBars = sn[sg(x)].melBars; } });
    if (done) { resaveIfLiked(); if (now) refreshNow(); }
    return done;
  }

  /* ═══════════════ brief -> spec ═══════════════ */
  function parseKey(k) {
    if (typeof k === "number") return ((k % 12) + 12) % 12;
    if (typeof k !== "string") return null;
    var m = k.trim().match(/^([A-Ga-g])([#b]?)/); if (!m) return null;
    var base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
    return (base + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
  }
  /* tolerant parser: the LLM's JSON can be partial or slightly wrong, so every field is validated and clamped */
  function parseBrief(b) {
    if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b && typeof b === "object" ? b : {};
    var o = {};
    var mood = String(b.mood || "").toLowerCase();
    var alias = { happy: "joy", excited: "joy", sad: "sadness", anxious: "fear", scared: "fear", angry: "anger", mad: "anger", lonely: "sadness", tired: "calm", stressed: "fear", calm: "calm", peaceful: "calm", loving: "love", romantic: "love", hopeful: "hope", confused: "confusion" };
    mood = alias[mood] || mood;
    o.mood = (RECIPES[mood] ? mood : "neutral");
    var intent = String(b.intent || "").toLowerCase();
    o.intent = (intent === "match" || intent === "lift" || intent === "calm") ? intent : "";
    var st = String(b.style || "").toLowerCase().replace(/[^a-z]/g, "");
    var salias = { lofi: "lofi", lofibeats: "lofi", chill: "lofi", afrobeat: "afrobeat", fela: "afrobeat", felakuti: "afrobeat", highlife: "afrobeat", afro: "afrobeats", piano: "ambient", enya: "celtic", opera: "opera", aria: "opera", operatic: "opera", classical: "opera", choral: "opera", requiem: "opera", soprano: "opera", tenor: "opera", orchestral: "opera", pavarotti: "opera", mozart: "opera", puccini: "opera", handel: "opera", theater: "opera", theatre: "opera", celtic: "celtic", celt: "celtic", lingala: "lingala", soukous: "lingala", ndombolo: "lingala", sebene: "lingala", congolese: "lingala", congo: "lingala", rumba: "lingala", rhumba: "lingala", congolesrumba: "lingala", irish: "irish", irishfolk: "irish", irishmusic: "irish", jig: "irish", jigs: "irish", reel: "irish", reels: "irish", ceilidh: "irish", trad: "irish", pub: "irish", hornpipe: "irish", newage: "celtic", ethereal: "celtic", orinoco: "celtic", hiphop: "hiphop", rb: "rnb", rnb: "rnb", soul: "rnb", orchestral: "cinematic", film: "cinematic", guitar: "acoustic", folk: "acoustic", edm: "house", dance: "house", electronic: "house",
      rocknroll: "rocknroll", rockandroll: "rocknroll", bluegrassmusic: "bluegrass", country: "country", countrymusic: "country", countrywestern: "country", western: "country", nashville: "country", bluegrass: "bluegrass", newgrass: "bluegrass", banjo: "bluegrass", bluegrassband: "bluegrass", honkytonk: "country", cowboy: "country", hillbilly: "country", rocknrol: "rocknroll", rockn: "rocknroll", rockabilly: "rocknroll", elvis: "rocknroll", chuckberry: "rocknroll", fifties: "rocknroll", oldies: "rocknroll", twist: "rocknroll",
      rock: "rock", hardrock: "rock", classicrock: "rock", altrock: "rock", punk: "rock", grunge: "rock", metal: "rock", indie: "rock", band: "rock", blues: "blues", bluesy: "blues", jazz: "jazz", jazzy: "jazz", swing: "jazz", bebop: "jazz", bossa: "jazz", smoothjazz: "jazz",
      reggae: "reggae", ska: "reggae", dub: "reggae", dancehall: "reggae", funk: "funk", funky: "funk", disco: "funk", groove: "funk", pop: "pop", popmusic: "pop", hiphop2: "hiphop", boombap: "hiphop", rap: "hiphop" };
    var DRUMS_ALIAS = { drum: 1, drums: 1, drummer: 1, drumsolo: 1, drumkit: 1, drumming: 1, percussion: 1, perc: 1, percussions: 1, beat: 1, beats: 1 };
    st = salias[st] || st;
    o.style = STYLES[st] ? st : "";
    if (typeof b.energy === "number" && isFinite(b.energy)) o.energy = clamp(b.energy, 0, 1);
    if (typeof b.bpm === "number" && isFinite(b.bpm)) o.bpm = clamp(Math.round(b.bpm), 50, 150);
    var k = parseKey(b.key); if (k !== null) o.key = k;
    if (typeof b.mode === "string" && MODES[b.mode.toLowerCase()]) o.mode = b.mode.toLowerCase();
    if (b.instruments && typeof b.instruments === "object") {
      o.instruments = {};
      ["pad", "comp", "lead", "arp", "bass", "ans"].forEach(function (r) { var n = b.instruments[r]; if (typeof n === "string") o.instruments[r] = n === "none" ? n : normInstr(n); });
    }
    if (b.solo) {
      var sn = String(b.solo).toLowerCase().replace(/[^a-z]/g, ""); sn = SOLO_ALIAS[sn] || sn;
      if (DRUMS_ALIAS[sn]) o.drums = true;
      else if (SOLO_SETUP[sn]) { o.solo = sn; o.style = "solo"; }
    }
    if (b.drums === true || b.drums === "solo" || DRUMS_ALIAS[String(b.style || "").toLowerCase().replace(/[^a-z]/g, "")]) { o.drums = true; if (!STYLES[o.style] || o.style === "solo") o.style = ""; }
    if (b.seed !== undefined && b.seed !== null && b.seed !== "") o.seed = typeof b.seed === "number" ? (b.seed >>> 0) : strToSeed(b.seed);
    if (typeof b.stageBars === "number" && isFinite(b.stageBars)) o.stageBars = clamp(Math.round(b.stageBars), 8, 64);
    if (typeof b.note === "string") o.note = b.note.slice(0, 80);
    if ((b.planSrc || b.plan) && !o.solo && !o.drums) {
      var pl = parsePlan(b.planSrc || b.plan);
      if (pl) {
        o.planSrc = b.planSrc || b.plan;
        o.plan = pl; if (pl.style) o.style = pl.style; o.key = pl.key; o.mode = pl.mode; if (pl.bpm && typeof b.bpm !== "number") o.bpm = pl.bpm;
        if (pl.band) { o.instruments = o.instruments || {}; for (var br in pl.band) o.instruments[br] = pl.band[br]; }
      }
    }
    return o;
  }

  var INSTR_ALIAS = { electricguitar: "eguitar", cleanguitar: "eguitar", distortedguitar: "dguitar", distortion: "dguitar", rhythmguitar: "dguitar", leadguitar: "lguitar", electricbass: "ebass", bassguitar: "ebass", fingerbass: "ebass", uprightbass: "upbass", doublebass: "upbass", acousticbass: "upbass",
                      voice: "vox", vocal: "vox", vocals: "vox", singer: "vox", singing: "vox", la: "vox", lala: "vox", aah: "vox", humming: "hum", mm: "hum", oohs: "ooh", voiceoohs: "ooh", oohvoice: "ooh", synthvoice: "synthchoir", vocoder: "synthchoir", syntchoir: "synthchoir", hammondorgan: "hammond", b3: "hammond", horn: "horns", hornsection: "horns", brasssection: "horns", clavinet: "clav", saxophone: "sax", keyboard: "keys", electricpiano: "keys", rhodes: "keys", string: "strings", harps: "harp", orchestralharp: "harp", electricpiano: "keys", organ2: "organ", pipeorgan: "organ", churchorgan: "organ", marimbas: "marimba", clavinet: "clav" };
  function normInstr(n) { var k = String(n || "").toLowerCase().replace(/[^a-z0-9]/g, ""); return INSTR_ALIAS[k] || k; }
  /* genre fit: the instruments that really belong in each genre (the style palette, its bands, and the sensible extras). Anything outside this list is "foreign":
   * a model-written plan or an automatic choice may not put it in, because an instrument that does not belong is what makes a piece sound random. */
  var VOICES = "vox hum ooh choir synthchoir";
  var FIT_EXTRA = {
    afrobeats: "pad strings choir ooh hum vox synthchoir eguitar guitar keys fmpiano marimba mbira balafon kalimba pluck bells sax flute brass horns whistle piano sub 808 ebass log clav",
    afrobeat: "organ strings pad hammond eguitar keys fmpiano clav sax brass horns balafon marimba guitar ebass upbass vox hum choir ooh mbira flute",
    amapiano: "pad strings keys fmpiano piano marimba mbira bells flute whistle kalimba pluck log sub choir ooh vox hum synthchoir sax balafon eguitar guitar",
    lofi: "pad strings keys fmpiano piano guitar eguitar sax kalimba flute bells pluck clav vox hum ooh sub upbass ebass 808 harp",
    house: "pad strings organ piano keys fmpiano synth bells pluck sax brass horns synthbass sub choir vox ooh synthchoir hum clav",
    trap: "pad choir ooh hum vox synthchoir keys bells pluck synth flute cowbell 808 sub strings piano kalimba harp fmpiano",
    phonk: "pad choir ooh hum vox synthchoir keys bells pluck synth cowbell 808 sub strings piano kalimba flute fmpiano",
    memphis: "pad choir ooh hum vox synthchoir keys bells pluck synth cowbell 808 sub strings piano kalimba fmpiano flute",
    rnb: "pad strings keys fmpiano piano guitar eguitar sax flute violin bells kalimba clav vox hum ooh choir synthchoir sub 808 ebass synthbass harp pluck",
    ambient: "pad strings choir ooh hum vox synthchoir piano bells kalimba harp flute violin guitar pluck keys fmpiano sub",
    opera: "pad strings choir ooh hum vox synthchoir piano harp bells flute violin brass horns organ keys upbass sub",
    celtic: "pad strings choir ooh hum vox synthchoir piano harp bells flute whistle violin kalimba pluck guitar keys fmpiano sub",
    cinematic: "pad strings choir ooh hum vox synthchoir piano bells kalimba harp flute violin brass horns guitar pluck keys sub 808 upbass",
    acoustic: "pad strings piano guitar flute violin kalimba harp bells pluck keys marimba ooh hum vox choir upbass sub harmonica",
    rock: "dguitar lguitar eguitar guitar hammond organ strings piano ebass harmonica vox ooh sax keys",
    bluegrass: "guitar banjo mandolin violin harmonica upbass hammond",
    irish: "guitar banjo mandolin violin whistle flute harp piano organ strings upbass pluck bells harmonica",
    lingala: "eguitar guitar sax brass horns organ hammond strings pad keys ebass upbass mbira kalimba balafon marimba harmonica ooh hum vox choir bells",
    country: "guitar eguitar lguitar banjo mandolin steel violin harmonica piano hammond organ upbass ebass strings pad keys pluck horns",
    rocknroll: "eguitar lguitar guitar piano hammond organ sax horns harmonica upbass ebass vox",
    blues: "hammond organ eguitar lguitar guitar piano harmonica sax brass horns upbass ebass keys vox",
    jazz: "piano keys fmpiano sax brass horns marimba eguitar guitar hammond organ upbass ebass flute violin strings pad hum vox clav harp",
    reggae: "hammond organ eguitar clav keys sax flute horns guitar piano marimba ebass upbass sub vox hum ooh brass",
    funk: "hammond clav eguitar keys fmpiano piano sax lguitar horns brass ebass synthbass synth upbass organ flute ooh vox",
    pop: "pad strings piano eguitar keys fmpiano guitar synth flute bells pluck kalimba sax vox hum ooh choir synthchoir ebass synthbass sub 808 harp violin",
    hiphop: "pad strings piano keys fmpiano eguitar guitar sax bells kalimba flute clav pluck vox hum ooh choir synthchoir sub 808 upbass ebass synth brass horns"
  };
  var FIT = {};
  (function () {
    Object.keys(STYLES).forEach(function (sn) {
      var set = {}, st = STYLES[sn], add = function (n) { if (n && n !== "none") set[n] = 1; };
      (FIT_EXTRA[sn] || "").split(" ").forEach(add);
      if (st.pal) Object.keys(st.pal).forEach(function (r) { (st.pal[r] || []).forEach(add); });
      (st.bands || []).forEach(function (b) { Object.keys(b).forEach(function (r) { add(b[r]); }); });
      FIT[sn] = set;
    });
  })();
  /* drop instruments that do not belong in the genre from a band object; returns what was removed */
  function purgeBand(style, b, out, where) {
    if (!b || !style) return b; var k, res = {}, any = false;
    for (k in b) { if (b[k] !== "none" && !fits(style, b[k])) { if (out) out.push((where || "") + k + ": " + b[k]); } else { res[k] = b[k]; any = true; } }
    return any ? res : null;
  }
  function fits(style, inst) { var f = FIT[style]; return !f || (STYLES[style] && STYLES[style].solo) || !inst || inst === "none" || !!f[inst]; }
  function pickInstrument(role, style, recipe, rng, taken, forced) {
    var cands = STYLES[style].pal[role].slice();
    if (!cands.length && !forced) return null;
    if (forced && cands.indexOf(forced) < 0 && (INSTR_META[forced] || role === "bass")) return forced;
    if (forced && cands.indexOf(forced) >= 0) return forced;
    var map = {};
    cands.forEach(function (n, i) {
      var meta = INSTR_META[n], w = 1.4 - i * 0.25;
      if (meta) {
        w *= Math.max(.12, 1.25 - 1.6 * Math.abs(meta.b - recipe.bright));
        if (taken && (role === "lead" || role === "arp")) { var tk = Array.isArray(taken) ? taken : [taken]; tk.forEach(function (x) { if (x && x.fam && meta.fam === x.fam) w *= 0.25; }); }
      }
      map[n] = Math.max(0.05, w);
    });
    return rng.weighted(map);
  }
  function makePalette(style, recipe, rng, forced) {
    forced = forced || {};
    var pal = {};
    pal.pad = pickInstrument("pad", style, recipe, rng, null, forced.pad);
    pal.comp = pickInstrument("comp", style, recipe, rng, null, forced.comp);
    pal.lead = pickInstrument("lead", style, recipe, rng, INSTR_META[pal.comp], forced.lead);
    pal.arp = pickInstrument("arp", style, recipe, rng, [INSTR_META[pal.lead], INSTR_META[pal.comp]], forced.arp);
    pal.bass = pickInstrument("bass", style, recipe, rng, null, forced.bass);
    /* a band: instruments chosen to belong together in this genre (null = that part sits out) */
    var bands = STYLES[style].bands, band = bands && bands.length ? bands[rng.int(bands.length)] : null;
    if (band) ["pad", "comp", "lead", "arp", "bass"].forEach(function (r) { if (band[r] !== undefined && !forced[r]) pal[r] = band[r]; });
    /* a second melodic voice that answers the lead and doubles it a third below in big sections */
    Object.keys(forced).forEach(function (r) { if (forced[r] === "none" && r !== "ans") pal[r] = null; });
    pal.ans = null; if (STYLES[style].solo) return pal;
    if (forced.ans) { pal.ans = forced.ans === "none" ? null : forced.ans; return pal; }
    if (band && band.ans !== undefined) { pal.ans = band.ans; return pal; }
    for (var tries = 0; tries < 8 && !pal.ans; tries++) { var c = pickInstrument("lead", style, recipe, rng, [INSTR_META[pal.lead], INSTR_META[pal.comp]], null); if (c !== pal.lead && c !== pal.comp && INSTR_META[c] && (tries > 5 || !INSTR_META[pal.lead] || INSTR_META[c].fam !== INSTR_META[pal.lead].fam)) pal.ans = c; }
    return pal;
  }
  function pickStyle(recipe, rng, forced) {
    if (forced && STYLES[forced]) return forced;
    var map = {}; for (var s in recipe.styles) map[s] = recipe.styles[s] * tasteWeight(s);
    return rng.weighted(map);
  }
  function makeTitle(mood, rng) {
    var w = MOOD_WORDS[mood] || MOOD_WORDS.neutral;
    return rng.pick(w[0]) + " " + rng.pick(w[1]);
  }
  /* the spec is everything the composer needs; it is decided once per piece from the brief and the seed */
  function resolveBrief(brief, seed) {
    var rng = makeRng(seed ^ 0x5bd1e995);
    var b = parseBrief(brief);
    var mood = b.mood;
    var intent = b.intent || (b.solo ? "match" : (mood === "sadness" || mood === "fear" || mood === "anger" || mood === "confusion") ? "lift" : "match");
    var journey = intent === "lift" ? LIFT[mood] : intent === "calm" ? CALMJ[mood] : [mood];
    if (!journey) journey = [mood];
    var stages = journey.map(function (m, i) {
      var recipe = RECIPES[m] || RECIPES.neutral;
      return { mood: m, recipe: recipe, bars: i === journey.length - 1 ? 1e9 : (b.stageBars || 24), style: null };
    });
    stages[0].style = pickStyle(stages[0].recipe, rng, b.style);
    /* later stages keep the style when it fits the new mood, otherwise pick one that does (a style the person named is kept throughout) */
    for (var i = 1; i < stages.length; i++) {
      var prev = stages[i - 1].style;
      stages[i].style = (b.style || stages[i].recipe.styles[prev]) ? prev : pickStyle(stages[i].recipe, rng, null);
    }
    var DRUM_STYLES = ["rock", "rocknroll", "funk", "jazz", "afrobeats", "afrobeat", "reggae", "hiphop", "amapiano", "blues", "pop", "country", "trap", "phonk"];
    if (b.drums) { var dst = (b.style && STYLES[b.style] && STYLES[b.style].drums) ? b.style : rng.pick(DRUM_STYLES); stages.forEach(function (sg) { sg.style = dst; }); }
    var recipe0 = stages[0].recipe;
    var forcedI = {}, sk; if (b.instruments) for (sk in b.instruments) forcedI[sk] = b.instruments[sk];
    if (b.solo) { var ss = SOLO_SETUP[b.solo]; for (sk in ss.f) forcedI[sk] = ss.f[sk]; }
    var mode = b.mode || rng.pick(recipe0.modes), sp0 = b.plan ? null : STYLES[stages[0].style].progs;
    if (sp0) { var fam = sp0.filter(function (q) { return q.m === mode; }); if (!fam.length) mode = rng.pick(sp0).m; }
    var root = b.key !== undefined ? b.key : rng.pick([0, 2, 3, 5, 7, 9, 9, 10, 2, 7]);
    return {
      seed: seed >>> 0, brief: b, mood: mood, intent: intent, stages: stages, mode: mode, root: root,
      forced: forcedI, solo: b.solo || "", drums: !!b.drums, bpmForce: b.bpm || 0, energyBias: typeof b.energy === "number" ? (b.energy - recipe0.energy) : 0,
      plan: b.plan || null, title: (b.plan && b.plan.title) ? b.plan.title : makeTitle(mood === "neutral" && stages.length > 1 ? stages[stages.length - 1].mood : mood, rng)
    };
  }

  /* ═══════════════ 4. composer ═══════════════
   * Turns a spec into an endless stream of bars. Each bar is { events, mix, bpm, ... } that the engine plays.
   * It is a rule-based "band": a theme (motif) that is developed, chord loops that change between sections,
   * layers that enter and leave with the energy arc, and registers kept apart so instruments do not clash.
   */
  var LEAD_CENTER = { vox: 69, hum: 64, ooh: 68, synthchoir: 68, flute: 74, kalimba: 76, bells: 84, cowbell: 72, mbira: 72, balafon: 66, whistle: 79, harmonica: 70, banjo: 72, mandolin: 76, steel: 70, fmpiano: 67, piano: 69, keys: 67, guitar: 66, marimba: 72, strings: 69, brass: 63, sax: 66, violin: 76, synth: 72, organ: 64, pluck: 70, pad: 66, choir: 66, eguitar: 68, dguitar: 60, lguitar: 72, hammond: 66, horns: 64, clav: 66 };
  var ARP_CENTER = { bells: 84, kalimba: 79, pluck: 74, banjo: 72, mandolin: 76, guitar: 70, piano: 74, synth: 76, marimba: 76, keys: 72, strings: 72 };
  /* comfortable range of each melodic instrument in MIDI notes (60 = middle C): the arranger and the critic use it so a tune is never written below or above what the instrument can say */
  var INSTR_RANGE = { piano: [36, 96], keys: [40, 92], organ: [36, 88], hammond: [36, 88], guitar: [40, 84], eguitar: [40, 86], lguitar: [45, 90], dguitar: [36, 76], pluck: [40, 96], harp: [36, 100], clav: [40, 88],
    kalimba: [60, 96], marimba: [48, 96], bells: [72, 108], cowbell: [60, 91], mbira: [52, 90], whistle: [60, 88], harmonica: [48, 86], banjo: [48, 88], mandolin: [55, 96], steel: [40, 88], fmpiano: [36, 96], balafon: [48, 84], strings: [36, 96], pad: [36, 90], choir: [48, 84], ooh: [52, 81], synthchoir: [48, 84], vox: [55, 81], hum: [52, 76],
    flute: [60, 96], brass: [40, 80], horns: [40, 82], sax: [49, 81], violin: [55, 100], synth: [36, 96] };
  function noteName(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
  var COMP_CENTER = { eguitar: 55, dguitar: 48, hammond: 58, horns: 60, clav: 66, lguitar: 60, guitar: 57, piano: 62, keys: 62, organ: 58, marimba: 64, strings: 58, pad: 58 };
  var BASS_LOW = { ebass: 28, upbass: 28, sub: 31, "808": 31, log: 36, pluck: 33, synthbass: 33 };
  var BASE_VEL = { pad: .55, comp: .7, lead: .85, arp: .55, bass: .9 };

  function Composer(brief, seed) {
    if (seed === undefined || seed === null) seed = (brief && typeof brief === "object" && brief.seed !== undefined) ? parseBrief(brief).seed : randomSeed();
    seed = seed >>> 0;
    var spec = resolveBrief(brief, seed);
    var rng = makeRng(seed);
    var S = { rootBase: spec.root, rootMod: 0, barNo: 0, stage: -1, stageStart: 0, mode: spec.mode, root: spec.root, bpm: 90, bpmTarget: 90, arcName: "groove", arcIdx: 0, sec: null, secBar: 0, secNo: 0,
              padV: null, compV: null, theme: null, progA: null, progB: null, cycle: 0, bias: spec.energyBias, steer: null,
              pal: null, style: null, styleName: "", recipe: null, tex: null, mask: {}, fixed: null, rub: 0 };
    var SOLO = spec.solo ? SOLO_SETUP[spec.solo] : null, PLAN = spec.plan || null;
    if (spec.drums) S.fixed = { pad: false, comp: false, lead: false, arp: false, bass: false };
    if (SOLO) S.fixed = SOLO.poly ? { drums: false, pad: false } : { drums: false, comp: false, arp: false, bass: false };
    var LAYER_KEYS = { drums: "drums", percussion: "drums", perc: "drums", beat: "drums", bass: "bass", bassline: "bass", pad: "pad", pads: "pad", strings: "pad", atmosphere: "pad", comp: "comp", chords: "comp", harmony: "comp", lead: "lead", melody: "lead", arp: "arp", arpeggio: "arp", sparkle: "arp", fx: "fx", effects: "fx", voice: "voice", voices: "voice", vocals: "voice", vocal: "voice", choir: "voice", singers: "voice" };
    var ROLES_SET = { pad: 1, comp: 1, lead: 1, arp: 1, bass: 1 };

    function chooseArc(style, recipe) {
      if (spec.drums) return "drums";
      if (style.arc === "reel") return "reel";
      if (style.arc === "sebene") return "sebene";
      if (style.arc === "ethereal") return rng.chance(.5) ? "ethereal" : "ethereal2";
      if (style.arc === "aria") return rng.chance(.5) ? "aria" : "aria2";
      if (style.arc === "solo") return "solo";
      if (style.arc === "song" || style.arc === "jazz") return style.arc;
      if (style.arc === "groove") return "groove";
      if (recipe.arc === "drift") return "drift";
      if (recipe.arc === "story" || style.arc === "story") return "story";
      return style.arc;
    }
    function computeBpm(style, recipe) {
      var lo = style.bpm[0], hi = style.bpm[1];
      var t = lerp((lo + hi) / 2, (recipe.bpm[0] + recipe.bpm[1]) / 2, style.firm ? .1 : 0.55);
      t = clamp(t, lo, hi) + rng.range(-2.5, 2.5);
      return Math.round(clamp(t, lo - 2, hi + 2));
    }
    function buildProg(degs) {
      return degs.map(function (d) { var kind = rng.weighted(S.recipe.ext); return { d: d, kind: kind, degs: chordDegs(d, kind) }; });
    }
    function buildAbs(seq) {
      return seq.map(function (c) { var q = c[1]; if (S.style.rootless && QUPG[q] && rng.chance(.5)) q = rng.pick(QUPG[q]); return absChord(c[0], q); });
    }
    function bridgeProg() { return S.style.progs ? buildAbs(rng.pick(S.progPool).seq) : buildProg(rng.pick(PROGS[S.mode])); }
    function makeProgs() {
      if (PLAN) { S.progA = S.progB = PLAN.sections[0].chords; S.progPool = []; S.planIdx = 0; S.mode = PLAN.mode; S.root = PLAN.key; return; }
      var sp = S.style.progs;
      if (sp) {
        var fam = sp.filter(function (q) { return q.m === S.mode; });
        if (!fam.length) { S.mode = rng.pick(sp).m; fam = sp.filter(function (q) { return q.m === S.mode; }); }
        var pa = rng.int(fam.length), pb2 = rng.int(fam.length); if (fam.length > 1 && pb2 === pa) pb2 = (pa + 1) % fam.length;
        S.progPool = fam; S.progA = buildAbs(fam[pa].seq); S.progB = buildAbs(fam[pa].b || fam[pb2].seq); return;
      }
      var pool = PROGS[S.mode], a = rng.int(pool.length), b = rng.int(pool.length);
      if (pool.length > 1 && b === a) b = (a + 1) % pool.length;
      S.progA = buildProg(pool[a]); S.progB = buildProg(pool[b]);
    }
    function textures() {
      var t = S.style.tex, o = { vinyl: t.vinyl, rain: t.rain, air: t.air };
      if (S.recipe === RECIPES.sadness || S.recipe === RECIPES.calm) o.rain += .1;
      if (S.recipe === RECIPES.fear || S.recipe === RECIPES.calm) o.air += .12;
      return o;
    }
    function enterStage(i, relative) {
      var st = spec.stages[i];
      S.stage = i; S.stageStart = S.barNo; S.recipe = st.recipe; S.styleName = st.style; S.style = PLAN ? Object.assign({}, STYLES[st.style], { harm: 1, progs: null }) : STYLES[st.style];
      if (relative && !S.style.progs && !PLAN) { var nm = rng.pick(st.recipe.modes); S.root = relativeRoot(S.root, S.mode, nm); S.mode = nm; }
      S.pal = makePalette(st.style, st.recipe, rng, spec.forced);
      S.jig = !!(S.style.jig && !PLAN && rng.chance(S.style.jig));
      S.waltz = S.jig || !!(S.style.waltz && !PLAN && rng.chance(S.style.waltz));
      S.bpmTarget = spec.bpmForce || computeBpm(S.style, st.recipe);
      if (S.style.bpmKinds && !PLAN && !spec.bpmForce) { var bk = rng.pick(S.style.bpmKinds); S.bpmTarget = rng.range(bk[0], bk[1]); }
      if (S.jig) { if (!spec.bpmForce) S.bpmTarget = rng.range(148, 170); } else if (S.waltz) S.bpmTarget = clamp(S.bpmTarget, 70, 92);
      if (S.barNo === 0) S.bpm = S.bpmTarget;
      S.arcName = chooseArc(S.style, st.recipe);
      S.arcIdx = (i === 0 || S.barNo === 0) ? (spec.skipIntro ? 1 : 0) : 1;   /* later stages skip the intro: the music is already playing */
      S.tex = textures();
      makeProgs(); S.theme = makeTheme(); S.lines = {}; S.riffs = {};
    }

    /* ── melody: one theme per piece/stage, developed bar by bar ── */
    function pickRhythm(feel, dens) {
      var set = S.jig ? "jig" : feel;
      if (dens > .62 && (feel === "synco" || feel === "medium" || feel === "straight") && rng.chance(.4)) set = "busy";
      return rng.pick(RHYTHMS[set] || RHYTHMS.medium).slice();
    }
    function walk(n, start) {
      var d = start, out = [], i;
      for (i = 0; i < n; i++) {
        out.push(d);
        var step = parseInt(rng.weighted({ "-1": 3, "1": 3, "2": 1.2, "-2": 1.2, "0": .6, "3": .4, "-3": .4 }), 10);
        if (d > 8) step = -Math.abs(step || 1); else if (d < 0) step = Math.abs(step || 1);
        d = clamp(d + step, -2, 10);
      }
      return out;
    }
    function makeTheme() {
      if (PLAN && PLAN.motif) {
        var mo = PLAN.motif, d1 = mo.deg.slice(), L2 = mo.on.length, sh2 = rng.pick([1, -1, 2]), mid = Math.floor(L2 / 2);
        d1[L2 - 1] += rng.pick([-2, -1, 1, 2]);
        return { m: [{ on: mo.on.slice(), deg: mo.deg.slice() }, { on: mo.on.slice(), deg: d1 }, { on: mo.on.slice(), deg: mo.deg.map(function (x) { return x + sh2; }) },
                     { on: [mo.on[0], mo.on[mid], mo.on[L2 - 1]], deg: [mo.deg[0], mo.deg[mid], rng.pick([0, 4, 0])] }] };
      }
      var feel = S.style.feel, dens = S.recipe.density;
      var r0 = pickRhythm(feel, dens), r2 = rng.chance(.5) ? r0.slice() : pickRhythm(feel, dens);
      var start = rng.pick([4, 2, 4, 5, 7]);
      /* a hook has a shape: rise and fall, a leap that steps back, a repeated note that jumps, a falling line... */
      var HOOKS = [[0, 1, 2, 1, 0, 1], [0, 2, 1, 0, -1, 0], [0, 0, 3, 2, 1, 0], [2, 1, 0, 1, 2, 2], [0, 2, 4, 2, 1, 0], [4, 3, 2, 0, 1, 0], [0, 1, 0, -1, 0, 2], [0, 0, 2, 2, 4, 3], [3, 2, 3, 1, 2, 0]];
      var shape = rng.pick(HOOKS), d0 = r0.map(function (x, j) { return start + (j < shape.length ? shape[j] : shape[shape.length - 1] - (j - shape.length + 1) * (rng.chance(.6) ? 1 : 0)); });
      d0 = d0.map(function (x) { return S.style.leadCap ? clamp(x, -1, 6) : clamp(x, -2, 10); });
      var m0 = { on: r0, deg: d0 };
      var d1 = d0.slice(), L = d1.length;
      d1[L - 1] += rng.pick([-2, -1, 1, 2]); if (L > 2) d1[L - 2] += rng.pick([-1, 1]);
      var m1 = { on: r0.slice(), deg: d1 };
      var sh = rng.pick([1, -1, 2, -2]);
      var m2 = { on: r2, deg: r2.length === r0.length && r2.join() === r0.join() ? d0.map(function (x) { return x + sh; }) : walk(r2.length, start + sh) };
      var r3 = r0.length > 3 ? [r0[0], r0[Math.floor(r0.length / 2)], r0[r0.length - 1]] : r0.slice();
      var d3 = walk(r3.length, start); d3[d3.length - 1] = rng.pick([0, 7, 2, 4]);
      return { m: [m0, m1, m2, { on: r3, deg: d3 }] };
    }
    function vary(m, amt) {
      var on = m.on.slice(), deg = m.deg.slice(), i, k;
      if (rng.chance(.45 * amt)) { var t = rng.pick([-2, -1, 1, 2]); deg = deg.map(function (x) { return x + t; }); }
      if (rng.chance(.35 * amt) && on.length > 2) { k = 1 + rng.int(on.length - 1); on[k] = clamp(on[k] + rng.pick([-1, 1]), 0, 15); }
      if (rng.chance(.3 * amt) && on.length > 3) { k = 1 + rng.int(on.length - 2); on.splice(k, 1); deg.splice(k, 1); }
      if (rng.chance(.35 * amt)) {
        for (i = 0; i < on.length - 1; i++) if (on[i + 1] - on[i] >= 3) { on.splice(i + 1, 0, on[i] + Math.floor((on[i + 1] - on[i]) / 2)); deg.splice(i + 1, 0, Math.round((deg[i] + deg[i + 1]) / 2)); break; }
      }
      if (rng.chance(.2 * amt)) { var d0 = deg[0]; deg = deg.map(function (x) { return d0 - (x - d0); }); }
      var pairs = on.map(function (s, j) { return { s: s, d: deg[j] }; }).sort(function (a, b) { return a.s - b.s; }), o = { on: [], deg: [] };
      pairs.forEach(function (p) { if (o.on.length && o.on[o.on.length - 1] === p.s) return; o.on.push(p.s); o.deg.push(p.d); });
      return o;
    }
    function leadC(n) { var c = LEAD_CENTER[n] || 70; return S.style && S.style.leadCap ? Math.min(c, S.style.leadCap) : c; }
    function leadOrigin() { var c = leadC(S.pal.lead); return placeInRange(S.root, c - 13, c - 2); }
    function chordRs(c) { return c.rs !== undefined ? c.rs : degSemi(S.mode, c.d); }
    function chordThird(c) { return c.abs ? c.abs[1] : (degSemi(S.mode, c.degs[1]) - degSemi(S.mode, c.degs[0])); }
    function chordPcs(chord) { return chord.abs ? chord.abs.map(function (x) { return (S.root + chord.rs + x) % 12; }) : chord.degs.map(function (d) { return (S.root + degSemi(S.mode, d)) % 12; }); }
    function lscale() { return (S.style.scales && S.style.scales[S.mode]) || MODES[S.mode]; }
    function ls(d) { var sc = lscale(), n = sc.length, o = Math.floor(d / n); return sc[d - o * n] + 12 * o; }
    function inChord(pcs, deg) { return pcs.indexOf((S.root + ls(deg)) % 12) >= 0; }
    function voice(chord, center, prev, spread, rootless) {
      if (chord.abs) { var semis = chord.abs.map(function (x) { return chord.rs + x; }); if (rootless && semis.length >= 4) semis = semis.slice(1); return voiceChord(S.mode, S.root, null, center, prev, Math.max(spread, 18), semis); }
      return voiceChord(S.mode, S.root, chord.degs, center, prev, spread);
    }
    function snapToChord(pcs, deg) {
      if (inChord(pcs, deg)) return deg;
      var order = rng.chance(.5) ? [-1, 1, -2, 2] : [1, -1, 2, -2];
      for (var i = 0; i < order.length; i++) if (inChord(pcs, deg + order[i])) return deg + order[i];
      return deg;
    }
    function fam(name) { var m = INSTR_META[name]; return m ? m.fam : "synth"; }

    /* plays the melody the composer wrote, exactly, with a player's touch: accents on the beat, an arch across the phrase, breath at phrase ends, small slides */
    function melBar(sec) {
      var out = [], bi = S.secBar % sec.melBars, notes = sec.mel[bi] || [], orig = leadOrigin(), lf = fam(S.pal.lead), artic = ARTIC[lf] || .8, v0 = BASE_VEL.lead * sec.dyn, glidy = lf !== "pluck" && lf !== "mallet" && lf !== "keys";
      var lift = (sec.lift && sec.loop > 0 && (sec.loop % 2) === 1) ? lscale().length : 0, pb = S.secBar % 4, prevM = null, n = lscale().length;
      for (var k = 0; k < notes.length; k++) {
        var nt = notes[k], deg = clamp(nt.deg + lift, -4, n * 2 + 2), nm = orig + ls(deg), phraseEnd = (bi === sec.melBars - 1 && k === notes.length - 1);
        var contour = .9 + .16 * Math.sin(Math.PI * (pb * 16 + nt.s) / 64), accent = nt.s % 4 === 0 ? 1 : nt.s % 2 === 0 ? .88 : .8;
        var d = Math.max(1, nt.len * artic * (phraseEnd ? 1.15 : .96 + rng() * .08));
        var ev = { s: nt.s, r: "lead", i: S.pal.lead, m: nm, d: d, v: v0 * accent * contour * (1 + (rng() - .5) * .1), p: 1 };
        if (glidy && prevM !== null && prevM !== nm && Math.abs(prevM - nm) <= 3 && nt.len >= 2 && rng.chance(.25)) ev.gl = prevM - nm;
        out.push(ev); prevM = nm;
        if (sec.dbl && S.pal.lead) out.push({ s: nt.s, r: "lead", i: sec.dbl.i, m: nm + sec.dbl.o, d: d, v: ev.v * (sec.dbl.o ? .55 : .5), p: 2, ans: 0 });
      }
      return out;
    }
    function leadBar(sec, chord, ci, cb) {
      var mode = sec.lead, out = [];
      if (!S.pal.lead) return out;
      if (sec.mel && mode !== "none") return melBar(sec);
      if (S.style.leadGen && (mode === "theme" || mode === "varied" || mode === "call")) return genLead(sec, chord, ci, cb, mode);
      if (SOLO && !SOLO.poly && (mode === "call" || (mode === "sparse" && sec.kind !== "intro" && sec.kind !== "bridge"))) mode = "theme";
      if (mode === "none") return out;
      var orig = leadOrigin(), pcs = chordPcs(chord), pb = S.secBar % 4, artic = ARTIC[fam(S.pal.lead)] || .8, v0 = BASE_VEL.lead * sec.dyn, harm = S.style.harm;
      if (mode === "sparse") {
        if ((cb % harm) !== 0 || !rng.chance(.78)) return out;
        var cands = [0, 2, 4, 7, 9].map(function (x) { return x + (rng.chance(.5) ? 0 : 0); }).filter(function (d) { return inChord(pcs, d) || d === 9; });
        /* the hook comes back: a verse or bridge quotes the opening of the theme (plain, a step higher, or turned upside down) instead of wandering */
        if (S.theme && S.theme.m && S.theme.m[0] && rng.chance(.6)) {
          var th = S.theme.m[0], nq = Math.min(th.on.length, rng.chance(.4) ? 4 : 3), form = /^(bridge|break|breath|drift|release)$/.test(sec.kind) ? "inv" : (Math.floor(S.secBar / 4) % 2 === 1 ? "seq" : "plain"), d0q = th.deg[0], qk, anyQ = false, qOut = [];
          for (qk = 0; qk < nq; qk++) {
            var stq = th.on[qk]; if (stq > 11) break;
            var dg = th.deg[qk]; if (form === "inv") dg = d0q - (dg - d0q) + 1; else if (form === "seq") dg = dg + 1;
            if (stq % 4 === 0) dg = snapToChord(pcs, dg);
            dg = clamp(dg, -3, lscale().length * 2);
            var nxq = qk < nq - 1 ? th.on[qk + 1] : stq + 4, lq = Math.max(1, Math.min(nxq - stq, 6)) * (form === "inv" ? 1.4 : 1);
            qOut.push({ s: stq, r: "lead", i: S.pal.lead, m: orig + ls(dg), d: Math.max(1, Math.min(lq * .95, 15.5 - stq)), v: v0 * .85, p: 1 }); anyQ = true;
          }
          if (anyQ) { S.lastLead = { m: qOut[qOut.length - 1].m, sec: S.secNo }; return qOut; }
        }
        var cl = cands.length ? cands : [4];
        if (S.lastLead && S.lastLead.sec === S.secNo) { var lm = S.lastLead.m; cl = cl.slice().sort(function (x, y) { return Math.abs(orig + ls(x) - lm) - Math.abs(orig + ls(y) - lm); }).slice(0, 2); }
        var deg = rng.pick(cl), s = rng.pick([0, 2, 4]);
        out.push({ s: s, r: "lead", i: S.pal.lead, m: orig + ls(deg), d: Math.min(harm * 16 - s - 2, 14), v: v0 * .9, p: 1 });
        S.lastLead = { m: orig + ls(deg), sec: S.secNo };
        if (rng.chance(.35)) out.push({ s: s + 8, r: "lead", i: S.pal.lead, m: orig + ls(deg + rng.pick([-1, 1, 2])), d: 5, v: v0 * .75, p: 1 });
        return out;
      }
      if (mode === "call" && (pb % 2) === 1) return out;
      var m = S.theme.m[pb];
      if (mode === "varied") m = vary(m, 1);
      else if (sec.loop > 0 || S.cycle > 0) m = vary(m, .5);
      var lift = (sec.lift && (sec.loop % 2) === 1) ? 7 : 0, n = m.on.length, atPhraseEnd = (pb === 3), halfEnd = (pb === 1), prevM = null;
      var lf = fam(S.pal.lead), glidy = lf !== "pluck" && lf !== "mallet" && lf !== "keys";
      var rich = !!(S.pal.ans && sec.layers.ans && (sec.kind === "chorus" || sec.kind === "drop" || sec.kind === "climax" || sec.kind === "swell"));
      for (var k = 0; k < n; k++) {
        var step = m.on[k], deg2 = m.deg[k] + lift;
        if (step % 4 === 0) deg2 = snapToChord(pcs, deg2);
        if (k === n - 1) {
          if (atPhraseEnd && cb >= sec.loopLen - S.style.harm) deg2 = pickStable(pcs, deg2, [0, 7, 14, 2, 4]);
          else if (halfEnd || atPhraseEnd) deg2 = snapToChord(pcs, deg2);
        }
        deg2 = clamp(deg2, -3, lscale().length * 2);
        var next = k < n - 1 ? m.on[k + 1] : 16, len = next - step;
        if (k === n - 1) len = Math.min(8, 16 - step);
        var legato = (k === n - 1 && atPhraseEnd) ? 1.12 : .95 + rng() * .1;
        var d = Math.max(1, Math.min(len, 12) * artic * legato);
        if (k === n - 1 && atPhraseEnd && rng.chance(.25)) continue;
        /* voice leading: the first note of a bar starts near where the last bar ended (an octave away in the scale is the same note), so the tune flows instead of jumping */
        if (prevM === null && S.lastLead && S.lastLead.sec === S.secNo) {
          var dist0 = Math.abs(orig + ls(deg2) - S.lastLead.m), per = lscale().length, sh, bestD = deg2;
          if (dist0 > 7) for (sh = -1; sh <= 1; sh += 2) { var d3 = deg2 + sh * per; if (d3 >= -3 && d3 <= per * 2 && Math.abs(orig + ls(d3) - S.lastLead.m) < Math.abs(orig + ls(bestD) - S.lastLead.m)) bestD = d3; }
          deg2 = bestD;
        }
        var nm = orig + ls(deg2), contour = .9 + .16 * Math.sin(Math.PI * (pb * 16 + step) / 64);
        var evn = { s: step, r: "lead", i: S.pal.lead, m: nm, d: d, v: v0 * (step % 4 === 0 ? 1 : .82) * contour * (1 + (rng() - .5) * .12), p: 1 };
        /* a player slides between close notes and sometimes pushes into a note from beside it */
        if (glidy && prevM !== null && prevM !== nm && Math.abs(prevM - nm) <= 4 && rng.chance(.35)) evn.gl = prevM - nm;
        else if (step > 0 && step % 4 === 0 && len >= 3 && rng.chance(.09)) out.push({ s: step - .45, r: "lead", i: S.pal.lead, m: lo56(orig + ls(deg2 + rng.pick([-1, 1]))), d: .5, v: evn.v * .45, p: 3 });
        out.push(evn); prevM = nm;
        if (rich && step % 4 === 0 && rng.chance(.7)) out.push({ s: step, r: "lead", i: S.pal.ans, m: lo56(orig + ls(deg2 - 2)), d: d, v: evn.v * .55, p: 2, ans: 1 });
      }
      if (prevM !== null) S.lastLead = { m: prevM, sec: S.secNo };
      return out;
    }
    function lo56(x) { return x < 56 ? x + 12 : x; }
    /* the second voice answers the lead's call: on the bars where the lead rests, it plays the cadence of the theme a step lower */
    function answerBar(sec, chord, pb) {
      var out = []; if (!S.pal.ans || !sec.layers.ans || sec.mel || sec.lead !== "call" || (pb % 2) !== 1 || S.style.leadGen) return out;
      var pcs = chordPcs(chord), mm = S.theme.m[pb === 1 ? 3 : 2], c = LEAD_CENTER[S.pal.ans] || 66, orig = placeInRange(S.root, c - 14, c - 3);
      var v0 = BASE_VEL.lead * sec.dyn * .7, art = ARTIC[fam(S.pal.ans)] || .8, half = Math.max(2, Math.ceil(mm.on.length * .7));
      for (var k = 0; k < half && k < mm.on.length; k++) {
        var step = mm.on[k]; if (step > 12) break;
        var deg = mm.deg[k] - 1; if (step % 4 === 0) deg = snapToChord(pcs, deg); deg = clamp(deg, -3, lscale().length * 2);
        var nx = k < half - 1 ? mm.on[k + 1] : Math.min(16, step + 5);
        out.push({ s: step, r: "lead", i: S.pal.ans, m: lo56(orig + ls(deg)), d: Math.max(1, Math.min(nx - step, 8) * art), v: v0 * (1 + (rng() - .5) * .1), p: 2, ans: 1 });
      }
      return out;
    }

    /* ── genre lead generators: blues licks and bebop lines ── */
    var BLUES_ON = [[0, 3, 6], [0, 2, 4, 6], [0, 4, 6, 8], [0, 3, 4, 8, 11], [2, 4, 6, 8, 10], [0, 2, 4, 6, 8, 10, 12, 14], [0, 3, 6, 10, 12], [0, 2, 4, 8], [4, 6, 8, 12, 14], [0, 4, 8, 10, 12]];
    var SWING_ON = [[0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 4, 6, 8, 10], [2, 4, 6, 8, 10, 12, 14], [0, 4, 6, 8, 12, 14], [0, 2, 6, 8, 10, 14], [0, 2, 4, 8, 10, 12, 14]];
    function makeLick(pb, dens) {
      var on = rng.pick(dens > .9 ? BLUES_ON.slice(4, 6).concat(BLUES_ON.slice(8)) : BLUES_ON).slice(), i = rng.pick([4, 5, 6, 7, 8]), ix = [];
      for (var k = 0; k < on.length; k++) { ix.push(i); i = clamp(i + parseInt(rng.weighted({ "-1": 4, "1": 2.2, "-2": 2, "2": 1, "0": .8, "-3": .6 }), 10), 0, 11); }
      if (pb === 3) ix[ix.length - 1] = rng.pick([0, 6, 4]);
      return { on: on, ix: ix };
    }
    function makeLine(pb, dens) {
      var on = rng.pick(SWING_ON).filter(function (s2, j) { return j === 0 || rng.chance(.55 + dens * .4); }), i = rng.pick([3, 4, 5, 6]), dir = rng.chance(.5) ? 1 : -1, ix = [];
      for (var k = 0; k < on.length; k++) {
        if (on[k] % 4 === 0) { var m = ((i % 7) + 7) % 7; if (m % 2 === 1) i += dir; }
        ix.push(i); i += dir * (rng.chance(.72) ? 1 : 2); if (rng.chance(.22) || i > 11 || i < 0) dir = -dir; i = clamp(i, 0, 12);
      }
      if (pb === 3) { var l = ((ix[ix.length - 1] % 7) + 7) % 7; ix[ix.length - 1] += rng.pick([0, 2, 4]) - (l % 2 ? 1 : 0) * 0; }
      return { on: on, ix: ix };
    }
    function genLead(sec, chord, ci, cb, mode) {
      var out = [], pb = S.secBar % 4, kind = S.style.leadGen;
      if (mode === "call" && (pb % 2) === 1) return out;
      var key = (mode === "varied" ? "v" : sec.kind) + pb + (mode === "call" ? "c" : ""), ln = mode === "varied" ? null : S.lines[key];
      if (!ln) { ln = kind === "blues" ? makeLick(pb, mode === "varied" ? 1 : sec.e) : makeLine(pb, mode === "varied" ? 1 : sec.e); if (mode !== "varied") S.lines[key] = ln; }
      var c = leadC(S.pal.lead), v0 = BASE_VEL.lead * sec.dyn, art = ARTIC[fam(S.pal.lead)] || .9, n = ln.on.length, k, base, sc;
      if (kind === "blues") { sc = lscale(); base = placeInRange(S.root, c - 12, c - 1); }
      else { sc = (chord.q && QSCALE[chord.q]) || MODES.ionian; base = placeInRange((S.root + chordRs(chord)) % 12, c - 12, c - 1); }
      var lift = (sec.lift && (sec.loop % 2) === 1 && !S.style.leadCap) ? 12 : 0;
      for (k = 0; k < n; k++) {
        var st = ln.on[k], ix = ln.ix[k], len = (k < n - 1 ? ln.on[k + 1] : Math.min(16, st + 6)) - st, o = Math.floor(ix / sc.length), m = base + sc[ix - o * sc.length] + 12 * o + lift;
        var ev = { s: st, r: "lead", i: S.pal.lead, m: m, d: Math.max(1, Math.min(len, 8) * art * (k === n - 1 ? 1.1 : .96)), v: v0 * (st % 4 === 0 ? 1 : .84) * (1 + (rng() - .5) * .12), p: 1 };
        if (kind === "blues" && S.pal.lead === "lguitar" && len >= 3 && rng.chance(.34)) ev.gl = -rng.pick([1, 2, 2]);
        if (kind === "bebop" && st > 0 && st % 4 === 0 && rng.chance(.18)) out.push({ s: st - .5, r: "lead", i: S.pal.lead, m: m - 1, d: .5, v: ev.v * .5, p: 3 });
        out.push(ev);
      }
      return out;
    }
    function pickStable(pcs, deg, targets) {
      var best = deg, bd = 99;
      for (var i = 0; i < targets.length; i++) { var t = targets[i], dist = Math.abs(t - deg); if (dist < bd && inChord(pcs, t)) { bd = dist; best = t; } }
      return best;
    }

    /* ── accompaniment ── */
    function padBar(sec, chord, chordStart) {
      if (!chordStart || !S.pal.pad) return [];
      var out = [], v = S.padV, harm = S.style.harm;
      for (var i = 0; i < v.length; i++) out.push({ s: 0, r: "pad", i: S.pal.pad, m: v[i], d: harm * 16 - 1, v: BASE_VEL.pad * sec.dyn * (SOLO ? .5 : 1), p: 1 });
      return out;
    }
    function compPat(sec, chord, cb) {
      var out = [], pats = S.style.comp, pat = pats[sec.compVar % pats.length], v = S.compV, i, s;
      if (!sec.layers.comp || !pat) return out;
      var art = ARTIC[fam(S.pal.comp)] || .8, base = BASE_VEL.comp * sec.dyn;
      if (S.style.pick) {
        var tones = [v[0] - 12].concat(v);
        for (s = 0; s < 16; s++) {
          var ch = pat.charAt(s); if (ch < "0" || ch > "9") continue;
          var idx = parseInt(ch, 10) % tones.length;
          out.push({ s: s, r: "comp", i: S.pal.comp, m: tones[idx], d: 3, v: base * (s % 4 === 0 ? 1 : .78) * (1 + (rng() - .5) * .14), p: 2 });
        }
        return out;
      }
      var hits = []; for (s = 0; s < 16; s++) if (pat.charAt(s) === "x") hits.push(s);
      var strummed = fam(S.pal.comp) === "pluck", spread = strummed ? .14 : .055;
      for (var h = 0; h < hits.length; h++) {
        var L = (h < hits.length - 1 ? hits[h + 1] : 16) - hits[h], d = S.style.chop ? S.style.chop : Math.max(1, Math.min(L, 8) * art + (fam(S.pal.comp) === "keys" ? 1 : 0)), up = strummed && (h % 2 === 1);
        for (i = 0; i < v.length; i++) { var ii = up ? v.length - 1 - i : i; out.push({ s: hits[h] + i * spread, r: "comp", i: S.pal.comp, m: v[ii], d: d, v: base * (hits[h] % 4 === 0 ? 1 : .8) * (up ? .88 : 1) * (strummed ? (up ? .82 + .18 * i / Math.max(1, v.length - 1) : 1 - .18 * i / Math.max(1, v.length - 1)) : 1) * (1 + (rng() - .5) * .14), p: 2 }); }
      }
      for (s = 0; s < 16; s++) if (pat.charAt(s) === "g") for (i = Math.max(0, v.length - 2); i < v.length; i++) out.push({ s: s, r: "comp", i: S.pal.comp, m: v[i], d: .6, v: base * .32 * (1 + (rng() - .5) * .3), p: 3 });
      return out;
    }
    function compBar(sec, chord, cb) {
      if (!S.pal.comp || !sec.layers.comp) return [];
      var gens = S.style.compGen, gen = gens ? gens[sec.compVar % gens.length] : "pat";
      if (gen === "chuck") return chuckBar(sec, chord);
      if (gen === "power") return powerBar(sec, chord);
      if (gen === "riff") return riffBar(sec, chord);
      if (gen === "skank") return skankBar(sec);
      return compPat(sec, chord, cb);
    }
    function lowRoot(chord) { return placeInRange((S.root + chordRs(chord)) % 12, 40, 51); }
    /* rock and roll rhythm guitar / boogie piano: the alternating "5 to 6" shape on every eighth note */
    function chuckBar(sec, chord) {
      var out = [], rootM = lowRoot(chord) + (S.pal.comp === "piano" ? 12 : 0), shapes = [[0, 7], [0, 9], [0, 7], [0, 10]], base = BASE_VEL.comp * sec.dyn;
      for (var j = 0; j < 8; j++) { var st = j * 2, sh = shapes[j % 4]; for (var q = 0; q < sh.length; q++) out.push({ s: st, r: "comp", i: S.pal.comp, m: rootM + sh[q], d: 1.8, v: base * (st % 4 === 0 ? 1 : .8) * (1 + (rng() - .5) * .14), p: 2 }); }
      return out;
    }
    /* hard rock power chords: sustained hits and palm-muted chugs */
    function powerBar(sec, chord) {
      var out = [], rootM = lowRoot(chord), pats = ["x...x...x...x...", "x.xxx.xxx.xxx.xx", "x.x.x.x.x.x.x.x.", "x..x..x.x..x..x."], pi = sec.compVar % pats.length, pat = pats[pi], base = BASE_VEL.comp * sec.dyn;
      for (var s2 = 0; s2 < 16; s2++) {
        if (pat.charAt(s2) !== "x") continue;
        var sus = pi === 0, d = sus ? 3.8 : (s2 % 4 === 0 ? 1.5 : 1.0), vv = base * (s2 % 4 === 0 ? 1 : .72) * (1 + (rng() - .5) * .12);
        [0, 7, 12].forEach(function (x) { out.push({ s: s2, r: "comp", i: S.pal.comp, m: rootM + x, d: d, v: vv, p: x === 12 ? 3 : 2 }); });
      }
      return out;
    }
    var RIFF_R = [[0, 3, 6, 8, 11, 14], [0, 2, 4, 6, 8, 10, 12, 14], [0, 3, 4, 8, 11, 12], [0, 2, 3, 6, 8, 10, 11], [0, 1, 3, 6, 8, 9, 11, 14]];
    function riffBar(sec, chord) {
      var out = [], rf = S.riffs[sec.kind];
      if (!rf) { var on = rng.pick(RIFF_R).slice(), sc = lscale(), iv = on.map(function (x, j) { return j === 0 || rng.chance(.4) ? 0 : rng.pick(sc); }); rf = S.riffs[sec.kind] = { on: on, iv: iv }; }
      var rootM = lowRoot(chord), base = BASE_VEL.comp * sec.dyn;
      for (var k = 0; k < rf.on.length; k++) {
        var st = rf.on[k], nx = k < rf.on.length - 1 ? rf.on[k + 1] : 16, d = Math.max(1, (nx - st) * .8), vv = base * (st % 4 === 0 ? 1.05 : .8), m = rootM + rf.iv[k];
        out.push({ s: st, r: "comp", i: S.pal.comp, m: m, d: d, v: vv, p: 2 });
        if (rf.iv[k] === 0 && st % 4 === 0) out.push({ s: st, r: "comp", i: S.pal.comp, m: m + 7, d: d, v: vv * .9, p: 3 });
      }
      return out;
    }
    /* reggae: the guitar chops the off-beat, short and dry */
    function skankBar(sec) {
      var out = [], pat = S.style.comp[0], v = S.compV, base = BASE_VEL.comp * sec.dyn * .95, top = v.slice(-3);
      for (var s2 = 0; s2 < 16; s2++) if (pat.charAt(s2) === "x") for (var i = 0; i < top.length; i++) out.push({ s: s2 + i * .03, r: "comp", i: S.pal.comp, m: top[i], d: S.style.chop || 1.2, v: base * (1 + (rng() - .5) * .1), p: 2 });
      return out;
    }
    function stabBar(sec) {
      var out = [], pats = S.style.stab, pat = pats[sec.compVar % pats.length], v = S.compV.slice(), mean = 0, i, s2;
      for (i = 0; i < v.length; i++) mean += v[i]; mean /= v.length; var sh = Math.round(((LEAD_CENTER[S.pal.arp] || 62) - mean) / 12) * 12; v = v.map(function (x) { return x + sh; });
      for (s2 = 0; s2 < 16; s2++) if (pat.charAt(s2) === "x") for (i = 0; i < v.length; i++) out.push({ s: s2, r: "arp", i: S.pal.arp, m: v[i], d: 2.2, v: BASE_VEL.arp * sec.dyn * 1.15 * (s2 % 4 === 0 ? 1 : .85), p: 2 });
      return out;
    }
    function arpBar(sec) {
      var cfg = S.style.arp, out = [], i;
      if (!sec.layers.arp || !S.pal.arp) return out;
      if (S.style.stab) return stabBar(sec);
      var base = S.compV.slice(), tones = base.concat(base.map(function (x) { return x + 12; })).sort(function (a, b) { return a - b; });
      var c = ARP_CENTER[S.pal.arp] || 74, mean = 0; for (i = 0; i < tones.length; i++) mean += tones[i]; mean /= tones.length;
      var shift = Math.round((c - mean) / 12) * 12; tones = tones.map(function (x) { return x + shift; });
      var kinds = ["up", "updown", "alberti", "rand"], kind = ((S.secBar % 8) < 4) ? cfg.kind : (rng.chance(.5) ? cfg.kind : rng.pick(kinds));
      var n = tones.length, k = 0, rate = cfg.rate, gate = cfg.gate * (.55 + .45 * sec.e), art = ARTIC[fam(S.pal.arp)] || .6;
      for (var s = 0; s < 16; s += rate) {
        var idx;
        if (kind === "up") idx = k % n;
        else if (kind === "updown") { var cyc = Math.max(1, 2 * (n - 1)), q = k % cyc; idx = q < n ? q : cyc - q; }
        else if (kind === "alberti") idx = [0, 2, 1, 2][k % 4] % n;
        else idx = rng.int(n);
        k++;
        if (!rng.chance(gate)) continue;
        out.push({ s: s, r: "arp", i: S.pal.arp, m: tones[idx], d: Math.max(1, rate * art * 1.6), v: BASE_VEL.arp * sec.dyn * (s % 4 === 0 ? 1 : .72) * (1 + (rng() - .5) * .16), p: 3, pan: (rng() - .5) * 1.1 });
      }
      return out;
    }
    function bassGenBar(g, chord, nextChord, rootM, nextM, vb, lastOfChord, cb, harm) {
      var out = [], third = chordThird(chord), inst = S.pal.bass, sameRoot = chordRs(chord) === chordRs(nextChord);
      function ev(s2, m, d, v) { out.push({ s: s2, r: "bass", i: inst, m: m, d: d, v: vb * v, p: 1 }); }
      function approach() { return sameRoot ? rootM + rng.pick([7, 5, 4]) : nextM + (nextM - rootM >= 3 ? -1 : (rng.chance(.5) ? -1 : 1)); }
      var j;
      if (g === "boogie") {
        var P = ((S.secBar % 8) < 4 || rng.chance(.3)) ? [0, third, 7, 9, 10, 9, 7, third] : [0, 0, 7, 7, 9, 9, 10, 7];
        for (j = 0; j < 8; j++) ev(j * 2, rootM + P[j] - (P[j] > 9 ? 0 : 0), 1.9, j % 2 === 0 ? 1 : .8);
        if (lastOfChord && !sameRoot && rng.chance(.5)) { out.pop(); ev(14, approach(), 1.9, .85); }
      } else if (g === "walk") {
        var n2 = rootM + rng.pick([third, 7, 2, third]), n3 = rootM + rng.pick([7, third, 9, 12]); if (n3 === n2) n3 = rootM + 7;
        var n4 = lastOfChord ? approach() : rootM + rng.pick([5, 7, 9]);
        ev(0, rootM, 3.7, 1); ev(4, n2, 3.7, .8); ev(8, n3, 3.7, .85); ev(12, n4, 3.7, .82);
        if (rng.chance(.12)) ev(13.5, n4 + (n4 > n3 ? -1 : 1), 1, .4);
      } else if (g === "root8") {
        for (j = 0; j < 8; j++) { var m = rootM; if (j % 4 === 3 && rng.chance(.3)) m = rootM + 12; else if (j === 5 && rng.chance(.25)) m = rootM + 7; ev(j * 2, m, 1.7, j % 2 === 0 ? 1 : .8); }
        if (lastOfChord && !sameRoot && rng.chance(.4)) { out.pop(); ev(14, approach(), 1.7, .85); }
      } else {
        ev(0, rootM, 3.6, 1); ev(4, rootM + 7, 3.6, .8); ev(8, rootM, 3.6, .9); ev(12, lastOfChord && !sameRoot ? approach() : rootM + (rng.chance(.5) ? 7 : 12), 3.6, .8);
      }
      return out;
    }
    /* plays the bass line the composer wrote: chord-relative tones, locked to the bar, with the weight on the downbeat and a push into the next chord */
    function bassLineBar(sec, chord, rootM, nextM, vb) {
      var out = [], notes = sec.bl[S.secBar % sec.blBars] || [], third = chordThird(chord), bp = S.pal.bass, glideOk = bp === "synthbass" || bp === "sub" || bp === "808" || bp === "log", prevN = null, max = Math.max(4, S.style.bassMax || 16);
      for (var k = 0; k < notes.length; k++) {
        var nt = notes[k], t = nt.t, note;
        if (t === "a" || t === "a-" || t === "a+") note = t === "a+" ? nextM + 1 : t === "a-" ? nextM - 1 : (nextM > rootM ? nextM - 1 : nextM + 1);
        else if (t === "3" || t === "b3") note = rootM + third; else note = rootM + BASS_TONES[t];
        if (note > rootM + 14) note -= 12;
        var ev = { s: nt.s, r: "bass", i: S.pal.bass, m: note, d: Math.max(1, Math.min(nt.len, max) * .92), v: vb * (nt.s === 0 ? 1 : nt.s % 4 === 0 ? .88 : .78) * (1 + (rng() - .5) * .08), p: 1 };
        if (glideOk && prevN !== null && note !== prevN && Math.abs(note - prevN) <= 5 && nt.len >= 2 && rng.chance(.15)) ev.gl = prevN - note;
        out.push(ev); prevN = note;
      }
      return out;
    }
    function bassBar(sec, chord, nextChord, cb) {
      var out = [], gens = S.style.bassGen || [], pats = S.style.bass.concat(BASS_ALT[S.styleName] || []), harm = S.style.harm;
      if (!sec.layers.bass || !S.pal.bass) return out;
      var lo = BASS_LOW[S.pal.bass] || 33, rootPc = (S.root + chordRs(chord)) % 12, rootM = placeInRange(rootPc, lo, lo + 11);
      var nextPc = (S.root + chordRs(nextChord)) % 12, nextM = placeInRange(nextPc, rootM - 6, rootM + 5);
      var lastOfChord = (cb % harm) === harm - 1, vb = BASE_VEL.bass * sec.dyn, max = S.style.bassMax;
      if (sec.bl) return bassLineBar(sec, chord, rootM, nextM, vb);
      var total = gens.length + pats.length, pick = sec.bassVar % total;
      if (pick < gens.length) return bassGenBar(gens[pick], chord, nextChord, rootM, nextM, vb, lastOfChord, cb, harm);
      var pat = pats[pick - gens.length], third = chordThird(chord);
      if (max >= 16 && pat.length === 16 && pat.replace(/\./g, "").length === 1) {
        if ((cb % harm) === 0) out.push({ s: 0, r: "bass", i: S.pal.bass, m: rootM, d: harm * 16 - 1, v: vb, p: 1 });
        return out;
      }
      var steps = []; for (var s = 0; s < 16; s++) if (pat.charAt(s) !== ".") steps.push(s);
      var bp = S.pal.bass, glideOk = bp === "synthbass" || bp === "sub" || bp === "808" || bp === "log", prevN = null;
      for (var j = 0; j < steps.length; j++) {
        var st = steps[j], ch = pat.charAt(st), note = rootM;
        if (ch === "5") note = rootM + 7; else if (ch === "o") note = rootM + 12; else if (ch === "b") note = rootM + 10; else if (ch === "3") note = rootM + third; else if (ch === "6") note = rootM + 9;
        else if (ch === "a") note = lastOfChord ? (nextM > rootM ? nextM - 1 : nextM + 1) : rootM + 7;
        var len = (j < steps.length - 1 ? steps[j + 1] : 16) - st;
        var evb = { s: st, r: "bass", i: S.pal.bass, m: note, d: Math.max(1, Math.min(len, max) * .92), v: vb * (j === 0 ? 1 : .82), p: 1 };
        if (glideOk && prevN !== null && note !== prevN && Math.abs(note - prevN) <= (bp === "808" || bp === "log" ? 7 : 5) && rng.chance(bp === "808" ? (S.style.grit ? .38 : .22) : bp === "log" ? .3 : .1)) evb.gl = prevN - note;
        out.push(evb); prevN = note;
      }
      return out;
    }

    function jazzDrums(out, hit, sec, level, firstBar, lastBar, pb) {
      var e = sec.e, dyn = sec.dyn, i, ride = "x...x.x.x...x.x.", soft = level === 1 ? .7 : 1;
      for (i = 0; i < 16; i++) if (ride.charAt(i) === "x") { if ((i === 6 || i === 14) && rng.chance(.1)) continue; hit(i, "perc", "ride", (i % 4 === 0 ? .62 : .44) * soft * (.75 + .3 * dyn), i === 0 && rng.chance(.15) ? { bell: 1 } : null); }
      hit(4, "perc", "chick", .5 * soft); hit(12, "perc", "chick", .5 * soft);
      if (rng.chance(.55)) hit(0, "drums", "kick", .22 * soft);
      if (rng.chance(.35)) hit(8, "drums", "kick", .2 * soft);
      if (level > 1 && rng.chance(.3 * (.5 + e))) hit(rng.pick([3, 7, 10, 11, 14]), "drums", "kick", .5);
      var nsn = 0, cand = [3, 6, 7, 10, 11, 14, 15], q; for (q = 0; q < cand.length; q++) if (level > 1 && nsn < 2 && rng.chance(.16 * (.6 + e))) { hit(cand[q], "drums", "snare", .22 + rng() * .2); nsn++; }
      if (sec.tpl.fill && pb === 3 && !(level === 1) && (lastBar || rng.chance(.5))) {
        out = out.filter(function (ev) { return !(ev.s >= 12 && ev.k !== "crash" && ev.r !== "fx"); });
        hit(12, "perc", "ride", .5); hit(12, "drums", "snare", .5); hit(13.33, "drums", "snare", .45); hit(14, "drums", "tom", .6, { n: 1 }); hit(14.67, "drums", "tom", .6, { n: 2 }); hit(15, "drums", "kick", .6);
      }
      return out;
    }
    /* ── drums ── */
    function drumBar(sec, firstBar, lastBar) {
      var dOnly = !!spec.drums, D = S.style.drum, out = [], alts = DRUM_ALT[S.styleName], av = alts ? (sec.drumVar + (dOnly ? Math.floor(S.secBar / 4) : 0)) % (alts.length + 1) : 0;
      if (av > 0) { var D2 = {}, dk; for (dk in D) D2[dk] = D[dk]; for (dk in alts[av - 1]) D2[dk] = alts[av - 1][dk]; D = D2; }
      var gv = sec.gv ? (((S.secBar % 2) === 1 && sec.gv.b) ? sec.gv.b : sec.gv.a) : null;
      if (gv) { var D3 = {}, gk; for (gk in GROOVE_KEYS) D3[gk] = gv[gk] || ""; D3.rimV = D.rimV !== undefined && gv.rim ? D.rimV : .6; D = D3; }
      var _u = [], level = sec.layers.drums, i, s, e = sec.e;
      var dyn = sec.dyn, pb = S.secBar % 4, endOfGroup = (pb === 3);
      function hit(step, r, k, v, extra) { var o = { s: step, r: r, k: k, v: Math.min(1, v * (1 + (rng() - .5) * .14)), p: (r === "perc" ? 3 : 1) }; if (extra) for (var q in extra) o[q] = extra[q]; out.push(o); }
      function pattern(str, r, k, vel, filter) {
        if (!str) return;
        for (var st = 0; st < 16; st++) {
          var c = str.charAt(st); if (c === "." || (filter && !filter(st))) continue;
          var acc = c === "o" ? .42 : c === "X" ? 1.08 : (st % 4 === 0 ? 1 : st % 2 === 0 ? .82 : .64);
          hit(st, r, k, vel * acc, r === "perc" ? { pan: (st % 4 < 2 ? -1 : 1) * .3 } : null);
        }
      }
      if (sec.tpl.crash && firstBar && level > 0) hit(0, "drums", "crash", .62 * dyn + .2);
      if (sec.tpl.riser && firstBar) out.push({ s: 0, r: "fx", k: "riser", d: sec.bars * 16, v: .5, p: 2 });
      if ((sec.kind === "drop" || sec.kind === "climax") && firstBar) out.push({ s: 0, r: "fx", k: "impact", v: (S.styleName === "cinematic" || S.arcName === "story") ? .8 : .42, p: 1 });
      if (dOnly && level > 0 && level < 3) level = 2;
      if (level <= 0) return out;
      if (S.style.drumGen === "jazz" && level < 3 && !gv) return jazzDrums(out, hit, sec, level, firstBar, lastBar, pb);
      var inBuild = level === 3 && !(dOnly && S.secBar < sec.bars - 2);
      if (inBuild) {
        var bb = S.secBar, last2 = sec.bars - 2;
        if (bb >= last2) {
          var fine = bb === sec.bars - 1, stepGap = fine ? 1 : 2, total = fine ? 16 : 8, idx2 = 0;
          for (s = 0; s < 16; s += stepGap) { idx2++; hit(s, "drums", "snare", (fine ? .45 : .3) + .5 * (idx2 / total) * (fine ? 1 : .7)); }
        } else { pattern(D.hat, "perc", "hat", .5 * dyn); }
        if (bb < sec.bars - 1) pattern(D.kick, "drums", "kick", .95, function (st) { return st % 8 === 0; });
        return out;
      }
      var light = level === 1;
      var kf = light ? function (st) { return st === 0 || (S.styleName === "house" && st % 4 === 0); } : null;
      pattern(D.kick, "drums", "kick", 1.0, kf);
      if (!light) { pattern(D.snare, "drums", "snare", .85); pattern(D.clap, "drums", "clap", .8); }
      if (!light || S.styleName === "lofi" || S.styleName === "acoustic") {
        pattern(D.hat, "perc", "hat", (light ? .45 : .6) * dyn + .12);
        if (!light && (S.styleName === "lofi" || S.styleName === "rnb") && rng.chance(.14)) hit(rng.pick([3, 7, 11, 15]) + .5, "perc", "hat", .26);
        if (!light) pattern(D.open, "perc", "open", .5 * dyn + .1);
      }
      if (!light && D.tamb) pattern(D.tamb, "perc", "tamb", .38 * dyn + .1);
      if (!light && D.cow) pattern(D.cow, "perc", "cow", .42);
      if (dOnly && e > .4) { var ox = ["shaker", "tamb", "cow", "conga"][sec.drumVar % 4], op = ["x.x.x.x.x.x.x.x.", "..x...x...x...x.", "x..x..x..x..x..x", "x.xx.xx.x.xx.xx."][(sec.drumVar + S.secNo) % 4]; pattern(op, "perc", ox, .4 * dyn + .1, null); }
      if (D.ride) pattern(D.ride, "perc", "ride", (light ? .4 : .55) * dyn + .1);
      if (D.rim) pattern(D.rim, "perc", "rim", D.rimV !== undefined ? D.rimV : .5 * dyn + .1);
      /* ghost notes: very quiet snare taps between the backbeats give a played feel */
      var GH = { lofi: [2, 7, 10, 15], rnb: [6, 7, 14, 15], afrobeats: [3, 10, 15], amapiano: [], acoustic: [], funk: [3, 6, 7, 9, 14, 15], hiphop: [7, 10, 15], rock: dOnly ? [3, 7, 11, 15] : [], pop: dOnly ? [3, 10, 15] : [], rocknroll: [], blues: [], country: [] }[S.styleName];
      if (!gv && !light && GH && D.snare) for (var gi = 0; gi < GH.length; gi++) if (D.snare.charAt(GH[gi]) === "." && rng.chance((dOnly ? .4 : S.styleName === "funk" ? .35 : .22) * (.6 + e))) hit(GH[gi], "drums", "snare", .15 + rng() * .1);
      if (D.shaker && (!light || e > .3)) pattern(D.shaker, "perc", "shaker", .46 * dyn + .1);
      if (!light && (gv ? D.cLo || D.cHi : e > .5)) { pattern(D.cLo, "perc", "conga", .6, null); if (D.cHi) pattern(D.cHi, "perc", "conga", .5, null); }
      if (D.tom && (!light || firstBar)) pattern(D.tom, "drums", "tom", .8, null);
      /* ghost kick for movement */
      if (!gv && !light && D.kick && S.styleName !== "house" && rng.chance(.16)) { var gh = rng.pick([10, 11, 14, 15]); if (D.kick.charAt(gh) === ".") hit(gh, "drums", "kick", .55); }
      /* fills at the end of a 4-bar group */
      var fillNow = sec.tpl.fill && !light && ((endOfGroup && (lastBar || dOnly || rng.chance(.5))) || (dOnly && pb === 1 && rng.chance(.4)));
      if (fillNow) {
        out = out.filter(function (ev) { return !(ev.s >= 12 && ev.r !== "fx" && ev.k !== "crash"); });
        var rockish = S.styleName === "rock" || S.styleName === "rocknroll" || S.styleName === "blues", ft = rng.int(dOnly ? 5 : 4);
        if (S.styleName === "cinematic" || S.recipe === RECIPES.anger) ft = 1;
        if (ft === 1 || (rockish && ft === 0 && rng.chance(.5))) { for (i = 0; i < 4; i++) hit(12 + i, "drums", "tom", .6 + i * .1, { n: 3 - i }); }
        else if (ft === 2) { hit(12, "drums", "snare", .7); hit(13, "drums", "kick", .75); hit(14, "drums", "snare", .65); hit(14.5, "drums", "tom", .6, { n: 1 }); hit(15, "drums", "tom", .7, { n: 0 }); }
        else if (ft === 3) { for (i = 0; i < 8; i++) hit(12 + i / 2, "drums", i % 2 ? "tom" : "snare", .45 + i * .07, { n: Math.max(0, 3 - Math.floor(i / 2)) }); }
        else if (ft === 4) { hit(12, "drums", "kick", .8); hit(12.5, "drums", "snare", .5); hit(13, "drums", "snare", .6); hit(13.5, "drums", "tom", .6, { n: 2 }); hit(14, "drums", "tom", .7, { n: 1 }); hit(14.5, "drums", "tom", .75, { n: 0 }); hit(15, "drums", "snare", .8); }
        else { for (i = 0; i < 4; i++) hit(12 + i, "drums", "snare", .4 + i * .18); }
        if (rockish && lastBar) hit(15.5, "drums", "kick", .8);
      } else if (S.style.rolls && rng.chance(.28) && !light) {
        out = out.filter(function (ev) { return !(ev.k === "hat" && ev.s >= 14); });
        for (i = 0; i < 6; i++) hit(14 + i / 3, "perc", "hat", .4 + i * .1);
      }
      return out;
    }

    /* ── sections ── */
    function applySteer() {
      var st = S.steer; if (!st) return; S.steer = null;
      if (st.mood && RECIPES[st.mood] && st.mood !== spec.stages[S.stage].mood) {
        var r = RECIPES[st.mood];
        spec.stages = [{ mood: st.mood, recipe: r, bars: 1e9, style: st.style && STYLES[st.style] ? st.style : (r.styles[S.styleName] ? S.styleName : pickStyle(r, rng, null)) }];
        enterStage(0, true); S.barNo = Math.max(S.barNo, 1);
      } else if (st.style && STYLES[st.style] && st.style !== S.styleName) {
        spec.stages[S.stage].style = st.style; enterStage(S.stage, false); S.arcIdx = 1;
      }
    }
    /* a section's own band: swap instruments in for this section and put the base band back at the next one (unless a live steer changed that part meanwhile) */
    function applySectionBand(ps) {
      var r, o = S.palOver || {}; for (r in o) if (S.pal[r] === o[r].to) S.pal[r] = o[r].was; S.palOver = {};
      if (!ps || !ps.band) return;
      for (r in ps.band) { var to = ps.band[r] === "none" ? null : ps.band[r]; if (S.pal[r] === to) continue; S.palOver[r] = { was: S.pal[r], to: to }; S.pal[r] = to; }
    }
    /* the engine's own sense of when a human voice helps: oohs or a choir under the big sections, a hummed double on the hook. Independent of the plan, so voices show up even when the model does not ask. */
    var VSTY = { pop: .5, rnb: .7, acoustic: .5, cinematic: .85, ambient: .7, celtic: .95, opera: .9, afrobeats: .45, afrobeat: .35, amapiano: .5, lofi: .45, reggae: .35, trap: .35, phonk: .5, memphis: .55, house: .3, edm: .3, hiphop: .3, blues: .3, country: .3, bluegrass: 0, irish: .1, rock: .2, jazz: .15, funk: .15, rocknroll: 0 };
    function isVoiceName(n) { return n === "vox" || n === "hum" || n === "ooh" || n === "choir" || n === "synthchoir"; }
    function voxBase() { var sn = S.styleName, mood = spec.stages[Math.max(0, S.stage)].mood, b = VSTY[sn] === undefined ? .3 : VSTY[sn]; if (mood === "sadness" || mood === "love" || mood === "hope") b += .15; else if (mood === "anger") b -= .2; return clamp(b, 0, .9); }
    function pickVoice(sec, ps) {
      if (SOLO || spec.drums || (S.style && S.style.solo)) return null;
      if (ps && (ps.dbl || (ps.band && (isVoiceName(ps.band.pad) || isVoiceName(ps.band.lead) || isVoiceName(ps.band.comp) || isVoiceName(ps.band.ans))))) return null;
      if (isVoiceName(S.pal.pad) || isVoiceName(S.pal.lead) || isVoiceName(S.pal.comp) || isVoiceName(S.pal.ans)) return null;
      var susN = 0; ["pad", "comp", "lead", "arp", "ans"].forEach(function (r) { var m = INSTR_META[S.pal[r]]; if (m && (m.fam === "sus" || m.fam === "bowed")) susN++; });
      if (susN >= 2 && S.styleName !== "cinematic" && S.styleName !== "ambient" && S.styleName !== "celtic" && S.styleName !== "opera") return null;
      var sn = S.styleName, mood = spec.stages[Math.max(0, S.stage)].mood, w = /chorus|drop|climax|swell|rise/.test(sec.kind) ? 1 : (sec.kind === "bridge" && sec.e > .5) ? .8 : /break|release/.test(sec.kind) ? .6 : (sec.kind === "verse" && ({ rnb: 1, lofi: 1, acoustic: 1, pop: 1, afrobeats: 1, amapiano: 1, cinematic: 1 })[sn]) ? .3 : 0;
      if (!w) return null;
      var b = voxBase() * VOX.amt; if (b <= 0) return null;
      var first = !S.voxShown && b >= .45 && w >= .8;
      if (!first && !rng.chance(Math.min(.95, b * 1.15) * w * (sec.e > .7 ? 1 : .8))) return null;
      S.voxShown = true;
      var inst = sn === "opera" ? "choir" : sn === "celtic" ? (rng.chance(.5) ? "choir" : "ooh") : (sn === "cinematic" || mood === "sadness" || mood === "fear") ? "choir" : (sn === "ambient" || sn === "acoustic") ? "ooh" : (rng.chance(.5) ? "ooh" : "synthchoir");
      if (!fits(sn, inst)) { inst = ["ooh", "hum", "choir", "synthchoir"].filter(function (n) { return fits(sn, n); })[0]; if (!inst) return null; }
      var dbl = ({ afrobeats: 1, amapiano: 1, rnb: 1, lofi: 1, acoustic: 1, pop: 1 })[sn] && fits(sn, "hum") && sec.lead !== "none" && rng.chance(.55) ? { i: "hum", o: rng.pick([0, 12]) } : null;
      return { i: inst, dbl: dbl };
    }
    function voxPal() { if (SOLO || spec.drums || voxBase() < .45) return S.pal; var o = {}, k; for (k in S.pal) o[k] = S.pal[k]; o.vx1 = (S.styleName === "cinematic" || (spec.stages[Math.max(0, S.stage)].mood === "sadness")) ? "choir" : "ooh"; return o; }
    function startSection() {
      applySteer();
      if (S.stage < spec.stages.length - 1 && S.barNo - S.stageStart >= spec.stages[S.stage].bars) enterStage(S.stage + 1, true);
      var arc = ARCS[S.arcName], tpl = arc[S.arcIdx % arc.length], ps = null;
      if (PLAN) {
        if (S.planIdx % PLAN.sections.length === 0) S.rootMod = 0;
        ps = PLAN.sections[S.planIdx % PLAN.sections.length]; S.planIdx++;
        if (ps.mod > 0) S.rootMod = ps.mod; S.root = (S.rootBase + S.rootMod) % 12;
        var finalBig = (S.planIdx - 1) % PLAN.sections.length === PLAN.lastBig;
        tpl = { k: ps.kind, n: ps.bars / 4, e: ps.energy, lead: ps.lead, arp: ps.arp ? 1 : 0, drums: ps.drums, bass: ps.bass, fill: ps.fill, crash: ps.crash, lift: ps.kind === "solo" || ps.kind === "drop" || (finalBig && ps.kind === "chorus"), cut: ps.kind === "intro" ? .6 : ps.kind === "outro" ? .6 : 0, riser: ps.kind === "build" || ps.kind === "prechorus" };
        if (S.planIdx > 0 && S.planIdx % PLAN.sections.length === 0) S.cycle++;
      } else if (S.arcIdx > 0 && S.arcIdx % arc.length === 0) {
        S.cycle++;
        if (rng.chance(.5)) makeProgs();
        if (rng.chance(.55)) S.theme = makeTheme();
        if (S.cycle % 3 === 0 && rng.chance(.5)) { var rel = rng.pick([7, 5, 2, 0]); if (rel) S.root = (S.root + rel) % 12; }
      }
      if (S.style.keyLift && !PLAN) {
        if (S.liftOn) { S.root = (S.root + 12 - S.liftOn) % 12; S.liftOn = 0; }
        if (tpl.lift) { S.liftOn = rng.pick([2, 3]); S.root = (S.root + S.liftOn) % 12; }
      }
      S.arcIdx++;
      var harm = S.style.harm, prog = ps ? ps.chords : (tpl.k === "chorus" || tpl.k === "drop" || tpl.k === "climax" || tpl.k === "swell" || tpl.k === "rise") ? S.progB : (tpl.k === "bridge" ? bridgeProg() : S.progA), L = prog.length * harm, bars = Math.ceil(tpl.n * 4 / L) * L;
      var e = clamp(.18 + S.recipe.energy * .8 * (.35 + .65 * tpl.e) + S.bias, .1, 1);
      var dl = tpl.drums; if (S.style.drums === 0) dl = 0; else if (S.style.drums === 1 && dl === 2) dl = 1;
      S.sec = {
        kind: tpl.k, tpl: tpl, bars: bars, loopLen: L, e: e, dyn: .55 + .45 * e, lead: tpl.lead, lift: !!tpl.lift, prog: prog,
        layers: { comp: S.style.solo ? true : tpl.k === "intro" ? rng.chance(.55) : tpl.k === "break" ? rng.chance(.8) : true, bass: !!tpl.bass && e >= .15, drums: dl, arp: rng.chance(tpl.arp * (.5 + e * .7)) },
        compVar: rng.int(4), bassVar: rng.int(6), drumVar: rng.int(4), loop: 0, ans: false
      };
      applySectionBand(ps);
      S.sec.vox = pickVoice(S.sec, ps);
      S.sec.dbl = ps && ps.dbl ? ps.dbl : null;
      if (ps && ps.mel) { S.sec.mel = ps.mel; S.sec.melBars = ps.melBars; }
      if (ps && ps.bl) { S.sec.bl = ps.bl; S.sec.blBars = ps.blBars; }
      if (ps && ps.gv) S.sec.gv = ps.gv;
      if (ps) { S.sec.layers.comp = ps.comp; S.sec.layers.arp = ps.arp && !!S.pal.arp; S.sec.layers.bass = ps.bass && e >= .15; S.sec.loop = 0; }
      if (tpl.k === "intro" && S.style.drums === 2 && !S.sec.layers.comp && !ps) S.sec.layers.arp = true;
      S.sec.layers.ans = !!S.pal.ans && rng.chance(S.styleName === "celtic" || S.styleName === "opera" ? .5 + .35 * e : .25 + .55 * e);
      S.secBar = 0; S.secNo++;
      S.secStartBarNo = S.barNo;
    }

    /* apply written parts to the section that is already playing (used when the listener asks for a change) */
    function refreshSection() {
      if (!PLAN || !S.sec || !S.planIdx) return false; var ps = PLAN.sections[(S.planIdx - 1) % PLAN.sections.length]; if (!ps) return false;
      applySectionBand(ps); S.sec.dbl = ps.dbl || null; S.sec.mel = ps.mel || null; S.sec.melBars = ps.melBars || 0; S.sec.bl = ps.bl || null; S.sec.blBars = ps.blBars || 0; S.sec.gv = ps.gv || null;
      return true;
    }
    /* what a band does without thinking: bass leans into the kick, hats breathe (strong/weak), a phrase swells across its four bars */
    function humanize(ev) {
      var kicks = {}, i, e, pb = S.secBar % 4, swell = 1 + .025 * pb;
      for (i = 0; i < ev.length; i++) { e = ev[i]; if (e.r === "drums" && e.k === "kick") kicks[Math.round(e.s)] = 1; }
      for (i = 0; i < ev.length; i++) {
        e = ev[i]; var r = Math.round(e.s);
        if (e.r === "bass") e.v *= S.style.solo ? 1 : (kicks[r] ? 1.1 : .93);
        else if (e.r === "perc" && (e.k === "hat" || e.k === "ride" || e.k === "tamb")) e.v *= (r % 4 === 0 ? 1.06 : r % 2 === 0 ? .96 : .86) * (pb === 3 ? 1.08 : 1);
        else if (e.r === "pad" || e.r === "comp" || e.r === "arp" || e.r === "lead") e.v *= swell;
      }
      /* phrasing: a played melody breathes. Each four-bar phrase swells to its middle and settles at the end, higher notes lean in, beats carry a little weight, quick notes are lighter and the last note before a rest tails off */
      if (!S.style.solo) {
        var leads = ev.filter(function (x) { return x.r === "lead" && !x.vx && !x.ans && x.m !== undefined; }).sort(function (x, y) { return x.s - y.s; }), li;
        for (li = 0; li < leads.length; li++) {
          var L = leads[li], nxt = leads[li + 1], pos = (S.secBar % 4 + L.s / 16) / 4, f = .94 + .1 * Math.sin(Math.PI * pos);
          f *= 1 + clamp((L.m - 69) / 70, -.07, .07); if (Math.round(L.s) % 4 === 0) f *= 1.04; if (L.d <= 1.5) f *= .92;
          if (!nxt || nxt.s - (L.s + L.d) >= 4) f *= .93;
          L.v *= f;
        }
        /* a guitar or clavinet strums: the notes of a chord land a few milliseconds apart, low to high */
        var strum = /^(guitar|eguitar|dguitar|clav|harp)$/.test(S.pal.comp || ""), cs = ev.filter(function (x) { return x.r === "comp" && x.m !== undefined; }).sort(function (x, y) { return x.s - y.s || x.m - y.m; }), si = 0, ps = -1;
        if (strum) for (li = 0; li < cs.length; li++) { if (Math.round(cs[li].s * 4) !== ps) { ps = Math.round(cs[li].s * 4); si = 0; } else si++; cs[li].s += si * .07; }
      }
    }
    /* the director: bands do not play the same four bars for sixteen. At each new phrase (after the first of a section) the arrangement may change one thing
     * for that phrase: the pad and arp step out, the bass waits two bars, the beat stops for the last beat, the lead is echoed, or a ghost shaker/hat fills in. */
    var TW_ALLOW = { afrobeats: "thin nobass stop echo ghost", amapiano: "thin nobass stop echo ghost", afrobeat: "thin stop ghost", house: "thin nobass stop echo ghost", trap: "thin nobass stop echo", phonk: "thin nobass stop echo", memphis: "thin nobass stop",
      lofi: "thin nobass stop echo ghost", pop: "thin nobass stop echo ghost", rnb: "thin nobass stop echo ghost", hiphop: "thin nobass stop ghost", reggae: "thin stop", funk: "thin stop", rock: "thin stop", rocknroll: "thin stop", blues: "thin stop", country: "thin stop", bluegrass: "thin stop", irish: "thin stop", lingala: "thin nobass stop echo ghost", jazz: "thin", ambient: "thin", celtic: "thin echo", opera: "thin echo", cinematic: "thin", acoustic: "thin" };
    var TW_GHOST = { afrobeats: "shaker", amapiano: "shaker", afrobeat: "shaker", house: "hat", lofi: "hat", pop: "shaker", rnb: "hat", hiphop: "hat" };
    function direct(ev, sec, lastBar) {
      if (S.style.solo || spec.drums || SOLO || /^(intro|break|breath|build|bridge)$/.test(sec.kind) || sec.bars < 8) return ev;
      var pb = S.secBar % 4, ph = Math.floor(S.secBar / 4);
      if (pb === 0) {
        S.twist = null;
        if (ph >= 1 && rng.chance(.6)) {
          var allow = (TW_ALLOW[S.styleName] || "thin").split(" ").filter(function (t) { return t !== S.lastTwist; });
          if (allow.length) { S.twist = rng.pick(allow); S.lastTwist = S.twist; }
        } else S.lastTwist = null;
      }
      var tw = S.twist; if (!tw) return ev;
      if (tw === "thin" && pb < 2) ev = ev.filter(function (e) { return e.r !== "pad" && e.r !== "arp"; });
      else if (tw === "nobass" && pb < 2) ev = ev.filter(function (e) { return e.r !== "bass"; });
      else if (tw === "stop" && pb === 3) ev = ev.filter(function (e) { return !(e.s >= 12 && (e.r === "bass" || e.r === "comp" || (e.r === "drums" && e.k === "kick"))); });
      else if (tw === "echo" && pb === 3) {
        var cp = [];
        ev.forEach(function (e) { if (e.r === "lead" && !e.ans && !e.vx && e.m !== undefined && e.s + 3 < 16) cp.push({ s: e.s + 3, r: "lead", i: e.i, m: e.m, d: Math.max(1, e.d * .6), v: e.v * .36, p: 3, pan: .4 }); });
        ev = ev.concat(cp);
      } else if (tw === "ghost" && TW_GHOST[S.styleName]) {
        var gk = TW_GHOST[S.styleName], have = {}; ev.forEach(function (e) { if (e.r === "perc") have[Math.round(e.s)] = 1; });
        for (var gs = 1; gs < 16; gs += 2) if (!have[gs] && rng.chance(.8)) ev.push({ s: gs, r: "perc", k: gk, v: .2 + rng() * .08, p: 3, pan: (gs % 4 < 2 ? -1 : 1) * .3 });
      }
      return ev;
    }
    function nextBar() {
      var first = false;
      if (S.stage < 0) { enterStage(0, false); }
      if (!S.sec || S.secBar >= S.sec.bars) { startSection(); first = true; }
      var sec = S.sec, harm = S.style.harm, cb = S.secBar % sec.loopLen, ci = Math.floor(cb / harm);
      sec.loop = Math.floor(S.secBar / sec.loopLen);
      var chord = sec.prog[ci], nextChord = sec.prog[(ci + 1) % sec.prog.length], chordStart = (cb % harm) === 0;
      if (Math.abs(S.bpmTarget - S.bpm) > .01) S.bpm += clamp(S.bpmTarget - S.bpm, -1.5, 1.5);
      if (chordStart || !S.padV) {
        var pc = COMP_CENTER[S.pal.pad] || 54;
        S.padV = voice(chord, Math.min(pc, 56), S.padV, 14, false);
        S.compV = voice(chord, COMP_CENTER[S.pal.comp] || 62, S.compV, 14, S.style.rootless);
      }
      var lastBar = S.secBar === sec.bars - 1, ev = [];
      /* the first intro does not just fade in: its last two bars tease the hook on the lead and let the bass walk in, so the listener hears the tune before the verse */
      var teaser = !PLAN && !S.style.solo && !spec.drums && !SOLO && sec.kind === "intro" && S.secNo === 1 && sec.bars >= 4 && S.secBar >= sec.bars - 2, _tl = sec.lead, _tb = sec.layers.bass;
      if (teaser) { sec.lead = "theme"; sec.layers.bass = S.style.drums !== 0 && sec.layers.drums > 0 ? true : sec.layers.bass; }
      ev = ev.concat(padBar(sec, chord, chordStart), bassBar(sec, chord, nextChord, cb), compBar(sec, chord, cb), leadBar(sec, chord, ci, cb), answerBar(sec, chord, S.secBar % 4), arpBar(sec), drumBar(sec, S.secBar === 0, lastBar));
      if (teaser) { sec.lead = _tl; sec.layers.bass = _tb; if (lastBar) ev.push({ s: 8, r: "fx", k: "revcrash", d: 8, v: .35, p: 2 }); }
      if (sec.vox) {
        if (chordStart || !S.voxV) { S.voxV = voice(chord, sec.vox.i === "choir" ? 60 : 64, S.voxV, 10, false); }
        var celt = S.styleName === "celtic" || S.styleName === "opera", vt = S.voxV.slice(celt ? -4 : -3), vi2;
        if (chordStart) for (vi2 = 0; vi2 < vt.length; vi2++) ev.push({ s: celt ? vi2 * .6 : 0, r: "lead", i: sec.vox.i, m: vt[vi2], d: harm * 16 - 1 - (celt ? vi2 * .6 : 0), v: BASE_VEL.pad * sec.dyn * 1.1 * VOX.lvl * (celt ? .85 : 1), p: 1, vx: 1, cost: 1, pan: (vi2 - 1) * .3 });
        if (sec.vox.dbl) { var snap = ev.slice(); snap.forEach(function (e) { if (e.r === "lead" && !e.ans && !e.vx && e.i !== "hum" && e.m !== undefined) ev.push({ s: e.s, r: "lead", i: "hum", m: e.m + sec.vox.dbl.o, d: e.d, v: e.v * .55 * VOX.lvl, p: 1, vx: 1, cost: 1, pan: .15 }); }); }
      }
      /* transitions: the bar before a drop leaves a gap and a reversed cymbal pulls into it; a break opens with a falling sweep */
      if (lastBar && sec.kind === "build") {
        ev = ev.filter(function (e) { return !(e.s >= 14 && (e.r === "pad" || e.r === "comp" || e.r === "lead" || e.r === "arp" || e.r === "bass")); });
        ev.push({ s: 8, r: "fx", k: "revcrash", d: 8, v: .55, p: 2 });
      }
      /* section-to-section development: a rising sweep over the last two bars into a chorus or drop, and before the final one a half-bar of near silence so it lands harder */
      if (PLAN && !S.style.solo && !spec.drums && sec.kind !== "build" && sec.kind !== "chorus" && sec.kind !== "drop" && sec.bars >= 4) {
        var nxI = S.planIdx % PLAN.sections.length, nx = PLAN.sections[nxI], bigNext = nx && (nx.kind === "chorus" || nx.kind === "drop") && nx.energy >= sec.e;
        if (bigNext && sec.kind !== "prechorus" && S.secBar === sec.bars - 2) ev.push({ s: 0, r: "fx", k: "riser", d: 32, v: .32, p: 2 });
        if (bigNext && lastBar) {
          var final = nxI === PLAN.lastBig;
          ev = ev.filter(function (e) { return !(e.s >= (final ? 12 : 14) && (e.r === "pad" || e.r === "comp" || e.r === "lead" || e.r === "arp" || e.r === "bass" || (final && (e.r === "drums" || e.r === "perc") && e.k !== "snare" && e.k !== "tom"))); });
          ev.push({ s: 8, r: "fx", k: "revcrash", d: 8, v: final ? .6 : .45, p: 2 });
        }
      }
      ev = direct(ev, sec, lastBar);
      var mk = S.mask, fxm = S.fixed, hasMask = !!fxm; for (var mq in mk) if (mk[mq] === false) hasMask = true;
      if (hasMask) ev = ev.filter(function (e) { var kk = e.vx ? "voice" : (e.r === "drums" || e.r === "perc") ? "drums" : e.r; return mk[kk] !== false && !(fxm && fxm[kk] === false && e.r !== "fx"); });
      if (S.secBar === 0 && (sec.kind === "break" || sec.kind === "breath" || sec.kind === "bridge")) ev.push({ s: 0, r: "fx", k: "fall", d: 12, v: .4, p: 2 });
      if (S.style.solo) ev = ev.filter(function (e) { return e.r !== "fx"; });
      humanize(ev);
      if (S.style.rubato) ev.forEach(function (e) { if ((e.r === "lead" || e.r === "arp" || e.r === "comp") && !e.vx) e.s = Math.max(0, e.s + (rng() - .5) * .3); });
      ev.sort(function (a, b) { return a.s - b.s; });
      /* mix automation: filter opens through intros and builds, closes in breaks */
      var cut = 1, tpl = sec.tpl, prog = S.secBar / sec.bars;
      if (tpl.k === "intro") cut = lerp(tpl.cut || .55, 1, prog);
      else if (tpl.k === "build") cut = lerp(.55, 1, prog);
      else if (tpl.k === "prechorus") cut = lerp(.7, 1, prog);
      else if (tpl.cut) cut = tpl.cut;
      var wet = (S.style.solo ? 1.5 : 1) + (S.style.wet || 0) + ((tpl.k === "break" || tpl.k === "breath" || tpl.k === "bridge") ? .7 : 0) + S.recipe.space * .2;
      var human = S.style.solo ? 1 : spec.drums ? .5 : S.styleName === "jazz" ? .75 : S.styleName === "blues" || S.styleName === "rocknroll" ? .65 : S.styleName === "lofi" ? .85 : (S.styleName === "house" || S.styleName === "trap") ? .12 : .45;
      /* rubato: a solo player breathes with the phrase, easing at phrase ends and drifting slightly otherwise */
      /* waltz: a 3/4 bar is twelve sixteenths. The bar is written as usual, then the last beat is cut and long notes shortened to fit */
      if (S.style.graces) {
        var gsc = lscale().map(function (x) { return (S.root + x) % 12; }), gr = [];
        ev.forEach(function (e) { if (e.r === "lead" && !e.vx && !e.ans && e.m !== undefined && e.d >= 2 && e.s >= 1 && rng.chance(.3)) { var kk = [2, 1, 3, 4].filter(function (q) { return gsc.indexOf((e.m + q) % 12) >= 0; })[0]; if (kk) gr.push({ s: e.s - .4, r: "lead", i: e.i, m: e.m + kk, d: .35, v: e.v * .55, p: e.p || 1 }); } });
        ev = ev.concat(gr);
      }
      if (S.waltz) {
        var seen = {}; if (!S.jig) ev.forEach(function (e) { if (e.r === "lead" && !e.vx) { e.s = Math.round(e.s * .75); e.d = Math.max(1, e.d * .75); } });
        ev = ev.filter(function (e) { if (e.r === "lead" && !e.vx) { var k = (e.ans ? "a" : "l") + e.s; if (seen[k]) return false; seen[k] = 1; } return true; });
        ev = ev.filter(function (e) { return e.s < 12; }); ev.forEach(function (e) { if (e.d >= 8 && e.r !== "drums") e.d = Math.max(1, e.d * .75); else if (e.s + e.d > 12.5 && e.r !== "drums") e.d = Math.max(1, 12 - e.s); }); }
      if (S.style.leadCap) ev.forEach(function (e) { if (e.r === "lead" && !e.vx && e.m !== undefined) { while (e.m > 74) e.m -= 12; while (e.m < 57) e.m += 12; } });
      var bpmB = S.bpm;
      if (S.style.rubato) { S.rub = clamp((S.rub || 0) * .85 + (rng() - .5) * .016, -.04, .04); bpmB = S.bpm * (1 + S.rub - ((S.secBar % 4) === 3 ? .045 : 0) - (lastBar ? .05 : 0)); }
      else if (S.style.solo) { S.rub = clamp(S.rub * .8 + (rng() - .5) * .012, -.03, .03); bpmB = S.bpm * (1 + S.rub - ((S.secBar % 4) === 3 ? .035 : 0) - (lastBar ? .03 : 0)); }
      var bar = {
        idx: S.barNo, bpm: bpmB, stepDur: 60 / bpmB / 4, barDur: 60 / bpmB * (S.waltz ? 3 : 4), meter: S.waltz ? 3 : 4, swing: S.style.swing, swing8: S.style.swing8 || 0, human: human, events: ev,
        lay: S.style.lay || 0,
        mix: { wobble: S.style.wobble || 0, cut: cut, wet: wet, duck: S.style.duck, delay: S.style.delay, tex: S.tex, grit: Math.max(S.recipe.grit || 0, S.style.grit || 0), bright: S.recipe.bright, space: S.recipe.space, level: S.style.level || 1, eq: STYLE_EQ[S.styleName] || null },
        strips: PLAN && PLAN.mix || null, palette: voxPal(), kit: S.style.kit, sec: { kind: sec.kind, idx: S.secNo, bar: S.secBar, len: sec.bars, e: sec.e }, secStart: first, stage: S.stage, mood: spec.stages[S.stage].mood, style: S.styleName,
        key: { root: S.root, mode: S.mode }
      };
      S.secBar++; S.barNo++;
      return bar;
    }
    /* live control. Energy and tempo change at once (heard within the 1.6 s lookahead); mood and style end the current section so a new one starts on the next bar. */
    function steer(p) {
      p = p || {};
      if (typeof p.energy === "number" && isFinite(p.energy)) {
        var d = clamp(p.energy, -.5, .5); S.bias = clamp(S.bias + d, -.5, .5);
        if (S.sec) {
          var sc = S.sec; sc.e = clamp(sc.e + d, .1, 1); sc.dyn = .55 + .45 * sc.e;
          if (sc.e >= .45 && S.style.drums !== undefined) sc.layers.arp = true;
          if (sc.e >= .6 && S.style.drums > 0 && sc.layers.drums > 0 && sc.layers.drums < 2) sc.layers.drums = Math.min(S.style.drums, 2);
          if (sc.e < .3) { sc.layers.arp = false; if (sc.layers.drums > 1) sc.layers.drums = 1; }
        }
      }
      if (typeof p.bpm === "number" && isFinite(p.bpm)) S.bpmTarget = clamp(S.bpmTarget + clamp(p.bpm, -30, 30), 50, 150);
      if (typeof p.tempo === "number" && isFinite(p.tempo)) S.bpmTarget = clamp(p.tempo, 50, 150);
      /* switch whole parts off or on ("no drums", "bring the bass back") */
      if (p.reset) S.mask = {};
      if (p.layers && typeof p.layers === "object") for (var lk in p.layers) { var key = LAYER_KEYS[String(lk).toLowerCase()]; if (!key) continue; var on = !(p.layers[lk] === false || p.layers[lk] === "off" || p.layers[lk] === 0); if (on) delete S.mask[key]; else S.mask[key] = false; }
      /* swap the instrument a part uses ("play the lead on piano"); it sticks across sections */
      if (p.instrument && typeof p.instrument === "object") for (var rk in p.instrument) {
        var role = LAYER_KEYS[String(rk).toLowerCase()] || rk, nm = normInstr(p.instrument[rk]);
        if (ROLES_SET[role] && (INSTR_META[nm] || (role === "bass" && BASS_LOW[nm]))) { S.pal[role] = nm; spec.forced = spec.forced || {}; spec.forced[role] = nm; }
      }
      if ((p.mood && RECIPES[p.mood]) || (p.style && STYLES[p.style])) {
        S.steer = { mood: RECIPES[p.mood] ? p.mood : null, style: STYLES[p.style] ? p.style : null };
        if (S.sec) S.sec.bars = S.secBar;
      }
    }
    /* DJ mix hooks: the piece was started at the mix tempo; release lets it glide to its own tempo once the outgoing track has gone */
    function hold() { spec.bpmForce = S.bpm; S.bpmTarget = S.bpm; }
    function release(nat) { spec.bpmForce = 0; if (nat) S.bpmTarget = clamp(nat, 50, 150); }
    function info() {
      return { solo: spec.solo || "", drums: !!spec.drums, planned: !!PLAN, root: S.root, modeName: S.mode, seed: seed, title: spec.title, mood: spec.stages[Math.max(0, S.stage)].mood, journey: spec.stages.map(function (s) { return s.mood; }), intent: spec.intent,
               style: S.styleName, styleName: S.style ? S.style.name : "", bpm: Math.round(S.bpm), key: NOTE_NAMES[S.root] + " " + MODE_LABEL[S.mode], palette: S.pal, section: S.sec ? S.sec.kind : "", bar: S.barNo, muted: Object.keys(S.mask).filter(function (k) { return S.mask[k] === false; }) };
    }
    return { spec: spec, seed: seed, refresh: refreshSection, nextBar: nextBar, steer: steer, info: info, release: release, hold: hold, state: function () { return S; } };
  }

  /* ═══════════════ 5. engine ═══════════════
   * Plays composer bars with Web Audio. Everything is synthesized, so there are no audio files to download.
   * One Engine = one piece: its own mixer, reverb, delay, sidechain and limiter, so pieces can crossfade.
   */
  var KITS = {
    classic: { kickStart: 165, kickEnd: 42, kickDecay: .5, snareTone: 200, snareNoise: .55, snareDecay: .18, clapFreq: 1400, hatFreq: 8000, hatDecay: .05 },
    afro:    { kickStart: 150, kickEnd: 50, kickDecay: .32, snareTone: 330, snareNoise: .4, snareDecay: .11, clapFreq: 1700, hatFreq: 9500, hatDecay: .035 },
    heavy:   { kickStart: 130, kickEnd: 38, kickDecay: .8, snareTone: 170, snareNoise: .7, snareDecay: .28, clapFreq: 1100, hatFreq: 6500, hatDecay: .07 },
    phonk:   { kickStart: 125, kickEnd: 36, kickDecay: 1.0, snareTone: 240, snareNoise: .62, snareDecay: .16, clapFreq: 1250, hatFreq: 9500, hatDecay: .035 },
    afrob:   { kickStart: 135, kickEnd: 48, kickDecay: .36, snareTone: 300, snareNoise: .5, snareDecay: .11, clapFreq: 1700, hatFreq: 10000, hatDecay: .03 },
    ama:     { kickStart: 100, kickEnd: 50, kickDecay: .4, snareTone: 250, snareNoise: .4, snareDecay: .12, clapFreq: 1250, hatFreq: 9800, hatDecay: .03 },
    trap:    { kickStart: 120, kickEnd: 34, kickDecay: 1.15, snareTone: 260, snareNoise: .6, snareDecay: .14, clapFreq: 1500, hatFreq: 10500, hatDecay: .03 },
    lofi:    { kickStart: 105, kickEnd: 50, kickDecay: .3, snareTone: 185, snareNoise: .32, snareDecay: .2, clapFreq: 950, hatFreq: 5200, hatDecay: .06 },
    rock:    { kickStart: 140, kickEnd: 46, kickDecay: .42, snareTone: 195, snareNoise: .85, snareDecay: .26, clapFreq: 1300, hatFreq: 7200, hatDecay: .05 },
    rnr:     { kickStart: 125, kickEnd: 50, kickDecay: .3, snareTone: 215, snareNoise: .7, snareDecay: .2, clapFreq: 1300, hatFreq: 6800, hatDecay: .06 },
    jazz:    { kickStart: 115, kickEnd: 52, kickDecay: .26, snareTone: 240, snareNoise: .38, snareDecay: .14, clapFreq: 1200, hatFreq: 6200, hatDecay: .07 },
    reggae:  { kickStart: 105, kickEnd: 44, kickDecay: .34, snareTone: 300, snareNoise: .3, snareDecay: .1, clapFreq: 1500, hatFreq: 8200, hatDecay: .04 },
    funk:    { kickStart: 150, kickEnd: 52, kickDecay: .22, snareTone: 225, snareNoise: .62, snareDecay: .13, clapFreq: 1500, hatFreq: 9000, hatDecay: .03 },
    boombap: { kickStart: 135, kickEnd: 40, kickDecay: .55, snareTone: 195, snareNoise: .6, snareDecay: .17, clapFreq: 1100, hatFreq: 6500, hatDecay: .045 },
    edm:     { kickStart: 185, kickEnd: 46, kickDecay: .36, snareTone: 230, snareNoise: .8, snareDecay: .24, clapFreq: 1650, hatFreq: 9000, hatDecay: .04 }
  };
  /* mixer strips: level, reverb send, delay send, how much the kick ducks them */
  /* master EQ per style, [sub dB below 70 Hz, mud dB at 330 Hz, presence dB above 2.5 kHz]. Measured by rendering every genre exemplar offline and comparing the share of energy in each band with a balanced target; 80% of the correction is applied. */
  var STYLE_EQ = { pop: [-2.2, -1.8, 3.6], rock: [-1.8, 0.0, 0.0], blues: [0.0, -3.1, 0.3], jazz: [0.0, -1.4, 0.0], funk: [-1.6, 0.0, 0.0], hiphop: [-0.5, 0.0, 0.0], trap: [-1.5, 0.0, 0.0], afrobeat: [-2.5, 0.0, 0.0], phonk: [-3.0, 0.0, 0.5], memphis: [-3.5, 0.0, 0.0], afrobeats: [-2.8, 0.0, 1.1], amapiano: [0.0, -4.0, 3.6], lofi: [0.0, -1.3, 0.0], house: [0.0, 0.0, 1.1], rnb: [-1.7, 0.0, 2.2], ambient: [-2.2, 0.0, 0.2], celtic: [-1.8, 0.0, 1.2], opera: [-1.2, 0.3, 1.0], acoustic: [0.0, -0.6, 0.0] };
  var STRIPS = {
    drums: { lvl: .46, rv: .05, dy: 0, duck: 0, hp: 36, pk: [4500, 1.5, .8], cmp: [-18, 3, .012, .12] }, hats: { lvl: .55, rv: .05, dy: 0, duck: 0, hp: 450 },
    bass: { lvl: .3, rv: 0, dy: 0, duck: 1, hp: 30, cmp: [-20, 3.5, .025, .16] }, pad: { lvl: .3, rv: .5, dy: 0, duck: 1, hp: 150, pk: [380, -2, .8] },
    comp: { lvl: .32, rv: .26, dy: .1, duck: .8, hp: 130, pk: [320, -2, .8] }, lead: { lvl: .7, rv: .32, dy: .25, duck: 0, hp: 200, pk: [3200, 2, .9], cmp: [-22, 2.5, .02, .22] },
    arp: { lvl: .5, rv: .38, dy: .3, duck: .6, hp: 280, pk: [6500, 1.5, .8] }, tex: { lvl: .3, rv: 0, dy: 0, duck: 0, hp: 80 }, fx: { lvl: .5, rv: .3, dy: 0, duck: 0, hp: 120 }
  };
  /* per-instrument loudness trim, measured so a middle C at the same velocity sounds equally loud for every instrument */
  var LOUD = { vox: 1.1, hum: .68, ooh: 1, synthchoir: 1, piano: .76, keys: .9, organ: .57, guitar: 1.1, pluck: 1.25, kalimba: 1.18, marimba: 1.28, bells: 1, mbira: 1.1, balafon: 1.15, whistle: .8, harmonica: .7, banjo: .85, mandolin: .8, steel: .8, fmpiano: .9, cowbell: 2.2, strings: 1, pad: 1.05, choir: 1.2, flute: .35, brass: .59, sax: .33, violin: .32, synth: 1.15, sub: .6, "808": .65, synthbass: .5, log: 1.2, eguitar: 1.05, dguitar: .47, lguitar: .45, ebass: .75, upbass: .9, hammond: .36, horns: .49, clav: 2.6, harp: 1 };
  var COST = { vox: 3, hum: 2, ooh: 3, synthchoir: 3, piano: 4, keys: 2, organ: 4, guitar: 1, pluck: 2, kalimba: 2, marimba: 3, bells: 3, mbira: 2, balafon: 2, whistle: 2, harmonica: 2, banjo: 1, mandolin: 2, steel: 2, fmpiano: 2, cowbell: 2, strings: 4, pad: 4, choir: 5, flute: 3, brass: 3, sax: 4, violin: 4, synth: 3, sub: 2, "808": 2, synthbass: 3, log: 2, eguitar: 1, dguitar: 4, lguitar: 4, ebass: 3, upbass: 2, hammond: 5, horns: 4, clav: 3, harp: 1 };
  var ROLE_STRIP = { pad: "pad", comp: "comp", lead: "lead", arp: "arp", bass: "bass" };
  var PERC_STRIP = { hat: "hats", open: "hats", shaker: "hats", conga: "hats", rim: "hats", ride: "hats", tamb: "hats", cow: "hats", chick: "hats" };

  function makeIR(ctx, sec, dark) {
    var sr = ctx.sampleRate, n = Math.floor(sr * sec), buf = ctx.createBuffer(2, n, sr), ch, i;
    for (ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), y = 0, seed = ch ? 911 : 337;
      for (i = 0; i < n; i++) {
        var t = i / n; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        var x = (seed / 4294967296) * 2 - 1, a = .12 + .82 * Math.pow(t, .55) * dark;
        y = y * a + x * (1 - a);
        d[i] = y * Math.pow(1 - t, 2.6) * (i < sr * .004 ? i / (sr * .004) : 1);
      }
    }
    return buf;
  }

  /* ═══ recorded instruments ═══
   * Real recordings (MIT-licensed tonejs-instruments: VSCO 2 CE / Karoryfer / Iowa), re-encoded as small mono mp3s in /samples/.
   * A bank loads lazily the first time a piece wants it; until it is decoded the synthesized voice plays, so nothing ever waits or goes silent.
   */
  var SMP_DIR = (function () { try { var sc = global.document && global.document.currentScript; return sc && sc.src ? sc.src.replace(/[?#].*$/, "").replace(/[^\/]*$/, "") : ""; } catch (e) { return ""; } })();
  var SMP = { on: true, base: SMP_DIR ? SMP_DIR + "samples/" : "samples/", man: null, manP: null, banks: {} };
  function smpMidi(f) { return 69 + 12 * Math.log(f / 440) / Math.LN2; }
  /* memory: decoded audio is raw floats, so ~180 MB if every bank were loaded. Banks decode at their own (low) sample rate, and a budget evicts
   * the least-recently-used idle banks; if nothing can be evicted a new bank simply waits and the synthesized voice keeps playing. */
  var SMP_DEC = {};
  function smpDecoder(ctx, rate) {
    try { var AC = global.OfflineAudioContext || global.webkitOfflineAudioContext; if (!AC) return ctx; return SMP_DEC[rate] || (SMP_DEC[rate] = new AC(1, 1, rate)); } catch (e) { return ctx; }
  }
  function smpBudget() {
    if (SMP.budgetMB) return SMP.budgetMB * 1048576;
    var dm = global.navigator && global.navigator.deviceMemory;     /* GB, when the browser says (Chrome/Android); iOS does not */
    return (dm ? Math.max(32, Math.min(128, dm * 16)) : 72) * 1048576;
  }
  function smpBytes() { var n = 0, k; for (k in SMP.banks) n += SMP.banks[k].bytes || 0; return n; }
  function smpRoom(need) {           /* make room for `need` bytes by dropping idle banks, oldest first; false if it will not fit */
    var budget = smpBudget(), now = Date.now(), tot = smpBytes(), names;
    if (tot + need <= budget) return true;
    names = Object.keys(SMP.banks).filter(function (k) { var b = SMP.banks[k]; return b.ready && now - (b.used || 0) > 30000; })
      .sort(function (x, y) { return (SMP.banks[x].used || 0) - (SMP.banks[y].used || 0); });
    while (names.length && tot + need > budget) { var k = names.shift(); tot -= SMP.banks[k].bytes || 0; delete SMP.banks[k]; }
    return tot + need <= budget;
  }
  function smpLoad(name, ctx) {
    var b = SMP.banks[name]; if (b) return b;
    b = { ready: false, failed: 0, bufs: {}, notes: [], loop: {}, kind: "pluck", bytes: 0, used: Date.now() };
    SMP.banks[name] = b;
    try {
      if (!SMP.manP) SMP.manP = global.fetch(SMP.base + "manifest.json").then(function (r) { if (!r.ok) throw new Error("manifest " + r.status); return r.json(); });
      b.p = SMP.manP.then(function (man) {
        var meta = man[name]; if (!meta) throw new Error("no bank " + name);
        b.kind = meta.k; b.loop = meta.loop || {};
        var rate = b.kind === "drum" ? 44100 : 32000, dec = smpDecoder(ctx, rate);
        var est = meta.n.length * rate * (b.kind === "drum" ? 1 : 3) * 4;
        if (!smpRoom(est)) { b.blocked = true; throw new Error("memory budget"); }
        b.bytes = est; b.act = 0;           /* reserve the estimate now so banks loading in parallel see each other */
        var queue = meta.n.slice(), run = function () {
          var m = queue.shift(); if (m === undefined) return Promise.resolve();
          return global.fetch(SMP.base + name + "/" + m + ".mp3").then(function (r) { if (!r.ok) throw new Error("sample " + r.status); return r.arrayBuffer(); })
            .then(function (ab) { return dec.decodeAudioData(ab); }).then(function (buf) { b.bufs[m] = buf; b.notes.push(m); b.act += buf.length * buf.numberOfChannels * 4; }).then(run);
        };
        return Promise.all([run(), run(), run(), run()]);
      }).then(function () { if (b.kind !== "drum") b.notes.sort(function (x, y) { return x - y; }); b.ready = b.notes.length > 0; if (!b.ready) throw new Error("empty"); b.bytes = b.act; b.used = Date.now(); })
        .catch(function () { b.failed = Date.now(); b.bytes = 0; b.bufs = {}; b.notes = []; if (!b.blocked) SMP.manP = null; });
    } catch (e) { b.failed = Date.now(); }
    return b;
  }
  function smpGet(name, ctx) {       /* the bank if it is ready, else start (or retry after a while) and return null */
    var b = SMP.banks[name];
    if (b && b.failed && Date.now() - b.failed > (b.blocked ? 15000 : 60000)) { delete SMP.banks[name]; b = null; }
    if (!b) b = smpLoad(name, ctx);
    if (b.ready) { b.used = Date.now(); return b; }
    return null;
  }
  /* drum kit -> recorded kit (CC-BY Pearl Master Studio by enoe; public-domain LinnDrum LM-2). Kits not listed stay synthesized. */
  var DRUMBANK = { rock: "drums-acoustic", rnr: "drums-acoustic", jazz: "drums-acoustic", reggae: "drums-acoustic", funk: "drums-acoustic", boombap: "drums-lm2", afro: "drums-cr78", ama: "drums-ama", afrob: "drums-afrob", phonk: "drums-phonk", trap: "drums-phonk", edm: "drums-tr505", classic: "drums-tr505" };
  var WSKIP = { kick: 1, snare: 1, hat: 1, open: 1, ride: 1, crash: 1, tom: 1 };   /* the world-percussion bank has no kit: only its hand percussion is used, the kick, snare and hats stay synthesized */
  var DRUMSKIP = { edm: { kick: 1 }, classic: { kick: 1 } };   /* these keep the synthesized kick: it is built to be heavier than the little drum machine's */
  /* instrument -> recording: bank, release, attack, sustained (loops), low bank for deep notes, ensemble (two detuned copies), amp-style distortion */
  var SMAP = {
    piano:   { bank: "piano", rel: .5, cost: 1 },
    guitar:  { bank: "guitar-acoustic", rel: .3, cost: 1 },
    eguitar: { bank: "guitar-electric", rel: .25, cost: 1 },
    lguitar: { bank: "guitar-electric", rel: .25, cost: 2, dist: 2.6 },
    dguitar: { bank: "guitar-electric", rel: .12, cost: 2, dist: 5 },
    ebass:   { bank: "bass-electric", rel: .12, cost: 1 },
    sax:     { bank: "saxophone", sus: 1, atk: .05, rel: .18, cost: 2 },
    brass:   { bank: "trumpet", sus: 1, atk: .04, rel: .15, cost: 2 },
    horns:   { bank: "trombone", sus: 1, atk: .06, rel: .2, cost: 2 },
    flute:   { bank: "flute", sus: 1, atk: .05, rel: .2, cost: 2 },
    violin:  { bank: "violin", sus: 1, atk: .07, rel: .25, cost: 2 },
    strings: { bank: "strings", sus: 1, atk: .2, rel: .45, cost: 3 },
    keys:    { bank: "epiano", rel: .3, cost: 1 },
    clav:    { bank: "clavinet", rel: .08, cost: 1 },
    marimba: { bank: "marimba", rel: .25, min: .35, cost: 1 },
    harp:    { bank: "harp", rel: .4, min: .7, cost: 1 },
    upbass:  { bank: "upright", rel: .1, cost: 1 },
    hammond: { bank: "drawbar", sus: 1, atk: .008, rel: .07, cost: 2 },
    organ:   { bank: "organ", sus: 1, atk: .04, rel: .25, cost: 2 },
    kalimba: { bank: "kalimba", rel: .4, min: .9, cost: 1 },
    bells:   { bank: "bells", rel: .6, min: 1.4, cost: 1 },
    choir:   { bank: "choir", sus: 1, atk: .45, rel: .9, cost: 3 },
    ooh:     { bank: "ooh", sus: 1, atk: .4, rel: .9, cost: 3 },
    synthchoir: { bank: "synthchoir", sus: 1, atk: .5, rel: 1, cost: 3 },
    mbira:   { bank: "mbira", rel: .3, min: 1.0, cost: 1 },
    balafon: { bank: "balafon", rel: .2, min: .6, cost: 1 },
    logdrum: { bank: "logdrum", rel: .3, min: .8, cost: 1 },
    cowbell: { bank: "cowbell", rel: .12, min: .25, cost: 1 },
    "808":   { bank: "bass808", rel: .12, min: .5, cost: 1, gl: 1 },
    whistle: { bank: "whistle", sus: 0, atk: .02, rel: .2, min: .3, cost: 1 },
    harmonica: { bank: "harmonica", rel: .15, min: .3, cost: 1 },
    fmpiano: { bank: "fmpiano", rel: .3, cost: 1 }
  };

  function Engine(ctx, dest, opts) {
    opts = opts || {};
    var E = { ctx: ctx, lite: !!opts.lite, bright: .5, grit: 0, duckDepth: 0 };
    var sr = ctx.sampleRate, solo = opts.solo || null, muted = opts.mute || [], i;
    E.out = ctx.createGain(); E.out.gain.value = 1; E.out.connect(dest);

    /* master chain: rumble filter -> tone -> glue compressor -> limiter */
    var premix = ctx.createGain(), hp = ctx.createBiquadFilter(), tone = ctx.createBiquadFilter(), glue = ctx.createDynamicsCompressor(), lim = ctx.createDynamicsCompressor(), trim = ctx.createGain();
    hp.type = "highpass"; hp.frequency.value = 42; hp.Q.value = .5;
    tone.type = "lowpass"; tone.frequency.value = 16000; tone.Q.value = .6;
    glue.threshold.value = -18; glue.knee.value = 14; glue.ratio.value = 3; glue.attack.value = .012; glue.release.value = .22;
    lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = .002; lim.release.value = .08;
    trim.gain.value = opts.trim || .4;
    /* last line of defence: a soft clipper so the output can never exceed full scale, whatever the mix does */
    var clip = ctx.createWaveShaper(), cc = new Float32Array(2048);
    for (i = 0; i < 2048; i++) { var cx = i / 1023.5 - 1; cc[i] = Math.tanh(cx * 1.15) / Math.tanh(1.15) * .97; }
    clip.curve = cc;
    /* tape wow and flutter: a short delay whose time wobbles slowly; depth is set per bar (zero for most styles) */
    var wow = ctx.createDelay(.05), wowLfo = ctx.createOscillator(), wowAmt = ctx.createGain();
    wow.delayTime.value = .012; wowLfo.frequency.value = .55; wowAmt.gain.value = 0; wowLfo.connect(wowAmt); wowAmt.connect(wow.delayTime); wowLfo.start(0); E.wowAmt = wowAmt;
    var eqS = ctx.createBiquadFilter(), eqM = ctx.createBiquadFilter(), eqP = ctx.createBiquadFilter();
    eqS.type = "lowshelf"; eqS.frequency.value = 70; eqM.type = "peaking"; eqM.frequency.value = 330; eqM.Q.value = .8; eqP.type = "highshelf"; eqP.frequency.value = 2500; eqS.gain.value = eqM.gain.value = eqP.gain.value = 0;
    premix.connect(wow); wow.connect(hp); hp.connect(eqS); eqS.connect(eqM); eqM.connect(eqP); eqP.connect(tone);
    if (E.lite) {
      /* lite mode skips the per-part compressors, so one wider master compressor brings it up to the same loudness as full quality */
      var lc = ctx.createDynamicsCompressor(); lc.threshold.value = -34; lc.knee.value = 12; lc.ratio.value = 3.5; lc.attack.value = .01; lc.release.value = .18;
      tone.connect(lc); lc.connect(glue);
    }
    else {
      /* three-band compression (Linkwitz-Riley crossovers) so the bass cannot pump the highs, plus a touch of parallel tube-style warmth */
      var biq = function (type, fc, from) { var a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(); a.type = b.type = type; a.frequency.value = b.frequency.value = fc; a.Q.value = b.Q.value = .7071; from.connect(a); a.connect(b); return b; };
      var band = function (src, th, ra, at, rl) { var c = ctx.createDynamicsCompressor(); c.threshold.value = th; c.knee.value = 10; c.ratio.value = ra; c.attack.value = at; c.release.value = rl; src.connect(c); return c; };
      var mh = biq("highpass", 150, tone), sumB = ctx.createGain();
      band(biq("lowpass", 150, tone), -24, 2.5, .03, .25).connect(sumB);
      band(biq("lowpass", 3800, mh), -22, 2.2, .015, .15).connect(sumB);
      band(biq("highpass", 3800, mh), -26, 1.8, .004, .08).connect(sumB);
      var wsh = ctx.createWaveShaper(), wc = new Float32Array(1024), whp = ctx.createBiquadFilter(), wlp = ctx.createBiquadFilter(), wg = ctx.createGain();
      for (i = 0; i < 1024; i++) { var wx = i / 512 - 1; wc[i] = Math.tanh(wx * 2.4) * .8 + .03 * wx * wx; }
      wsh.curve = wc; whp.type = "highpass"; whp.frequency.value = 180; wlp.type = "lowpass"; wlp.frequency.value = 5200; wg.gain.value = .07;
      tone.connect(wsh); wsh.connect(whp); whp.connect(wlp); wlp.connect(wg); wg.connect(sumB);
      sumB.connect(glue);
    }
    glue.connect(trim); trim.connect(lim); lim.connect(clip);
    /* DJ high-pass: sits last in the chain so a whole piece can have its bass swept out or in during a mix */
    var djhp = ctx.createBiquadFilter(); djhp.type = "highpass"; djhp.frequency.value = 10; djhp.Q.value = .7; clip.connect(djhp);
    /* DJ rack after the high-pass: a resonant low-pass (filter sweeps), a gate (beat rolls, stutters, hard cuts) and a tempo-synced echo whose tail outlives the dry signal */
    var djlp = ctx.createBiquadFilter(); djlp.type = "lowpass"; djlp.frequency.value = 22000; djlp.Q.value = .7;
    var djgate = ctx.createGain(); djgate.gain.value = 1;
    var djsend = ctx.createGain(), djdl = ctx.createDelay(2.5), djfb = ctx.createGain(), djef = ctx.createBiquadFilter(), djeo = ctx.createGain();
    djsend.gain.value = 0; djdl.delayTime.value = .4; djfb.gain.value = .5; djef.type = "lowpass"; djef.frequency.value = 4200; djeo.gain.value = .9;
    djhp.connect(djlp); djlp.connect(djgate); djgate.connect(E.out);
    djlp.connect(djsend); djsend.connect(djdl); djdl.connect(djef); djef.connect(djfb); djfb.connect(djdl); djef.connect(djeo); djeo.connect(E.out);
    E.djSet = function (f, t) { djhp.frequency.cancelScheduledValues(0); djhp.frequency.setValueAtTime(Math.max(10, f), t); };
    E.djSweep = function (t0, dur, from, to) { var f = djhp.frequency; f.cancelScheduledValues(t0); f.setValueAtTime(Math.max(10, from), t0); f.exponentialRampToValueAtTime(Math.max(10, to), t0 + dur); };
    E.djLP = function (t0, dur, from, to, q) { var f = djlp.frequency; f.cancelScheduledValues(t0); f.setValueAtTime(clamp(from, 60, 22000), t0); f.exponentialRampToValueAtTime(clamp(to, 60, 22000), t0 + Math.max(.02, dur)); if (q !== undefined) { djlp.Q.cancelScheduledValues(t0); djlp.Q.setValueAtTime(q, t0); } };
    E.djLPset = function (f, t, q) { djlp.frequency.cancelScheduledValues(t); djlp.frequency.setValueAtTime(clamp(f, 60, 22000), t); djlp.Q.cancelScheduledValues(t); djlp.Q.setValueAtTime(q || .7, t); };
    E.djGateSet = function (t, v, ramp) { var g = djgate.gain; g.cancelScheduledValues(t); g.setValueAtTime(Math.max(.0001, g.value), t); g.linearRampToValueAtTime(Math.max(.0001, v), t + (ramp || .005)); };
    /* beat roll / stutter: the gate chops the signal faster and faster; rates are notes per beat for each equal slice of [t0, t1] */
    E.djChop = function (t0, t1, beat, rates, endV) {
      var g = djgate.gain, seg = (t1 - t0) / rates.length, i, tt, st; g.cancelScheduledValues(t0); g.setValueAtTime(1, t0);
      for (i = 0; i < rates.length; i++) { st = beat / rates[i]; for (tt = t0 + i * seg; tt < t0 + (i + 1) * seg - 1e-3; tt += st) { g.setValueAtTime(1, tt); g.setValueAtTime(.0001, tt + st * .55); } }
      g.setValueAtTime(Math.max(.0001, endV === undefined ? .0001 : endV), t1);
    };
    E.djEchoOn = function (t, beat, mult, fb, lvl) { djdl.delayTime.setValueAtTime(clamp(beat * mult, .05, 2.4), t); djfb.gain.setValueAtTime(clamp(fb, 0, .8), t); djsend.gain.cancelScheduledValues(t); djsend.gain.setValueAtTime(djsend.gain.value, t); djsend.gain.linearRampToValueAtTime(lvl, t + .03); };
    E.djEchoOff = function (t, ramp) { djsend.gain.cancelScheduledValues(t); djsend.gain.setValueAtTime(Math.max(.0001, djsend.gain.value), t); djsend.gain.linearRampToValueAtTime(0, t + (ramp || .04)); };
    E.djBump = function (t0, dur, hz) { var f = djhp.frequency; f.setValueAtTime(10, t0); f.exponentialRampToValueAtTime(hz, t0 + dur * .8); f.setValueAtTime(10, t0 + dur); };
    /* equal-power level curve for crossfades (up: 0->1, down: 1->0) */
    E.xfade = function (t0, dur, up) {
      var n = 48, c = new Float32Array(n), q; for (q = 0; q < n; q++) { var x = q / (n - 1); c[q] = up ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2); }
      E.out.gain.cancelScheduledValues(0); E.out.gain.setValueAtTime(up ? .0001 : 1, Math.max(0, t0 - .02)); E.out.gain.setValueCurveAtTime(c, t0, dur);
    };

    /* reverb */
    var rvIn = ctx.createGain(), conv = ctx.createConvolver(), rvOut = ctx.createGain();
    conv.buffer = makeIR(ctx, E.lite ? 1.8 : 3.2, .9); rvOut.gain.value = .9;
    /* the reverb return is pre-delayed and band-limited so it adds space without muddying the mix */
    var rvPre = ctx.createDelay(.1), rvHp = ctx.createBiquadFilter(), rvLp = ctx.createBiquadFilter();
    rvPre.delayTime.value = .018; rvHp.type = "highpass"; rvHp.frequency.value = 220; rvLp.type = "lowpass"; rvLp.frequency.value = 8000;
    rvIn.connect(rvPre); rvPre.connect(conv); conv.connect(rvHp); rvHp.connect(rvLp); rvLp.connect(rvOut); rvOut.connect(premix);
    /* ping-pong delay (dotted eighth) */
    var dIn = ctx.createGain(), dl = ctx.createDelay(2), dr = ctx.createDelay(2), f1 = ctx.createGain(), f2 = ctx.createGain(), dlp = ctx.createBiquadFilter(), mg = ctx.createChannelMerger(2), dOut = ctx.createGain();
    dlp.type = "lowpass"; dlp.frequency.value = 3200; f1.gain.value = E.lite ? .25 : .36; f2.gain.value = E.lite ? .25 : .36; dOut.gain.value = .8;
    dl.delayTime.value = .4; dr.delayTime.value = .4;
    dIn.connect(dl); dl.connect(mg, 0, 0); dl.connect(dlp); dlp.connect(f1); f1.connect(dr); dr.connect(mg, 0, 1); dr.connect(f2); f2.connect(dl); mg.connect(dOut); dOut.connect(premix);

    /* strips */
    E.strips = {}; var ducks = [];
    Object.keys(STRIPS).forEach(function (name) {
      var c = STRIPS[name], inn = ctx.createGain(), lvl = ctx.createGain(), rv = ctx.createGain(), dy = ctx.createGain(), node = inn, dk = null;
      lvl.gain.value = c.lvl;
      if (c.duck > 0) { dk = ctx.createGain(); inn.connect(dk); node = dk; ducks.push({ g: dk, k: c.duck }); }
      var last = node;
      var hf = null, ts = ctx.createBiquadFilter();
      if (c.hp) { hf = ctx.createBiquadFilter(); hf.type = "highpass"; hf.frequency.value = c.hp; hf.Q.value = .6; last.connect(hf); last = hf; }
      if (c.pk) { var pf = ctx.createBiquadFilter(); pf.type = "peaking"; pf.frequency.value = c.pk[0]; pf.gain.value = c.pk[1]; pf.Q.value = c.pk[2] || .9; last.connect(pf); last = pf; }
      ts.type = "highshelf"; ts.frequency.value = 3000; ts.gain.value = 0; last.connect(ts); last = ts;
      if (c.cmp && !E.lite) { var cm = ctx.createDynamicsCompressor(); cm.threshold.value = c.cmp[0]; cm.ratio.value = c.cmp[1]; cm.attack.value = c.cmp[2]; cm.release.value = c.cmp[3]; cm.knee.value = 8; last.connect(cm); last = cm; }
      last.connect(lvl); lvl.connect(premix);
      rv.gain.value = c.rv; dy.gain.value = c.dy;
      lvl.connect(rv); rv.connect(rvIn); lvl.connect(dy); dy.connect(dIn);
      E.strips[name] = { in: inn, lvl: lvl, rv: rv, dy: dy, cfg: c, pan: undefined, hf: hf, ts: ts };
    });
    function kickDuck(t) {
      if (E.duckDepth <= 0) return;
      for (var k = 0; k < ducks.length; k++) {
        var g = ducks[k].g.gain, depth = clamp(E.duckDepth * ducks[k].k, 0, .8);
        g.setTargetAtTime(1 - depth, t, .004); g.setTargetAtTime(1, t + .035, .09);
      }
    }
    /* vibrato shared by every sustained voice (one LFO, many listeners) */
    var vibLfo = ctx.createOscillator(), vib = ctx.createGain(); vibLfo.frequency.value = 5.2; vib.gain.value = 6; vibLfo.connect(vib); vibLfo.start(0); E.vib = vib;
    /* noise + plucked-string buffers */
    var noiseBuf = ctx.createBuffer(1, sr * 2, sr), nd = noiseBuf.getChannelData(0), seed = 1234567;
    for (i = 0; i < nd.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; nd[i] = (seed / 4294967296) * 2 - 1; }
    var ksCache = {};
    E.ks = function (f, damp, seconds, pluckPos) {
      var key = Math.round(f * 100) + ":" + damp + ":" + seconds + ":" + pluckPos;
      if (ksCache[key]) return ksCache[key];
      var N = Math.max(2, Math.round(44100 / f + .5)), bsr = f * (N - .5), n = Math.round(bsr * seconds), buf = ctx.createBuffer(1, n, bsr), d = buf.getChannelData(0), line = new Float32Array(N), sd = 22695477 + N, q;
      for (q = 0; q < N; q++) { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; line[q] = (sd / 4294967296) * 2 - 1; }
      if (pluckPos > 0) { var kk = Math.max(1, Math.round(N * pluckPos)), tmp = new Float32Array(N); for (q = 0; q < N; q++) tmp[q] = line[q] - line[(q + kk) % N]; line = tmp; }
      for (q = 0; q < n; q++) { var idx = q % N, nx = (idx + 1) % N, y = line[idx]; d[q] = y; line[idx] = damp * .5 * (y + line[nx]); }
      ksCache[key] = buf; return buf;
    };
    E.noise = function (t, dur, type, freq, q, peak, decay, out) {
      var s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
      g.gain.setValueAtTime(Math.max(.0002, peak), t); g.gain.exponentialRampToValueAtTime(.0001, t + decay);
      s.connect(fl); fl.connect(g); g.connect(out); s.start(t, Math.random() * 1.2); s.stop(t + dur);
    };
    E.tone = function (t, type, f0, f1, fdur, peak, decay, out) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + fdur);
      g.gain.setValueAtTime(Math.max(.0002, peak), t); g.gain.exponentialRampToValueAtTime(.0001, t + decay);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + decay + .05);
    };
    /* pre-rendered noise hits: synthesized once into a buffer, so every later hit is just a source + a gain */
    var sampleCache = {};
    function biquadInPlace(x, type, fc, q) {
      var w0 = 2 * Math.PI * Math.min(fc, sr * .45) / sr, cw = Math.cos(w0), al = Math.sin(w0) / (2 * q), b0, b1, b2, a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
      if (type === "highpass") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; } else { b0 = al; b1 = 0; b2 = -al; }
      b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
      var x1 = 0, x2 = 0, y1 = 0, y2 = 0, n = x.length, k, y;
      for (k = 0; k < n; k++) { y = b0 * x[k] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[k]; y2 = y1; y1 = y; x[k] = y; }
    }
    E.noiseSample = function (key, parts) {
      if (sampleCache[key]) return sampleCache[key];
      var total = 0, q; parts.forEach(function (p) { total = Math.max(total, p.at + p.sec); });
      var n = Math.floor(sr * total), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0), sd = 4242 + key.length;
      parts.forEach(function (p) {
        var m = Math.floor(sr * p.sec), x = new Float32Array(m), off = Math.floor(sr * p.at);
        for (q = 0; q < m; q++) { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; x[q] = (sd / 4294967296) * 2 - 1; }
        biquadInPlace(x, p.type, p.fc, p.q);
        var k = 6.9078 / p.decay; for (q = 0; q < m && off + q < n; q++) d[off + q] += x[q] * p.peak * Math.exp(-k * q / sr);
      });
      return (sampleCache[key] = buf);
    };
    E.playSample = function (buf, t, v, o) {
      var s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; g.gain.value = v; s.connect(g); g.connect(o); s.start(t);
    };
    /* curGl: slide in from this many semitones away; curDet: a few cents of natural pitch wander per note. Both are set around each note. */
    E.curGl = 0; E.curDet = 0;
    E.osc = function (type, f, t, t1, detune) {
      var o = ctx.createOscillator(); o.type = type;
      if (E.curGl) { o.frequency.setValueAtTime(f * Math.pow(2, E.curGl / 12), t); o.frequency.exponentialRampToValueAtTime(f, t + .07); } else o.frequency.value = f;
      var dt = (detune || 0) + E.curDet; if (dt) o.detune.value = dt; o.start(t); o.stop(t1); return o;
    };

    /* gritty bass path (anger): voices go through a soft clipper */
    var grit = ctx.createWaveShaper(), gritIn = ctx.createGain(), curve = new Float32Array(1024);
    for (i = 0; i < 1024; i++) { var xx = i / 512 - 1; curve[i] = Math.tanh(xx * 3.2) * .9; }
    var gritOut = ctx.createGain(); gritOut.gain.value = .6; grit.curve = curve; gritIn.connect(grit); grit.connect(gritOut); gritOut.connect(E.strips.bass.in);
    E.bassOut = function () { return E.grit > 0 ? gritIn : E.strips.bass.in; };

    /* textures: vinyl crackle, rain and air loop quietly under the music */
    var tex = {};
    function texBuffer(kind) {
      var n = sr * (kind === "air" ? 6 : 4), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), q, y = 0, s2 = kind === "vinyl" ? 99 : kind === "rain" ? 555 : 777;
      for (q = 0; q < n; q++) {
        s2 = (Math.imul(s2, 1664525) + 1013904223) >>> 0; var r = (s2 / 4294967296) * 2 - 1;
        if (kind === "vinyl") { d[q] = r * .006 + (Math.abs(r) > .9985 ? r * 1.2 : 0); if (q > 0 && Math.abs(d[q - 1]) > .5) d[q] += d[q - 1] * -.6; }
        else if (kind === "rain") { y = y * .35 + r * .65; d[q] = y * (.55 + .45 * Math.sin(q / sr * 6.2832 * 3.5) * Math.sin(q / sr * 6.2832 * 1.5)); }
        else { y = y * .985 + r * .015; d[q] = y * (.55 + .45 * Math.sin(q / n * 6.2832 * 2)) * 9; }
      }
      return b;
    }
    function ensureTex(kind) {
      if (tex[kind]) return tex[kind];
      var src = ctx.createBufferSource(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
      src.buffer = texBuffer(kind); src.loop = true;
      if (kind === "vinyl") { fl.type = "highpass"; fl.frequency.value = 900; }
      else if (kind === "rain") { fl.type = "bandpass"; fl.frequency.value = 3200; fl.Q.value = .35; }
      else { fl.type = "lowpass"; fl.frequency.value = 900; }
      g.gain.value = 0; src.connect(fl); fl.connect(g); g.connect(E.strips.tex.in); src.start(0);
      return (tex[kind] = { src: src, g: g });
    }

    /* ── instruments: (engine, frequency, start, seconds, loudness, out) ── */
    var satCurve = new Float32Array(1024);
    for (i = 0; i < 1024; i++) satCurve[i] = Math.tanh((i / 512 - 1) * 4) * .8;
    var INST = {};
    INST.piano = function (E, f, t, d, v, o) {
      var tau = clamp(3.2 - .55 * Math.log(f / 110) / Math.LN2, .6, 3.2), dur = Math.min(3.2, .5 + d * 1.3 + tau * .5), top = E.lite ? 2 : clamp(Math.floor(5000 / f), 3, 5), n;
      for (n = 1; n <= top; n++) {
        var os = ctx.createOscillator(), g = ctx.createGain(); os.type = "sine"; os.frequency.value = f * n * Math.sqrt(1 + .0004 * n * n);
        var a = (n % 2 === 0 ? .7 : 1) / Math.pow(n, 1.2) * .5 * v;
        g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(Math.max(.0003, a), t + .004); g.gain.exponentialRampToValueAtTime(.0001, t + dur / (1 + .55 * (n - 1)));
        os.connect(g); g.connect(o); os.start(t); os.stop(t + dur + .05);
      }
      if (!E.lite) E.noise(t, .06, "bandpass", Math.min(4000, f * 6), 1.2, .07 * v, .03, o);
    };
    INST.keys = function (E, f, t, d, v, o) {
      var c = ctx.createOscillator(), m = ctx.createOscillator(), mgn = ctx.createGain(), g = ctx.createGain(), dur = Math.min(2.6, .8 + d * 1.5);
      c.type = "sine"; c.frequency.value = f; m.type = "sine"; m.frequency.value = f;
      mgn.gain.setValueAtTime(f * 2.4, t); mgn.gain.exponentialRampToValueAtTime(f * .12, t + .55); m.connect(mgn); mgn.connect(c.frequency);
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.6 * v, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      c.connect(g); g.connect(o); c.start(t); m.start(t); c.stop(t + dur + .05); m.stop(t + dur + .05);
    };
    function pluckVoice(E, f, t, d, v, o, damp, secs, pos, cutoff, holdMul, minHold, peak) {
      var src = ctx.createBufferSource(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), hold = Math.max(minHold, d * holdMul);
      src.buffer = E.ks(f, damp, E.lite ? Math.min(secs, 1.1) : secs, pos); lp.type = "lowpass"; lp.frequency.value = cutoff; lp.Q.value = .7;
      g.gain.setValueAtTime(peak * v, t); g.gain.setValueAtTime(peak * v, t + hold); g.gain.exponentialRampToValueAtTime(.0001, t + hold + .5);
      src.connect(lp); lp.connect(g); g.connect(o); src.start(t); src.stop(t + hold + .55);
    }
    INST.guitar = function (E, f, t, d, v, o) { pluckVoice(E, f, t, d, v, o, .9972, 1.8, .14, 3600, 2, .45, .9); };
    INST.pluck = function (E, f, t, d, v, o) {
      pluckVoice(E, f, t, d, v, o, .9945, 1.4, 0, 900, 1.3, .25, 1.1);
      var sub = ctx.createOscillator(), sg = ctx.createGain(), hold = Math.max(.25, d * 1.3);
      sub.type = "sine"; sub.frequency.value = f; sg.gain.setValueAtTime(.0001, t); sg.gain.linearRampToValueAtTime(.4 * v, t + .01); sg.gain.exponentialRampToValueAtTime(.0001, t + hold + .25);
      sub.connect(sg); sg.connect(o); sub.start(t); sub.stop(t + hold + .3);
    };
    /* banjo: a bright, quickly fading pluck with a drum-head thump. mandolin: paired strings that tremolo on long notes. pedal steel: a sliding, singing sustain with late vibrato */
    INST.banjo = function (E, f, t, d, v, o) {
      pluckVoice(E, f, t, d, v, o, .9915, .9, .05, 7500, .9, .15, 1);
      var th = ctx.createOscillator(), tg = ctx.createGain(); th.type = "sine"; th.frequency.setValueAtTime(f * 1.5, t); th.frequency.exponentialRampToValueAtTime(f * .9, t + .05);
      tg.gain.setValueAtTime(.18 * v, t); tg.gain.exponentialRampToValueAtTime(.0001, t + .07); th.connect(tg); tg.connect(o); th.start(t); th.stop(t + .1);
    };
    INST.mandolin = function (E, f, t, d, v, o) {
      var n = d > .45 ? Math.min(E.lite ? 3 : 5, Math.floor(d / .11)) : 1, k;
      for (k = 0; k < Math.max(1, n); k++) { var tt = t + k * .11 + (k ? Math.random() * .012 : 0), vv = v * (k ? .5 : 1); pluckVoice(E, f, tt, .12, vv, o, .9925, .8, .06, 6500, 1, .12, .8); pluckVoice(E, f * 1.0035, tt, .12, vv * .8, o, .9925, .8, .1, 6500, 1, .12, .6); }
    };
    INST.steel = function (E, f, t, d, v, o) {
      var hold = Math.max(.35, d), end = t + hold + .55, g = ctx.createGain(), lp = ctx.createBiquadFilter(), a = E.osc("sawtooth", f, t, end, -5), b = E.osc("triangle", f * 2, t, end, 4), bg = ctx.createGain();
      var chord = d > 1.6, sl = chord ? 0 : -110;
      if (sl) { a.detune.setValueAtTime(sl, t); a.detune.linearRampToValueAtTime(-5, t + .12); b.detune.setValueAtTime(sl, t); b.detune.linearRampToValueAtTime(4, t + .12); }
      lateVib(E, a, t, chord ? 6 : 12, .35); lateVib(E, b, t, chord ? 6 : 12, .35);
      lp.type = "lowpass"; lp.frequency.setValueAtTime(900, t); lp.frequency.linearRampToValueAtTime(2600, t + .25); lp.Q.value = 1.1; bg.gain.value = .35;
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.45 * v, t + (chord ? .3 : .05)); g.gain.setValueAtTime(.45 * v, t + hold); g.gain.exponentialRampToValueAtTime(.0001, t + hold + .5);
      a.connect(lp); b.connect(bg); bg.connect(lp); lp.connect(g); g.connect(o);
    };
    INST.harp = function (E, f, t, d, v, o) { pluckVoice(E, f, t, d, v, o, .9985, 2.4, .16, 4200, 2.2, .5, .85); };
    INST.kalimba = function (E, f, t, d, v, o) {
      var dur = .9 + d * .15, a = ctx.createOscillator(), ag = ctx.createGain(), b = ctx.createOscillator(), bg = ctx.createGain();
      a.type = "sine"; a.frequency.value = f; b.type = "sine"; b.frequency.value = f * 5.42;
      ag.gain.setValueAtTime(.0001, t); ag.gain.linearRampToValueAtTime(.55 * v, t + .002); ag.gain.exponentialRampToValueAtTime(.0001, t + dur);
      bg.gain.setValueAtTime(.0001, t); bg.gain.linearRampToValueAtTime(.13 * v, t + .002); bg.gain.exponentialRampToValueAtTime(.0001, t + dur * .2);
      a.connect(ag); ag.connect(o); b.connect(bg); bg.connect(o); a.start(t); b.start(t); a.stop(t + dur + .05); b.stop(t + dur * .2 + .05);
      if (!E.lite) E.noise(t, .03, "bandpass", Math.min(6000, f * 4), 2, .03 * v, .015, o);
    };
    INST.marimba = function (E, f, t, d, v, o) {
      var parts = E.lite ? [[1, .6, .75], [4, .22, .12]] : [[1, .6, .75], [4, .22, .12], [9.9, .06, .04]];
      parts.forEach(function (p) {
        var os = ctx.createOscillator(), g = ctx.createGain(); os.type = "sine"; os.frequency.value = f * p[0];
        g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(p[1] * v, t + .002); g.gain.exponentialRampToValueAtTime(.0001, t + p[2]);
        os.connect(g); g.connect(o); os.start(t); os.stop(t + p[2] + .05);
      });
      if (!E.lite) E.noise(t, .03, "bandpass", Math.min(5000, f * 5), 1.5, .05 * v, .02, o);
    };
    INST.bells = function (E, f, t, d, v, o) {
      var parts = [[1, 1, 3.4], [2.756, .55, 2.4], [5.404, .3, 1.6], [8.933, .17, 1.0], [13.34, .08, .6]], n = E.lite ? 2 : 4;
      for (var q = 0; q < n; q++) {
        var p = parts[q], os = ctx.createOscillator(), g = ctx.createGain(); os.type = "sine"; os.frequency.value = f * p[0];
        g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.32 * p[1] * v, t + .003); g.gain.exponentialRampToValueAtTime(.0001, t + p[2]);
        os.connect(g); g.connect(o); os.start(t); os.stop(t + p[2] + .05);
      }
    };
    INST.organ = function (E, f, t, d, v, o) {
      var bars = E.lite ? [[1, 1], [2, .6]] : [[.5, .45], [1, 1], [2, .7], [3, .4]], hold = Math.max(.2, d), g = ctx.createGain();
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.2 * v, t + .012); g.gain.setValueAtTime(.2 * v, t + hold); g.gain.exponentialRampToValueAtTime(.0001, t + hold + .14); g.connect(o);
      bars.forEach(function (b) { var os = E.osc("sine", f * b[0], t, t + hold + .2); var bg = ctx.createGain(); bg.gain.value = b[1]; os.connect(bg); bg.connect(g); });
    };
    function sustained(E, f, t, d, v, o, type, detunes, cutoff, atk, rel, peak, sweepFrom) {
      var hold = Math.max(.3, d), end = t + hold + rel + .1, lp = ctx.createBiquadFilter(), g = ctx.createGain();
      lp.type = "lowpass"; lp.Q.value = .6;
      if (sweepFrom) { lp.frequency.setValueAtTime(sweepFrom, t); lp.frequency.exponentialRampToValueAtTime(cutoff, t + Math.min(atk * 1.6, hold)); } else lp.frequency.value = cutoff;
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(peak * v, t + atk); g.gain.setValueAtTime(peak * v, t + hold); g.gain.exponentialRampToValueAtTime(.0001, t + hold + rel);
      detunes.forEach(function (dt) { var os = E.osc(type, f, t, end, dt); E.vib.connect(os.detune); os.connect(lp); });
      lp.connect(g); g.connect(o);
    }
    INST.strings = function (E, f, t, d, v, o) { sustained(E, f, t, d, v, o, "sawtooth", [-8, 8], clamp(1400 + f * 2.5, 1500, 4500) * (.6 + E.bright * .8), .35, .8, .15); };
    INST.pad = function (E, f, t, d, v, o) {
      sustained(E, f, t, d, v, o, "sawtooth", [-9, 9], (900 + E.bright * 1100), .6, 1.2, .13, 450);
      var sub = E.osc("sine", f, t, t + Math.max(.3, d) + 1.3), sg = ctx.createGain(); sg.gain.setValueAtTime(.0001, t); sg.gain.linearRampToValueAtTime(.1 * v, t + .6); sg.gain.setValueAtTime(.1 * v, t + Math.max(.3, d)); sg.gain.exponentialRampToValueAtTime(.0001, t + Math.max(.3, d) + 1.2);
      sub.connect(sg); sg.connect(o);
    };
    INST.choir = function (E, f, t, d, v, o) {
      var hold = Math.max(.4, d), end = t + hold + 1, g = ctx.createGain(), forms = [[800, 1.2, .9], [1150, 2, .5], [2900, 5, .22]];
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.45 * v, t + .5); g.gain.setValueAtTime(.45 * v, t + hold); g.gain.exponentialRampToValueAtTime(.0001, t + hold + .9); g.connect(o);
      var srcs = [E.osc("sawtooth", f, t, end, -6), E.osc("sawtooth", f, t, end, 6)];
      srcs.forEach(function (os) { E.vib.connect(os.detune); });
      forms.forEach(function (fm) { var bp = ctx.createBiquadFilter(), fg = ctx.createGain(); bp.type = "bandpass"; bp.frequency.value = fm[0]; bp.Q.value = fm[1] * 4; fg.gain.value = fm[2]; srcs.forEach(function (os) { os.connect(bp); }); bp.connect(fg); fg.connect(g); });
    };
    /* a sung voice: a buzzing glottal source shaped by vowel formants. Vowels are [F1, F2, F3] with gains; the vowel can morph during the note. */
    var VOWELS = { a: [[800, 1, .9], [1150, 2, .55], [2900, 4, .22]], o: [[500, 1, .9], [800, 1.6, .6], [2830, 4, .16]], u: [[325, 1, 1], [700, 1.6, .45], [2530, 4, .1]],
                   e: [[530, 1, .9], [1840, 2, .5], [2480, 4, .2]], i: [[270, 1, 1], [2300, 2, .4], [3000, 4, .22]], m: [[260, 1, 1], [1100, 3, .12], [2500, 4, .05]] };
    function sing(E, f, t, d, v, o, c) {
      var hold = Math.max(.35, d), atk = c.atk, rel = c.rel, end = t + hold + rel + .1, g = ctx.createGain(), src = ctx.createGain(), peak = c.peak * v, i, V1 = VOWELS[c.v1], V2 = VOWELS[c.v2 || c.v1];
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(peak, t + atk); g.gain.setValueAtTime(peak, t + hold); g.gain.exponentialRampToValueAtTime(.0001, t + hold + rel);
      var n = E.lite ? 1 : c.voices, k;
      for (k = 0; k < n; k++) {
        var det = n === 1 ? 0 : (k - (n - 1) / 2) * 9 + (Math.random() - .5) * 4, os = E.osc("sawtooth", f, t, end, det); lateVib(E, os, t, c.vib, c.vdelay); os.connect(src);
      }
      var shape = ctx.createBiquadFilter(); shape.type = "lowpass"; shape.frequency.value = clamp(f * 9, 1800, 6500); shape.Q.value = .5; src.gain.value = 1 / Math.sqrt(n); src.connect(shape);
      for (i = 0; i < 3; i++) {
        var bp = ctx.createBiquadFilter(), fg = ctx.createGain(), f1 = V1[i][0] * (i === 0 ? Math.max(1, f * 1.05 / V1[0][0]) : 1), f2 = V2[i][0] * (i === 0 ? Math.max(1, f * 1.05 / V2[0][0]) : 1);
        bp.type = "bandpass"; bp.frequency.setValueAtTime(f1, t); if (c.v2 && c.v2 !== c.v1) { bp.frequency.setValueAtTime(f1, t + hold * .55); bp.frequency.linearRampToValueAtTime(f2, t + hold); }
        bp.Q.value = V1[i][1] * 5 + 2; fg.gain.value = V1[i][2]; shape.connect(bp); bp.connect(fg); fg.connect(g);
      }
      if (c.breath && !E.lite) E.noise(t, hold + .1, "bandpass", clamp(f * 4, 1500, 5500), 1.2, c.breath * v, hold + .1, o);
      g.connect(o);
    }
    INST.vox = function (E, f, t, d, v, o) { sing(E, f, t, d, v, o, { v1: "a", v2: d > .7 ? "o" : "a", atk: .09, rel: .35, peak: .5, voices: 2, vib: 1.5, vdelay: .3, breath: .03 }); };
    INST.hum = function (E, f, t, d, v, o) { sing(E, f, t, d, v, o, { v1: "m", atk: .18, rel: .5, peak: .6, voices: 2, vib: 1.2, vdelay: .4, breath: .01 }); };
    INST.ooh = function (E, f, t, d, v, o) { sing(E, f, t, d, v, o, { v1: "u", v2: "o", atk: .4, rel: .9, peak: .45, voices: 3, vib: .9, vdelay: .5, breath: .015 }); };
    INST.synthchoir = function (E, f, t, d, v, o) { INST.choir(E, f, t, d, v, o); };
    INST.flute = function (E, f, t, d, v, o) {
      var hold = Math.max(.25, d), end = t + hold + .3, g = ctx.createGain(), a = E.osc("sine", f, t, end), b = E.osc("sine", f * 2, t, end), bg = ctx.createGain();
      E.vib.connect(a.detune); g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.5 * v, t + .07); g.gain.setValueAtTime(.5 * v, t + hold); g.gain.exponentialRampToValueAtTime(.0001, t + hold + .15);
      bg.gain.value = .1; a.connect(g); b.connect(bg); bg.connect(g); g.connect(o);
      E.noise(t, hold + .1, "bandpass", Math.min(7000, f * 3), 1.1, .045 * v, hold + .1, o);
    };
    /* vibrato that fades in after the note settles, like a player would (depth in cents multiplier) */
    function lateVib(E, os, t, depth, delay) {
      var vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.setValueAtTime(0, t + delay); vg.gain.linearRampToValueAtTime(depth, t + delay + .35); E.vib.connect(vg); vg.connect(os.detune);
    }
    INST.sax = function (E, f, t, d, v, o) {
      var hold = Math.max(.25, d), end = t + hold + .25, g = ctx.createGain(), lp = ctx.createBiquadFilter(), hon = ctx.createBiquadFilter(), body = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.Q.value = .9; lp.frequency.setValueAtTime(Math.min(3200, f * 4 + 500), t); lp.frequency.linearRampToValueAtTime(Math.min(4200, f * 6 + 900), t + .1); lp.frequency.linearRampToValueAtTime(Math.min(2600, f * 4 + 600), t + hold);
      hon.type = "peaking"; hon.frequency.value = 1150; hon.Q.value = 1.4; hon.gain.value = 7;
      body.type = "peaking"; body.frequency.value = 2400; body.Q.value = 1; body.gain.value = 3;
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.55 * v, t + .05); g.gain.setValueAtTime(.55 * v, t + hold * .85); g.gain.exponentialRampToValueAtTime(.0001, t + hold + .18);
      var a = E.osc("sawtooth", f, t, end, 0), b = E.osc("square", f, t, end, 6), bg = ctx.createGain(); bg.gain.value = .35;
      /* reed scoop: pitch rises into the note */
      [a, b].forEach(function (os) { if (!E.curGl) { os.frequency.setValueAtTime(f * .965, t); os.frequency.exponentialRampToValueAtTime(f, t + .045); } lateVib(E, os, t, 2.4, .22); });
      a.connect(lp); b.connect(bg); bg.connect(lp); lp.connect(hon); hon.connect(body); body.connect(g); g.connect(o);
      E.noise(t, hold + .1, "bandpass", Math.min(6000, f * 4 + 800), 1.4, .05 * v, hold + .1, o);
    };
    INST.violin = function (E, f, t, d, v, o) {
      var hold = Math.max(.3, d), end = t + hold + .3, g = ctx.createGain(), lp = ctx.createBiquadFilter(), b1 = ctx.createBiquadFilter(), b2 = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.Q.value = .7; lp.frequency.setValueAtTime(Math.min(3000, f * 3 + 700), t); lp.frequency.linearRampToValueAtTime(clamp(f * 6 + 800, 2200, 6000), t + .25);
      b1.type = "peaking"; b1.frequency.value = 450; b1.Q.value = 1.2; b1.gain.value = 5;
      b2.type = "peaking"; b2.frequency.value = 2900; b2.Q.value = 1.5; b2.gain.value = 4;
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.5 * v, t + .11); g.gain.setValueAtTime(.5 * v, t + hold * .9); g.gain.exponentialRampToValueAtTime(.0001, t + hold + .28);
      var dts = E.lite ? [0] : [-5, 5];
      dts.forEach(function (dt) { var os = E.osc("sawtooth", f, t, end, dt); lateVib(E, os, t, 4.2, .18); os.connect(lp); });
      lp.connect(b1); b1.connect(b2); b2.connect(g); g.connect(o);
      /* bow noise: a short scrape at the start, a quiet hiss while it sounds */
      E.noise(t, .09, "highpass", 3500, .8, .07 * v, .09, o);
      E.noise(t, hold + .1, "bandpass", Math.min(7000, f * 5), 1.2, .02 * v, hold + .1, o);
    };
    INST.brass = function (E, f, t, d, v, o) { sustained(E, f, t, d, v, o, "sawtooth", [-4, 4], Math.min(5000, 900 + f * 5), .04, .15, .3, 350); };
    INST.synth = function (E, f, t, d, v, o) {
      var dec = clamp(d * 1.1, .12, 1.2), a = E.osc("triangle", f, t, t + dec + .1), b = E.osc("square", f * 1.004, t, t + dec + .1), gb = ctx.createGain(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      gb.gain.value = .18; lp.type = "lowpass"; lp.frequency.value = 2600; lp.Q.value = 1;
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.55 * v, t + .006); g.gain.exponentialRampToValueAtTime(.0001, t + dec);
      a.connect(lp); b.connect(gb); gb.connect(lp); lp.connect(g); g.connect(o);
    };
    INST.sub = function (E, f, t, d, v, o) {
      var hold = Math.max(.15, d * .95), end = t + hold + .2, g = ctx.createGain(), a = E.osc("sine", f, t, end), b = E.osc("triangle", f * 2, t, end), bg = ctx.createGain();
      bg.gain.value = .38; g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.9 * v, t + .008); g.gain.setValueAtTime(.9 * v, t + hold); g.gain.exponentialRampToValueAtTime(.0001, t + hold + .12);
      a.connect(g); b.connect(bg); bg.connect(g); g.connect(o);
    };
    INST["808"] = function (E, f, t, d, v, o) {
      var dur = clamp(d * 1.25, .5, 2.4), end = t + dur, os = ctx.createOscillator(), g = ctx.createGain(), h = ctx.createOscillator(), hg = ctx.createGain();
      os.type = "sine";
      if (E.curGl) { os.frequency.setValueAtTime(f * Math.pow(2, E.curGl / 12), t); os.frequency.exponentialRampToValueAtTime(f, t + .11); } else { os.frequency.setValueAtTime(f * 2.2, t); os.frequency.exponentialRampToValueAtTime(f, t + .05); }
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.95 * v, t + .004); g.gain.exponentialRampToValueAtTime(.5 * v, t + dur * .45); g.gain.exponentialRampToValueAtTime(.0001, end);
      h.type = "triangle"; h.frequency.value = f * 2; hg.gain.setValueAtTime(.22 * v, t); hg.gain.exponentialRampToValueAtTime(.0001, t + dur * .45);
      var sh = ctx.createWaveShaper(), shg = ctx.createGain(); sh.curve = satCurve; shg.gain.value = .16;
      os.connect(g); g.connect(o); g.connect(sh); sh.connect(shg); shg.connect(o); h.connect(hg); hg.connect(o); os.start(t); h.start(t); os.stop(end + .05); h.stop(end + .05);
    };
    INST.mbira = function (E, f, t, d, v, o) { INST.kalimba(E, f, t, d, v, o); };
    INST.balafon = function (E, f, t, d, v, o) { INST.marimba(E, f, t, d, v, o); };
    INST.whistle = function (E, f, t, d, v, o) { INST.flute(E, f, t, d, v * .8, o); };
    INST.harmonica = function (E, f, t, d, v, o) { INST.organ(E, f, t, d, v * .8, o); };
    INST.fmpiano = function (E, f, t, d, v, o) { INST.keys(E, f, t, d, v, o); };
    INST.cowbell = function (E, f, t, d, v, o) {
      var len = clamp(d * .7, .16, .5), bp = ctx.createBiquadFilter(), g = ctx.createGain(), q;
      bp.type = "bandpass"; bp.frequency.value = clamp(f * 2.2, 700, 3200); bp.Q.value = 1.6;
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.5 * v, t + .002); g.gain.exponentialRampToValueAtTime(.16 * v, t + .05); g.gain.exponentialRampToValueAtTime(.0001, t + len);
      [[1, 1], [1.504, .8], [2.01, .22]].forEach(function (p) { q = E.osc("square", f * p[0], t, t + len + .05); var pg = ctx.createGain(); pg.gain.value = p[1]; q.connect(pg); pg.connect(bp); });
      bp.connect(g); g.connect(o);
    };
    INST.synthbass = function (E, f, t, d, v, o) {
      var len = Math.max(.1, d), end = t + len + .12, lp = ctx.createBiquadFilter(), g = ctx.createGain(), g3 = ctx.createGain();
      var o1 = E.osc("sawtooth", f, t, end), o2 = E.osc("sine", f, t, end), o3 = E.osc("sine", f * 2, t, end);
      g3.gain.value = .35; lp.type = "lowpass"; lp.Q.value = 3; lp.frequency.setValueAtTime(1100, t); lp.frequency.exponentialRampToValueAtTime(260, t + len);
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.7 * v, t + .01); g.gain.setValueAtTime(.7 * v, t + Math.max(.02, len * .6)); g.gain.exponentialRampToValueAtTime(.0001, t + len + .06);
      o1.connect(lp); lp.connect(g); o2.connect(g); o3.connect(g3); g3.connect(g); g.connect(o);
    };
    /* log drum: a pitched, woody "bwoom". A sine body that drops a few semitones fast, a hollow knock an octave and a bit up, a click, and a tail; played as a bass line, it slides into notes */
    INST.log = function (E, f, t, d, v, o) {
      var dur = clamp(d * 1.1, .28, .95), end = t + dur, os = ctx.createOscillator(), g = ctx.createGain(), h = ctx.createOscillator(), hg = ctx.createGain();
      os.type = "sine";
      if (E.curGl) { os.frequency.setValueAtTime(f * Math.pow(2, E.curGl / 12), t); os.frequency.exponentialRampToValueAtTime(f, t + .09); }
      else { os.frequency.setValueAtTime(f * 1.32, t); os.frequency.exponentialRampToValueAtTime(f, t + .05); }
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.95 * v, t + .004); g.gain.exponentialRampToValueAtTime(.45 * v, t + .12); g.gain.exponentialRampToValueAtTime(.0001, end);
      h.type = "triangle"; h.frequency.setValueAtTime(f * 2.04, t); h.frequency.exponentialRampToValueAtTime(f * 1.98, t + .08); hg.gain.setValueAtTime(.0001, t); hg.gain.linearRampToValueAtTime(.4 * v, t + .004); hg.gain.exponentialRampToValueAtTime(.0001, t + dur * .55);
      var sh = ctx.createWaveShaper(), shg = ctx.createGain(), bp = ctx.createBiquadFilter(); sh.curve = satCurve; shg.gain.value = .22;
      bp.type = "bandpass"; bp.frequency.value = clamp(f * 3.1, 220, 700); bp.Q.value = 2.2;
      os.connect(g); g.connect(o); g.connect(sh); sh.connect(shg); shg.connect(o); h.connect(hg); hg.connect(o); hg.connect(bp); bp.connect(o);
      os.start(t); h.start(t); os.stop(end + .05); h.stop(end + .05);
      if (!E.lite) E.noise(t, .03, "bandpass", clamp(f * 8, 600, 1800), 1.4, .16 * v, .018, o);
      /* a real wooden slit/log drum underneath, when its recording has loaded */
      if (!E.lite) E.sampleNote("logdrum", f * 2, t, dur * .8, .55 * v, o);
    };


    /* ── band instruments: guitars, basses, organ, horns, clavinet ── */
    var distCurve = new Float32Array(2048);
    for (i = 0; i < 2048; i++) { var dx = i / 1024 - 1; distCurve[i] = Math.tanh(dx * 5) * .8; }
    var odCurve = new Float32Array(2048);
    for (i = 0; i < 2048; i++) { var ox = i / 1024 - 1; odCurve[i] = Math.tanh(ox * 2.2) * .85; }
    /* guitar amp: oscillators -> preamp gain -> clipper -> mid hump -> speaker low-pass */
    function ampGuitar(E, f, t, d, v, o, o1, pre, curve, cut, peak, vib) {
      var hold = Math.max(.1, d), rel = .12, end = t + hold + rel + .08, g = ctx.createGain(), p = ctx.createGain(), sh = ctx.createWaveShaper(), mid = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
      p.gain.value = pre; sh.curve = curve; mid.type = "peaking"; mid.frequency.value = 1200; mid.gain.value = 4; mid.Q.value = .8;
      lp.type = "lowpass"; lp.frequency.value = clamp(cut + f * .8, cut, cut + 1500); lp.Q.value = .6;
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(peak * v, t + .005);
      g.gain.exponentialRampToValueAtTime(peak * v * .55, t + Math.max(.09, hold * .9)); g.gain.exponentialRampToValueAtTime(.0001, t + hold + rel);
      (E.lite ? o1.slice(0, 2) : o1).forEach(function (c) { var os = E.osc(c[0], f * (c[2] || 1), t, end, c[1]); if (vib && hold > .4) { var vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.setValueAtTime(0, t + .18); vg.gain.linearRampToValueAtTime(1, t + .5); E.vib.connect(vg); vg.connect(os.detune); } var cg = ctx.createGain(); cg.gain.value = c[3] === undefined ? 1 : c[3]; os.connect(cg); cg.connect(p); });
      p.connect(sh); sh.connect(mid); mid.connect(lp); lp.connect(g); g.connect(o);
      if (!E.lite) E.noise(t, .025, "bandpass", Math.min(4000, f * 6), 1.2, .05 * v, .012, o);
    }
    INST.eguitar = function (E, f, t, d, v, o) {
      pluckVoice(E, f, t, d, v, o, .9978, 1.7, .2, 5400, 2.2, .4, .85);
      if (!E.lite) E.noise(t, .02, "bandpass", Math.min(5000, f * 5), 1.5, .04 * v, .012, o);
    };
    INST.dguitar = function (E, f, t, d, v, o) { ampGuitar(E, f, t, d, v, o, [["sawtooth", -6], ["sawtooth", 6], ["square", 0, 1, .35]], 4.5, distCurve, 2600, .34, false); };
    INST.lguitar = function (E, f, t, d, v, o) { ampGuitar(E, f, t, d, v, o, [["sawtooth", -4], ["triangle", 3, 1, .8], ["sawtooth", 5, 2, .12]], 2.6, odCurve, 3200, .4, true); };
    INST.ebass = function (E, f, t, d, v, o) {
      var len = Math.max(.12, d * .95), end = t + len + .14, lp = ctx.createBiquadFilter(), g = ctx.createGain(), cg = ctx.createGain();
      var a = E.osc("sawtooth", f, t, end), b = E.osc("sine", f, t, end), c = E.osc("triangle", f * 2, t, end);
      lp.type = "lowpass"; lp.Q.value = 1.2; lp.frequency.setValueAtTime(clamp(f * 14, 500, 1800), t); lp.frequency.exponentialRampToValueAtTime(clamp(f * 3.2, 160, 600), t + Math.min(.22, len));
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.8 * v, t + .006); g.gain.exponentialRampToValueAtTime(.5 * v, t + Math.min(.3, len)); g.gain.setValueAtTime(.5 * v, t + len * .85); g.gain.exponentialRampToValueAtTime(.0001, t + len + .09);
      cg.gain.value = .18; a.connect(lp); lp.connect(g); b.connect(g); c.connect(cg); cg.connect(g); g.connect(o);
    };
    INST.upbass = function (E, f, t, d, v, o) {
      pluckVoice(E, f, t, d, v, o, .9955, 1.5, .12, 1100, 1.1, .3, 1.15);
      var sub = ctx.createOscillator(), sg = ctx.createGain(), hold = Math.max(.2, d);
      sub.type = "sine"; sub.frequency.value = f; sg.gain.setValueAtTime(.0001, t); sg.gain.linearRampToValueAtTime(.3 * v, t + .012); sg.gain.exponentialRampToValueAtTime(.0001, t + hold + .12);
      sub.connect(sg); sg.connect(o); sub.start(t); sub.stop(t + hold + .2);
      if (!E.lite) E.noise(t, .04, "bandpass", 220, 1.5, .18 * v, .02, o);
    };
    INST.hammond = function (E, f, t, d, v, o) {
      var hold = Math.max(.15, d), g = ctx.createGain(), sh = ctx.createWaveShaper(), sg = ctx.createGain();
      var bars = E.lite ? [[1, 1], [2, .7], [.5, .5]] : [[.5, .6], [1.5, .35], [1, 1], [2, .8], [3, .5], [4, .35]];
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.19 * v, t + .008); g.gain.setValueAtTime(.19 * v, t + hold); g.gain.exponentialRampToValueAtTime(.0001, t + hold + .09);
      sh.curve = odCurve; sg.gain.value = .35; g.connect(o); g.connect(sh); sh.connect(sg); sg.connect(o);
      bars.forEach(function (b) { var os = E.osc("sine", f * b[0], t, t + hold + .2), bg = ctx.createGain(); E.vib.connect(os.detune); bg.gain.value = b[1]; os.connect(bg); bg.connect(g); });
      var pc = E.osc("sine", f * 3, t, t + .25), pg = ctx.createGain(); pg.gain.setValueAtTime(.5, t); pg.gain.exponentialRampToValueAtTime(.0001, t + .16); pc.connect(pg); pg.connect(g);
      if (!E.lite) E.noise(t, .02, "highpass", 3500, 1, .04 * v, .01, o);
    };
    INST.horns = function (E, f, t, d, v, o) {
      var hold = Math.max(.12, d * .9), end = t + hold + .2, lp = ctx.createBiquadFilter(), g = ctx.createGain();
      lp.type = "lowpass"; lp.Q.value = 1.1; lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(Math.min(5200, 1300 + f * 4.5), t + .05); lp.frequency.exponentialRampToValueAtTime(Math.min(3200, 900 + f * 2.5), t + hold);
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.3 * v, t + .02); g.gain.setValueAtTime(.26 * v, t + hold); g.gain.exponentialRampToValueAtTime(.0001, t + hold + .1);
      (E.lite ? [0] : [-9, 0, 9]).forEach(function (dt) { var os = E.osc("sawtooth", f, t, end, dt); E.vib.connect(os.detune); os.connect(lp); });
      lp.connect(g); g.connect(o);
    };
    INST.clav = function (E, f, t, d, v, o) {
      var dec = clamp(d * .8, .07, .35), a = E.osc("sawtooth", f, t, t + dec + .1), b = E.osc("square", f * 2.003, t, t + dec + .1), bg = ctx.createGain(), lp = ctx.createBiquadFilter(), pk = ctx.createBiquadFilter(), g = ctx.createGain();
      lp.type = "lowpass"; lp.Q.value = 1.4; lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(1400, t + .07);
      pk.type = "peaking"; pk.frequency.value = 2200; pk.gain.value = 5; pk.Q.value = 1;
      bg.gain.value = .25; g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.55 * v, t + .002); g.gain.exponentialRampToValueAtTime(.0001, t + dec);
      a.connect(lp); b.connect(bg); bg.connect(lp); lp.connect(pk); pk.connect(g); g.connect(o);
    };

    /* ── recorded-instrument voice: pick the nearest recorded note, repitch it with playbackRate, shape it with an envelope ── */
    var SLOUD = { "808": .55, whistle: 1, harmonica: 1, fmpiano: 1, ooh: .6, synthchoir: .6, piano: 1.18, keys: 1.05, clav: 1.01, marimba: 1.18, harp: 1.14, upbass: 3.1, hammond: 1.2, organ: .81, kalimba: 1.4, bells: 1.2, choir: .55, guitar: 1.14, eguitar: 1.13, lguitar: .7, dguitar: .56, ebass: 1.83, sax: 1.08, brass: .97, horns: .96, flute: 1.04, violin: 1.3, strings: .83 };
    function sampleVoice(E, sp, bank, f, t, d, v, o) {
      var m = smpMidi(f), root = bank.notes[0], k, bi;
      for (k = 1; k < bank.notes.length; k++) if (Math.abs(bank.notes[k] - m) < Math.abs(root - m)) root = bank.notes[k];
      var buf = bank.bufs[root], rate = Math.pow(2, (m - root) / 12), dd = Math.max(d, sp.min || (sp.sus ? .2 : .1)), rel = sp.rel, atk = sp.atk || .003;
      var n = sp.ens ? 2 : 1, end = t + dd + rel, dest = o, ws, pre, lp, gl = sp.gl && E.curGl ? E.curGl : 0;
      if (sp.dist) {
        pre = ctx.createGain(); pre.gain.value = sp.dist; ws = ctx.createWaveShaper(); ws.curve = sp.dist > 3 ? distCurve : odCurve; if (!E.lite) ws.oversample = "2x";
        lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = sp.dist > 3 ? 2800 : 3600; lp.Q.value = .6;
        var post = ctx.createGain(); post.gain.value = sp.dist > 3 ? .5 : .75; pre.connect(ws); ws.connect(lp); lp.connect(post); post.connect(o); dest = pre;
        v = v * (sp.dist > 3 ? .45 : .6);
      }
      for (bi = 0; bi < n; bi++) {
        var src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; src.playbackRate.value = rate;
        src.detune.value = (E.curDet || 0) + (n > 1 ? (bi ? 9 : -9) : 0);
        if (gl) { src.playbackRate.setValueAtTime(rate * Math.pow(2, gl / 12), t); src.playbackRate.exponentialRampToValueAtTime(rate, t + .11); }
        var pk = v * (n > 1 ? .62 : 1);
        g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(Math.max(.0003, pk), t + atk);
        g.gain.setValueAtTime(Math.max(.0003, pk), t + dd); g.gain.linearRampToValueAtTime(.0001, end);
        if (sp.sus && bank.loop[root] && (dd + rel + .05) * rate > buf.duration) { src.loop = true; src.loopStart = bank.loop[root][0]; src.loopEnd = bank.loop[root][1]; }
        src.connect(g); g.connect(dest); src.start(t); src.stop(end + .05);
      }
    }
    /* returns true if a recording played this note */
    E.samples = true;
    E.sampleNote = function (name, f, t, d, v, o) {
      var sp = SMAP[name]; if (!sp || !E.samples || !SMP.on || !ctx.decodeAudioData) return false;
      var bank = smpGet(sp.bank, ctx); if (sp.low) { var lb = smpGet(sp.low, ctx); if (lb && smpMidi(f) < 55) bank = lb; }
      if (!bank) return false;
      sampleVoice(E, sp, bank, f, t, d, v * (SLOUD[name] || 1), o); return true;
    };
    E.SLOUD = SLOUD; E.SMAP = SMAP;
    E.warm = function (pal) { if (!pal || !SMP.on || !E.samples) return; for (var r in pal) { var sp = pal[r] && SMAP[pal[r]]; if (sp) { smpGet(sp.bank, ctx); if (sp.low) smpGet(sp.low, ctx); } } };

    /* ── drums ── */
    var DRUM = {
      kick: function (E, t, v, K, o) { E.tone(t, "sine", K.kickStart, K.kickEnd, .12, v, K.kickDecay, o); E.tone(t, "sine", K.kickStart * 2.2, K.kickStart * .9, .03, .4 * v, .07, o); E.noise(t, .03, "bandpass", 2800, 1, .3 * v, .012, o); },
      snare: function (E, t, v, K, o) { E.playSample(E.noiseSample("snare" + K.snareNoise + K.snareDecay, [{ at: 0, sec: .3, type: "highpass", fc: 1800, q: .7, decay: K.snareDecay, peak: K.snareNoise }]), t, v, o); E.tone(t, "triangle", K.snareTone, K.snareTone * .7, .08, .5 * v, K.snareDecay * .75, o); },
      clap: function (E, t, v, K, o) {
        var b = E.noiseSample("clap" + K.clapFreq, [{ at: 0, sec: .05, type: "bandpass", fc: K.clapFreq, q: 1.1, decay: .025, peak: .7 }, { at: .011, sec: .05, type: "bandpass", fc: K.clapFreq, q: 1.1, decay: .025, peak: .7 }, { at: .022, sec: .05, type: "bandpass", fc: K.clapFreq, q: 1.1, decay: .025, peak: .7 }, { at: .033, sec: .25, type: "bandpass", fc: K.clapFreq - 100, q: 1.1, decay: .17, peak: .6 }]);
        E.playSample(b, t, v, o);
      },
      hat: function (E, t, v, K, o) { E.playSample(E.noiseSample("hat" + K.hatFreq + K.hatDecay, [{ at: 0, sec: .14, type: "highpass", fc: K.hatFreq, q: .7, decay: K.hatDecay, peak: .32 }]), t, v, o); },
      open: function (E, t, v, K, o) { E.playSample(E.noiseSample("open" + K.hatFreq + K.hatDecay, [{ at: 0, sec: .45, type: "highpass", fc: K.hatFreq - 1000, q: .7, decay: K.hatDecay * 6.5, peak: .3 }]), t, v, o); },
      rim: function (E, t, v, K, o) { E.tone(t, "sine", 1700, 1500, .01, .4 * v, .03, o); E.playSample(E.noiseSample("rim", [{ at: 0, sec: .05, type: "bandpass", fc: 3000, q: 2, decay: .02, peak: .25 }]), t, v, o); },
      shaker: function (E, t, v, K, o) { E.playSample(E.noiseSample("shaker", [{ at: 0, sec: .1, type: "bandpass", fc: 6500, q: 1, decay: .055, peak: .22 }]), t, v, o); },
      conga: function (E, t, v, K, o, ev) { var hi = (ev && ev.s % 2 === 1), f = hi ? 330 : 220; E.tone(t, "sine", f * 1.15, f, .04, .6 * v, .2, o); E.noise(t, .04, "bandpass", 1800, 1.4, .12 * v, .02, o); },
      tom: function (E, t, v, K, o, ev) { var f = [200, 150, 110, 78][clamp((ev && ev.n) !== undefined ? ev.n : 2, 0, 3)]; E.tone(t, "sine", f * 1.45, f, .09, .85 * v, .55, o); E.noise(t, .05, "bandpass", 900, 1, .1 * v, .03, o); },
      ride: function (E, t, v, K, o, ev) {
        E.playSample(E.noiseSample("ride", [{ at: 0, sec: .9, type: "highpass", fc: 6200, q: .6, decay: .5, peak: .2 }]), t, v, o);
        E.tone(t, "sine", 3400, 3400, .001, .07 * v * (ev && ev.bell ? 2 : 1), .35, o); E.tone(t, "sine", 5100, 5100, .001, .05 * v, .28, o); E.tone(t, "sine", 2270, 2270, .001, .05 * v, .5, o);
      },
      tamb: function (E, t, v, K, o) { E.playSample(E.noiseSample("tamb", [{ at: 0, sec: .12, type: "highpass", fc: 7500, q: 1, decay: .06, peak: .2 }, { at: .025, sec: .1, type: "bandpass", fc: 9500, q: 2, decay: .05, peak: .12 }]), t, v, o); },
      cow: function (E, t, v, K, o) { E.tone(t, "square", 587, 587, .001, .11 * v, .1, o); E.tone(t, "square", 845, 845, .001, .09 * v, .08, o); },
      chick: function (E, t, v, K, o) { E.playSample(E.noiseSample("chick", [{ at: 0, sec: .06, type: "bandpass", fc: 5200, q: 1.2, decay: .03, peak: .3 }]), t, v, o); },
      crash: function (E, t, v, K, o) { E.playSample(E.noiseSample("crash", [{ at: 0, sec: 2.2, type: "highpass", fc: 3500, q: .6, decay: 1.7, peak: .35 }]), t, v, o); }
    };

    /* ── recorded drum hits: round-robin snares/rides/crashes, tom pitch by drum, hi-hat choke ── */
    var DGK = {
      "drums-acoustic": { kick: 1.15, snare: 1.05, hat: .3, open: .38, ride: .7, crash: .7, tom: .85, clap: .55, tamb: .3, cow: .35, conga: .6, rim: .35, shaker: .25 },
      "drums-cr78": { kick: 1, snare: .7, hat: .38, open: .4, crash: .65, rim: 1.1, cow: .4, tamb: .25, conga: .8, shaker: .25 },
      "drums-tr505": { kick: 1, snare: .6, clap: .75, hat: .4, open: .38, crash: .5, ride: 1, rim: .45, cow: .7, conga: .5, tom: .75 },
      "drums-ama": { kick: 1.1, snare: .8, hat: .38, open: .34, clap: .8, cow: .5, conga: .85, rim: .55, shaker: .5, tamb: .4 },
      "drums-afrob": { kick: 1, snare: .8, hat: .38, open: .34, clap: .8, cow: .5, conga: .85, rim: .55, shaker: .5, tamb: .4 },
      "drums-phonk": { kick: 1.15, snare: .85, hat: .36, open: .32, clap: .8, cow: .55, conga: .7, rim: .5, shaker: .4, tamb: .35 },
      "drums-lm2": { kick: 1.3, snare: .55, clap: .55, hat: .3, open: .3, ride: .3, crash: .55, tom: .72, cow: .35, tamb: .3, conga: .6, rim: .35, shaker: .25 }
    }, rr = {}, lastOpen = null;
    E.DGK = DGK;
    function drumHit(bank, dg, name, t, v, o, ev) {
      var ids, id, rate = 1, k;
      if (name === "snare") ids = ["snare1", "snare2", "snare3", "snare"]; else if (name === "ride") ids = ["ride1", "ride2", "ride"]; else if (name === "crash") ids = ["crash1", "crash2", "crash"]; else if (name === "conga") ids = [ev && ev.s % 2 === 1 ? "conga2" : "conga1"];
      else if (name === "tom") { var n = clamp((ev && ev.n !== undefined) ? ev.n : 2, 0, 3); ids = [n === 0 ? "tom1" : n === 1 ? "tom1" : n === 2 ? "tom2" : "tom3"]; rate = [1.12, 1, 1, 1][n]; }
      else ids = [name, name + "2"];
      var have = ids.filter(function (x) { return bank.bufs[x]; }); if (!have.length) return false;
      rr[name] = ((rr[name] || 0) + 1 + (Math.random() < .35 ? 1 : 0)) % have.length; id = have[rr[name]];
      var src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = bank.bufs[id]; src.playbackRate.value = rate * (1 + (Math.random() - .5) * .03);
      var vel = Math.min(1.2, v) * (dg[name] || 1) * (name === "kick" || name === "snare" ? .9 + Math.min(.3, v * .3) : 1);
      g.gain.setValueAtTime(vel, t); src.connect(g); g.connect(o);
      if (name === "open") { lastOpen = g; }
      else if (name === "hat" && lastOpen) { try { lastOpen.gain.cancelScheduledValues(t); lastOpen.gain.setValueAtTime(lastOpen.gain.value, t); lastOpen.gain.linearRampToValueAtTime(0, t + .02); } catch (e) {} lastOpen = null; }
      src.start(t); return true;
    }
    E.drum = function (ev, t, bar) {
      var K = KITS[bar.kit] || KITS.classic, name = ev.k, strip = ev.r === "perc" ? (PERC_STRIP[name] || "hats") : "drums", o = E.strips[strip].in, vel = clamp(ev.v, .02, 1.2);
      if (ev.pan && ctx.createStereoPanner) { var pn = ctx.createStereoPanner(); pn.pan.value = clamp(ev.pan, -1, 1); pn.connect(o); o = pn; }
      if (name === "kick") kickDuck(t);
      var db = DRUMBANK[bar.kit], bank = db && SMP.on && E.samples && ctx.decodeAudioData ? smpGet(db, ctx) : null;
      if (bank && !(DRUMSKIP[bar.kit] && DRUMSKIP[bar.kit][name]) && drumHit(bank, DGK[db] || {}, name, t, vel, o, ev)) return;
      if (DRUM[name]) DRUM[name](E, t, vel, K, o, ev);
    };
    E.fx = function (ev, t, bar) {
      var o = E.strips.fx.in;
      if (ev.k === "riser") {
        var dur = Math.min(24, ev.d * bar.stepDur), s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noiseBuf; s.loop = true; bp.type = "bandpass"; bp.Q.value = 1.4; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.5 * ev.v, t + dur * .97); g.gain.linearRampToValueAtTime(0, t + dur);
        s.connect(bp); bp.connect(g); g.connect(o); s.start(t, Math.random()); s.stop(t + dur + .05);
      } else if (ev.k === "revcrash") {
        var rd = Math.min(4, ev.d * bar.stepDur), s2 = ctx.createBufferSource(), hp2 = ctx.createBiquadFilter(), g2 = ctx.createGain();
        s2.buffer = noiseBuf; s2.loop = true; hp2.type = "highpass"; hp2.frequency.setValueAtTime(1200, t); hp2.frequency.exponentialRampToValueAtTime(6500, t + rd);
        g2.gain.setValueAtTime(.0001, t); g2.gain.exponentialRampToValueAtTime(.6 * ev.v, t + rd * .96); g2.gain.linearRampToValueAtTime(0, t + rd + .03);
        s2.connect(hp2); hp2.connect(g2); g2.connect(o); s2.start(t, Math.random()); s2.stop(t + rd + .1);
      } else if (ev.k === "fall") {
        var fd = Math.min(3, ev.d * bar.stepDur), s3 = ctx.createBufferSource(), bp3 = ctx.createBiquadFilter(), g3 = ctx.createGain();
        s3.buffer = noiseBuf; s3.loop = true; bp3.type = "bandpass"; bp3.Q.value = 1.1; bp3.frequency.setValueAtTime(7000, t); bp3.frequency.exponentialRampToValueAtTime(380, t + fd);
        g3.gain.setValueAtTime(.35 * ev.v, t); g3.gain.exponentialRampToValueAtTime(.0001, t + fd);
        s3.connect(bp3); bp3.connect(g3); g3.connect(o); s3.start(t, Math.random()); s3.stop(t + fd + .05);
      } else if (ev.k === "impact") {
        E.tone(t, "sine", 62, 30, .6, .9 * ev.v, 1.8, o); E.noise(t, 1.4, "lowpass", 500, .7, .5 * ev.v, 1.2, o);
      }
    };

    /* ── per-bar mix: filter, reverb, delay, sidechain depth, textures ── */
    E.setMix = function (mix, t, bar) {
      var tc = Math.max(.05, bar.barDur / 3), maxCut = 5500 + mix.bright * 12500;
      E.bright = mix.bright; E.grit = mix.grit || 0; E.duckDepth = mix.duck || 0;
      E.wowAmt.gain.setTargetAtTime(mix.wobble || 0, t, .6);
      var q = mix.eq || [0, 0, 0]; eqS.gain.setTargetAtTime(q[0], t, .5); eqM.gain.setTargetAtTime(q[1], t, .5); eqP.gain.setTargetAtTime(q[2], t, .5);
      trim.gain.setTargetAtTime((opts.trim || .4) * (mix.level || 1), t, .8);
      tone.frequency.setTargetAtTime(300 * Math.pow(maxCut / 300, clamp(mix.cut, 0, 1)), t, tc);
      var beat = 60 / bar.bpm; dl.delayTime.setTargetAtTime(beat * .75, t, .05); dr.delayTime.setTargetAtTime(beat * .75, t, .05);
      Object.keys(E.strips).forEach(function (n) {
        var s = E.strips[n];
        s.rv.gain.setTargetAtTime(s.cfg.rv * mix.wet * (.5 + mix.space), t, tc);
        s.dy.gain.setTargetAtTime(s.cfg.dy * (mix.delay / .22), t, tc);
      });
      ["vinyl", "rain", "air"].forEach(function (k) { var lv = mix.tex ? mix.tex[k] : 0; if (solo && solo !== "tex") lv = 0; if (lv > 0 || tex[k]) ensureTex(k).g.gain.setTargetAtTime(lv, t, 1.2); });
    };

    /* ── voice budget: a phone can only synthesize so many voices at once ── */
    var voices = [], cap = E.lite ? 32 : 64;
    E.quality = E.lite ? 1 : 0;
    /* 0 = full, 1 = lite (fewer oscillators and voices), 2 = minimal. Can be changed while a piece plays. */
    E.setQuality = function (q) { E.quality = q; E.lite = q >= 1; cap = q >= 2 ? 16 : q === 1 ? 32 : 64; };
    E.admit = function (ev, t, cost, dur) {
      var n = 0, k; for (k = voices.length - 1; k >= 0; k--) { if (voices[k] < t - .05) voices.splice(k, 1); else n++; }
      var prio = ev.p || 2;
      if (ev.vx) { if (n > cap * 1.8) return false; } else if ((prio >= 3 && n > cap * .6) || (prio === 2 && n > cap * .85) || n > cap * 1.3) return false;
      voices.push(t + dur); if (cost > 1) for (k = 1; k < cost; k++) voices.push(t + dur); return true;
    };

    /* the song's mix sheet: level, reverb, delay and stereo position per part, eased in so nothing clicks */
    E.setStrips = function (m, t) {
      for (var r in m) { var st = E.strips[r], x = m[r]; if (!st) continue;
        if (x.lvl !== undefined) st.lvl.gain.setTargetAtTime(st.cfg.lvl * x.lvl, t, .4);
        if (x.rv !== undefined) st.rv.gain.setTargetAtTime(st.cfg.rv * x.rv, t, .4);
        if (x.dy !== undefined) st.dy.gain.setTargetAtTime(st.cfg.dy * x.dy, t, .4);
        if (x.tone !== undefined) st.ts.gain.setTargetAtTime(x.tone, t, .4);
        if (x.hp !== undefined && st.hf) st.hf.frequency.setTargetAtTime(st.cfg.hp * x.hp, t, .4);
        if (x.pan !== undefined) st.pan = x.pan; }
    };
    E.note = function (ev, t, bar) {
      var name = ev.i, fn = INST[name]; if (!fn) return;
      var sec = ev.d * bar.stepDur, o = ev.r === "bass" ? E.bassOut() : E.strips[ROLE_STRIP[ev.r]].in;
      var sp = SMAP[name], smp = sp && E.samples && SMP.on && SMP.banks[sp.bank] && SMP.banks[sp.bank].ready;
      if (!E.admit(ev, t, ev.cost || (smp ? sp.cost : (COST[name] || 2)), sec + .3)) return;
      var rp = E.strips[ROLE_STRIP[ev.r]], pv = ev.pan !== undefined ? ev.pan : (rp && rp.pan !== undefined && !ev.ans ? rp.pan : E.lite ? 0 : ev.r === "pad" ? ((ev.m % 5) - 2) * .15 : ev.r === "comp" ? ((ev.m % 3) - 1) * .16 : (ev.r === "lead" && ev.ans) ? -.28 : 0);
      if (pv && ctx.createStereoPanner) { var pn = ctx.createStereoPanner(); pn.pan.value = clamp(pv, -1, 1); pn.connect(o); o = pn; }
      E.curGl = ev.gl || 0; E.curDet = (Math.random() - .5) * 6;
      try {
        if (!(smp && E.sampleNote(name, mtof(ev.m), t, sec, clamp(ev.v * (ev.vx ? 1.4 : 1), .02, 1.2), o))) { fn(E, mtof(ev.m), t, sec, clamp(ev.v * (ev.vx ? 1.4 : 1), .02, 1.2) * (LOUD[name] || 1), o); }
      } finally { E.curGl = 0; E.curDet = 0; }
    };
    function stepTime(s, bar) {
      var base = s * bar.stepDur, r = Math.round(s);
      if (bar.swing > 0 && r % 2 === 1 && Math.abs(s - r) < .2) base += bar.swing * .333 * bar.stepDur;
      if (bar.swing8 > 0 && r % 4 === 2 && Math.abs(s - r) < .2) base += bar.swing8 * .667 * bar.stepDur;
      return base;
    }
    /* where each part sits against the grid (seconds, scaled by the style's "lay-back"): kick pushes, snare and lead lean back */
    var LAY = { kick: -.004, snare: .012, clap: .012, hat: .002, open: .002, bass: .006, lead: .014, comp: .008, arp: .004 }, drift = 0;
    E.playBar = function (bar, t0) {
      if (bar.strips) E.setStrips(bar.strips, t0);
      E.setMix(bar.mix, t0, bar); if (bar.palette) E.warm(bar.palette); if (DRUMBANK[bar.kit] && E.samples && SMP.on) smpGet(DRUMBANK[bar.kit], ctx);
      drift = drift * .7 + (Math.random() - .5) * .008 * (bar.human || 0);
      for (var k = 0; k < bar.events.length; k++) {
        var ev = bar.events[k], key = ev.r === "perc" ? "hats" : ev.r === "drums" ? "drums" : ev.r;
        if (solo && key !== solo) continue;
        if (muted.indexOf(key) >= 0) continue;
        var t = t0 + stepTime(ev.s, bar) + drift + (LAY[(ev.r === "drums" || ev.r === "perc") ? ev.k : ev.r] || 0) * (bar.lay || 0);
        if (bar.human > 0) t += (Math.random() - .5) * (ev.r === "drums" || ev.r === "perc" ? .006 : .014) * bar.human;
        if (t < t0) t = t0;
        if (ev.r === "drums" || ev.r === "perc") E.drum(ev, t, bar);
        else if (ev.r === "fx") E.fx(ev, t, bar);
        else E.note(ev, t, bar);
      }
    };
    E.fadeIn = function (t, dur) { E.out.gain.cancelScheduledValues(t); E.out.gain.setValueAtTime(.0001, t); E.out.gain.linearRampToValueAtTime(1, t + dur); };
    E.fadeOut = function (t, dur) { E.out.gain.cancelScheduledValues(t); E.out.gain.setValueAtTime(E.out.gain.value, t); E.out.gain.linearRampToValueAtTime(0, t + dur); };
    E.dispose = function () {
      try { vibLfo.stop(); } catch (e) {}
      Object.keys(tex).forEach(function (k) { try { tex[k].src.stop(); } catch (e) {} });
      setTimeout(function () { try { E.out.disconnect(); } catch (e) {} }, 400);
    };
    E.INST = INST; E.DRUM = DRUM; E.SMP = SMP; E.DRUMBANK = DRUMBANK;
    return E;
  }

  /* ═══════════════ 6. player + public API ═══════════════ */
  var AC = global.AudioContext || global.webkitAudioContext;
  var VOL_KEY = "yoecho_music_vol";
  var LOOKAHEAD = 1.8, LOOKAHEAD_HIDDEN = 24, TICK = 220;
  /* how far ahead notes are scheduled. A page in the background (screen off, another app on top) gets its timers throttled by the browser to one tick a second or even one a minute,
   * so while hidden the music is scheduled far ahead: the audio thread keeps playing it without the page having to wake up. */
  function lookahead() { return (global.document && global.document.hidden) ? LOOKAHEAD_HIDDEN : LOOKAHEAD; }
  var P = { outs: [], mix: null, ctx: null, volG: null, duckG: null, holdG: null, analyser: null, vol: .8, piece: null, timer: null, listeners: [], paused: false, ducked: false, held: false, lastBrief: null, lite: false, lvlBuf: null };
  try { var sv = parseFloat(global.localStorage.getItem(VOL_KEY)); if (isFinite(sv)) P.vol = clamp(sv, 0, 1); } catch (e) {}
  try { var nav = global.navigator || {}; P.lite = !!((nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) || (nav.deviceMemory && nav.deviceMemory <= 2) || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || "")); } catch (e) {}
  P.quality = P.lite ? 1 : 0;

  function emit(type, extra) { var o = extra || {}; o.type = type; P.listeners.slice().forEach(function (fn) { try { fn(o); } catch (e) {} }); }
  function ensureCtx() {
    if (!AC) return null;
    if (!P.ctx) {
      try { P.ctx = new AC({ latencyHint: "playback" }); } catch (e) { P.ctx = new AC(); }
      var c = P.ctx;
      P.volG = c.createGain(); P.volG.gain.value = P.vol;
      P.duckG = c.createGain(); P.holdG = c.createGain();
      P.analyser = c.createAnalyser(); P.analyser.fftSize = 512; P.lvlBuf = new Float32Array(512);
      P.volG.connect(P.duckG); P.duckG.connect(P.holdG); P.holdG.connect(P.analyser); P.analyser.connect(c.destination);
    }
    if (P.ctx.state === "suspended" && !P.paused) { try { P.ctx.resume(); } catch (e) {} }
    return P.ctx;
  }
  function unlock() {
    var c = ensureCtx(); if (!c) return false;
    try { var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch (e) {}
    return true;
  }

  var lastTickAt = 0, stalls = [];
  function tick() {
    var pc = P.piece; if (!pc || P.paused || !P.ctx) return;
    var c = P.ctx, nowW = Date.now();
    /* the page itself froze for a moment (main thread busy): two freezes within 20 s means this phone needs a lighter sound */
    if (lastTickAt && nowW - lastTickAt > 900 && nowW - lastTickAt < 5000 && !(global.document && global.document.hidden)) {
      stalls.push(nowW); stalls = stalls.filter(function (t) { return nowW - t < 20000; });
      if (stalls.length >= 2 && P.quality < 2) { P.quality++; pc.eng.setQuality(P.quality); stalls = []; emit("quality", { quality: P.quality }); }
    }
    lastTickAt = nowW;
    /* the browser can suspend or "interrupt" audio (after the microphone, a call, another app): bring it back */
    if (c.state !== "running" && !(global.document && global.document.hidden)) { try { c.resume(); } catch (e) {} }
    health(pc);
    var list = [pc].concat(P.outs), k;
    for (k = 0; k < list.length; k++) drive(list[k], c);
    P.outs = P.outs.filter(function (o) {
      if (o.done && c.currentTime > o.endT + 3) { o.eng.dispose(); return false; }
      return true;
    });
  }
  function drive(pc, c) {
    if (pc.nextT < c.currentTime) pc.nextT = c.currentTime + .05;      /* fell behind (throttled tab): re-sync */
    var la = lookahead();
    while (pc.nextT < c.currentTime + la) {
      if (pc.endT && pc.nextT >= pc.endT) {
        pc.done = true;
        if (pc === P.piece && !pc.finished) { pc.finished = true; setTimeout(function () { if (P.piece === pc) { emit("mixend", {}); stop(); } }, 400); }
        break;
      }
      var bar;
      try { bar = pc.comp.nextBar(); } catch (e) {
        /* a composer fault must never mean silence: after two faults in a row, swap in a fresh built-in composer */
        pc.faults = (pc.faults || 0) + 1; emit("error", { message: String(e && e.message || e) });
        if (pc.faults >= 2) { pc.faults = 0; try { var lb = {}; for (var q in (P.lastBrief || {})) lb[q] = P.lastBrief[q]; delete lb.planSrc; lb.seed = randomSeed(); pc.comp = Composer(parseBrief(lb), lb.seed); } catch (e2) {} }
        pc.nextT += .25; continue;
      }
      if (P.mix && P.mix.ctl) {
        var made = P.mix.ctl.afterBar(pc, bar);
        if (made) { P.outs.push(P.piece); P.piece = made; mediaSession(info()); emit("mixtrack", { info: info(), index: P.mix.ctl.idx, total: P.mix.ctl.plan.tracks.length }); }
      }
      try { pc.eng.playBar(bar, pc.nextT); } catch (e) { emit("error", { message: String(e && e.message || e) }); }
      if (bar.secStart && pc === P.piece) {
        (function (b, at) { setTimeout(function () { if (P.piece === pc) emit("section", { section: b.sec.kind, mood: b.mood, style: b.style, bpm: Math.round(b.bpm), info: pc.comp.info() }); }, Math.max(0, (at - c.currentTime) * 1000)); })(bar, pc.nextT);
      }
      pc.nextT += bar.barDur; pc.bars++;
    }
  }
  /* is this device keeping up? If the audio clock falls behind the wall clock, step down to a lighter sound. */
  function health(pc) {
    var c = P.ctx, now = Date.now();
    if (c.state !== "running" || (global.document && global.document.hidden)) { pc.h = null; return; }
    if (!pc.h) { pc.h = { w0: now, a0: c.currentTime, lag0: null, last: now }; return; }
    if (now - pc.h.last < 2000) return;
    pc.h.last = now;
    var lag = (now - pc.h.w0) / 1000 - (c.currentTime - pc.h.a0);
    if (pc.h.lag0 === null) { pc.h.lag0 = lag; return; }
    if (lag - pc.h.lag0 > .2 && P.quality < 2) { P.quality++; pc.eng.setQuality(P.quality); pc.h.lag0 = lag; emit("quality", { quality: P.quality }); }
  }
  /* the clock that wakes the scheduler lives in a Web Worker, because a worker's timers are not throttled when the page is in the background; a slow main-thread timer stays as a backup */
  function startTimer() {
    if (P.timer) return;
    P.timer = setInterval(tick, 1000);
    if (!P.worker && global.Worker && global.Blob && global.URL && global.URL.createObjectURL) {
      try {
        var url = global.URL.createObjectURL(new global.Blob(["var t=null;onmessage=function(e){if(e.data==='go'&&!t)t=setInterval(function(){postMessage(0)}," + TICK + ");else if(e.data==='stop'){clearInterval(t);t=null;}};"], { type: "text/javascript" }));
        P.worker = new global.Worker(url); P.workerUrl = url; P.worker.onmessage = function () { tick(); }; P.worker.onerror = function () { stopWorker(); };
      } catch (e) { P.worker = null; }
    }
    if (P.worker) { try { P.worker.postMessage("go"); } catch (e) { stopWorker(); } }
    if (!P.worker) { clearInterval(P.timer); P.timer = setInterval(tick, TICK); }
  }
  function stopWorker() { try { if (P.worker) P.worker.terminate(); if (P.workerUrl) global.URL.revokeObjectURL(P.workerUrl); } catch (e) {} P.worker = null; P.workerUrl = null; if (P.timer) { clearInterval(P.timer); P.timer = setInterval(tick, TICK); } }
  function stopTimer() { if (P.timer) { clearInterval(P.timer); P.timer = null; } if (P.worker) { try { P.worker.postMessage("stop"); } catch (e) {} } }
  if (global.document && global.document.addEventListener) {
    global.document.addEventListener("visibilitychange", function () { if (!global.document.hidden) tick(); });
    /* any tap brings suspended audio back (some browsers only allow resuming from a user gesture) */
    ["pointerdown", "touchend", "keydown"].forEach(function (ev) { global.document.addEventListener(ev, function () { if (P.piece && !P.paused && P.ctx && P.ctx.state !== "running") { try { P.ctx.resume(); } catch (e) {} } }, true); });
  }

  function seedStr(pc) { return seedToStr(pc.seed); }
  function info() {
    var pc = P.piece, i = pc ? pc.comp.info() : {};
    i.sleepMin = P.sleepAt ? Math.max(0, Math.round((P.sleepAt - Date.now()) / 60000)) : 0; i.quality = P.quality; i.playing = !!pc && !P.paused; i.paused = P.paused; i.active = !!pc; i.ducked = P.ducked; i.held = P.held; i.volume = P.vol;
    if (pc) { i.seedStr = seedStr(pc); i.elapsed = P.ctx ? Math.max(0, P.ctx.currentTime - pc.start) : 0; }
    return i;
  }
  function mediaSession(inf) {
    try {
      var ms = global.navigator && global.navigator.mediaSession; if (!ms || !global.MediaMetadata) return;
      ms.metadata = new global.MediaMetadata({ title: inf.title, artist: "YoEcho", album: inf.mood + " · " + inf.styleName });
      ms.setActionHandler("play", function () { resume(); }); ms.setActionHandler("pause", function () { pause(); }); ms.setActionHandler("nexttrack", function () { next(); });
    } catch (e) {}
  }

  function play(brief, opts) {
    opts = opts || {};
    var c = ensureCtx(); if (!c) { emit("error", { message: "Web Audio is not supported here" }); return null; }
    var pb = parseBrief(brief), seed = pb.seed !== undefined ? pb.seed : randomSeed();
    var keep = {}; for (var k in pb) if (k !== "seed" && k !== "plan") keep[k] = pb[k];
    if (pb.planSrc) { delete keep.key; delete keep.mode; delete keep.bpm; delete keep.instruments; delete keep.style; }   /* the plan carries these; a fresh piece must not inherit its key and tempo */
    P.lastBrief = keep;
    var comp = Composer(pb, seed), eng = Engine(c, P.volG, { lite: P.quality >= 1 }), now = c.currentTime; eng.setQuality(P.quality);
    if (!opts.keepMix) P.mix = null;
    P.outs.forEach(function (o) { o.eng.fadeOut(now, 1.2); setTimeout(function () { o.eng.dispose(); }, 1500); }); P.outs = [];
    if (P.piece) { var old = P.piece; old.eng.fadeOut(now, 1.8); setTimeout(function () { old.eng.dispose(); }, 2000); }
    eng.fadeIn(now, opts.fade || 2.2);
    P.piece = { comp: comp, eng: eng, nextT: now + .12, bars: 0, start: now, seed: seed, t0: Date.now() };
    P.paused = false;
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    P.holdG.gain.setTargetAtTime(P.held ? 0 : 1, now, .05);
    startTimer(); tick();
    var inf = info(); mediaSession(inf); try { global.navigator.mediaSession.playbackState = "playing"; } catch (e) {}
    emit("start", { info: inf });
    return inf;
  }
  function next() {
    if (P.mix && P.piece) { P.mix.ctl.skip(); return info(); }
    if (!P.lastBrief) return null;
    var pc = P.piece;
    if (pc && Date.now() - pc.t0 < 25000) { var st = pc.comp.info().style; taste.styles[st] = (taste.styles[st] || 0) - .5; saveTaste(); }
    var nb = {}; for (var q in P.lastBrief) nb[q] = P.lastBrief[q]; delete nb.planSrc;   /* a new piece composes its own structure */
    return play(nb);
  }
  function pause() {
    if (!P.piece || P.paused || !P.ctx) return;
    P.paused = true; var c = P.ctx;
    P.holdG.gain.setTargetAtTime(0, c.currentTime, .05);
    setTimeout(function () { if (P.paused) { try { c.suspend(); } catch (e) {} } }, 220);
    try { global.navigator.mediaSession.playbackState = "paused"; } catch (e) {}
    emit("pause", { info: info() });
  }
  function resume() {
    if (!P.piece || !P.paused || !P.ctx) return;
    var c = P.ctx; P.paused = false; P.piece.h = null;
    try { c.resume(); } catch (e) {}
    P.holdG.gain.setTargetAtTime(P.held ? 0 : 1, c.currentTime, .15);
    startTimer(); tick();
    try { global.navigator.mediaSession.playbackState = "playing"; } catch (e) {}
    emit("resume", { info: info() });
  }
  /* sleep timer: after the given minutes the music fades out and stops; sleep(0) cancels it */
  function sleep(min) {
    if (P.sleepT) { clearTimeout(P.sleepT); P.sleepT = null; } P.sleepAt = 0;
    min = Number(min); if (!(min > 0)) { emit("sleep", { info: info() }); return 0; }
    min = Math.min(min, 600); P.sleepAt = Date.now() + min * 60000;
    P.sleepT = setTimeout(function () {
      P.sleepT = null; P.sleepAt = 0; if (!P.piece || !P.ctx) return;
      var c = P.ctx; P.volG.gain.cancelScheduledValues(c.currentTime); P.volG.gain.setTargetAtTime(0, c.currentTime, 4);
      setTimeout(function () { stop(); try { P.volG.gain.cancelScheduledValues(0); P.volG.gain.setValueAtTime(P.vol, P.ctx.currentTime + 1.6); } catch (e) {} }, 14000);
    }, min * 60000);
    emit("sleep", { info: info() }); return min;
  }
  function toggle() { if (!P.piece) return false; if (P.paused) resume(); else pause(); return !P.paused; }
  function stop() {
    var pc = P.piece; if (!pc) return;
    P.piece = null; P.mix = null; P.paused = false; stopTimer();
    P.outs.forEach(function (o) { try { o.eng.fadeOut(P.ctx.currentTime, 1.2); } catch (e) {} setTimeout(function () { o.eng.dispose(); }, 1500); }); P.outs = []; if (P.sleepT) { clearTimeout(P.sleepT); P.sleepT = null; P.sleepAt = 0; }
    var c = P.ctx; if (c) { pc.eng.fadeOut(c.currentTime, 1.2); setTimeout(function () { pc.eng.dispose(); }, 1400); try { if (c.state === "suspended") c.resume(); } catch (e) {} }
    try { global.navigator.mediaSession.playbackState = "none"; } catch (e) {}
    emit("stop", {});
  }
  function setVolume(v, secs) {
    P.vol = clamp(v, 0, 1); try { global.localStorage.setItem(VOL_KEY, String(P.vol)); } catch (e) {}
    if (P.ctx) P.volG.gain.setTargetAtTime(P.vol, P.ctx.currentTime, secs ? secs / 3 : .08);
  }
  /* Echo is speaking: music steps back, then returns */
  function duck(on) { P.ducked = !!on; if (P.ctx) P.duckG.gain.setTargetAtTime(on ? .2 : 1, P.ctx.currentTime, on ? .15 : .9); }
  /* the microphone is listening: music goes silent so it is not heard by speech recognition */
  function hold(on) { P.held = !!on; if (P.ctx && !P.paused) P.holdG.gain.setTargetAtTime(on ? 0 : 1, P.ctx.currentTime, on ? .1 : .5); }
  function steer(p) { if (P.piece) P.piece.comp.steer(p || {}); }
  function level() {
    if (!P.analyser || !P.piece || P.paused) return 0;
    P.analyser.getFloatTimeDomainData(P.lvlBuf); var s = 0, i; for (i = 0; i < P.lvlBuf.length; i++) s += P.lvlBuf[i] * P.lvlBuf[i];
    return clamp(Math.sqrt(s / P.lvlBuf.length) * 2.4, 0, 1);
  }
  function like() {
    var pc = P.piece; if (!pc) return false;
    var inf = pc.comp.info(); taste.styles[inf.style] = (taste.styles[inf.style] || 0) + 1; taste.moods[inf.mood] = (taste.moods[inf.mood] || 0) + 1;
    var s = seedStr(pc); if (!taste.seeds.some(function (x) { return x.s === s; })) taste.seeds.unshift({ s: s, t: inf.title, b: P.lastBrief || {} });
    taste.seeds = taste.seeds.slice(0, 30); recordFb(1); saveTaste(); emit("like", { info: info() }); return true;
  }
  /* ── liked pieces teach the composer ──
   * Saved pieces keep their full written plan (chords, melody, bass line, groove). The composer reads them back as examples of what this listener enjoys. */
  function likedPlans() {
    var out = [], i; for (i = 0; i < taste.seeds.length; i++) { var e = taste.seeds[i], raw = e && e.b && (e.b.planSrc || e.b.plan); if (raw && typeof raw === "object" && Array.isArray(raw.sections)) out.push({ t: e.t, raw: raw }); }
    return out;
  }
  function likedExamples(n, part) {
    var res = [], L = likedPlans().slice(0, clamp(n || 2, 1, 4));
    L.forEach(function (x) {
      var r = x.raw, ex = { title: x.t, style: r.style || "", key: r.key || "", mode: r.mode || "", bpm: r.bpm || 0 };
      if (!part || part === "plan" || part === "orch") { ex.band = r.band || {}; if (part !== "orch") ex.motif = r.motif || null; }
      if (part === "orch" && r.mix) ex.mix = r.mix;
      var secs = [], seenK = {};
      (r.sections || []).forEach(function (sx) {
        if (!sx || !Array.isArray(sx.chords) || seenK[sx.kind] || secs.length >= 2) return;
        if (sx.kind !== "verse" && sx.kind !== "chorus" && sx.kind !== "drop") return;
        var o = { kind: sx.kind, chords: sx.chords.slice(0, 4) };
        if (part === "mel" || !part) { if (Array.isArray(sx.mel) && sx.mel.length) o.mel = sx.mel.filter(function (n) { return n[0] < 2; }).slice(0, 18); }
        if (part === "bass" || !part) { if (Array.isArray(sx.bassline) && sx.bassline.length) o.bassline = sx.bassline.filter(function (n) { return n[0] < 1; }).slice(0, 12); }
        if (part === "drums" || !part) { if (sx.groove) o.groove = sx.groove; }
        if (part === "plan" || !part) { o.energy = sx.energy; o.bars = sx.bars; }
        if (part === "orch") { if (sx.band) o.band = sx.band; if (sx.double) o.double = sx.double; }
        if (part && part !== "plan" && part !== "orch" && !(o.mel || o.bassline || o.groove)) return;
        if (part === "orch" && !(o.band || o.double)) return;
        seenK[sx.kind] = 1; secs.push(o);
      });
      if (secs.length) { ex.sections = secs; res.push(ex); }
    });
    return res;
  }
  function tasteProfile() {
    var L = likedPlans(), tn = tuning(), fbn = (tn.notes.length || tn.skipped.length) ? { notes: tn.notes, skipped: tn.skipped } : null;
    if (!L.length) return fbn ? { pieces: 0, feedback: fbn } : null;
    var st = {}, bpms = [], modes = { minor: 0, major: 0 }, sev = 0, tot = 0, inst = {};
    L.forEach(function (x) {
      var r = x.raw; if (r.style) st[r.style] = (st[r.style] || 0) + 1; if (r.bpm) bpms.push(r.bpm);
      var md = String(r.mode || "").toLowerCase(); if (/min|aeol|dor|phryg/.test(md)) modes.minor++; else modes.major++;
      if (r.band) for (var k in r.band) { var v = r.band[k]; if (v && v !== "none") { inst[k] = inst[k] || {}; inst[k][v] = (inst[k][v] || 0) + 1; } }
      (r.sections || []).forEach(function (sx) { (sx.chords || []).forEach(function (c) { tot++; if (/7|9|11|13/.test(String(c))) sev++; }); });
    });
    var fav = {}; for (var rk in inst) fav[rk] = Object.keys(inst[rk]).sort(function (a, b) { return inst[rk][b] - inst[rk][a]; })[0];
    return { pieces: L.length, styles: Object.keys(st).sort(function (a, b) { return st[b] - st[a]; }).slice(0, 3),
      bpm: bpms.length ? [Math.min.apply(null, bpms), Math.max.apply(null, bpms)] : null, leans: modes.minor > modes.major ? "minor, darker" : modes.major > modes.minor ? "major, brighter" : "both",
      harmony: tot ? (sev / tot > .5 ? "rich (7ths, 9ths)" : sev / tot > .2 ? "mixed" : "simple triads") : "", favouriteInstruments: fav, feedback: fbn };
  }
  function saved() { return taste.seeds.slice(); }
  function playSaved(i) { var e = taste.seeds[i]; if (!e) return null; var b = {}; for (var k in e.b) b[k] = e.b[k]; b.seed = strToSeed(e.s); return play(b); }
  function tasteSummary() {
    var arr = Object.keys(taste.styles).filter(function (k) { return taste.styles[k] > 0; }).sort(function (a, b) { return taste.styles[b] - taste.styles[a]; }).slice(0, 2);
    return arr.map(function (k) { return STYLES[k] ? STYLES[k].name : k; }).join(", ");
  }

  /* ═══════════════ DJ mix ═══════════════ */
  var MIX_DEFAULT_STYLES = ["afrobeats", "amapiano", "house"];
  var MIX_TRANS = { auto: 16, blend: 16, quick: 8, cut: 2, echo: 16, filter: 16, roll: 16, brake: 16, rewind: 16 };
  /* DJ effect voices (the things a DJ throws over a mix): all synthesized on the spot, on their own bus beside the tracks */
  function DJFX(ctx, out) {
    var F = {}, nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate), nd = nb.getChannelData(0), i;
    for (i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    var bus = ctx.createGain(); bus.gain.value = .5; bus.connect(out);
    /* real recorded turntable sounds (scratch, backspin, tape rewind); loaded once, and the synthesized versions play until they are ready or if they cannot load */
    var REC = DJFX.rec || (DJFX.rec = {});
    function recLoad(name) {
      if (REC[name] !== undefined || !global.fetch || !ctx.decodeAudioData) return; REC[name] = null;
      try {
        global.fetch(SMP.base + "fx/" + name + ".mp3").then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
          .then(function (ab) { return new Promise(function (ok, no) { var pr = ctx.decodeAudioData(ab, ok, no); if (pr && pr.then) pr.then(ok, no); }); })
          .then(function (buf) { REC[name] = buf; }, function () { REC[name] = false; });
      } catch (e) { REC[name] = false; }
    }
    ["scratch", "backspin", "rewind"].forEach(recLoad);
    /* optional DJ voice clips: samples/djvox/manifest.json = {"drop":["a.mp3"],"tag":[],"hype":[],"adlib":[]}; empty or missing means no voice at all */
    var VOXC = DJFX.vox || (DJFX.vox = { man: null, bufs: {} });
    if (VOXC.man === null && global.fetch && ctx.decodeAudioData) {
      VOXC.man = false;
      try { global.fetch(SMP.base + "djvox/manifest.json").then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (m) { VOXC.man = m && typeof m === "object" ? m : false; }, function () {}); } catch (e) {}
    }
    F.vox = function (cat, t, v) {
      var list = VOXC.man && VOXC.man[cat]; if (!list || !list.length) return false;
      var fn = list[Math.floor(Math.random() * list.length)], key = cat + "/" + fn, buf = VOXC.bufs[key];
      if (buf === undefined) {
        VOXC.bufs[key] = null;
        try { global.fetch(SMP.base + "djvox/" + fn).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(function (ab) { return new Promise(function (ok, no) { var pr = ctx.decodeAudioData(ab, ok, no); if (pr && pr.then) pr.then(ok, no); }); }).then(function (b) { VOXC.bufs[key] = b; }, function () { VOXC.bufs[key] = false; }); } catch (e) { VOXC.bufs[key] = false; }
        return false;
      }
      if (!buf) return false;
      var src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; g.gain.value = v; src.connect(g); g.connect(bus); src.start(t); return true;
    };
    /* play a recording stretched to dur seconds (rate = length/dur), through the FX bus; returns true if it played */
    function recPlay(name, t, dur, v, rate0) {
      var buf = REC[name]; if (!buf) return false;
      var src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; src.playbackRate.value = rate0 || (dur ? Math.max(.5, Math.min(2.5, buf.duration / dur)) : 1);
      g.gain.setValueAtTime(v, t); src.connect(g); g.connect(bus); src.start(t); src.stop(t + buf.duration / src.playbackRate.value + .05); return true;
    }
    var sat = ctx.createWaveShaper(), sc = new Float32Array(512); for (i = 0; i < 512; i++) { var x = i / 255.5 - 1; sc[i] = Math.tanh(x * 2.4) * .8; } sat.curve = sc;
    function noise(t, dur, type, f0, f1, q, peak, atk) {
      var s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = nb; s.loop = true; fl.type = type; fl.Q.value = q;
      fl.frequency.setValueAtTime(f0, t); if (f1 !== f0) fl.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(peak, t + Math.min(atk || .01, dur * .5)); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      s.connect(fl); fl.connect(g); g.connect(bus); s.start(t, Math.random()); s.stop(t + dur + .05);
    }
    function osc(t, dur, type, f0, f1, peak, atk, dst) {
      var o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(peak, t + (atk || .005)); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g); g.connect(dst || bus); o.start(t); o.stop(t + dur + .05); return o;
    }
    F.sweepUp = function (t, dur, v) { noise(t, dur, "bandpass", 300, 9500, 1.3, .42 * v, dur * .95); };
    F.sweepDown = function (t, dur, v) { noise(t, dur, "bandpass", 9000, 350, 1.1, .4 * v, .02); };
    F.impact = function (t, v) { osc(t, 1.6, "sine", 64, 30, .85 * v, .004); noise(t, 1.3, "lowpass", 500, 140, .7, .5 * v, .004); if (v > .4 && Math.random() < .5) F.vox("drop", t + .02, .8); };
    F.crash = function (t, v) { noise(t, 1.8, "highpass", 3400, 3400, .6, .34 * v, .004); };
    /* air horn: a stack of detuned saws through a clipper, three short blasts and a long one that droops */
    F.horn = function (t, v, beat) {
      var b = beat || .5, hits = [[0, .2], [.28, .2], [.56, .2], [.84, 1.5]], k, j, fs = [349, 440, 523, 698];
      hits.forEach(function (h, n) {
        var st = t + h[0] * b * 1.6, d = h[1] * (n === 3 ? b * 1.2 : b * 1.2), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 3200; lp.Q.value = .8; g.gain.setValueAtTime(.0001, st); g.gain.linearRampToValueAtTime(.13 * v, st + .012); g.gain.setValueAtTime(.13 * v, st + d * .8); g.gain.exponentialRampToValueAtTime(.0001, st + d + .06);
        for (j = 0; j < fs.length; j++) { var o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(fs[j] * (n === 3 ? 1.02 : 1), st); if (n === 3) o.frequency.exponentialRampToValueAtTime(fs[j] * .965, st + d); o.detune.value = (j - 1.5) * 7; o.connect(lp); o.start(st); o.stop(st + d + .1); }
        var hs = ctx.createWaveShaper(); hs.curve = sc; lp.connect(hs); hs.connect(g); g.connect(bus);
      });
    };
    F.siren = function (t, v, dur) {
      var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), k, n = Math.max(2, Math.round((dur || 1.6) / .55)); o.type = "square"; lp.type = "lowpass"; lp.frequency.value = 2400;
      o.frequency.setValueAtTime(620, t); for (k = 0; k < n; k++) { o.frequency.linearRampToValueAtTime(1500, t + k * .55 + .27); o.frequency.linearRampToValueAtTime(620, t + (k + 1) * .55); }
      g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.12 * v, t + .03); g.gain.setValueAtTime(.12 * v, t + n * .55 - .08); g.gain.linearRampToValueAtTime(0, t + n * .55);
      o.connect(lp); lp.connect(g); g.connect(bus); o.start(t); o.stop(t + n * .55 + .05);
    };
    F.laser = function (t, v) { osc(t, .3, "sawtooth", 4200, 180, .16 * v, .002); noise(t, .22, "bandpass", 5000, 700, 3, .08 * v, .002); };
    /* scratch: a few back-and-forth strokes of a "record" (a pitched saw with a bandpass and a noise rub) */
    F.scratch = function (t, beat, v, n) {
      var k, cnt = n || 6, st = beat / cnt * 2.2;
      if (REC.scratch) { for (k = 0; k < cnt; k++) recPlay("scratch", t + k * st, 0, .9 * v, (k % 2 ? .85 : 1.15) * (1 + (k % 3) * .08)); return; }
      for (k = 0; k < cnt; k++) {
        var s0 = t + k * st, up = k % 2 === 0, f0 = up ? 190 : 560, f1 = up ? 560 : 190, o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = "sawtooth"; o.frequency.setValueAtTime(f0 * (1 + (k % 3) * .12), s0); o.frequency.exponentialRampToValueAtTime(f1, s0 + st * .9); bp.type = "bandpass"; bp.frequency.setValueAtTime(900, s0); bp.frequency.linearRampToValueAtTime(2600, s0 + st * .45); bp.frequency.linearRampToValueAtTime(900, s0 + st); bp.Q.value = 3;
        g.gain.setValueAtTime(.0001, s0); g.gain.linearRampToValueAtTime(.22 * v, s0 + .012); g.gain.setValueAtTime(.22 * v, s0 + st * .75); g.gain.linearRampToValueAtTime(.0001, s0 + st * .98);
        o.connect(bp); bp.connect(g); g.connect(bus); o.start(s0); o.stop(s0 + st + .03); noise(s0, st * .9, "bandpass", 1800, 1800, 2, .08 * v, .01);
      }
    };
    F.rewind = function (t, dur, v) { if (recPlay("rewind", t, dur, .9 * v)) return; noise(t, dur, "bandpass", 9000, 300, 1.6, .38 * v, .02); osc(t, dur, "sawtooth", 1900, 70, .18 * v, .02); };
    /* brake: the platter slowing to a stop (a falling pitch, a closing filter, a fading rub) */
    F.brake = function (t, dur, v) {
      if (recPlay("backspin", t, dur, .9 * v)) { return; }
      var o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = "sawtooth"; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(38, t + dur);
      lp.type = "lowpass"; lp.frequency.setValueAtTime(3500, t); lp.frequency.exponentialRampToValueAtTime(120, t + dur); g.gain.setValueAtTime(.2 * v, t); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(lp); lp.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + .05); noise(t, dur, "lowpass", 6000, 200, .8, .16 * v, .01);
    };
    F.snareRoll = function (t, beat, beats, v) {
      var tt = t, end = t + beat * beats, gap = beat / 2, n = 0, total = beat * beats;
      while (tt < end - .01) {
        var u = (tt - t) / total, vel = (.25 + .75 * u) * v; noise(tt, .14, "highpass", 1700, 1700, .7, .5 * vel, .002); osc(tt, .09, "triangle", 230, 170, .22 * vel, .002);
        gap = beat / (2 + 6 * u); if (gap < beat / 8) gap = beat / 8; tt += gap; n++;
      }
    };
    return F;
  }
  function normStyle(x) { var p = parseBrief({ style: x }); return p.style && p.style !== "solo" ? p.style : ""; }
  /* a mix plan: which genres, how long, how the energy travels; tempos are chosen to stay close to the previous track so every handover can be beat-matched */
  function buildMixPlan(o) {
    o = o || {};
    var seed = (o.seed !== undefined && o.seed !== null && o.seed !== "") ? (typeof o.seed === "number" ? o.seed >>> 0 : strToSeed(o.seed)) : randomSeed(), rng = makeRng(seed);
    var styles = (Array.isArray(o.styles) ? o.styles : (o.style ? [o.style] : [])).map(normStyle).filter(Boolean);
    if (!styles.length) styles = MIX_DEFAULT_STYLES.slice();
    var moods = (Array.isArray(o.moods) ? o.moods : (o.mood ? [o.mood] : [])).map(function (m) { return parseBrief({ mood: m }).mood; }).filter(function (m) { return m !== "neutral"; });
    var minutes = clamp(Number(o.minutes) || 15, 1, 120), shape = ["wave", "build", "peak", "chill", "warmup"].indexOf(o.shape) >= 0 ? o.shape : "wave";
    var trans = MIX_TRANS[o.trans] ? o.trans : "auto", transBars = MIX_TRANS[trans];
    var tsec = clamp(Number(o.trackSec) || 170, 30, 300), n = Math.max(2, Math.round(minutes * 60 / tsec)), tracks = [], prev = 0, lastStyle = "", key = o.key !== undefined ? parseKey(o.key) : null;
    for (var i = 0; i < n; i++) {
      var u = n > 1 ? i / (n - 1) : 0, e;
      e = shape === "build" ? .45 + .5 * u : shape === "warmup" ? .35 + .45 * u : shape === "peak" ? .8 + .15 * Math.sin(i * 1.3) : shape === "chill" ? .3 + .2 * Math.sin(i * 1.1) : .62 + .3 * Math.sin(i * 1.15 + .4);
      e = clamp(e + rng.range(-.04, .04), .2, 1);
      /* choose the genre whose tempo range sits closest to the previous track's tempo */
      var map = {}; styles.forEach(function (st) {
        var r = STYLES[st].bpm, mid = (r[0] + r[1]) / 2, dist = prev ? Math.abs(mid - prev) : 0;
        map[st] = Math.exp(-dist / 14) * (st === lastStyle && styles.length > 1 ? .25 : 1);
      });
      var st = rng.weighted(map), r2 = STYLES[st].bpm, nat = Math.round(lerp(r2[0], r2[1], clamp(e, 0, 1)) + rng.range(-1.5, 1.5));
      var mood = moods.length ? moods[i % moods.length] : (e > .78 ? "joy" : e > .58 ? "hope" : e > .42 ? "love" : "calm");
      var barDur = 240 / nat, secs = tsec * rng.range(.88, 1.18);
      tracks.push({ style: st, mood: mood, energy: e, nat: nat, bars: Math.max(tsec < 60 ? 16 : 32, Math.round(secs / barDur / 8) * 8), seed: (seed + i * 7919) >>> 0 });
      prev = nat; lastStyle = st;
    }
    return { seed: seed, tracks: tracks, trans: trans, transBars: transBars, minutes: minutes, shape: shape, key: key, name: String(o.name || "").slice(0, 60) };
  }
  function mixTrackPiece(ctx, dest, tr, root, mode, lite, quality, at, bpm) {
    var brief = { mood: tr.mood, style: tr.style, energy: tr.energy, seed: tr.seed, intent: "match" };
    if (root !== null && root !== undefined) { brief.key = root; if (mode) brief.mode = mode; }
    var pb = parseBrief(brief), comp = Composer(pb, tr.seed), eng = Engine(ctx, dest, { lite: lite }); eng.setQuality(quality);
    if (bpm) { comp.spec.bpmForce = bpm; comp.spec.skipIntro = true; } else comp.spec.bpmForce = tr.nat;
    return { comp: comp, eng: eng, nextT: at, bars: 0, start: at, seed: tr.seed, t0: Date.now(), tr: tr };
  }
  /* the controller is clock-agnostic: the live scheduler and the offline renderer both call afterBar() for every bar they generate */
  function MixCtl(ctx, dest, plan, lite, quality) {
    var M = { plan: plan, idx: 0, ctx: ctx, last: false, forceNext: false };
    /* shared bus: while two tracks overlap their limiters add up, so one more compressor guards the sum */
    var bus = ctx.createDynamicsCompressor(), bg = ctx.createGain(), sc = ctx.createWaveShaper(), cv = new Float32Array(512), q;
    bus.threshold.value = -9; bus.knee.value = 8; bus.ratio.value = 10; bus.attack.value = .003; bus.release.value = .2; bg.gain.value = .92;
    for (q = 0; q < 512; q++) { var x = q / 255.5 - 1; cv[q] = Math.tanh(x * 1.1) / Math.tanh(1.1); } sc.curve = cv;
    bus.connect(bg); bg.connect(sc); sc.connect(dest); dest = bus; M.bus = bus;
    var rng = makeRng(plan.seed ^ 0x5bd1e995);
    var fx = DJFX(ctx, dest); M.fx = fx;
    M.begin = function (at) { var pc = mixTrackPiece(ctx, dest, plan.tracks[0], plan.key, null, lite, quality, at, 0); pc.eng.fadeIn(at, 1.5); return pc; };
    M.afterBar = function (pc, bar) {
      var tr = plan.tracks[M.idx];
      if (!pc.leaving && pc.tr === tr) M.perform(pc, bar);
      if (pc.leaving || pc.tr !== tr) { if (pc.tr && pc.tr === plan.tracks[M.idx] && pc.bars >= plan.transBars && !pc.released) { pc.released = true; pc.comp.release(pc.tr.nat); } return null; }
      if (pc.bars >= plan.transBars && !pc.released) { pc.released = true; if (M.idx > 0) pc.comp.release(tr.nat); }
      var lastTrack = M.idx >= plan.tracks.length - 1, B = plan.transBars;
      if (lastTrack) {
        if (pc.bars >= tr.bars - 8 && !pc.leaving) { pc.leaving = true; M.last = true; pc.endT = pc.nextT + 8 * bar.barDur; pc.eng.xfade(pc.nextT, 8 * bar.barDur, false); }
        return null;
      }
      var go = M.forceNext ? (bar.secStart || pc.bars > 2) : (pc.bars >= tr.bars - B && (bar.secStart || pc.bars >= tr.bars));
      if (!go || pc.bars < 4) return null;
      M.forceNext = false;
      return M.transition(pc, bar);
    };
    /* what a DJ does at the handover, picked per transition when the mix is on "auto" (energy and the next genre nudge the odds) */
    function pickTrans(nxt, tr) {
      var w = { blend: 3, echo: 2, filter: 1.8, roll: 1.4 + (nxt.energy > .7 ? 1 : 0), brake: .8, rewind: .7, cut: .6 };
      if (tr && tr.energy < .45) { w.roll = .4; w.brake = .3; w.filter += 1; }
      return rng.weighted(w);
    }
    M.transition = function (pc, bar) {
      var at = pc.nextT, bd = bar.barDur, beat = bd / 4, B = plan.transBars, dur = B * bd, nxt = plan.tracks[M.idx + 1], st = pc.comp.state(), tr = plan.tracks[M.idx];
      var kind = plan.trans === "auto" ? pickTrans(nxt, tr) : plan.trans === "quick" ? "blend" : plan.trans;
      pc.comp.hold(); pc.leaving = true;
      /* harmonic mixing: move to a closely related key (same, fifth up, fourth up, or step up) and keep the mode */
      var step = rng.weighted({ "0": 3, "7": 3, "5": 2.2, "2": .8 }), root = (st.root + parseInt(step, 10)) % 12;
      var mode = rng.chance(.75) ? st.mode : null, E1 = pc.eng, inc, sd = { stepDur: bar.stepDur }, big = nxt.energy > .62;
      M.idx++;
      if (kind === "blend") {
        inc = mixTrackPiece(ctx, dest, nxt, root, mode, lite, quality, at, bar.bpm);
        var swap = at + dur * .5;
        inc.eng.xfade(at, dur * .5, true); E1.xfade(at + dur * .55, dur * .45, false);
        inc.eng.djSet(480, Math.max(0, at - .02)); inc.eng.djSweep(swap, bd, 480, 12); E1.djSweep(swap, bd, 12, 480);
        /* the DJ lifts the room: a riser into the swap, an echo throw as the old bass leaves, and now and then a horn */
        try {
          fx.sweepUp(swap - 4 * bd, 4 * bd, .6); fx.impact(swap, .38); fx.crash(swap, .4);
          E1.djEchoOn(swap - beat * 2, beat, .75, .55, .8); E1.djEchoOff(swap + beat, .08);
          if (nxt.energy > .66 && rng.chance(.4)) fx.horn(swap + .02, .6, beat);
        } catch (e) {}
        pc.endT = at + dur + .1;
        return inc;
      }
      /* every other handover lets the outgoing track play to its planned end and drops the next one on the downbeat */
      var at2 = at + dur;
      inc = mixTrackPiece(ctx, dest, nxt, root, mode, lite, quality, at2, bar.bpm);
      inc.eng.out.gain.setValueAtTime(.0001, 0); inc.eng.out.gain.setValueAtTime(1, Math.max(0, at2 - .02));
      pc.endT = at2 + .05;
      try {
        if (kind === "roll") {
          E1.djSweep(at2 - 2 * bd, 2 * bd, 12, 1100); E1.djChop(at2 - bd, at2, beat, [1, 2, 4, 8], .0001);
          fx.snareRoll(at2 - 2 * bd, beat, 8, .8); fx.sweepUp(at2 - 2 * bd, 2 * bd, .8);
          E1.djEchoOn(at2 - beat, beat, .5, .5, .6); E1.djEchoOff(at2, .05);
          fx.impact(at2, .4); fx.crash(at2, .4); if (big && rng.chance(.5)) fx.horn(at2 + .03, .6, beat); else if (rng.chance(.3)) fx.laser(at2 + beat * 3, .6);
          pc.endT = at2 + 2.5;
        } else if (kind === "echo") {
          E1.djEchoOn(at2 - bd, beat, .75, .66, .9); E1.djGateSet(at2, 0, .012); E1.djEchoOff(at2 + .03, .05);
          fx.sweepUp(at2 - bd, bd, .35); fx.impact(at2, .45); if (rng.chance(.3)) fx.laser(at2 + beat * 2, .5);
          pc.endT = at2 + 6;
        } else if (kind === "filter") {
          E1.djLP(at2 - 4 * bd, 4 * bd, 20000, 230, 7); E1.djGateSet(at2, 0, .02);
          inc.eng.djLP(at2, 2 * bd, 380, 20000, 4);
          fx.sweepDown(at2 - 4 * bd, 4 * bd, .25); fx.sweepUp(at2 - bd, bd, .55); fx.impact(at2, .5); fx.crash(at2, .45);
          pc.endT = at2 + .6;
        } else if (kind === "brake") {
          var bl = beat * 3; E1.djLP(at2 - bl, bl, 18000, 110, 5); fx.brake(at2 - bl, bl, .8); E1.djGateSet(at2 - .03, 0, .03);
          fx.impact(at2, .6); fx.crash(at2, .5); if (rng.chance(.4)) fx.siren(at2 + .02, .5, 1.1);
          pc.endT = at2 + .4;
        } else if (kind === "rewind") {
          var rl = beat * 2; E1.djGateSet(at2 - rl, 0, .02); fx.rewind(at2 - rl, rl, .8); fx.impact(at2, .55); fx.crash(at2, .5);
          if (big && rng.chance(.5)) fx.horn(at2 + .03, .6, beat);
          pc.endT = at2 + .4;
        } else {
          /* cut: the outgoing track is scratched out and the next one hits on the one */
          E1.djGateSet(at2 - beat * 2, 0, .01); fx.scratch(at2 - beat * 2, beat * 2, .9, 7); fx.impact(at2, .5);
          if (rng.chance(.35)) fx.laser(at2 + beat, .5);
          pc.endT = at2 + .4;
        }
      } catch (e) {}
      return inc;
    };
    /* the DJ playing the mix live between handovers: horns on drops, echo throws at the end of phrases, filter lifts */
    M.perform = function (pc, bar) {
      if (pc.leaving || pc.bars < plan.transBars + 4 || !pc.tr) return;
      var bd = bar.barDur, beat = bd / 4, t = pc.nextT, kind = bar.sec && bar.sec.kind, tr = pc.tr;
      if (bar.secStart && /chorus|drop|climax/.test(kind) && !pc.hornDone && tr.energy > .6 && rng.chance(.3)) { pc.hornDone = true; try { fx.horn(t + .02, .55, beat); } catch (e) {} }
      if (bar.secStart && /chorus|drop|climax/.test(kind) && rng.chance(.35)) { try { fx.crash(t, .3); } catch (e) {} }
      var ph = pc.bars % 8;
      if (ph === 7 && rng.chance(.35)) { try { pc.eng.djEchoOn(t + beat * 3, beat, .75, .55, .75); pc.eng.djEchoOff(t + bd, .06); } catch (e) {} }
      else if (pc.bars % 16 === 15 && rng.chance(.3)) { try { pc.eng.djBump(t, bd, 700); fx.sweepUp(t, bd, .3); } catch (e) {} }
      else if (ph === 7 && rng.chance(.15) && tr.energy > .5) { try { fx.laser(t + beat * 3.5, .4); } catch (e) {} }
    };
    M.skip = function () { M.forceNext = true; };
    return M;
  }
  function mix(opts, popts) {
    var c = ensureCtx(); if (!c) { emit("error", { message: "Web Audio is not supported here" }); return null; }
    var plan = buildMixPlan(opts), now = c.currentTime;
    P.outs.forEach(function (o) { o.eng.fadeOut(now, 1.2); setTimeout(function () { o.eng.dispose(); }, 1500); }); P.outs = [];
    if (P.piece) { var old = P.piece; old.eng.fadeOut(now, 1.8); setTimeout(function () { old.eng.dispose(); }, 2000); }
    var ctl = MixCtl(c, P.volG, plan, P.quality >= 1, P.quality), pc = ctl.begin(now + .12);
    P.lastBrief = { mix: opts || {} };
    P.mix = { ctl: ctl, plan: plan }; P.piece = pc; P.paused = false;
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    P.holdG.gain.setTargetAtTime(P.held ? 0 : 1, now, .05);
    startTimer(); tick();
    var inf = info(); mediaSession(inf); try { global.navigator.mediaSession.playbackState = "playing"; } catch (e) {}
    emit("start", { info: inf, mix: true }); return inf;
  }
  function mixNext() { if (!P.mix) return false; P.mix.ctl.skip(); return true; }
  function mixInfo() {
    if (!P.mix) return null; var m = P.mix.ctl;
    return { index: m.idx, total: m.plan.tracks.length, trans: m.plan.trans, minutes: m.plan.minutes, shape: m.plan.shape, tracks: m.plan.tracks.map(function (t) { return { style: STYLES[t.style].name, mood: t.mood, bpm: t.nat }; }) };
  }
  function renderMix(opts, seconds, ropts) {
    ropts = ropts || {};
    var OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext, sr = ropts.sampleRate || 44100, off = new OAC(2, Math.ceil(sr * seconds), sr);
    var plan = buildMixPlan(opts), ctl = MixCtl(off, off.destination, plan, !!ropts.lite, ropts.lite ? 1 : 0), pcs = [ctl.begin(0)], primary = pcs[0];
    for (var guard = 0; guard < 20000; guard++) {
      var live = pcs.filter(function (p) { return !(p.endT && p.nextT >= p.endT) && p.nextT < seconds; }); if (!live.length) break;
      var pc = live.reduce(function (a, b) { return a.nextT <= b.nextT ? a : b; });
      var bar = pc.comp.nextBar(), made = ctl.afterBar(pc, bar);
      pc.eng.playBar(bar, pc.nextT); pc.nextT += bar.barDur; pc.bars++;
      if (made) { pcs.push(made); primary = made; }
    }
    return off.startRendering().then(function (buf) { buf.echoPlan = plan; return buf; });
  }

  /* ── offline render: for tests and for saving a piece as a WAV file ── */
  function render(brief, seconds, opts) {
    opts = opts || {};
    var OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext, sr = opts.sampleRate || 44100;
    var off = new OAC(2, Math.ceil(sr * seconds), sr), pb = parseBrief(brief), seed = pb.seed !== undefined ? pb.seed : (opts.seed !== undefined ? opts.seed >>> 0 : randomSeed());
    var comp = Composer(pb, seed), eng = Engine(off, off.destination, { lite: !!opts.lite, solo: opts.solo, mute: opts.mute, trim: opts.trim });
    var t = 0; while (t < seconds) { var bar = comp.nextBar(); eng.playBar(bar, t); t += bar.barDur; }
    if (opts.fade !== false) { eng.out.gain.setValueAtTime(.0001, 0); eng.out.gain.linearRampToValueAtTime(1, Math.min(2, seconds / 4)); eng.out.gain.setValueAtTime(1, Math.max(0, seconds - 3)); eng.out.gain.linearRampToValueAtTime(0, seconds); }
    return off.startRendering().then(function (buf) { buf.echoInfo = comp.info(); return buf; });
  }
  function toWav(buf) {
    var ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, ab = new ArrayBuffer(44 + n * ch * 2), v = new DataView(ab), o = 0, c, i;
    function w(s) { for (var q = 0; q < s.length; q++) v.setUint8(o++, s.charCodeAt(q)); }
    w("RIFF"); v.setUint32(o, 36 + n * ch * 2, true); o += 4; w("WAVEfmt "); v.setUint32(o, 16, true); o += 4; v.setUint16(o, 1, true); o += 2; v.setUint16(o, ch, true); o += 2;
    v.setUint32(o, sr, true); o += 4; v.setUint32(o, sr * ch * 2, true); o += 4; v.setUint16(o, ch * 2, true); o += 2; v.setUint16(o, 16, true); o += 2; w("data"); v.setUint32(o, n * ch * 2, true); o += 4;
    var d = []; for (c = 0; c < ch; c++) d.push(buf.getChannelData(c));
    for (i = 0; i < n; i++) for (c = 0; c < ch; c++) { var x = clamp(d[c][i], -1, 1); v.setInt16(o, x < 0 ? x * 32768 : x * 32767, true); o += 2; }
    return new Blob([ab], { type: "audio/wav" });
  }
  function exportMixWav(opts, seconds) { return renderMix(opts, seconds || 120, { lite: false }).then(toWav); }
  /* MP3 (lamejs, LGPL, bundled in vendor/lame.min.js and loaded only when a download asks for it). Encoding is done in slices so the page stays responsive. */
  var lamePromise = null;
  function loadLame() {
    if (global.lamejs) return Promise.resolve(global.lamejs); if (lamePromise) return lamePromise;
    lamePromise = new Promise(function (res, rej) { var el = global.document.createElement("script"); el.src = (SMP.base ? SMP.base.replace(/samples\/?$/, "") : "/") + "vendor/lame.min.js"; el.onload = function () { global.lamejs ? res(global.lamejs) : rej(new Error("mp3 encoder missing")); }; el.onerror = function () { lamePromise = null; rej(new Error("could not load the mp3 encoder")); }; global.document.head.appendChild(el); });
    return lamePromise;
  }
  function toMp3(buf, kbps) {
    return loadLame().then(function (L) {
      return new Promise(function (resolve, reject) {
        try {
          var ch = Math.min(2, buf.numberOfChannels), sr = buf.sampleRate, n = buf.length, enc = new L.Mp3Encoder(ch, sr, kbps || 160), out = [], pos = 0, BL = 1152 * 12, l = new Int16Array(n), r = ch > 1 ? new Int16Array(n) : null, i;
          var d0 = buf.getChannelData(0), d1 = ch > 1 ? buf.getChannelData(1) : null;
          for (i = 0; i < n; i++) { var a = clamp(d0[i], -1, 1); l[i] = a < 0 ? a * 32768 : a * 32767; if (r) { var b = clamp(d1[i], -1, 1); r[i] = b < 0 ? b * 32768 : b * 32767; } }
          (function step() {
            try {
              var t0 = Date.now(); while (pos < n && Date.now() - t0 < 25) { var k = enc.encodeBuffer(l.subarray(pos, pos + BL), r ? r.subarray(pos, pos + BL) : undefined); if (k.length) out.push(new Uint8Array(k)); pos += BL; }
              if (pos < n) return setTimeout(step, 0);
              var f = enc.flush(); if (f.length) out.push(new Uint8Array(f)); resolve(new Blob(out, { type: "audio/mpeg" }));
            } catch (e) { reject(e); }
          })();
        } catch (e) { reject(e); }
      });
    });
  }
  function exportWav(brief, seconds, o) { o = o || {}; return render(brief, seconds || 60, { lite: false, sampleRate: o.sampleRate }).then(o.mp3 ? function (b) { return toMp3(b, o.kbps); } : toWav); }
  /* how long one full pass through the written form lasts (a piece without a plan: two minutes) */
  function songSeconds(brief) {
    try {
      var pb = parseBrief(brief), raw = brief && (brief.planSrc || brief.plan), pl = raw && parsePlan(raw); if (!pl) return 120;
      var comp = Composer(pb, pb.seed !== undefined ? pb.seed : 1), bpm = comp.info().bpm || pl.bpm || 100, bars = 0; pl.sections.forEach(function (x) { bars += x.bars; });
      return clamp(Math.round(bars * 240 / bpm + 4), 30, 420);
    } catch (e) { return 120; }
  }
  function exportSong(brief, o) { o = o || {}; var sec = songSeconds(brief); return exportWav(brief, sec, { sampleRate: o.mp3 || sec <= 200 ? 44100 : 32000, mp3: o.mp3, kbps: o.kbps }); }
  function savedBrief(i) { var e = taste.seeds[i]; if (!e) return null; var b = {}; for (var k in e.b) b[k] = e.b[k]; b.seed = strToSeed(e.s); b._title = e.t; return b; }
  function exportSaved(i, seconds, o) { var b = savedBrief(i); if (!b) return Promise.reject(new Error("no such piece")); return seconds ? exportWav(b, seconds, o) : exportSong(b, o); }

  /* ═══════════════ genre exemplars ═══════════════
   * One hand-written, professionally structured piece per genre. They are never played; they are shown to the LLM writers as "this is what good looks like"
   * (planner: form, chords, band, motif; melody writer: the verse/chorus tune; bass and drum writers: the bassline and groove). Every one scores 100 on the critic. */
/* Hand-written exemplars: one professionally structured piece per genre. Notation helpers keep it compact.
   N("bar:step:deg:len ...")  melody notes;  B("bar:step:tone:len ...")  bass notes. */
  function N(s) { return s.trim().split(/\s+/).map(function (x) { var p = x.split(":"); return [+p[0], +p[1], +p[2], +p[3]]; }); }
  function B(s) { return s.trim().split(/\s+/).map(function (x) { var p = x.split(":"); return [+p[0], +p[1], p[2], +p[3]]; }); }
  function Sx(kind, bars, energy, chords, o) { var x = { kind: kind, bars: bars, energy: energy, chords: chords.split(" "), lead: "theme", drums: 2 }; for (var k in o) x[k] = o[k]; return x; }
  var EX = {};

  EX.pop = { title: "Golden Hour", key: "C", mode: "major", bpm: 100, style: "pop", moods: ["joy", "hope", "love"],
    band: { pad: "pad", comp: "piano", lead: "keys", arp: "none", bass: "ebass" }, motif: { on: [0, 4, 6, 8], deg: [4, 2, 4, 5] },
    sections: [
      Sx("intro", 4, .3, "C G Am F", { lead: "none", drums: 0 }),
      Sx("verse", 8, .5, "C G Am F", { drums: 1, mel: N("0:0:4:3 0:4:2:2 0:6:4:2 0:8:5:2 0:10:4:2 0:12:2:4 1:0:1:4 1:4:1:2 1:6:2:2 1:8:1:2 1:10:0:2 1:12:-1:4 2:0:2:4 2:4:2:2 2:6:0:2 2:8:2:4 2:12:0:4 3:0:0:4 3:4:5:2 3:6:3:2 3:8:0:8"),
        bassline: B("0:0:R:3 0:4:R:3 0:8:5:3 0:12:R:2 0:14:a:2"), groove: { kick: "x.......x.......", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("prechorus", 4, .65, "Am F G G", { lead: "sparse", drums: 1 }),
      Sx("chorus", 8, .9, "F C G Am", { mel: N("0:0:5:4 0:4:5:2 0:6:7:2 0:8:5:4 0:12:3:4 1:0:7:4 1:4:7:2 1:6:6:2 1:8:4:4 1:12:2:4 2:0:6:4 2:4:6:2 2:6:7:2 2:8:6:4 2:12:4:4 3:0:7:6 3:6:5:2 3:8:2:8"),
        bassline: B("0:0:R:2 0:2:R:2 0:4:R:2 0:6:R:2 0:8:5:3 0:11:5:1 0:12:R:2 0:14:a:2"), groove: { kick: "x.....x.x.x.....", snare: "....x.......x...", clap: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", open: "......x.......x." } }),
      Sx("verse", 8, .55, "C G Am F", { drums: 1 }),
      Sx("prechorus", 4, .7, "Am F G G", { lead: "sparse", drums: 1 }),
      Sx("chorus", 8, .95, "F C G Am", {}),
      Sx("bridge", 4, .4, "Am Em F G", { lead: "sparse", drums: 1 }),
      Sx("chorus", 8, 1, "F C G Am", {}),
      Sx("outro", 4, .3, "F C G C", { lead: "sparse", drums: 0 })] };

  EX.rock = { title: "Thunder Road Home", key: "E", mode: "minor", bpm: 124, style: "rock", moods: ["anger", "joy"],
    band: { pad: "none", comp: "dguitar", lead: "lguitar", arp: "none", bass: "ebass" }, motif: { on: [0, 3, 6, 8], deg: [4, 4, 2, 0] },
    sections: [
      Sx("intro", 4, .5, "E5 E5 D5 A5", { lead: "none", drums: 1 }),
      Sx("verse", 8, .6, "E5 E5 D5 A5", { drums: 2, mel: N("0:0:4:4 0:4:4:2 0:6:2:2 0:8:0:4 0:12:4:4 1:0:4:4 1:4:2:2 1:6:0:2 1:8:4:6 2:0:3:4 2:4:3:2 2:6:2:2 2:8:3:4 2:12:6:4 3:0:3:4 3:4:4:2 3:6:3:2 3:8:0:8"),
        bassline: B("0:0:R:3 0:3:R:1 0:4:R:2 0:6:R:2 0:8:R:3 0:11:R:1 0:12:R:2 0:14:a:2"), groove: { kick: "x.......x.x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("chorus", 8, .95, "C5 D5 E5 E5", { mel: N("0:0:9:4 0:4:9:2 0:6:7:2 0:8:9:4 0:12:7:4 1:0:10:4 1:4:10:2 1:6:9:2 1:8:10:4 1:12:8:4 2:0:11:4 2:4:11:2 2:6:10:2 2:8:11:4 2:12:7:4 3:0:11:6 3:6:9:2 3:8:7:8"),
        bassline: B("0:0:R:2 0:2:R:2 0:4:R:2 0:6:R:2 0:8:R:2 0:10:R:2 0:12:5:3 0:15:a:1"), groove: { kick: "x.....x.x.x.....", snare: "....X.......X...", hat: "x.x.x.x.x.x.x.x.", open: "..............x." } }),
      Sx("verse", 8, .65, "E5 E5 D5 A5", {}),
      Sx("chorus", 8, 1, "C5 D5 E5 E5", {}),
      Sx("solo", 8, .9, "E5 C5 D5 E5", { lead: "varied" }),
      Sx("chorus", 8, 1, "C5 D5 E5 E5", {}),
      Sx("outro", 4, .6, "E5 D5 A5 E5", { lead: "sparse", drums: 1 })] };

  EX.rocknroll = { title: "Shake It Tonight", key: "A", mode: "mixolydian", bpm: 150, style: "rocknroll", moods: ["joy"],
    band: { pad: "none", comp: "piano", lead: "eguitar", arp: "none", bass: "upbass" }, motif: { on: [0, 3, 4, 8], deg: [2, 4, 0, 2] },
    sections: [
      Sx("intro", 4, .5, "A7 A7 E7 E7", { lead: "none", drums: 1 }),
      Sx("verse", 12, .7, "A7 A7 A7 A7 D7 D7 A7 A7 E7 D7 A7 E7", { mel: N("0:0:4:3 0:4:2:2 0:6:0:2 0:8:2:4 0:12:4:4 1:0:4:3 1:4:2:2 1:6:0:2 1:8:2:4 1:12:0:4 2:0:2:3 2:4:4:2 2:6:2:2 2:8:0:4 2:12:2:4 3:0:4:6 3:8:2:2 3:10:0:2 3:12:0:4"),
        bassline: B("0:0:R:2 0:2:3:2 0:4:5:2 0:6:6:2 0:8:8:3 0:11:6:1 0:12:5:2 0:14:3:2"), groove: { kick: "x.....x.x.......", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("verse", 12, .8, "A7 A7 A7 A7 D7 D7 A7 A7 E7 D7 A7 E7", {}),
      Sx("solo", 12, .9, "A7 A7 A7 A7 D7 D7 A7 A7 E7 D7 A7 E7", { lead: "varied" }),
      Sx("chorus", 8, 1, "A D A E", { mel: N("0:0:7:3 0:3:7:1 0:4:9:4 0:8:7:2 0:10:4:2 0:12:2:4 1:0:5:3 1:3:5:1 1:4:7:4 1:8:5:4 1:12:3:4 2:0:4:3 2:3:4:1 2:4:7:4 2:8:4:4 2:12:2:4 3:0:4:4 3:4:1:4 3:8:4:8"),
        bassline: B("0:0:R:2 0:2:3:2 0:4:5:2 0:6:6:2 0:8:8:3 0:11:6:1 0:12:5:2 0:14:3:2"), groove: { kick: "x.....x.x.......", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("verse", 12, .9, "A7 A7 A7 A7 D7 D7 A7 A7 E7 D7 A7 E7", {}),
      Sx("outro", 4, .6, "A7 D7 A7 E7", { lead: "sparse", drums: 1 })] };

  EX.country = { title: "Dusty Road Home", key: "G", mode: "major", bpm: 104, style: "country", moods: ["hope", "joy", "love"],
    band: { pad: "steel", comp: "guitar", lead: "eguitar", arp: "none", bass: "upbass" }, motif: { on: [0, 4, 6, 8], deg: [4, 2, 0, 2] },
    sections: [
      Sx("intro", 4, .4, "G C G D", { lead: "none", drums: 1 }),
      Sx("verse", 8, .6, "G C G D", { drums: 1, mel: N("0:0:4:4 0:4:2:2 0:6:2:2 0:8:2:4 0:12:4:4 1:0:5:4 1:4:3:2 1:6:5:2 1:8:7:4 1:12:5:4 2:0:4:4 2:4:2:2 2:6:0:2 2:8:2:4 2:12:2:4 3:0:4:6 3:6:6:2 3:8:8:4 3:12:6:4"),
        bassline: B("0:0:R:3 0:4:R:1 0:8:5:3 0:12:5:1"), groove: { kick: "x.......x.......", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("chorus", 8, .9, "G D Em C", { mel: N("0:0:7:4 0:4:7:2 0:6:9:2 0:8:7:4 0:12:4:4 1:0:8:4 1:4:8:2 1:6:6:2 1:8:4:4 1:12:6:4 2:0:9:4 2:4:7:2 2:6:5:2 2:8:7:4 2:12:9:4 3:0:7:4 3:4:5:2 3:6:3:2 3:8:5:4 3:12:7:8"),
        bassline: B("0:0:R:3 0:4:R:1 0:8:5:3 0:12:5:1"), groove: { kick: "x.......x.......", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("solo", 8, .85, "G C G D", { lead: "varied", drums: 1 }),
      Sx("verse", 8, .65, "G C G D", { drums: 1 }),
      Sx("outro", 4, .45, "G C G G", { lead: "sparse", drums: 1 })] };

  EX.bluegrass = { title: "Hollow Creek", key: "G", mode: "major", bpm: 140, style: "bluegrass", moods: ["joy", "hope"],
    band: { pad: "none", comp: "guitar", lead: "banjo", arp: "mandolin", bass: "upbass" }, motif: { on: [0, 4, 6, 8], deg: [4, 2, 0, 2] },
    sections: [
      Sx("intro", 4, .5, "G C G D", { lead: "none", drums: 0 }),
      Sx("verse", 8, .65, "G C G D", { drums: 0, mel: N("0:0:4:4 0:4:2:2 0:6:2:2 0:8:2:4 0:12:4:4 1:0:5:4 1:4:3:2 1:6:5:2 1:8:7:4 1:12:5:4 2:0:4:4 2:4:2:2 2:6:0:2 2:8:2:4 2:12:2:4 3:0:4:6 3:6:6:2 3:8:8:4 3:12:6:4"),
        bassline: B("0:0:R:3 0:4:R:1 0:8:5:3 0:12:5:1") }),
      Sx("chorus", 8, .9, "G D Em C", { drums: 0, mel: N("0:0:7:4 0:4:7:2 0:6:9:2 0:8:7:4 0:12:4:4 1:0:8:4 1:4:8:2 1:6:6:2 1:8:4:4 1:12:6:4 2:0:9:4 2:4:7:2 2:6:5:2 2:8:7:4 2:12:9:4 3:0:7:4 3:4:5:2 3:6:3:2 3:8:5:4 3:12:7:8"),
        bassline: B("0:0:R:3 0:4:R:1 0:8:5:3 0:12:5:1") }),
      Sx("solo", 8, .85, "G C G D", { lead: "varied", drums: 0 }),
      Sx("verse", 8, .7, "G C G D", { drums: 0 }),
      Sx("outro", 4, .5, "G C G G", { lead: "sparse", drums: 0 })] };

  EX.irish = { title: "The Green Hill Reel", key: "D", mode: "dorian", bpm: 112, style: "irish", moods: ["joy", "hope", "neutral"],
    band: { pad: "none", comp: "guitar", lead: "whistle", arp: "banjo", bass: "upbass" }, motif: { on: [0, 2, 4, 6], deg: [4, 5, 4, 2] },
    sections: [
      Sx("intro", 4, .4, "Dm C G Dm", { lead: "none", drums: 0 }),
      Sx("verse", 8, .65, "Dm C Dm C", { drums: 1, mel: N("0:0:4:2 0:2:5:2 0:4:4:2 0:6:2:2 0:8:4:4 0:12:7:2 0:14:5:2 1:0:8:2 1:2:7:2 1:4:6:2 1:6:7:2 1:8:8:4 1:12:8:2 1:14:6:2 2:0:7:2 2:2:8:2 2:4:9:2 2:6:8:2 2:8:7:4 2:12:4:2 2:14:5:2 3:0:6:2 3:2:7:2 3:4:8:4 3:8:7:2 3:10:8:2 3:12:6:4"),
        bassline: B("0:0:R:3 0:4:R:1 0:8:5:3 0:12:5:1") }),
      Sx("chorus", 8, .85, "F C Dm C", { drums: 1, mel: N("0:0:9:2 0:2:8:2 0:4:9:2 0:6:7:2 0:8:9:4 0:12:7:2 0:14:9:2 1:0:8:2 1:2:7:2 1:4:8:2 1:6:7:2 1:8:8:4 1:12:6:2 1:14:8:2 2:0:7:2 2:2:9:2 2:4:7:2 2:6:9:2 2:8:9:4 2:12:7:2 2:14:7:2 3:0:8:2 3:2:7:2 3:4:6:2 3:6:7:2 3:8:8:4 3:12:8:4"),
        bassline: B("0:0:R:3 0:4:R:1 0:8:5:3 0:12:5:1") }),
      Sx("solo", 8, .95, "Dm C Dm C", { lead: "varied", drums: 1 }),
      Sx("verse", 8, .7, "Dm C Dm C", { drums: 1 }),
      Sx("outro", 4, .35, "Dm C Dm Dm", { lead: "sparse", drums: 0 })] };

  EX.lingala = { title: "Sebene Nights", key: "E", mode: "major", bpm: 128, style: "lingala", moods: ["joy", "love", "hope"],
    band: { pad: "organ", comp: "guitar", lead: "eguitar", arp: "eguitar", bass: "ebass" }, motif: { on: [0, 3, 6, 8], deg: [4, 2, 4, 2] },
    sections: [
      Sx("intro", 4, .4, "E A B7 E", { lead: "sparse", drums: 1 }),
      Sx("verse", 8, .6, "E A B7 E", { drums: 2, mel: N("0:0:4:3 0:3:2:3 0:6:4:2 0:8:2:4 0:12:4:4 1:0:5:3 1:3:3:3 1:6:5:2 1:8:7:4 1:12:5:4 2:0:4:3 2:3:6:3 2:6:8:2 2:8:6:4 2:12:4:4 3:0:2:3 3:3:4:3 3:6:2:2 3:8:0:8"),
        bassline: B("0:0:R:3 0:3:R:2 0:6:5:3 0:10:R:2 0:12:5:2 0:14:a:2"), groove: { kick: "x..x..x...x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("chorus", 8, .8, "A B7 C#m E", { drums: 2, mel: N("0:0:7:3 0:3:5:3 0:6:7:2 0:8:5:4 0:12:7:4 1:0:8:3 1:3:6:3 1:6:8:2 1:8:6:4 1:12:4:4 2:0:7:3 2:3:5:3 2:6:7:2 2:8:5:4 2:12:7:4 3:0:2:3 3:3:4:3 3:6:2:2 3:8:0:8"),
        bassline: B("0:0:R:3 0:3:R:2 0:6:5:3 0:10:R:2 0:12:5:2 0:14:a:2"), groove: { kick: "x..x..x...x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("solo", 16, .95, "E B7 E B7", { lead: "varied", drums: 2 }),
      Sx("verse", 8, .65, "E A B7 E", { drums: 2 }),
      Sx("outro", 4, .4, "E A B7 E", { lead: "sparse", drums: 1 })] };

  EX.blues = { title: "Slow Burn Blues", key: "E", mode: "mixolydian", bpm: 78, style: "blues", moods: ["sadness", "love"],
    band: { pad: "none", comp: "hammond", lead: "lguitar", arp: "none", bass: "upbass" }, motif: { on: [0, 4, 8, 10], deg: [4, 2, 0, 2] },
    sections: [
      Sx("intro", 4, .4, "E7 A7 E7 B7", { lead: "none", drums: 1 }),
      Sx("verse", 12, .6, "E7 A7 E7 E7 A7 A7 E7 E7 B7 A7 E7 B7", { drums: 1, mel: N("0:0:4:4 0:4:2:2 0:6:0:2 0:8:2:6 1:0:5:4 1:4:3:2 1:6:5:2 1:8:0:2 1:10:1:2 1:12:0:4 2:0:4:4 2:4:2:2 2:6:0:2 2:8:4:4 2:12:2:4 3:0:2:4 3:4:0:4 3:8:0:8"),
        bassline: B("0:0:R:4 0:4:3:2 0:6:5:2 0:8:6:4 0:12:5:2 0:14:3:2"), groove: { kick: "x.......x.......", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("verse", 12, .7, "E7 A7 E7 E7 A7 A7 E7 E7 B7 A7 E7 B7", { drums: 2 }),
      Sx("solo", 12, .9, "E7 A7 E7 E7 A7 A7 E7 E7 B7 A7 E7 B7", { lead: "varied", drums: 2 }),
      Sx("chorus", 8, .95, "E9 A9 E9 E9 A9 A9 B7 E9", { drums: 2, mel: N("0:0:4:4 0:4:4:2 0:6:2:2 0:8:0:4 0:12:2:4 1:0:5:4 1:4:5:2 1:6:3:2 1:8:5:4 1:12:7:4 2:0:4:4 2:4:2:2 2:6:0:2 2:8:2:4 2:12:4:4 3:0:2:4 3:4:0:4 3:8:0:8"),
        bassline: B("0:0:R:4 0:4:3:2 0:6:5:2 0:8:6:4 0:12:5:2 0:14:3:2"), groove: { kick: "x.......x.......", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("verse", 12, .7, "E7 A7 E7 E7 A7 A7 E7 E7 B7 A7 E7 B7", { drums: 2 }),
      Sx("outro", 4, .4, "E7 A7 E7 B7", { lead: "sparse", drums: 1 })] };

  EX.jazz = { title: "Blue Room Late", key: "C", mode: "ionian", bpm: 118, style: "jazz", moods: ["love", "neutral", "joy"],
    band: { pad: "none", comp: "piano", lead: "sax", arp: "none", bass: "upbass" }, motif: { on: [0, 3, 6, 8], deg: [4, 6, 5, 4] },
    sections: [
      Sx("head", 8, .6, "Dm7 G7 Cmaj7 A7", { mel: N("0:0:5:4 0:4:3:2 0:6:5:2 0:8:6:4 0:12:5:4 1:0:6:4 1:4:4:2 1:6:6:2 1:8:7:4 1:12:6:4 2:0:7:6 2:6:4:2 2:8:2:4 2:12:4:4 3:0:5:4 3:4:3:2 3:6:5:2 3:8:4:8"),
        bassline: B("0:0:R:4 0:4:3:4 0:8:5:4 0:12:a:4"), groove: { ride: "x...x.xx...x.x..", rim: "....x.......x...", kick: "x.......x.......", snare: "..........o....." }, drums: 1 }),
      Sx("solo", 16, .8, "Dm7 G7 Cmaj7 A7 Dm7 G7 Cmaj7 A7", { lead: "varied", drums: 1 }),
      Sx("trade", 8, .85, "Dm7 G7 Cmaj7 A7", { lead: "varied", drums: 1 }),
      Sx("chorus", 8, .7, "Dm7 G7 Cmaj7 A7", { drums: 1, mel: N("0:0:5:4 0:4:3:2 0:6:5:2 0:8:6:4 0:12:5:4 1:0:6:4 1:4:4:2 1:6:6:2 1:8:7:4 1:12:6:4 2:0:7:6 2:6:4:2 2:8:2:4 2:12:4:4 3:0:5:4 3:4:3:2 3:6:5:2 3:8:4:8"),
        bassline: B("0:0:R:4 0:4:3:4 0:8:5:4 0:12:a:4"), groove: { ride: "x...x.xx...x.x..", rim: "....x.......x...", kick: "x.......x.......", snare: "..........o....." } }),
      Sx("outro", 4, .4, "Dm7 G7 Cmaj7 Cmaj7", { lead: "sparse", drums: 0 })] };

  EX.reggae = { title: "Island Morning", key: "G", mode: "ionian", bpm: 76, style: "reggae", moods: ["joy", "hope", "love"],
    band: { pad: "none", comp: "organ", lead: "guitar", arp: "none", bass: "ebass" }, motif: { on: [0, 4, 8, 12], deg: [4, 2, 4, 5] },
    sections: [
      Sx("intro", 4, .4, "G D Em C", { lead: "none", drums: 1 }),
      Sx("verse", 8, .55, "G D Em C", { drums: 1, mel: N("0:0:4:6 0:8:2:4 0:12:4:4 1:0:5:6 1:8:4:4 1:12:1:4 2:0:2:6 2:8:4:4 2:12:2:4 3:0:0:6 3:8:2:4 3:12:0:4"),
        bassline: B("0:2:R:6 0:8:5:4 0:12:R:4"), groove: { kick: "........x.......", rim: "........x.......", hat: "x.x.x.x.x.x.x.x.", shaker: "o.o.o.o.o.o.o.o." } }),
      Sx("chorus", 8, .8, "C G Am D", { mel: N("0:0:7:6 0:8:5:4 0:12:3:4 1:0:2:6 1:8:4:4 1:12:7:4 2:0:5:6 2:8:8:4 2:12:5:4 3:0:6:6 3:8:4:8"),
        bassline: B("0:2:R:6 0:8:5:4 0:12:8:4"), groove: { kick: "........x.......", rim: "........x.......", hat: "x.x.x.x.x.x.x.x.", shaker: "o.o.o.o.o.o.o.o.", open: "......x.......x." } }),
      Sx("verse", 8, .6, "G D Em C", { drums: 1 }),
      Sx("chorus", 8, .85, "C G Am D", {}),
      Sx("bridge", 4, .45, "Em C G D", { lead: "sparse", drums: 1 }),
      Sx("chorus", 8, .9, "C G Am D", {}),
      Sx("outro", 4, .35, "G D Em G", { lead: "sparse", drums: 1 })] };

  EX.funk = { title: "Pocket Money", key: "E", mode: "dorian", bpm: 104, style: "funk", moods: ["joy", "anger"],
    band: { pad: "none", comp: "eguitar", lead: "horns", arp: "none", bass: "ebass" }, motif: { on: [0, 3, 6, 10], deg: [4, 4, 2, 0] },
    sections: [
      Sx("intro", 4, .5, "Em7 Em7 A7 Em7", { lead: "none", drums: 1 }),
      Sx("verse", 8, .65, "Em7 Em7 A7 Em7", { mel: N("0:0:4:2 0:3:4:1 0:6:2:2 0:10:0:2 0:12:4:4 1:0:4:2 1:3:4:1 1:6:2:2 1:10:0:2 1:12:2:4 2:0:5:3 2:3:3:1 2:6:5:2 2:10:3:2 2:12:0:4 3:0:4:2 3:3:2:1 3:6:0:2 3:10:2:2 3:12:0:4"),
        bassline: B("0:0:R:2 0:3:R:1 0:6:b7:2 0:8:5:2 0:10:R:2 0:14:a:2"), groove: { kick: "X..x..x...x..x..", snare: "....X..o....X..o", hat: "x.xxx.xxx.xxx.xx", open: "......x.......x." } }),
      Sx("chorus", 8, .95, "A7 A7 Em7 Em7", { mel: N("0:0:7:2 0:3:7:1 0:6:5:2 0:10:3:2 0:12:7:4 1:0:7:2 1:3:7:1 1:6:5:2 1:10:3:2 1:12:5:4 2:0:9:4 2:6:7:2 2:8:4:2 2:12:7:4 3:0:4:4 3:6:2:2 3:8:0:8"),
        bassline: B("0:0:R:2 0:3:R:1 0:6:5:2 0:8:b7:2 0:10:R:2 0:14:a:2"), groove: { kick: "X..x..x..x.x..x.", snare: "....X..o....X.oo", clap: "....x.......x...", hat: "xxxxxxxxxxxxxxxx", open: "..x...x...x...x." } }),
      Sx("verse", 8, .7, "Em7 Em7 A7 Em7", {}),
      Sx("chorus", 8, 1, "A7 A7 Em7 Em7", {}),
      Sx("break", 4, .4, "Gmaj7 A7 Bm7 Em7", { lead: "none", drums: 1 }),
      Sx("chorus", 8, 1, "A7 A7 Em7 Em7", {}),
      Sx("outro", 4, .5, "Em7 A7 Em7 Em7", { lead: "sparse", drums: 1 })] };

  EX.hiphop = { title: "Concrete Sunrise", key: "A", mode: "minor", bpm: 88, style: "hiphop", moods: ["anger", "sadness", "neutral"],
    band: { pad: "pad", comp: "keys", lead: "bells", arp: "none", bass: "808" }, motif: { on: [0, 3, 8, 10], deg: [4, 2, 0, 2] },
    sections: [
      Sx("intro", 4, .4, "Am7 Am7 Fmaj7 G", { lead: "none", drums: 0 }),
      Sx("verse", 8, .65, "Am7 Am7 Fmaj7 G", { mel: N("0:0:4:4 0:6:2:2 0:8:0:4 0:12:2:4 1:0:4:6 1:8:2:4 1:12:0:4 2:0:3:4 2:6:5:2 2:8:3:4 2:12:0:4 3:0:1:4 3:6:2:2 3:8:1:8"),
        bassline: B("0:0:R:8 0:10:R:4 0:14:5:2"), groove: { kick: "X..x......x.....", snare: "....X.......X...", hat: "x.x.x.x.x.x.x.xx" } }),
      Sx("chorus", 8, .9, "F G Am Am", { mel: N("0:0:7:4 0:6:5:2 0:8:7:4 0:12:9:4 1:0:6:6 1:8:8:4 1:12:6:4 2:0:9:4 2:6:7:2 2:8:9:4 2:12:7:4 3:0:9:6 3:6:7:2 3:8:4:8"),
        bassline: B("0:0:R:3 0:3:R:3 0:8:R:2 0:10:R:2 0:12:8:4"), groove: { kick: "X..x....x.x.....", snare: "....X.......X...", clap: "....x.......x...", hat: "x.x.x.x.x.x.xxxx", open: "......x.......x." } }),
      Sx("verse", 8, .7, "Am7 Am7 Fmaj7 G", {}),
      Sx("break", 4, .4, "Fmaj7 G Am7 Am7", { lead: "none", drums: 1 }),
      Sx("chorus", 8, 1, "F G Am Am", {}),
      Sx("outro", 4, .35, "Am7 Fmaj7 G Am7", { lead: "sparse", drums: 1 })] };

  EX.trap = { title: "Midnight Drive", key: "C", mode: "minor", bpm: 140, style: "trap", moods: ["anger", "fear", "sadness"],
    band: { pad: "pad", comp: "keys", lead: "bells", arp: "pluck", bass: "808" }, motif: { on: [0, 3, 6, 8], deg: [4, 2, 0, 2] },
    sections: [
      Sx("intro", 4, .4, "Cm Ab Eb Bb", { lead: "none", drums: 0 }),
      Sx("verse", 8, .65, "Cm Ab Eb Bb", { mel: N("0:0:4:4 0:6:2:2 0:8:0:4 0:12:2:4 1:0:0:6 1:8:2:4 1:12:4:4 2:0:4:4 2:6:2:2 2:8:4:4 2:12:2:4 3:0:6:6 3:8:4:4 3:12:1:4"),
        bassline: B("0:0:R:7 0:7:R:3 0:10:R:2 0:12:R:2 0:14:a:2"), groove: { kick: "x......x..x.x...", snare: "........x.......", hat: "x.xxx.x.xxx.xx.x" } }),
      Sx("chorus", 8, .95, "Ab Bb Cm Cm", { mel: N("0:0:7:4 0:6:5:2 0:8:7:4 0:12:9:4 1:0:8:6 1:8:6:4 1:12:8:4 2:0:9:6 2:8:7:4 2:12:9:4 3:0:9:6 3:6:7:2 3:8:4:8"),
        bassline: B("0:0:R:6 0:8:R:4 0:12:5:4"), groove: { kick: "x.....x.x...x...", snare: "........x.......", clap: "........x.......", hat: "xxxxxxxxxxxxxxxx", open: "......x.......x." } }),
      Sx("verse", 8, .7, "Cm Ab Eb Bb", {}),
      Sx("break", 4, .4, "Ab Bb Cm Cm", { lead: "sparse", drums: 1 }),
      Sx("chorus", 8, 1, "Ab Bb Cm Cm", {}),
      Sx("outro", 4, .4, "Cm Ab Eb Bb", { lead: "sparse", drums: 1 })] };

  EX.afrobeats = { title: "Lagos Evening", key: "A", mode: "minor", bpm: 102, style: "afrobeats", moods: ["joy", "love", "hope"],
    band: { pad: "pad", comp: "keys", lead: "eguitar", arp: "none", bass: "sub" }, motif: { on: [0, 3, 6, 10], deg: [4, 4, 2, 0] },
    sections: [
      Sx("intro", 4, .4, "Am G F G", { lead: "none", drums: 1 }),
      Sx("verse", 8, .6, "Am G F G", { drums: 1, mel: N("0:0:4:3 0:3:2:1 0:6:0:2 0:10:2:2 0:12:0:4 1:0:1:3 1:3:3:1 1:6:1:2 1:10:3:2 1:12:1:4 2:0:5:3 2:3:3:1 2:6:0:2 2:10:3:2 2:12:5:4 3:0:6:3 3:3:4:1 3:6:1:2 3:10:4:2 3:12:6:4"),
        bassline: B("0:0:R:3 0:3:R:3 0:6:5:3 0:10:R:2 0:14:a:2"), groove: { kick: "x..x..x...x.....", rim: "..x..x..x..x..x.", clap: "....x.......x...", shaker: "xoxoxoxoxoxoxoxo", hat: "..x...x...x...x." } }),
      Sx("chorus", 8, .9, "F G Am Am", { mel: N("0:0:7:3 0:3:7:1 0:6:5:2 0:10:3:2 0:12:5:4 1:0:6:3 1:3:8:1 1:6:6:2 1:10:4:2 1:12:6:4 2:0:9:3 2:3:7:1 2:6:9:2 2:10:7:2 2:12:9:4 3:0:7:4 3:6:5:2 3:8:2:8"),
        bassline: B("0:0:R:3 0:3:R:3 0:6:5:3 0:10:R:2 0:12:8:2 0:14:a:2"), groove: { kick: "x..x..x...x...x.", rim: "..x..x..x..x..x.", clap: "....x.......x...", shaker: "xoxoxoxoxoxoxoxo", hat: "..x...x...x...x.", cHi: "...x.x....x.x..." } }),
      Sx("verse", 8, .65, "Am G F G", { drums: 1 }),
      Sx("chorus", 8, .95, "F G Am Am", {}),
      Sx("break", 4, .4, "Dm G F Em", { lead: "none", drums: 1 }),
      Sx("chorus", 8, 1, "F G Am Am", {}),
      Sx("outro", 4, .35, "Am G F Am", { lead: "sparse", drums: 1 })] };

  EX.afrobeat = { title: "Lagos Vamp", key: "A", mode: "dorian", bpm: 110, style: "afrobeat", moods: ["joy", "anger", "neutral"],
    band: { pad: "organ", comp: "eguitar", lead: "sax", arp: "none", bass: "ebass" }, motif: { on: [0, 3, 6, 10], deg: [4, 2, 0, 2] },
    sections: [
      Sx("intro", 8, .4, "Am7 Am7 D7 Am7", { lead: "none", drums: 1, band: { bass: "none", pad: "none" }, groove: { kick: "x..x......x.....", snare: "", shaker: "xoxoxoxoxoxoxoxo", cLo: "..x..x..x..x..x.", rim: "..x..x..x..x..x." } }),
      Sx("verse", 16, .65, "Am7 Am7 D7 Am7", { mel: N("0:0:4:2 0:3:2:1 0:4:0:2 0:8:2:4 1:0:4:2 1:3:2:1 1:4:0:2 1:8:1:4 2:0:4:2 2:3:3:1 2:4:1:2 2:8:3:4 3:0:2:2 3:3:0:1 3:4:2:2 3:8:0:8"),
        bassline: B("0:0:R:3 0:3:R:3 0:6:R:4 0:10:R:2 0:12:5:2"), groove: { kick: "x..x..x...x.....", snare: "....x.......x...", shaker: "xoxoxoxoxoxoxoxo", cLo: "..x..x..x..x..x.", rim: "..x..x..x..x..x." } }),
      Sx("chorus", 16, .9, "Am7 Am7 D7 D7", { band: { lead: "brass" }, mel: N("0:0:6:2 0:3:6:1 0:4:5:2 0:8:4:4 1:0:4:2 1:3:4:1 1:4:5:2 1:8:6:4 2:0:5:2 2:3:5:1 2:4:4:2 2:8:3:4 3:0:4:2 3:3:4:1 3:4:5:2 3:8:7:8"),
        bassline: B("0:0:R:3 0:3:R:3 0:6:R:4 0:10:R:2 0:12:5:2"), groove: { kick: "x..x..x...x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", open: "..x...x...x...x.", cLo: "..x..x..x..x..x.", rim: "..x..x..x..x..x." } }),
      Sx("solo", 16, .85, "Am7 Em7 D7 Gmaj7", { lead: "varied" }),
      Sx("chorus", 16, 1, "Am7 Am7 D7 D7", {}),
      Sx("outro", 8, .4, "Am7 Am7 D7 Am7", { lead: "sparse", drums: 1, band: { pad: "none" } })] };

  EX.amapiano = { title: "Sunday Piano", key: "A", mode: "minor", bpm: 112, style: "amapiano", moods: ["joy", "love", "hope"],
    band: { pad: "pad", comp: "keys", lead: "marimba", arp: "none", bass: "log" }, motif: { on: [0, 3, 6, 10], deg: [4, 2, 4, 0] },
    sections: [
      Sx("intro", 8, .3, "Am9 Fmaj7 Dm9 E7", { lead: "none", drums: 1, band: { bass: "none" }, groove: { kick: "x...x...x...x...", clap: "....x.......x...", shaker: "xoxoxoxoxoxoxoxo", rim: "...x..x...x..x.." } }),
      Sx("verse", 16, .55, "Am9 Fmaj7 Dm9 E7", { drums: 1, mel: N("0:0:4:3 0:6:2:2 0:8:0:4 0:12:2:4 1:0:4:3 1:6:2:2 1:8:4:4 1:12:3:4 2:0:5:3 2:6:3:2 2:8:1:4 2:12:3:4 3:0:3:3 3:6:1:2 3:8:4:8"),
        bassline: B("0:0:R:4 0:4:R:3 0:8:R:3 0:12:5:2 1:0:R:4 1:4:R:3 1:8:5:3 1:12:R:2 1:14:a:2"), groove: { kick: "x...x...x...x...", rim: "...x..x...x..x..", clap: "....x.......x...", shaker: "xoxoxoxoxoxoxoxo", open: "..x...x...x...x." } }),
      Sx("chorus", 16, .9, "Fmaj7 Am9 Dm9 E7", { band: { comp: "none" }, lead: "sparse", mel: N("0:0:7:3 0:6:5:2 0:8:7:4 0:12:9:4 1:0:9:3 1:6:8:2 1:8:7:2 1:10:5:2 1:12:4:4 2:0:7:3 2:6:5:2 2:8:7:4 2:12:5:4 3:0:8:4 3:6:6:2 3:8:4:8"),
        bassline: B("0:0:R:4 0:4:R:3 0:8:R:3 0:12:5:2 1:0:R:4 1:4:5:3 1:8:R:3 1:11:R:2 1:14:a:2"), groove: { kick: "x...x...x...x...", rim: "...x..x...x..x..", clap: "....x.......x...", shaker: "xoxoxoxoxoxoxoxo", open: "..x...x...x...x.", cLo: "..x...x...x..x.." } }),
      Sx("break", 8, .35, "Am9 Fmaj7 Dm9 E7", { lead: "sparse", drums: 1, band: { bass: "none" }, groove: { kick: "x.......x.......", clap: "....x.......x...", shaker: "xoxoxoxoxoxoxoxo", rim: "...x..x...x..x.." } }),
      Sx("chorus", 16, 1, "Fmaj7 Am9 Dm9 E7", {}),
      Sx("outro", 8, .3, "Am9 Fmaj7 Dm9 Am9", { lead: "none", drums: 1, band: { bass: "none" }, groove: { kick: "x...x...x...x...", clap: "....x.......x...", shaker: "xoxoxoxoxoxoxoxo", rim: "...x..x...x..x.." } })] };

  EX.lofi = { title: "Rainy Window", key: "C", mode: "ionian", bpm: 78, style: "lofi", moods: ["calm", "sadness", "neutral"],
    band: { pad: "pad", comp: "keys", lead: "guitar", arp: "none", bass: "upbass" }, motif: { on: [0, 4, 8, 12], deg: [4, 2, 4, 0] },
    sections: [
      Sx("intro", 4, .3, "Cmaj7 Am7 Dm7 G7", { lead: "none", drums: 0 }),
      Sx("verse", 8, .5, "Cmaj7 Am7 Dm7 G7", { drums: 1, mel: N("0:0:4:6 0:8:2:4 0:12:4:4 1:0:5:6 1:8:2:4 1:12:0:4 2:0:5:6 2:8:3:4 2:12:5:4 3:0:6:4 3:6:4:2 3:8:1:8"),
        bassline: B("0:0:R:6 0:8:5:6 0:14:a:2"), groove: { kick: "x.....x.......x.", snare: "....x.......x...", hat: "x.x.x.x.x.x.xoxo" } }),
      Sx("chorus", 8, .7, "Fmaj7 Em7 Dm7 Cmaj7", { mel: N("0:0:5:6 0:8:7:4 0:12:5:4 1:0:4:6 1:8:6:4 1:12:4:4 2:0:5:6 2:8:3:4 2:12:5:4 3:0:4:6 3:8:2:8"),
        bassline: B("0:0:R:6 0:6:R:4 0:10:5:4 0:14:a:2"), groove: { kick: "x.....x...x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.xoxo", open: "..............x." } }),
      Sx("verse", 8, .55, "Cmaj7 Am7 Dm7 G7", { drums: 1 }),
      Sx("bridge", 4, .35, "Am7 Dm7 G7 Cmaj7", { lead: "sparse", drums: 1 }),
      Sx("chorus", 8, .8, "Fmaj7 Em7 Dm7 Cmaj7", {}),
      Sx("outro", 4, .25, "Fmaj7 Em7 Dm7 Cmaj7", { lead: "sparse", drums: 0 })] };

  EX.house = { title: "After Hours", key: "A", mode: "minor", bpm: 124, style: "house", moods: ["joy", "neutral"],
    band: { pad: "pad", comp: "synth", lead: "pluck", arp: "pluck", bass: "synthbass" }, motif: { on: [0, 3, 6, 10], deg: [4, 2, 0, 2] },
    sections: [
      Sx("intro", 8, .4, "Am7 Fmaj7 C G", { lead: "none", drums: 1 }),
      Sx("build", 4, .75, "Am7 Fmaj7 C G", { lead: "none", drums: 2 }),
      Sx("drop", 8, 1, "Am7 Fmaj7 C G", { mel: N("0:0:4:3 0:3:4:1 0:6:2:2 0:10:0:2 0:12:2:4 1:0:3:3 1:3:3:1 1:6:5:2 1:10:3:2 1:12:5:4 2:0:2:3 2:3:2:1 2:6:4:2 2:10:2:2 2:12:0:4 3:0:1:3 3:3:1:1 3:6:4:2 3:10:3:2 3:12:6:4"),
        bassline: B("0:2:R:2 0:6:R:2 0:10:R:2 0:14:R:2"), groove: { kick: "x...x...x...x...", clap: "....x.......x...", hat: "xxxxxxxxxxxxxxxx", open: "..x...x...x...x." } }),
      Sx("break", 8, .4, "Am7 Fmaj7 C G", { lead: "sparse", drums: 0 }),
      Sx("build", 4, .8, "Am7 Fmaj7 C G", { lead: "none", drums: 2 }),
      Sx("drop", 8, 1, "Am7 Fmaj7 C G", {}),
      Sx("outro", 8, .4, "Am7 Fmaj7 C G", { lead: "none", drums: 1 })] };

  EX.phonk = { title: "Neon Drift", key: "D", mode: "phrygian", bpm: 142, style: "phonk", moods: ["anger", "fear"],
    band: { pad: "choir", comp: "keys", lead: "cowbell", arp: "none", bass: "808" }, motif: { on: [0, 3, 6, 8], deg: [2, 2, 3, 2] },
    sections: [
      Sx("intro", 4, .4, "Dm Dm Bb Dm", { lead: "none", drums: 0 }),
      Sx("verse", 8, .7, "Dm Dm Bb Dm", { mel: N("0:0:2:2 0:3:2:2 0:6:3:2 0:8:2:3 0:12:0:2 1:0:2:2 1:3:2:2 1:6:4:2 1:8:3:3 1:12:2:2 2:0:2:2 2:3:2:2 2:6:3:2 2:8:2:3 2:12:0:2 3:0:2:2 3:3:3:2 3:6:2:2 3:8:0:6"),
        bassline: B("0:0:R:3 0:3:R:3 0:6:R:4 0:10:R:3 0:13:5:3"), groove: { kick: "x..x..x...x..x..", snare: "........x.......", clap: "........x.......", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("chorus", 8, 1, "Dm Dm Bb Cm", { mel: N("0:0:4:2 0:3:4:2 0:6:5:2 0:8:4:3 0:12:2:2 1:0:4:2 1:3:4:2 1:6:2:2 1:8:4:3 1:12:2:2 2:0:5:2 2:3:5:2 2:6:7:2 2:8:5:3 2:12:7:2 3:0:6:2 3:3:8:2 3:6:6:2 3:8:8:8"),
        bassline: B("0:0:R:3 0:3:R:3 0:6:R:4 0:10:R:3 0:13:5:3"), groove: { kick: "x..x..x...x..x..", snare: "........x.......", clap: "........x.......", hat: "xxxxxxxxxxxxxxxx", open: ".......x.......x" } }),
      Sx("verse", 8, .75, "Dm Dm Bb Dm", {}),
      Sx("break", 4, .4, "Gm Bb Cm Dm", { lead: "sparse", drums: 1 }),
      Sx("chorus", 8, 1, "Dm Dm Bb Cm", {}),
      Sx("outro", 4, .4, "Dm Bb Dm Dm", { lead: "sparse", drums: 1 })] };

  EX.memphis = { title: "Tape Haze", key: "A", mode: "phrygian", bpm: 74, style: "memphis", moods: ["fear", "sadness", "anger"],
    band: { pad: "ooh", comp: "keys", lead: "cowbell", arp: "none", bass: "808" }, motif: { on: [0, 4, 8, 10], deg: [4, 2, 3, 2] },
    sections: [
      Sx("intro", 4, .4, "Am Am F Am", { lead: "none", drums: 0 }),
      Sx("verse", 8, .65, "Am Am F Am", { mel: N("0:0:4:3 0:4:2:2 0:8:3:3 0:12:2:4 1:0:4:3 1:4:2:2 1:8:4:3 1:12:3:4 2:0:4:3 2:4:2:2 2:8:3:3 2:12:2:4 3:0:2:4 3:6:0:2 3:8:2:8"),
        bassline: B("0:0:R:6 0:6:R:3 0:9:R:2 0:11:R:3 0:14:a:2"), groove: { kick: "x.....x..x.x....", snare: "........x.......", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("chorus", 8, .95, "Am F Dm Am", { mel: N("0:0:7:3 0:4:4:2 0:8:4:3 0:12:2:2 0:14:3:2 1:0:4:3 1:4:5:2 1:8:7:3 1:12:5:2 1:14:4:2 2:0:7:3 2:4:5:2 2:8:5:3 2:12:3:2 2:14:4:2 3:0:4:4 3:6:2:2 3:8:0:8"),
        bassline: B("0:0:R:6 0:6:R:3 0:9:R:2 0:11:R:3 0:14:a:2"), groove: { kick: "x.....x..x.x....", snare: "........x.......", clap: "........x.......", hat: "xxxxxxxxxxxxxxxx", open: ".......x.......x" } }),
      Sx("verse", 8, .7, "Am Am F Am", {}),
      Sx("break", 4, .4, "F Gm Am Am", { lead: "sparse", drums: 1 }),
      Sx("chorus", 8, 1, "Am F Dm Am", {}),
      Sx("outro", 4, .35, "Am F Am Am", { lead: "sparse", drums: 1 })] };

  EX.rnb = { title: "Slow Dance Late", key: "C", mode: "ionian", bpm: 72, style: "rnb", moods: ["love", "sadness"],
    band: { pad: "strings", comp: "keys", lead: "sax", arp: "none", bass: "ebass" }, motif: { on: [0, 4, 8, 12], deg: [4, 2, 4, 5] },
    sections: [
      Sx("intro", 4, .3, "Cmaj9 Am9 Dm9 G13", { lead: "none", drums: 0 }),
      Sx("verse", 8, .5, "Cmaj9 Am9 Dm9 G13", { drums: 1, mel: N("0:0:4:6 0:8:2:4 0:12:4:4 1:0:5:6 1:8:4:4 1:12:2:4 2:0:5:6 2:8:3:4 2:12:5:4 3:0:4:6 3:8:6:8"),
        bassline: B("0:0:R:6 0:8:5:4 0:12:a:4"), groove: { kick: "x.......x.x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.xoxo" } }),
      Sx("chorus", 8, .8, "Fmaj9 Em9 Dm9 G13", { mel: N("0:0:7:6 0:8:5:4 0:12:7:4 1:0:6:6 1:8:4:4 1:12:6:4 2:0:5:6 2:8:7:4 2:12:5:4 3:0:6:4 3:8:4:8"),
        bassline: B("0:0:R:6 0:6:R:4 0:10:5:2 0:12:a:4"), groove: { kick: "x.....x...x.....", snare: "....x.......x...", clap: "....x.......x...", hat: "x.x.x.x.x.x.xoxo", open: "..............x." } }),
      Sx("bridge", 4, .4, "Am9 Dm9 G13 Cmaj9", { lead: "sparse", drums: 1 }),
      Sx("chorus", 8, .85, "Fmaj9 Em9 Dm9 G13", {}),
      Sx("outro", 4, .3, "Fmaj9 Em9 Dm9 Cmaj9", { lead: "sparse", drums: 0 })] };

  EX.ambient = { title: "Slow Light", key: "D", mode: "lydian", bpm: 60, style: "ambient", moods: ["calm", "hope", "neutral"],
    band: { pad: "pad", comp: "strings", lead: "bells", arp: "none", bass: "sub" }, motif: { on: [0, 8], deg: [4, 2] },
    sections: [
      Sx("intro", 8, .2, "Dmaj7 Bm7 Gmaj7 A", { lead: "none", drums: 0 }),
      Sx("verse", 8, .35, "Dmaj7 Bm7 Gmaj7 A", { drums: 0, lead: "sparse", mel: N("0:0:4:8 0:8:2:8 1:0:5:8 1:8:4:8 2:0:6:8 2:8:4:8 3:0:6:12"), bass: false }),
      Sx("chorus", 8, .55, "Gmaj7 A Bm7 Dmaj7", { drums: 0, mel: N("0:0:7:8 0:8:5:8 1:0:6:8 1:8:4:8 2:0:7:8 2:8:9:8 3:0:7:12"), bass: false }),
      Sx("break", 8, .25, "Dmaj7 Bm7 Gmaj7 A", { lead: "none", drums: 0 }),
      Sx("outro", 8, .2, "Dmaj7 Bm7 Gmaj7 Dmaj7", { lead: "sparse", drums: 0 })] };

  EX.opera = { title: "Aria for Winter", key: "D", mode: "minor", bpm: 72, style: "opera", moods: ["sadness", "love", "fear", "hope"],
    band: { pad: "strings", comp: "harp", lead: "vox", arp: "piano", bass: "upbass" }, motif: { on: [0, 8], deg: [4, 2] },
    sections: [
      Sx("intro", 8, .3, "Dm Gm A Dm", { lead: "none", drums: 0 }),
      Sx("verse", 8, .5, "Dm Gm A Dm", { drums: 0, mel: N("0:0:4:6 0:6:3:2 0:8:2:8 1:0:5:6 1:6:4:2 1:8:3:8 2:0:4:6 2:6:5:2 2:8:8:8 3:0:7:6 3:6:6:2 3:8:7:8"), bass: true }),
      Sx("chorus", 8, .8, "Bb F Gm A", { drums: 1, mel: N("0:0:9:6 0:6:8:2 0:8:7:8 1:0:11:6 1:6:10:2 1:8:9:8 2:0:12:6 2:6:11:2 2:8:10:8 3:0:11:6 3:6:10:2 3:8:8:8"), bass: true }),
      Sx("break", 8, .25, "Dm Gm A Dm", { lead: "none", drums: 0 }),
      Sx("outro", 8, .2, "Dm Gm A Dm", { lead: "sparse", drums: 0 })] };

  EX.celtic = { title: "Silver Water", key: "A", mode: "minor", bpm: 76, style: "celtic", moods: ["calm", "love", "hope", "sadness"],
    band: { pad: "choir", comp: "piano", lead: "flute", arp: "harp", bass: "sub" }, motif: { on: [0, 8], deg: [4, 2] },
    sections: [
      Sx("intro", 8, .25, "Am F C G", { lead: "none", drums: 0 }),
      Sx("verse", 8, .4, "Am F C G", { drums: 0, mel: N("0:0:4:6 0:6:3:2 0:8:2:8 1:0:5:6 1:6:6:2 1:8:7:8 2:0:6:6 2:6:5:2 2:8:4:8 3:0:6:6 3:6:7:2 3:8:8:8"), bass: false }),
      Sx("chorus", 8, .65, "F G Am Am", { drums: 0, mel: N("0:0:7:6 0:6:6:2 0:8:5:8 1:0:6:6 1:6:7:2 1:8:8:8 2:0:9:6 2:6:8:2 2:8:7:8 3:0:9:6 3:6:8:2 3:8:7:8"), bass: false }),
      Sx("break", 8, .22, "Am F C G", { lead: "none", drums: 0 }),
      Sx("outro", 8, .2, "Am F C Am", { lead: "sparse", drums: 0 })] };

  EX.cinematic = { title: "The Long Way Back", key: "D", mode: "minor", bpm: 80, style: "cinematic", moods: ["sadness", "fear", "hope"],
    band: { pad: "strings", comp: "piano", lead: "violin", arp: "none", bass: "sub" }, motif: { on: [0, 6, 8], deg: [4, 2, 0] },
    sections: [
      Sx("intro", 8, .25, "Dm Bb F C", { lead: "none", drums: 0 }),
      Sx("verse", 8, .4, "Dm Bb F C", { drums: 0, mel: N("0:0:4:8 0:8:2:8 1:0:3:8 1:8:5:8 2:0:2:8 2:8:4:8 3:0:6:12"), bass: false }),
      Sx("build", 8, .7, "Bb F C Dm", { lead: "none", drums: 1 }),
      Sx("chorus", 8, 1, "Bb F Gm A", { drums: 2, mel: N("0:0:7:6 0:8:9:4 0:12:7:4 1:0:9:6 1:8:11:4 1:12:9:4 2:0:7:6 2:8:5:4 2:12:7:4 3:0:11:6 3:8:8:8"),
        bassline: B("0:0:R:8 0:8:R:4 0:12:R:4"), groove: { kick: "x.......x.......", snare: "........x.......", tom: "..............x.", hat: "x.x.x.x.x.x.x.x." } }),
      Sx("bridge", 4, .35, "Gm Dm Bb A", { lead: "sparse", drums: 0 }),
      Sx("chorus", 8, 1, "Bb F Gm A", { drums: 2 }),
      Sx("outro", 8, .2, "Dm Bb F Dm", { lead: "sparse", drums: 0 })] };

  EX.acoustic = { title: "Porch Light", key: "G", mode: "ionian", bpm: 92, style: "acoustic", moods: ["love", "hope", "calm", "joy"],
    band: { pad: "none", comp: "guitar", lead: "violin", arp: "none", bass: "upbass" }, motif: { on: [0, 4, 6, 8], deg: [4, 2, 4, 5] },
    sections: [
      Sx("intro", 4, .35, "G D Em C", { lead: "none", drums: 0 }),
      Sx("verse", 8, .5, "G D Em C", { drums: 1, mel: N("0:0:4:4 0:4:2:2 0:6:4:2 0:8:2:4 0:12:0:4 1:0:5:4 1:4:4:2 1:6:5:2 1:8:1:4 1:12:-1:4 2:0:2:4 2:4:4:2 2:6:2:2 2:8:0:4 2:12:2:4 3:0:5:4 3:4:3:2 3:6:0:2 3:8:5:8"),
        bassline: B("0:0:R:6 0:8:5:6 0:14:a:2"), groove: { kick: "x.......x.......", rim: "....x.......x...", shaker: "x.x.x.x.x.x.x.x." } }),
      Sx("chorus", 8, .8, "C G D Em", { mel: N("0:0:7:4 0:4:7:2 0:6:9:2 0:8:7:4 0:12:4:4 1:0:6:4 1:4:6:2 1:6:8:2 1:8:6:4 1:12:4:4 2:0:8:4 2:4:8:2 2:6:7:2 2:8:5:4 2:12:3:4 3:0:6:6 3:6:4:2 3:8:2:8"),
        bassline: B("0:0:R:4 0:4:R:2 0:8:5:4 0:12:R:2 0:14:a:2"), groove: { kick: "x.....x.x.......", rim: "....x.......x...", shaker: "x.x.x.x.x.x.x.x.", tamb: "..x...x...x...x." } }),
      Sx("verse", 8, .55, "G D Em C", { drums: 1 }),
      Sx("chorus", 8, .85, "C G D Em", {}),
      Sx("bridge", 4, .4, "Em C G D", { lead: "sparse", drums: 0 }),
      Sx("chorus", 8, .9, "C G D Em", {}),
      Sx("outro", 4, .3, "C G D G", { lead: "sparse", drums: 0 })] };

  /* Finishing pass: every exemplar gets a mix sheet and an orchestra that changes with the form
     (a melody double lifts each chorus, bridges and breaks change colour). [style: double instrument, octave, bridge band] */
  var FIN = {
    pop: ["bells", 12, { lead: "flute" }], rock: ["hammond", 0, { lead: "eguitar" }], rocknroll: ["sax", 0, { lead: "piano" }], bluegrass: ["violin", 0, { lead: "banjo" }], irish: ["harp", 0, { lead: "flute" }], country: ["violin", 0, { lead: "steel" }], blues: ["sax", 0, { lead: "hammond" }],
    jazz: ["flute", 12, { lead: "keys" }], reggae: ["flute", 12, { lead: "keys" }], funk: ["brass", 0, { lead: "synth" }], hiphop: ["pluck", 0, { lead: "keys" }],
    trap: ["synth", 12, { lead: "pluck" }], afrobeat: ["eguitar", 0, { lead: "keys" }], lingala: ["horns", 0, { lead: "eguitar" }], phonk: ["bells", 12, { lead: "vox" }], memphis: ["hum", 0, { lead: "bells" }], afrobeats: ["kalimba", 12, { lead: "flute" }], amapiano: ["bells", 12, { lead: "flute" }], lofi: ["kalimba", 12, { lead: "flute" }],
    house: ["synth", 12, { lead: "bells" }], rnb: ["ooh", 0, { lead: "violin" }], ambient: ["harp", 12, { lead: "flute" }], celtic: ["ooh", 0, { lead: "vox" }], opera: ["choir", 0, { lead: "vox" }], cinematic: ["bells", 12, { lead: "flute" }], acoustic: ["flute", 0, { lead: "kalimba" }] };
  var FMIX = { hiphop: { drums: 1.05, bass: 1.15 }, trap: { drums: 1.0, bass: 1.2 }, amapiano: { hats: 1.6, bass: .85, drums: 1.0 }, afrobeats: { hats: 1.5, bass: .95, bassHp: 1.4 }, afrobeat: { hats: 1.2, bass: .95 }, phonk: { drums: 1.0, bass: .75, lead: 1.15 }, memphis: { drums: .95, bass: .5, lead: 1.15 }, house: { drums: 1.1, bass: 1.1 }, ambient: { pad: 1.05, lead: .9 }, cinematic: { pad: 1.05, lead: 1.0 }, lofi: { drums: .9 }, rnb: { drums: .9, lead: 1.05 } };
  Object.keys(EX).forEach(function (k) {
    var ex = EX[k], f = FIN[k], m = FMIX[k] || {};
    ex.sections.forEach(function (sx, i) {
      if ((sx.kind === "chorus" || sx.kind === "drop") && sx.lead !== "none") sx.double = { inst: f[0], oct: f[1] };
      if (/bridge|break/.test(sx.kind) && sx.lead !== "none") sx.band = f[2];
      if (/^(pop|rnb|acoustic)$/.test(k) && sx.kind === "chorus" && i === ex.sections.map(function (z) { return z.kind; }).lastIndexOf("chorus")) sx.modulate = 2;
      if (sx.kind === "intro") { var nb = {}; if (ex.band.arp !== "none") nb.arp = "none"; if (ex.band.comp !== "none") nb.comp = "none"; if (k !== "ambient" && k !== "cinematic" && k !== "celtic" && k !== "opera") sx.band = nb; }
    });
    ex.mix = { lead: { lvl: m.lead || 1.1, rv: 1.0 }, pad: { lvl: m.pad || .9, rv: 1.2 }, bass: { lvl: m.bass || 1.05 }, drums: { lvl: m.drums || .95 } }; if (m.hats) ex.mix.hats = { lvl: m.hats }; if (m.bassHp) ex.mix.bass.hp = m.bassHp;
  });
  var MOOD_EX = { joy: "pop", hope: "acoustic", love: "rnb", sadness: "cinematic", calm: "lofi", anger: "rock", fear: "cinematic", neutral: "lofi", excited: "afrobeats" };
  function exemplar(style, mood, opt) {
    opt = opt || {}; var k = String(style || "").toLowerCase().replace(/[^a-z]/g, ""); if (k === "rockandroll") k = "rocknroll";
    if (!EX[k]) { k = null; var m = String(mood || "").toLowerCase(); if (opt.alt) { for (var q in EX) if (EX[q].moods.indexOf(m) >= 0 && q !== opt.alt) { k = q; break; } } if (!k) k = MOOD_EX[m] || "pop"; }
    var o = JSON.parse(JSON.stringify(EX[k])); o.style = k;
    if (opt.trim) { o.sections.forEach(function (x) { delete x.mel; delete x.bassline; delete x.groove; delete x.groove2; }); }
    return o;
  }
  function exemplarCheck() { var out = {}; Object.keys(EX).forEach(function (k) { var r = critique(EX[k]); out[k] = r.score; }); return out; }

  var API = {
    version: 1, supported: function () { return !!AC; },
    unlock: unlock, play: play, next: next, pause: pause, resume: resume, toggle: toggle, stop: stop, sleep: sleep,
    setVolume: setVolume, getVolume: function () { return P.vol; }, duck: duck, hold: hold, steer: steer,
    current: function () { var pc = P.piece; if (!pc || !P.lastBrief) return null; var b = {}; for (var k in P.lastBrief) b[k] = P.lastBrief[k]; b.seed = pc.seed; return b; },
    like: like, saved: saved, playSaved: playSaved, tasteSummary: tasteSummary, info: info, level: level,
    on: function (fn) { P.listeners.push(fn); return function () { API.off(fn); }; }, off: function (fn) { P.listeners = P.listeners.filter(function (x) { return x !== fn; }); },
    voices: { set: function (o) { o = o || {}; if (o.amount !== undefined) VOX.amt = clamp(Number(o.amount) || 0, 0, 2); if (o.level !== undefined) VOX.lvl = clamp(Number(o.level) || 1, .3, 3); try { global.localStorage.setItem("echo_vox_v1", JSON.stringify(VOX)); } catch (e) {} return { amount: VOX.amt, level: VOX.lvl }; }, get: function () { return { amount: VOX.amt, level: VOX.lvl }; } },
    ranges: function () { var o = {}; Object.keys(INSTR_RANGE).forEach(function (k) { o[k] = noteName(INSTR_RANGE[k][0]) + "-" + noteName(INSTR_RANGE[k][1]) + (LEAD_CENTER[k] ? " lead~" + noteName(LEAD_CENTER[k]) : "") + (COMP_CENTER[k] ? " chords~" + noteName(COMP_CENTER[k]) : ""); }); return o; },
    critique: critique, feedback: feedback, tuning: tuning, songSeconds: songSeconds, exportSong: exportSong, exportSaved: exportSaved, savedBrief: savedBrief, exemplar: exemplar, exemplarCheck: exemplarCheck, setMelodies: setMelodies, setBass: setBass, setDrums: setDrums, setOrchestra: setOrchestra, likedExamples: likedExamples, tasteProfile: tasteProfile, tonesOf: tonesOf, parseBrief: parseBrief, moods: MOOD_LIST.slice(), styles: STYLE_LIST.map(function (k) { return { id: k, name: STYLES[k].name }; }),
    samples: { setBase: function (u) { SMP.base = u; }, memory: function () { return { mb: +(smpBytes() / 1048576).toFixed(1), budgetMB: +(smpBudget() / 1048576).toFixed(0), banks: Object.keys(SMP.banks).filter(function (k) { return SMP.banks[k].ready; }).length }; }, setBudgetMB: function (n) { SMP.budgetMB = n; }, enable: function (on) { SMP.on = !!on; }, enabled: function () { return SMP.on; }, status: function () { var o = {}; for (var k in SMP.banks) o[k] = SMP.banks[k].ready ? "ready" : SMP.banks[k].failed ? "failed" : "loading"; return o; }, preload: function (names) { var c = ensureCtx(); if (c) (names || Object.keys(SMAP).map(function (k) { return SMAP[k].bank; }).concat(["drums-acoustic", "drums-lm2"])).forEach(function (b) { smpGet(b, c); }); } },
    mix: mix, mixNext: mixNext, mixInfo: mixInfo, buildMixPlan: buildMixPlan, renderMix: renderMix,
    render: render, toWav: toWav, exportWav: exportWav, exportMixWav: exportMixWav,
    _t: { ahead: function () { return P.piece && P.ctx ? P.piece.nextT - P.ctx.currentTime : null; }, hasWorker: function () { return !!P.worker; }, INSTR_META: INSTR_META, FIT: FIT, fits: fits, parsePlan: parsePlan, DRUMBANK: DRUMBANK, SMP: SMP, SMAP: SMAP, ctx: function () { return P.ctx; }, Composer: Composer, Engine: Engine, LOUD: LOUD, STYLES: STYLES, RECIPES: RECIPES, KITS: KITS, STRIPS: STRIPS }
  };
  global.EchoMusic = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
