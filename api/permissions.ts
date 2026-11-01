import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AuthUser } from './auth.js'

export type Role = AuthUser['role']

const roleRank: Record<string, number> = {
  staff: 10,
  support_agent: 10,
  manager: 20,
  admin: 30,
  owner: 40,
  super_admin: 50,
}

export function hasMinimumRole(user: AuthUser, minimumRole: Role) {
  return (roleRank[user.role] ?? 0) >= (roleRank[minimumRole] ?? Number.MAX_SAFE_INTEGER)
}

export function requireRole(minimumRole: Role) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user || !hasMinimumRole(request.user, minimumRole)) {
      return reply.code(403).send({ error: 'You do not have permission to perform this action' })
    }
  }
}
