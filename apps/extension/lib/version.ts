import { API_SCHEMA_EXPECTED, type VersionInfo } from '@sahamati/contracts';

/**
 * True when the backend is demonstrably older than this build: no /version endpoint (`null`), a different
 * api_schema, or (when the build was stamped with a git SHA) a different git_sha.
 */
export function isStaleBackend(version: VersionInfo | null, clientSha: string | undefined = undefined): boolean {
  if (version === null) return true;
  if (version.api_schema !== API_SCHEMA_EXPECTED) return true;
  return Boolean(clientSha) && version.git_sha !== 'unknown' && version.git_sha !== clientSha;
}
