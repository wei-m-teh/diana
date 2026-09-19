// Authenticated token service (Phase 2).
//
// Replaces the dev-only /api/token for signed-in users. Flow:
//   1. Identify the user (cookie session for web, or `Authorization: Bearer`
//      for mobile).
//   2. Load their chosen voice, plan, and month-to-date usage (service role).
//   3. Enforce: pro voices require an allowing plan; block if over quota.
//   4. Mint a LiveKit token that dispatches the "diana" agent with the chosen
//      voice in metadata.
//   5. Return { serverUrl, participantToken, roomName } (standard format) so
//      both the web app and the Flutter EndpointTokenSource work unchanged.
//
// Deps: pnpm add @supabase/supabase-js @supabase/ssr   (livekit-server-sdk /
// @livekit/protocol are already present).

import { NextResponse } from 'next/server';
import { AccessToken, type VideoGrant } from 'livekit-server-sdk';
import { RoomConfiguration, RoomAgentDispatch } from '@livekit/protocol';
import { createServerSupabase, getUserFromBearer, createServiceSupabase } from '@/lib/supabase/server';
import { getVoice } from '@/lib/voices';

export const revalidate = 0;

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const AGENT_NAME = 'diana';

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function POST(req: Request) {
  try {
    if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
      return new NextResponse('LiveKit server env not configured', { status: 500 });
    }

    // 1. Identify the user: cookie session (web) or bearer token (mobile).
    let userId: string | null = null;
    const cookieClient = await createServerSupabase();
    const { data: cookieUser } = await cookieClient.auth.getUser();
    if (cookieUser.user) {
      userId = cookieUser.user.id;
    } else {
      const bearerUser = await getUserFromBearer(req.headers.get('authorization'));
      userId = bearerUser?.id ?? null;
    }
    if (!userId) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // 2. Load settings, plan, and usage with the service role (bypasses RLS).
    const svc = createServiceSupabase();

    const { data: settings } = await svc
      .from('user_settings')
      .select('voice_key')
      .eq('user_id', userId)
      .maybeSingle();

    const { data: sub } = await svc
      .from('subscriptions')
      .select('plan_id, current_period_start, plans(monthly_minutes, allows_pro_voices)')
      .eq('user_id', userId)
      .maybeSingle();

    // Supabase returns the joined row as an object (or array); normalize.
    const plan = (Array.isArray(sub?.plans) ? sub?.plans[0] : sub?.plans) as
      | { monthly_minutes: number | null; allows_pro_voices: boolean }
      | undefined;
    const monthlyMinutes = plan?.monthly_minutes ?? 30;
    const allowsProVoices = plan?.allows_pro_voices ?? false;

    // 3a. Resolve + gate the voice. Pro voice without entitlement → default.
    let voice = getVoice(settings?.voice_key);
    if (voice.tier === 'pro' && !allowsProVoices) {
      voice = getVoice(null);
    }

    // 3b. Quota: sum seconds in the current period.
    const periodStart = sub?.current_period_start
      ? new Date(sub.current_period_start)
      : monthStart();
    const { data: usageRows } = await svc
      .from('usage_sessions')
      .select('seconds')
      .eq('user_id', userId)
      .gte('started_at', periodStart.toISOString());
    const usedSeconds = (usageRows ?? []).reduce((sum, r) => sum + (r.seconds ?? 0), 0);

    if (monthlyMinutes !== null && usedSeconds >= monthlyMinutes * 60) {
      return NextResponse.json(
        { error: 'quota_exceeded', usedSeconds, limitSeconds: monthlyMinutes * 60 },
        { status: 402 }
      );
    }

    // 4. Mint the token with agent dispatch + voice metadata.
    const roomName = `diana_${userId.slice(0, 8)}_${Date.now()}`;
    const at = new AccessToken(API_KEY, API_SECRET, { identity: userId, ttl: '15m' });
    const grant: VideoGrant = {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    };
    at.addGrant(grant);
    at.roomConfig = new RoomConfiguration({
      agents: [
        new RoomAgentDispatch({
          agentName: AGENT_NAME,
          metadata: JSON.stringify({ voice: voice.key, user_id: userId }),
        }),
      ],
    });

    const participantToken = await at.toJwt();
    return NextResponse.json(
      { serverUrl: LIVEKIT_URL, roomName, participantToken, participantName: 'user' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : 'error';
    return new NextResponse(msg, { status: 500 });
  }
}
