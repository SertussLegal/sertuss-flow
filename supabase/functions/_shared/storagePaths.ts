// Shared storage path guard. Use BEFORE signing or fetching any client-supplied
// Storage path with the service_role key, to prevent cross-tenant IDOR.

export class ForbiddenPathError extends Error {
  constructor(public readonly path: string, public readonly ownerPrefix: string) {
    super(`Forbidden path: '${path}' does not belong to '${ownerPrefix}'`);
    this.name = "ForbiddenPathError";
  }
}

/**
 * Throws ForbiddenPathError if `path` does not start with `${ownerPrefix}/`.
 * `ownerPrefix` is typically a verified tenant id (cancelacionId, tramiteId,
 * or organization_id) resolved from the JWT — never trust client input here.
 */
export function assertOwnPath(path: string, ownerPrefix: string): void {
  if (typeof path !== "string" || path.length === 0) {
    throw new ForbiddenPathError(String(path), ownerPrefix);
  }
  if (!ownerPrefix || typeof ownerPrefix !== "string") {
    throw new ForbiddenPathError(path, String(ownerPrefix));
  }
  if (!path.startsWith(`${ownerPrefix}/`)) {
    throw new ForbiddenPathError(path, ownerPrefix);
  }
}

/** Convenience: validate every path in an array. */
export function assertOwnPaths(paths: readonly string[], ownerPrefix: string): void {
  for (const p of paths) assertOwnPath(p, ownerPrefix);
}
