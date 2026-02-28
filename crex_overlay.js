// ===== CRICKET SCORE OVERLAY - JAVASCRIPT =====
// Compatible with all cricket score overlay themes
// Base URL: Auto-detects localhost or current origin

// ===== CONFIGURATION =====
// Multiple API URLs supported - will try in order on failure
const API_URLS = [
    // Local server (default)
    (window.location.protocol === 'file:'
        ? 'http://localhost:5555'
        : window.location.origin) + '/score',
    // Hero Live Line API (example)
    'https://www.heroliveline.com/api/match/8093',
    // Alternative APIs can be added here
];

let currentApiIndex = 0;

// Get current API URL
function getApiUrl() {
    return API_URLS[currentApiIndex] || API_URLS[0];
}

// Switch to next API on failure
function switchToNextApi() {
    if (currentApiIndex < API_URLS.length - 1) {
        currentApiIndex++;
        console.log('Switching to API:', getApiUrl());
    }
}

// Reset to first API
function resetApiIndex() {
    currentApiIndex = 0;
}

const REFRESH_MS = 2000;
const DEMO_FALLBACK_AFTER = 3;
let failCount = 0;
let demoMode = false;
let previousBallKey = null;
let prevFlag1Id = null;
let prevFlag2Id = null;

// ===== DEMO DATA =====
function getDemoData() {
    return {
        provider: 'crex',
        matchInfo: {
            description: 'Dolphins vs Warriors, CSA DIV-1 2026',
            format: 'ODI',
            status: 'DOL opt to Bat',
            state: 'In Progress',
            venue: "St George's Park, Gqeberha",
            toss: 'DOL opt to Bat'
        },
        team1: {
            name: 'Dolphins', shortName: 'DOL', id: '6A',
            flagUrl: 'https://cricketvectors.akamaized.net/Teams/6A.png',
            jerseyUrl: 'https://cricketvectors.akamaized.net/jersey/limited/org/6A.png',
            gradient: '#3D884B'
        },
        team2: {
            name: 'Warriors', shortName: 'WAR', id: '6C',
            flagUrl: 'https://cricketvectors.akamaized.net/Teams/6C.png',
            jerseyUrl: 'https://cricketvectors.akamaized.net/jersey/limited/org/6C.png',
            gradient: '#646E2C'
        },
        currentInnings: 1,
        innings: [
            { id: 1, battingTeam: 'Dolphins', battingTeamShort: 'DOL', score: 159, wickets: 7, overs: 20.0, runRate: 7.95 }
        ],
        miniscore: {
            inningsId: 1,
            overs: 13.2,
            currentRunRate: 7.95,
            requiredRunRate: 8.5,
            target: 280,
            remRunsToWin: 121,
            partnership: { runs: 45, balls: 32 },
            lastWicket: { name: 'Mnyanda', runs: '12', balls: '(8)' },
            recentOvers: '',
            overByOver: [
                { over: 'Over 12', overinfo: ['1', '0', '4', '6', 'wd', '1'], total: 13 },
                { over: 'Over 13', overinfo: ['2', '4', '0', '1', '0', '0'], total: 7 }
            ],
            batsmanStriker: {
                name: 'JJ Smuts', fullName: 'JJ Smuts',
                imageUrl: 'https://cricketvectors.akamaized.net/players/org/MO.png',
                runs: 45, balls: 32, fours: 4, sixes: 2, strikeRate: 140.62
            },
            batsmanNonStriker: {
                name: 'S van Staden', fullName: 'Slade van Staden',
                imageUrl: 'https://cricketvectors.akamaized.net/players/org/8IC.png',
                runs: 28, balls: 18, fours: 3, sixes: 1, strikeRate: 155.55
            },
            bowlerStriker: {
                name: 'K Mungroo', fullName: 'Kerwin Mungroo',
                imageUrl: 'https://cricketvectors.akamaized.net/players/org/1FA.png',
                overs: '4.0', maidens: 0, runs: 35, wickets: 2, economy: 8.75,
                figures: '2-35'
            }
        },
        sessionData: {
            session: 35, session2: 28, lambi: 165, lambi2: 142,
            sessionOvers: 8.3, lambiOvers: 15.2
        },
        projectedScores: {
            rates: { r1: "1.50", r2: "2.00", r3: "3.00", r4: "5.00" },
            ps: [
                { ov: "10 Overs", sc: { ps1: "45", ps2: "52", ps3: "68", ps4: "85" } },
                { ov: "15 Overs", sc: { ps1: "72", ps2: "85", ps3: "105", ps4: "130" } },
                { ov: "20 Overs", sc: { ps1: "98", ps2: "115", ps3: "140", ps4: "175" } }
            ]
        },
        crrHistory: [
            { over: 5, crr: 5.2 }, { over: 10, crr: 6.1 }, { over: 15, crr: 7.3 }, { over: 20, crr: 7.95 }
        ],
        timestamp: new Date().toISOString(),
        error: null
    };
}

// ===== HELPER FUNCTIONS =====

// Safe value getter
function safe(v, fallback = '--') {
    return (v !== null && v !== undefined && v !== '') ? v : fallback;
}

// Get country flag emoji
function getCountryFlag(teamName) {
    const n = (teamName || '').toLowerCase();
    const flags = {
        pakistan: '🇵🇰', pak: '🇵🇰',
        india: '🇮🇳', ind: '🇮🇳',
        'new zealand': '🇳🇿', nz: '🇳🇿',
        australia: '🇦🇺', aus: '🇦🇺',
        england: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', eng: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
        'south africa': '🇿🇦', sa: '🇿🇦',
        'sri lanka': '🇱🇰', sl: '🇱🇰',
        bangladesh: '🇧🇩', ban: '🇧🇩',
        'west indies': '🏏', wi: '🏏',
        afghanistan: '🇦🇫', afg: '🇦🇫',
        zimbabwe: '🇿🇼', zim: '🇿🇼',
        ireland: '🇮🇪', ire: '🇮🇪',
    };
    for (const key in flags) {
        if (n.includes(key)) return flags[key];
    }
    return '🏏';
}

// Build flag HTML - use image URL if available, else emoji
function flagHtml(teamObj, teamName) {
    if (teamObj && teamObj.flagUrl) {
        return `<img src="${teamObj.flagUrl}" alt="${teamObj.shortName || ''}" onerror="this.parentElement.textContent='🏏'">`;
    }
    return getCountryFlag(teamName);
}

// Build player avatar HTML - use image URL if available, else initials avatar
function avatarHtml(player, fallbackEmoji) {
    if (player && player.imageUrl) {
        return `<img src="${player.imageUrl}" alt="${player.name || ''}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='${getInitialsAvatar(player.name)}'">`;
    }
    if (player && player.name && player.name !== '--' && player.name !== '-') {
        return getInitialsAvatar(player.name);
    }
    return fallbackEmoji || '🧑';
}

// Generate SVG avatar with initials — consistent color per player name
function getInitialsAvatar(name) {
    if (!name || name === '--' || name === '-') return '🧑';
    const parts = name.trim().split(/\s+/);
    const initials = parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : name.substring(0, 2).toUpperCase();
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    const bg = `hsl(${hue}, 55%, 35%)`;
    return `<svg viewBox="0 0 60 60" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><circle cx="30" cy="30" r="30" fill="${bg}"/><text x="30" y="32" text-anchor="middle" dominant-baseline="central" fill="white" font-family="'Rajdhani',sans-serif" font-size="22" font-weight="700">${initials}</text></svg>`;
}

// Get strike rate class for styling
function getSRClass(sr) {
    if (sr >= 150) return 'high';
    if (sr >= 100) return 'mid';
    return 'low';
}

// Parse recent overs string
function parseRecentOvers(str) {
    if (!str) return { thisOver: [], lastOver: [] };
    const normalized = str
        .replace(/Over \d+:/g, '')
        .replace(/= \d+/g, '')
        .replace(/\s+/g, ',');
    const parts = normalized.split('|');
    const parse = (s) => s ? s.split(',').map(b => b.trim()).filter(Boolean) : [];
    if (parts.length >= 2) {
        return { thisOver: parse(parts[parts.length - 1]), lastOver: parse(parts[parts.length - 2]) };
    }
    return { thisOver: parse(parts[0]), lastOver: [] };
}

// Parse CREX overByOver array
function parseCrexOvers(overByOver) {
    if (!overByOver || overByOver.length === 0) return { thisOver: [], lastOver: [], allOvers: [] };
    const last = overByOver[overByOver.length - 1];
    const prev = overByOver.length >= 2 ? overByOver[overByOver.length - 2] : null;
    return {
        thisOver: last ? last.overinfo || [] : [],
        thisOverLabel: last ? last.over : 'This Over',
        thisOverTotal: last ? last.total : 0,
        lastOver: prev ? prev.overinfo || [] : [],
        lastOverLabel: prev ? prev.over : 'Last Over',
        lastOverTotal: prev ? prev.total : 0,
        allOvers: overByOver
    };
}

// Get ball CSS class
function ballClass(ball) {
    const b = String(ball).toLowerCase();
    if (b === '6') return 'six';
    if (b === '4') return 'four';
    if (b === '0') return 'dot';
    if (b === 'w') return 'wicket';
    // CFLL: 1W, 2W = runs + wicket
    if (/^\d+w$/i.test(b)) return 'wicket';
    // CFLL: WB = wide ball, Wd = wide
    if (b === 'wb' || b === 'wd' || b.includes('wd')) return 'wide lb';
    // CFLL: NB = no ball
    if (b.includes('nb')) return 'lb';
    // CFLL: 1LB, 2LB = leg byes ; 1BYE = byes
    if (b.includes('lb') || b.includes('bye')) return 'lb';
    // Any other W variations
    if (b.includes('w') && b !== 'wd' && b !== 'wb') return 'wide lb';
    return '';
}

// Render balls HTML
function renderBalls(balls) {
    return balls.map(b => `<div class="ball-b ${ballClass(b)}">${b}</div>`).join('');
}

// Calculate over total
function overTotal(balls) {
    let total = 0;
    balls.forEach(b => {
        const num = parseInt(b);
        if (!isNaN(num)) total += num;
    });
    return total;
}

// Format lastWicket - handles both string and CREX object
function formatLastWicket(lw) {
    if (!lw) return null;
    if (typeof lw === 'string') return lw;
    if (lw.name) {
        return `${lw.name} ${lw.runs || 0}${lw.balls || ''}`;
    }
    return null;
}

// ===== MAIN RENDER FUNCTION =====
function render(data) {
    if (!data || data.error) {
        console.error('Data error:', data?.error);
        return;
    }

    try {
        // Match info
        const matchDesc = document.getElementById('matchDesc');
        const matchFormat = document.getElementById('matchFormat');
        const matchStatus = document.getElementById('matchStatus');
        const matchType = document.getElementById('matchType');

        if (matchDesc) matchDesc.textContent = safe(data.matchInfo?.description);
        if (matchFormat) matchFormat.textContent = safe(data.matchInfo?.format);
        if (matchStatus) matchStatus.textContent = safe(data.matchInfo?.status);
        if (matchType) matchType.textContent = safe(data.matchInfo?.format);

        // Teams
        const team1 = data.team1 || {};
        const team2 = data.team2 || {};

        const team1Name = document.getElementById('team1Name');
        const team1Short = document.getElementById('team1Short');
        const team2Name = document.getElementById('team2Name');
        const team2Short = document.getElementById('team2Short');

        if (team1Name) team1Name.textContent = safe(team1.name);
        if (team1Short) team1Short.textContent = safe(team1.shortName);
        if (team2Name) team2Name.textContent = safe(team2.name);
        if (team2Short) team2Short.textContent = safe(team2.shortName);

        // Flags — only update if team changed to prevent blinking
        const flag1 = document.getElementById('flag1');
        const flag2 = document.getElementById('flag2');
        const newFlag1Id = team1.id || team1.shortName;
        const newFlag2Id = team2.id || team2.shortName;
        if (flag1 && newFlag1Id !== prevFlag1Id) {
            flag1.innerHTML = flagHtml(team1, team1.name);
            prevFlag1Id = newFlag1Id;
        }
        if (flag2 && newFlag2Id !== prevFlag2Id) {
            flag2.innerHTML = flagHtml(team2, team2.name);
            prevFlag2Id = newFlag2Id;
        }

        // Scores
        const innings = data.innings?.[0] || {};
        const scoreText = `${safe(innings.score)}/${safe(innings.wickets)}`;
        const overText = `(${safe(innings.overs)} Overs)`;

        const mainScore = document.getElementById('mainScore');
        const scoreDetail = document.getElementById('scoreDetail');
        const runRate = document.getElementById('runRate');

        if (mainScore) mainScore.textContent = scoreText;
        if (scoreDetail) scoreDetail.textContent = overText;
        if (runRate) runRate.textContent = `CRR: ${safe(innings.runRate)}`;

        // Miniscore
        const mini = data.miniscore || {};

        const currentOver = document.getElementById('currentOver');
        const requiredRR = document.getElementById('requiredRR');
        const target = document.getElementById('target');

        if (currentOver) currentOver.textContent = safe(mini.overs);
        if (requiredRR) requiredRR.textContent = safe(mini.requiredRunRate);
        if (target) target.textContent = safe(mini.target);

        // Batsmen
        const striker = mini.batsmanStriker || {};
        const nonStriker = mini.batsmanNonStriker || {};

        // Striker
        const strikerName = document.getElementById('strikerName');
        const strikerRuns = document.getElementById('strikerRuns');
        const strikerBalls = document.getElementById('strikerBalls');
        const strikerFoursSixes = document.getElementById('strikerFoursSixes');
        const strikerSR = document.getElementById('strikerSR');

        if (strikerName) strikerName.textContent = safe(striker.name);
        if (strikerRuns) strikerRuns.textContent = safe(striker.runs);
        if (strikerBalls) strikerBalls.textContent = `(${safe(striker.balls)})`;
        if (strikerFoursSixes) {
            strikerFoursSixes.innerHTML = `4s: <span>${striker.fours || 0}</span> | 6s: <span>${striker.sixes || 0}</span>`;
        }
        if (strikerSR) {
            strikerSR.textContent = `SR: ${(parseFloat(striker.strikeRate) || 0).toFixed(2)}`;
        }

        // Non-striker
        const nonStrikerName = document.getElementById('nonStrikerName');
        const nonStrikerRuns = document.getElementById('nonStrikerRuns');
        const nonStrikerBalls = document.getElementById('nonStrikerBalls');
        const nonStrikerFoursSixes = document.getElementById('nonStrikerFoursSixes');
        const nonStrikerSR = document.getElementById('nonStrikerSR');

        if (nonStrikerName) nonStrikerName.textContent = safe(nonStriker.name);
        if (nonStrikerRuns) nonStrikerRuns.textContent = safe(nonStriker.runs);
        if (nonStrikerBalls) nonStrikerBalls.textContent = `(${safe(nonStriker.balls)})`;
        if (nonStrikerFoursSixes) {
            nonStrikerFoursSixes.innerHTML = `4s: <span>${nonStriker.fours || 0}</span> | 6s: <span>${nonStriker.sixes || 0}</span>`;
        }
        if (nonStrikerSR) {
            nonStrikerSR.textContent = `SR: ${(parseFloat(nonStriker.strikeRate) || 0).toFixed(2)}`;
        }

        // Bowler
        const bowler = mini.bowlerStriker || {};
        const bowlerName = document.getElementById('bowlerName');
        const bowlerFigures = document.getElementById('bowlerFigures');

        if (bowlerName) bowlerName.textContent = safe(bowler.name);
        if (bowlerFigures) bowlerFigures.textContent = safe(bowler.figures);

        // Partnership
        const part = mini.partnership || {};
        const partnership = document.getElementById('partnership');
        if (partnership) {
            partnership.textContent = `${safe(part.runs)} (${safe(part.balls)})`;
        }

        // Stats Chips - CRR, RRR, Partnership, WIN%
        const crr = parseFloat(mini.currentRunRate) || 0;
        const rrr = parseFloat(mini.requiredRunRate) || 0;

        // Win probability calculation
        let batWinPct = 50;
        if (rrr > 0) {
            const ratio = Math.min(crr / rrr, 3);
            batWinPct = Math.min(95, Math.max(5, Math.round(50 * ratio)));
        } else if (mini.remRunsToWin && mini.remRunsToWin > 0) {
            const rem = parseInt(mini.remRunsToWin) || 0;
            const targetNum = parseInt(mini.target) || 0;
            batWinPct = rem <= 0 ? 100 : Math.min(95, Math.max(5, Math.round(100 - (rem / targetNum) * 100)));
        } else if (data.innings && data.innings.length === 1) {
            batWinPct = 50;
        }

        const statCRR = document.getElementById('statCRR');
        const statRRR = document.getElementById('statRRR');
        const statPartnership = document.getElementById('statPartnership');
        const statWin = document.getElementById('statWin');
        const winLabel = document.getElementById('winLabel');

        if (statCRR) statCRR.textContent = crr > 0 ? crr.toFixed(2) : '--';
        if (statRRR) statRRR.textContent = rrr > 0 ? rrr.toFixed(2) : '--';
        if (statPartnership) statPartnership.textContent = part.runs ? `${part.runs}(${part.balls})` : '--';
        if (statWin) statWin.textContent = `${batWinPct}%`;
        if (winLabel) {
            const battingTeam = innings.battingTeamShort || team1.shortName || 'BAT';
            winLabel.textContent = `${battingTeam} WIN`;
        }

        // Last Wicket
        const lw = mini.lastWicket || {};
        const lastWicket = document.getElementById('lastWicket');
        if (lastWicket) {
            lastWicket.textContent = lw.name ? `${safe(lw.name)} ${safe(lw.runs)}${safe(lw.balls)}` : '-';
        }

        // Last Wicket Ticker
        const lwText = lw.name ? `${safe(lw.name)} ${safe(lw.runs)}${safe(lw.balls)}` : '';
        const tickerContent = lwText || data.matchInfo?.status || '';
        const lastWicketTicker = document.getElementById('lastWicketTicker');
        const tickerContentEl = document.getElementById('tickerContent');

        if (tickerContent && lastWicketTicker && tickerContentEl) {
            lastWicketTicker.style.display = 'block';
            tickerContentEl.textContent = `${tickerContent}  •  ${tickerContent}`;
        } else if (lastWicketTicker) {
            lastWicketTicker.style.display = 'none';
        }

        // Last Ball Display
        try {
            const lastBallCenter = document.getElementById('lastBallCenter');
            if (lastBallCenter) {
                // Try overBreakdown first (CREX format)
                if (mini.overBreakdown && mini.overBreakdown.length > 0) {
                    const lastOver = mini.overBreakdown[mini.overBreakdown.length - 1];
                    if (lastOver.balls && lastOver.balls.length > 0) {
                        const lastBall = lastOver.balls[lastOver.balls.length - 1];
                        renderLastBall(lastBallCenter, lastBall);
                    }
                }
                // Try overByOver (alternative format)
                else if (mini.overByOver && mini.overByOver.length > 0) {
                    const lastOver = mini.overByOver[mini.overByOver.length - 1];
                    if (lastOver.overinfo && lastOver.overinfo.length > 0) {
                        const lastBall = lastOver.overinfo[lastOver.overinfo.length - 1];
                        renderLastBall(lastBallCenter, lastBall);
                    }
                }
            }
        } catch (e) {
            console.error('Last ball error:', e);
        }

        // Session Data
        const sessionData = data.sessionData || mini.sessionData;
        const sessionSection = document.getElementById('sessionSection');
        if (sessionSection && sessionData && (sessionData.session || sessionData.session2)) {
            sessionSection.style.display = 'block';
            const session1 = document.getElementById('session1');
            const session2 = document.getElementById('session2');
            const lambi = document.getElementById('lambi');
            const lambi2 = document.getElementById('lambi2');

            if (session1) session1.textContent = safe(sessionData.session);
            if (session2) session2.textContent = safe(sessionData.session2);
            if (lambi) lambi.textContent = safe(sessionData.lambi);
            if (lambi2) lambi2.textContent = safe(sessionData.lambi2);
        }

        // Projected Scores
        const pr = data.projectedScores || mini.projectedScores;
        const projectedSection = document.getElementById('projectedSection');
        if (projectedSection && pr && pr.ps && pr.ps.length > 0) {
            projectedSection.style.display = 'block';
            const projectedGrid = document.getElementById('projectedGrid');
            if (projectedGrid) {
                projectedGrid.innerHTML = pr.ps.map(p => `
                    <div class="projected-item">
                        <div class="projected-label">${safe(p.ov)}</div>
                        <div class="projected-value">${safe(p.sc?.ps1)}</div>
                    </div>
                `).join('');
            }
        }

        // CRR History
        const crrHistory = data.crrHistory || mini.crrHistory;
        const crrHistorySection = document.getElementById('crrHistory');
        if (crrHistorySection && crrHistory && crrHistory.length > 0) {
            crrHistorySection.style.display = 'block';
            const crrDiv = document.getElementById('crrValues');
            if (crrDiv) {
                crrDiv.innerHTML = crrHistory.slice(-4).map(h => `
                    <div class="crr-item">
                        <div class="crr-label">Ov ${safe(h.over)}</div>
                        <div class="crr-value">${safe(h.crr)}</div>
                    </div>
                `).join('');
            }
        }

        // Recent Overs
        const recentOvers = mini.overByOver || [];
        const recentDiv = document.getElementById('recentOvers');
        if (recentDiv) {
            recentDiv.innerHTML = recentOvers.slice(-3).reverse().map(ov => `
                <div class="over-row">
                    <div class="over-label">${safe(ov.over)}</div>
                    <div class="balls-container">${renderBalls(ov.overinfo || [])}</div>
                    <div class="over-equals">= ${safe(ov.total)}</div>
                </div>
            `).join('');
        }

        // Venue
        const venue = document.getElementById('venue');
        const toss = document.getElementById('toss');
        if (venue) venue.textContent = safe(data.matchInfo?.venue);
        if (toss) toss.textContent = safe(data.matchInfo?.toss);

    } catch (e) {
        console.error('Render error:', e);
    }
}

// Render last ball display
function renderLastBall(container, lastBall) {
    if (!container || !lastBall) return;

    const b = String(lastBall).toLowerCase();
    let displayValue = lastBall;
    let displayLabel = '';
    let colorClass = '';

    if (b === 'w') {
        displayValue = 'W';
        displayLabel = '';
        colorClass = 'wicket';
    } else if (b === '6') {
        displayValue = '6';
        displayLabel = 'SIX';
        colorClass = 'six';
    } else if (b === '4') {
        displayValue = '4';
        displayLabel = 'FOUR';
        colorClass = 'four';
    } else if (b === '0') {
        displayValue = 'DOT';
        displayLabel = 'BALL';
        colorClass = 'dot';
    } else if (b.includes('wd')) {
        displayValue = 'WD';
        displayLabel = 'WIDE';
        colorClass = 'wide';
    } else if (b.includes('nb')) {
        displayValue = 'NB';
        displayLabel = 'NO BALL';
        colorClass = 'wide';
    } else if (b.includes('lb')) {
        displayValue = 'LB';
        displayLabel = 'LEG BYE';
        colorClass = 'wide';
    } else {
        displayValue = lastBall;
        displayLabel = parseInt(b) > 0 ? 'RUNS' : '';
    }

    container.innerHTML = `
        <div class="last-ball-number ${colorClass} pop">${displayValue}</div>
        <div class="last-ball-desc">${displayLabel}</div>`;
}

// ===== HERO LIVE LINE DATA MAPPER =====
function mapHeroLiveLineData(data) {
    if (!data || !data.match_live || !data.match_live.match_live || !data.match_live.match_live.data) return null;
    const hl = data.match_live.match_live.data;

    const isTeam1Batting = (hl.batting_team == hl.team_a_id);
    const battingTeamObj = isTeam1Batting ? hl.team_a_score : hl.team_b_score;
    let btsKey = '1';
    if (!isTeam1Batting) btsKey = '2';

    const scoresObj = battingTeamObj ? battingTeamObj[btsKey] : { score: 0, wicket: 0, over: "0.0" };

    const strikeBatsman = hl.batsman && hl.batsman.length > 0 ? hl.batsman[0] : {};
    const nonStrikeBatsman = hl.batsman && hl.batsman.length > 1 ? hl.batsman[1] : {};

    const overByOver = [];
    if (hl.last4overs) {
        hl.last4overs.forEach(o => {
            overByOver.push({
                over: 'Over ' + o.over,
                total: o.runs,
                overinfo: o.balls || []
            });
        });
    }

    return {
        provider: 'heroliveline',
        matchInfo: {
            description: hl.team_a + ' vs ' + hl.team_b,
            format: hl.match_type,
            status: hl.result || hl.toss || 'In Progress',
            state: hl.result ? 'Complete' : 'In Progress',
            venue: 'Unknown Venue',
            toss: hl.toss
        },
        team1: {
            name: hl.team_a, shortName: hl.team_a_short, id: hl.team_a_id,
            flagUrl: hl.team_a_img,
            gradient: '#3D884B'
        },
        team2: {
            name: hl.team_b, shortName: hl.team_b_short, id: hl.team_b_id,
            flagUrl: hl.team_b_img,
            gradient: '#646E2C'
        },
        currentInnings: parseInt(hl.current_inning) || 1,
        innings: [
            {
                id: parseInt(hl.current_inning) || 1,
                battingTeam: isTeam1Batting ? hl.team_a : hl.team_b,
                battingTeamShort: isTeam1Batting ? hl.team_a_short : hl.team_b_short,
                score: scoresObj ? scoresObj.score : 0,
                wickets: scoresObj ? scoresObj.wicket : 0,
                overs: scoresObj ? scoresObj.over : "0.0",
                runRate: hl.curr_rate || 0
            }
        ],
        miniscore: {
            inningsId: parseInt(hl.current_inning) || 1,
            overs: scoresObj ? scoresObj.over : "0.0",
            currentRunRate: hl.curr_rate,
            requiredRunRate: hl.rr_rate || "0.0",
            target: hl.target || 0,
            remRunsToWin: hl.run_need || 0,
            partnership: { runs: hl.partnership?.run || 0, balls: hl.partnership?.ball || 0 },
            lastWicket: hl.lastwicket ? { name: hl.lastwicket.player, runs: hl.lastwicket.run, balls: '(' + hl.lastwicket.ball + ')' } : null,
            recentOvers: '',
            overByOver: overByOver,
            batsmanStriker: {
                name: strikeBatsman.name || '-', fullName: strikeBatsman.name || '-',
                imageUrl: strikeBatsman.img,
                runs: strikeBatsman.run || 0, balls: strikeBatsman.ball || 0, fours: strikeBatsman.fours || 0, sixes: strikeBatsman.sixes || 0, strikeRate: strikeBatsman.strike_rate || 0
            },
            batsmanNonStriker: {
                name: nonStrikeBatsman.name || '-', fullName: nonStrikeBatsman.name || '-',
                imageUrl: nonStrikeBatsman.img,
                runs: nonStrikeBatsman.run || 0, balls: nonStrikeBatsman.ball || 0, fours: nonStrikeBatsman.fours || 0, sixes: nonStrikeBatsman.sixes || 0, strikeRate: nonStrikeBatsman.strike_rate || 0
            },
            bowlerStriker: {
                name: hl.bolwer?.name || '-', fullName: hl.bolwer?.name || '-',
                imageUrl: hl.bolwer?.img,
                overs: hl.bolwer?.over || '0.0', maidens: hl.bolwer?.maiden || 0, runs: hl.bolwer?.run || 0, wickets: hl.bolwer?.wicket || 0, economy: hl.bolwer?.economy || '0.0',
                figures: (hl.bolwer?.wicket || 0) + '-' + (hl.bolwer?.run || 0)
            }
        },
        sessionData: {}, // Map if available
        projectedScores: {},
        crrHistory: [],
        timestamp: new Date().toISOString(),
        error: null
    };
}

// ===== DATA FETCH =====
async function fetchAndRender() {
    try {
        const urlToFetch = getApiUrl();
        let finalData = null;

        // Check if HeroLiveLine URL using ID
        let matchId = null;
        if (urlToFetch.includes('heroliveline.com')) {
            const match = urlToFetch.match(/\/(\d+)$/);
            if (match) matchId = match[1];
        }

        if (matchId) {
            // It's a HeroLiveLine Match ID Fetch
            const hllApi = 'https://laravel.heroliveline.com/api/web/match/matchLive';
            const res = await fetch(hllApi, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ match_id: matchId })
            });
            if (!res.ok) throw new Error('Network error from HeroLiveLine');
            const json = await res.json();
            if (json && json.status === "success") {
                finalData = mapHeroLiveLineData(json);
            } else {
                throw new Error('HeroLiveLine data unavailable');
            }
        } else {
            // Standard CREX/Local API Fetch via GET
            const res = await fetch(urlToFetch);
            if (!res.ok) throw new Error('Network error');
            finalData = await res.json();
        }

        failCount = 0;
        if (finalData) render(finalData);

    } catch (e) {
        console.error('Fetch error:', e);
        failCount++;
        switchToNextApi(); // Move to next api url on fail

        if (failCount >= DEMO_FALLBACK_AFTER * API_URLS.length && !demoMode) {
            demoMode = true;
            console.warn('Server unreachable — using demo data');
        }
        if (demoMode) render(getDemoData());
    }
}

// ===== INITIALIZATION =====

// Auto-detect and initialize
function initCricketOverlay() {
    // Initial load + polling
    fetchAndRender();
    setInterval(fetchAndRender, REFRESH_MS);

    // Auto-play crowd noise audio
    const crowdAudio = document.getElementById('crowdAudio');
    if (crowdAudio) {
        crowdAudio.volume = 0.3;
        crowdAudio.play().catch(e => console.log('Audio autoplay prevented:', e));
    }

    // Responsive auto-scaling
    function autoScaleOverlay() {
        const card = document.querySelector('.card');
        if (!card) return;

        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const cardRect = card.getBoundingClientRect();

        const availableWidth = screenWidth - 20;
        const availableHeight = screenHeight - 20;

        const scaleX = availableWidth / cardRect.width;
        const scaleY = availableHeight / cardRect.height;
        const scale = Math.min(scaleX, scaleY, 1);

        if (scale < 1) {
            card.style.transform = `scale(${scale})`;
        } else {
            card.style.transform = 'scale(1)';
        }
    }

    // Initial scaling and resize listener
    window.addEventListener('load', autoScaleOverlay);
    window.addEventListener('resize', autoScaleOverlay);
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCricketOverlay);
} else {
    initCricketOverlay();
}

// Export for manual initialization
window.initCricketOverlay = initCricketOverlay;
window.render = render;
window.fetchAndRender = fetchAndRender;
window.getDemoData = getDemoData;
window.getApiUrl = getApiUrl;
