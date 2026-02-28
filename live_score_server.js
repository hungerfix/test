const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ========== CRASH PROTECTION ==========
process.on('uncaughtException', (err) => {
  console.error('[CRASH GUARD] Uncaught Exception (server kept alive):', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[CRASH GUARD] Unhandled Rejection (server kept alive):', err?.message || err);
});

// Support: command-line arg > environment variable > interactive prompt
let matchUrl = process.argv[2] || process.env.MATCH_URL;

// Detect provider from URL
function detectProvider(u) {
  if (!u) return 'none';
  if (u.includes('crex.com')) return 'crex';
  if (u.includes('heroliveline.com')) return 'hero';
  return 'cricbuzz';
}

// Enriched score data structure supporting both innings
let scoreData = {
  provider: 'none',
  matchInfo: {
    description: '',
    format: '',
    status: 'Loading...',
    venue: '',
    state: '',
    toss: '',
    result: ''
  },
  team1: { name: '--', shortName: '--', id: 0, flagUrl: '', jerseyUrl: '', gradient: '' },
  team2: { name: '--', shortName: '--', id: 0, flagUrl: '', jerseyUrl: '', gradient: '' },
  currentInnings: 0,
  innings: [],
  miniscore: null,
  crexRaw: null,
  timestamp: new Date().toISOString(),
  error: null
};

const PORT = process.env.PORT || 5555;

// Custom overlays directory
const CUSTOM_OVERLAYS_DIR = path.join(__dirname, 'custom_overlays');
if (!fs.existsSync(CUSTOM_OVERLAYS_DIR)) {
  fs.mkdirSync(CUSTOM_OVERLAYS_DIR, { recursive: true });
}

// Extract match ID from Cricbuzz URL
function extractMatchId(matchUrl) {
  const match = matchUrl.match(/live-cricket-scores\/(\d+)|cricket-match\/(\d+)|\/(\d+)\//);
  return match ? (match[1] || match[2] || match[3]) : null;
}

// Fetch JSON from URL
function fetchUrl(fetchUrl) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 8000);

    https.get(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 800000) res.destroy();
      });
      res.on('end', () => {
        clearTimeout(timeout);
        resolve(data);
      });
    }).on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}

// Parse the React Server Components (RSC) payload from Cricbuzz page
function parseRSCPayload(html) {
  const result = {
    miniscore: null,
    matchHeader: null,
    commentary: [],
    matchScoreDetails: null
  };

  // Extract RSC push payloads manually (format: self.__next_f.push([1,"CONTENT"]))
  // Content contains escaped quotes \" and ends at unescaped "])
  const pushes = [];
  const marker = 'self.__next_f.push([1,"';
  let searchStart = 0;
  let loopCount = 0;
  const MAX_LOOPS = 5000;

  while (true) {
    if (++loopCount > MAX_LOOPS) { console.warn('[SAFETY] RSC parser hit iteration limit'); break; }
    const idx = html.indexOf(marker, searchStart);
    if (idx < 0) break;
    const contentStart = idx + marker.length;

    // Find closing "]) handling escaped quotes
    let pos = contentStart;
    let found = false;
    while (pos < html.length) {
      const endIdx = html.indexOf('"])', pos);
      if (endIdx < 0) break;
      // Count preceding backslashes
      let bs = 0;
      let check = endIdx - 1;
      while (check >= contentStart && html[check] === '\\') { bs++; check--; }
      if (bs % 2 === 0) {
        pushes.push(html.substring(contentStart, endIdx));
        found = true;
        searchStart = endIdx + 3;
        break;
      }
      pos = endIdx + 1;
    }
    if (!found) searchStart = idx + 1;
  }

  for (const raw of pushes) {
    if (raw.length < 500) continue;

    // Unescape: \" → " and \\ → \ and \n → newline
    const cleaned = raw.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');

    // Look for miniscore data
    if (cleaned.includes('"miniscore"') && !result.miniscore) {
      try {
        const miniIdx = cleaned.indexOf('"miniscore":');
        const objStart = cleaned.indexOf('{', miniIdx);
        let depth = 0, objEnd = objStart;
        for (let i = objStart; i < cleaned.length; i++) {
          if (cleaned[i] === '{') depth++;
          if (cleaned[i] === '}') depth--;
          if (depth === 0) { objEnd = i + 1; break; }
        }
        const miniJson = cleaned.substring(objStart, objEnd);
        const fixedJson = miniJson.replace(/"\$undefined"/g, 'null').replace(/\$undefined/g, 'null');
        result.miniscore = JSON.parse(fixedJson);
      } catch (e) {
        console.log('  Miniscore parse error:', e.message);
      }
    }

    // Look for matchHeader data
    if (cleaned.includes('"matchHeader"') && !result.matchHeader) {
      try {
        const headerIdx = cleaned.indexOf('"matchHeader":');
        const objStart = cleaned.indexOf('{', headerIdx);
        let depth = 0, objEnd = objStart;
        for (let i = objStart; i < cleaned.length; i++) {
          if (cleaned[i] === '{') depth++;
          if (cleaned[i] === '}') depth--;
          if (depth === 0) { objEnd = i + 1; break; }
        }
        const headerJson = cleaned.substring(objStart, objEnd);
        const fixedJson = headerJson.replace(/"\$undefined"/g, 'null').replace(/\$undefined/g, 'null');
        result.matchHeader = JSON.parse(fixedJson);
      } catch (e) {
        console.log('  MatchHeader parse error:', e.message);
      }
    }

    // Extract commentary entries
    if (cleaned.includes('"commType"') && cleaned.includes('"matchCommentary"')) {
      try {
        // Find the matchCommentary object
        const commIdx = cleaned.indexOf('"matchCommentary":');
        if (commIdx >= 0) {
          const objStart = cleaned.indexOf('{', commIdx);
          let depth = 0, objEnd = objStart;
          for (let i = objStart; i < cleaned.length; i++) {
            if (cleaned[i] === '{') depth++;
            if (cleaned[i] === '}') depth--;
            if (depth === 0) { objEnd = i + 1; break; }
          }
          const commJson = cleaned.substring(objStart, objEnd);
          const fixedJson = commJson.replace(/"\$undefined"/g, 'null').replace(/\$undefined/g, 'null');
          const commObj = JSON.parse(fixedJson);

          // Each key is a timestamp, value is the commentary entry
          for (const [ts, entry] of Object.entries(commObj)) {
            if (entry && entry.commType) {
              result.commentary.push({
                type: entry.commType,
                text: entry.commText ? entry.commText.replace(/<[^>]+>/g, '').substring(0, 300) : '',
                inningsId: entry.inningsId,
                event: entry.event,
                teamName: entry.teamName,
                timestamp: entry.timestamp || parseInt(ts),
                batsmanName: entry.batsmanDetails?.playerName || '',
                bowlerName: entry.bowlerDetails?.playerName || '',
                overSeparator: entry.overSeparator || null
              });
            }
          }
        }
      } catch (e) {
        console.log('  Commentary parse error:', e.message);
      }
    }
  }

  return result;
}

// Also try to extract scorecard data from the scorecard page
async function fetchScorecardPage(matchId) {
  try {
    // Try to get the scorecard page URL pattern
    const scUrl = matchUrl.replace('/live-cricket-scores/', '/live-cricket-scorecard/');
    const html = await fetchUrl(scUrl);

    const scorecard = { innings: [] };

    // Extract scorecard from RSC payload
    const pushRegex = /self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs;
    let match;

    while ((match = pushRegex.exec(html)) !== null) {
      const raw = match[1];
      if (raw.length < 1000) continue;

      // Look for scoreCard data
      if (raw.includes('"scoreCard"') || raw.includes('"batTeamDetails"')) {
        try {
          const cleaned = raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

          // Extract innings scorecard data - look for batTeamDetails
          const batTeamRegex = /"batTeamDetails":\{"batTeamId":(\d+),"batTeamName":"([^"]+)","batTeamShortName":"([^"]+)"/g;
          let btMatch;
          while ((btMatch = batTeamRegex.exec(cleaned)) !== null) {
            // Found an innings batting details block
            const inningsBlock = cleaned.substring(btMatch.index - 200, Math.min(cleaned.length, btMatch.index + 10000));

            // Extract innings ID
            const innIdMatch = inningsBlock.match(/"scoreCardId":(\d+)|"inningsId":(\d+)/);
            const inningsId = innIdMatch ? parseInt(innIdMatch[1] || innIdMatch[2]) : scorecard.innings.length + 1;

            // Extract individual batsmen
            const batsmen = [];
            const batsmanRegex = /"batName":"([^"]+)"[^}]*?"runs":(\d+)[^}]*?"balls":(\d+)[^}]*?"fours":(\d+)[^}]*?"sixes":(\d+)[^}]*?"strikeRate":"?([0-9.]+)"?[^}]*?"outDesc":"([^"]*)"/g;
            let batMatch;
            const searchBlock = cleaned.substring(btMatch.index, Math.min(cleaned.length, btMatch.index + 15000));
            while ((batMatch = batsmanRegex.exec(searchBlock)) !== null) {
              batsmen.push({
                name: batMatch[1],
                runs: parseInt(batMatch[2]),
                balls: parseInt(batMatch[3]),
                fours: parseInt(batMatch[4]),
                sixes: parseInt(batMatch[5]),
                strikeRate: parseFloat(batMatch[6]),
                dismissal: batMatch[7]
              });
            }

            // Extract bowlers
            const bowlers = [];
            const bowlerRegex = /"bowlName":"([^"]+)"[^}]*?"overs":"?([0-9.]+)"?[^}]*?"maidens":(\d+)[^}]*?"runs":(\d+)[^}]*?"wickets":(\d+)[^}]*?"economy":"?([0-9.]+)"?/g;
            let bowlMatch;
            while ((bowlMatch = bowlerRegex.exec(searchBlock)) !== null) {
              bowlers.push({
                name: bowlMatch[1],
                overs: bowlMatch[2],
                maidens: parseInt(bowlMatch[3]),
                runs: parseInt(bowlMatch[4]),
                wickets: parseInt(bowlMatch[5]),
                economy: parseFloat(bowlMatch[6])
              });
            }

            // Extract extras
            const extrasMatch = searchBlock.match(/"extrasData":\{[^}]*"total":(\d+)[^}]*"bpieces":(\d+)[^}]*"legByes":(\d+)[^}]*"wpieces":(\d+)[^}]*"noBalls":(\d+)/);

            // Extract fall of wickets
            const fow = [];
            const fowRegex = /"fowId":(\d+)[^}]*?"batName":"([^"]+)"[^}]*?"wktNbr":(\d+)[^}]*?"wktOver":"?([0-9.]+)"?[^}]*?"wktRuns":(\d+)/g;
            let fowMatch;
            while ((fowMatch = fowRegex.exec(searchBlock)) !== null) {
              fow.push({
                wicket: parseInt(fowMatch[3]),
                batsman: fowMatch[2],
                score: parseInt(fowMatch[5]),
                overs: fowMatch[4]
              });
            }

            if (batsmen.length > 0 || bowlers.length > 0) {
              scorecard.innings.push({
                inningsId: inningsId,
                battingTeam: btMatch[2],
                battingTeamShort: btMatch[3],
                batsmen: batsmen,
                bowlers: bowlers,
                extras: extrasMatch ? {
                  total: parseInt(extrasMatch[1]),
                  byes: parseInt(extrasMatch[2]),
                  legByes: parseInt(extrasMatch[3]),
                  wides: parseInt(extrasMatch[4]),
                  noBalls: parseInt(extrasMatch[5])
                } : null,
                fallOfWickets: fow
              });
            }
          }
        } catch (e) {
          console.log('  Scorecard parse error:', e.message);
        }
      }
    }

    return scorecard;
  } catch (e) {
    console.log('  Could not fetch scorecard page:', e.message);
    return null;
  }
}

// ========== CREX.COM PROVIDER ==========

// Parse the Angular SSR transfer-state JSON embedded in CREX pages
function parseCrexTransferState(html) {
  const startTag = '<script id="app-root-state"';
  const startIdx = html.indexOf(startTag);
  if (startIdx < 0) return null;

  const tagEnd = html.indexOf('>', startIdx);
  const scriptEnd = html.indexOf('</script>', tagEnd);
  if (tagEnd < 0 || scriptEnd < 0) return null;

  const raw = html.substring(tagEnd + 1, scriptEnd);
  // CREX encodes quotes as &q; apostrophes as &s; ampersands as &a;
  const decoded = raw
    .replace(/&q;/g, '"')
    .replace(/&s;/g, "'")
    .replace(/&a;/g, '&')
    .replace(/&l;/g, '<')
    .replace(/&g;/g, '>');

  try {
    return JSON.parse(decoded);
  } catch (e) {
    console.log('  CREX transfer-state JSON parse error:', e.message);
    return null;
  }
}

// Build player name lookup from mapping data
function buildCrexPlayerMap(mappingData) {
  const map = {};
  if (mappingData && mappingData.p) {
    mappingData.p.forEach(p => { map[p.f_key] = p.n; });
  }
  return map;
}

// Main CREX fetch and parse function
async function fetchCrexScore() {
  try {
    console.log(`\n[CREX] Fetching at ${new Date().toLocaleTimeString()}...`);

    const html = await fetchUrl(matchUrl);

    if (html.length < 1000) {
      console.log('  HTML too small, using cached data');
      return;
    }

    const state = parseCrexTransferState(html);
    if (!state) {
      console.log('  No CREX transfer-state found');
      scoreData.error = 'Could not parse CREX page data';
      return;
    }

    // Main live data blob (key varies but always contains api-v1.com)
    const liveKey = Object.keys(state).find(k => k.includes('api-v1.com'));
    const live = liveKey ? state[liveKey] : null;

    // Match metadata
    const metaKey = Object.keys(state).find(k => k.includes('getMatchMetaData'));
    const meta = metaKey ? state[metaKey] : null;
    const metaObj = Array.isArray(meta) && meta.length > 0 ? meta[0] : (meta || {});

    // Player/team mapping
    const mapKey = Object.keys(state).find(k => k.includes('liveparsing'));
    const mapping = mapKey ? state[mapKey] : null;
    const playerMap = buildCrexPlayerMap(mapping);

    // Team mapping from oddview or liveparsing
    const oddKey = Object.keys(state).find(k => k.includes('oddview'));
    const oddData = oddKey ? state[oddKey] : null;
    const teamList = (mapping && mapping.t) || (oddData && oddData.t) || [];
    const teamMap = {};
    teamList.forEach(t => { teamMap[t.f_key] = t; });

    // Series info
    const seriesList = (mapping && mapping.s) || [];
    const series = seriesList.length > 0 ? seriesList[0] : {};

    // Ball-by-ball commentary
    const commKey = Object.keys(state).find(k => k.includes('getBallFeeds'));
    const ballFeeds = commKey ? state[commKey] : [];

    if (!live) {
      console.log('  No live data found in CREX state');
      scoreData.error = 'No live data in CREX page';
      return;
    }

    // ---- Build scoreData from CREX live blob ----
    scoreData.provider = 'crex';

    // Match info
    scoreData.matchInfo = {
      description: `${live.team1_f_n || metaObj.team2 || '--'} vs ${live.team2_f_n || metaObj.team1 || '--'}, ${series.sn || series.n || ''}`,
      format: live.mt || live.fo || '',
      status: live.comment1 || '',
      venue: metaObj.v || '',
      state: live.status === 1 ? 'In Progress' : (live.status === 2 ? 'Complete' : 'Upcoming'),
      toss: live.comment1 || '',
      result: live.status === 2 ? (live.comment1 || '') : ''
    };

    // Team info with flags, jerseys, gradients
    const t1key = live.team1_fkey || metaObj.team2_fkey || '';
    const t2key = live.team2_fkey || metaObj.team1_fkey || '';
    scoreData.team1 = {
      name: live.team1_f_n || metaObj.team2 || '--',
      shortName: live.team1short || live.team1 || '--',
      id: t1key,
      flagUrl: live.team1flag || (t1key ? `https://cricketvectors.akamaized.net/Teams/${t1key}.png` : ''),
      jerseyUrl: live.t1Jerimage || '',
      gradient: live.team1Gradient || '',
      colors: teamMap[t1key] || {}
    };
    scoreData.team2 = {
      name: live.team2_f_n || metaObj.team1 || '--',
      shortName: live.team2short || live.team2 || '--',
      id: t2key,
      flagUrl: live.team2flag || (t2key ? `https://cricketvectors.akamaized.net/Teams/${t2key}.png` : ''),
      jerseyUrl: live.t2Jerimage || '',
      gradient: live.team2Gradient || '',
      colors: teamMap[t2key] || {}
    };

    // Innings data
    const innings = [];
    if (live.score1) {
      const parts = live.score1.split('-');
      innings.push({
        id: 1,
        battingTeamId: t1key,
        battingTeam: live.team1_f_n || live.team1 || '--',
        battingTeamShort: live.team1short || live.team1 || '--',
        score: parseInt(parts[0]) || 0,
        wickets: parseInt(parts[1]) || 0,
        overs: parseFloat(live.over1) || 0,
        isDeclared: false,
        runRate: live.crr || '0.00'
      });
    }
    if (live.score2) {
      const parts = live.score2.split('-');
      innings.push({
        id: 2,
        battingTeamId: t2key,
        battingTeam: live.team2_f_n || live.team2 || '--',
        battingTeamShort: live.team2short || live.team2 || '--',
        score: parseInt(parts[0]) || 0,
        wickets: parseInt(parts[1]) || 0,
        overs: parseFloat(live.over2) || 0,
        isDeclared: false,
        runRate: '0.00'
      });
    }
    scoreData.innings = innings;
    scoreData.currentInnings = live.inning || innings.length;

    // Batsman striker / non-striker
    const striker = live.os1 === 1 ? 1 : 2;
    const nonStriker = striker === 1 ? 2 : 1;

    scoreData.miniscore = {
      inningsId: live.inning || 1,
      battingTeam: {
        id: t1key,
        score: innings.length > 0 ? innings[innings.length - 1].score : 0,
        wickets: innings.length > 0 ? innings[innings.length - 1].wickets : 0
      },
      batsmanStriker: {
        name: live['pname' + striker] || '--',
        fullName: live['player_full_name' + striker] || '',
        fkey: live['p' + striker + 'f'] || '',
        imageUrl: live['b' + striker + 'image'] || '',
        runs: parseInt(live['run' + striker]) || 0,
        balls: parseInt((live['ball' + striker] || '0').replace(/[()]/g, '')) || 0,
        fours: parseInt(live['four' + striker]) || 0,
        sixes: parseInt(live['six' + striker]) || 0,
        strikeRate: parseFloat(live['sr' + striker]) || 0,
        isImpact: live['isImpact' + striker] || false
      },
      batsmanNonStriker: {
        name: live['pname' + nonStriker] || '--',
        fullName: live['player_full_name' + nonStriker] || '',
        fkey: live['p' + nonStriker + 'f'] || '',
        imageUrl: live['b' + nonStriker + 'image'] || '',
        runs: parseInt(live['run' + nonStriker]) || 0,
        balls: parseInt((live['ball' + nonStriker] || '0').replace(/[()]/g, '')) || 0,
        fours: parseInt(live['four' + nonStriker]) || 0,
        sixes: parseInt(live['six' + nonStriker]) || 0,
        strikeRate: parseFloat(live['sr' + nonStriker]) || 0,
        isImpact: live['isImpact' + nonStriker] || false
      },
      bowlerStriker: {
        name: live.bname || '--',
        fullName: live.bowler_full_name || '',
        fkey: live.b || '',
        imageUrl: live.b3image || '',
        overs: live.bover || '0',
        maidens: 0,
        runs: parseInt((live.bwr || '0-0').split('-')[1]) || 0,
        wickets: parseInt((live.bwr || '0-0').split('-')[0]) || 0,
        economy: parseFloat(live.beco) || 0,
        figures: live.bwr || '0-0'
      },
      bowlerNonStriker: live.lbname2 ? {
        name: live.lbname2 || '--',
        overs: (live.lbover2 || '0').replace(/[()]/g, ''),
        runs: parseInt((live.lbwicket2 || '0-0').split('-')[1]) || 0,
        wickets: parseInt((live.lbwicket2 || '0-0').split('-')[0]) || 0,
        figures: live.lbwicket2 || '0-0'
      } : null,
      overs: innings.length > 0 ? innings[innings.length - 1].overs : 0,
      target: 0,
      partnership: {
        runs: live.partnerruns || 0,
        balls: live.partnerballs || 0
      },
      currentRunRate: parseFloat(live.crr) || 0,
      requiredRunRate: live.rrr === '--' ? 0 : (parseFloat(live.rrr) || 0),
      lastWicket: live.lwname1 ? {
        name: live.lwname1,
        fkey: live.lwfkey || '',
        runs: live.lwrun1 || '0',
        balls: live.lwball1 || '(0)',
        slug: live.lwSlug || ''
      } : null,
      recentOvers: '',
      lastBowler: live.lbname ? {
        name: live.lbname,
        figures: live.lbwicket || '0-0',
        overs: live.lbover || '(0)'
      } : null,
      event: '',
      remRunsToWin: 0,
      oversRemaining: null,
      status: live.comment1 || '',
      // CREX-specific enriched data
      projectedScores: live.pr || null,
      crrHistory: live.crrObj || [],
      projectedOvers: live.projectedOvers || [],
      projectedScoreObj: live.projectedScoreObj || {},
      sessionData: {
        session: live.session || 0,
        session2: live.session2 || 0,
        lambi: live.lambi || 0,
        lambi2: live.lambi2 || 0,
        sessionOvers: live.session_overs || 0,
        lambiOvers: live.lambi_overs || 0,
        hideSessionTable: live.hideSessionTable || false
      },
      rate: live.rate || '',
      rate2: live.rate2 || ''
    };

    // Build recent overs string from lastovers array
    if (live.lastovers && live.lastovers.length > 0) {
      scoreData.miniscore.recentOvers = live.lastovers.map(ov =>
        `${ov.over}: ${ov.overinfo.join(' ')} = ${ov.total}`
      ).join(' | ');

      scoreData.miniscore.overByOver = live.lastovers;
    }

    // Ball-by-ball over breakdown from rb array
    if (live.rb && live.rb.length > 0) {
      scoreData.miniscore.overBreakdown = live.rb.map(ov => ({
        over: ov.o,
        battingTeam: ov.bt,
        innings: ov.i,
        runs: ov.r,
        totalScore: ov.ts,
        balls: (ov.b || []).map(ball => ({
          bowlerFkey: ball.bf,
          delivery: ball.d,
          type: ball.t,
          result: ball.u
        }))
      }));
    }

    // Ball-by-ball commentary from getBallFeeds
    if (ballFeeds && ballFeeds.length > 0) {
      scoreData.recentCommentary = ballFeeds
        .filter(b => b.type === 'b' || b.type === 'o')
        .slice(0, 30)
        .map(b => {
          if (b.type === 'o') {
            // Over separator
            return {
              type: 'over',
              text: `End of Over ${b.o}: ${b.team} ${b.s} (${b.rb})`,
              event: 'over_end',
              batsman: b.p1 || '',
              bowler: b.bowler || '',
              overNumber: b.o,
              batsmanScores: { p1: b.s1, p2: b.s2 },
              bowlerFigures: b.bd
            };
          }
          return {
            type: b.type,
            text: b.c1 || '',
            detail: b.c2 || '',
            event: b.b === 'w' ? 'WICKET' : (parseInt(b.b) >= 4 ? 'BOUNDARY' : ''),
            batsman: playerMap[b.pf] || b.pf || '',
            bowler: playerMap[b.bf] || b.bf || '',
            runs: b.b,
            over: b.o,
            score: b.s,
            delivery: b.delivery,
            shotType: b.shot_type || 'NA',
            wagonWheel: b.wagon_w || 'NA'
          };
        });
    }

    // Store raw CREX data for advanced overlays
    scoreData.crexRaw = {
      live: live,
      meta: metaObj,
      playerMap: playerMap,
      teamMap: teamMap,
      series: series
    };

    scoreData.timestamp = new Date().toISOString();
    scoreData.error = null;

    // Log summary
    console.log(`  [CREX] Match: ${scoreData.matchInfo.description}`);
    if (scoreData.innings.length > 0) {
      scoreData.innings.forEach(inn => {
        console.log(`  Innings ${inn.id}: ${inn.battingTeamShort} ${inn.score}/${inn.wickets} (${inn.overs} ov)`);
      });
    }
    if (scoreData.miniscore) {
      const ms = scoreData.miniscore;
      if (ms.batsmanStriker) console.log(`  Bat*: ${ms.batsmanStriker.name} ${ms.batsmanStriker.runs}(${ms.batsmanStriker.balls})`);
      if (ms.batsmanNonStriker) console.log(`  Bat : ${ms.batsmanNonStriker.name} ${ms.batsmanNonStriker.runs}(${ms.batsmanNonStriker.balls})`);
      if (ms.bowlerStriker) console.log(`  Bowl: ${ms.bowlerStriker.name} ${ms.bowlerStriker.figures} (${ms.bowlerStriker.overs} ov)`);
      console.log(`  CRR: ${ms.currentRunRate} | RRR: ${ms.requiredRunRate || '--'}`);
      if (ms.recentOvers) console.log(`  Recent: ${ms.recentOvers}`);
    }
    console.log(`  Status: ${scoreData.matchInfo.status || 'Live'}`);

  } catch (e) {
    scoreData.error = 'CREX fetch error: ' + e.message;
    console.error('[CREX] Fetch error:', e.message);
  }
}

// ========== HERO LIVE LINE PROVIDER ==========

async function fetchHeroLiveLine() {
  try {
    console.log(`\n[HERO] Fetching at ${new Date().toLocaleTimeString()}...`);

    const matchIdMatch = matchUrl.match(/\/(\d+)$/);
    if (!matchIdMatch) {
      scoreData.error = 'Could not extract match ID from Hero Live Line URL';
      return;
    }
    const matchId = matchIdMatch[1];

    const p = new Promise((resolve, reject) => {
      const data = JSON.stringify({ match_id: matchId });
      const req = https.request({
        hostname: 'laravel.heroliveline.com',
        port: 443,
        path: '/api/web/match/matchLive',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          'User-Agent': 'Mozilla/5.0'
        },
        timeout: 5000
      }, res => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => resolve(raw));
      }).on('error', reject);
      req.write(data);
      req.end();
    });

    const rawStr = await p;
    const json = JSON.parse(rawStr);

    if (json.status !== "success" || !json.match_live || !json.match_live.match_live || !json.match_live.match_live.data) {
      scoreData.error = 'Invalid HeroLiveLine data received';
      return;
    }

    const hl = json.match_live.match_live.data;

    scoreData.provider = 'hero';
    scoreData.matchInfo = {
      description: hl.team_a + ' vs ' + hl.team_b,
      format: hl.match_type || 'Unknown Match Type',
      status: hl.result || hl.toss || 'In progress',
      venue: '',
      state: hl.result ? 'Complete' : 'In Progress',
      toss: hl.toss || '',
      result: hl.result || ''
    };

    scoreData.team1 = {
      name: hl.team_a,
      shortName: hl.team_a_short,
      id: hl.team_a_id,
      flagUrl: hl.team_a_img,
      jerseyUrl: '',
      gradient: '#3D884B'
    };

    scoreData.team2 = {
      name: hl.team_b,
      shortName: hl.team_b_short,
      id: hl.team_b_id,
      flagUrl: hl.team_b_img,
      jerseyUrl: '',
      gradient: '#c91414'
    };

    const isTeam1Batting = (hl.batting_team == hl.team_a_id);
    const battingTeamObj = isTeam1Batting ? hl.team_a_score : hl.team_b_score;
    let btsKey = '1';
    if (!isTeam1Batting) btsKey = '2';

    const scoresObj = battingTeamObj ? battingTeamObj[btsKey] : { score: 0, wicket: 0, over: "0.0" };

    scoreData.innings = [{
      id: parseInt(hl.current_inning) || 1,
      battingTeamId: isTeam1Batting ? hl.team_a_id : hl.team_b_id,
      battingTeam: isTeam1Batting ? hl.team_a : hl.team_b,
      battingTeamShort: isTeam1Batting ? hl.team_a_short : hl.team_b_short,
      score: scoresObj ? scoresObj.score : 0,
      wickets: scoresObj ? scoresObj.wicket : 0,
      overs: scoresObj ? scoresObj.over : "0.0",
      isDeclared: false,
      runRate: hl.curr_rate || '0.00'
    }];
    scoreData.currentInnings = parseInt(hl.current_inning) || 1;

    // Recent overs formatting
    let recentStr = '';
    const overByOverList = [];
    if (hl.last4overs) {
      recentStr = hl.last4overs.map(o => `Over ${o.over}: ${(o.balls || []).join(' ')} = ${o.runs}`).join(' | ');
      hl.last4overs.forEach(o => {
        overByOverList.push({
          over: 'Over ' + o.over,
          total: o.runs,
          overinfo: o.balls || []
        });
      });
    }

    const strikerBatsman = hl.batsman && hl.batsman.length > 0 ? hl.batsman[0] : null;
    const nonStrikerBatsman = hl.batsman && hl.batsman.length > 1 ? hl.batsman[1] : null;

    scoreData.miniscore = {
      inningsId: parseInt(hl.current_inning) || 1,
      batsmanStriker: strikerBatsman ? {
        name: strikerBatsman.name,
        imageUrl: strikerBatsman.img,
        runs: strikerBatsman.run,
        balls: strikerBatsman.ball,
        fours: strikerBatsman.fours,
        sixes: strikerBatsman.sixes,
        strikeRate: strikerBatsman.strike_rate
      } : null,
      batsmanNonStriker: nonStrikerBatsman ? {
        name: nonStrikerBatsman.name,
        imageUrl: nonStrikerBatsman.img,
        runs: nonStrikerBatsman.run,
        balls: nonStrikerBatsman.ball,
        fours: nonStrikerBatsman.fours,
        sixes: nonStrikerBatsman.sixes,
        strikeRate: nonStrikerBatsman.strike_rate
      } : null,
      bowlerStriker: hl.bolwer ? {
        name: hl.bolwer.name,
        imageUrl: hl.bolwer.img,
        overs: hl.bolwer.over,
        maidens: hl.bolwer.maiden,
        runs: hl.bolwer.run,
        wickets: hl.bolwer.wicket,
        economy: hl.bolwer.economy || 0,
        figures: `${hl.bolwer.wicket}-${hl.bolwer.run}`
      } : null,
      overs: scoresObj ? scoresObj.over : "0.0",
      target: hl.target || 0,
      partnership: hl.partnership ? {
        runs: hl.partnership.run,
        balls: hl.partnership.ball
      } : null,
      currentRunRate: hl.curr_rate || 0,
      requiredRunRate: hl.rr_rate || 0,
      lastWicket: hl.lastwicket ? { name: hl.lastwicket.player, runs: hl.lastwicket.run, balls: '(0)' } : null,
      recentOvers: recentStr,
      overByOver: overByOverList,
      remRunsToWin: hl.run_need || 0,
      status: hl.status || ''
    };

    scoreData.timestamp = new Date().toISOString();
    scoreData.error = null;
    console.log(`  [HERO] Success: ${scoreData.matchInfo.description} | Score: ${hl.team_a_scores || hl.team_b_scores}`);

  } catch (e) {
    scoreData.error = 'HERO fetch error: ' + e.message;
    console.error('[HERO] Fetch error:', e.message);
  }
}

// ========== CRICBUZZ.COM PROVIDER ==========
async function fetchCricbuzzScore() {
  try {
    console.log(`\nFetching at ${new Date().toLocaleTimeString()}...`);

    const html = await fetchUrl(matchUrl);

    if (html.length < 1000) {
      console.log('  HTML too small, using cached data');
      return;
    }

    // Parse the RSC payload
    const rscData = parseRSCPayload(html);

    const mini = rscData.miniscore;
    const header = rscData.matchHeader;

    if (!mini && !header) {
      // Fallback: try og:title for basic score
      const ogMatch = html.match(/og:title[^>]*content="([^"]+)"/);
      if (ogMatch) {
        const ogTitle = ogMatch[1];
        console.log(`  Fallback og:title: ${ogTitle.substring(0, 80)}`);

        // Parse basic score from og:title
        const scoreMatch = ogTitle.match(/([A-Z]{2,4})\s+(\d+)(?:\/(\d+))?\s*(?:\(([0-9.]+)\))?.*?vs\s*([A-Z]{2,4})\s*(?:(\d+)(?:\/(\d+))?)?/);
        if (scoreMatch) {
          scoreData.matchInfo.status = ogTitle;
          scoreData.error = 'Limited data - using fallback parser';
        }
      }
      return;
    }

    // Build enriched score data from RSC payload

    // Match info from header
    if (header) {
      scoreData.matchInfo = {
        description: header.matchDescription || '',
        format: header.matchFormat || '',
        status: header.status || '',
        venue: '',
        state: header.state || '',
        toss: header.tossResults ? `${header.tossResults.tossWinnerName} won the toss and chose to ${header.tossResults.decision}` : '',
        result: header.result ? header.status : ''
      };

      // Extract team info
      if (header.team1) {
        scoreData.team1 = {
          name: header.team1.name || header.team1.teamName || '--',
          shortName: header.team1.shortName || header.team1.teamSName || '--',
          id: header.team1.id || header.team1.teamId || 0
        };
      }
      if (header.team2) {
        scoreData.team2 = {
          name: header.team2.name || header.team2.teamName || '--',
          shortName: header.team2.shortName || header.team2.teamSName || '--',
          id: header.team2.id || header.team2.teamId || 0
        };
      }
    }

    // Build innings data from matchScoreDetails
    const matchScore = mini?.matchScoreDetails;
    if (matchScore && matchScore.inningsScoreList) {
      scoreData.innings = matchScore.inningsScoreList.map(inn => ({
        id: inn.inningsId,
        battingTeamId: inn.batTeamId,
        battingTeam: inn.batTeamName,
        score: inn.score,
        wickets: inn.wickets,
        overs: inn.overs,
        balls: inn.ballNbr,
        isDeclared: inn.isDeclared,
        runRate: inn.overs > 0 ? (inn.score / inn.overs).toFixed(2) : '0.00'
      }));
      scoreData.currentInnings = matchScore.inningsScoreList.length;
    }

    // Enrich with miniscore live data
    if (mini) {
      scoreData.miniscore = {
        inningsId: mini.inningsId,
        battingTeam: mini.batTeam ? {
          id: mini.batTeam.teamId,
          score: mini.batTeam.teamScore,
          wickets: mini.batTeam.teamWkts
        } : null,
        batsmanStriker: mini.batsmanStriker ? {
          name: mini.batsmanStriker.name,
          runs: mini.batsmanStriker.runs,
          balls: mini.batsmanStriker.balls,
          fours: mini.batsmanStriker.fours,
          sixes: mini.batsmanStriker.sixes,
          strikeRate: mini.batsmanStriker.strikeRate
        } : null,
        batsmanNonStriker: mini.batsmanNonStriker && mini.batsmanNonStriker.id > 0 ? {
          name: mini.batsmanNonStriker.name,
          runs: mini.batsmanNonStriker.runs,
          balls: mini.batsmanNonStriker.balls,
          fours: mini.batsmanNonStriker.fours,
          sixes: mini.batsmanNonStriker.sixes,
          strikeRate: mini.batsmanNonStriker.strikeRate
        } : null,
        bowlerStriker: mini.bowlerStriker ? {
          name: mini.bowlerStriker.name,
          overs: mini.bowlerStriker.overs,
          maidens: mini.bowlerStriker.maidens,
          runs: mini.bowlerStriker.runs,
          wickets: mini.bowlerStriker.wickets,
          economy: mini.bowlerStriker.economy
        } : null,
        bowlerNonStriker: mini.bowlerNonStriker && mini.bowlerNonStriker.id > 0 ? {
          name: mini.bowlerNonStriker.name,
          overs: mini.bowlerNonStriker.overs,
          maidens: mini.bowlerNonStriker.maidens,
          runs: mini.bowlerNonStriker.runs,
          wickets: mini.bowlerNonStriker.wickets,
          economy: mini.bowlerNonStriker.economy
        } : null,
        overs: mini.overs,
        target: mini.target || 0,
        partnership: mini.partnerShip ? {
          runs: mini.partnerShip.runs,
          balls: mini.partnerShip.balls
        } : null,
        currentRunRate: mini.currentRunRate || 0,
        requiredRunRate: mini.requiredRunRate || 0,
        lastWicket: mini.lastWicket || null,
        recentOvers: mini.recentOvsStats || '',
        latestPerformance: mini.latestPerformance || [],
        event: mini.event || '',
        remRunsToWin: mini.remRunsToWin || 0,
        oversRemaining: mini.oversRem || null,
        status: matchScore?.customStatus || ''
      };

      // Extract over separator data if available
      if (mini.overSeparator) {
        // Add imageUrl to players if they have player keys (CREX uses player ID for avatar URLs)
        const addPlayerImageUrl = (player) => {
          if (player && player.id) {
            return { ...player, imageUrl: `https://cricketvectors.akamaized.net/players/org/${player.id}.png` };
          }
          return player;
        };

        scoreData.miniscore.overSummary = {
          overNumber: mini.overSeparator.overNumber,
          summary: mini.overSeparator.overSummary,
          batTeam: mini.overSeparator.batTeamObj,
          batStriker: addPlayerImageUrl(mini.overSeparator.batStrikerObj),
          batNonStriker: addPlayerImageUrl(mini.overSeparator.batNonStrikerObj),
          bowler: addPlayerImageUrl(mini.overSeparator.bowlerObj)
        };
      }
    }

    // Extract commentary ball-by-ball data for current over
    if (rscData.commentary.length > 0) {
      // Sort by timestamp descending (most recent first)
      rscData.commentary.sort((a, b) => b.timestamp - a.timestamp);

      // Get recent ball deliveries for the current over
      const currentInningsComm = rscData.commentary.filter(c =>
        c.inningsId === (mini?.inningsId || scoreData.currentInnings)
      );

      scoreData.recentCommentary = currentInningsComm.slice(0, 30).map(c => ({
        type: c.type,
        text: c.text ? c.text.replace(/<[^>]+>/g, '').substring(0, 200) : '',
        event: c.event,
        batsman: c.batsmanName,
        bowler: c.bowlerName
      }));
    }

    scoreData.timestamp = new Date().toISOString();
    scoreData.error = null;

    // Log summary
    console.log(`  Match: ${scoreData.matchInfo.description} [${scoreData.matchInfo.state}]`);
    if (scoreData.innings.length > 0) {
      scoreData.innings.forEach(inn => {
        console.log(`  Innings ${inn.id}: ${inn.battingTeam} ${inn.score}/${inn.wickets} (${inn.overs} ov)`);
      });
    }
    if (scoreData.miniscore) {
      const ms = scoreData.miniscore;
      if (ms.batsmanStriker) console.log(`  Bat*: ${ms.batsmanStriker.name} ${ms.batsmanStriker.runs}(${ms.batsmanStriker.balls})`);
      if (ms.bowlerStriker) console.log(`  Bowl: ${ms.bowlerStriker.name} ${ms.bowlerStriker.overs}-${ms.bowlerStriker.maidens}-${ms.bowlerStriker.runs}-${ms.bowlerStriker.wickets}`);
      if (ms.recentOvers) console.log(`  Recent: ${ms.recentOvers}`);
    }
    console.log(`  Status: ${scoreData.matchInfo.status || scoreData.miniscore?.status || 'Live'}`);

  } catch (e) {
    scoreData.error = 'Fetch error: ' + e.message;
    console.error('Fetch error:', e.message);
  }
}

// Serve HTML files from disk with localhost replaced by current host
function serveHtmlFile(res, filename) {
  const filePath = path.join(__dirname, filename);
  fs.readFile(filePath, 'utf8', (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('{"error":"File not found"}');
      return;
    }
    // Replace hardcoded localhost API URLs so overlays work on any host
    content = content.replace(
      /const API_URL\s*=\s*'http:\/\/localhost:5555\/score'/g,
      "const API_URL = (window.location.protocol === 'file:' ? 'http://localhost:5555' : window.location.origin) + '/score'"
    );
    content = content.replace(
      /const SERVER_URL\s*=\s*'http:\/\/localhost:5555\/score'/g,
      "const SERVER_URL = (window.location.protocol === 'file:' ? 'http://localhost:5555' : window.location.origin) + '/score'"
    );
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
  });
}

// HTTP server for JSON API
const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = url.parse(req.url, true);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Safe JSON stringify helper
    let jsonStr;
    try { jsonStr = JSON.stringify(scoreData, null, 2); } catch (e) { jsonStr = '{"error":"serialize failed"}'; }

    if (parsedUrl.pathname === '/score') {
      res.writeHead(200);
      res.end(jsonStr);

      // Serve HTML overlay files publicly
    } else if (parsedUrl.pathname === '/overlay') {
      return serveHtmlFile(res, 'cricket_overlay.html');
    } else if (parsedUrl.pathname === '/stats') {
      return serveHtmlFile(res, 'cricket_stats.html');
    } else if (parsedUrl.pathname === '/livebar') {
      return serveHtmlFile(res, 'Record_with_live_bar.html');
    } else if (parsedUrl.pathname === '/bowling') {
      return serveHtmlFile(res, 'bowling_attack.html');
    } else if (parsedUrl.pathname === '/batting') {
      return serveHtmlFile(res, 'batting_card.html');
    } else if (parsedUrl.pathname === '/partnership') {
      return serveHtmlFile(res, 'partnership_tracker.html');
    } else if (parsedUrl.pathname === '/manhattan') {
      return serveHtmlFile(res, 'run_rate_graph.html');
    } else if (parsedUrl.pathname === '/headtohead') {
      return serveHtmlFile(res, 'head_to_head.html');
    } else if (parsedUrl.pathname === '/fow') {
      return serveHtmlFile(res, 'fow_timeline.html');
    } else if (parsedUrl.pathname === '/keymoments') {
      return serveHtmlFile(res, 'key_moments.html');
    } else if (parsedUrl.pathname === '/thisover') {
      return serveHtmlFile(res, 'this_over.html');
    } else if (parsedUrl.pathname === '/playercard') {
      return serveHtmlFile(res, 'player_card.html');

      // Change match URL without redeploying (GET /set-match?url=CRICBUZZ_OR_CREX_URL)
    } else if (parsedUrl.pathname === '/set-match') {
      const newUrl = parsedUrl.query.url;
      const provider = detectProvider(newUrl);
      if (newUrl && (provider === 'cricbuzz' || provider === 'crex')) {
        matchUrl = newUrl;
        console.log(`\n[MATCH CHANGED] Provider: ${provider} | New URL: ${matchUrl}`);
        // Fetch immediately with new URL
        try {
          if (provider === 'crex') { await fetchCrexScore(); }
          else { await fetchCricbuzzScore(); }
        } catch (e) { }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, provider: provider, matchUrl: matchUrl, message: 'Match URL updated! Score will refresh shortly.' }));
      } else {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid URL. Must be a cricbuzz.com or crex.com URL.' }));
      }

      // Get current match URL
    } else if (parsedUrl.pathname === '/get-match') {
      res.writeHead(200);
      res.end(JSON.stringify({ matchUrl: matchUrl || '', provider: detectProvider(matchUrl) }));

      // List custom overlays
    } else if (parsedUrl.pathname === '/api/overlays' && req.method === 'GET') {
      try {
        const files = fs.readdirSync(CUSTOM_OVERLAYS_DIR).filter(f => f.endsWith('.html'));
        const overlays = files.map(f => {
          const stat = fs.statSync(path.join(CUSTOM_OVERLAYS_DIR, f));
          return {
            name: f.replace('.html', ''),
            filename: f,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            url: '/custom/' + encodeURIComponent(f.replace('.html', ''))
          };
        });
        res.writeHead(200);
        res.end(JSON.stringify({ overlays }));
      } catch (e) {
        res.writeHead(200);
        res.end(JSON.stringify({ overlays: [] }));
      }

      // Upload custom overlay (POST with raw HTML body)
    } else if (parsedUrl.pathname === '/api/overlays' && req.method === 'POST') {
      const name = parsedUrl.query.name;
      if (!name || !/^[a-zA-Z0-9_\-\s]+$/.test(name)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid name. Use letters, numbers, spaces, hyphens, underscores.' }));
        return;
      }
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 5 * 1024 * 1024) { req.destroy(); } // 5MB limit
      });
      req.on('end', () => {
        if (!body || body.length < 10) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Empty or invalid HTML content.' }));
          return;
        }
        const safeName = name.trim().replace(/\s+/g, '_');
        const filePath = path.join(CUSTOM_OVERLAYS_DIR, safeName + '.html');
        fs.writeFileSync(filePath, body, 'utf8');
        console.log(`[CUSTOM OVERLAY] Saved: ${safeName}.html (${body.length} bytes)`);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, name: safeName, url: '/custom/' + safeName }));
      });
      return;

      // Delete custom overlay
    } else if (parsedUrl.pathname.startsWith('/api/overlays/') && req.method === 'DELETE') {
      const name = decodeURIComponent(parsedUrl.pathname.replace('/api/overlays/', ''));
      const filePath = path.join(CUSTOM_OVERLAYS_DIR, name + '.html');
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[CUSTOM OVERLAY] Deleted: ${name}.html`);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Overlay not found.' }));
      }

      // Serve custom overlay files
    } else if (parsedUrl.pathname.startsWith('/custom/')) {
      const name = decodeURIComponent(parsedUrl.pathname.replace('/custom/', ''));
      const filePath = path.join(CUSTOM_OVERLAYS_DIR, name + '.html');
      if (fs.existsSync(filePath)) {
        return serveHtmlFile(res, path.join('custom_overlays', name + '.html'));
      } else {
        res.writeHead(404);
        res.end('{"error":"Custom overlay not found"}');
      }

      // Dashboard and root both serve the match control UI
    } else if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/dashboard') {
      return serveHtmlFile(res, 'dashboard.html');
    } else {
      res.writeHead(404);
      res.end('{"error":"Not found"}');
    }
  } catch (err) {
    console.error('[HTTP ERROR]', err.message);
    try { res.writeHead(500); res.end('{"error":"Internal server error"}'); } catch (e) { }
  }
});

// Start server and periodic updates
async function start() {
  // Match URL is optional at startup — user can set it from the dashboard
  if (matchUrl) {
    console.log(`Using match URL: ${matchUrl}\n`);
  } else {
    console.log('No match URL configured. Set one from the dashboard.\n');
  }

  server.on('error', (err) => {
    console.error('[SERVER ERROR]', err.message);
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Kill the other process first.`);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nCricket Score Server v2 started on port ${PORT}`);
    console.log(`Dashboard:    http://localhost:${PORT}/`);
    console.log(`Score API:    http://localhost:${PORT}/score`);
    console.log(`--- Overlays ---`);
    console.log(`Score Overlay: http://localhost:${PORT}/overlay`);
    console.log(`Stats Panel:   http://localhost:${PORT}/stats`);
    console.log(`Live Bar:      http://localhost:${PORT}/livebar`);
    console.log(`Bowling:       http://localhost:${PORT}/bowling`);
    console.log(`Batting:       http://localhost:${PORT}/batting`);
    console.log(`Partnership:   http://localhost:${PORT}/partnership`);
    console.log(`Manhattan:     http://localhost:${PORT}/manhattan`);
    console.log(`Head to Head:  http://localhost:${PORT}/headtohead`);
    console.log(`Fall of Wkts:  http://localhost:${PORT}/fow`);
    console.log(`Key Moments:   http://localhost:${PORT}/keymoments`);
    console.log(`This Over:     http://localhost:${PORT}/thisover`);
    console.log(`Player Card:   http://localhost:${PORT}/playercard\n`);
  });

  // Unified fetch dispatcher — picks the right provider based on URL
  async function fetchScore() {
    const provider = detectProvider(matchUrl);
    if (provider === 'crex') {
      await fetchCrexScore();
    } else if (provider === 'hero') {
      await fetchHeroLiveLine();
    } else {
      await fetchCricbuzzScore();
    }
  }

  // Initial fetch if match URL is already set
  if (matchUrl) {
    const provider = detectProvider(matchUrl);
    console.log(`Provider: ${provider} — Fetching initial data...\n`);
    try { await fetchScore(); } catch (e) { console.error('Initial fetch error:', e.message); }
  }

  // Update every 2 seconds for ball-by-ball accuracy (guarded — never crashes the process)
  setInterval(async () => {
    if (matchUrl) {
      try { await fetchScore(); } catch (e) { console.error('[FETCH LOOP ERROR]', e.message); }
    }
  }, 2000);
}

start().catch(err => {
  console.error('Startup error:', err);
});
