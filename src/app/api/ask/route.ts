import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { answerMatchupQuestion, AskParseError } from '@/lib/engine/ask';
import { getSupabaseAdmin } from '@/lib/db/client';

export const maxDuration = 60;

const bodySchema = z.object({ question: z.string().min(3).max(500) });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const result = await answerMatchupQuestion(parsed.data.question);

    const db = getSupabaseAdmin();
    await db.from('matchup_questions').insert({
      question: parsed.data.question,
      home_team: result.homeTeam,
      away_team: result.awayTeam,
      answer: result.answer,
      suggested_legs: result.suggestedLegs,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AskParseError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error('ask failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error desconocido' }, { status: 500 });
  }
}
