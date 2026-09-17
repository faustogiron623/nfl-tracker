// Diccionario de equipos NFL: código oficial (el que usa nflverse) + alias
// en español/inglés para parsear preguntas libres tipo "bills vs lions"
// sin necesidad de un LLM.

export interface TeamInfo {
  code: string;
  city: string;
  name: string;
  aliases: string[];
}

export const TEAMS: TeamInfo[] = [
  { code: 'ARI', city: 'Arizona', name: 'Cardinals', aliases: ['arizona', 'cardinals', 'cardenales'] },
  { code: 'ATL', city: 'Atlanta', name: 'Falcons', aliases: ['atlanta', 'falcons', 'halcones'] },
  { code: 'BAL', city: 'Baltimore', name: 'Ravens', aliases: ['baltimore', 'ravens', 'cuervos'] },
  { code: 'BUF', city: 'Buffalo', name: 'Bills', aliases: ['buffalo', 'bills'] },
  { code: 'CAR', city: 'Carolina', name: 'Panthers', aliases: ['carolina', 'panthers', 'panteras'] },
  { code: 'CHI', city: 'Chicago', name: 'Bears', aliases: ['chicago', 'bears', 'osos'] },
  { code: 'CIN', city: 'Cincinnati', name: 'Bengals', aliases: ['cincinnati', 'bengals', 'bengales'] },
  { code: 'CLE', city: 'Cleveland', name: 'Browns', aliases: ['cleveland', 'browns'] },
  { code: 'DAL', city: 'Dallas', name: 'Cowboys', aliases: ['dallas', 'cowboys', 'vaqueros'] },
  { code: 'DEN', city: 'Denver', name: 'Broncos', aliases: ['denver', 'broncos'] },
  { code: 'DET', city: 'Detroit', name: 'Lions', aliases: ['detroit', 'lions', 'leones'] },
  { code: 'GB', city: 'Green Bay', name: 'Packers', aliases: ['green bay', 'packers', 'empacadores', 'gb'] },
  { code: 'HOU', city: 'Houston', name: 'Texans', aliases: ['houston', 'texans', 'texanos'] },
  { code: 'IND', city: 'Indianapolis', name: 'Colts', aliases: ['indianapolis', 'colts', 'potros'] },
  { code: 'JAX', city: 'Jacksonville', name: 'Jaguars', aliases: ['jacksonville', 'jaguars', 'jaguares', 'jax'] },
  { code: 'KC', city: 'Kansas City', name: 'Chiefs', aliases: ['kansas city', 'chiefs', 'kc'] },
  { code: 'LV', city: 'Las Vegas', name: 'Raiders', aliases: ['las vegas', 'raiders', 'vegas'] },
  { code: 'LAC', city: 'Los Angeles', name: 'Chargers', aliases: ['chargers', 'lac'] },
  { code: 'LA', city: 'Los Angeles', name: 'Rams', aliases: ['rams', 'carneros'] },
  { code: 'MIA', city: 'Miami', name: 'Dolphins', aliases: ['miami', 'dolphins', 'delfines'] },
  { code: 'MIN', city: 'Minnesota', name: 'Vikings', aliases: ['minnesota', 'vikings', 'vikingos'] },
  { code: 'NE', city: 'New England', name: 'Patriots', aliases: ['new england', 'patriots', 'patriotas', 'ne'] },
  { code: 'NO', city: 'New Orleans', name: 'Saints', aliases: ['new orleans', 'saints', 'santos'] },
  { code: 'NYG', city: 'New York', name: 'Giants', aliases: ['giants', 'gigantes', 'nyg'] },
  { code: 'NYJ', city: 'New York', name: 'Jets', aliases: ['jets', 'nyj'] },
  { code: 'PHI', city: 'Philadelphia', name: 'Eagles', aliases: ['philadelphia', 'eagles', 'aguilas', 'águilas'] },
  { code: 'PIT', city: 'Pittsburgh', name: 'Steelers', aliases: ['pittsburgh', 'steelers', 'acereros'] },
  { code: 'SF', city: 'San Francisco', name: '49ers', aliases: ['san francisco', '49ers', 'niners', 'sf'] },
  { code: 'SEA', city: 'Seattle', name: 'Seahawks', aliases: ['seattle', 'seahawks', 'halcones marinos'] },
  { code: 'TB', city: 'Tampa Bay', name: 'Buccaneers', aliases: ['tampa bay', 'buccaneers', 'bucs', 'piratas', 'tb'] },
  { code: 'TEN', city: 'Tennessee', name: 'Titans', aliases: ['tennessee', 'titans', 'titanes'] },
  { code: 'WAS', city: 'Washington', name: 'Commanders', aliases: ['washington', 'commanders', 'comandantes'] },
];

/** Busca todos los equipos mencionados en un texto libre (case-insensitive, sin acentos estrictos). */
export function extractTeamsFromText(text: string): TeamInfo[] {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // quita acentos para matching más laxo

  const found: TeamInfo[] = [];
  for (const team of TEAMS) {
    const matches = team.aliases.some((alias) => {
      const normAlias = alias.normalize('NFD').replace(/[̀-ͯ]/g, '');
      return new RegExp(`\\b${normAlias}\\b`).test(normalized);
    });
    if (matches) found.push(team);
  }
  return found;
}

export function getTeamByCode(code: string): TeamInfo | undefined {
  return TEAMS.find((t) => t.code === code);
}

/** Temporada NFL "activa" para una fecha dada (nflverse etiqueta la temporada por el año en que arranca, ej. playoffs de enero 2027 son season=2026). */
export function seasonForDate(date: Date): number {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();
  return month >= 3 ? year : year - 1;
}
