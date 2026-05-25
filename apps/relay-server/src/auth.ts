import jwt from 'jsonwebtoken';

interface SupabaseJwtPayload {
  sub: string;
  email?: string;
  role?: string;
  iat?: number;
  exp?: number;
}

export function verifySupabaseJWT(token: string): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error('SUPABASE_JWT_SECRET environment variable is not set');
  }

  const payload = jwt.verify(token, secret) as SupabaseJwtPayload;

  if (!payload.sub) {
    throw new Error('JWT payload missing sub (userId)');
  }

  return payload.sub;
}
