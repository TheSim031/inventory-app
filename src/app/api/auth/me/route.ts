import { NextResponse, type NextRequest } from 'next/server';
import { decodeLineSession, getLineLoginConfig } from '@/lib/lineAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Return the currently signed-in LINE user (or null) plus enough config so
 * the client can decide whether to show a login button vs the OA add-friend
 * link vs the requisition form. Never returns secrets.
 */
export function GET(request: NextRequest) {
  const session = decodeLineSession(request.cookies.get('line_user')?.value);
  const cfg = getLineLoginConfig();

  return NextResponse.json({
    user: session,
    lineLoginEnabled: !!cfg,
    oaBasicId: cfg?.oaBasicId || '',
  });
}
