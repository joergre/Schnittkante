export function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/** This app has no external project id. Auth stays in the local mode. */
export function isWorkspacePreview(): boolean {
  return true;
}
