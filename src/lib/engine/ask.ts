// Feature de "pregunta libre sobre un partido" — textbox tipo chat.
//
// DECISIÓN DE DISEÑO (te la marco a Fausto): esto lo armé SIN LLM para
// tenerlo funcionando hoy sin pedirte una cuenta más (Anthropic Console +
// otra API key). El parseo de equipos es por diccionario de alias
// (src/lib/teams.ts) y la respuesta se arma con templates igual que el
// resto del playbook — sigue la misma filosofía de "cero LLM en
// producción" que ya tenías. Si más adelante quieres que entienda
// preguntas más abiertas ("¿y si llueve?", "dame tu favorito de la
// semana"), ahí sí conviene una capa de LLM barato (Haiku) por encima de
// estos mismos números — es un agregado pequeño, no un rediseño.
//
// SAME-GAME PARLAY: no existe forma de calcular el precio combinado real
// de un SGP sin el motor de correlación propio de cada book (no es un
// dato público). Lo que se devuelve son las legs individuales con edge
// positivo para que Fausto arme el SGP él mismo en el book — nunca un
// numero de cuota combinada inventado.

import { fetchAllGames, fetchInjuriesWeek, fetchPlayerStatsSeason, fetchTeamStatsSeason, NflverseGame } from '../ingest/nflverse';
import { fetchMoneylineOdds, fetchPlayerProps, SharpApiPropsUnavailableError } from '../ingest/sharpapi';
import { computeTeamRatings, computeBaseEdge, edgeToHomeWinProb } from './ratings';
import { applySituationalAdjustments, weatherMultipliers, GameContext } from './situational';
import { identifyStarters, isPlayerOut } from './starters';
import { computeDefensiveFactors, projectPassYards, projectRushYards, projectReceivingYards, projectAnytimeTd, probOverLine, poissonProbAtLeastOne } from './props';
import { deVigTwoWay, evaluateEdge, MIN_EDGE_PCT } from './edge';
import { extractTeamsFromText, seasonForDate, TeamInfo } from '../teams';

export interface AskResult {
  homeTeam: string;
  awayTeam: string;
  answer: string;
  suggestedLegs: { selection: string; marketType: string; oddsAmerican: number; edgePct: number }[];
}

export class AskParseError extends Error {}

function findMatchupGame(games: NflverseGame[], teamA: TeamInfo, teamB: TeamInfo, today: Date): NflverseGame {
  const season = seasonForDate(today);
  const candidates = games.filter(
    (g) =>
      g.season === season &&
      ((g.home_team === teamA.code && g.away_team === teamB.code) ||
        (g.home_team === teamB.code && g.away_team === teamA.code))
  );
  if (candidates.length === 0) {
    throw new AskParseError(
      `No encontré un partido programado entre ${teamA.name} y ${teamB.name} en la temporada ${season}.`
    );
  }
  // el más cercano a hoy (puede ser el de esta semana, o el más reciente si ya se jugó)
  candidates.sort(
    (a, b) => Math.abs(new Date(a.gameday).getTime() - today.getTime()) - Math.abs(new Date(b.gameday).getTime() - today.getTime())
  );
  return candidates[0];
}

export async function answerMatchupQuestion(question: string, now: Date = new Date()): Promise<AskResult> {
  const teams = extractTeamsFromText(question);
  if (teams.length < 2) {
    throw new AskParseError(
      'No pude identificar dos equipos en tu pregunta. Probá con algo como "¿qué opinas del partido de bills vs lions?".'
    );
  }
  const [teamA, teamB] = teams;

  const allGames = await fetchAllGames();
  const game = findMatchupGame(allGames, teamA, teamB, now);
  const season = game.season;
  const week = game.week;

  const [ratings, moneylineOdds, injuries, seasonStats, teamStats] = await Promise.all([
    computeTeamRatings(season, week),
    fetchMoneylineOdds(),
    fetchInjuriesWeek(season, week),
    fetchPlayerStatsSeason(season),
    fetchTeamStatsSeason(season),
  ]);

  const ratingByTeam = new Map(ratings.map((r) => [r.team, r]));
  const home = ratingByTeam.get(game.home_team);
  const away = ratingByTeam.get(game.away_team);
  if (!home || !away) {
    throw new AskParseError('No tengo suficientes datos de esta temporada todavía para ese partido (muy pronto en el calendario).');
  }

  const baseEdge = computeBaseEdge(home, away);
  const homeStarters = identifyStarters(game.home_team, seasonStats);
  const awayStarters = identifyStarters(game.away_team, seasonStats);
  const ctx: GameContext = {
    game,
    homeQbOut: isPlayerOut(injuries, homeStarters.qbId),
    awayQbOut: isPlayerOut(injuries, awayStarters.qbId),
    homeSkillPlayerOut: isPlayerOut(injuries, homeStarters.rb1Id) || isPlayerOut(injuries, homeStarters.wr1Id),
    awaySkillPlayerOut: isPlayerOut(injuries, awayStarters.rb1Id) || isPlayerOut(injuries, awayStarters.wr1Id),
    homePassRusherOut: isPlayerOut(injuries, homeStarters.edge1Id),
    awayPassRusherOut: isPlayerOut(injuries, awayStarters.edge1Id),
  };
  const { adjustedEdge, breakdown } = applySituationalAdjustments(baseEdge, ctx);
  const modelHomeWinProb = edgeToHomeWinProb(adjustedEdge);

  const homeLine = moneylineOdds.find(
    (l) => ((l.home_team === game.home_team && l.away_team === game.away_team) || (l.home_team === game.away_team && l.away_team === game.home_team)) && l.selection === game.home_team
  );
  const awayLine = moneylineOdds.find(
    (l) => ((l.home_team === game.home_team && l.away_team === game.away_team) || (l.home_team === game.away_team && l.away_team === game.home_team)) && l.selection === game.away_team
  );

  const lines: string[] = [];
  lines.push(`**${game.away_team} @ ${game.home_team}** — semana ${week}, temporada ${season}.`);
  lines.push(
    `Modelo: ${game.home_team} ${(modelHomeWinProb * 100).toFixed(1)}% de ganar / ${game.away_team} ${((1 - modelHomeWinProb) * 100).toFixed(1)}%.`
  );

  const suggestedLegs: AskResult['suggestedLegs'] = [];

  if (homeLine && awayLine) {
    const { fairProbA: fairHome, fairProbB: fairAway } = deVigTwoWay(homeLine.odds_american, awayLine.odds_american);
    const homeEval = evaluateEdge(modelHomeWinProb, fairHome);
    const awayEval = evaluateEdge(1 - modelHomeWinProb, fairAway);
    lines.push(
      `Mercado (de-vig): ${game.home_team} ${(fairHome * 100).toFixed(1)}% / ${game.away_team} ${(fairAway * 100).toFixed(1)}%.`
    );
    const best = homeEval.edgePct > awayEval.edgePct ? { team: game.home_team, ev: homeEval, odds: homeLine.odds_american } : { team: game.away_team, ev: awayEval, odds: awayLine.odds_american };
    if (best.ev.edgePct >= MIN_EDGE_PCT) {
      lines.push(`✅ Pick moneyline: **${best.team}** (${best.odds > 0 ? '+' : ''}${best.odds}) — edge de ${best.ev.edgePct.toFixed(1)}%.`);
      suggestedLegs.push({ selection: `${best.team} ML`, marketType: 'moneyline', oddsAmerican: best.odds, edgePct: best.ev.edgePct });
    } else {
      lines.push(`Ninguno de los dos moneylines llega al umbral de 3% de edge — es un partido parejo para el modelo, no hay pick claro de equipo.`);
    }
  } else {
    lines.push('No tengo odds de moneyline cargadas para este partido todavía (SharpAPI puede no tener líneas publicadas aún si falta mucho para el kickoff).');
  }

  const topFactors = [...breakdown].sort((a, b) => Math.abs(b.homeDelta) + Math.abs(b.awayDelta) - (Math.abs(a.homeDelta) + Math.abs(a.awayDelta))).slice(0, 3);
  if (topFactors.length > 0) {
    lines.push('Factores que más pesaron: ' + topFactors.map((f) => f.label).join('; ') + '.');
  }

  // Props del partido, para armar SGP
  try {
    const propOdds = await fetchPlayerProps(['pass_yards', 'rush_yards', 'anytime_td', 'rec_yards']);
    const defFactors = computeDefensiveFactors(teamStats, week);
    const wx = weatherMultipliers(game);
    const propLines: string[] = [];

    for (const [team, opponent] of [[game.home_team, game.away_team], [game.away_team, game.home_team]] as const) {
      const playerIds = Array.from(new Set(seasonStats.filter((p) => p.team === team && p.week < week).map((p) => p.player_id)));
      for (const pid of playerIds) {
        const rows = seasonStats.filter((p) => p.player_id === pid);
        const name = rows[0]?.player_display_name ?? pid;
        const pos = rows[0]?.position;

        if (pos === 'QB') {
          const proj = projectPassYards(seasonStats, pid, week, opponent, defFactors, wx.passMult);
          const line = propOdds.find((l) => l.player_name === name && l.market_type === 'player_passing_yards');
          if (proj && line?.line !== undefined) {
            const p = probOverLine(proj, line.line);
            const ev = evaluateEdge(p, 0.5);
            if (ev.edgePct >= MIN_EDGE_PCT) {
              suggestedLegs.push({ selection: `${name} Over ${line.line} yardas de pase`, marketType: 'pass_yards', oddsAmerican: line.odds_american, edgePct: ev.edgePct });
            }
          }
        }
        if (pos === 'RB') {
          const tdProj = projectAnytimeTd(seasonStats, pid, week, 'rush');
          const line = propOdds.find((l) => l.player_name === name && l.market_type === 'anytime_touchdown_scorer');
          if (tdProj?.lambda !== undefined && line) {
            const p = poissonProbAtLeastOne(tdProj.lambda);
            const ev = evaluateEdge(p, 0.5);
            if (ev.edgePct >= MIN_EDGE_PCT) {
              suggestedLegs.push({ selection: `${name} Anytime TD`, marketType: 'anytime_td', oddsAmerican: line.odds_american, edgePct: ev.edgePct });
            }
          }
        }
      }
    }

    if (suggestedLegs.length > 1) {
      lines.push(
        `Para armar un same-game parlay: estas son las legs con edge individual positivo (no calculo la cuota combinada — eso depende de la correlación interna del book, arma la combinación directamente ahí).`
      );
    }
    void propLines;
  } catch (err) {
    if (err instanceof SharpApiPropsUnavailableError) {
      lines.push('(Props no disponibles en tu plan de SharpAPI todavía — este análisis es solo a nivel de equipo.)');
    } else {
      throw err;
    }
  }

  return {
    homeTeam: game.home_team,
    awayTeam: game.away_team,
    answer: lines.join('\n\n'),
    suggestedLegs,
  };
}
