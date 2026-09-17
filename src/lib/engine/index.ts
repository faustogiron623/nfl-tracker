// Orquestador principal: implementa el flujo completo del playbook para
// una semana dada. CERO llamadas a LLM en esta ruta — todo determinístico.

import {
  fetchGamesForWeek,
  fetchInjuriesWeek,
  fetchPlayerStatsSeason,
  fetchTeamStatsSeason,
  NflverseGame,
} from '../ingest/nflverse';
import { fetchMoneylineOdds, fetchPlayerProps, SharpApiPropsUnavailableError, SharpApiOddsLine } from '../ingest/sharpapi';
import { computeTeamRatings, computeBaseEdge, edgeToHomeWinProb, TeamRating } from './ratings';
import { applySituationalAdjustments, weatherMultipliers, GameContext } from './situational';
import { identifyStarters, isPlayerOut } from './starters';
import {
  computeDefensiveFactors,
  projectPassYards,
  projectRushYards,
  projectReceivingYards,
  projectAnytimeTd,
  probOverLine,
  poissonProbAtLeastOne,
} from './props';
import { deVigTwoWay, evaluateEdge, americanToDecimal } from './edge';
import { waterFillAllocate, selectParlay, ParlayCandidate } from './portfolio';
import { buildMoneylineReasoning, buildPropReasoning } from './reasoning';
import { MarketType, PortfolioType } from '../db/types';

export interface CandidatePick {
  marketType: MarketType;
  selection: string;
  playerName: string | null;
  team: string | null;
  gameId: string;
  line: number | null;
  oddsAmerican: number;
  modelProb: number;
  fairProb: number;
  edgePct: number;
  reasoning: string[];
}

export interface AnalyzeWeekResult {
  season: number;
  week: number;
  games: NflverseGame[];
  propsAvailable: boolean;
  propsWarning: string | null;
  candidatesByType: { team_only: CandidatePick[]; props_only: CandidatePick[] };
  portfolios: GeneratedPortfolio[];
}

export interface GeneratedPortfolio {
  portfolioType: PortfolioType;
  picks: (CandidatePick & { stakeCents: number })[];
  parlay: { legs: ParlayCandidate[]; combinedOddsAmerican: number; stakeCents: number } | null;
  totalBudgetCents: number;
  picksBudgetCents: number;
  parlayBudgetCents: number;
}

function findOddsLine(
  lines: SharpApiOddsLine[],
  homeTeam: string,
  awayTeam: string,
  selectionMatcher: (l: SharpApiOddsLine) => boolean
): SharpApiOddsLine | null {
  return (
    lines.find(
      (l) =>
        ((l.home_team === homeTeam && l.away_team === awayTeam) ||
          (l.home_team === awayTeam && l.away_team === homeTeam)) &&
        selectionMatcher(l)
    ) ?? null
  );
}

/**
 * Paso 1: genera los picks de moneyline calificados (equipos) para todos
 * los partidos de la semana.
 */
async function buildMoneylinePicks(
  season: number,
  week: number,
  games: NflverseGame[],
  ratings: TeamRating[],
  moneylineOdds: SharpApiOddsLine[]
): Promise<CandidatePick[]> {
  const ratingByTeam = new Map(ratings.map((r) => [r.team, r]));
  const injuries = await fetchInjuriesWeek(season, week);
  const seasonStats = await fetchPlayerStatsSeason(season);

  const picks: CandidatePick[] = [];

  for (const game of games) {
    const home = ratingByTeam.get(game.home_team);
    const away = ratingByTeam.get(game.away_team);
    if (!home || !away) continue;

    const baseEdge = computeBaseEdge(home, away);

    const homeStarters = identifyStarters(game.home_team, seasonStats);
    const awayStarters = identifyStarters(game.away_team, seasonStats);

    const ctx: GameContext = {
      game,
      homeQbOut: isPlayerOut(injuries, homeStarters.qbId),
      awayQbOut: isPlayerOut(injuries, awayStarters.qbId),
      homeSkillPlayerOut:
        isPlayerOut(injuries, homeStarters.rb1Id) || isPlayerOut(injuries, homeStarters.wr1Id),
      awaySkillPlayerOut:
        isPlayerOut(injuries, awayStarters.rb1Id) || isPlayerOut(injuries, awayStarters.wr1Id),
      homePassRusherOut: isPlayerOut(injuries, homeStarters.edge1Id),
      awayPassRusherOut: isPlayerOut(injuries, awayStarters.edge1Id),
    };

    const { adjustedEdge, breakdown } = applySituationalAdjustments(baseEdge, ctx);
    const modelHomeWinProb = edgeToHomeWinProb(adjustedEdge);

    const homeLine = findOddsLine(
      moneylineOdds,
      game.home_team,
      game.away_team,
      (l) => l.selection === game.home_team || l.home_team === game.home_team
    );
    const awayLine = findOddsLine(
      moneylineOdds,
      game.home_team,
      game.away_team,
      (l) => l.selection === game.away_team || l.away_team === game.away_team
    );

    if (!homeLine || !awayLine) continue; // sin odds de mercado no se puede calcular edge

    const { fairProbA: fairHome, fairProbB: fairAway } = deVigTwoWay(
      homeLine.odds_american,
      awayLine.odds_american
    );

    const homeEval = evaluateEdge(modelHomeWinProb, fairHome);
    const awayEval = evaluateEdge(1 - modelHomeWinProb, fairAway);

    if (homeEval.qualifies) {
      picks.push({
        marketType: 'moneyline',
        selection: `${game.home_team} ML`,
        playerName: null,
        team: game.home_team,
        gameId: game.game_id,
        line: null,
        oddsAmerican: homeLine.odds_american,
        modelProb: modelHomeWinProb,
        fairProb: fairHome,
        edgePct: homeEval.edgePct,
        reasoning: buildMoneylineReasoning(homeEval.edgePct, breakdown, game.home_team, game.away_team, true),
      });
    }
    if (awayEval.qualifies) {
      picks.push({
        marketType: 'moneyline',
        selection: `${game.away_team} ML`,
        playerName: null,
        team: game.away_team,
        gameId: game.game_id,
        line: null,
        oddsAmerican: awayLine.odds_american,
        modelProb: 1 - modelHomeWinProb,
        fairProb: fairAway,
        edgePct: awayEval.edgePct,
        reasoning: buildMoneylineReasoning(awayEval.edgePct, breakdown, game.home_team, game.away_team, false),
      });
    }
  }

  return picks.sort((a, b) => b.edgePct - a.edgePct);
}

/**
 * Paso 2: genera picks de props calificados. Devuelve [] si SharpAPI no
 * sirve props en el plan actual (no lanza, para no tumbar el análisis
 * completo — el caller decide cómo comunicar el degradado).
 */
async function buildPropPicks(
  season: number,
  week: number,
  games: NflverseGame[]
): Promise<{ picks: CandidatePick[]; available: boolean; warning: string | null }> {
  let propOdds: SharpApiOddsLine[];
  try {
    propOdds = await fetchPlayerProps([
      'pass_yards',
      'rush_yards',
      'anytime_td',
      'rec_yards',
      'receptions',
    ]);
  } catch (err) {
    if (err instanceof SharpApiPropsUnavailableError) {
      return { picks: [], available: false, warning: err.message };
    }
    throw err;
  }

  const [playerStats, teamStats] = await Promise.all([
    fetchPlayerStatsSeason(season),
    fetchTeamStatsSeason(season),
  ]);
  const defFactors = computeDefensiveFactors(teamStats, week);
  const picks: CandidatePick[] = [];

  for (const game of games) {
    const wx = weatherMultipliers(game);

    for (const [team, opponent] of [
      [game.home_team, game.away_team],
      [game.away_team, game.home_team],
    ] as const) {
      const teamPlayers = Array.from(
        new Set(
          playerStats
            .filter((p) => p.team === team && p.week < week && p.season_type === 'REG')
            .map((p) => p.player_id)
        )
      );

      for (const playerId of teamPlayers) {
        const playerRows = playerStats.filter((p) => p.player_id === playerId);
        const displayName = playerRows[0]?.player_display_name ?? playerId;
        const position = playerRows[0]?.position;

        // Pass yards (QBs)
        if (position === 'QB') {
          const proj = projectPassYards(playerStats, playerId, week, opponent, defFactors, wx.passMult);
          if (proj) {
            const line = findOddsLine(
              propOdds,
              game.home_team,
              game.away_team,
              (l) => l.player_name === displayName && l.market_type === 'player_passing_yards'
            );
            if (line?.line !== undefined) {
              maybeAddYardageProp(picks, 'pass_yards', displayName, team, game.game_id, line, proj, opponent);
            }
          }
        }

        // Rush yards + anytime TD (RBs)
        if (position === 'RB') {
          const proj = projectRushYards(playerStats, teamStats, playerId, team, week, opponent, defFactors, wx.rushMult);
          if (proj) {
            const line = findOddsLine(
              propOdds,
              game.home_team,
              game.away_team,
              (l) => l.player_name === displayName && l.market_type === 'player_rushing_yards'
            );
            if (line?.line !== undefined) {
              maybeAddYardageProp(picks, 'rush_yards', displayName, team, game.game_id, line, proj, opponent);
            }
          }
          const tdProj = projectAnytimeTd(playerStats, playerId, week, 'rush');
          if (tdProj) {
            const line = findOddsLine(
              propOdds,
              game.home_team,
              game.away_team,
              (l) => l.player_name === displayName && l.market_type === 'anytime_touchdown_scorer'
            );
            if (line) maybeAddTdProp(picks, displayName, team, game.game_id, line, tdProj);
          }
        }

        // Receiving yards + receptions + anytime TD (WRs)
        if (position === 'WR' || position === 'TE') {
          const proj = projectReceivingYards(playerStats, teamStats, playerId, team, week, opponent, defFactors, wx.passMult);
          if (proj) {
            const line = findOddsLine(
              propOdds,
              game.home_team,
              game.away_team,
              (l) => l.player_name === displayName && l.market_type === 'player_receiving_yards'
            );
            if (line?.line !== undefined) {
              maybeAddYardageProp(picks, 'rec_yards', displayName, team, game.game_id, line, proj, opponent);
            }
          }
          const tdProj = projectAnytimeTd(playerStats, playerId, week, 'rec');
          if (tdProj) {
            const line = findOddsLine(
              propOdds,
              game.home_team,
              game.away_team,
              (l) => l.player_name === displayName && l.market_type === 'anytime_touchdown_scorer'
            );
            if (line) maybeAddTdProp(picks, displayName, team, game.game_id, line, tdProj);
          }
        }
      }
    }
  }

  return { picks: picks.sort((a, b) => b.edgePct - a.edgePct), available: true, warning: null };
}

function maybeAddYardageProp(
  picks: CandidatePick[],
  marketType: MarketType,
  playerName: string,
  team: string,
  gameId: string,
  line: SharpApiOddsLine,
  proj: ReturnType<typeof projectPassYards>,
  opponent: string
) {
  if (!proj || line.line === undefined) return;
  const modelProbOver = probOverLine(proj, line.line);
  const impliedOverUnderPair = 0.5; // sin la línea del "under" del mismo mercado, usamos vig estándar de -110/-110 como aproximación
  const fairProb = 100 / 110 / (100 / 110 + 100 / 110); // = 0.5 exacto, de-vig de un mercado -110/-110 simétrico
  void impliedOverUnderPair;
  const evalRes = evaluateEdge(modelProbOver, fairProb);
  if (!evalRes.qualifies) return;

  const marketLabels: Record<string, string> = {
    pass_yards: 'Yardas de pase',
    rush_yards: 'Yardas de carrera',
    rec_yards: 'Yardas de recepción',
  };

  picks.push({
    marketType,
    selection: `${playerName} Over ${line.line} ${marketLabels[marketType]}`,
    playerName,
    team,
    gameId,
    line: line.line,
    oddsAmerican: line.odds_american,
    modelProb: modelProbOver,
    fairProb,
    edgePct: evalRes.edgePct,
    reasoning: buildPropReasoning(playerName, marketLabels[marketType], line.line, proj.inputs, evalRes.edgePct, opponent),
  });
}

function maybeAddTdProp(
  picks: CandidatePick[],
  playerName: string,
  team: string,
  gameId: string,
  line: SharpApiOddsLine,
  proj: { lambda?: number; inputs: Record<string, number> }
) {
  if (proj.lambda === undefined) return;
  const modelProb = poissonProbAtLeastOne(proj.lambda);
  const fairProb = 0.5; // aproximación -110/-110; se reemplaza por de-vig real si SharpAPI trae ambos lados
  const evalRes = evaluateEdge(modelProb, fairProb);
  if (!evalRes.qualifies) return;

  picks.push({
    marketType: 'anytime_td',
    selection: `${playerName} Anytime TD`,
    playerName,
    team,
    gameId,
    line: null,
    oddsAmerican: line.odds_american,
    modelProb,
    fairProb,
    edgePct: evalRes.edgePct,
    reasoning: buildPropReasoning(playerName, 'TD en cualquier momento', null, proj.inputs, evalRes.edgePct, ''),
  });
}

function allocatePortfolio(
  picks: CandidatePick[],
  portfolioType: PortfolioType,
  totalBudgetCents: number,
  maxPicks = 4
): GeneratedPortfolio {
  const selected = picks.slice(0, maxPicks);
  const picksBudgetCents = Math.round(totalBudgetCents * 0.9);
  const parlayBudgetCents = totalBudgetCents - picksBudgetCents;

  const shares = waterFillAllocate(selected.map((p) => Math.max(p.edgePct, 0.1)));
  const picksWithStake = selected.map((p, i) => ({
    ...p,
    stakeCents: Math.round(picksBudgetCents * shares[i]),
  }));

  const parlayCandidates: ParlayCandidate[] = picks
    .filter((p) => !selected.includes(p) && p.edgePct > 0)
    .map((p) => ({ id: p.selection, gameId: p.gameId, selection: p.selection, oddsAmerican: p.oddsAmerican, edgePct: p.edgePct }));

  const parlayResult = selectParlay(parlayCandidates);

  return {
    portfolioType,
    picks: picksWithStake,
    parlay: parlayResult
      ? { legs: parlayResult.legs, combinedOddsAmerican: parlayResult.combinedOddsAmerican, stakeCents: parlayBudgetCents }
      : null,
    totalBudgetCents,
    picksBudgetCents,
    parlayBudgetCents,
  };
}

export async function analyzeWeek(
  season: number,
  week: number,
  budgetCents: number
): Promise<AnalyzeWeekResult> {
  const games = await fetchGamesForWeek(season, week);
  if (games.length === 0) {
    throw new Error(`No se encontraron partidos para ${season} semana ${week} en nflverse.`);
  }

  const [ratings, moneylineOdds] = await Promise.all([
    computeTeamRatings(season, week),
    fetchMoneylineOdds(),
  ]);

  const teamOnlyPicks = await buildMoneylinePicks(season, week, games, ratings, moneylineOdds);
  const { picks: propsOnlyPicks, available: propsAvailable, warning } = await buildPropPicks(
    season,
    week,
    games
  );

  const mixedPicks = [...teamOnlyPicks, ...propsOnlyPicks].sort((a, b) => b.edgePct - a.edgePct);

  const portfolios: GeneratedPortfolio[] = [
    allocatePortfolio(teamOnlyPicks, 'team_only', budgetCents),
    ...(propsAvailable ? [allocatePortfolio(propsOnlyPicks, 'props_only', budgetCents)] : []),
    allocatePortfolio(mixedPicks, 'mixed', budgetCents),
  ];

  return {
    season,
    week,
    games,
    propsAvailable,
    propsWarning: warning,
    candidatesByType: { team_only: teamOnlyPicks, props_only: propsOnlyPicks },
    portfolios,
  };
}

export { americanToDecimal };
