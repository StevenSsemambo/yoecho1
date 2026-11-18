# YoEcho — Netlify PWA Deployment Guide

## What's Inside This Package

```
yoecho-netlify/
├── public/                  ← Everything Netlify serves to users
│   ├── index.html           ← App entry point (PWA shell)
│   ├── app.jsx              ← Your full YoEcho app (modified)
│   ├── manifest.json        ← PWA manifest (install to home screen)
│   ├── sw.js                ← Service worker (offline support)
│   └── icons/               ← App icons
│       ├── icon-192.png
│       └── icon-512.png
├── netlify/
│   └── functions/
│       ├── chat.js          ← AI proxy: Gemini + Groq fallback (hides your keys)
│       └── db.js            ← Supabase sync proxy
├── netlify.toml             ← Netlify build config
└── README.md                ← This file
```

## AI Setup — Gemini (brain) + Groq (fallback)

`netlify/functions/chat.js` tries **Gemini** first. If Gemini fails, it falls back to **Groq**.
Each provider has an ordered list of models, because model names get retired often:

| Situation | What happens |
|-----------|--------------|
| Model retired / not found (404, 400) | Try the next model in that provider's list |
| Rate limit (429), bad key, timeout, 5xx, blocked/empty reply | Move to the next provider |
| Everything fails | Returns 503 (or 429) and the browser console prints the real reason |

Default models: Gemini `gemini-3.8-flash` → `gemini-3.6-flash` → `gemini-flash-latest` → `gemini-2.5-flash`;
Groq `openai/gpt-oss-120b` → `openai/gpt-oss-20b`.

### Keys
1. Gemini: https://aistudio.google.com/apikey  (no billing needed for the free tier)
2. Groq: https://console.groq.com/keys

### Netlify environment variables
| Name | Required | Notes |
|------|----------|-------|
| `GEMINI_API_KEY` | yes | |
| `GROQ_API_KEY` | yes | |
| `GEMINI_MODEL` | no | Comma-separated list, overrides defaults. Delete old values! |
| `GROQ_MODEL` | no | Comma-separated list, overrides defaults. Delete old values! |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | for cloud sync | used by `netlify/functions/db.js` |

Remove the old `OPENROUTER_API_KEY` — it is no longer used.
Environment variables only take effect after a **new deploy**.

### When a model stops working
Model names change. Check https://ai.google.dev/gemini-api/docs/deprecations and
https://console.groq.com/docs/deprecations, then update `GEMINI_MODEL` / `GROQ_MODEL` in Netlify and redeploy.
Open the browser console: a failure prints lines like `Gemini gemini-3.8-flash HTTP 404: ...`,
and a success prints `reply via gemini (model-name)`. The chat header also shows `AI · GEMINI` or `AI · GROQ`.

### Privacy note
Google's free Gemini tier may use prompts and replies to improve its models. YoEcho handles
personal journals and reflections, so tell users, or use a paid key before a public launch.

## Step-by-Step: Deploy to Netlify

### Step 1 — Upload Your Project
**Option A — Drag & Drop (easiest):**
1. Go to **https://app.netlify.com**
2. Sign up / log in (free)
3. Drag the entire `yoecho-netlify` folder onto the Netlify dashboard
4. Netlify auto-detects `netlify.toml` and deploys

**Option B — GitHub (recommended for updates):**
1. Push this folder to a GitHub repo
2. In Netlify: **"Add new site" → "Import from Git"**
3. Connect your GitHub and select the repo
4. Build settings are auto-read from `netlify.toml`
5. Click **Deploy**

### Step 2 — Add Your API Key (CRITICAL)
This is how Netlify keeps your key secret from users:

1. In Netlify, go to your site dashboard
2. Click **"Site configuration"** (left sidebar)
3. Click **"Environment variables"**
4. Click **"Add a variable"**
5. Fill in:
   - **Key:** `OPENROUTER_API_KEY`
   - **Value:** `sk-or-v1-your-copied-key-here`
6. Click **Save**
7. Go to **Deploys** → click **"Trigger deploy"** → **"Deploy site"**
   (Environment variables only take effect after a new deploy)

### Step 3 — Test Your Deployment
1. Open your Netlify URL (e.g. `https://amazing-name-12345.netlify.app`)
2. The app should load with the amber/gold YoEcho interface
3. Type a message and wait for a response from Gemma 3 27B
4. If it responds ✅ — you're live!

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| App loads but AI doesn't respond | Check `GEMINI_API_KEY` and `GROQ_API_KEY` are set, redeploy, then read the console error |
| "Function not found" error | Make sure `netlify/functions/chat.js` is in the right folder |
| Responses are slow | Normal for free models — Gemma 3 27B may take 5-15 seconds |
| Rate limit error | Free models have limits. Wait a few minutes and try again |
| Storage not saving | Check browser allows localStorage (disable incognito or restrictions) |

---

## Update the Netlify Function URL (optional)

Open `netlify/functions/chat.js` and update line:
```js
"HTTP-Referer": "https://yoecho.netlify.app",
```
Replace with your actual Netlify URL after deployment.

---

## Installing as a PWA (Add to Home Screen)

**On Android (Chrome):**
1. Open the app in Chrome
2. Tap the 3-dot menu → "Add to Home screen"
3. Tap "Add"

**On iPhone (Safari):**
1. Open the app in Safari
2. Tap the Share icon (box with arrow)
3. Scroll down → "Add to Home Screen"
4. Tap "Add"

The app will now appear on your home screen like a native app!

---

## Built by Steven Sema — SayMyTech Developers, Kampala Uganda

---

## 3D Face (Face to face mode)

Open voice mode (the 🎙 button) and YoEcho appears with a 3D face that lip-syncs to its voice,
reacts to its mood, looks attentive while you speak and thinks before it answers. It works in
every mode that has voice (chat, wiser self, journal, debate, tutor).

```
public/
├── echo-face.js        ← face engine (lip-sync, emotions, gestures, blinking, gaze)
├── avatars/f1.glb      ← rigged avatar, dark hair  (gzip-packed: 0.8 MB, 2.3 MB unpacked)
├── avatars/f2.glb      ← rigged avatar, black hair (gzip-packed: 0.7 MB, 2.2 MB unpacked)
└── vendor/
    ├── three.min.js    ← Three.js r128 (MIT, see THREE-LICENSE.txt)
    └── GLTFLoader.js   ← GLB loader matching r128
```

- **Lazy-loaded.** Nothing above downloads until someone opens voice mode, so the first load of
  the app is unchanged. After the first use the service worker caches it for offline use.
- **Fallback.** No WebGL, a failed download, or a tap on `○ ORB` shows the original orb.
- **Look.** `✦ LOOK` in voice mode switches avatar and skin tone. Choices are remembered
  (`localStorage` key `yoecho_face_prefs`).
- **Lip-sync.** Words are turned into mouth shapes (a pronunciation layer in `echo-face.js`) and timed
  from the browser's spoken-word events, so the lips re-lock to every word. Voices that give no word
  events fall back to estimated timing, and the speed is learned per voice. Open `✦ LOOK` to
  slide the lip delay (lips before the voice → slide right) and press `▶ TEST LIPS`; the panel also shows
  whether the current voice is word-locked or estimated.
- **Body language.** What Echo says decides how it moves. A lexicon turns words into cues (greeting,
  emphasis, negation, size, uncertainty, thanks/sorry, counting, calm…) and each cue becomes an arm
  gesture, facial expression, head move or glance scheduled on the word-locked timeline, so the stroke
  lands on the word. Arms are placed by two-bone IK, hands have real finger shapes and palm
  orientation, and a collision guard measured on the avatar's actual mesh keeps hands out of each other,
  the torso and the face. To add a gesture, add an entry to `GEST` in `echo-face.js` (wrist position and palm
  direction); to teach it a word, add the word to a cue with `addCue(...)`.
- **Framing.** `✦ LOOK` → `WITH HANDS` (default, shows face and hands) or `CLOSE-UP`.
- **Speed.** The face files start downloading while the chat is open, the face is built in the
  background, and it stays warm when you close voice mode, so opening it is near-instant.
- **Adding a new avatar.** It needs a standard humanoid skeleton (Hips, Spine, Neck, Head, arms)
  and ARKit + Oculus viseme blendshapes (Ready Player Me avatars work). Pack it with `gzip -9 -n -c my.glb > public/avatars/my.glb`, put it in
  `public/avatars/` and add it to `AVATARS` in `echo-face.js` and `FACE_AVATARS` in `index.html`.
  Draco/meshopt/KTX2-compressed files are not supported by the bundled loader.

## Music (YoEcho plays you music)

`public/echo-music.js` is a self-contained generative music engine (Web Audio, no samples, no network). Echo decides *what* to play by ending a reply with a `MUSIC:{...}` tag (mood, intent `match|lift|calm`, optional style/energy); the engine composes an endless, non-repeating piece for it on the device.

- Lazy-loaded from `index.html` after the app is idle (skipped on data saver / 2G).
- Ask in chat ("play me something calm", "another one", "more energy", "stop the music") or open **Music** from the menu / the ♫ button.
- The music ducks while Echo speaks and goes silent while the mic is listening.
- Chat music cards are not saved with the chat history (the music itself is regenerable from a seed).
- **DJ mixes**: ask for "a 30 minute afrobeats mix" or "a chill DJ set". Tracks are planned so tempos stay close, each handover is beat-matched and phrase-aligned, moves to a related key, swaps the bass (high-pass sweep) and uses risers/impacts. Console: `EchoMusic.mix({styles:["afrobeats","amapiano","house"],minutes:20,shape:"build",trans:"blend"})`, `EchoMusic.mixNext()`, `EchoMusic.renderMix(opts, seconds)` (offline).
- **Solo performances**: ask for "solo piano" or "a sax solo". Piano, keys, guitar, kalimba, marimba and bells play melody, chords and bass themselves; sax, violin, flute and brass play an expressive single line over a faint bed. No drums, wider room, natural rubato. Console: `EchoMusic.play({solo:"violin",mood:"love"})`.
- Console API for tuning: `EchoMusic.play({mood:"joy",style:"afrobeats"})`, `EchoMusic.exportWav(brief, seconds)`.

## Reminders, time awareness and push notifications

YoEcho knows the current date, time and time zone. It sets reminders on its own from conversation: if you mention something coming up ("I have a dentist appointment Thursday"), it asks for any missing detail (usually just the time), saves it, and nudges you at the right moment. Explicit requests ("remind me Friday at 3 to call mum"), moving and cancelling by chat all work too. Reminders show in menu → **Reminders**, where people can also add them by hand and turn on phone notifications and gentle check-ins.

**One-time setup (needed for notifications when the app is closed)**
1. The notification tables already exist in the Supabase project **yoecho-push** (created for this; the same SQL is in `supabase-push.sql` if you ever need to recreate it).
2. In Netlify → Site settings → Environment variables add two variables: `PUSH_SUPABASE_URL` = `https://iriomiqchwcuctbnfhpd.supabase.co` and `PUSH_SUPABASE_KEY` = that project's **anon** key (Supabase → yoecho-push → Project Settings → API → *anon* key). These are kept server-side only. For tighter privacy you can instead use the *service_role* key and remove the "yoecho server access" policies.
3. Redeploy. The function `push-cron` runs every 2 minutes (set in `netlify.toml`) and sends due reminders and check-ins. Scheduled functions run on published deploys; the notification keys (VAPID) are generated automatically on first use.
4. Open YoEcho → menu → Reminders → **Turn on**, then **Send a test**.

Notes: on iPhone, YoEcho must first be added to the Home Screen (iOS 16.4+). Without the setup above, reminders still work as in-app alerts while YoEcho is open. Check-ins are opt-in, daytime only in the person's own time zone, spaced out, and skipped if they were just in the app. Push can arrive a minute or two late; it is not meant for anything time-critical like medication.

## Music: genre bands (v7)

Besides afrobeats, amapiano, lo-fi, house, trap, R&B, ambient, cinematic and acoustic, the engine now plays real **band genres**, each with its own chords, groove, bass line, lead style and instrument "band":

| Genre | What makes it that genre |
|---|---|
| Rock and Roll | shuffle feel, 12-bar blues changes, rhythm guitar/piano "5-6" boogie, boogie-woogie bass, sax/guitar blues licks |
| Rock | straight 8ths, power chords (palm-muted chugs, riffs), driving bass, pentatonic lead guitar, big fills + crashes |
| Blues | slow shuffle, 12-bar (major, minor, quick-change), blues-scale licks with bends, organ |
| Jazz | swing ride + hi-hat chick, walking bass, rootless 7th/9th/13th piano comping, bebop lines on sax/trumpet/vibes, head-solo-trade form |
| Reggae | one-drop, off-beat guitar skank, organ bubble, melodic bass |
| Funk | 16th-note clavinet/guitar chops with ghost notes, syncopated bass, horn stabs, ghost-note snare |
| Pop | four-chord progressions, bands of piano/guitar/synth/strings |
| Hip-hop | boom-bap kit, swung 16ths, minor-7th loops, vinyl |

New instruments: electric guitar (`eguitar`), distorted guitar (`dguitar`), lead guitar (`lguitar`), electric bass (`ebass`), upright bass (`upbass`), Hammond organ (`hammond`), `horns`, `clav`. New drum voices: ride, tambourine, cowbell, pedal hi-hat.

**Drum solos**: `{"solo":"drums","style":"rock"}` plays continuous drums (no breaks), with fills, ghost notes and percussion layers that change every few bars.

Every piece also picks a band (a set of instruments that belong together) and one of several progressions, grooves, bass lines and song forms per seed, so pieces differ much more than before.

## AI composer (v8)

When you ask for music, Echo (the chat model) now writes a **composition plan** as JSON: key, tempo, genre, band, a hook (motif) and a list of sections, each with one chord per bar, energy, lead behaviour and drum level. The on-device engine validates the plan (`parsePlan`: bad chords, instruments or timings are clamped or dropped) and performs it. If the AI is slow (9.5 s), offline, or the plan is invalid, the built-in rule-based composer plays instead, so music always starts. "Play another" asks for a fresh plan. Plans are stored with liked pieces so they replay exactly.

## Recorded instruments (v9)

Piano, acoustic and electric guitar, electric bass, sax, trumpet, trombone, flute and violin/strings now play **real recordings** (`public/samples/`, 3.5 MB total, mono mp3, MIT-licensed — see `samples/CREDITS.txt`). Each instrument's bank loads lazily the first time a piece uses it (and is then cached by the service worker); until it is decoded the synthesized voice plays, so playback never waits. Overdriven/distorted guitars run the clean electric-guitar recording through an amp-style waveshaper. Sustained instruments loop a matched section of the recording for long notes. Drums are recorded too: an acoustic kit (Pearl Master Studio by enoe, CC-BY 3.0) for rock, rock and roll, blues, jazz, reggae and funk, and a LinnDrum LM-2 kit for hip-hop; other styles keep the synthesized electronic kits, and percussion the recorded kits lack (shaker, rim, conga on the acoustic kit) stays synthesized. Keys/organ/hammond, marimba, pads, upright bass and synth basses are still synthesized.\nThe most-used banks (piano, electric guitar, bass, acoustic guitar, acoustic drums, about 2 MB) are pre-fetched quietly 9 seconds after the app opens, unless Data Saver is on or the connection is slow.
Controls: `EchoMusic.samples.enable(false)` falls back to pure synthesis; `.status()` shows bank state; `.preload()` warms everything.

## More recordings (v10)

Added recorded: electric piano ("keys"), Hammond-style drawbar organ, pipe organ, clavinet, marimba, a new **harp**, upright bass and a real string-ensemble section (FluidR3 GM, MIT), plus percussion (tambourine, cowbell, congas, clap, rim, shaker) on the acoustic and hip-hop kits, and recorded **Roland CR-78** (afrobeats/amapiano) and **TR-505** (house, pop) drum machines. House and pop keep their synthesized kick. Violin, sax, brass, flute and guitars are unchanged from v9. Everything is lazy-loaded with synth fallback; total sample folder is about 6 MB. Credits are in `public/samples/CREDITS.txt`.

## Kalimba, bells and choir (v11)

Kalimba, bells (a recorded glockenspiel) and choir now play recordings too (FluidR3 GM, ~0.6 MB). Still synthesized on purpose: pads, sub, 808 and synth basses, risers and effects. Total sample folder is about 7 MB, all lazy-loaded with synth fallback.

## Sample memory budget (v12)

Decoded audio is raw floats, so all 24 banks together would need about 180 MB. Banks now decode at their own low sample rate (32 kHz; about 25% smaller, ~133 MB for everything), and a memory budget keeps the total in check: 16 MB per GB of device memory when the browser reports it (32-128 MB), otherwise 72 MB. When a new bank needs room, banks idle for more than 30 s are dropped, oldest first; if nothing can be dropped, the bank waits (retrying every 15 s) and the synthesized voice keeps playing. `EchoMusic.samples.memory()` shows usage; `EchoMusic.samples.setBudgetMB(n)` overrides the budget.

## Reminders and check-ins: reliability fixes (v13)

- **Reminders can no longer be lost on the way to the server.** They go through an outbox (kept in the phone's storage) that retries until the server confirms, and deletes/moves keep their order.
- **Silent failures now speak up.** If notifications are off or blocked on a phone, the reminder confirmation says it can only fire while the app is open.
- **Self-healing push record.** On every app start (and every 30 min while open) the app re-saves this phone's subscription, recreating it if the browser dropped it or it was made for another server key.
- **Wider reminder phrasing** ("wake me at 6", "ping me at 4 to…", "reminder: …") is caught even when the model forgets its tag.
- **Reminders always show a real notification**, even if the app window is technically visible.
- **The reminder job now runs every minute** (was every 2), so reminders land within about a minute.
- **Check-ins:** older records without a saved choice get the default (every ~2 days); the daytime window is at least 7 hours; someone who opens the app often is no longer skipped forever.
- **Delivery log:** every send attempt is recorded in the `push_log` table (kept 7 days) so "why didn't I get it?" can be answered from the database.

## v14 — Composer agent: written melodies + critic loop
- The chat model still writes the plan (key, chords, form, band, hook). A second background pass now **writes the actual melody** (verse, chorus, bridge/solo) note by note, grounded in each bar's chord tones.
- `EchoMusic.critique(plan)` is a rule-based music critic (range, leaps, chord tones on the beat, phrase endings, repetition, verse/chorus contrast, form, energy). Score under 80 -> the model gets the critic's notes and rewrites once; the better version wins, below 45 the engine's own melody stays.
- The piece starts immediately; the written melody lands from the next section. `EchoMusic.setMelodies`, `EchoMusic.tonesOf` are the hooks. Repeated sections reuse their melody.
- `chat.js` accepts `maxTokens` (cap 3000) so melody replies are not truncated.

## v15 — Written bass lines
- A third background pass (parallel to the melody pass) has the model write the **bass line** for the first verse/chorus as chord-relative tones (`R, 3, 5, b7, 8, a` approach note), so one groove works over the whole progression and follows each chord change.
- The critic marks it separately (`critique(plan).bass`): root on beat 1, density, tone variety, syncopation, note lengths. Any issue triggers one rewrite from the critic's notes; the better version wins. `EchoMusic.setBass` applies it from the next section. `window.__lastBassScore` shows the accepted score.

## v16 — Written drum grooves + liked pieces teach the composer
- A fourth background pass writes a **drum groove** (16-step grid per voice: kick, snare, clap, hat, open, ride, rim, tamb, shaker, cow, tom, congas; `X` accent, `o` ghost) for the first verse and chorus, with an optional second-bar variation. `critique(plan).drums` checks backbeat, kick anchor, pulse, density, kick/snare collisions and genre rules (house four-on-the-floor, funk/afrobeats syncopation). One rewrite from the critic's notes; `EchoMusic.setDrums` applies it. Engine fills at phrase ends still play. `window.__lastDrumScore`.
- **Liked pieces teach the composer.** Saved pieces keep their full written plan (chords, melody, bass line, groove; a piece liked before its parts arrived is re-saved when they land). `EchoMusic.tasteProfile()` summarises styles, tempo range, major/minor lean, harmonic richness, favourite instruments; `EchoMusic.likedExamples(n, part)` returns compact examples. The plan, melody, bass and drum prompts all receive them with an instruction to write something new in the same spirit, never copy.

## v17 — Instrumental agent: per-section orchestration + mix sheet
- A fifth background pass (parallel with melody, bass and drums) plays arranger and mixing engineer. It writes, per section, which instruments play (`band` overrides, `"none"` sits a part out) and an optional melody **double** (another instrument, at -12/0/+12), so the intro is sparse, the chorus is bigger, the bridge sounds different, the outro thins out. Overrides apply at each section start and the base band returns at the next one (a live steer is never undone).
- It also writes a **mix sheet** for the whole piece: level, reverb and echo per part (pad, comp, lead, arp, bass, drums, hats) and stereo position for the melodic parts, eased in at the engine's mixer strips.
- `critique(plan).orch` marks it: chorus fuller than verse, intro lighter than chorus, lead different from the chord instrument, at most two sustained instruments at once, doubles that make sense, lead louder than chords, pads not swamping, no reverb on bass. One rewrite from the critic's notes; `EchoMusic.setOrchestra` applies it; `window.__lastOrchScore`.
- Liked pieces now also teach orchestration and mixing (`likedExamples(n, "orch")`), and the arrangement is saved with the piece.

## v18 — Voices
- New recorded banks: **ooh** (FluidR3 "Voice Oohs") and **synthchoir** (FluidR3 "Synth Choir"), alongside the existing choir "aahs". ~0.5 MB, lazy-loaded, credited in `samples/CREDITS.txt`.
- New in-browser **sung voices** (no recordings, no licence): `vox` (a "la" voice with vowel formants that glides ah -> oh, delayed vibrato, breath, two-voice ensemble; usable as a lead for wordless melodies or as a melody double), `hum` (closed-mouth "mm"), and synthetic fall-backs for `ooh` and `synthchoir` if the samples are not available.
- The plan writer and the arranger agent know the new voices and are told when to use them (choir/ooh under big choruses and ballads, a hummed or "la" double on the hook, vox as a wordless lead in cinematic, gospel, afrobeats, amapiano, R&B). The chat steer list accepts them too ("make the lead a voice").

## v19 — Voices appear on their own
- Voices no longer depend on the model choosing them. The engine decides when a human voice helps: choir/ooh/synth-choir pads under big sections (chorus, drop, climax, bridge, and verses/breaks in R&B, lo-fi and acoustic), plus a hummed double on the hook in pop, R&B, afrobeats, amapiano, lo-fi and acoustic. Likelihood depends on style and mood (cinematic, sad, loving and hopeful pieces most; jazz, funk and rock and roll rarely). Sample banks are warmed from the first bar so the recorded voices are ready.
- The listener can steer them: `layers: {voice: false}` ("remove the voices"), true to bring them back.

## v20 — Voices you can actually hear
- Found by measurement: voices were quiet (3-10% of the mix power), routed through the pad strip (low level, sidechain-ducked by the kick), and on phones (lite quality) the polyphony limiter dropped over half of them. Now: voice notes play on the lead strip (no ducking), stereo-spread, count as one voice each in the limiter and are only dropped at an extreme load, and are louder.
- The first big section of a piece always carries a voice (when the style suits it) so you hear them early; later sections are by chance.
- Tune by ear from the browser console: `EchoMusic.voices.set({amount: 1.5, level: 1.3})` (amount scales how often voices appear, 0 = never; level scales loudness). Saved in the browser. `EchoMusic.voices.get()` shows the current values.

## v21 — Several API keys, and kinder to your quota
- `chat.js` now takes a **pool of keys** per provider. In Netlify environment variables use `GEMINI_API_KEYS` = `key1,key2,key3,key4` (comma or newline separated) and/or `GEMINI_API_KEY_2`..`_12`, the same for Groq (`GROQ_API_KEYS`, `GROQ_API_KEY_2`..). The old single `GEMINI_API_KEY` / `GROQ_API_KEY` still work and are added to the pool.
- Keys are used in rotation. A key that gets a rate limit (429) rests for about a minute (longer if the provider says so) for that model, and the next key is tried straight away. A rejected key (401/403) rests for 10 minutes. Gemini keys are tried across all models before falling to Groq. Error lines in the function log say `key#2` etc., never the key itself.
- Important: free quotas belong to the **Google project / Groq organisation**, not to the key. Four keys created in the same project (or the same Groq org) share one quota. Make each Gemini key in a different project (AI Studio > Create API key > "Create API key in new project"); for Groq use separate organisations/accounts you legitimately own, and check each provider's terms.
- The music agents are optional extras, so they now stand down for 3 minutes after the AI says "rate limited". Choose how many run: `localStorage.setItem('yoecho_composer','2')` = everything (default), `'1'` = melody + bass only, no rewrites, `'0'` = chord plan only.

## v22 — Master examples, locked rhythm section, range-aware arranger, surgical revisions
- **Hand-built genre exemplars** (17: pop, rock, rock'n'roll, blues, jazz, reggae, funk, hip-hop, trap, afrobeats, amapiano, lo-fi, house, R&B, ambient, cinematic, acoustic) live in `echo-music.js`. Each is a complete piece (form, chords, band, hook, written melody, bass line, drum groove, mix) and scores 100 on the critic (`EchoMusic.exemplarCheck()`). They are never played; the planner gets a trimmed copy (`goodExample`) and the melody, bass and drum writers get the matching verse and chorus parts (`exampleOf`) as "this is what good looks like". `EchoMusic.exemplar(style, mood)` picks by style, then by mood.
- **Bass and drums locked together.** The drummer now writes first; the bassist receives the kick pattern per section and plays to it. A new critic rule checks that most kick hits have a bass note under them (house/EDM and ambient are exempt), and the bass reviser sees that note.
- **Range and frequency awareness.** `EchoMusic.ranges()` gives every instrument's range and usual register; the arranger prompt carries it. The critic now flags a melody below or above the lead instrument's range, a lead buried below the chords, and four parts crowding the low-mids. The mix sheet gained `tone` (brightness, -6..6 dB) and `hp` (high-pass multiplier, 0.5..3) per part.
- **Surgical revisions.** "Make the chorus drums busier", "the bass is too loud", "new melody in the verse", "swap the piano for guitar" now change only that part, live (the section playing is refreshed at once). If the drums change, the bass is re-locked to the new kick. Key, tempo, chord, genre, mood and "add a section" requests still rewrite the plan, but parts that did not change (same section kind and chords) are carried over and only missing parts are written.
- Tested with simulated model answers only; real model output and how it sounds are for your ears.

## v23 — Cross-part checks, thumbs that teach the critic, downloads
- **Checks across the parts.** The critic has a new `cross` part: it flags a melody that clashes with the bass (half steps or tritones against the bass note under it), an arrangement that is too busy or too empty overall (melody + bass + drum hits per bar), and a chorus that is no busier than the verse. After the parts land, a reconcile step asks the bassist to fix clashes (one extra call, only when needed).
- **👍 / 👎.** 👍 saves the piece (as before) and records what it was like (busyness, bpm, style); 👎 records it, lowers that style's weight and plays something else. You can also say "I don't like this" or "thumbs down". After two or more votes the critic's idea of "too busy" moves toward your taste (`EchoMusic.tuning()` shows it), and the writers are told what you like and skipped. Everything stays on your device.
- **Download.** Every liked piece has a ⤓ WAV button (it is re-rendered from its saved plan and seed, so it matches what you heard, full length of the written form, up to 7 minutes). The player has ⤓ 1 MIN and ⤓ FULL SONG, the music card has ⤓ SAVE, and you can say "download this song". Long songs are rendered at 32 kHz to keep files smaller; files are WAV (no MP3 encoder is bundled).

## v24 — MP3 downloads
- The MP3 encoder (lamejs 1.2.7 via @breezystack/lamejs, LGPL-3.0, licence in `public/vendor/LAMEJS-LICENSE.txt`) is bundled as `public/vendor/lame.min.js` and loaded only when you download. Downloads are now **MP3 (160 kbps)** by default, about 9x smaller than WAV (a 3-minute song is roughly 3.6 MB); a separate ⤓ WAV button stays in the player. Encoding runs in slices so the page stays responsive. Developers: `EchoMusic.exportSaved(i, 0, {mp3:true, kbps:160})`, `exportSong(brief, {mp3:true})`.

## v25 — Composer log and song development
- **Composer log.** Music screen, bottom: ▸ COMPOSER LOG. For each of the last pieces it shows every agent call (planner, melody, bass, drums, arranger, retries, bass fix): how long it took, which AI answered (provider and model), the critic score before and after a retry, whether the part was used, and **when it landed** (seconds after the piece started), plus the final critic scores per part (plan, melody, bass, drums, arranger, cross) and automatic warnings (an agent failed, timed out or was rate limited, a part was rejected, parts landed late, a part scored under 80). Your 👍/👎 is attached to the piece. Tap FLAT / BUSY / CLASH / LOVELY on a piece you disliked or loved, then COPY LOG and paste it to your developer. Stored on your device (last 8 pieces).
- **Song development (engine).** (1) *Key change*: the last chorus or drop lifts a whole step (explicit `"modulate": 1-4` on a section, or automatic for pop, R&B, acoustic, afrobeats, rock and reggae when there are 2+ big sections and the last is high-energy; `"modulate": 0` turns it off); it stays up through the outro and resets when the piece loops. (2) *Hook returns higher*: the final chorus repeats its written melody an octave up the second time round. (3) *Transitions*: a rising sweep over the last two bars into every chorus or drop, a reverse cymbal in the bar before, and before the final one a half-bar of near silence so it lands harder. (4) New section kind `prechorus` (rising filter and sweep). The planner is told to use them, and the pop exemplar now shows a pre-chorus and a final-chorus key change.

## v26 — Measured mix balance and phrasing
- **Mix check.** Every genre exemplar was rendered offline and its energy measured in six bands (sub, bass, low-mid, mid, upper-mid, air) plus loudness, peak and clipping. No genre clipped; levels sat between -13.6 and -17.9 dB RMS. The outliers were too much sub energy (afrobeats 40%, pop 34%, ambient 34%), mud at 250-500 Hz (amapiano 51%, blues 35%, pop 23%) and dull upper-mids (pop, amapiano, R&B). The master now has a per-style three-band correction (`STYLE_EQ`: low shelf below 70 Hz, a dip at 330 Hz, a presence shelf above 2.5 kHz; 80% of the measured correction). Re-measured: amapiano mud 51% -> 41%, blues 35% -> 25%, pop mud 23% -> 20% and upper-mids up, afrobeats sub 40% -> 34%. Measured on the synthesized sound; with samples the pattern was the same for the two genres I checked.
- **Phrasing.** The lead now swells to the middle of each four-bar phrase and settles at its end, higher notes lean in, beats carry a little weight, quick notes are lighter, and the last note before a rest tails off. Guitar and clav chords are strummed a few milliseconds apart.

## v27 — Phonk (Drift + Memphis)
- New styles: **Drift Phonk** (default for "phonk", 134–148 BPM, half-time, rolling hats) and **Memphis Phonk** (68–80 BPM, murky, tape-like). Say "play phonk" / "play Memphis phonk".
- New pitched `cowbell` lead instrument, distorted + sliding 808 (style-level `grit`), choir/ooh pads, hum/vox as the chopped-voice feel (synthesized — real Memphis vocal samples are not shipped).
- Hand-written phonk exemplars (both score 100 on the critic); prompts, style picker and genre words updated.

## v28 — Amapiano rebuilt, DJ mixes with a real DJ rack
- **Why amapiano sounded wrong:** it shared the "afro" kit, which played samples of a 1978 Roland CR-78 rhythm box, and its log drum was a plain sine bleep. Amapiano now has its own soft synthesized kit (`ama`), a new pitched woody log drum with slides between notes (also tuned an octave higher, 73–138 Hz, so it speaks on phone speakers), a 3-3-2 rim/percussion pattern, off-beat open hats, 16th shaker, swing .2, 110–115 BPM, and a longer layered intro in the exemplar.
- **DJ rack (per track):** resonant low-pass for filter sweeps, a gate for beat rolls / stutters / hard cuts, a tempo-synced echo whose tail outlives the dry signal, high-pass bumps.
- **DJ effects bus:** synthesized air horn, siren, laser, scratch, rewind, brake, snare roll, risers, impacts, crashes.
- **Transitions:** `auto` (default; varies per handover), `blend` (EQ bass swap + riser + echo throw), `echo`, `filter`, `roll`, `brake`, `rewind`, `cut` (scratch), `quick`. Live performance between handovers: horns on drops, echo throws at phrase ends, filter lifts. Ask in chat: "echo out", "beat roll", "scratch", "rewind".
- Honest limits: no real voice drops/shout-outs (no vocal samples), "brake" is a filter+pitch-fall imitation, not true tape-stop on the playing tracks.

## v29 — Afrobeats retuned
- Afrobeats no longer uses the vintage CR-78 drum-machine samples: it has its own punchy synthesized kit (`afrob`), tresillo-style rim/conga pattern, kick on 0-3-6-10 locked with the bass, clap on 2 and 4, 16th shaker.
- Instruments: clean electric guitar and electric-piano comping, guitar/kalimba/keys/sax leads, sub/808 bass with slides (instead of the plain pluck). Exemplar rebuilt around that band.

## v30 — Research pass: Fela / Burna Boy / Kabza-Maphorisa amapiano
- New **Afrobeat (Fela)** style (say "Fela", "highlife", "classic afrobeat"): modal vamps, interlocking two-bar guitar/bass phrases, sax/brass riffs, organ, congas + shekere, long sections (16-bar grooves, solo), 104–118 BPM. Exemplar "Lagos Vamp".
- **Afrobeats (Burna Boy style)**: percussion pushed forward (hats strip up), lean bass (high-pass raised to ~42 Hz), punchy synthesized kit.
- **Amapiano** now follows the researched structure: 8-bar kick-less style intro (shaker, rim, keys, pad), soft four-on-the-floor kick, 16th shaker + off-beat open hats, e-piano 9th chords, log drum answering in two-bar phrases, main log-drum section with the piano dropped, breakdown, DJ-friendly outro; marimba/bells lead.
Sources: producelikeapro (Fela), Sound On Sound (Burna Boy), Roland/beatstorapon + Native Instruments blogs (amapiano).

## v31 — Real recordings + "What's off?" feedback
- New CC0 recordings (VCSL via danigb/samples): world percussion (congas, cowbell, shaker, claps, claves, tambourine) now used by amapiano, Afrobeats and phonk instead of synthesized hand percussion; a real wooden log drum layered under the synthesized log drum; real mbira and balafon (African pitched idiophones) as leads/arps in amapiano, Afrobeats, Afrobeat; real cowbell for the phonk lead. Kick, snare and hats stay synthesized. Credits in `public/samples/CREDITS.txt`.
- Not used on purpose: the Jeff Learman Rhodes (samples marked CC BY-NC) and the TR-808 sample set (no clear license).
- 👎 now opens a "What's off?" sheet: genre sound, drums, bass, melody, instruments, busy/empty, tempo, mix, boring, plus "closer to…". Notes are kept on the device, attached to the composer log, and included in its copied text.

## v32 — More instruments, real electronic drums, real DJ FX
- **Electronic drum recordings** for amapiano, afrobeats, phonk and trap (`drums-ama/afrob/phonk`): real kick, snare, hats and open hats plus conga, claps, rim, shaker, tambourine. Before this only the percussion was real and the kick/snare/hats were synthesized.
- **Real 808** (`bass808`): a recorded 808 pitched to the note, with the glide/slide between notes. The synthesized 808 remains the fallback.
- **New instruments**: `whistle` (amapiano lead), `harmonica` (blues / rock and roll lead), `fmpiano` (DX-style electric piano for amapiano, afrobeats, house, R&B).
- **DJ FX**: real scratch, backspin and tape-rewind recordings are used in mixes (the synthesized ones play if they cannot load).
- **Voice drop-in**: `public/samples/djvox/manifest.json` (empty by default). Put clips you own in that folder and list them by category (`drop`, `tag`, `hype`, `adlib`); "drop" clips play on big transition hits. No spoken shout-outs ship, because no freely redistributable ones were found.
- Service worker cache `v52`, engine `?v=34`.

## v33 — Composer and instrument-choice audit
Audit over 20 genres x 8 moods x 6 seeds (scripts kept outside the repo). Found and fixed:
- **Off-genre instruments.** The automatic voice layer put synth choir / choir / ooh into rock, blues, reggae, funk, lo-fi and Fela afrobeat (up to 170 bars per 1,900). Voices now have to fit the genre, are skipped when two sustained instruments already play, and fall back to a voice the genre uses.
- **Model-written plans could use any instrument in any genre.** There is now a genre-fit table (`FIT`): bells in rock, kalimba in a blues band, etc. are dropped, and the critic tells the model what was dropped and what the genre does use. The in-app prompt lists the instruments per genre.
- **Answer voice and lead of the same family** (4% of bars) is now 0; the arpeggio avoids the family of both the lead and the chords; mood brightness weighs more in the choice.
- **Melody jumps between bars** (17-28% of adjacent bars jumped more than a fifth) are down to 3-11%: each bar's first note now starts near where the last one ended (an octave away in the scale is the same note).
- Still true: palettes themselves are hand-picked per genre; this fixes how they are used, not whether every palette is perfect.

## v34 — Fix for music that stutters ("old tape") after playing a while
- Cause: the scheduler only looked 1.6 s ahead and was woken by a main-thread timer. Browsers throttle those timers when the page is in the background or the screen is off (one tick a second, or one a minute after about five minutes), so the next bar was not scheduled in time and the music paused and restarted off the beat.
- The scheduler clock now runs in a Web Worker (not throttled), with the old timer kept as a backup, and while the page is hidden music is scheduled 24 s ahead so the audio thread keeps playing without the page waking up.
- Not covered: a phone that kills the page outright to save memory or battery; and the page being frozen for seconds by other heavy work (the existing quality governor still handles that).

## v35 — New first-access welcome
- The first message a new person sees now says only the creator's name and that he is the founder of SayMyTech Developers, then explains what YoEcho is for, everything it can do, and how to use it (type or tap the mic, the menu at the top left).
- The "Meet YoEcho" tour slide was shortened the same way.
- The system prompt tells YoEcho not to volunteer the creator's background; it shares his studies, the other apps and his mission only when asked. It also now carries a feature list, so YoEcho can explain what it does and how to use it consistently when asked.

## v36 — Debates are written by the AI every time
- Opening the Debates screen now asks the AI for a brand-new topic (random category and angle, and it is told the last topics so it does not repeat; near-duplicates are rejected and retried). The six written topics are only a fallback if the AI cannot be reached.
- An unfinished debate (started, not conceded) is saved on the device and brought back, with its messages, the next time Debates is opened, even after closing the app. "NEW ›" in the live header abandons it for a new topic. A finished debate is forgotten.
- NEXT › in the lobby and NEXT TOPIC after a debate ends both generate a fresh topic.

## v37 — Music: variation over time, hook teaser, returning motifs
- **Director.** From the second phrase of a section on, each four-bar phrase may get one twist (about 60% of the time, never the same twice in a row): the pad and arp step out for two bars, the bass waits two bars, the beat stops for the last beat, the lead is echoed, or a ghost shaker/hat fills in. Which twists are allowed depends on the genre (no bass drop-outs in rock, blues, funk, reggae or jazz).
- **Hook teaser.** The first intro no longer only fades in: its last two bars play the theme on the lead and let the bass walk in, with a soft reversed cymbal into the verse.
- **Motifs return.** Verses and bridges now quote the opening of the main theme (plain, a step higher on later phrases, or turned upside down in bridges and breaks) instead of wandering on random chord tones.
- Plan-based pieces (model-written or built-in) get the director too; the teaser only applies to automatic pieces. Engine `?v=37`, cache `v57`.

## v38 — "What's off?" sheet no longer hidden by the bottom bar
- The sheet opened inside the chat or music card, so it grew down underneath the bottom navigation bar and could not be scrolled into view. It is now a bottom sheet drawn over the whole screen (above the bar), scrolls by itself on short phones, and closes when you tap outside it.
- The option buttons (Drums, Bass, Melody, …) were drawn white by mistake; they now match the app.

## v39 – Celtic / Enya-style genre
New style `celtic` ("Celtic (Enya-style)"): slow modal harmony (aeolian, ionian, dorian, lydian), rolling harp/piano arpeggio, choir/pad bed, flute/whistle/violin/vox lead with ooh layering, deep sub drone, only soft timpani, big reverb. New `ethereal` arc. Ask: "play Enya-style music", "play celtic". Original music in the style, not copies of any song.

## v40 – Enya style, second pass
From production write-ups (MusicRadar, Sound On Sound/muzines): Enya played parts rather than sequencing, used no compression, huge Lexicon reverb, stacked vocals, pizzicato strings (Roland D-50 "Pizzagogo") and live timpani; about half the album is slow rubato, but Orinoco Flow is mid-tempo G Mixolydian I-VII-IV. The celtic style now spans 62-112 bpm, adds I-VII-IV, I-iii-V and I-IV-V progressions, and a plucked-string (pizzicato) lead/arp band.
