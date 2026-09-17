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

// OJO: l.home_team/l.away_team traen el NOMBRE COMPLETO del equipo
// ("Buffalo Bills"), no el código de nflverse ("BUF") — por eso el matching
// va contra l.home.abbreviation/l.away.abbreviation, que sí es el código real.
function findOddsLine(
  lines: SharpApiOddsLine[],
  homeTeam: string,
  awayTeam: string,
  selectionMatcher: (l: SharpApiOddsLine) => boolean
): SharpApiOddsLine | null {
  return (
    lines.find(
      (l) =>
        ((l.home?.abbreviation === homeTeam && l.away?.abbreviation === awayTeam) ||
          (l.home?.abbreviation === awayTeam && l.away?.abbreviation === homeTeam)) &&
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

    // l.selection viene en formato distinto según la casa ("BUF Bills" en
    // DraftKings vs "Buffalo Bills" en FanDuel) — usamos team_side, que es
    // consistente entre casas, para saber cuál línea es la del local/visita.
    const homeLine = findOddsLine(
      moneylineOdds,
      game.home_team,
      game.away_team,
      (l) => l.market_type === 'moneyline' && l.team_side === 'home'
    );
    const awayLine = findOddsLine(
      moneylineOdds,
      game.home_team,
      game.away_team,
      (l) => l.market_type === 'moneyline' && l.team_side === 'away'
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